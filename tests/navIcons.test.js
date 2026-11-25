"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { NAV_ICONS, navIcon } = require("../utils/navIcons");
const { build } = require("../scripts/buildNavIconsClient");

// Same meaning, same picture: these names are deliberate aliases (all settings use one gear, "Your hub" is a dashboard).
const ALIASES = [["settings", "reportSettings", "admissionSettings", "paygiraSettings"], ["dashboard", "hub"], ["security", "access"], ["classSettings", "sliders"], ["calendarCheck", "attendance"], ["schoolYears", "term"], ["enrollment", "busAccess"]];

test("two names share a drawing only when they mean the same thing", () => {
  const byBody = new Map();
  for (const [name, body] of Object.entries(NAV_ICONS)) byBody.set(body, [...(byBody.get(body) || []), name]);
  for (const names of byBody.values()) {
    if (names.length < 2) continue;
    assert.ok(ALIASES.some((group) => names.every((n) => group.includes(n))), `${names.join(", ")} share a drawing`);
  }
});

test("pages that must look different each have their own icon", () => {
  const pages = ["security", "twoStep", "tenantConfig", "singleSignOn", "accessTokens", "classSettings", "settings", "enrollment", "migration", "mailroom", "briefing", "addStudent", "admissions", "testingRoom", "questions", "teachers", "staff", "academic", "stats", "lunch", "dashboard"];
  for (const name of pages) assert.ok(NAV_ICONS[name], `${name} is missing`);
  assert.equal(new Set(pages.map((name) => NAV_ICONS[name])).size, pages.length);
});

test("an icon is decorative: hidden from screen readers, drawn in the current colour", () => {
  const svg = navIcon("settings", { size: 18 });
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /width="18"/);
  assert.match(navIcon("settings"), /width="20"/, "20px unless a size is given");
  assert.match(svg, /stroke-width="2"/);
});

test("the browser copy of the icons is current (node scripts/buildNavIconsClient.js)", () => {
  const file = fs.readFileSync(path.join(__dirname, "..", "public", "js", "navIconsClient.js"), "utf8");
  assert.equal(file, build());
});
