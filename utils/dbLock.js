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

module.exports = { tryAdvisoryLock, withAdvisoryLock, waitForAdvisoryLock };
