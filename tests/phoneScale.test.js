"use strict";
// Phone type scale (640px and under), the one shared Menu bar + dropdown on every workspace, and the School stats name.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("appearance.css has the phone scale tokens and keeps fields at 16px", () => {
  const css = read("public/css/appearance.css");
  const m = css.match(/@media \(max-width: 640px\) \{\s*:root \{([^}]*)\}/);
  assert.ok(m, "phone token block present");
  for (const t of ["--fs-body: 13px", "--fs-small: 11.5px", "--fs-head: 14.5px", "--fs-title: 19px", "--fs-th: 11px", "--fs-btn: 13px", "--lh-body: 1.4", "--icon-size: 18px", "--menu-row-h: 44px", "--card-pad: 12px", "--gap: 8px", "--stat-scale: .85"]) assert.ok(m[1].includes(t), t);
  assert.ok(css.indexOf("/* ===== Phone forms") > css.indexOf("max-width: 640px"), "16px field rule stays after the scale");
  assert.match(css.slice(css.indexOf("/* ===== Phone forms")), /font-size: 16px !important/);
});

test("every workspace menu shares the Menu bar, panel, 44px rows and scroll-lock", () => {
  const css = read("public/css/workspace-shell.css");
  for (const k of ["management", "settings", "hub"]) {
    assert.match(css, new RegExp(`\\.${k}-nav-toggle`), `${k} toggle`);
    assert.match(css, new RegExp(`\\.${k}-nav \\.nav-link[,{ ]`), `${k} rows`);
  }
  assert.match(css, /min-height: var\(--menu-row-h, 44px\)/);
  const settings = read("views/account/settings.ejs");
  assert.match(settings, /class="settings-nav-toggle"/);
  assert.doesNotMatch(settings, /settings-nav-overlay/, "no scrim over the Settings panel");
  assert.match(read("views/partials/head.ejs"), /menu-scroll-lock/);
  assert.match(read("public/css/appearance.css"), /html\.menu-scroll-lock/);
  for (const f of ["views/common/managementTools.ejs", "views/common/reportsHub.ejs", "views/common/admissionsHub.ejs", "views/account/paygiraHub.ejs"]) assert.match(read(f), /nav-toggle/, f);
  const tm = read("views/transportation/manage.ejs");
  assert.match(tm, /tm-nav-head/);
  assert.match(tm, /nav-link-icon/);
});

test("Organization stats is School stats everywhere people see it", () => {
  for (const f of ["utils/pageFinder.js", "middleware/workspaceOnly.js", "views/common/reportsHub.ejs", "views/stats/organizationStats.ejs", "controllers/statsController.js", "utils/appDemo.js"]) {
    const t = read(f);
    assert.doesNotMatch(t, /Organization [Ss]tats/, f);
    assert.match(t, /School stats/, f);
  }
  const page = read("views/stats/organizationStats.ejs");
  assert.match(page, /aria-label="Download PDF" title="Download PDF"/);
  assert.match(page, /aria-label="Compare classes" title="Compare classes"/);
});
