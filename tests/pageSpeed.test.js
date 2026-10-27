const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

// config/db.js with pg's Pool swapped for one that records each query it runs.
function loadDbWithFakePool(runQuery) {
  const pgPath = require.resolve("pg");
  const dbPath = path.join(__dirname, "..", "config", "db.js");
  const saved = require.cache[pgPath];
  class FakePool {
    constructor(options) { this.options = options; this.ran = []; }
    query(...args) { this.ran.push(args[0]); return runQuery(...args); }
    connect() { return Promise.resolve({}); }
    on() { return this; }
  }
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
  delete require.cache[dbPath];
  try {
    return require(dbPath);
  } finally {
    delete require.cache[dbPath];
    if (saved) require.cache[pgPath] = saved; else delete require.cache[pgPath];
  }
}

test("a schema statement runs once per process, even when asked for twice at once", async () => {
  const db = loadDbWithFakePool(async () => ({ rows: [] }));
  const ddl = "ALTER TABLE classes ADD COLUMN IF NOT EXISTS x INT";
  await Promise.all([db.query(ddl), db.query(ddl)]);
  await db.query(ddl);
  await db.query("CREATE TABLE IF NOT EXISTS t (id INT)");
  await db.query("CREATE TABLE IF NOT EXISTS t (id INT)");
  assert.deepStrictEqual(db.ran, [ddl, "CREATE TABLE IF NOT EXISTS t (id INT)"]);
});

test("a failed schema statement is tried again next time", async () => {
  let fail = true;
  const db = loadDbWithFakePool(async () => {
    if (fail) { fail = false; throw new Error("lock timeout"); }
    return { rows: [] };
  });
  const ddl = "CREATE INDEX IF NOT EXISTS idx ON t (id)";
  await assert.rejects(db.query(ddl));
  await db.query(ddl);
  await db.query(ddl);
  assert.strictEqual(db.ran.length, 2);
});

test("ordinary queries and queries with values always run", async () => {
  const db = loadDbWithFakePool(async () => ({ rows: [] }));
  await db.query("SELECT 1");
  await db.query("SELECT 1");
  await db.query("ALTER TABLE t ADD COLUMN IF NOT EXISTS y INT", [1]);
  await db.query("ALTER TABLE t ADD COLUMN IF NOT EXISTS y INT", [1]);
  assert.strictEqual(db.ran.length, 4);
});

test("an anonymous visitor's session is left untouched", async () => {
  const setAllowedFeatures = require("../middleware/setAllowedFeatures");
  const session = {};
  const res = { locals: {} };
  await new Promise((resolve) => setAllowedFeatures({ session }, res, resolve));
  assert.deepStrictEqual(session, {}, "writing to the session makes express-session store it");
  assert.deepStrictEqual(res.locals.allowedFeatures, []);

  const leftover = { allowedFeatures: ["Finance"] };
  await new Promise((resolve) => setAllowedFeatures({ session: leftover }, { locals: {} }, resolve));
  assert.deepStrictEqual(leftover.allowedFeatures, [], "features from an ended sign-in are cleared");
});
