const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("safeAreas.css clamps header pop-ups and uses safe-area insets", () => {
  const css = read("public/css/safeAreas.css");
  assert.match(css, /max-width: calc\(100vw - 16px\)/);
  assert.match(css, /max-height: calc\(100dvh - var\(--header-height, 64px\) - 16px\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /env\(safe-area-inset-left/);
  assert.match(css, /env\(safe-area-inset-top/);
});
test("safeAreas.css is in the shared bundle", () => {
  assert.match(read("utils/cssBundle.js"), /"safeAreas", "flatPhone", "guardian", "a11y"/);
});
test("headerMenu.js clamps panels to 8px from each edge", () => {
  const js = read("public/js/headerMenu.js");
  assert.match(js, /__mgHeaderClamp/);
  assert.match(js, /vw - M - r\.right/);
  assert.match(js, /--mobile-search-expanded-width/);
});
