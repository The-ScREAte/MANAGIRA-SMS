// The phone classroom stays put: no site footer, no zoom, one scroll owner, pinned gradebook columns that are opaque.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const phoneCss = read("public/css/classroomPhone.css");

test("the class dashboard is rendered without the site footer", () => {
  const src = read("controllers/commonController.js");
  const at = src.indexOf('res.render("common/classDashboard"');
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 200), /hideGlobalFooter:\s*true/);
  assert.ok(phoneCss.includes("body:has(.workspace-shell) footer.managira-footer { display: none !important"));
});

test("no CSS zoom on phones in the classroom styles", () => {
  const phoneBlocks = phoneCss.slice(phoneCss.indexOf("STABLE PHONE CLASSROOM"));
  assert.doesNotMatch(phoneBlocks, /(^|[;{\s])zoom\s*:/);
  assert.match(read("public/css/globalScale.css"), /max-width:\s*960px\)\s*\{\s*html\s*\{\s*zoom:\s*1/);
});

test("header card and tab row are not sticky on phones; frames fill a dvh-tall classroom", () => {
  assert.match(phoneCss, /\.workspace-header-card \{ position: static !important/);
  assert.match(phoneCss, /\.workspace-tabbar-shell \{ position: static !important/);
  assert.match(phoneCss, /height: 100dvh/);
});

test("gradebook pinned columns are opaque, narrow and above the scores", () => {
  const col1 = phoneCss.match(/table th:first-child, html body main \.table-container table td:first-child \{[^}]*\}/);
  const col2 = phoneCss.match(/table th:nth-child\(2\), html body main \.table-container table td:nth-child\(2\) \{[^}]*\}/);
  assert.ok(col1 && col2);
  assert.match(col1[0], /position: sticky/); assert.match(col1[0], /width: 28px/); assert.match(col1[0], /background: var\(--ap-surface/);
  assert.match(col2[0], /position: sticky/); assert.match(col2[0], /width: 96px/); assert.match(col2[0], /background: var\(--ap-surface/); assert.match(col2[0], /box-shadow/);
  assert.match(phoneCss, /border-collapse: separate !important/);
});

test("score inputs keep 16px text and the gradebook page marks its embed", () => {
  assert.match(phoneCss, /width: 68px; max-width: 100%; height: 32px;[^}]*font-size: 16px/);
  assert.match(read("views/common/assessment.ejs"), /data-cw-embed="1"/);
});
