// Re-mark one question for everyone after fixing its answer key. Runs on the local copy's database
// inside a transaction that is always rolled back, so nothing is left behind.
const test = require("node:test");
const assert = require("node:assert");
const pool = require("../config/db");
const flow = require("../controllers/assessmentFlowController");

const res = () => {
  const out = { code: 200, body: null };
  out.status = (c) => { out.code = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
};

test("fixing an answer key marks that question again for everyone who handed in", async (t) => {
  let client;
  try { client = await pool.connect(); } catch (_) { return t.skip("no database"); }
  try {
    await client.query("BEGIN");
    const set = (await client.query(
      `SELECT qs.question_set_id, qs.organization_id, qs.assessment_id, a.class_id, a.term_id
         FROM assessment_question_sets qs JOIN assessments a ON a.assessment_id = qs.assessment_id
        WHERE qs.assessment_id IS NOT NULL LIMIT 1`)).rows[0];
    if (!set) return t.skip("no test data");
    const students = (await client.query("SELECT student_id FROM students WHERE organization_id = $1 LIMIT 2", [set.organization_id])).rows;
    if (students.length < 2) return t.skip("no students");
    const q = (await client.query(
      `INSERT INTO assessment_questions (question_set_id, organization_id, question_type, question_text, answer_key, marks, position_index)
       VALUES ($1, $2, 'short_text', 'Capital of France?', 'london', 2, 999) RETURNING question_id`, [set.question_set_id, set.organization_id])).rows[0].question_id;
    const attempts = [];
    for (const [i, student] of students.entries()) {
      const attempt = (await client.query(
        `INSERT INTO student_assessment_attempts (organization_id, student_id, assessment_id, question_set_id, class_id, term_id, status, started_at, submitted_at, score, max_score)
         VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW(), NOW(), 5, 10) RETURNING attempt_id`,
        [set.organization_id, student.student_id, set.assessment_id, set.question_set_id, set.class_id, set.term_id])).rows[0].attempt_id;
      // The first student wrote "paris", the second "lyon".
      await client.query(
        "INSERT INTO student_assessment_responses (attempt_id, question_id, response_text, is_correct, awarded_marks) VALUES ($1, $2, $3, FALSE, 0)",
        [attempt, q, i === 0 ? "paris" : "lyon"]);
      attempts.push(attempt);
    }
    const run = async (body) => { const r = res(); await flow.remark({ session: { organizationId: set.organization_id }, body: { questionSetId: set.question_set_id, ...body } }, r, client); return r; };

    // Nothing to fix: no answer key given, nothing changes.
    assert.strictEqual((await run({ questionId: q })).body.changed, 0);
    // The key was wrong: "paris" is the right answer.
    const fixed = await run({ questionId: q, answerKey: "paris" });
    assert.strictEqual(fixed.body.success, true);
    assert.strictEqual(fixed.body.changed, 1, "only the student who wrote paris changes");
    const scores = (await client.query("SELECT attempt_id, score FROM student_assessment_attempts WHERE attempt_id = ANY($1::int[]) ORDER BY attempt_id", [attempts])).rows;
    assert.strictEqual(Number(scores[0].score), 7, "5 + 2 marks");
    assert.strictEqual(Number(scores[1].score), 5, "the other score stays");
    // Running it again changes nothing more.
    assert.strictEqual((await run({ questionId: q, answerKey: "paris" })).body.changed, 0);
    // Wrong questions and essays are refused; an empty answer is refused.
    assert.strictEqual((await run({ questionId: 2147483000 })).code, 404);
    assert.strictEqual((await run({ questionId: q, answerKey: "  " })).code, 400);
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  }
});
