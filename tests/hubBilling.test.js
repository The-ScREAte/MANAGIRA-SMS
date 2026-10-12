const test = require("node:test");
const assert = require("node:assert");
const {
  computeBill,
  parseContractForm,
  firstChargeAt,
  cancelAtFor,
  couponSpec,
  wholeMonthsBetween,
  discountLabel,
  hasPrice,
} = require("../utils/hubBilling");

const base = {
  billing_cycle: "term",
  meters: { student: { on: true, price: 2, included: 1000 } },
  integration_fees: {},
  base_fee: 0,
  discount_type: "none",
  discount_value: 0,
  discount_duration: "forever",
  currency: "usd",
};

test("bills at least the included students", () => {
  const bill = computeBill(base, { students: 640, employees: 40, users: 300 }, []);
  assert.strictEqual(bill.meters.student.billed, 1000);
  assert.strictEqual(bill.total, 2000);
  assert.strictEqual(bill.cycle.months, 4);
});

test("students above the plan are charged at the same price", () => {
  const bill = computeBill(base, { students: 1250 }, []);
  assert.strictEqual(bill.meters.student.billed, 1250);
  assert.strictEqual(bill.total, 2500);
  assert.match(bill.lines[0].note, /250 more/);
});

test("student, employee and user charges can all be on at once", () => {
  const billing = { ...base, meters: {
    student: { on: true, price: 1, included: 0 },
    employee: { on: true, price: 5, included: 10 },
    user: { on: true, price: 0.5, included: 0 },
  } };
  const bill = computeBill(billing, { students: 100, employees: 14, users: 220 }, []);
  assert.strictEqual(bill.total, 100 + 70 + 110);
  assert.deepStrictEqual(bill.lines.map((l) => l.key), ["meter:student", "meter:employee", "meter:user"]);
});

test("switched-off charges are not billed", () => {
  const billing = { ...base, meters: { student: { on: false, price: 2, included: 10 }, employee: { on: true, price: 3, included: 0 } } };
  assert.strictEqual(computeBill(billing, { students: 500, employees: 4 }).total, 12);
});

test("auto integration fees bill each school that uses it; manual ones don't", () => {
  const billing = { ...base, meters: {}, base_fee: 10, integration_fees: {
    mira: { on: true, price: 20, mode: "auto" },
    whatsapp: { on: true, price: 15, mode: "manual" },
    sms: { on: false, price: 9, mode: "auto" },
  } };
  const bill = computeBill(billing, { integrations: { mira: 3, whatsapp: 2, sms: 4 } }, []);
  assert.strictEqual(bill.total, 10 + 60);
  assert.ok(bill.lines.some((l) => l.key === "integration:mira" && l.quantity === 3));
});

test("extra schools and hub licenses come from the real numbers", () => {
  const billing = { ...base, extra_school_price: 40, extra_user_price: 10 };
  const bill = computeBill(billing, { students: 0, schools: 7, schoolsIncluded: 5, hubPeople: 4, seatsIncluded: 3 }, []);
  assert.strictEqual(bill.total, 2000 + 80 + 10);
  // No price for extras: not billed.
  assert.strictEqual(computeBill(base, { schools: 9, schoolsIncluded: 5 }).total, 2000);
});

test("plan fee, approved charges and one-time charges are added; pending ones are not", () => {
  const charges = [
    { charge_id: 1, status: "approved", frequency: "recurring", name: "SMS bundle", unit_price: 50, quantity: 2 },
    { charge_id: 2, status: "pending", frequency: "recurring", name: "Pending", unit_price: 30, quantity: 1 },
    { charge_id: 3, status: "approved", frequency: "once", name: "Training", unit_price: 100, quantity: 1 },
    { charge_id: 4, status: "approved", frequency: "once", name: "Old setup", unit_price: 80, quantity: 1, billed_at: new Date() },
  ];
  const bill = computeBill({ ...base, base_fee: 150 }, { students: 0 }, charges);
  assert.strictEqual(bill.total, 150 + 2000 + 100 + 100);
  assert.strictEqual(bill.recurringTotal, 150 + 2000 + 100);
  assert.ok(!bill.lines.some((l) => l.label === "Pending"));
});

test("percent and amount discounts", () => {
  assert.strictEqual(computeBill({ ...base, discount_type: "percent", discount_value: 10 }, { students: 0 }).total, 1800);
  assert.strictEqual(computeBill({ ...base, discount_type: "amount", discount_value: 5000 }, { students: 0 }).total, 0);
  assert.strictEqual(discountLabel({ ...base, discount_type: "percent", discount_value: 10, discount_duration: "repeating", discount_cycles: 3 }), "10% off the first 3 bills");
});

test("billing needs a price", () => {
  assert.strictEqual(hasPrice(base), true);
  assert.strictEqual(hasPrice({ ...base, meters: {} }), false);
  assert.strictEqual(hasPrice({ ...base, meters: {}, base_fee: 25 }), true);
  assert.strictEqual(hasPrice({ ...base, meters: { user: { on: false, price: 4 } } }), false);
});

test("first charge is the later of trial end and contract start, only if ahead", () => {
  const now = new Date("2026-10-12T09:00:00Z");
  assert.strictEqual(firstChargeAt({ trial_end_date: "2026-10-01" }, { contract_start_date: null }, now), null);
  const first = firstChargeAt({ trial_end_date: "2026-11-01" }, { contract_start_date: "2026-12-01" }, now);
  assert.strictEqual(first.toISOString(), "2026-12-01T12:00:00.000Z");
});

test("billing stops at the end date only when it doesn't renew", () => {
  assert.strictEqual(cancelAtFor({ auto_renew: true }, { contract_end_date: "2027-08-31" }), null);
  assert.strictEqual(cancelAtFor({ auto_renew: false }, { contract_end_date: "2027-08-31" }).toISOString(), "2027-08-31T12:00:00.000Z");
});

test("repeating discounts count from the first charge", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const b = { ...base, discount_type: "percent", discount_value: 20, discount_duration: "repeating", discount_cycles: 2 };
  assert.strictEqual(couponSpec(b, null, now).spec.duration_in_months, 8);
  const spec = couponSpec(b, new Date("2026-12-20T12:00:00Z"), now).spec;
  assert.strictEqual(spec.duration_in_months, 10);
  assert.strictEqual(spec.percent_off, 20);
  assert.strictEqual(couponSpec({ ...b, discount_duration: "once" }, null, now).spec.duration_in_months, 4);
  assert.strictEqual(couponSpec({ ...b, discount_duration: "forever" }, null, now).spec.duration, "forever");
  assert.strictEqual(couponSpec(base, null, now), null);
  assert.strictEqual(wholeMonthsBetween(new Date("2026-01-31T12:00:00Z"), new Date("2026-03-01T12:00:00Z")), 1);
});

test("contract form: switches, prices and checks", () => {
  const today = new Date("2026-10-12T09:00:00Z");
  const ok = parseContractForm({
    billingCycle: "year",
    meters: { student: { on: "1", price: "1,200.50", included: "40" }, employee: { price: "9" }, user: { on: "1", price: "2", included: "" } },
    integrations: { mira: { on: "1", price: "20", mode: "manual" }, sms: { on: "1", price: "5" }, whatsapp: { price: "7" } },
    baseFeeOn: "1", baseFee: "99",
    extraSchoolPrice: "75", extraUserPrice: "", autoRenew: "0", contractEndDate: "2027-09-30", countOnHold: "0",
    discountType: "percent", discountValue: "15", discountDuration: "repeating", discountCycles: "2",
    trialEnabled: "on", trialEndDate: "2026-11-01", billingEmail: "Accounts@Example.invalid",
  }, { today });
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.values.meters, { student: { on: true, price: 1200.5, included: 40 }, user: { on: true, price: 2, included: 0 } });
  assert.deepStrictEqual(ok.values.integration_fees, { mira: { on: true, price: 20, mode: "manual" }, sms: { on: true, price: 5, mode: "auto" } });
  assert.strictEqual(ok.values.base_fee, 99);
  assert.strictEqual(ok.values.count_on_hold, false);
  assert.strictEqual(ok.values.extra_user_price, null);
  assert.strictEqual(ok.values.auto_renew, false);
  assert.strictEqual(ok.values.trial_end_date, "2026-11-01");
  assert.strictEqual(ok.values.billing_email, "accounts@example.invalid");

  const bad = parseContractForm({
    meters: { employee: { on: "1", price: "" } }, integrations: { mira: { on: "1", price: "0" } },
    baseFeeOn: "1", baseFee: "", autoRenew: "0", contractEndDate: "2026-01-01",
    discountType: "percent", discountValue: "140", trialEnabled: "on",
  }, { today });
  assert.ok(bad.errors.some((e) => /price per employee/.test(e)));
  assert.ok(bad.errors.some((e) => /fee for Mira/.test(e)));
  assert.ok(bad.errors.some((e) => /plan fee/.test(e)));
  assert.ok(bad.errors.some((e) => /end date must be in the future/.test(e)));
  assert.ok(bad.errors.some((e) => /more than 100%/.test(e)));
  assert.ok(bad.errors.some((e) => /free trial ends/.test(e)));
});
