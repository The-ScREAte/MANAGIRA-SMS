const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../public/css/studentPhone.css"), "utf8");
const view = fs.readFileSync(path.join(__dirname, "../views/common/studentDetails.ejs"), "utf8");

test("studentPhone.css: every rule sits inside the 640px query", () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  const outside = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media \(max-width: 640px\) \{[\s\S]*\}\s*$/, "").trim();
  assert.equal(outside, "");
});

test("studentPhone.css: header, tabs, tiles and table rules exist", () => {
  for (const needle of [".sd-head__photo img { width: 44px", ".sd-btn--icon", "overflow-x: auto", "scroll-snap-type", "height: 34px", ".pf-stats", "border-collapse: separate", "position: sticky; left: 0", "height: 48px"]) {
    assert.ok(css.includes(needle), "missing " + needle);
  }
});

test("studentDetails view links the phone stylesheet, labels icon buttons, has no inline handlers", () => {
  assert.match(view, /css\/studentPhone\.css/);
  assert.match(view, /id="student-password-reset-btn"[^>]*aria-label=/);
  assert.match(view, /id="student-password-reset-btn"[\s\S]{0,300}title=/);
  assert.doesNotMatch(view, /\son(click|change|submit|input)=/i);
});
