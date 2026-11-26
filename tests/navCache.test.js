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
