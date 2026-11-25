const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { compare, judge } = require("../utils/questionMarks");

// A stand-in for the transaction's client: remembers the out-of update and says whether scores exist.
const fakeDb = (recorded) => {
  const updates = [];
  return {
    updates,
    query: async (sql, params) => {
      if (/FROM assessment_results/.test(sql)) return { rows: recorded ? [{}] : [] };
      if (/UPDATE assessments SET max_score/.test(sql)) { updates.push(params); return { rows: [] }; }
      throw new Error("unexpected query: " + sql.slice(0, 50));
    },
  };
};
const ask = (db, total, outOf, decision) => judge(db, { assessmentId: 7, organizationId: 63, total, outOf, decision });

test("marks that add up to the out of save without a question", async () => {
  const db = fakeDb(false);
  const verdict = await ask(db, 20, 20, "ask");
  assert.equal(verdict.go, true);
  assert.equal(verdict.marks.matches, true);
  assert.equal(compare(19.999, 20).matches, true);
  assert.equal(compare("14", "20").matches, false);
});

test("a caller that sends no marksCheck saves as before", async () => {
  const verdict = await ask(fakeDb(false), 14, 20, undefined);
  assert.equal(verdict.go, true);
  assert.equal(verdict.marks.total, 14);
  assert.equal(verdict.marks.outOf, 20);
});

test("different marks stop the save and say what each choice can do", async () => {
  const none = await ask(fakeDb(false), 14, 20, "ask");
  assert.equal(none.go, false);
  assert.equal(none.status, 409);
  assert.equal(none.body.marksDiffer, true);
  assert.equal(none.body.error, "Questions add up to 14, but the test is out of 20.");
  assert.deepEqual({ ...none.body.marks }, { total: 14, outOf: 20, over: false, canSetOutOf: true, canSaveAnyway: true });
  const scored = await ask(fakeDb(true), 14, 20, "ask");
  assert.equal(scored.body.marks.canSetOutOf, false);
  assert.equal(scored.body.marks.canSaveAnyway, true);
  const over = await ask(fakeDb(false), 22, 20, "ask");
  assert.equal(over.body.marks.over, true);
  assert.equal(over.body.marks.canSaveAnyway, false);
});

test("Set out of changes the test only while no score is recorded", async () => {
  const db = fakeDb(false);
  const verdict = await ask(db, 14, 20, "setOutOf");
  assert.equal(verdict.go, true);
  assert.deepEqual(db.updates, [[14, 7, 63]]);
  assert.equal(verdict.marks.outOf, 14);
  assert.equal(verdict.marks.changed, true);
  const scoredDb = fakeDb(true);
  const refused = await ask(scoredDb, 14, 20, "setOutOf");
  assert.equal(refused.go, false);
  assert.equal(scoredDb.updates.length, 0);
});

test("Save anyway works below the out of, never above it", async () => {
  assert.equal((await ask(fakeDb(true), 14, 20, "anyway")).go, true);
  const over = await ask(fakeDb(false), 22, 20, "anyway");
  assert.equal(over.go, false);
  assert.equal(over.status, 409);
});

test("the question builders save through the marks check, and the server asks before saving", () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  for (const view of ["views/common/allClassAssessmentExams.ejs", "views/common/assessment.ejs"]) {
    const source = read(view);
    assert.match(source, /QuestionMarks\.post\(["']\/common\/assessment\/questions\/upsert/, view);
    assert.match(source, /js\/questionMarks\.js/, view);
    assert.doesNotMatch(source, /cannot exceed assessment max score/, view);
  }
  assert.match(read("views/common/allClassAssessmentExams.ejs"), /QuestionMarks\.post\(['"]\/common\/assessment\/questions\/reuse/);
  const controller = read("controllers/commonController.js");
  assert.equal((controller.match(/utils\/questionMarks"\)\.judge/g) || []).length, 2);
  const client = read("public/js/questionMarks.js");
  assert.match(client, /marksCheck: 'ask'/);
  assert.match(client, /'Set out of to '/);
  assert.match(client, /'Save anyway'/);
});
