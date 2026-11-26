const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const css = read("public", "css", "portalsPhone.css");

test("portalsPhone.css: every rule sits inside the 640px media query", () => {
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

test("portalsPhone.css sets the 12px gutter, the type scale and two tiles per row", () => {
  assert.match(css, /padding: 8px 12px 28px/);
  assert.match(css, /font-size: 19px[^}]*font-weight: 700/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /\.app-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("every parent and student page links portalsPhone.css", () => {
  const skip = new Set(["calendar.ejs", "takeAssessment.ejs", "takeAssessmentNext.ejs"]);
  ["guardian", "student"].forEach((dir) => {
    fs.readdirSync(path.join(root, "views", dir)).filter((f) => f.endsWith(".ejs") && !skip.has(f)).forEach((f) => {
      assert.match(read("views", dir, f), /css\/portalsPhone\.css/, `${dir}/${f} links the phone stylesheet`);
    });
  });
});

test("the family calendar shares the school calendar's stylesheets and layout", () => {
  const view = read("views", "guardian", "calendar.ejs");
  const staff = read("views", "common", "calendar.ejs");
  ["calendar.css", "calendarPhone.css"].forEach((f) => {
    assert.match(view, new RegExp(`css/${f.replace(".", "\\.")}`));
    assert.match(staff, new RegExp(`css/${f.replace(".", "\\.")}`));
  });
  ["data-cal-filter", "data-cal-day", "data-cal-peek", "data-cal-upcoming", "cal-side__head"].forEach((a) => assert.ok(view.includes(a), a));
  const js = read("public", "js", "familyCalendar.js");
  assert.match(js, /dayMaxEvents: isPhone \? 2 : true/);
  assert.match(js, /weekday: 'narrow'/);
  assert.doesNotMatch(view + js, /\son(click|change|submit)=/);
});
