const { Pool } = require('pg');
const { countQuery, requestMemo, store: requestStore, openedTransaction } = require('../utils/requestStats');
const stableReads = require('../utils/stableReads');
const sqlScan = require('../utils/sqlScan');
require('dotenv').config();

const dbConnectionString = process.env.DB_CONNECTION_STRING;
const shouldLogSlowQueries = String(process.env.LOG_SLOW_DB_QUERIES || '').trim().toLowerCase() === 'true';

// Pool settings come from the environment, each with the value live has always used.
//   DB_POOL_MAX / DB_POOL_MIN   connections per server (see docs/SCALING.md for sizing)
//   DB_IDLE_TIMEOUT_MS          a connection above the minimum closes after this long idle
//   DB_STATEMENT_TIMEOUT_MS     a query running longer is cancelled (0 = no limit)
//   DB_IDLE_IN_TX_TIMEOUT_MS    a transaction left open and silent this long is ended, so a request
//                               that forgot to finish one can't hold a connection forever (0 = off)
//   DB_CONNECT_TIMEOUT_MS       how long a request waits for a free connection
//   DB_MAX_USES                 close a connection after this many uses (0 = never)
//   DB_PGBOUNCER=on             the URL goes through PgBouncer in transaction mode: the two timeouts
//                               aren't sent as connection settings (set them on the database role
//                               instead); see docs/SCALING.md
const envInt = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const clusterWorkers = Math.max(1, parseInt(process.env.CLUSTER_WORKERS, 10) || 1);
const behindPgBouncer = String(process.env.DB_PGBOUNCER || '').trim().toLowerCase() === 'on';

const shouldUseSsl =
  process.env.DB_SSL === 'true' ||
  (dbConnectionString || '').includes('sslmode=require');
const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || 800);
const shouldLogIdleClientStack = String(process.env.DB_LOG_IDLE_CLIENT_STACK || '').trim().toLowerCase() === 'true';

// A connection the database (or the network between) has closed: the next write to it fails with
// EPIPE or ECONNRESET, or pg says it was terminated. Nothing is wrong with the person's request.
const DROP_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ENETUNREACH', 'EHOSTUNREACH',
  '57P01', '57P02', '57P05', '08000', '08003', '08006']);
const DROP_MESSAGE = /etimedout|econnreset|epipe|econnaborted|broken pipe|socket hang up|connection terminated|terminating connection|server closed the connection|connection reset by peer|connection error and is not queryable|client has encountered a connection error|connection ended unexpectedly|cannot use a pool after calling end/i;

function isTransientIdleClientDrop(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '').toUpperCase();
  return DROP_CODES.has(code) || DROP_MESSAGE.test(message);
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
  console.warn('[DB] Development is using the hosted database.');
}

const dbSslModule = require('../utils/dbSsl');
const dbSsl = dbSslModule.dbSslSettings(dbConnectionString);
const pool = new Pool({
  connectionString: shouldUseSsl ? dbSsl.connectionString : dbConnectionString,
  ssl: shouldUseSsl ? dbSsl.ssl : false,
  // The limit that matters on this database is memory, not its 103 connections
  // allowed: it has 64 MB of shared buffers and every open connection takes more.
  // Mira's pool (mira/config/db.js) and any worker share the same database.
  // On a developer's computer the same database is shared with the live site,
  // so local runs stay small unless DB_POOL_MAX says otherwise.
  // With WEB_CONCURRENCY workers the number is the whole server's, shared out between them.
  max: Math.max(clusterWorkers > 1 ? 4 : 1, Math.ceil(parseInt(process.env.DB_POOL_MAX || (process.env.NODE_ENV === 'production' ? '15' : '5'), 10) / clusterWorkers)),
  // Keep a few connections open between visits: opening one costs a TLS
  // handshake, which made the first page after a quiet spell noticeably slow.
  // Only connections above this number close when idle, after a minute: each
  // reopen costs the database a login, and it logged login timeouts under load.
  // One dashboard asks for about eight things at once, so that's how many stay open: with
  // only three, the first page after a quiet minute waited seconds for the logins.
  min: Math.ceil(parseInt(process.env.DB_POOL_MIN || (process.env.NODE_ENV === 'production' ? '8' : '1'), 10) / clusterWorkers),
  idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 300000),
  // Idle connections don't keep a script alive; the server stays up anyway.
  allowExitOnIdle: true,
  connectionTimeoutMillis: envInt('DB_CONNECT_TIMEOUT_MS', 6000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Kill any query that hangs for more than 30 s so a stalled query never
  // blocks the pool and makes the entire app appear to hang.
  ...(behindPgBouncer ? {} : {
    statement_timeout: envInt('DB_STATEMENT_TIMEOUT_MS', 30000) || undefined,
    // A transaction a request opened and then went quiet on (an error path that never finished
    // it) is ended by the database instead of holding a connection forever.
    idle_in_transaction_session_timeout: envInt('DB_IDLE_IN_TX_TIMEOUT_MS', 0) || undefined,
  }),
  // Shows in pg_stat_activity, so a busy database says which servers hold its connections.
  application_name: process.env.DB_APP_NAME || 'managira-web',
  ...(envInt('DB_MAX_USES', 0) ? { maxUses: envInt('DB_MAX_USES', 0) } : {}),
});

const dbMetrics = {
  totalQueries: 0,
  slowQueries: 0,
};

const originalQuery = pool.query.bind(pool);
// For the app's own bookkeeping queries, which must not pass the wrappers below.
const rawQuery = (sql, values) => originalQuery(sql, values);

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

// One statement that only reads: SELECT / WITH / SHOW, with no data-changing CTE, no row lock, no
// sequence, advisory lock or function of this app that writes (utils/sqlScan.js reads the text word
// by word, after comments, strings and quoted names are taken apart, so none of them can hide a word).
function isReadOnlySql(sql) {
  return sqlScan.isReadOnly(sql);
}

// A failure that came out of the database (a query, or borrowing a connection), as opposed to any other
// error of the same kind (ECONNRESET from a payment provider's API, say): the error pages use it.
function tagDbError(error) {
  if (error && typeof error === 'object') {
    try { Object.defineProperty(error, 'fromDatabase', { value: true, configurable: true, writable: true, enumerable: false }); } catch (_) { /* frozen */ }
  }
  return error;
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
// so repeating one after a dropped connection is harmless. Only a single plain statement on that
// table counts: one that also touches any other table (a CTE, a join, a subquery) is not one of them.
function isSessionStoreSql(sql) {
  const text = sqlScan.strip(sql).toLowerCase();
  if (/;\s*\S/.test(text) || !/^\s*(select|insert|update|delete)\b/.test(text)) return false;
  const targets = [...text.matchAll(/\b(?:from|join|into|(?<!\bdo\s+)update)\s+([a-z_][a-z0-9_.]*)/g)].map((match) => match[1]);
  return targets.length > 0 && targets.every((name) => name === 'user_sessions' || name === 'public.user_sessions');
}

// "Not queryable": pg refused to send anything on a connection it already knew was broken (or that was
// closed), and "connection terminated due to connection timeout" is a connection that never opened, so
// any statement is safe to run again on a fresh one.
const NEVER_SENT = /not queryable|connection terminated due to connection timeout/i;

function shouldRetryQuery(error, args) {
  if (isConnectRefusal(error)) return true;
  if (NEVER_SENT.test(String(error?.message || ''))) return true;
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
  let certificateRetries = 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalQuery(...args);
    } catch (error) {
      tagDbError(error);
      // A certificate that can't be verified, on an address where the check was only automatic: carry on
      // unchecked (the connection never opened, so nothing was sent; twice at most).
      if (certificateRetries < 2 && dbSslModule.fallBack(pool, dbSsl, error)) { certificateRetries += 1; attempt -= 1; continue; }
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
    // Once it has run it may have added columns or backfilled rows: what was kept goes (utils/stableReads.js).
    run = queryWithRetry(args).then((result) => { stableReads.schemaApplied(); return result; }, (error) => {
      schemaRuns.delete(sql);
      throw error;
    });
    schemaRuns.set(sql, run);
  }
  return run;
}

// Managira's own settings and price tables change only from the admin pages, yet one page load
// can read the same row several times (Settings read app_settings 12 times). Within a request a
// read is asked once; any write to these tables forgets them. Callers get their own copies.
const MEMO_TABLES = new Set(['app_settings', 'pricing_regions', 'pricing_region_countries', 'plan_region_prices', 'dynamic_billing_cycles']);
const tablesIn = (sql) => [...sql.matchAll(/\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase());
function memoized(args) {
  const sql = sqlTextOf(args);
  if (!sql || typeof args[args.length - 1] === 'function' || (args[0] && typeof args[0] === 'object')) return null;
  const memo = requestMemo();
  if (!memo || memo.off) return null;
  const tables = tablesIn(sql);
  if (!tables.some((name) => MEMO_TABLES.has(name))) return null;
  if (!/^\s*select\b/i.test(sql) || /\bfor\s+(update|share)\b/i.test(sql) || !tables.every((name) => MEMO_TABLES.has(name))) {
    memo.clear(); // a write (or a mixed read) on these tables: later reads ask again
    return null;
  }
  const key = sql + '\u0000' + JSON.stringify(args[1] || []);
  if (!memo.has(key)) {
    const startedAt = process.hrtime.bigint();
    const counted = () => { dbMetrics.totalQueries += 1; countQuery(Number(process.hrtime.bigint() - startedAt) / 1e6); };
    // Across requests too, when the statement only reads tables whose answers a school may keep for a few seconds
    // (utils/stableReads.js: the platform settings and price lists; the billing cycles are never kept).
    const scope = requestStore();
    const kept = scope && scope.schoolId ? stableReads.read(args, () => queryWithRetry(args), scope) : null;
    memo.set(key, (kept || queryWithRetry(args)).then((result) => { counted(); return result; }, (error) => { counted(); memo.delete(key); throw error; }));
  }
  return memo.get(key).then((result) => ({ ...result, rows: result.rows.map((row) => ({ ...row })) }));
}

pool.query = async (...args) => {
  const sql = sqlTextOf(args);
  // A "create ... if not exists" / "alter table" that pages repeat on every request is run once per process (below):
  // asking again is answered from that run and changes nothing, so it must not mark the schema as changed
  // (that dropped every kept answer and re-read the catalogs on each such page load).
  const schemaRun = runSchemaOnce(args);
  if (schemaRun) return schemaRun;
  stableReads.noteSchemaChange(sql);
  const remembered = memoized(args);
  if (remembered) return remembered;
  const scope = requestStore();
  if (scope && scope.schoolId) stableReads.refreshKnown(rawQuery); // the list of tables, for deciding what may be kept
  const schemaFact = stableReads.readSchema(args, () => timedQuery(args));
  if (schemaFact) return schemaFact;
  // Settings and other lookups every page repeats are kept for a few seconds per school.
  const shared = stableReads.read(args, () => timedQuery(args), scope);
  if (shared) return shared;
  // A save that changed something clears the kept answers of the tables it touched, as soon as it has finished
  // (also when it failed: a dropped connection can leave a write that did commit).
  if (typeof args[args.length - 1] === 'function') {
    const done = args[args.length - 1];
    return timedQuery([...args.slice(0, -1), (error, result) => { stableReads.noteWrite(sql, scope, error ? null : result); done(error, result); }]);
  }
  let result;
  try {
    result = await timedQuery(args);
  } catch (error) {
    stableReads.noteWrite(sql, scope, null);
    throw error;
  }
  stableReads.noteWrite(sql, scope, result);
  return result;
};

async function timedQuery(args) {
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
}

// Borrowing a connection for a transaction: when the database refuses it
// (restarting), nothing has run yet, so wait briefly and try again.
// Nothing run on a borrowed connection is ever retried by this file: a statement inside a transaction
// that fails stays failed, and the caller rolls back.
const originalConnect = pool.connect.bind(pool);
const PING_AFTER_MS = envInt('DB_PING_IDLE_MS', 5000);
const PING_TIMEOUT_MS = envInt('DB_PING_TIMEOUT_MS', 3000) || 3000;

// A connection that sat unused may be half closed (the network dropped it without a word): a ping that
// gets no answer in a few seconds counts as dead, rather than holding the request for minutes.
function pingAlive(client) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    const answered = (alive) => { clearTimeout(timer); resolve(alive); };
    try { client.query('SELECT 1').then(() => answered(true), () => answered(false)); } catch (_) { answered(false); }
  });
}

// Writes made on a borrowed connection don't pass pool.query. Their tables are noted as they are sent and
// the answers kept for them go as soon as the transaction ends, or when the connection is handed back.
function flushWrites(client) {
  const state = client.__writes;
  if (!state || !(state.tables.size || state.broad)) return;
  const { tables, broad, scope } = state;
  state.tables = new Set();
  state.broad = false;
  stableReads.bump(tables, scope, broad);
}

function trackWrites(client) {
  if (!client.__tracked) {
    client.__tracked = true;
    const original = client.query;
    client.query = function trackedQuery(...args) {
      const state = client.__writes;
      if (!state) return original.apply(this, args);
      const sql = sqlTextOf(args);
      if (sql) {
        const info = stableReads.statementInfo(sql);
        if (info.ddl) stableReads.noteSchemaChange(sql);
        if (info.write) {
          for (const name of info.affected) state.tables.add(name);
          if (info.broad) state.broad = true;
          if (info.first === 'begin' || info.first === 'start') state.inTx = true;
          else if (info.first === 'commit' || info.first === 'end' || info.first === 'rollback' || info.first === 'abort') state.inTx = false;
        }
      }
      const returned = original.apply(this, args);
      if (returned && typeof returned.then === 'function') {
        const after = () => { if (!state.inTx) flushWrites(client); };
        returned.then(after, (error) => { tagDbError(error); after(); });
      }
      return returned;
    };
  }
  client.__writes = { scope: requestStore(), tables: new Set(), broad: false, inTx: false };
}

pool.on('release', (error, client) => {
  try { flushWrites(client); } catch (_) { /* never matters here */ }
  client.__writes = null;
  client.__idleSince = Date.now();
});

pool.connect = async (...args) => {
  if (typeof args[0] === 'function') return originalConnect(...args);
  // A transaction's writes don't pass pool.query: from here this request reads fresh.
  const memo = requestMemo();
  if (memo) { memo.clear(); memo.off = true; }
  openedTransaction();
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      const client = await originalConnect();
      // A connection that sat unused may have been closed by the database or the network without
      // anyone being told yet: the first statement on it would fail. Check it before a transaction
      // starts (nothing is open yet, so choosing another is safe), and throw it away if it is dead.
      if (client.__idleSince && Date.now() - client.__idleSince > PING_AFTER_MS && attempt < 3) {
        if (!(await pingAlive(client))) {
          client.release(true);
          continue;
        }
      }
      trackWrites(client);
      return client;
    } catch (error) {
      tagDbError(error);
      if (!canRetryAgain(attempt, startedAt) || !isConnectRefusal(error)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
};

pool.isReadOnlySql = isReadOnlySql;
pool.shouldRetryQuery = shouldRetryQuery;
pool.isConnectRefusal = isConnectRefusal;
pool.isConnectionDrop = isTransientIdleClientDrop;

pool.getQueryMetrics = () => ({
  ...dbMetrics,
});

// A connection can drop while it is checked out (a transaction, a job lock).
// pg then emits 'error' on that client; without a listener Node exits. Keep a
// listener on every client so the drop surfaces as a failed query instead.
const describeError = (err) => String((err && err.message) || err);
pool.on('connect', (client) => {
  client.on('error', (err) => {
    try {
      if (isTransientIdleClientDrop(err)) return;
      console.error('[DB] PostgreSQL connection error:', describeError(err));
    } catch (_) { /* a listener must never throw: Node would end the process */ }
  });
});

pool.on('error', (err) => {
  try {
    if (isTransientIdleClientDrop(err)) {
      return;
    }

    if (shouldLogIdleClientStack) {
      console.error('[DB] Unexpected error on idle PostgreSQL client', err);
      return;
    }

    console.error('[DB] Unexpected error on idle PostgreSQL client:', describeError(err));
  } catch (_) { /* a listener must never throw: Node would end the process */ }
});

// A quiet warning when requests keep waiting for a connection: the sign that this server needs
// a bigger DB_POOL_MAX, a slow query is holding connections, or it's time for another server.
const poolWatch = { streakMs: 0, peakWaiting: 0, warnings: 0, lastWarnAt: 0 };
const POOL_SAMPLE_MS = 2000;
const POOL_WARN_AFTER_MS = envInt('DB_POOL_WARN_AFTER_MS', 10000);
pool.getPoolStats = () => ({
  max: pool.options.max,
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
  peakWaiting: poolWatch.peakWaiting,
  warnings: poolWatch.warnings,
  ...pool.getQueryMetrics(),
});
const poolTimer = setInterval(() => {
  const waiting = pool.waitingCount;
  if (waiting > poolWatch.peakWaiting) poolWatch.peakWaiting = waiting;
  poolWatch.streakMs = waiting > 0 ? poolWatch.streakMs + POOL_SAMPLE_MS : 0;
  if (poolWatch.streakMs >= POOL_WARN_AFTER_MS && Date.now() - poolWatch.lastWarnAt > 60000) {
    poolWatch.lastWarnAt = Date.now();
    poolWatch.warnings += 1;
    console.warn(`[DB][POOL] ${waiting} request(s) have waited for a connection for ${Math.round(poolWatch.streakMs / 1000)}s (in use ${pool.totalCount - pool.idleCount}/${pool.options.max}). Raise DB_POOL_MAX, find the slow query, or add a server.`);
  }
}, POOL_SAMPLE_MS);
poolTimer.unref();

module.exports = pool;
