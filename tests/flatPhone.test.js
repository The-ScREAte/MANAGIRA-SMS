const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "flatPhone.css"), "utf8");
const bundle = fs.readFileSync(path.join(__dirname, "..", "utils", "cssBundle.js"), "utf8");
const finance = fs.readFileSync(path.join(__dirname, "..", "views", "account", "finance.ejs"), "utf8");

test("flatPhone.css: every rule sits inside the 640px media query", () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = stripped.indexOf("@media (max-width: 640px) {");
  assert.ok(start >= 0, "has the phone media query");
  assert.strictEqual(stripped.slice(0, start).trim(), "", "nothing before the media query");
  let depth = 0, end = -1;
  for (let i = start; i < stripped.length; i += 1) {
    if (stripped[i] === "{") depth += 1;
    if (stripped[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.strictEqual(stripped.slice(end + 1).trim(), "", "nothing after the media query");
});

test("flatPhone.css flattens the hub workspace card and the PayGira filter is icon-only", () => {
  assert.match(css, /\.hub-main[\s\S]*?:has\([\s\S]*?\.embed-iframe\)[\s\S]*?border: 0 !important/);
  assert.match(css, /\.fin-filter-fold > summary > span \{ display: none; \}/);
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
});

test("flatPhone.css is in the shared bundle and linked from the PayGira page", () => {
  assert.match(bundle, /"flatPhone"/);
  assert.match(finance, /href="\/css\/flatPhone\.css"/);
  assert.match(finance, /aria-label="Filter"/);
});
