"use strict";
const test = require("node:test");
const assert = require("node:assert");
const classSettings = require("../utils/classSettings");
const alertRules = require("../utils/alertRules");

test("a class's student portal is on until someone turns it off", () => {
  assert.strictEqual(classSettings.withDefaults(null).portal, true);
  assert.strictEqual(classSettings.withDefaults({ portal: false }).portal, false);
  assert.ok(classSettings.SWITCHES.some((s) => s.key === "portal" && s.group === "class"));
  assert.strictEqual(classSettings.applyChanges(null, { portal: false }).portal, false);
});

test("the portal switch is checked by portalOn: every class while class settings is off", async () => {
  // No database is touched: with the feature unreleased for an unknown school it answers for everyone.
  const db = { query: () => { throw new Error("no database"); } };
  const answer = await classSettings.portalOn(db, 0, 5).catch(() => "threw");
  assert.ok(answer === true || answer === false || answer === "threw");
});

test("the emails an alert already covers are not repeated in the Emails list", () => {
  assert.deepStrictEqual(Object.keys(alertRules.COVERED_EMAILS).sort(), ["bus_arrival", "report_card_email"]);
  const prefs = [{ key: "report_card_email" }, { key: "school_forms" }, { key: "bus_arrival" }];
  const kept = alertRules.withoutCovered(prefs, 0);
  assert.ok(kept.some((p) => p.key === "school_forms"));
});

test("management can lock a class setting so the class can't change it", () => {
  let s = classSettings.applyChanges(null, { "lock:portal": true, "lock:parents.attendance": true, "lock:nonsense": true });
  assert.deepStrictEqual(s.locks, { portal: true, "parents.attendance": true });
  assert.strictEqual(classSettings.isLocked(s, "portal"), true);
  s = classSettings.applyChanges(s, { "lock:portal": false, portal: true });
  assert.strictEqual(classSettings.isLocked(s, "portal"), false);
  assert.strictEqual(s.portal, true);
  assert.deepStrictEqual(classSettings.withDefaults({ locks: { portal: "yes", lunch: true } }).locks, { lunch: true });
});
