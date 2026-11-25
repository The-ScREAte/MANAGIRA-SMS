"use strict";
// Phone forms must not zoom on focus (iOS zooms into fields under 16px) and date fields must fit their card.
// The rules live at the end of both shared stylesheets so every page type (bundle, standalone pages, frames) gets them.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const block = (css) => css.slice(css.indexOf("/* ===== Phone forms"));

for (const file of ["public/css/a11y.css", "public/css/appearance.css"]) {
  test(`${file} keeps every phone field at 16px and date fields inside their container`, () => {
    const css = read(file);
    assert.ok(css.includes("/* ===== Phone forms"), "phone forms block present");
    const b = block(css);
    assert.match(b, /@media \(pointer: coarse\), \(max-width: 820px\)/);
    assert.match(b, /\[contenteditable="true"\]/);
    assert.match(b, /font-size: 16px !important/);
    for (const t of ["checkbox", "radio", "range", "color", "file"]) assert.ok(b.includes(`:not([type="${t}"])`), `${t} left alone`);
    for (const t of ["date", "time", "datetime-local", "month"]) assert.ok(b.includes(`[type="${t}"]`), `${t} styled`);
    assert.match(b, /max-width: 100% !important; min-width: 0 !important; box-sizing: border-box/);
    assert.match(b, /min-height: 44px !important/);
    assert.match(b, /-webkit-appearance: none; appearance: none/);
    assert.match(b, /::-webkit-date-and-time-value \{[^}]*text-align: left[^}]*min-height/);
    assert.match(b, /touch-action: manipulation/);
  });
}

test("the two copies of the phone block stay identical", () => {
  assert.strictEqual(block(read("public/css/a11y.css")), block(read("public/css/appearance.css")));
});

test("the phone block comes after the type scale that sets fields to 14px, and zoom stays allowed", () => {
  const app = read("public/css/appearance.css");
  assert.ok(app.indexOf("/* ===== Phone forms") > app.indexOf("--fs-body"));
  assert.match(read("utils/cssBundle.js"), /"guardian", "a11y"\]/); // a11y is last in the bundle
  assert.doesNotMatch(read("views/partials/head.ejs"), /maximum-scale|user-scalable\s*=\s*(no|0)/i);
});
