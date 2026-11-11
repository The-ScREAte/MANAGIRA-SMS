// The ways parents can pay online: only what Stripe has on, narrowed to the school's choice,
// card always; the PaymentIntent and the form get the same types, wallets ride on card.
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkoutFor, choicesFor, chosenBy, normalizeChoice } = require("../utils/stripeMethods");

const stripeHas = new Set(["card", "apple_pay", "link", "cashapp"]);

test("a school that never chose offers everything Stripe has on", () => {
  const out = checkoutFor(stripeHas, chosenBy({}));
  assert.deepEqual(out.types, ["card", "link", "cashapp"]);
  assert.deepEqual(out.expressWallets, { applePay: "auto", googlePay: "never" });
  assert.deepEqual(out.displayLabels, ["Card", "Apple Pay", "Link", "Cash App Pay"]);
});

test("a school's choice narrows it, and card is always kept", () => {
  const out = checkoutFor(stripeHas, chosenBy({ online_methods: ["apple_pay"] }));
  assert.deepEqual(out.types, ["card"]);
  assert.equal(out.expressWallets.applePay, "auto");
  assert.equal(out.expressMethods.link, "never");
  const none = checkoutFor(stripeHas, chosenBy({ online_methods: [] }));
  assert.deepEqual(none.types, ["card"]);
  assert.equal(none.expressWallets.applePay, "never");
});

test("a method Stripe doesn't have on is never offered, even if a school ticked it", () => {
  const out = checkoutFor(stripeHas, chosenBy({ online_methods: ["google_pay", "affirm", "venmo"] }));
  assert.deepEqual(out.types, ["card"]);
  assert.equal(out.expressWallets.googlePay, "never");
});

test("the settings list shows what Stripe has on, with the school's ticks", () => {
  const list = choicesFor(stripeHas, ["link"]);
  assert.deepEqual(list.map((m) => [m.id, m.on]), [["card", true], ["apple_pay", false], ["link", true], ["cashapp", false]]);
  assert.equal(list[0].fixed, true);
});

test("what a school saves is only known ids, card first", () => {
  assert.deepEqual(normalizeChoice(["link", "LINK", "venmo", "card", "apple_pay"]), ["card", "link", "apple_pay"]);
  assert.deepEqual(normalizeChoice(undefined), ["card"]);
  assert.deepEqual(normalizeChoice("cashapp"), ["card", "cashapp"]);
});
