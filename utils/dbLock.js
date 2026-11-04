// Postgres advisory locks for "only one runs at a time" work (scheduled jobs,
// billing). A session lock belongs to the connection that took it, so the lock
// and the unlock must run on the same client — never through pool.query, which
// may hand the unlock to a different connection and leave the lock stuck.

function lockSql(key, fn) {
  return typeof key === "number" ? `SELECT ${fn}($1) AS ok` : `SELECT ${fn}(hashtext($1)) AS ok`;
}

// Returns a release function, or null when another process holds the lock.
async function tryAdvisoryLock(key, database) {
  const db = database || require("../config/db"); // looked up per call so tests can swap it
  const client = await db.connect();
  try {
    const { rows } = await client.query(lockSql(key, "pg_try_advisory_lock"), [key]);
    if (!rows[0] || rows[0].ok !== true) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return async function release() {
    if (released) return;
    released = true;
    try {
      await client.query(lockSql(key, "pg_advisory_unlock"), [key]);
      client.release();
    } catch (_) {
      // Drop the connection; Postgres frees its locks when it closes.
      client.release(true);
    }
  };
}

// Runs task only if the lock is free. Returns { ran: false } when skipped.
async function withAdvisoryLock(key, task) {
  const release = await tryAdvisoryLock(key);
  if (!release) return { ran: false };
  try {
    return { ran: true, result: await task() };
  } finally {
    await release();
  }
}

// Runs task once the lock is free, waiting its turn; fails if it stays taken.
async function waitForAdvisoryLock(key, task, { database, timeoutMs = 60000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = await tryAdvisoryLock(key, database);
    if (release) {
      try {
        return await task();
      } finally {
        await release();
      }
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${key}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// Scheduled jobs hold their locks on one connection of their own, so eight or nine
// jobs starting at the top of the hour don't use up the pool. Every step has a time
// limit: a connection that stops answering is dropped and replaced.
const LOCK_STEP_MS = 5000;
const SLOW_JOB_MS = Number(process.env.SLOW_JOB_MS) || 10 * 60 * 1000;
let jobLockClient = null;

function getJobLockClient() {
  if (jobLockClient) return jobLockClient;
  const { Client } = require("pg");
  const { options } = require("../config/db");
  const client = new Client({
    connectionString: options.connectionString,
    ssl: options.ssl,
    connectionTimeoutMillis: 6000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    application_name: "managira-job-locks",
  });
  const connecting = client.connect().then(() => client);
  connecting.client = client;
  jobLockClient = connecting;
  const forget = () => { if (jobLockClient === connecting) jobLockClient = null; };
  client.on("error", forget);
  client.on("end", forget);
  connecting.catch(forget);
  return connecting;
}

// Closing the connection frees every lock it held, even if a query is stuck.
function dropJobLockClient(client) {
  if (jobLockClient && jobLockClient.client === client) jobLockClient = null;
  Promise.resolve().then(() => client.end()).catch(() => {});
}

function withTimeout(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// One connection can take the same lock twice, so this process also tracks its own jobs.
const runningJobs = new Set();

async function withJobLock(name, task, { getClient = getJobLockClient, stepMs = LOCK_STEP_MS } = {}) {
  if (runningJobs.has(name)) return { ran: false };
  runningJobs.add(name);
  const slowWarning = setTimeout(
    () => console.warn(`[Scheduler] ${name} has run for over ${Math.round(SLOW_JOB_MS / 60000)} minutes`),
    SLOW_JOB_MS
  );
  slowWarning.unref();
  try {
    const client = await getClient();
    let locked;
    try {
      const { rows } = await withTimeout(
        client.query(lockSql(name, "pg_try_advisory_lock"), [name]), stepMs, "Taking the job lock"
      );
      locked = Boolean(rows[0] && rows[0].ok === true);
    } catch (error) {
      dropJobLockClient(client);
      throw error;
    }
    if (!locked) return { ran: false };
    try {
      return { ran: true, result: await task() };
    } finally {
      await withTimeout(
        client.query(lockSql(name, "pg_advisory_unlock"), [name]), stepMs, "Releasing the job lock"
      ).catch(() => dropJobLockClient(client));
    }
  } finally {
    clearTimeout(slowWarning);
    runningJobs.delete(name);
  }
}

const runningJobCount = () => runningJobs.size;

module.exports = { tryAdvisoryLock, withAdvisoryLock, waitForAdvisoryLock, withJobLock, runningJobCount };
