"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { round2, percentOf } = require("../utils/termTotals");

// One percentage everywhere: two decimals, halves up, however the machine holds the division.
test("percentOf rounds halves up like a person (89.995 is 90.00)", () => {
  assert.equal(percentOf(179.99, 200), 90);
  assert.equal(percentOf(159.99, 200), 80);
  assert.equal(percentOf(139.99, 200), 70);
  assert.equal(percentOf(179.98, 200), 89.99);
  assert.equal(percentOf(171, 200), 85.5);
  assert.equal(percentOf(136.9, 200), 68.45);
});

test("percentOf has no answer without a maximum, and 0 is a real score", () => {
  assert.equal(percentOf(0, 0), null);
  assert.equal(percentOf(5, 0), null);
  assert.equal(percentOf(0, 20), 0);
  assert.equal(percentOf(25, 20), 125);
});

test("percentOf agrees with exact decimal arithmetic on many scores", () => {
  const maxes = [20, 30, 50, 100, 200, 220, 17, 75];
  for (let i = 0; i < 20000; i += 1) {
    const max = maxes[i % maxes.length];
    const cents = Math.floor(((i * 7919) % (max * 110)) );
    const total = cents / 100;
    const exact = Number((2n * BigInt(cents) * 10000n + BigInt(max * 100)) / (2n * BigInt(max * 100))) / 100;
    assert.equal(percentOf(total, max), exact, `${total}/${max}`);
  }
});

test("round2 keeps two decimals", () => {
  assert.equal(round2(7.555), 7.56);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(17.55 + 8.25 + 33.33 + 77.77), 136.9);
});
