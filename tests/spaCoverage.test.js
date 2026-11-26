"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = require("../public/js/spaRules.js");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true })) {
    const rel = path.join(dir, f.name);
    if (f.isDirectory()) walk(rel, out); else if (f.name.endsWith(".ejs")) out.push(rel);
  }
  return out;
};

test("portal pages, staff pages and drivers: every ordinary page link is handled in-app", () => {
  const pages = [
    "/guardian/dashboard", "/guardian/child?studentId=1", "/guardian/child/schedule?studentId=1", "/guardian/child/teachers?studentId=1",
    "/guardian/child/forms?studentId=1&form=2", "/guardian/academic-details?studentId=1", "/guardian/settings", "/guardian/reports", "/guardian/calendar",
    "/guardian/activities", "/guardian/paygira", "/guardian/child/testing-room?studentId=1",
    "/student/dashboard", "/student/settings", "/student/forms", "/student/portfolio", "/student/calendar", "/student/activities", "/student/testing-room",
    "/driver/dashboard", "/driver/settings", "/common/calendar", "/common/management?panel=employees", "/common/orgDashboard", "/legal/help",
  ];
  for (const type of ["guardian", "student", "driver", "organization"]) {
    pages.forEach((p) => assert.equal(R.shouldHandle(type, p), true, type + " " + p));
  }
});

test("full loads on purpose: files, downloads, prints, money, trips, test taking, sign-in, charts, policy pages", () => {
  const full = [
    "/account/logout", "/account/login", "/account/sso/start", "/r/abc", "/api/x", "/uploads/a.png", "/stats/organization", "/print/transcript",
    "/student/testing-room/12?questionSetId=3", "/student/testing-room/12/resource/4", "/driver/trip/5", "/transportation/live/routes",
    "/guardian/child/file/9", "/guardian/child/student-file/9", "/guardian/portfolio/file/9", "/student/portfolio/file/3", "/guardian/calendar/feed", "/student/calendar/sync",
    "/guardian/student-report-cards/5/pdf", "/guardian/paygira/stripe-return", "/guardian/paygira/receipt/4", "/guardian/paygira/invoice/4",
    "/common/forms/3/export.csv", "/finance/arrears/reports/2/download", "/common/addStudent", "/common/report.pdf", "/legal/privacy-policy", "/legal/user-documentation/x",
    "//evil.example/x", "https://example.com/",
  ];
  for (const type of ["guardian", "student", "driver", "organization"]) {
    full.forEach((p) => assert.equal(R.shouldHandle(type, p), false, type + " " + p));
  }
});

test("hub, admin and public keep their short lists", () => {
  assert.equal(R.shouldHandle("hub", "/hub/dashboard", ["/hub/dashboard"]), true);
  assert.equal(R.shouldHandle("hub", "/hub/billing", ["/hub/dashboard"]), false);
  assert.equal(R.shouldHandle("public", "/", ["/"]), true);
});

test("a Back link goes back in history only when the page before is the page it names", () => {
  assert.equal(R.resolveBack({ path: "/guardian/child/teachers?studentId=1", prev: "/guardian/child?studentId=1", idx: 2 }, "/guardian/child?studentId=1"), "history");
  assert.equal(R.resolveBack({ path: "/student/settings", prev: "/student/dashboard", idx: 1 }, "/student/dashboard"), "history");
  // the page before is another page: open the page the link names (from the cache when it is there)
  assert.equal(R.resolveBack({ path: "/student/settings", prev: "/student/forms", idx: 1 }, "/student/dashboard"), "navigate");
  // opened directly (no earlier in-app page)
  assert.equal(R.resolveBack({ path: "/student/settings", scroll: 0 }, "/student/dashboard"), "navigate");
  assert.equal(R.resolveBack(null, "/student/dashboard"), "navigate");
  assert.equal(R.resolveBack({ path: "/a", prev: "/b", idx: 0 }, "/b"), "navigate");
});

test("the router loads the rules before itself and uses them for Back links and history entries", () => {
  const head = read("views/partials/head.ejs");
  assert.ok(head.indexOf("/js/spaRules.js") !== -1 && head.indexOf("/js/spaRules.js") < head.indexOf("/js/spa-router.js"));
  const router = read("public/js/spa-router.js");
  assert.match(router, /hasAttribute\('data-back'\)/);
  assert.match(router, /goBack\(href\)/);
  assert.match(router, /prev: st\.path/);
  assert.match(router, /isBroadType\(this\.userType\)/);
});

test("portal back links use data-back (href stays as the no-script address)", () => {
  assert.match(read("views/partials/portalHead.ejs"), /class="pt-back" data-back href=/);
  [["views/guardian/childHub.ejs", "ph-back"], ["views/guardian/studentAcademicDetails.ejs", "pt-back"], ["views/guardian/reportDetails.ejs", "rd-back-link"],
    ["views/guardian/editPendingStudent.ejs", "back-link"], ["views/student/testResult.ejs", "str-review__back"], ["views/common/guardianDetails.ejs", "gd-back-btn"]]
    .forEach(([f, cls]) => assert.ok(new RegExp("<a[^>]*data-back[^>]*" + cls + "|<a[^>]*" + cls + "[^>]*data-back").test(read(f)), f));
});

test("data-no-spa in portal and staff views is only on allowed kinds of links", () => {
  // allowed: logout/login, files and downloads, new tab, print/PDF, external, hub panels loaded in a frame (data-embed-url),
  // the test-taking and trip screens, forms that post, the school-switch chips
  const OK = /(logout|login|target="_blank"|target="_top"|download|\.pdf|\/print\/|data-embed-url|testing-room|\/trip|data-sbx|method="POST"|<form|exit-org|exit-hub|\/file\/|stripe|mailto:|data-card-template|data-ws-compose|data-ap-skip|data-qa-key|data-od-|\/common\/management\?panel|\/migration|id="ex"|data-notif-id|class="ex-|publicDashboard|Open it directly|window\.open|data-section)/;
  const bad = [];
  for (const dir of ["views/guardian", "views/student", "views/driver", "views/partials"]) {
    for (const f of walk(dir).filter((x) => !/adminHeader|apiUsageBanner/.test(x))) { // admin screens are not one of the four logins
      read(f).split("\n").forEach((line, i) => {
        if (/data-no-spa/.test(line) && !OK.test(line)) bad.push(f + ":" + (i + 1) + " " + line.trim().slice(0, 120));
      });
    }
  }
  assert.deepEqual(bad, []);
});

test("links that used to carry data-no-spa for no reason are plain again", () => {
  const header = read("views/partials/header.ejs");
  ["/common/calendar", "/common/management", "/common/reports"].forEach((h) => assert.ok(!new RegExp('href="' + h + '"[^>]*data-no-spa').test(header), h));
  assert.ok(!/data-no-spa/.test(read("public/js/portalRequests.js")));
});

test("drivers' pages are cached and fetched on hover like everyone else's, trips and test taking are not", () => {
  const NC = require("../public/js/navCache.js");
  assert.equal(NC.isCacheable("/driver/dashboard"), true);
  assert.equal(NC.isCacheable("/driver/settings"), true);
  assert.equal(NC.isCacheable("/driver/trip/4"), false);
  assert.equal(NC.isPrefetchAllowed("/student/settings"), true);
  assert.equal(NC.isPrefetchAllowed("/guardian/child?studentId=3"), true);
  assert.equal(NC.isPrefetchAllowed("/student/testing-room/5"), false);
});
