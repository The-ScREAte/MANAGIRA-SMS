const test = require("node:test");
const assert = require("node:assert");
const alertRules = require("../utils/alertRules");

test("each kind of person is offered only their own alerts", () => {
  assert.deepStrictEqual(alertRules.kindsFor("guardian"), ["score_below", "score_above", "report_card", "absent", "bus_near", "bus_arrived"]);
  // Bus alerts exist only where the school has transportation on.
  assert.deepStrictEqual(alertRules.kindsFor("guardian", { transportation: false }), ["score_below", "score_above", "report_card", "absent"]);
  assert.deepStrictEqual(alertRules.kindsFor("driver", { transportation: false }), []);
  assert.deepStrictEqual(alertRules.kindsFor("student", { transportation: false }), ["score_below", "score_above"]);
  assert.deepStrictEqual(alertRules.kindsFor("student", { transportation: true }), ["score_below", "score_above", "bus_near", "bus_arrived"]);
  assert.deepStrictEqual(alertRules.kindsFor("teacher"), ["score_below", "score_above"]);
  assert.deepStrictEqual(alertRules.kindsFor("driver"), ["rider_not_coming"]);
});

test("a driver is a driver, any other member of staff a teacher-style audience", () => {
  assert.strictEqual(alertRules.audienceOf("Driver"), "driver");
  assert.strictEqual(alertRules.audienceOf("Teacher"), "teacher");
  assert.strictEqual(alertRules.audienceOf("Manager"), "teacher");
});

test("defaults never text anyone, and email only what the school already sent", () => {
  const already = new Set(["report_card", "bus_near", "bus_arrived"]);
  for (const rules of Object.values(alertRules.DEFAULTS)) {
    for (const rule of rules) {
      assert.ok(!rule.channels.includes("sms"), rule.kind);
      if (!already.has(rule.kind)) assert.ok(rule.channels.every((c) => c === "bell" || c === "digest"), rule.kind);
    }
  }
});

test("the weekly briefing row escapes what it prints", () => {
  const row = alertRules.digestRows([{ id: 1, title: "<img src=x onerror=alert(1)>", body: "a & b" }]);
  assert.ok(!row.value.includes("<img"));
  assert.ok(row.value.includes("&amp;"));
  assert.strictEqual(alertRules.digestRows([]), null);
});
