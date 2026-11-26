"use strict";
// The shared page header (public/css/pageHead.css): one row on a phone, icon-only secondary actions.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const css = read("public/css/pageHead.css");

test("pageHead.css defines the shared classes and the phone row", () => {
  for (const c of [".page-head", ".page-head__text", ".page-head__title", ".page-head__sub", ".page-head__actions", ".page-head__select", ".page-head__label", ".page-head__primary", ".btn-icon", ".ws-head", ".ws-btn__label"]) {
    assert.ok(css.includes(c), `${c} present`);
  }
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /min-width: 36px; height: 36px/);
  assert.match(css, /max-width: 140px/);
  assert.doesNotMatch(css, /font-size:\s*1[0-5]px[^;]*;[^}]*select/, "selects keep the 16px phone rule from a11y.css");
});

test("pageHead.css is in both shared bundles, before a11y.css", () => {
  const b = read("utils/cssBundle.js");
  assert.match(b, /"safeAreas", "flatPhone", "guardian", "a11y"\]/);
  assert.strictEqual((b.match(/"pageHead"/g) || []).length, 2);
});

test("School stats uses the shared header and keeps no header CSS of its own", () => {
  const v = read("views/stats/organizationStats.ejs");
  assert.match(v, /<header class="page-head">/);
  assert.match(v, /page-head__title/);
  assert.match(v, /page-head__actions/);
  assert.doesNotMatch(v, /\.os-(hero|title|subtitle|btn)\b/);
});

test("icon-only buttons in the converted headers carry an accessible name", () => {
  const files = ["views/stats/organizationStats.ejs", "views/common/manageEmployees.ejs", "views/common/guardians.ejs", "views/common/documents.ejs", "views/common/serviceAccounts.ejs", "views/common/customForms.ejs", "views/account/managePublicContent.ejs", "views/common/manageAssessment.ejs"];
  for (const f of files) {
    const s = read(f);
    const tags = (s.match(/<(?:button|a)\b(?:<%[\s\S]*?%>|[^>])*>/g) || []).filter((t) => /class="[^"]*\bbtn-icon\b/.test(t));
    for (const t of tags) assert.match(t, /aria-label="/, `${f}: ${t.slice(0, 80)}`);
  }
  for (const f of ["views/common/manageEmployees.ejs", "views/common/guardians.ejs"]) {
    assert.match(read(f), /id="uxFilterToggle" aria-label="Filters"/);
  }
});

test("the converted pages use the shared header, not their own", () => {
  for (const f of ["views/common/documents.ejs", "views/common/serviceAccounts.ejs", "views/common/customForms.ejs", "views/account/managePublicContent.ejs"]) {
    assert.match(read(f), /<header class="page-head/, f);
  }
  assert.doesNotMatch(read("views/common/documents.ejs"), /\.docs-header/);
});
