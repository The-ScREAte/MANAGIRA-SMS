const test = require("node:test");
const assert = require("node:assert");
const { rankOf, snippet, TYPES } = require("../utils/deepSearch");

test("an exact match ranks first, then starts-with, a word's start, and the rest", () => {
  assert.strictEqual(rankOf("Maria Lopez", "maria lopez"), 0);
  assert.strictEqual(rankOf("Maria Lopez", "mar"), 1);
  assert.strictEqual(rankOf("Ana Maria Lopez", "mar"), 2);
  assert.strictEqual(rankOf("Annamaria", "mar"), 3);
  assert.strictEqual(rankOf("Joseph", "mar"), 4);
  assert.strictEqual(rankOf("", "mar", "Lopez, Maria", "x"), 2);
});

test("what the person typed is never a pattern", () => {
  assert.doesNotThrow(() => rankOf("a.b", ".*"));
  assert.doesNotThrow(() => rankOf("(x)", "(" ));
  assert.strictEqual(rankOf("100%", "100%"), 0);
});

test("a snippet shows the words around the match", () => {
  const text = "x".repeat(200) + " allergy to peanuts " + "y".repeat(200);
  const s = snippet(text, "peanuts");
  assert.ok(s.includes("peanuts") && s.startsWith("…") && s.length < 140);
});

test("each kind of result has a label", () => {
  TYPES.forEach((t) => assert.ok(t.key && t.label));
});
