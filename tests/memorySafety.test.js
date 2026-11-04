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
  assert.equal(passed, 3, "admin uploads go to disk, so no cap");
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
  const res = { headersSent: false, set() { return this; }, status(code) { this.code = code; return this; }, type() { return this; }, send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
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
