"use strict";
// Class Tools on phones and tablets is the same menu as the Management hub: a bar, a full-width dropdown under it,
// 44px rows, no left sheet and no scrim.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Class Tools markup: bar with hamburger, header with arrange button only, no scrim, no inner close button", () => {
  const ejs = read("views/common/classDashboard.ejs");
  assert.match(ejs, /<button class="nav-toggle"[^>]*aria-controls="class-tools-panel"/);
  assert.match(ejs, /class-nav-toggle-label/);
  assert.match(ejs, /data-arrange-toggle="classroom"/);
  assert.doesNotMatch(ejs, /class-tools-overlay/, "no scrim element or code");
  assert.doesNotMatch(ejs, /class="nav-overlay"/);
  assert.doesNotMatch(ejs, /class="nav-close"/, "no second close button inside the panel");
  assert.match(ejs, /css\/classToolsMenu\.css/);
});

test("Class Tools CSS uses the Management menu's numbers: dropdown under the bar, 44px rows, 32px tile, 18px icon", () => {
  const css = read("public/css/classToolsMenu.css");
  const hub = read("public/css/workspace-shell.css");
  assert.match(css, /left: 10px !important/);
  assert.match(css, /width: calc\(100vw - 20px\) !important/);
  assert.match(css, /min-height: var\(--menu-row-h, 44px\)/);
  assert.match(css, /width: 32px; height: 32px/);
  assert.match(css, /var\(--icon-size, 18px\)/);
  assert.match(css, /nav-section-label \{ display: none/, "Management has no section headings");
  assert.doesNotMatch(css, /translateX/, "no sliding sheet");
  const z = (t, sel) => Number((t.slice(t.indexOf(sel)).match(/z-index: (\d+)/) || [])[1]);
  assert.ok(z(css, "#class-tools-panel.workspace-sidebar.nav-card {") >= z(hub, ".management-nav {\n    display: block"), "panel at least as high as the Management panel");
  assert.match(hub, /--management-nav-top/);
  assert.match(css, /--class-nav-top/);
  assert.match(css, /menu-scroll-lock/);
});

test("the shared head logic knows the Class Tools bar and panel (position, scroll lock, Escape)", () => {
  const head = read("views/partials/head.ejs");
  assert.match(head, /prefix: 'class'/);
  assert.match(head, /menu-scroll-lock/);
  assert.match(head, /#class-tools-panel/);
});
