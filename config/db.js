const { Pool } = require('pg');
const { countQuery } = require('../utils/requestStats');
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

// Development connected to the hosted database changes real schools' data.
if (process.env.NODE_ENV !== 'production' && /\.render\.com/i.test(dbConnectionString || '')) {
  console.warn('[DB] ⚠️ This is not production, but DB_CONNECTION_STRING points at the hosted database. Table changes and tests here affect real schools. Use a local or staging database for development.');
}

const pool = new Pool({
  connectionString: dbConnectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  // The limit that matters on this database is memory, not its 103 connections
  // allowed: it has 64 MB of shared buffers and every open connection takes more.
  // Mira's pool (mira/config/db.js) and any worker share the same database.
  // On a developer's computer the same database is shared with the live site,
  // so local runs stay small unless DB_POOL_MAX says otherwise.
  max: parseInt(process.env.DB_POOL_MAX || (process.env.NODE_ENV === 'production' ? '15' : '5'), 10),
  // Keep a few connections open between visits: opening one costs a TLS
  // handshake, which made the first page after a quiet spell noticeably slow.
  // Only connections above this number close when idle, after a minute: each
  // reopen costs the database a login, and it logged login timeouts under load.
  // One dashboard asks for about eight things at once, so that's how many stay open: with
  // only three, the first page after a quiet minute waited seconds for the logins.
  min: parseInt(process.env.DB_POOL_MIN || (process.env.NODE_ENV === 'production' ? '8' : '1'), 10),
  idleTimeoutMillis: 300000,
  // Idle connections don't keep a script alive; the server stays up anyway.
  allowExitOnIdle: true,
  connectionTimeoutMillis: 6000,
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
const RETRY_DELAYS_MS = [300, 1000, 2500, 4500];

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
    code === '08004' || // the server refused the connection (Render: "service temporarily unavailable")
    code === '08001' || // couldn't establish the connection
    code === '53300' || // too many connections
    message.includes('service temporarily unavailable') ||
    message.includes('too many connections') ||
    message.includes('remaining connection slots are reserved') ||
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

// Session saves (connect-pg-simple) write the same row with the same values,
// so repeating one after a dropped connection is harmless.
const isSessionStoreSql = (sql) => /\buser_sessions\b/i.test(String(sql || ''));

function shouldRetryQuery(error, args) {
  if (isConnectRefusal(error)) return true;
  const sql = sqlTextOf(args);
  return isTransientIdleClientDrop(error) && (isReadOnlySql(sql) || isSessionStoreSql(sql));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Nobody waits long for an answer that isn't coming: during an outage, waiting
// requests would otherwise pile up in memory for nearly a minute each.
const MAX_DB_WAIT_MS = Number(process.env.DB_MAX_WAIT_MS) || 15000;
const canRetryAgain = (attempt, startedAt) => attempt < RETRY_DELAYS_MS.length
  && Date.now() - startedAt + RETRY_DELAYS_MS[attempt] < MAX_DB_WAIT_MS;

async function queryWithRetry(args) {
  // Callback-style calls are passed straight through (no retry).
  if (typeof args[args.length - 1] === 'function') return originalQuery(...args);
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalQuery(...args);
    } catch (error) {
      if (!canRetryAgain(attempt, startedAt) || !shouldRetryQuery(error, args)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Pages keep their tables up to date as they load (CREATE TABLE/INDEX IF NOT
// EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, DO blocks). Once one of
// these has succeeded in this process, running it again changes nothing, yet
// ALTER TABLE still takes the table's strongest lock: it waits for any slow
// query on that table and every other query then queues behind it. So each
// statement runs once per process; repeats (and concurrent copies) share it.
const SCHEMA_SQL = /^\s*(create\s+(unique\s+)?index\s+(concurrently\s+)?if\s+not\s+exists|create\s+(table|sequence|extension)\s+if\s+not\s+exists|alter\s+table\b|do\s+\$)/i;
const schemaRuns = new Map();

function runSchemaOnce(args) {
  const sql = typeof args[0] === 'string' ? args[0] : '';
  const hasValues = args.length > 1 && typeof args[1] !== 'function' && !(Array.isArray(args[1]) && args[1].length === 0);
  if (!sql || hasValues || typeof args[args.length - 1] === 'function' || !SCHEMA_SQL.test(sql)) return null;
  let run = schemaRuns.get(sql);
  if (!run) {
    run = queryWithRetry(args).catch((error) => {
      schemaRuns.delete(sql);
      throw error;
    });
    schemaRuns.set(sql, run);
  }
  return run;
}

pool.query = async (...args) => {
  const schemaRun = runSchemaOnce(args);
  if (schemaRun) return schemaRun;
  const startedAt = process.hrtime.bigint();
  try {
    return await queryWithRetry(args);
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbMetrics.totalQueries += 1;
    countQuery(elapsedMs);

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
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalConnect();
    } catch (error) {
      if (!canRetryAgain(attempt, startedAt) || !isConnectRefusal(error)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
};

pool.isReadOnlySql = isReadOnlySql;
pool.shouldRetryQuery = shouldRetryQuery;
pool.isConnectRefusal = isConnectRefusal;

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
