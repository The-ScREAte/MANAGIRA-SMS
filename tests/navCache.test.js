"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const NC = require("../public/js/navCache.js");
const { normalizedEtag, isPrefetchRequest, quietFlash } = require("../utils/navHints");

test("identity is part of the cache key: two people never share a copy", () => {
  const store = NC.createStore();
  store.set("Manager:240:63:", "/account/settings", { html: "<main>A</main>" });
  assert.ok(store.get("Manager:240:63:", "/account/settings"));
  assert.equal(store.get("Manager:241:63:", "/account/settings"), null);
  assert.equal(store.get("Manager:240:64:", "/account/settings"), null);
  assert.equal(store.set("", "/x", { html: "x" }), null, "nothing is kept without an identity");
});

test("a copy older than its TTL is gone; live pages live 30 s, others 10 minutes", () => {
  let t = 1000;
  const store = NC.createStore({ now: () => t });
  store.set("id", "/account/settings", { html: "a" });
  store.set("id", "/common/attendanceCollection?x=1", { html: "b" });
  assert.equal(NC.ttlFor("/account/settings"), 10 * 60 * 1000);
  assert.equal(NC.ttlFor("/common/attendanceCollection?x=1"), 30 * 1000);
  t += 31 * 1000;
  assert.ok(store.get("id", "/account/settings"));
  assert.equal(store.get("id", "/common/attendanceCollection?x=1"), null);
  t += 10 * 60 * 1000;
  assert.equal(store.get("id", "/account/settings"), null);
});

test("the store is bounded and drops the least recently used", () => {
  const store = NC.createStore({ max: 3 });
  ["/a", "/b", "/c"].forEach((p) => store.set("id", p, { html: p }));
  store.get("id", "/a"); // /a is now the most recent
  store.set("id", "/d", { html: "d" });
  assert.equal(store.size(), 3);
  assert.equal(store.get("id", "/b"), null);
  assert.ok(store.get("id", "/a") && store.get("id", "/c") && store.get("id", "/d"));
  for (let i = 0; i < 500; i++) store.set("id", "/p" + i, { html: "x" });
  assert.ok(store.size() <= 3);
  store.clear();
  assert.equal(store.size(), 0);
  assert.ok(NC.MAX_ENTRIES <= 30);
});

test("deny-list: nothing that changes state, downloads, prints or pays is cached or fetched ahead", () => {
  const denied = [
    "/account/logout", "/hub/logout", "/account/login", "/account/guardian-login", "/r/abc123", "/common/deleteStudent?id=1",
    "/common/approveApplication?id=2", "/common/rejectApplication", "/common/unlockAssessment", "/common/sendReminders",
    "/common/exportStudents", "/common/download/file", "/print/printStudentReport", "/print/meritSheetPage", "/common/report.pdf",
    "/account/payment", "/checkout/start", "/notifications/markRead", "/notifications/count", "/account/session-extend",
    "/common/reverseCharge", "/student/testing-room/12", "/driver/dashboard", "/driver/trip/start", "/transcript/12", "/api/anything",
    "/account/switch-school", "/common/toggleThing", "/common/archiveStudent", "/common/emailreports",
  ];
  denied.forEach((p) => {
    assert.equal(NC.isCacheable(p), false, p + " must not be cached");
    assert.equal(NC.isPrefetchAllowed(p), false, p + " must not be fetched ahead");
  });
});

test("allow-list: only menu destinations and hub shells are fetched ahead", () => {
  ["/common/orgDashboard", "/common/management", "/common/admissions", "/common/reports", "/account/settings", "/account/settings/finance",
    "/common/classDashboard?classId=4", "/guardian/dashboard", "/legal/user-documentation", "/common/management/"].forEach((p) => {
    assert.equal(NC.isPrefetchAllowed(p), true, p);
  });
  ["/common/editStudent?id=3", "/common/createTest", "/common/studentDetails?id=1", "/account/personalization", "/", "/stats/organization", "/some/new/route"].forEach((p) => {
    assert.equal(NC.isPrefetchAllowed(p), false, p);
  });
});

test("the page hash ignores the security nonce, the sign-in clock and signed-link stamps", () => {
  const page = (nonce, left) => `<html><script nonce="${nonce}">x()</script><script src="/js/sessionWatch.js" data-idle-left="${left}" data-ends-in="${left}"></script><img src="/public-image?key=a&expires=${left}&signature=abc${left}"><main>Hello</main></html>`;
  assert.equal(NC.pageHash(page("AAA", 1)), NC.pageHash(page("BBB", 2)));
  assert.notEqual(NC.pageHash(page("AAA", 1)), NC.pageHash(page("AAA", 1).replace("Hello", "Bye")));
  assert.equal(NC.mainHash(page("AAA", 1)), NC.mainHash(page("BBB", 9)));
  assert.notEqual(NC.mainHash(page("A", 1)), NC.mainHash(page("A", 1).replace("Hello", "Bye")));
});

test("the server's ETag is the same for two renders that differ only by nonce, and differs when the page does", () => {
  const html = (nonce, body) => `<script nonce="${nonce}">1</script><main>${body}</main><script nonce="${nonce}">2</script>`;
  const a = normalizedEtag(html("n0nceA==", "hi"), "n0nceA==");
  const b = normalizedEtag(html("zzNonceB/", "hi"), "zzNonceB/");
  const c = normalizedEtag(html("zzNonceB/", "changed"), "zzNonceB/");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^W\/"nav-/);
});

test("a page with a message in it is never kept", () => {
  assert.equal(NC.hasFlash('<div class="flash-wrapper"><div class="flash-message success">Saved</div></div>'), true);
  assert.equal(NC.hasFlash('<div class="flash-wrapper"></div>'), false);
});

function rootWith(touched) { return { querySelector: (sel) => (sel === '[data-nav-touched="1"]' && touched ? {} : null) }; }

test("dirty-form guard: only a field the person really touched blocks an in-place swap", () => {
  assert.equal(NC.isDirty(rootWith(false)), false);
  assert.equal(NC.isDirty(rootWith(true)), true);
  assert.equal(NC.isDirty(null), false);
  const set = [];
  const el = (props) => Object.assign({ tagName: "INPUT", type: "text", setAttribute: (k, v) => set.push([k, v]) }, props);
  assert.equal(NC.markTouched({ isTrusted: true, target: el() }), true);
  assert.deepEqual(set, [["data-nav-touched", "1"]]);
  assert.equal(NC.markTouched({ isTrusted: false, target: el() }), false, "a script's own event is not the person");
  assert.equal(NC.markTouched({ isTrusted: true, target: el({ type: "hidden" }) }), false);
  assert.equal(NC.markTouched({ isTrusted: true, target: el({ tagName: "DIV" }) }), false);
  assert.equal(NC.markTouched({ isTrusted: true, target: el({ tagName: "SELECT", type: "select-one" }) }), true);
});

test("swap policy: never under typing, an open drawer, a dirty form, or a menu page with panels", () => {
  assert.equal(NC.canSwapInPlace({}), true);
  assert.equal(NC.canSwapInPlace({ dirty: true }), false);
  assert.equal(NC.canSwapInPlace({ busy: true }), false);
  assert.equal(NC.canSwapInPlace({ typingRecently: true }), false);
  assert.equal(NC.canSwapInPlace({ hasFrames: true }), false);
  assert.equal(NC.canSwapInPlace({ navigating: true }), false);
  const shown = { getClientRects: () => [1] };
  const hidden = { getClientRects: () => [] };
  assert.equal(NC.isBusy({ querySelectorAll: () => [shown] }), true);
  assert.equal(NC.isBusy({ querySelectorAll: () => [hidden] }), false, "a closed dialog kept in the page is not open");
  assert.equal(NC.isBusy({ querySelectorAll: () => [] }), false);
});

test("any write empties the cache; polling and lookups do not", () => {
  assert.equal(NC.writeClearsCache("POST", "/account/settings/save"), true);
  assert.equal(NC.writeClearsCache("DELETE", "/common/thing/1"), true);
  assert.equal(NC.writeClearsCache("PUT", "/x"), true);
  assert.equal(NC.writeClearsCache("GET", "/x"), false);
  assert.equal(NC.writeClearsCache("POST", "/csp-report"), false);
  assert.equal(NC.writeClearsCache("POST", "/api/chatbot/ask"), false);
});

test("warm-up respects data saver and slow connections", () => {
  assert.equal(NC.connectionAllowsWarmup(null), true);
  assert.equal(NC.connectionAllowsWarmup({ saveData: true }), false);
  assert.equal(NC.connectionAllowsWarmup({ effectiveType: "2g" }), false);
  assert.equal(NC.connectionAllowsWarmup({ effectiveType: "slow-2g" }), false);
  assert.equal(NC.connectionAllowsWarmup({ effectiveType: "4g" }), true);
});

test("req.isPrefetch: the app's own warm-up headers and the browser's prefetch purpose", () => {
  const req = (h) => ({ get: (n) => h[n] });
  assert.equal(isPrefetchRequest(req({ "X-Prefetch": "1" })), true);
  assert.equal(isPrefetchRequest(req({ "X-SPA-Preload": "1" })), true);
  assert.equal(isPrefetchRequest(req({ "Sec-Purpose": "prefetch" })), true);
  assert.equal(isPrefetchRequest(req({})), false);
});

test("a prefetch neither reads nor leaves a flash message", () => {
  const req = { isPrefetch: true, flash: () => { throw new Error("consumed"); } };
  quietFlash(req, {}, () => {});
  assert.deepEqual(req.flash(), {});
  assert.deepEqual(req.flash("error"), []);
  assert.equal(req.flash("error", "x"), 0);
  const normal = { isPrefetch: false, flash: () => "real" };
  quietFlash(normal, {}, () => {});
  assert.equal(normal.flash(), "real");
});

test("the router uses the cache rules: no inline handlers, pages are written to memory only", () => {
  const router = fs.readFileSync(path.join(__dirname, "../public/js/spa-router.js"), "utf8");
  const cache = fs.readFileSync(path.join(__dirname, "../public/js/navCache.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(cache, /localStorage|sessionStorage|indexedDB|caches\.open/, "private pages are never written to disk");
  assert.doesNotMatch(router, /indexedDB|caches\.open/, "private pages are never written to disk");
  const head = fs.readFileSync(path.join(__dirname, "../views/partials/head.ejs"), "utf8");
  assert.match(head, /name="managira-identity"/);
  assert.ok(head.indexOf("/js/navCache.js") < head.indexOf("/js/spa-router.js"), "navCache loads before the router");
});

// ── Kept-alive pages: the gate that keeps a parked page quiet (public/js/navGate.js) ──
function loadGate() {
  const vm = require("vm");
  const src = fs.readFileSync(path.join(__dirname, "../public/js/navGate.js"), "utf8");
  const calls = { win: [], doc: [], timeouts: [], intervals: [] };
  const win = {
    addEventListener(type, fn) { calls.win.push([type, fn]); },
    removeEventListener(type, fn) { calls.win = calls.win.filter((c) => !(c[0] === type && c[1] === fn)); },
    setTimeout(fn) { calls.timeouts.push(fn); return calls.timeouts.length; },
    setInterval(fn) { calls.intervals.push(fn); return calls.intervals.length; },
  };
  win.self = win; win.top = win;
  const doc = { readyState: "complete", currentScript: null, addEventListener(type, fn) { calls.doc.push([type, fn]); }, removeEventListener() {} };
  win.document = doc;
  vm.runInContext(src, vm.createContext({ window: win, document: doc, WeakMap, Array }));
  return { win, doc, calls, gate: win.__managiraGate };
}

test("gate: a parked page's listeners do nothing, and work again when it is shown", () => {
  const { win, calls, gate } = loadGate();
  const rec = { parked: false, dead: false, deferred: [] };
  let hits = 0;
  gate.rec = rec; // the router is running this page's scripts
  win.addEventListener("resize", () => { hits += 1; });
  gate.rec = null;
  let outside = 0;
  win.addEventListener("resize", () => { outside += 1; }); // not part of the page: never gated
  const fire = () => calls.win.filter((c) => c[0] === "resize").forEach((c) => c[1]());
  fire();
  assert.deepEqual([hits, outside], [1, 1]);
  rec.parked = true;
  fire();
  assert.deepEqual([hits, outside], [1, 2], "the parked page ignored the event");
  rec.parked = false;
  fire();
  assert.deepEqual([hits, outside], [2, 3]);
});

test("gate: removeEventListener finds the wrapped listener", () => {
  const { win, calls, gate } = loadGate();
  gate.rec = { parked: false, dead: false, deferred: [] };
  const fn = () => {};
  const base = calls.win.length;
  win.addEventListener("scroll", fn);
  assert.equal(calls.win.length, base + 1);
  win.removeEventListener("scroll", fn);
  assert.equal(calls.win.length, base, "the wrapper, not the original, is what was added and removed");
});

test("gate: interval ticks are skipped while parked; a timeout that falls due waits and runs on return", () => {
  const { win, calls, gate } = loadGate();
  const rec = { parked: false, dead: false, deferred: [] };
  let polls = 0;
  let later = 0;
  gate.rec = rec;
  win.setInterval(() => { polls += 1; }, 1000);
  win.setTimeout(() => { later += 1; }, 5000);
  gate.rec = null;
  rec.parked = true;
  calls.intervals.forEach((f) => f());
  calls.timeouts.forEach((f) => f());
  assert.deepEqual([polls, later], [0, 0], "no polling, no timer work while parked");
  rec.parked = false;
  gate.flush(rec);
  assert.deepEqual([polls, later], [0, 1], "the waiting timeout runs once when the page is shown again");
  calls.intervals.forEach((f) => f());
  assert.equal(polls, 1, "the interval carries on");
});

test("gate: a destroyed page's timers never run; a panel (iframe) is quiet while its parent says so", () => {
  const { win, calls, gate } = loadGate();
  const rec = { parked: false, dead: false, deferred: [] };
  let n = 0;
  gate.rec = rec;
  win.setTimeout(() => { n += 1; }, 10);
  gate.rec = null;
  rec.dead = true;
  calls.timeouts.forEach((f) => f());
  assert.equal(n, 0);
  win.setInterval(() => { n += 10; }, 10);
  win.__managiraParked = true;
  calls.intervals.forEach((f) => f());
  assert.equal(n, 0, "a frame flagged as parked skips its ticks");
  win.__managiraParked = false;
  calls.intervals.forEach((f) => f());
  assert.equal(n, 10);
});

test("keeping pages alive is on by default, has a kill switch, and never keeps tests, drivers or trips", () => {
  const router = fs.readFileSync(path.join(__dirname, "../public/js/spa-router.js"), "utf8");
  const head = fs.readFileSync(path.join(__dirname, "../views/partials/head.ejs"), "utf8");
  assert.match(router, /KEEP_PANELS: window\.MANAGIRA_KEEP_PANELS !== false && !\(document\.querySelector\('meta\[name="managira-keep-panels"\]\[content="0"\]'\)\)/);
  assert.ok(/NAV_KEEP_PANELS === 'off'[\s\S]{0,20}<meta name="managira-keep-panels" content="0">/.test(head), "kill switch meta");
  assert.ok(head.indexOf("/js/navGate.js") !== -1 && head.indexOf("/js/navGate.js") < head.indexOf("/js/logoutConfirm.js"), "the gate loads before any page script");
  assert.match(router, /!\/testing-room\|\\\/driver\\\/\|trip\/i\.test\(rec\.key\)/);
  assert.match(router, /KEEP_MAX: 6/);
  assert.match(router, /KEEP_TTL_MS: 5 \* 60 \* 1000/);
  // data-heavy pages are kept 30 s at most
  ["/account/settings/finance", "/common/attendanceCollection", "/common/mailroom", "/common/orgDashboard"].forEach((p) => assert.equal(NC.ttlFor(p), 30 * 1000, p));
});

test("a class page is a warm-up candidate; state-changing and test pages are not", () => {
  assert.equal(NC.isPrefetchAllowed("/common/classDashboard/146?termId=100"), true);
  assert.equal(NC.isPrefetchAllowed("/common/classDashboard"), true);
  assert.equal(NC.isPrefetchAllowed("/common/classDashboard/146/delete"), false);
  assert.equal(NC.isPrefetchAllowed("/student/testing-room/5"), false);
  assert.equal(NC.isPrefetchAllowed("/driver/dashboard"), false);
});
