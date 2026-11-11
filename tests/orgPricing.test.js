const test = require("node:test");
const assert = require("node:assert/strict");
const orgPricing = require("../utils/orgPricing");
const hubBilling = require("../utils/hubBilling");

test("a school's plan price: its own price or the standard one, less its discount", () => {
  const none = orgPricing.normalizeOverrides(null);
  assert.equal(orgPricing.planMonthly(65.99, none).monthly, 65.99);
  const own = orgPricing.normalizeOverrides({ custom_monthly_price: "99.00", custom_discount_percent: "10" });
  assert.deepEqual(orgPricing.planMonthly(65.99, own), { standard: 65.99, custom: 99, discountPercent: 10, monthly: 89.1 });
  // A discount alone applies to the standard price.
  assert.equal(orgPricing.planMonthly(50, orgPricing.normalizeOverrides({ custom_discount_percent: 20 })).monthly, 40);
  // Never more than the most a discount can be.
  assert.equal(orgPricing.normalizeOverrides({ custom_discount_percent: 100 }).discountPercent, orgPricing.MAX_DISCOUNT);
});

test("the pricing form: standard, own price or free for each add-on, and checked numbers", () => {
  const { errors, overrides } = orgPricing.parseOverrides({
    monthlyPrice: "$1,200",
    discountPercent: "5",
    notes: " agreed ",
    addons: { mira: { mode: "own", price: "3.5" }, transportation: { mode: "free" }, student_portal: { mode: "standard", price: "9" } },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(overrides, { monthlyPrice: 1200, discountPercent: 5, addonPrices: { mira: 3.5, transportation: 0 }, freeStudents: null, freeStudentsShown: false, notes: "agreed" });
  assert.equal(orgPricing.parseOverrides({ monthlyPrice: "" }).overrides.monthlyPrice, null);
  assert.ok(orgPricing.parseOverrides({ discountPercent: "95" }).errors.length);
  assert.ok(orgPricing.parseOverrides({ addons: { mira: { mode: "own", price: "" } } }).errors.length);
  assert.ok(orgPricing.parseOverrides({ monthlyPrice: "-5" }).errors.length);
});

test("one add-on list for schools and hubs: each per school or per seat", () => {
  const keys = hubBilling.INTEGRATIONS.map((i) => i.key);
  ["mira", "student_portal", "parent_portal", "whatsapp", "sms", "transportation", "maps", "google_classroom"].forEach((key) => assert.ok(keys.includes(key), key));
  // Mira and the parent portal start per seat; the student portal per school, as before.
  // Every add-on can be charged per school or per seat, and says who counts as a seat.
  hubBilling.INTEGRATIONS.forEach((addon) => {
    assert.deepEqual(hubBilling.unitsFor(addon.key), ["school", "seat"], addon.key);
    assert.ok(hubBilling.SEATS[addon.seat], `${addon.key} names a kind of seat`);
    assert.ok(hubBilling.seatWho(addon.key).startsWith("each "), addon.key);
  });
  assert.equal(hubBilling.unitLabel("transportation"), "per school", "per school unless per seat is chosen");
  assert.equal(hubBilling.unitLabel("transportation", "seat"), "per rider");
  assert.equal(hubBilling.unitLabel("maps", "seat"), "per driver");
  assert.equal(hubBilling.unitLabel("whatsapp", "seat"), "per student");
  assert.equal(hubBilling.seatCount("transportation", 12), "12 riders");
  assert.equal(hubBilling.unitLabel("mira"), "per staff seat");
  assert.equal(hubBilling.unitLabel("parent_portal"), "per parent with access");
  assert.equal(hubBilling.unitLabel("student_portal"), "per school");
  assert.equal(hubBilling.unitLabel("student_portal", "seat"), "per student with access");
  assert.equal(hubBilling.unitLabel("mira", "school"), "per school");
  // The ones that used to be per school only still are, until per seat is chosen for them.
  ["whatsapp", "sms", "transportation", "maps", "google_classroom"].forEach((key) => {
    assert.equal(hubBilling.unitOf(key), "school", key);
    assert.equal(hubBilling.unitOf(key, "seat"), "seat", key);
  });
});

test("a hub's add-on fees: each seat, or each school, as its plan says", () => {
  const billing = {
    billing_cycle: "month",
    integration_fees: {
      mira: { on: true, mode: "auto", price: 10 },
      parent_portal: { on: true, mode: "auto", price: 1, unit: "seat" },
      student_portal: { on: true, mode: "auto", price: 5, unit: "school" },
      whatsapp: { on: true, mode: "auto", price: 7 },
    },
    meters: {},
  };
  const usage = {
    integrationSchools: { mira: 2, parent_portal: 2, student_portal: 2, whatsapp: 2 },
    integrationSeats: { mira: 4, parent_portal: 120, student_portal: 300, whatsapp: 2 },
    schools: 2,
  };
  const lines = Object.fromEntries(hubBilling.computeBill(billing, usage, []).lines.map((l) => [l.key, l]));
  assert.equal(lines["integration:mira"].amount, 40);
  assert.match(lines["integration:mira"].note, /4 staff seats/);
  assert.equal(lines["integration:parent_portal"].amount, 120);
  assert.match(lines["integration:parent_portal"].note, /120 parents/);
  assert.equal(lines["integration:student_portal"].amount, 10);
  assert.equal(lines["integration:whatsapp"].amount, 14);
  assert.match(lines["integration:whatsapp"].note, /2 schools use it/);
});

test("free students: a number, or a share of the school's students", () => {
  const { computeDynamicMonthlyPrice } = require("../utils/dynamicPricing");
  const row = { base_price_usd: 30, free_student_threshold: 20, per_student_rate_usd: 3 };
  assert.equal(computeDynamicMonthlyPrice(row, 120, { termDivider: 3 }).monthlyTotal, 130);
  const share = computeDynamicMonthlyPrice({ ...row, free_student_percent: "10.00" }, 120, { termDivider: 3 });
  assert.equal(share.threshold, 12);
  assert.equal(share.freePercent, 10);
  assert.equal(share.monthlyTotal, 138);
});

// Free students for a school's first months only: after them every student is charged, and a
// bill that runs past them charges each month at its own price.
test("free students given for a time end after their months", () => {
  const { computeDynamicMonthlyPrice, averageMonthlyOverPeriod, monthsSince, freeStudentMonths } = require("../utils/dynamicPricing");
  const row = { base_price_usd: 39, free_student_threshold: 20, per_student_rate_usd: 2, free_student_months: 3 };
  assert.equal(computeDynamicMonthlyPrice(row, 50, { monthIndex: 0 }).monthlyTotal, 99);
  assert.equal(computeDynamicMonthlyPrice(row, 50, { monthIndex: 2 }).monthlyTotal, 99);
  const after = computeDynamicMonthlyPrice(row, 50, { monthIndex: 3 });
  assert.deepEqual([after.monthlyTotal, after.threshold, after.planThreshold, after.freeEnded], [139, 0, 20, true]);
  // A year paid in month 1: three months at 99, nine at 139.
  assert.equal(averageMonthlyOverPeriod(row, 50, { monthIndex: 0, periodMonths: 12 }), (3 * 99 + 9 * 139) / 12);
  // A share of students works the same way; no months means always.
  assert.equal(computeDynamicMonthlyPrice({ ...row, free_student_percent: 10 }, 50, { monthIndex: 5 }).threshold, 0);
  assert.equal(computeDynamicMonthlyPrice({ ...row, free_student_months: null }, 50, { monthIndex: 40 }).threshold, 20);
  assert.equal(freeStudentMonths({ free_student_months: "0" }), null);
  // Months count from the first paid day; before it, a school is in its first month.
  assert.equal(monthsSince("2026-08-15T00:00:00Z", "2026-11-14T00:00:00Z"), 2);
  assert.equal(monthsSince("2026-08-15T00:00:00Z", "2026-11-15T00:00:00Z"), 3);
  assert.equal(monthsSince(null), 0);
  assert.equal(monthsSince("2026-12-01T00:00:00Z", "2026-11-15T00:00:00Z"), 0);
});

// A school's own free students, in place of its price list's (Admin › Organizations › Pricing).
test("a school's own free students replace the price list's, for a time or always", () => {
  const { computeDynamicMonthlyPrice } = require("../utils/dynamicPricing");
  const own = orgPricing.parseOverrides({ freeStudents: { mode: "own", value: "40", unit: "count", months: "6" } });
  assert.deepEqual(own.overrides.freeStudents, { count: 40, percent: null, months: 6 });
  assert.equal(own.overrides.freeStudentsShown, true);
  assert.deepEqual(orgPricing.parseOverrides({ freeStudents: { mode: "own", value: "15", unit: "percent" } }).overrides.freeStudents, { count: 0, percent: 15, months: null });
  assert.equal(orgPricing.parseOverrides({ freeStudents: { mode: "standard" } }).overrides.freeStudents, null);
  // A form without the choice leaves it as it was.
  assert.equal(orgPricing.parseOverrides({}).overrides.freeStudentsShown, false);
  assert.match(orgPricing.parseOverrides({ freeStudents: { mode: "own", value: "4.5", unit: "count" } }).errors.join(" "), /whole number/);
  assert.match(orgPricing.parseOverrides({ freeStudents: { mode: "own", value: "120", unit: "percent" } }).errors.join(" "), /between 0 and 100/);
  const list = { base_price_usd: 79, free_student_threshold: 20, per_student_rate_usd: 2.8, free_student_months: 3 };
  const row = orgPricing.withSchoolFree(list, own.overrides.freeStudents);
  assert.equal(computeDynamicMonthlyPrice(row, 100, { monthIndex: 4 }).threshold, 40);
  assert.equal(computeDynamicMonthlyPrice(row, 100, { monthIndex: 6 }).threshold, 0);
  assert.equal(orgPricing.withSchoolFree(list, null), list);
  assert.deepEqual(orgPricing.normalizeOverrides({ custom_free_students: '{"count":40,"percent":null,"months":6}' }).freeStudents, { count: 40, percent: null, months: 6 });
});
