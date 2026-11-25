const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const childEnv = (extra) => ({ PATH: process.env.PATH, HOME: process.env.HOME, DB_CONNECTION_STRING: process.env.DB_CONNECTION_STRING || "postgres://postgres@127.0.0.1:55432/postgres", DB_SSL: "false", ...extra });
// A few tests need the local test database (postgres on :55432); CI has none, so they skip there.
const needsDb = { skip: /127\.0\.0\.1:55432|localhost:55432/.test(process.env.DB_CONNECTION_STRING || "") ? false : "needs the local test database (DB_CONNECTION_STRING on :55432)" };
function inChild(code, env) {
  const run = spawnSync(process.execPath, ["-e", code], { cwd: root, env: childEnv(env), encoding: "utf8", timeout: 60000 });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

// ---- Spreadsheets on worker threads ----
const ExcelJS = require("exceljs");
async function sampleWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Students");
  ws.addRow(["First name", "Last name", "Email"]);
  ws.addRow(["Ama", "Mensah", { text: "ama@example.com", hyperlink: "mailto:ama@example.com" }]);
  ws.getCell("A4").value = "Kofi"; // a gap: row 3 is empty, B4 is empty
  ws.getCell("C4").value = { formula: "1+1", result: 2 };
  ws.getCell("D4").value = new Date("2026-03-04T00:00:00Z");
  wb.addWorksheet("Second").addRow(["x", 1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("reading a workbook on a worker gives the same rows as reading it here", async () => {
  const buffer = await sampleWorkbook();
  const cpuPool = require("../utils/cpuPool");
  const viaPool = await cpuPool.run("readSheetRows", { buffer });
  const direct = new ExcelJS.Workbook();
  await direct.xlsx.load(buffer);
  const expected = direct.worksheets.map((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => rows.push({ rowNumber, values: row.values }));
    return { name: sheet.name, rows };
  });
  assert.deepEqual(viaPool, expected);
  // Gaps stay gaps (the importers slice and map these rows).
  assert.equal(viaPool[0].rows[2].values.slice(1).length, expected[0].rows[2].values.slice(1).length);
  assert.ok(viaPool[0].rows[2].values[3].result === 2);
  assert.ok(viaPool[0].rows[2].values[4] instanceof Date);
});

test("the report workbook builds on a worker, with the same cells, links and header as inline", async () => {
  const cpuPool = require("../utils/cpuPool");
  const spec = { reportTitle: "Roster", title: "Roster", header: { orgName: "School", address: "1 Main", phone: "5", date: "d", align: "left", logo: null },
    columns: [{ key: "a", label: "Name", type: "text" }, { key: "b", label: "Fees", type: "money" }, { key: "c", label: "Link", type: "link" }] };
  const values = [["Ama", 12.5, "https://x.test/1"], ["=HYPERLINK()", 3, ""]];
  const tasks = require("../utils/spreadsheetTasks");
  const [viaPool, inline] = [await cpuPool.run("buildReportWorkbook", { spec, values }), await tasks.buildReportWorkbook({ spec, values })];
  assert.ok(Buffer.isBuffer(viaPool));
  for (const buffer of [viaPool, inline]) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    assert.equal(sheet.getCell("A1").value, "School");
    assert.equal(sheet.getCell("A7").value, "Name");
    assert.equal(sheet.getCell("A8").value, "Ama");
    assert.equal(sheet.getCell("B8").value, 12.5);
    assert.equal(sheet.getCell("C8").value.hyperlink, "https://x.test/1");
    assert.equal(sheet.getCell("A9").value, "'=HYPERLINK()");
    assert.equal(sheet.getColumn(2).numFmt, "#,##0.00");
  }
});

test("a bad file fails that one request and the worker keeps serving", async () => {
  const cpuPool = require("../utils/cpuPool");
  await assert.rejects(() => cpuPool.run("readSheetRows", { buffer: Buffer.from("not a spreadsheet") }));
  const rows = await cpuPool.run("readSheetRows", { buffer: await sampleWorkbook() });
  assert.equal(rows.length, 2);
  await assert.rejects(() => cpuPool.run("noSuchTask", {}), /Unknown task/);
  assert.ok(cpuPool.stats().ran >= 1);
});

test("the main thread stays responsive while a big workbook is built on a worker", async () => {
  const cpuPool = require("../utils/cpuPool");
  const columns = Array.from({ length: 12 }, (_, i) => ({ key: "c" + i, label: "Column " + i, type: "text" }));
  const values = Array.from({ length: 25000 }, (_, r) => columns.map((_, c) => `r${r}c${c}`));
  const spec = { reportTitle: "Big", title: "Big", header: null, columns };
  let worstGap = 0;
  let last = Date.now();
  const ticker = setInterval(() => { const now = Date.now(); worstGap = Math.max(worstGap, now - last); last = now; }, 10);
  const started = Date.now();
  const file = await cpuPool.run("buildReportWorkbook", { spec, values });
  clearInterval(ticker);
  assert.ok(file.length > 100000);
  // Building takes seconds; the main thread must never have been stuck for anything close to that.
  assert.ok(Date.now() - started > 300, "the file took long enough to matter");
  assert.ok(worstGap < 400, `main thread was blocked for ${worstGap} ms`);
});

test("CPU_WORKERS=0 builds on the main thread, as before", () => {
  const out = inChild(`
    const pool = require("./utils/cpuPool");
    const tasks = require("./utils/spreadsheetTasks");
    (async () => {
      const buf = await pool.run("buildReportWorkbook", { spec: { reportTitle: "T", title: "T", header: null, columns: [{ key: "a", label: "A", type: "text" }] }, values: [["x"]] });
      console.log(JSON.stringify({ ok: Buffer.isBuffer(buf) && buf.length > 1000, stats: pool.stats() }));
    })();`, { CPU_WORKERS: "0" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.stats.maxWorkers, 0);
  assert.equal(parsed.stats.inline, 1);
  assert.equal(parsed.stats.workers, 0);
});

test("too many waiting file jobs get a plain 'busy' answer, not a pile-up", () => {
  const out = inChild(`
    const pool = require("./utils/cpuPool");
    (async () => {
      const spec = { reportTitle: "T", title: "T", header: null, columns: [{ key: "a", label: "A", type: "text" }] };
      const jobs = Array.from({ length: 6 }, () => pool.run("buildReportWorkbook", { spec, values: [["x"]] }).then(() => "ok", (e) => e.status));
      console.log(JSON.stringify(await Promise.all(jobs)));
    })();`, { CPU_WORKERS: "1", CPU_QUEUE_MAX: "2" });
  const results = JSON.parse(out);
  assert.ok(results.filter((r) => r === 503).length >= 3, JSON.stringify(results));
  assert.ok(results.includes("ok"));
});

// ---- Scheduled jobs on one server or many ----
test("RUN_JOBS=false or RUN_SCHEDULED_JOBS=false turns this server's jobs off; the default keeps them on", () => {
  const { jobsEnabled } = require("../utils/jobsSwitch");
  assert.equal(jobsEnabled({}), true);
  assert.equal(jobsEnabled({ RUN_JOBS: "true" }), true);
  assert.equal(jobsEnabled({ RUN_JOBS: "false" }), false);
  assert.equal(jobsEnabled({ RUN_SCHEDULED_JOBS: "false" }), false);
});

test("two servers can't run the same job at once; the second skips it", needsDb, async () => {
  const { withJobLock } = require("../utils/dbLock");
  const { Client } = require("pg");
  const url = process.env.DB_CONNECTION_STRING || "postgres://postgres@127.0.0.1:55432/postgres";
  // A second server is another process with its own connection: simulate it with its own client.
  const makeClient = () => { const c = new Client({ connectionString: url, ssl: false }); c.connected = c.connect(); return c.connected.then(() => c); };
  const first = await makeClient();
  const second = await makeClient();
  const key = `scale-test-job:${process.pid}:${Date.now()}`;
  let secondRan = false;
  const outcome = await withJobLock(key, async () => {
    const other = await withJobLock(key, async () => { secondRan = true; }, { getClient: async () => second });
    assert.equal(other.ran, false);
    return "first ran";
  }, { getClient: async () => first });
  assert.equal(outcome.ran, true);
  assert.equal(secondRan, false);
  // Once the first is done, the second may run it.
  const later = await withJobLock(key, async () => "second ran", { getClient: async () => second });
  assert.equal(later.ran, true);
  await first.end();
  await second.end();
});

test("DB_DIRECT_CONNECTION_STRING gives locks their own connection, and a taken lock stays taken", needsDb, async () => {
  const out = inChild(`
    const { tryAdvisoryLock } = require("./utils/dbLock");
    (async () => {
      const key = "scale-test-direct-" + process.pid;
      const a = await tryAdvisoryLock(key);
      const b = await tryAdvisoryLock(key);
      await a();
      const c = await tryAdvisoryLock(key);
      console.log(JSON.stringify({ first: typeof a, second: b, afterRelease: typeof c }));
      await c();
      process.exit(0);
    })();`, { DB_DIRECT_CONNECTION_STRING: process.env.DB_CONNECTION_STRING || "postgres://postgres@127.0.0.1:55432/postgres" });
  assert.deepEqual(JSON.parse(out), { first: "function", second: null, afterRelease: "function" });
});

// ---- The database pool ----
test("the pool's sizes and time limits come from the environment, and default to what live has used", () => {
  const read = (env) => JSON.parse(inChild(`const db = require("./config/db"); const o = db.options; console.log(JSON.stringify({ max: o.max, min: o.min, idle: o.idleTimeoutMillis, connect: o.connectionTimeoutMillis, st: o.statement_timeout, itx: o.idle_in_transaction_session_timeout, app: o.application_name, maxUses: o.maxUses }));`, env));
  const defaults = read({ NODE_ENV: "production" });
  assert.deepEqual(defaults, { max: 15, min: 8, idle: 300000, connect: 6000, st: 30000, app: "managira-web", maxUses: null });
  const custom = read({ NODE_ENV: "production", DB_POOL_MAX: "40", DB_POOL_MIN: "4", DB_IDLE_TIMEOUT_MS: "60000", DB_STATEMENT_TIMEOUT_MS: "15000", DB_IDLE_IN_TX_TIMEOUT_MS: "0", DB_MAX_USES: "5000", DB_APP_NAME: "web-2" });
  assert.deepEqual(custom, { max: 40, min: 4, idle: 60000, connect: 6000, st: 15000, app: "web-2", maxUses: 5000 });
});

test("behind PgBouncer the pool sends no connection-level settings it would refuse", () => {
  const out = JSON.parse(inChild(`const o = require("./config/db").options; console.log(JSON.stringify({ st: o.statement_timeout, itx: o.idle_in_transaction_session_timeout }));`, { DB_PGBOUNCER: "on" }));
  assert.deepEqual(out, {});
});

test("the pool reports its use for /health/detail", () => {
  const out = JSON.parse(inChild(`const db = require("./config/db"); console.log(JSON.stringify(db.getPoolStats()));`, { DB_POOL_MAX: "7" }));
  assert.equal(out.max, 7);
  assert.equal(out.waiting, 0);
  assert.ok("peakWaiting" in out && "totalQueries" in out);
});

// ---- /health/detail ----
test("health detail answers only the server's own computer or a caller with the token", () => {
  const { mayReadDetail } = require("../utils/serverHealth");
  const request = (headers, address) => ({ headers, socket: { remoteAddress: address } });
  assert.equal(mayReadDetail(request({}, "127.0.0.1"), {}), true);
  assert.equal(mayReadDetail(request({}, "::1"), {}), true);
  // Through the proxy (it adds X-Forwarded-For) or from anywhere else: no.
  assert.equal(mayReadDetail(request({ "x-forwarded-for": "8.8.8.8" }, "127.0.0.1"), {}), false);
  assert.equal(mayReadDetail(request({}, "10.0.0.5"), {}), false);
  assert.equal(mayReadDetail(request({ "x-health-token": "wrong" }, "10.0.0.5"), { HEALTH_DETAIL_TOKEN: "secret-token" }), false);
  assert.equal(mayReadDetail(request({ "x-health-token": "secret-token", "x-forwarded-for": "8.8.8.8" }, "10.0.0.5"), { HEALTH_DETAIL_TOKEN: "secret-token" }), true);
  assert.equal(mayReadDetail(request({ "x-health-token": "" }, "10.0.0.5"), {}), false);
});

test("health detail reports event-loop lag, pool and memory", () => {
  const { detail, eventLoopLag } = require("../utils/serverHealth");
  const report = detail({ getPoolStats: () => ({ max: 15, waiting: 0 }) }, { stats: () => ({ workers: 0 }) });
  assert.equal(report.status, "ok");
  assert.equal(report.pool.max, 15);
  assert.ok(report.memoryMb.rss > 0);
  assert.ok("p99" in eventLoopLag());
});

// ---- A database connection that dies ----
test("a killed database connection never becomes an error for a read, or for the next transaction", needsDb, () => {
  const out = inChild(`
    const db = require("./config/db");
    const { Client } = require("pg");
    (async () => {
      const admin = new Client({ connectionString: process.env.DB_CONNECTION_STRING, ssl: false }); await admin.connect();
      const kill = async () => (await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'scale-test-app' AND pid <> pg_backend_pid()")).rowCount;
      // fill the pool, then kill every one of this process's backends (and only those)
      await Promise.all(Array.from({ length: 4 }, () => db.query("SELECT pg_sleep(0.05)")));
      let killed = await kill();
      const results = { killed };
      // 1: a read straight after the kill
      results.read = (await db.query("SELECT 1 AS one")).rows[0].one;
      // 2: a transaction straight after another kill (the idle connection is checked before it is handed out)
      await new Promise((r) => setTimeout(r, 5200));
      killed += await kill();
      await new Promise((r) => setTimeout(r, 5200));
      const client = await db.connect();
      try { await client.query("BEGIN"); results.tx = (await client.query("SELECT 2 AS two")).rows[0].two; await client.query("COMMIT"); } finally { client.release(); }
      // 3: ten reads in a row after yet another kill
      await kill();
      const many = await Promise.all(Array.from({ length: 10 }, (_, i) => db.query("SELECT $1::int AS n", [i])));
      results.many = many.map((r) => r.rows[0].n).join(",");
      results.isDrop = [db.isConnectionDrop(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), db.isConnectionDrop(new Error("Connection terminated unexpectedly")), db.isConnectionDrop(new Error("duplicate key"))];
      console.log(JSON.stringify(results));
      await admin.end(); process.exit(0);
    })().catch((e) => { console.log("FAILED " + e.message); process.exit(1); });`,
  { DB_APP_NAME: "scale-test-app", DB_POOL_MAX: "4", DB_POOL_MIN: "0" });
  const results = JSON.parse(out);
  assert.ok(results.killed >= 1, out);
  assert.equal(results.read, 1);
  assert.equal(results.tx, 2);
  assert.equal(results.many, "0,1,2,3,4,5,6,7,8,9");
  assert.deepEqual(results.isDrop, [true, true, false]);
});

test("a dropped connection is answered with the 'reconnecting' page, never the raw error text", () => {
  const { isDatabaseUnavailable } = require("../middleware/errorMiddleware");
  const fromDb = (error) => Object.assign(error, { fromDatabase: true }); // config/db.js marks what the database raised
  assert.equal(isDatabaseUnavailable(fromDb(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))), true);
  assert.equal(isDatabaseUnavailable(fromDb(new Error("read ECONNRESET"))), true);
  assert.equal(isDatabaseUnavailable(fromDb(new Error("Client has encountered a connection error and is not queryable"))), true);
  // the same words from another service (a payment provider's API) are that call failing, not the database
  assert.equal(isDatabaseUnavailable(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), false);
  assert.equal(isDatabaseUnavailable(new Error("socket hang up")), false);
  assert.equal(isDatabaseUnavailable(new Error("column x does not exist")), false);
  const { scrubText } = require("../utils/errorScrub");
  if (scrubText) assert.equal(scrubText("write EPIPE").text, "Something went wrong. Please try again.");
});

// ---- Lookups kept for a few seconds, per school ----
test("only reads of settings-like tables are kept; anything joined to live data never is", () => {
  const reads = require("../utils/stableReads");
  reads._setKnown(["terms", "school_years", "students", "attendance_records", "organizations", "assessment_results", "users"]);
  assert.equal(reads._keepable("SELECT term_id FROM terms t JOIN school_years sy ON sy.id = t.school_year_id WHERE t.organization_id = $1"), true);
  assert.equal(reads._keepable("SELECT student_id FROM students WHERE organization_id = $1"), true);
  // live data, a comma join to it, a subquery on it, a lock, a clock, a write
  assert.equal(reads._keepable("SELECT s.student_id FROM students s JOIN attendance_records a ON a.student_id = s.student_id"), false);
  assert.equal(reads._keepable("SELECT * FROM terms t, assessment_results r WHERE r.term_id = t.term_id"), false);
  assert.equal(reads._keepable("SELECT term_id FROM terms WHERE term_id IN (SELECT term_id FROM attendance_records)"), false);
  assert.equal(reads._keepable("SELECT * FROM terms WHERE organization_id = $1 FOR UPDATE"), false);
  assert.equal(reads._keepable("SELECT * FROM terms WHERE end_date > NOW()"), false);
  assert.equal(reads._keepable("SELECT * FROM terms WHERE end_date > CURRENT_DATE"), false);
  assert.equal(reads._keepable("UPDATE terms SET current = TRUE"), false);
  assert.equal(reads._keepable("SELECT 1"), false);
});

test("a kept answer is shared, is a private copy, and goes when the school saves", async () => {
  const reads = require("../utils/stableReads");
  const { forgetSchool } = require("../utils/shortCache");
  reads._setKnown(["terms", "students"]);
  let runs = 0;
  const run = async () => { runs += 1; return { command: "SELECT", rowCount: 1, rows: [{ n: runs, nested: { list: [1] } }], fields: [] }; };
  const store = { schoolId: 9001 };
  const args = ["SELECT n FROM terms WHERE organization_id = $1", [9001]];
  const first = await reads.read(args, run, store);
  first.rows[0].nested.list.push(99); // a caller changing its copy
  const second = await reads.read(args, run, store);
  assert.equal(runs, 1);
  assert.deepEqual(second.rows[0].nested.list, [1]);
  // another school, or the same text with other values, asks for itself
  await reads.read(args, run, { schoolId: 9002 });
  await reads.read(["SELECT n FROM terms WHERE organization_id = $1", [9002]], run, store);
  assert.equal(runs, 3);
  // a save by this school clears its answers
  forgetSchool(9001);
  await reads.read(args, run, store);
  assert.equal(runs, 4);
  // a write that changed a listed table clears them; one that matched nothing does not
  reads.noteWrite("UPDATE terms SET current = TRUE WHERE term_id = 1", store, { rowCount: 0 });
  await reads.read(args, run, store);
  assert.equal(runs, 4);
  reads.noteWrite("UPDATE terms SET current = TRUE WHERE term_id = 1", store, { rowCount: 1 });
  await reads.read(args, run, store);
  assert.equal(runs, 5);
  // a write from a visitor or a job (no school in view) clears every school's
  reads.noteWrite("INSERT INTO students (first_name) VALUES ($1)", null, { rowCount: 1 });
  await reads.read(args, run, store);
  assert.equal(runs, 6);
  // a request that opened a transaction, or has no school, always reads fresh
  assert.equal(reads.read(args, run, { schoolId: 9001, noShared: true }), null);
  assert.equal(reads.read(args, run, {}), null);
  // a failure is never kept
  const failing = async () => { throw new Error("boom"); };
  await assert.rejects(() => reads.read(["SELECT n FROM terms WHERE organization_id = $1", [777]], failing, store), /boom/);
  assert.equal((await reads.read(["SELECT n FROM terms WHERE organization_id = $1", [777]], run, store)).rows.length, 1);
});

test("a schema check that says yes is kept; one that says no is asked again", async () => {
  const reads = require("../utils/stableReads");
  let answer = { rows: [{ n: 0 }], rowCount: 1 };
  let runs = 0;
  const run = async () => { runs += 1; return answer; };
  const args = ["SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = $1", ["scale_test_table"]];
  await reads.readSchema(args, run);
  await reads.readSchema(args, run);
  assert.equal(runs, 2);
  answer = { rows: [{ n: 3 }], rowCount: 1 };
  await reads.readSchema(args, run);
  await reads.readSchema(args, run);
  assert.equal(runs, 3);
  reads.noteSchemaChange("ALTER TABLE x ADD COLUMN y int");
  await reads.readSchema(args, run);
  assert.equal(runs, 4);
});

test("the busy exam saves don't clear a school's kept answers, a settings save does", () => {
  const shortCache = require("../utils/shortCache");
  const requestStats = require("../utils/requestStats");
  const generation = () => shortCache.generationOf(9100);
  const call = (method, path, openTransaction) => new Promise((resolve) => {
    const handlers = {};
    const req = { method, path, session: { organizationId: 9100 } };
    const res = { on: (name, fn) => { handlers[name] = fn; } };
    requestStats.requestStats({ method, originalUrl: path }, { on() {} }, () => {
      shortCache.forgetSchoolAfterChanges(req, res, () => {
        if (openTransaction) requestStats.openedTransaction();
        if (handlers.finish) handlers.finish();
        resolve();
      });
    });
  });
  const before = generation();
  return call("POST", "/student/testing-room/12/autosave", true)
    .then(() => call("POST", "/common/saveSingleAttendance", true))
    .then(() => call("GET", "/common/orgDashboard", false))
    .then(() => { assert.equal(generation(), before); return call("POST", "/account/settings/save", false); })
    .then(() => { assert.equal(generation(), before + 1); return call("GET", "/common/something", true); })
    .then(() => assert.equal(generation(), before + 2)); // a page that opened a transaction may have saved something
});

// ---- One server on several cores ----
test("WEB_CONCURRENCY runs several workers: one leader, saves reach every worker, shutdown is clean", async () => {
  const { spawn } = require("node:child_process");
  const http = require("node:http");
  const port = 41000 + Math.floor(Math.random() * 2000);
  const get = (path) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, agent: false }, (res) => { let body = ""; res.on("data", (d) => (body += d)); res.on("end", () => resolve(body)); }).on("error", reject);
  });
  const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "clusterProbe.js")], { env: { PATH: process.env.PATH, WEB_CONCURRENCY: "3", PROBE_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  try {
    for (let i = 0; i < 100 && !/listening[\s\S]*listening[\s\S]*listening/.test(log); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.match(log, /Starting 3 workers/);
    const seen = new Map();
    for (let i = 0; i < 60; i += 1) { const answer = JSON.parse(await get("/")); seen.set(answer.worker, answer); }
    assert.ok(seen.size >= 2, `answers came from ${seen.size} worker(s)`);
    assert.deepEqual([...seen.values()].filter((a) => a.leader).map((a) => a.worker), seen.has(1) ? [1] : []);
    assert.ok([...seen.values()].every((a) => a.jobs === a.leader), "only the leader runs scheduled jobs");
    // a save in whichever worker answers reaches all of them
    await get("/forget");
    await new Promise((r) => setTimeout(r, 300));
    const generations = new Set();
    for (let i = 0; i < 60; i += 1) generations.add(JSON.parse(await get("/")).generation);
    assert.deepEqual([...generations].filter((g) => g < 1), [], "every worker heard about the save");
  } finally {
    child.kill("SIGTERM");
  }
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("hung"), 15000).unref())]);
  assert.equal(code, 0, log);
  assert.match(log, /All workers stopped/);
});

test("the database pool of a multi-worker server is shared between its workers", () => {
  const read = (env) => JSON.parse(inChild(`const o = require("./config/db").options; console.log(JSON.stringify({ max: o.max, min: o.min }));`, env));
  assert.deepEqual(read({ NODE_ENV: "production" }), { max: 15, min: 8 });
  assert.deepEqual(read({ NODE_ENV: "production", CLUSTER_WORKER: "1", CLUSTER_WORKERS: "3" }), { max: 5, min: 3 });
  assert.deepEqual(read({ NODE_ENV: "production", CLUSTER_WORKER: "2", CLUSTER_WORKERS: "8" }), { max: 4, min: 1 });
});
