const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { BoundedMap, clearAllBoundedMaps } = require("../utils/boundedMap");
const { pressureLevel, currentUsageBytes } = require("../utils/memoryGuard");
const { createUploadGate } = require("../middleware/uploadGate");
const { PROBE } = require("../middleware/botProbes");
const { isHarmlessConnectionError } = require("../utils/processGuards");

test("a bounded list never passes its cap, and drops the oldest first", () => {
  const map = new BoundedMap(3);
  ["a", "b", "c", "d", "e"].forEach((key) => map.set(key, 1));
  assert.deepEqual([...map.keys()], ["c", "d", "e"]);
  map.set("c", 2);
  map.set("f", 1);
  assert.deepEqual([...map.keys()], ["e", "c", "f"]);
});

test("the memory guard clears caches but not lists that protect something", () => {
  const cache = new BoundedMap(5);
  const tries = new BoundedMap(5, { keepUnderPressure: true });
  cache.set("a", 1);
  tries.set("a", 1);
  clearAllBoundedMaps();
  assert.equal(cache.size, 0);
  assert.equal(tries.size, 1);
});

test("pressure levels follow the limit", () => {
  assert.equal(pressureLevel(100, 512), "ok");
  assert.equal(pressureLevel(400, 512), "soft");
  assert.equal(pressureLevel(460, 512), "hard");
  assert.equal(pressureLevel(460, null), "ok");
});

test("memory use counts the whole container, without droppable file cache", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cg-"));
  const big = 4 * 1024 * 1024 * 1024;
  fs.writeFileSync(path.join(root, "memory.current"), String(big + 1024));
  fs.writeFileSync(path.join(root, "memory.stat"), `anon 1\ninactive_file 1024\n`);
  assert.equal(currentUsageBytes(root), big);
  assert.equal(currentUsageBytes(path.join(root, "missing")) > 0, true);
  fs.rmSync(root, { recursive: true });
});

function fakeReqRes(length, url = "/common/upload") {
  const handlers = {};
  const res = {
    headersSent: false, statusCode: 0, body: null,
    once(event, fn) { handlers[event] = fn; return this; },
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(body) { this.body = body; this.headersSent = true; return this; },
    finish() { if (handlers.finish) handlers.finish(); },
  };
  const req = { path: url, headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(length) }, once() {} };
  return { req, res };
}

test("only a few large uploads are read at once; the rest wait their turn", () => {
  const gate = createUploadGate({ concurrency: 2, minBytes: 100, maxQueue: 1, maxWaitMs: 60000 });
  const started = [];
  const uploads = [0, 1, 2, 3].map(() => fakeReqRes(1000));
  uploads.forEach(({ req, res }, index) => gate(req, res, () => started.push(index)));
  assert.deepEqual(started, [0, 1], "two read at once");
  assert.equal(uploads[3].res.statusCode, 503, "a full queue says busy");
  uploads[0].res.finish();
  assert.deepEqual(started, [0, 1, 2], "the waiting one starts when a slot frees");
  uploads[1].res.finish();
  uploads[2].res.finish();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 }, "no slot is lost");
});

test("small uploads and ordinary forms are never held up; oversized ones are refused", () => {
  const gate = createUploadGate({ concurrency: 1, minBytes: 1000, maxTotalBytes: 5000 });
  let passed = 0;
  gate(fakeReqRes(10).req, fakeReqRes(10).res, () => { passed += 1; });
  gate({ path: "/x", headers: { "content-type": "application/json", "content-length": "99999" }, once() {} }, fakeReqRes(1).res, () => { passed += 1; });
  assert.equal(passed, 2);
  const big = fakeReqRes(6000);
  gate(big.req, big.res, () => assert.fail("should not start"));
  assert.equal(big.res.statusCode, 413);
  const admin = fakeReqRes(6000, "/admin/app-demo");
  gate(admin.req, admin.res, () => { passed += 1; });
  const video = fakeReqRes(250 * 1024 * 1024, "/account/uploadSlideshowImages");
  gate(video.req, video.res, () => { passed += 1; });
  assert.equal(passed, 4, "uploads saved to disk skip the cap and the queue");
});

test("scanner paths are refused; real pages are not", () => {
  ["/.env", "/admin/.env", "/.git/config", "/wp-admin/setup.php", "/wp-login.php", "/index.php", "/admin/controller/extension/", "/phpmyadmin/", "/cgi-bin/x", "/backup.sql"]
    .forEach((p) => assert.ok(PROBE.test(p), p));
  ["/", "/common/management", "/account/login", "/admin/hubs", "/admin/dashboard", "/uploads/photo.png", "/css/style.css", "/js/app.js", "/environment", "/.well-known/acme-challenge/x", "/common/report-builder"]
    .forEach((p) => assert.ok(!PROBE.test(p), p));
});

test("connection errors are survivable; programming errors are not", () => {
  assert.equal(isHarmlessConnectionError(new Error("service temporarily unavailable")), true);
  assert.equal(isHarmlessConnectionError(Object.assign(new Error("x"), { code: "ECONNRESET" })), true);
  assert.equal(isHarmlessConnectionError(new TypeError("x is not a function")), false);
});

test("a failed background promise no longer ends the process", () => {
  const script = `require(${JSON.stringify(path.resolve(__dirname, "../utils/processGuards"))}).install("T");
    Promise.reject(new Error("service temporarily unavailable"));
    setTimeout(() => { console.log("still-running"); process.exit(0); }, 100);`;
  const guarded = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(guarded.status, 0);
  assert.match(guarded.stdout, /still-running/);
  const bare = spawnSync(process.execPath, ["-e", `Promise.reject(new Error("service temporarily unavailable")); setTimeout(() => {}, 100);`], { encoding: "utf8" });
  assert.equal(bare.status, 1, "without the guard this is the crash the host reports");
});

test("database refusals show the retrying page instead of a 500", () => {
  const { globalErrorHandler } = require("../middleware/errorMiddleware");
  const res = { locals: {}, headersSent: false, set() { return this; }, status(code) { this.code = code; return this; }, type() { return this; }, send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
  const original = console.error;
  console.error = () => {};
  globalErrorHandler(new Error("service temporarily unavailable"), { get: () => "text/html" }, res, () => {});
  console.error = original;
  assert.equal(res.code, 503);
  assert.match(res.body, /http-equiv="refresh"/);
});

test("a background cache refresh can run again after finishing", async () => {
  const cacheManager = require("../utils/cacheManager");
  let runs = 0;
  const refresh = () => { runs += 1; return Promise.resolve("value"); };
  cacheManager.backgroundRefresh("static", "memory-safety-key", refresh, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  cacheManager.backgroundRefresh("static", "memory-safety-key", refresh, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runs, 2);
});

test("migrations run once each and split into single statements", async () => {
  const { runMigrations, splitStatements } = require("../scripts/migrate");
  assert.deepEqual(splitStatements("-- note\nCREATE INDEX a ON b (c);\n\nCREATE INDEX d ON e (f);\n"), ["CREATE INDEX a ON b (c)", "CREATE INDEX d ON e (f)"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.writeFileSync(path.join(dir, "001.sql"), "SELECT 1;\nSELECT 2;\n");
  fs.writeFileSync(path.join(dir, "002.sql"), "SELECT 3;\n");
  const ran = [];
  const done = new Set(["001.sql"]);
  const db = { async query(sql, values) {
    ran.push(sql);
    if (/^SELECT name/.test(sql)) return { rows: [...done].map((name) => ({ name })) };
    if (/^INSERT/.test(sql)) done.add(values[0]);
    return { rows: [] };
  } };
  assert.deepEqual(await runMigrations(db, { dir, log() {} }), ["002.sql"]);
  assert.ok(ran.includes("SELECT 3") && !ran.includes("SELECT 1"), "only the new one ran");
  assert.deepEqual(await runMigrations(db, { dir, log() {} }), []);
  fs.rmSync(dir, { recursive: true });
});

test("the index migration only adds, and doesn't lock tables", () => {
  const { splitStatements } = require("../scripts/migrate");
  const sql = fs.readFileSync(path.resolve(__dirname, "../database/migrations/001_school_lookup_indexes.sql"), "utf8");
  const statements = splitStatements(sql);
  assert.equal(statements.length, 10);
  assert.deepEqual(splitStatements("DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;\n"), ["DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;"]);
  statements.forEach((statement) => assert.match(statement, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS /));
});

test("waiting for a lock takes turns, and gives up instead of hanging", async () => {
  const { waitForAdvisoryLock } = require("../utils/dbLock");
  let held = false;
  const client = { release() {}, async query(sql) {
    if (/pg_try_advisory_lock/.test(sql)) { if (held) return { rows: [{ ok: false }] }; held = true; return { rows: [{ ok: true }] }; }
    held = false;
    return { rows: [] };
  } };
  const database = { connect: async () => client };
  const order = [];
  const task = (name, ms) => async () => { order.push(`${name}-start`); await new Promise((r) => setTimeout(r, ms)); order.push(`${name}-end`); };
  await Promise.all([
    waitForAdvisoryLock("k", task("a", 30), { database, pollMs: 5 }),
    waitForAdvisoryLock("k", task("b", 1), { database, pollMs: 5 }),
  ]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
  held = true;
  await assert.rejects(waitForAdvisoryLock("k", async () => {}, { database, timeoutMs: 20, pollMs: 5 }), /Timed out/);
});

test("the Google library isn't loaded until something uses it", () => {
  const script = `require(${JSON.stringify(path.resolve(__dirname, "../utils/calendarConnect"))});
    const loaded = Object.keys(require.cache).some((file) => file.includes("node_modules/googleapis/"));
    console.log(loaded ? "LOADED" : "NOT-LOADED"); process.exit(0);`;
  const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...process.env, DB_CONNECTION_STRING: "" } });
  assert.match(run.stdout, /NOT-LOADED/, run.stderr);
});

test("jobs share one lock connection, and a job can't overlap itself", async () => {
  const { withJobLock } = require("../utils/dbLock");
  const queries = [];
  const client = { query: async (sql) => { queries.push(sql); return { rows: [{ ok: true }] }; } };
  let opened = 0;
  const getClient = async () => { opened += 1; return client; };
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const first = withJobLock("job-a", () => blocked, { getClient });
  assert.deepEqual(await withJobLock("job-a", async () => assert.fail("overlapped"), { getClient }), { ran: false });
  const other = await withJobLock("job-b", async () => "done", { getClient });
  assert.deepEqual(other, { ran: true, result: "done" });
  release("ok");
  assert.deepEqual(await first, { ran: true, result: "ok" });
  assert.equal(queries.filter((q) => /unlock/.test(q)).length, 2);
  assert.deepEqual((await withJobLock("job-a", async () => 1, { getClient })).ran, true);
});

test("a job lock held elsewhere skips the run", async () => {
  const { withJobLock } = require("../utils/dbLock");
  const client = { query: async () => ({ rows: [{ ok: false }] }) };
  assert.deepEqual(await withJobLock("job-c", async () => assert.fail("ran"), { getClient: async () => client }), { ran: false });
});

test("job locks are named after the job, not its position", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../jobs/scheduler.js"), "utf8");
  const names = [...source.matchAll(/cron\.schedule\('[^']+', '([a-z-]+)', async/g)].map((m) => m[1]);
  assert.equal(names.length, 19);
  assert.equal(new Set(names).size, 19, "each name is unique");
  assert.ok(names.includes("custom-form-reminders"), "custom form reminders go out from a job");
  assert.ok(names.includes("scheduled-promotions"));
  assert.ok(names.includes("calendar-sync"), "connected calendars are kept up to date by a job, not by whoever opens the page");
  assert.ok(names.includes("activity-reminders"));
  assert.ok(!/scheduledJobCount/.test(source));
});

test("outside calls have a timeout by default", () => {
  require("../utils/httpDefaults");
  assert.ok(require("axios").defaults.timeout > 0);
});

test("a Paystack charge retries safely and never guesses about money", async () => {
  const configPath = require.resolve("../utils/paystackConfig");
  const original = require.cache[configPath];
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { getPaystackSettings: async () => ({ activeSecretKey: "sk" }) } };
  delete require.cache[require.resolve("../utils/payoutRunner")];
  const { chargePaystackCard } = require("../utils/payoutRunner")._test;
  const axios = require("axios");
  const realPost = axios.post;
  const realGet = axios.get;
  let lastAttempt = null;
  const dbClient = { query: async () => ({ rows: lastAttempt ? [lastAttempt] : [] }) };
  const args = { org: { email: "a@b.c" }, card: { authorization_code: "x" }, amountMinor: 100, currency: "ghs", payoutRow: { payout_id: 7, next_run_at: "2026-11-04" }, dbClient };
  const references = [];
  try {
    axios.post = async (_url, body) => { references.push(body.reference); return { data: { data: { status: "failed", gateway_response: "Declined" } } }; };
    assert.equal((await chargePaystackCard(args)).success, false);
    lastAttempt = { attempts: 1, failure_reason: "Declined", provider_reference: null };
    await chargePaystackCard(args);
    assert.notEqual(references[0], references[1], "a clear failure gets a new reference");
    lastAttempt = { attempts: 2, failure_reason: "Not confirmed: timeout", provider_reference: "same-one" };
    await chargePaystackCard(args);
    assert.equal(references[2], "same-one", "an unknown result retries the same reference");
    lastAttempt = null;

    axios.post = async () => { throw new Error("timeout of 20000ms exceeded"); };
    axios.get = async () => ({ data: { data: { status: "success", reference: "r" } } });
    assert.equal((await chargePaystackCard(args)).success, true, "the timed-out charge had gone through");
    axios.get = async () => { throw new Error("still down"); };
    const unknown = await chargePaystackCard(args);
    assert.equal(unknown.success, false);
    assert.match(unknown.message, /^Not confirmed:/);
    assert.ok(unknown.reference, "the reference is kept for the retry");
    axios.get = async () => { const e = new Error("x"); e.response = { status: 404 }; throw e; };
    assert.match((await chargePaystackCard(args)).message, /^Not confirmed:/, "not found yet is not a failure");

    axios.post = async () => { const e = new Error("x"); e.response = { status: 400, data: { message: "Duplicate Transaction Reference" } }; throw e; };
    axios.get = async () => ({ data: { data: { status: "success", reference: "r" } } });
    assert.equal((await chargePaystackCard(args)).success, true, "a duplicate is looked up, not treated as failed");

    axios.post = async () => { const e = new Error("x"); e.response = { status: 400, data: { message: "Insufficient funds" } }; throw e; };
    assert.equal((await chargePaystackCard(args)).message, "Insufficient funds");
  } finally {
    axios.post = realPost;
    axios.get = realGet;
    if (original) require.cache[configPath] = original; else delete require.cache[configPath];
  }
});

test("a Google client can be created", () => {
  const { createGoogleOauthClient } = require("../utils/googleClassroomSync");
  assert.equal(typeof createGoogleOauthClient().generateAuthUrl, "function");
});

test("a job lock that stops answering is dropped, and doesn't freeze other jobs", async () => {
  const { withJobLock } = require("../utils/dbLock");
  let ended = false;
  const stuck = { query: () => new Promise(() => {}), end: async () => { ended = true; } };
  await assert.rejects(withJobLock("job-stuck", async () => assert.fail("ran"), { getClient: async () => stuck, stepMs: 10 }), /took over/);
  await new Promise((resolve) => setImmediate(resolve));
  const healthy = { query: async () => ({ rows: [{ ok: true }] }) };
  assert.deepEqual(await withJobLock("job-stuck", async () => "ok", { getClient: async () => healthy, stepMs: 50 }), { ran: true, result: "ok" });
});

test("a short cache shares one lookup, and never keeps a failure", async () => {
  const { memo } = require("../utils/memo");
  let calls = 0;
  const get = memo(async () => { calls += 1; return "value"; }, { ttlMs: 1000 });
  assert.deepEqual(await Promise.all([get("a"), get("a")]), ["value", "value"]);
  assert.equal(calls, 1);
  let fails = 0;
  const flaky = memo(async () => { fails += 1; if (fails === 1) throw new Error("down"); return "back"; });
  await assert.rejects(flaky("x"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await flaky("x"), "back");
  const again = memo(async () => { calls += 1; return calls; });
  await again("k");
  again.forget("k");
  const before = calls;
  await again("k");
  assert.equal(calls, before + 1, "forget makes the next read fresh");
});

test("a declined scheduled payout waits, then stops and tells the school", async () => {
  const stripeConfigPath = require.resolve("../utils/stripeConfig");
  const original = require.cache[stripeConfigPath];
  const declined = Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
  require.cache[stripeConfigPath] = { id: stripeConfigPath, filename: stripeConfigPath, loaded: true, exports: { getStripeClient: async () => ({ paymentIntents: { create: async () => { throw declined; } } }) } };
  const runnerPath = require.resolve("../utils/payoutRunner");
  delete require.cache[runnerPath];
  const { executePayoutCharge } = require("../utils/payoutRunner");
  const updates = [];
  let failed = 0;
  const dbClient = { async query(sql, values) {
    if (/FROM organizations/.test(sql)) return { rows: [{ organization_id: 1, email: "", stripe_customer_id: "cus" }] };
    if (/FROM stored_cards/.test(sql)) return { rows: [{ id: 1, provider: "stripe", authorization_code: "pm", is_active: true }] };
    if (/COUNT\(\*\)::int AS failed/.test(sql)) return { rows: [{ failed }] };
    if (/COUNT\(\*\) OVER/.test(sql)) return { rows: [] };
    if (/SET next_run_at/.test(sql)) updates.push(values[1]);
    return { rows: [] };
  } };
  const row = { payout_id: 9, organization_id: 1, card_id: 1, amount: 5, currency: "usd", name: "Rent", frequency: "monthly", start_date: "2026-01-01", next_run_at: new Date() };
  try {
    failed = 1;
    await executePayoutCharge(row, { dbClient, rescheduleOnFailure: true });
    const hour = (updates[0] - Date.now()) / 3600000;
    assert.ok(hour > 0.9 && hour < 1.1, "first retry in an hour");
    failed = 2;
    await executePayoutCharge(row, { dbClient, rescheduleOnFailure: true });
    const day = (updates[1] - Date.now()) / 3600000;
    assert.ok(day > 23 && day < 25, "second retry in a day");
    updates.length = 0;
    await executePayoutCharge(row, { dbClient });
    assert.equal(updates.length, 0, "Pay Now leaves the schedule alone");
  } finally {
    if (original) require.cache[stripeConfigPath] = original; else delete require.cache[stripeConfigPath];
    delete require.cache[runnerPath];
  }
});

test("payout queries use the table's real key column", () => {
  const schema = fs.readFileSync(path.resolve(__dirname, "../utils/payoutSchema.js"), "utf8");
  assert.match(schema, /org_payout_transactions[\s\S]{0,60}transaction_id SERIAL PRIMARY KEY/);
  const runner = fs.readFileSync(path.resolve(__dirname, "../utils/payoutRunner.js"), "utf8");
  assert.ok(!/ORDER BY id\b|MAX\(id\)|AND id >/.test(runner), "there is no id column");
});
