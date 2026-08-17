const test = require("node:test");
const assert = require("node:assert/strict");

const { estimateCost } = require("../services/usageLedger");

test("estimateCost: known model computes proportional cost", () => {
  const cost = estimateCost("gpt-4o-mini", 1_000_000, 0);
  assert.equal(cost, 0.15); // $0.15 per 1M prompt tokens
});

test("estimateCost: completion tokens priced separately from prompt tokens", () => {
  const cost = estimateCost("claude-sonnet-4-5", 0, 1_000_000);
  assert.equal(cost, 15); // $15 per 1M completion tokens
});

test("estimateCost: unknown model falls back to mock (zero cost) rather than throwing", () => {
  const cost = estimateCost("some-future-model", 1_000_000, 1_000_000);
  assert.equal(cost, 0);
});

test("estimateCost: zero tokens is zero cost", () => {
  assert.equal(estimateCost("gpt-4o-mini", 0, 0), 0);
});
