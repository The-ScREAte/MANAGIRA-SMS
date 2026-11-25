"use strict";

// A test's questions are worth some marks in all, and the test is "out of" some number. The
// gradebook gets the marks a student earns as they are (nothing is scaled), so when the two
// differ, 14 marks of questions on a test out of 20 can never reach 20/20. The teacher is told at
// save time and chooses; nothing is changed behind their back, and no stored score is touched.
//
// The save asks first (marksCheck: "ask"). When the totals differ, nothing is saved and the answer
// says what each choice would do:  "setOutOf" changes the test's out of to the questions' total
// (only while no score is recorded for it), "anyway" saves the questions as they are (only when
// they add up to less than the out of). A caller that sends no marksCheck saves as before.

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

function compare(total, outOf) {
  const t = round(total);
  const o = round(outOf);
  return { total: t, outOf: o, matches: !(o > 0) || Math.abs(t - o) < 0.005, over: o > 0 && t - o >= 0.005 };
}

// Whether any score, choice or posted grade exists for the test.
async function scoresRecorded(db, assessmentId, organizationId) {
  const { rows } = await db.query(
    `SELECT 1 FROM assessment_results
      WHERE assessment_id = $1 AND organization_id = $2
        AND (score IS NOT NULL OR choice_label IS NOT NULL OR posted_score IS NOT NULL OR posted_choice IS NOT NULL)
      LIMIT 1`,
    [assessmentId, organizationId]
  );
  return rows.length > 0;
}

const DECISIONS = new Set(["ask", "anyway", "setOutOf"]);

// What to do with a save of questions worth `total` for a test out of `outOf`.
//   { go: true, marks }                          save (marks goes back to the page)
//   { go: false, status, body }                  stop, nothing saved
// `db` is the transaction's client: setOutOf changes the test inside it.
async function judge(db, { assessmentId, organizationId, total, outOf, decision }) {
  const chosen = DECISIONS.has(decision) ? decision : "";
  const marks = compare(total, outOf);
  if (!chosen || marks.matches) return { go: true, marks: { ...marks, changed: false } };

  const recorded = await scoresRecorded(db, assessmentId, organizationId);
  const canSetOutOf = !recorded && marks.total > 0;
  const info = { total: marks.total, outOf: marks.outOf, over: marks.over, canSetOutOf, canSaveAnyway: !marks.over };
  const sentence = `Questions add up to ${marks.total}, but the test is out of ${marks.outOf}.`;

  if (chosen === "ask") {
    return { go: false, status: 409, body: { success: false, marksDiffer: true, marks: info, error: sentence } };
  }
  if (chosen === "setOutOf") {
    if (!canSetOutOf) {
      return { go: false, status: 409, body: { success: false, marksDiffer: true, marks: info, error: `${sentence} Scores are recorded, so the out of can't change.` } };
    }
    await db.query("UPDATE assessments SET max_score = $1 WHERE assessment_id = $2 AND organization_id = $3", [marks.total, assessmentId, organizationId]);
    return { go: true, marks: { total: marks.total, outOf: marks.total, matches: true, over: false, changed: true, previousOutOf: marks.outOf } };
  }
  // "anyway": fine below the out of; above it a student could earn more than the test is out of.
  if (marks.over) {
    return { go: false, status: 409, body: { success: false, marksDiffer: true, marks: info, error: `${sentence} Lower the marks or raise the out of.` } };
  }
  return { go: true, marks: { ...marks, changed: false } };
}

module.exports = { compare, scoresRecorded, judge, round };
