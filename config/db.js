const { Pool } = require('pg');
require('dotenv').config();

const dbConnectionString = process.env.DB_CONNECTION_STRING;
const shouldLogSlowQueries = String(process.env.LOG_SLOW_DB_QUERIES || '').trim().toLowerCase() === 'true';

const shouldUseSsl =
  process.env.DB_SSL === 'true' ||
  (dbConnectionString || '').includes('sslmode=require');
const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || 800);
const shouldLogIdleClientStack = String(process.env.DB_LOG_IDLE_CLIENT_STACK || '').trim().toLowerCase() === 'true';

function isTransientIdleClientDrop(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();

  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    message.includes('etimedout') ||
    message.includes('read etimedout') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('terminating connection due to administrator command') ||
    message.includes('connection reset by peer')
  );
}

function warnIfDbConfigLooksWrong() {
  if (!dbConnectionString) {
    console.warn('[DB] ⚠️ DB_CONNECTION_STRING is not set. Database-dependent features will fail.');
    return;
  }

  try {
    const parsed = new URL(dbConnectionString);
    const host = parsed.hostname || '';
    const isLikelyShortRenderHost = host.startsWith('dpg-') && !host.includes('.');

    if (isLikelyShortRenderHost) {
      console.warn('[DB] ⚠️ DB_CONNECTION_STRING host looks incomplete. Use the full Render Internal/External Database URL (host should end with render.com).');
    }
  } catch (error) {
    console.warn('[DB] ⚠️ DB_CONNECTION_STRING is not a valid URL. Paste the full Render Postgres connection URL.');
  }
}

warnIfDbConfigLooksWrong();

const pool = new Pool({
  connectionString: dbConnectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  // Postgres plan caps at 103 max_connections (100 usable after superuser
  // reserve); Mira's separate pool (mira/config/db.js) also shares this
  // budget (default max 10). 30 leaves comfortable headroom for other
  // services/spikes while letting concurrent requests (each middleware
  // hop + large form submissions like promotion scheduling) avoid queueing
  // on a small pool.
  max: parseInt(process.env.DB_POOL_MAX || '30', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Kill any query that hangs for more than 30 s so a stalled query never
  // blocks the pool and makes the entire app appear to hang.
  statement_timeout: 30000,
});

const dbMetrics = {
  totalQueries: 0,
  slowQueries: 0,
};

const originalQuery = pool.query.bind(pool);

// The database can restart or drop connections for a few seconds (maintenance,
// a failover, a network blip). Instead of failing the page, wait briefly and
// try again:
//   - the database refused the connection (starting up, not accepting yet,
//     connect timeout): the query never ran, so any query is retried;
//   - the connection dropped mid-query: only read-only queries are retried,
//     so a write is never applied twice.
const RETRY_DELAYS_MS = [250, 1000, 2500];

function sqlTextOf(args) {
  const input = args[0];
  if (typeof input === 'string') return input;
  return input && typeof input.text === 'string' ? input.text : '';
}

function isReadOnlySql(sql) {
  const text = String(sql || '').replace(/--[^\n]*/g, ' ').trim().toLowerCase();
  if (!/^(select|with|show)\b/.test(text)) return false;
  return !/\b(insert|update|delete|merge|create|alter|drop|truncate|nextval|setval|pg_advisory|for\s+update|for\s+share)\b/.test(text);
}

function isConnectRefusal(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '57P03' || // cannot_connect_now: starting up / not yet accepting connections
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    message.includes('not yet accepting connections') ||
    message.includes('the database system is starting up') ||
    message.includes('the database system is shutting down') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('connection terminated due to connection timeout')
  );
}

function shouldRetryQuery(error, args) {
  if (isConnectRefusal(error)) return true;
  return isTransientIdleClientDrop(error) && isReadOnlySql(sqlTextOf(args));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function queryWithRetry(args) {
  // Callback-style calls are passed straight through (no retry).
  if (typeof args[args.length - 1] === 'function') return originalQuery(...args);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalQuery(...args);
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !shouldRetryQuery(error, args)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

pool.query = async (...args) => {
  const startedAt = process.hrtime.bigint();
  try {
    return await queryWithRetry(args);
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbMetrics.totalQueries += 1;

    if (elapsedMs >= slowQueryThresholdMs) {
      dbMetrics.slowQueries += 1;
      if (shouldLogSlowQueries) {
        const queryInput = args[0];
        const sqlText = typeof queryInput === 'string'
          ? queryInput
          : (queryInput && typeof queryInput.text === 'string' ? queryInput.text : '[unknown query]');
        const compactSql = sqlText.replace(/\s+/g, ' ').trim().slice(0, 240);
        console.warn(`[DB][SLOW] ${elapsedMs.toFixed(1)}ms ${compactSql}`);
      }
    }
  }
};

// Borrowing a connection for a transaction: when the database refuses it
// (restarting), nothing has run yet, so wait briefly and try again.
const originalConnect = pool.connect.bind(pool);
pool.connect = async (...args) => {
  if (typeof args[0] === 'function') return originalConnect(...args);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalConnect();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isConnectRefusal(error)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
};

pool.isReadOnlySql = isReadOnlySql;
pool.shouldRetryQuery = shouldRetryQuery;

pool.getQueryMetrics = () => ({
  ...dbMetrics,
});

// A connection can drop while it is checked out (a transaction, a job lock).
// pg then emits 'error' on that client; without a listener Node exits. Keep a
// listener on every client so the drop surfaces as a failed query instead.
pool.on('connect', (client) => {
  client.on('error', (err) => {
    if (isTransientIdleClientDrop(err)) return;
    console.error('[DB] PostgreSQL connection error:', err.message || err);
  });
});

pool.on('error', (err) => {
  if (isTransientIdleClientDrop(err)) {
    return;
  }

  if (shouldLogIdleClientStack) {
    console.error('[DB] Unexpected error on idle PostgreSQL client', err);
    return;
  }

  console.error('[DB] Unexpected error on idle PostgreSQL client:', err.message || err);
});

module.exports = pool;
