"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("teacher cards: phone rules live in the 640px query of teachersPhone.css", () => {
  const css = read("public/css/teachersPhone.css");
  const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
  assert.ok(css.includes("@media (max-width: 640px)"));
  for (const needle of [".tc-card", ".tc-photos", "scroll-snap-type", "-webkit-line-clamp: 3", ".tc-more", ".sp-modal-close", "env(safe-area-inset-bottom"]) {
    assert.ok(phone.includes(needle), needle + " missing from the phone rules");
  }
  assert.match(phone, /\.tc-avatar \{ width: 40px; height: 40px/);
  assert.match(phone, /\.tc-photos a \{[^}]*width: 72px; height: 72px/);
});

test("teacher cards: markup has the role pill, More toggle and photo hooks, no inline handlers", () => {
  const ejs = read("views/partials/teacherCards.ejs");
  assert.ok(ejs.includes("teachersPhone.css") && ejs.includes("/js/teacherCards.js"));
  assert.ok(ejs.includes('class="tc-role"') && ejs.includes("data-tc-more") && ejs.includes('aria-expanded="false"') && ejs.includes("data-tc-photo"));
  assert.ok(!/\son[a-z]+\s*=/.test(ejs), "no inline on* handlers");
  const js = read("public/js/teacherCards.js");
  assert.ok(js.includes("Escape") && js.includes("aria-expanded"));
});

test("settings pages: Notifications come before Appearance (parent, student, driver)", () => {
  const checks = [
    ["views/student/settings.ejs", 'id="notifications"', 'id="appearance"'],
    ["views/driver/settings.ejs", 'id="notifications"', 'id="drvAppearance"'],
    ["views/guardian/settings.ejs", 'id="notifications"', "ap-card"],
  ];
  for (const [file, notif, appear] of checks) {
    const src = read(file);
    const a = src.indexOf(notif);
    const b = src.indexOf(appear);
    assert.ok(a > -1 && b > -1, file + " is missing a section");
    assert.ok(a < b, file + ": notifications must precede appearance");
  }
});

test("settings pages: phone rules for the appearance tiles (3 across) and sticky save bar", () => {
  const css = read("public/css/portalsPhone2.css");
  assert.match(css, /\.ap-picker\) \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.ns-savebar \{ position: sticky; bottom: 0/);
  assert.ok(read("views/driver/settings.ejs").includes("portalsPhone2.css"));
});
