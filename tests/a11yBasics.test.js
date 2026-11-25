"use strict";
// Accessibility basics that must not slip back (WCAG 2.1 AA): pages can be zoomed, there is a
// way past the header, and the shared helpers are loaded.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
function walk(dir, out = []) {
  for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, f.name);
    if (f.isDirectory()) walk(rel, out);
    else if (/\.(ejs|js|html)$/.test(f.name)) out.push(rel);
  }
  return out;
}

test("no page blocks pinch-zoom (WCAG 1.4.4)", () => {
  const offenders = [...walk("views"), "server.js", "public/js/driverNav.js"]
    .filter((f) => /maximum-scale\s*=\s*1(\.0)?\b|user-scalable\s*=\s*(no|0)/i.test(read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.deepStrictEqual(offenders, []);
});

test("the layout has a skip link, a main landmark target and the shared helpers", () => {
  const layout = read("views/layout.ejs");
  assert.match(layout, /class="skip-link" href="#main-content"/);
  assert.match(layout, /<main id="main-content"/);
  assert.match(read("views/partials/head.ejs"), /js\/a11y\.js/);
  assert.match(read("utils/cssBundle.js"), /"a11y"/);
  assert.ok(fs.existsSync(path.join(root, "public/css/a11y.css")));
});

test("the chat window is named and closes with Escape", () => {
  const chat = read("public/js/chatbot.js");
  assert.match(chat, /aria-label', 'Open the Mira Assistant chat'/);
  assert.match(chat, /role', 'dialog'/);
  assert.match(chat, /key === 'Escape'/);
});

test("a quiet sign-in gets a warning with Stay signed in, and the server can extend it", () => {
  const watch = read("public/js/sessionWatch.js");
  assert.match(watch, /Stay signed in/);
  assert.match(watch, /\/account\/session-extend/);
  assert.match(read("server.js"), /app\.post\("\/account\/session-extend"/);
});

test("choosing an academic period does not reload the page by itself (3.2.2)", () => {
  const view = read("views/guardian/studentAcademicDetails.ejs");
  assert.doesNotMatch(view, /data-onchange="guardian-studentAcademicDetails/);
  assert.match(view, /class="term-show">Show</);
});

test("field borders are 3:1 in every look, and the off switch is a mid grey", () => {
  assert.match(read("public/js/appearance.js"), /function fieldLine/);
  assert.match(read("public/css/alertRules.css"), /\.ns-track \{[^}]*background: #7890b2/);
  assert.match(read("public/css/classSettings.css"), /\.cset-switch__track \{[^}]*background: #7890b2/);
});
