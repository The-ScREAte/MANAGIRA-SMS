const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Safety of the kept lookups (utils/stableReads.js), of the retry rules and the pool (config/db.js).
// Needs the local database: DB_CONNECTION_STRING=postgres://postgres@127.0.0.1:55432/postgres DB_SSL=false
process.env.DB_APP_NAME = "stable-safety-test";
const { Client } = require("pg");
const db = require("../config/db");
const reads = require("../utils/stableReads");
const sqlScan = require("../utils/sqlScan");
const requestStats = require("../utils/requestStats");
const shortCache = require("../utils/shortCache");

const LOCAL = /127\.0\.0\.1:55432|localhost:55432/.test(process.env.DB_CONNECTION_STRING || "");
const needsDb = { skip: LOCAL ? false : "needs the local test database (DB_CONNECTION_STRING on :55432)" };

let admin;
const inRequest = (school, fn) => new Promise((resolve, reject) => {
  requestStats.requestStats({ method: "GET", originalUrl: "/probe" }, { on() {} }, () => {
    requestStats.setSchool(school);
    Promise.resolve().then(fn).then(resolve, reject);
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const A = 1; // zz_sr_a row id used by the tests
const readV = async (id = A) => (await db.query("SELECT v FROM zz_sr_a WHERE id = $1", [id])).rows[0]?.v;
const outside = (sql, values) => admin.query(sql, values); // a change the app's pool never sees
// The unit tests above replace the table list with made-up names: the database tests read the real one first.
const ready = async () => { await reads.load((sql) => admin.query(sql)); };

test.before(async () => {
  if (!LOCAL) return;
  admin = new Client({ connectionString: process.env.DB_CONNECTION_STRING, application_name: "stable-safety-admin" });
  await admin.connect();
  await admin.query(`
    DROP TABLE IF EXISTS zz_sr_setnull, zz_sr_child, zz_sr_parent, zz_sr_a, zz_sr_unlisted, zz_sr_once;
    CREATE TABLE zz_sr_a (id int PRIMARY KEY, v text);
    CREATE TABLE zz_sr_parent (id int PRIMARY KEY);
    CREATE TABLE zz_sr_child (id int PRIMARY KEY, parent_id int REFERENCES zz_sr_parent(id) ON DELETE CASCADE, v text);
    CREATE TABLE zz_sr_setnull (id int PRIMARY KEY, parent_id int REFERENCES zz_sr_parent(id) ON DELETE SET NULL);
    CREATE TABLE zz_sr_unlisted (id int PRIMARY KEY, v text);
    CREATE TABLE zz_sr_once (id serial PRIMARY KEY, v text);
    INSERT INTO zz_sr_a VALUES (1, 'one'), (2, 'two');
    INSERT INTO zz_sr_parent VALUES (1);
    INSERT INTO zz_sr_child VALUES (1, 1, 'kid');
    INSERT INTO zz_sr_setnull VALUES (1, 1);
    INSERT INTO zz_sr_unlisted VALUES (1, 'u');`);
  for (const name of ["zz_sr_a", "zz_sr_child", "zz_sr_setnull"]) reads.STABLE_TABLES.add(name);
  await reads.load((sql) => admin.query(sql));
});

test.after(async () => {
  if (!LOCAL) return;
  await admin.query("DROP TABLE IF EXISTS zz_sr_setnull, zz_sr_child, zz_sr_parent, zz_sr_a, zz_sr_unlisted, zz_sr_once");
  await admin.end();
  await db.end().catch(() => {});
});

// ---------- reading the statement ----------
test("the statement is read word by word: comments, strings, quoted names, case and schema names hide nothing", () => {
  reads._setKnown(["students", "terms", "fees", "organizations", "student_subjects_in_term"], { functions: ["student_subjects_in_term"] });
  const keep = (sql) => reads._keepable(sql);
  assert.equal(keep("SELECT * FROM students WHERE organization_id = $1"), true);
  assert.equal(keep('SELECT * FROM "students" s'), true);
  assert.equal(keep("SELECT * FROM public.students"), true);
  assert.equal(keep("select * from STUDENTS"), true);
  assert.equal(keep("/* a block comment */ SELECT * FROM students"), true);
  assert.equal(keep("-- a line comment\nSELECT * FROM students"), true);
  assert.equal(keep("SELECT updated_at, deleted_at FROM students"), true, "a column called updated_at is not an UPDATE");
  // the old text scan took everything after a '--' INSIDE a string for a comment and so lost the join
  assert.equal(keep("SELECT '--' AS dashes, s.* FROM students s JOIN fees f ON f.student_id = s.student_id"), false);
  assert.equal(keep("SELECT * FROM students s, /* c */ fees f"), false);
  assert.equal(keep('SELECT * FROM students s JOIN "Fees" f ON true'), false, "a quoted name of another case is still the table");
  assert.equal(keep("SELECT * FROM students WHERE note = 'it''s' AND id IN (SELECT id FROM fees)"), false);
  assert.equal(keep("SELECT * FROM students WHERE note = E'it\\'s' AND id IN (SELECT id FROM fees)"), false);
  assert.equal(keep("SELECT * FROM students WHERE note = $q$ -- $q$ AND id IN (SELECT id FROM fees)"), false);
  // changes and locks inside a read, a second statement, a hidden dependency
  assert.equal(keep("WITH gone AS (DELETE FROM students WHERE student_id = $1 RETURNING *) SELECT * FROM gone"), false);
  assert.equal(keep("WITH moved AS (UPDATE students SET class_id = 1 RETURNING *) SELECT * FROM students"), false);
  assert.equal(keep("SELECT * FROM students FOR SHARE"), false);
  assert.equal(keep("SELECT * FROM students FOR NO KEY UPDATE"), false);
  assert.equal(keep("SELECT * FROM students; DELETE FROM fees"), false);
  assert.equal(keep("SELECT nextval('s'), * FROM students"), false);
  assert.equal(keep("SELECT * INTO TEMP copy FROM students"), false);
  assert.equal(keep("SELECT student_subjects_in_term(1), s.student_id FROM students s"), false, "a function that reads tables the text doesn't name");
  assert.equal(keep("SELECT * FROM students WHERE created_at > 'now'::timestamptz"), false);
  assert.equal(keep("SELECT * FROM students WHERE created_at > 'today'"), false);
  assert.equal(keep("SELECT gen_random_uuid(), student_id FROM students"), false);
  assert.equal(keep("SELECT crypt($2, password), user_id FROM students"), false, "a password in the values is never kept");
  assert.equal(keep("SELECT * FROM students WHERE owner = current_user"), false);
  assert.equal(keep("SELECT * FROM pg_stat_activity"), false);
  assert.equal(keep("SELECT * FROM students s JOIN some_view v ON true"), true, "an unknown name is ignored ... until the table list is re-read:");
  reads.noteSchemaChange("CREATE TABLE brand_new (id int)");
  assert.equal(keep("SELECT * FROM students s JOIN brand_new b ON true"), false, "nothing is kept between a create/alter/drop and the next read of the table list");
  reads._setKnown(["students", "terms", "fees", "organizations", "brand_new"]);
  assert.equal(keep("SELECT * FROM students s JOIN brand_new b ON true"), false);
});

test("a view or a materialized view is never kept, even over listed tables", async () => {
  reads._setKnown(["students", "hub_organizations_view"]);
  assert.equal(reads._keepable("SELECT * FROM hub_organizations_view"), false);
  assert.equal(reads._keepable("SELECT v.id FROM hub_organizations_view v JOIN students s ON true"), false);
});

test("what counts as 'only reads' for a retry", () => {
  const yes = ["SELECT 1", "select * from t where a = 1", "WITH x AS (SELECT 1) SELECT * FROM x", "SHOW server_version", "SELECT updated_at FROM t", "SELECT * FROM t WHERE note = 'update me'", "SELECT a FROM t;", "/* c */ SELECT 1", "-- c\nSELECT 1"];
  const no = [
    "INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "SELECT '--'; DELETE FROM t", "SELECT 'a'; UPDATE t SET a = 1",
    "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "SELECT * FROM t FOR UPDATE", "SELECT * FROM t FOR SHARE",
    "SELECT nextval('s')", "SELECT setval('s', 1)", "SELECT pg_advisory_lock(1)", "SELECT pg_try_advisory_xact_lock($1)",
    "SELECT pg_terminate_backend(1)", "SELECT pg_notify('a', 'b')", "SELECT sync_classes_to_term(1)", "SELECT cleanup_old_email_history()",
    "SELECT * INTO x FROM t", "BEGIN", "COMMIT", "DO $$ BEGIN PERFORM 1; END $$",
  ];
  for (const sql of yes) assert.equal(db.isReadOnlySql(sql), true, sql);
  for (const sql of no) assert.equal(db.isReadOnlySql(sql), false, sql);
});

// ---------- which statements are run again after a dropped connection ----------
test("a write is never run again after the connection may have carried it; a read, a refused connect and a never-sent statement are", () => {
  const drop = (message, code) => Object.assign(new Error(message), code ? { code } : {});
  const retry = (error, sql) => db.shouldRetryQuery(error, [sql]);
  for (const error of [drop("write EPIPE", "EPIPE"), drop("read ECONNRESET", "ECONNRESET"), drop("Connection terminated unexpectedly"), drop("terminating connection due to administrator command", "57P01")]) {
    assert.equal(retry(error, "SELECT * FROM t"), true, `read: ${error.message}`);
    for (const sql of ["INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "SELECT nextval('s')", "SELECT pg_advisory_lock(1)", "BEGIN; UPDATE t SET a = 1; COMMIT", "SELECT '--'; DELETE FROM t"]) {
      assert.equal(retry(error, sql), false, `${sql} after ${error.message}`);
    }
  }
  // the statement never left: pg refused before sending
  assert.equal(retry(drop("Client has encountered a connection error and is not queryable"), "INSERT INTO t VALUES (1)"), true);
  assert.equal(retry(drop("Client was closed and is not queryable"), "UPDATE t SET a = 1"), true);
  // the database refused the connection: nothing ran
  assert.equal(retry(drop("the database system is starting up", "57P03"), "INSERT INTO t VALUES (1)"), true);
  assert.equal(retry(drop("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED"), "UPDATE t SET a = 1"), true);
  // an ordinary failure is never repeated
  assert.equal(retry(drop("duplicate key value violates unique constraint", "23505"), "SELECT 1"), false);
  assert.equal(retry(drop("column x does not exist", "42703"), "SELECT x FROM t"), false);
  // after pool.end() repeating can't help
  assert.equal(retry(drop("Cannot use a pool after calling end on the pool"), "INSERT INTO t VALUES (1)"), false);
  // the session table's own statements only
  const reset = drop("read ECONNRESET", "ECONNRESET");
  assert.equal(retry(reset, 'INSERT INTO "user_sessions" (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2'), true);
  assert.equal(retry(reset, "DELETE FROM user_sessions WHERE sid = $1"), true);
  assert.equal(retry(reset, "UPDATE user_sessions SET sess = sess::jsonb || $2::jsonb WHERE sid = $1"), true);
  assert.equal(retry(reset, "WITH d AS (DELETE FROM user_sessions WHERE sid = $1) UPDATE users SET sessions = sessions + 1"), false);
  assert.equal(retry(reset, "UPDATE users SET a = 1 WHERE sid IN (SELECT sid FROM user_sessions)"), false);
  assert.equal(retry(reset, "DELETE FROM user_sessions; UPDATE users SET a = 1"), false);
  assert.equal(retry(reset, "UPDATE users SET note = 'user_sessions'"), false);
});

// ---------- the key: one school's / one person's answer is never another's ----------
test("a kept answer belongs to its school, its statement and every value it was asked with", async () => {
  reads._setKnown(["terms", "users", "user_ui_preferences"]);
  let runs = 0;
  const run = (rows) => async () => { runs += 1; return { command: "SELECT", rowCount: rows.length, rows, fields: [] }; };
  const sql = "SELECT * FROM user_ui_preferences WHERE user_id = $1";
  const a = await reads.read([sql, [101]], run([{ user_id: 101, theme: "dark" }]), { schoolId: 7001 });
  const b = await reads.read([sql, [102]], run([{ user_id: 102, theme: "light" }]), { schoolId: 7001 });
  assert.equal(a.rows[0].theme, "dark");
  assert.equal(b.rows[0].theme, "light", "another person of the same school asks for themselves");
  const again = await reads.read([sql, [101]], run([{ user_id: 101, theme: "SHOULD NOT RUN" }]), { schoolId: 7001 });
  assert.equal(again.rows[0].theme, "dark");
  const other = await reads.read([sql, [101]], run([{ user_id: 101, theme: "other school" }]), { schoolId: 7002 });
  assert.equal(other.rows[0].theme, "other school", "the same text and values in another school are not shared");
  assert.equal(runs, 3);
  // values that JSON alone would make equal
  let calls = 0;
  const count = async () => { calls += 1; return { command: "SELECT", rowCount: 1, rows: [{ n: calls }], fields: [] }; };
  const q = "SELECT * FROM terms WHERE organization_id = $1";
  const store = { schoolId: 7003 };
  for (const values of [[null], [NaN], [Infinity], [1], ["1"], [new Date("2024-01-01T00:00:00Z")], ["2024-01-01T00:00:00.000Z"], [Buffer.from("ab")], [{ type: "Buffer", data: [97, 98] }], [1n], [[1]], [["1"]]]) {
    await reads.read([q, values], count, store);
  }
  assert.equal(calls, 12, "each different value list is its own answer (and a BigInt doesn't throw)");
  assert.equal(reads.read([q, { not: "an array" }], count, store), null);
});

test("a query with no school in view, or one that opened a transaction, is never kept", () => {
  reads._setKnown(["terms"]);
  const run = async () => ({ rows: [] });
  assert.equal(reads.read(["SELECT * FROM terms", []], run, null), null);
  assert.equal(reads.read(["SELECT * FROM terms", []], run, {}), null);
  assert.equal(reads.read(["SELECT * FROM terms", []], run, { schoolId: 5, noShared: true }), null);
  assert.equal(reads.read([{ text: "SELECT * FROM terms" }], run, { schoolId: 5 }), null);
  assert.equal(reads.read(["SELECT * FROM terms", [], () => {}], run, { schoolId: 5 }), null);
});

test("an answer that was being fetched while a write happened is never kept", async () => {
  reads._setKnown(["terms"]);
  let release;
  let runs = 0;
  const slow = () => new Promise((resolve) => { runs += 1; release = () => resolve({ command: "SELECT", rowCount: 1, rows: [{ old: true }], fields: [] }); });
  const store = { schoolId: 7010 };
  const args = ["SELECT * FROM terms WHERE organization_id = $1", [7010]];
  const first = reads.read(args, slow, store);
  const joined = reads.read(args, slow, store); // asked at the same moment: shares the one lookup
  assert.equal(runs, 1);
  reads.noteWrite("UPDATE terms SET current = TRUE WHERE organization_id = $1", store, { rowCount: 1 }); // the save lands while it runs
  release();
  await first; await joined;
  await reads.read(args, async () => { runs += 1; return { command: "SELECT", rowCount: 1, rows: [{ old: false }], fields: [] }; }, store);
  assert.equal(runs, 2, "the old answer was not kept");
});

test("memory is capped by entries, by rows, by size and by total bytes", async () => {
  reads._setKnown(["terms"]);
  const store = { schoolId: 7020 };
  const q = "SELECT * FROM terms WHERE organization_id = $1";
  const rowsOf = (n, size = 10) => async () => ({ command: "SELECT", rowCount: n, rows: Array.from({ length: n }, (_, i) => ({ i, pad: "x".repeat(size) })), fields: [] });
  let ran = 0;
  const counted = (fn) => async () => { ran += 1; return fn(); };
  await reads.read([q, ["many"]], counted(rowsOf(301)), store);
  await reads.read([q, ["many"]], counted(rowsOf(301)), store);
  assert.equal(ran, 2, "more than 300 rows: not kept");
  ran = 0;
  await reads.read([q, ["wide"]], counted(rowsOf(2, 400 * 1024)), store);
  await reads.read([q, ["wide"]], counted(rowsOf(2, 400 * 1024)), store);
  assert.equal(ran, 2, "more than half a megabyte: not kept");
  for (let i = 0; i < 400; i += 1) await reads.read([q, ["fill", i]], rowsOf(3, 60 * 1024), store); // ~360 KB each as text in memory, ~140 MB offered
  const after = reads._keptSize();
  assert.ok(after.bytes <= 48 * 1024 * 1024, `bytes stay under the budget (${after.bytes})`);
  assert.ok(after.bytes > 1024 * 1024, "and answers of that size are kept");
  for (let i = 0; i < 6000; i += 1) await reads.read([q, ["tiny", i]], rowsOf(1), store);
  assert.ok(reads._keptSize().entries <= 5000, "entries are capped");
});

test("the kept copy cannot be changed by a caller, and keeps dates and bytes", async () => {
  reads._setKnown(["terms"]);
  const store = { schoolId: 7030 };
  const args = ["SELECT * FROM terms WHERE organization_id = $1", [7030]];
  const when = new Date("2025-02-03T04:05:06Z");
  const run = async () => ({ command: "SELECT", rowCount: 1, rows: [{ when, bytes: Buffer.from("hi"), list: [1, { a: 1 }] }], fields: [] });
  const first = await reads.read(args, run, store);
  first.rows[0].list[1].a = 99; first.rows[0].list.push(7); first.rows[0].extra = true; first.rows.push({});
  const second = await reads.read(args, run, store);
  assert.deepEqual(second.rows[0].list, [1, { a: 1 }]);
  assert.equal(second.rows.length, 1);
  assert.ok(second.rows[0].when instanceof Date && second.rows[0].when.getTime() === when.getTime());
  assert.equal(second.rows[0].bytes.toString(), "hi");
  second.rows[0].when.setFullYear(2000);
  assert.equal((await reads.read(args, run, store)).rows[0].when.getFullYear(), 2025);
});

test("schema checks tolerate any shape of answer", async () => {
  reads._setKnown(["terms", "students"]);
  const args = ["SELECT 1 FROM information_schema.tables WHERE table_name = $1", ["x"]];
  for (const answer of [undefined, null, [], [{ rows: [] }, { rows: [] }], { rowCount: 0 }, { rows: null }, { rows: [{ n: 0 }] }]) {
    await reads.readSchema(args, async () => answer); // never throws
  }
  assert.equal(reads.readSchema(["SELECT 1 FROM information_schema.tables; SELECT 2", []], async () => ({ rows: [{ n: 1 }] })), null, "two statements: not a schema fact");
  assert.equal(reads.readSchema(["SELECT count(*) FROM students, information_schema.columns", []], async () => ({ rows: [{ n: 1 }] })), null, "mixed with a table of data: not a schema fact");
  assert.equal(reads.readSchema(["WITH d AS (DELETE FROM x RETURNING 1) SELECT 1 FROM information_schema.tables", []], async () => ({ rows: [{ n: 1 }] })), null);
});

// ---------- against the database: every kind of write, then a read ----------
test("a read right after a write sees the write, however the write was written", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 'one' WHERE id = 1");
  const writes = [
    ["a plain update", () => db.query("UPDATE zz_sr_a SET v = $1 WHERE id = 1", ["w1"]), "w1"],
    ["lower case, quoted, schema-qualified", () => db.query('update "public"."zz_sr_a" set v = $1 where id = 1', ["w2"]), "w2"],
    ["a comment first", () => db.query("/* saving */ UPDATE zz_sr_a SET v = 'w3' WHERE id = 1"), "w3"],
    ["a line comment first", () => db.query("-- saving\nUPDATE zz_sr_a SET v = 'w4' WHERE id = 1"), "w4"],
    ["a CTE", () => db.query("WITH u AS (UPDATE zz_sr_a SET v = $1 WHERE id = 1 RETURNING 1) SELECT count(*) FROM u", ["w5"]), "w5"],
    ["a select first, then an update in one string", () => db.query("SELECT 1; UPDATE zz_sr_a SET v = 'w6' WHERE id = 1"), "w6"],
    ["a begin / commit string", () => db.query("BEGIN; UPDATE zz_sr_a SET v = 'w7' WHERE id = 1; COMMIT;"), "w7"],
    ["a query object", () => db.query({ text: "UPDATE zz_sr_a SET v = $1 WHERE id = 1", values: ["w8"] }), "w8"],
    ["an insert on conflict", () => db.query("INSERT INTO zz_sr_a (id, v) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v", ["w9"]), "w9"],
    ["a delete then re-insert", async () => { await db.query("DELETE FROM zz_sr_a WHERE id = 1"); await db.query("INSERT INTO zz_sr_a VALUES (1, 'w10')"); }, "w10"],
    ["a callback", () => new Promise((resolve, reject) => db.query("UPDATE zz_sr_a SET v = 'w11' WHERE id = 1", (error) => (error ? reject(error) : resolve()))), "w11"],
    ["a truncate and refill", async () => { await db.query("TRUNCATE zz_sr_a"); await db.query("INSERT INTO zz_sr_a VALUES (1, 'w12'), (2, 'two')"); }, "w12"],
  ];
  await inRequest(8001, async () => {
    // the kept answer exists at all: a change made outside the app's pool stays unseen
    assert.equal(await readV(), "one");
    await outside("UPDATE zz_sr_a SET v = 'outside' WHERE id = 1");
    assert.equal(await readV(), "one", "the answer is being kept");
    for (const [label, write, expected] of writes) {
      assert.equal(typeof (await readV()), "string");
      await write();
      assert.equal(await readV(), expected, label);
    }
  });
});

test("a failed write also clears: a dropped connection can leave a write that did commit", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 'before' WHERE id = 1");
  await inRequest(8002, async () => {
    assert.equal(await readV(), "before");
    await outside("UPDATE zz_sr_a SET v = 'changed' WHERE id = 1");
    assert.equal(await readV(), "before");
    await assert.rejects(() => db.query("UPDATE zz_sr_a SET v = (1/0)::text WHERE id = 1"));
    assert.equal(await readV(), "changed");
  });
});

test("another school's request also sees a write, and a reader with no school sees every change", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 'x0' WHERE id = 1");
  const other = [];
  await inRequest(8011, async () => {
    assert.equal(await readV(), "x0"); // school 8011 keeps the answer (a cross-school look at the table)
    await inRequest(8012, async () => { await db.query("UPDATE zz_sr_a SET v = 'x1' WHERE id = 1"); });
    other.push(await readV());
  });
  assert.deepEqual(other, ["x1"], "a save by one school clears the table for all");
  // a job or a form with no school in view
  await inRequest(8013, async () => {
    await readV();
    await new Promise((resolve, reject) => requestStats.requestStats({ method: "POST", originalUrl: "/public-form" }, { on() {} }, () => {
      db.query("UPDATE zz_sr_a SET v = 'x2' WHERE id = 1").then(resolve, reject); // a fresh request: no school set
    }));
    assert.equal(await readV(), "x2");
  });
});

test("rows reached by a cascade or SET NULL change when their parent row goes, whichever table the delete named", needsDb, async () => {
  await ready();
  await outside("DELETE FROM zz_sr_setnull; DELETE FROM zz_sr_child; DELETE FROM zz_sr_parent; INSERT INTO zz_sr_parent VALUES (1), (2); INSERT INTO zz_sr_child VALUES (1, 1, 'kid'), (2, 2, 'kid2'); INSERT INTO zz_sr_setnull VALUES (1, 1)");
  await inRequest(8020, async () => {
    const kids = async () => (await db.query("SELECT id FROM zz_sr_child ORDER BY id")).rows.map((row) => row.id).join(",");
    const links = async () => (await db.query("SELECT parent_id FROM zz_sr_setnull WHERE id = 1")).rows[0].parent_id;
    assert.equal(await kids(), "1,2");
    assert.equal(await links(), 1);
    await outside("SELECT 1");
    await db.query("DELETE FROM zz_sr_parent WHERE id = 1"); // names only the parent, which is not on the list
    assert.equal(await kids(), "2", "the cascade removed a row of a listed table");
    assert.equal(await links(), null, "SET NULL changed a row of a listed table");
  });
});

test("a unlisted table's reads and writes never touch the kept answers", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 'u0' WHERE id = 1");
  await inRequest(8030, async () => {
    assert.equal(await readV(), "u0");
    await outside("UPDATE zz_sr_a SET v = 'outside' WHERE id = 1");
    await db.query("UPDATE zz_sr_unlisted SET v = 'z' WHERE id = 1");
    assert.equal(await readV(), "u0", "the answer is still the kept one");
    // a read that joins an unlisted table is never kept
    const joined = () => db.query("SELECT a.v FROM zz_sr_a a JOIN zz_sr_unlisted u ON u.id = a.id WHERE a.id = 1");
    await joined();
    await outside("UPDATE zz_sr_a SET v = 'fresh' WHERE id = 1");
    assert.equal((await joined()).rows[0].v, "fresh");
  });
});

test("a transaction's writes clear the answers when it commits, and its own request reads fresh from the start", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 't0' WHERE id = 1");
  const seenByOthers = [];
  await inRequest(8040, async () => {
    assert.equal(await readV(), "t0"); // kept for school 8040
    const bystander = () => inRequest(8040, readV);
    const client = await db.connect();
    try {
      assert.equal(await readV(), "t0", "(the request that borrowed a connection reads on its own from now on)");
      await client.query("BEGIN");
      await client.query("UPDATE zz_sr_a SET v = 't1' WHERE id = 1");
      assert.equal(await readV(), "t0", "not committed yet: the old row, as the database itself says");
      await client.query("COMMIT");
      assert.equal(await readV(), "t1", "read-your-own-writes after commit, with the connection still held");
      seenByOthers.push(await bystander());
      await client.query("UPDATE zz_sr_a SET v = 't2' WHERE id = 1"); // an autocommit write on a held connection
      seenByOthers.push(await bystander());
      await client.query("BEGIN");
      await client.query("UPDATE zz_sr_a SET v = 't3' WHERE id = 1");
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });
  seenByOthers.push(await inRequest(8040, readV));
  assert.deepEqual(seenByOthers, ["t1", "t2", "t3"]);
});

test("a rolled-back or released-without-commit transaction leaves the answers right too", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 'r0' WHERE id = 1");
  await inRequest(8041, async () => {
    assert.equal(await readV(), "r0");
    const client = await db.connect();
    await client.query("BEGIN");
    await client.query("UPDATE zz_sr_a SET v = 'r1' WHERE id = 1");
    await client.query("ROLLBACK");
    client.release();
  });
  assert.equal(await inRequest(8042, readV), "r0");
});

test("schema statements run once per process clear what was kept", needsDb, async () => {
  await ready();
  await outside("UPDATE zz_sr_a SET v = 's0' WHERE id = 1");
  await inRequest(8050, async () => {
    assert.equal(await readV(), "s0");
    await outside("UPDATE zz_sr_a SET v = 's1' WHERE id = 1");
    assert.equal(await readV(), "s0");
    await db.query("ALTER TABLE zz_sr_a ADD COLUMN IF NOT EXISTS w int");
    assert.equal(await readV(), "s1");
  });
  await reads.load((sql) => admin.query(sql));
});

// ---------- guards that fail when someone adds a path this file can't see ----------
test("no function of the schema writes tables except the ones this file knows, and no trigger on an unlisted table writes a listed one", needsDb, async () => {
  await ready();
  const functions = (await admin.query("SELECT p.proname, p.prorettype::regtype::text AS ret, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')")).rows;
  const writes = (src) => [...src.toLowerCase().matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]).filter((name) => !["set", "only"].includes(name));
  const known = new Set(["sync_classes_to_term", "cleanup_old_email_history"]);
  for (const fn of functions.filter((f) => f.ret !== "trigger")) {
    if (writes(fn.prosrc).length) assert.ok(known.has(fn.proname), `${fn.proname}() writes tables and can be called from a SELECT: add it to CHANGES in utils/sqlScan.js and BROAD_WRITERS in utils/stableReads.js`);
  }
  const triggers = (await admin.query("SELECT t.tgrelid::regclass::text AS tbl, p.proname, p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal")).rows;
  const nested = new Map(functions.map((f) => [f.proname, f.prosrc]));
  const writtenBy = (src, seen = new Set()) => {
    const names = new Set(writes(src));
    for (const call of src.toLowerCase().matchAll(/\b(?:perform|select)\s+([a-z_][a-z0-9_]*)\s*\(/g)) {
      if (nested.has(call[1]) && !seen.has(call[1])) { seen.add(call[1]); for (const name of writtenBy(nested.get(call[1]), seen)) names.add(name); }
    }
    return names;
  };
  for (const trigger of triggers) {
    for (const written of writtenBy(trigger.prosrc)) {
      if (!reads.STABLE_TABLES.has(written) || written === trigger.tbl) continue;
      const touched = reads.statementInfo(`UPDATE ${trigger.tbl} SET x = 1`).affected;
      assert.ok(touched.has(written), `a write to ${trigger.tbl} fires ${trigger.proname}, which writes ${written} (a listed table): add [${trigger.tbl}, ${written}] to FALLBACK_EDGES in utils/stableReads.js`);
    }
  }
});

test("the list: every table on it exists, and none holds money or what a second process writes", needsDb, async () => {
  await ready();
  const tables = new Set((await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((row) => row.table_name));
  const missing = [...reads.STABLE_TABLES].filter((name) => !name.startsWith("zz_sr_") && !tables.has(name) && name !== "class_schedule_periods");
  assert.deepEqual(missing, []);
  for (const name of ["payments", "paystack_subaccounts", "dynamic_billing_cycles", "user_sessions", "password_reset_tokens", "attendance_records", "assessment_results"]) {
    assert.equal(reads.STABLE_TABLES.has(name), false, name);
  }
});

// ---------- the pool ----------
test("a write that was on a connection that dropped is not run again", needsDb, async () => {
  await ready();
  await outside("DELETE FROM zz_sr_once");
  const killer = setTimeout(() => { outside("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'stable-safety-test' AND state = 'active' AND query LIKE 'INSERT INTO zz_sr_once%'").catch(() => {}); }, 500);
  const started = Date.now();
  await assert.rejects(() => db.query("INSERT INTO zz_sr_once (v) SELECT 'late' FROM pg_sleep(2)"), (error) => /terminat|connection|57P01/i.test(`${error.code} ${error.message}`));
  clearTimeout(killer);
  assert.ok(Date.now() - started < 1800, "it failed when the connection went, it did not wait to try again");
  await sleep(2500); // long enough for a second copy to have run
  assert.equal((await outside("SELECT count(*)::int AS n FROM zz_sr_once")).rows[0].n, 0, "the insert ran at most once, and not at all here");
  assert.equal((await db.query("SELECT 1 AS ok")).rows[0].ok, 1, "the pool still works");
});

test("a statement inside a transaction on a dropped connection fails and is not run on another connection; the broken connection leaves the pool", needsDb, async () => {
  await ready();
  await outside("DELETE FROM zz_sr_once");
  const client = await db.connect();
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await client.query("BEGIN");
  await outside("SELECT pg_terminate_backend($1)", [pid]);
  await sleep(100);
  await assert.rejects(() => client.query("INSERT INTO zz_sr_once (v) VALUES ('in transaction')"));
  const total = db.totalCount;
  client.release(true);
  assert.ok(db.totalCount <= total, "the broken connection was dropped, not kept");
  assert.equal((await outside("SELECT count(*)::int AS n FROM zz_sr_once")).rows[0].n, 0);
  const next = await db.connect(); // the next borrower gets a working connection
  try { assert.equal((await next.query("SELECT 1 AS ok")).rows[0].ok, 1); } finally { next.release(); }
});

test("a borrowed connection that went quiet and died is replaced before a transaction starts on it", needsDb, async () => {
  await ready();
  const first = await db.connect();
  const pid = (await first.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  first.release();
  await sleep(50);
  const real = Date.now;
  await outside("SELECT pg_terminate_backend($1)", [pid]);
  Date.now = () => real() + 60000; // long idle
  let second;
  try { second = await db.connect(); } finally { Date.now = real; }
  try {
    await second.query("BEGIN");
    assert.equal((await second.query("SELECT 1 AS ok")).rows[0].ok, 1);
    await second.query("COMMIT");
  } finally { second.release(); }
});

test("nothing that happens to a connection can crash the process through an 'error' event", needsDb, async () => {
  await ready();
  assert.doesNotThrow(() => db.emit("error", new Error("Connection terminated unexpectedly")));
  assert.doesNotThrow(() => db.emit("error", new Error("something odd")));
  assert.doesNotThrow(() => db.emit("error", undefined));
  assert.doesNotThrow(() => db.emit("error", null));
  assert.doesNotThrow(() => db.emit("error", "just a string"));
  const client = await db.connect();
  try {
    assert.doesNotThrow(() => client.emit("error", new Error("read ECONNRESET")));
    assert.doesNotThrow(() => client.emit("error", new Error("something odd")));
    assert.doesNotThrow(() => client.emit("error", undefined));
  } finally { client.release(true); }
});

test("giving a connection back twice is the caller's error, and does not corrupt the pool", needsDb, async () => {
  await ready();
  const client = await db.connect();
  client.release();
  assert.throws(() => client.release(), /already been released/);
  const again = await db.connect();
  try { assert.equal((await again.query("SELECT 1 AS ok")).rows[0].ok, 1); } finally { again.release(); }
});

test("errors from the database are marked; the same words from elsewhere are not", needsDb, async () => {
  await ready();
  const { isDatabaseUnavailable } = require("../middleware/errorMiddleware");
  const error = await db.query("SELECT 1/0").catch((e) => e);
  assert.equal(error.fromDatabase, true);
  assert.equal(Object.keys(error).includes("fromDatabase"), false, "not copied into logs and JSON");
  assert.equal(isDatabaseUnavailable(error), false, "a division by zero is not a busy database");
  const stranger = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }); // e.g. a payment provider
  assert.equal(isDatabaseUnavailable(stranger), false);
  assert.equal(isDatabaseUnavailable(Object.assign(stranger, { fromDatabase: true })), true);
});

// ---------- one server, as always ----------
test("WEB_CONCURRENCY off (or 1) is exactly the old single process", () => {
  const code = `
    const cluster = require("node:cluster");
    const cp = require("./utils/clusterPrimary");
    const before = { exit: process.listenerCount("exit"), sigterm: process.listenerCount("SIGTERM"), sigint: process.listenerCount("SIGINT"), message: process.listenerCount("message"), clusterEvents: cluster.eventNames().length };
    const out = { counts: [undefined, "", "0", "1", "-3", "abc", "2", "99"].map((v) => cp.workerCount(v === undefined ? {} : { WEB_CONCURRENCY: v })) };
    out.start = cp.start();
    cp.installWorker();
    out.leader = cp.isLeader({});
    const after = { exit: process.listenerCount("exit"), sigterm: process.listenerCount("SIGTERM"), sigint: process.listenerCount("SIGINT"), message: process.listenerCount("message"), clusterEvents: cluster.eventNames().length };
    out.same = JSON.stringify(before) === JSON.stringify(after);
    const sc = require("./utils/shortCache"); sc.forgetSchool(5); out.generation = sc.generationOf(5);
    out.sent = typeof process.send;
    const o = require("./config/db").options; out.pool = { max: o.max, min: o.min, st: o.statement_timeout, idle: o.idleTimeoutMillis, connect: o.connectionTimeoutMillis };
    console.log(JSON.stringify(out)); process.exit(0);`;
  const run = spawnSync(process.execPath, ["-e", code], { cwd: path.join(__dirname, ".."), env: { PATH: process.env.PATH, NODE_ENV: "production", DB_CONNECTION_STRING: process.env.DB_CONNECTION_STRING || "postgres://x@127.0.0.1:1/x" }, encoding: "utf8", timeout: 20000 });
  const out = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.deepEqual(out.counts, [1, 1, 1, 1, 1, 1, 2, 32]);
  assert.equal(out.start, false, "no supervisor");
  assert.equal(out.leader, true, "the one process is the leader");
  assert.equal(out.same, true, "no listener, signal handler or cluster event added");
  assert.equal(out.generation, 1);
  assert.equal(out.sent, "undefined", "a plain process has no parent channel to message");
  assert.deepEqual(out.pool, { max: 15, min: 8, st: 30000, idle: 300000, connect: 6000 });
});

test("a failed schema statement is not remembered as done", needsDb, async () => {
  await ready();
  await assert.rejects(() => db.query("ALTER TABLE zz_sr_missing_table ADD COLUMN IF NOT EXISTS w int"));
  await admin.query("CREATE TABLE IF NOT EXISTS zz_sr_missing_table (id int)");
  try {
    await db.query("ALTER TABLE zz_sr_missing_table ADD COLUMN IF NOT EXISTS w int"); // asked again, and now it runs
  } finally {
    await admin.query("DROP TABLE IF EXISTS zz_sr_missing_table");
  }
});

test("sql scanning: strings, comments and quoted names in one pass", () => {
  assert.deepEqual(sqlScan.tokens("SELECT '--', \"Fe--es\" FROM t -- tail"), ["select", "fe", "es", "from", "t"]);
  assert.deepEqual(sqlScan.tokens("SELECT 1 /* a /* b */ c"), ["select", "c"]);
  assert.deepEqual(sqlScan.tokens("SELECT $$ x $$ , $tag$ y $tag$"), ["select", "x", "y"]);
  assert.deepEqual(sqlScan.tokens("SELECT 'a''b' , E'c\\'d' FROM t"), ["select", "from", "t"]);
  assert.equal(sqlScan.isReadOnly("SELECT 'unterminated"), true);
});

test("a dropped connection answers 503; only a page the person can safely reload reloads by itself", () => {
  const { globalErrorHandler } = require("../middleware/errorMiddleware");
  const answer = (method, accept) => {
    const out = { headers: {} };
    const res = {
      headersSent: false, locals: {},
      set(name, value) { out.headers[name] = value; return this; },
      status(code) { out.status = code; return this; },
      type() { return this; },
      json(body) { out.body = JSON.stringify(body); return this; },
      send(body) { out.body = body; return this; },
    };
    const req = { method, xhr: false, get: (name) => (name.toLowerCase() === "accept" ? accept : undefined) };
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE", fromDatabase: true });
    const log = console.error; console.error = () => {};
    try { globalErrorHandler(error, req, res, () => { throw new Error("should not pass on"); }); } finally { console.error = log; }
    return out;
  };
  const get = answer("GET", "text/html");
  assert.equal(get.status, 503);
  assert.match(get.body, /http-equiv="refresh"/);
  const post = answer("POST", "text/html");
  assert.equal(post.status, 503);
  assert.doesNotMatch(post.body, /http-equiv="refresh"/);
  assert.match(post.body, /check whether your change was saved/);
  const json = answer("POST", "application/json");
  assert.equal(json.status, 503);
  assert.match(json.body, /try again/i);
  assert.equal(json.headers["Retry-After"], "15");
});
