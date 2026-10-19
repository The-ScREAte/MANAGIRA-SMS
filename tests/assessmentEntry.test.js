const test = require("node:test");
const assert = require("node:assert");
const entry = require("../utils/assessmentEntry");

test("choices without points don't count in totals", () => {
  const r = entry.normalizeChoiceOptions([{ label: "Yes" }, { label: "No" }]);
  assert.ok(r.ok);
  assert.strictEqual(r.countsInTotal, false);
  assert.strictEqual(r.maxScore, 0);
});

test("choices with points count, out of the highest choice", () => {
  const r = entry.normalizeChoiceOptions([{ label: "Yes", points: 5 }, { label: "No", points: 0 }]);
  assert.ok(r.ok);
  assert.strictEqual(r.countsInTotal, true);
  assert.strictEqual(r.maxScore, 5);
});

test("choices must be valid", () => {
  assert.ok(!entry.normalizeChoiceOptions([{ label: "Yes" }]).ok, "at least two");
  assert.ok(!entry.normalizeChoiceOptions([{ label: "Yes" }, { label: "yes" }]).ok, "no duplicates");
  assert.ok(!entry.normalizeChoiceOptions([{ label: "Yes", points: 1 }, { label: "No" }]).ok, "all or none have points");
  assert.ok(!entry.normalizeChoiceOptions([{ label: "Yes", points: 0 }, { label: "No", points: 0 }]).ok, "something above 0");
  assert.ok(!entry.normalizeChoiceOptions([{ label: "A", points: -1 }, { label: "B", points: 1 }]).ok, "no negative points");
});

test("a picked choice resolves by label (any case) or by its points", () => {
  const a = { entry_mode: "choice", choice_options: [{ label: "Pass", points: 10 }, { label: "Fail", points: 0 }] };
  assert.deepStrictEqual(entry.resolveChoice(a, "pass"), { label: "Pass", points: 10 });
  assert.deepStrictEqual(entry.resolveChoice(a, "0"), { label: "Fail", points: 0 });
  assert.strictEqual(entry.resolveChoice(a, "Maybe"), null);
  const plain = { entry_mode: "choice", choice_options: [{ label: "Yes", points: null }, { label: "No", points: null }] };
  assert.deepStrictEqual(entry.resolveChoice(plain, "YES"), { label: "Yes", points: null });
});

test("an online test mark earns the choice at or below it", () => {
  const a = { entry_mode: "choice", choice_options: [{ label: "Distinction", points: 8 }, { label: "Pass", points: 5 }, { label: "Fail", points: 0 }] };
  assert.strictEqual(entry.choiceForScore(a, 9).label, "Distinction");
  assert.strictEqual(entry.choiceForScore(a, 6.5).label, "Pass");
  assert.strictEqual(entry.choiceForScore(a, 2).label, "Fail");
  const plain = { entry_mode: "choice", choice_options: [{ label: "Yes" }, { label: "No" }] };
  assert.strictEqual(entry.choiceForScore(plain, 9), null, "no points: the teacher picks");
});

test("score assessments are not choices", () => {
  assert.strictEqual(entry.isChoice({ entry_mode: "score" }), false);
  assert.strictEqual(entry.isChoice({ entry_mode: "choice", choice_options: [] }), false);
  assert.strictEqual(entry.choiceSummary({ choice_options: [{ label: "Yes" }, { label: "No" }] }), "Yes / No");
});
