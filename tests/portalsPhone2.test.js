const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const css = read("public", "css", "portalsPhone2.css");

test("portalsPhone2.css: every rule sits inside the 640px media query", () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = stripped.indexOf("@media (max-width: 640px) {");
  assert.ok(start >= 0);
  assert.strictEqual(stripped.slice(0, start).trim(), "");
  let depth = 0, end = -1;
  for (let i = start; i < stripped.length; i += 1) {
    if (stripped[i] === "{") depth += 1;
    if (stripped[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.strictEqual(stripped.slice(end + 1).trim(), "");
});

test("portalsPhone2.css pins one opaque first column and a fixed header on the grade tables", () => {
  assert.match(css, /border-collapse: separate !important/);
  assert.match(css, /border-spacing: 0 !important/);
  assert.match(css, /:first-child \{ position: sticky !important; left: 0 !important[^}]*width: 104px[^}]*background: #fff !important/);
  assert.match(css, /thead th \{ position: sticky; top: 0[^}]*height: 48px/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
});

test("portalsPhone2.css keeps switches, PayGira buttons and Start at tap size", () => {
  assert.match(css, /\.ns-switch input \{ inset: -10px -6px/);
  assert.match(css, /\.pg-bill-actions \.pg-btn \{[^}]*height: 40px/);
  assert.match(css, /\.tr-btn \{ height: 44px/);
});

test("the Academic info, Grades, Teachers, Alerts, PayGira and Testing Room pages link portalsPhone2.css", () => {
  for (const f of ["guardian/studentAcademicDetails.ejs", "guardian/childTeachers.ejs", "guardian/childAlerts.ejs", "guardian/paygira.ejs", "student/dashboard.ejs", "student/testingRoom.ejs"]) {
    assert.match(read("views", f), /css\/portalsPhone2\.css/, f);
  }
});
