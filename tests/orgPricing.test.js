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
  assert.deepEqual(overrides, { monthlyPrice: 1200, discountPercent: 5, addonPrices: { mira: 3.5, transportation: 0 }, notes: "agreed" });
  assert.equal(orgPricing.parseOverrides({ monthlyPrice: "" }).overrides.monthlyPrice, null);
  assert.ok(orgPricing.parseOverrides({ discountPercent: "95" }).errors.length);
  assert.ok(orgPricing.parseOverrides({ addons: { mira: { mode: "own", price: "" } } }).errors.length);
  assert.ok(orgPricing.parseOverrides({ monthlyPrice: "-5" }).errors.length);
});

test("one add-on list for schools and hubs: per school, or per seat where people get access", () => {
  const keys = hubBilling.INTEGRATIONS.map((i) => i.key);
  ["mira", "student_portal", "parent_portal", "whatsapp", "sms", "transportation", "maps", "google_classroom"].forEach((key) => assert.ok(keys.includes(key), key));
  // Mira and the parent portal start per seat; the student portal per school, as before.
  assert.equal(hubBilling.unitLabel("mira"), "per staff seat");
  assert.equal(hubBilling.unitLabel("parent_portal"), "per parent with access");
  assert.equal(hubBilling.unitLabel("student_portal"), "per school");
  assert.equal(hubBilling.unitLabel("student_portal", "seat"), "per student with access");
  assert.equal(hubBilling.unitLabel("mira", "school"), "per school");
  // Add-ons nobody gets one by one are only per school.
  ["whatsapp", "sms", "transportation", "maps", "google_classroom"].forEach((key) => {
    assert.deepEqual(hubBilling.unitsFor(key), ["school"], key);
    assert.equal(hubBilling.unitOf(key, "seat"), "school", key);
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
