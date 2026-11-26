const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// Everything phone-specific must sit inside a max-width:640px query (the single top-level
// min-width:641px block in calendarPhone.css only hides phone-only controls on wider screens).
function outsideQueries(css) {
  let out = "";
  let depth = 0;
  let inQuery = false;
  let buf = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") { if (depth === 0 && /@media/.test(buf)) inQuery = true; depth += 1; if (depth === 1 && !inQuery) out += buf; buf = depth === 1 ? "" : buf + ch; continue; }
    if (ch === "}") { depth -= 1; if (depth === 0) inQuery = false; buf = ""; continue; }
    buf += ch;
  }
  return out;
}

test("phone stylesheets keep rules inside @media queries", () => {
  for (const f of ["public/css/calendarPhone.css", "public/css/admissionsPhone.css"]) {
    const css = read(f);
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.strictEqual(outsideQueries(css).trim(), "", f + " has rules outside a media query");
    assert.doesNotMatch(css, /(^|[^-])\bheight:\s*\d+px\s*;[^}]*overflow-y/, "no fixed row heights");
    assert.doesNotMatch(css, /tr[^{]*\{[^}]*[^-]height:\s*\d+px/, "no fixed table-row heights");
  }
});

test("views link the phone stylesheets", () => {
  assert.match(read("views/common/calendar.ejs"), /calendarPhone\.css/);
  for (const v of ["admissionPending", "closeGraduationYearGroup", "archivedStudents", "admissionSettings"]) {
    assert.match(read(`views/common/${v}.ejs`), /admissionsPhone\.css/, v);
  }
});

test("inputs stay 16px on the phone admissions and calendar sheets", () => {
  assert.match(read("public/css/admissionsPhone.css"), /font-size: 16px/);
});
