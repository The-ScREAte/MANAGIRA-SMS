const { Pool } = require('pg');
require('dotenv').config();

const dbConnectionString = process.env.DB_CONNECTION_STRING;

const shouldUseSsl =
  process.env.DB_SSL === 'true' ||
  (dbConnectionString || '').includes('sslmode=require');
const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || 800);

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
  max: parseInt(process.env.DB_POOL_MAX || '15', 10),  // bumped: auth+permission+session mw each use a connection
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

pool.query = async (...args) => {
  const startedAt = process.hrtime.bigint();
  try {
    return await originalQuery(...args);
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbMetrics.totalQueries += 1;

    if (elapsedMs >= slowQueryThresholdMs) {
      dbMetrics.slowQueries += 1;
      const queryInput = args[0];
      const sqlText = typeof queryInput === 'string'
        ? queryInput
        : (queryInput && typeof queryInput.text === 'string' ? queryInput.text : '[unknown query]');
      const compactSql = sqlText.replace(/\s+/g, ' ').trim().slice(0, 240);
      console.warn(`[DB][SLOW] ${elapsedMs.toFixed(1)}ms ${compactSql}`);
    }
  }
};

pool.getQueryMetrics = () => ({
  ...dbMetrics,
});

pool.on('connect', () => {
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle PostgreSQL client', err.message || err);
});

module.exports = pool;
