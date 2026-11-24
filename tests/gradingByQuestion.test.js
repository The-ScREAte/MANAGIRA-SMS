// Grading by question: written answers nobody has marked, one question across everyone. Runs on the local copy's database inside a
// transaction that is always rolled back.
const test = require("node:test");
const assert = require("node:assert");
const pool = require("../config/db");
const marking = require("../controllers/markByQuestionController");
const { requireQuestionScope } = require("../utils/questionScope");

const res = () => {
  const out = { code: 200, body: null };
  out.status = (c) => { out.code = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
};

async function seed(client) {
  const set = (await client.query(
    `SELECT qs.question_set_id, qs.organization_id, qs.assessment_id, a.class_id, a.term_id, a.subject_id
       FROM assessment_question_sets qs JOIN assessments a ON a.assessment_id = qs.assessment_id
      WHERE qs.assessment_id IS NOT NULL LIMIT 1`)).rows[0];
  if (!set) return null;
  const students = (await client.query("SELECT student_id FROM students WHERE organization_id = $1 ORDER BY student_id LIMIT 3", [set.organization_id])).rows;
  if (students.length < 3) return null;
  const q = (await client.query(
    `INSERT INTO assessment_questions (question_set_id, organization_id, question_type, question_text, marks, position_index)
     VALUES ($1, $2, 'essay', 'Describe the water cycle.', 5, 998) RETURNING question_id`, [set.question_set_id, set.organization_id])).rows[0].question_id;
  const attempts = [];
  for (const [i, student] of students.entries()) {
    const attempt = (await client.query(
      `INSERT INTO student_assessment_attempts (organization_id, student_id, assessment_id, question_set_id, class_id, term_id, status, started_at, submitted_at, score, max_score)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW(), NOW(), 0, 5) RETURNING attempt_id`,
      [set.organization_id, student.student_id, set.assessment_id, set.question_set_id, set.class_id, set.term_id])).rows[0].attempt_id;
    // The third student left it blank: nothing to mark.
    await client.query("INSERT INTO student_assessment_responses (attempt_id, question_id, response_text) VALUES ($1, $2, $3)", [attempt, q, i === 2 ? "" : `Answer ${i + 1}`]);
    attempts.push(attempt);
  }
  return { set, q, attempts };
}
const manager = (set) => ({ session: { organizationId: set.organization_id, userId: 1, userRole: "Manager" }, query: {}, body: {} });

test("written answers wait on the list until they are marked, then drop off", async (t) => {
  let client;
  try { client = await pool.connect(); } catch (_) { return t.skip("no database"); }
  try {
    await client.query("BEGIN");
    const data = await seed(client);
    if (!data) return t.skip("no test data");
    const { set, q, attempts } = data;
    const mine = (sets) => sets.find((s) => s.questionSetId === set.question_set_id);
    assert.strictEqual(mine(await marking.setsToMark(client, manager(set))).toMark >= 2, true, "two written answers wait; the blank one does not count");

    const answers = res();
    await marking.answers({ ...manager(set), query: { questionSetId: set.question_set_id, questionId: q } }, answers, client);
    assert.strictEqual(answers.body.answers.length, 2, "blank answers are left out");
    assert.ok(answers.body.answers.every((a) => a.marked === false));

    const save = async (marks, attemptId = attempts[0]) => { const r = res(); await marking.save({ ...manager(set), body: { questionSetId: set.question_set_id, questionId: q, attemptId, marks } }, r, client); return r; };
    const first = await save(3);
    assert.strictEqual(first.body.success, true);
    assert.strictEqual(first.body.marks, 3);
    assert.strictEqual(Number((await client.query("SELECT score FROM student_assessment_attempts WHERE attempt_id = $1", [attempts[0]])).rows[0].score), 3);
    // Over the question's marks is held at the marks; a mark of 0 still counts as marked.
    assert.strictEqual((await save(99, attempts[1])).body.marks, 5);
    const zero = await save(0, attempts[0]);
    assert.strictEqual(zero.body.marks, 0);
    const after = res();
    await marking.answers({ ...manager(set), query: { questionSetId: set.question_set_id, questionId: q } }, after, client);
    assert.ok(after.body.answers.every((a) => a.marked), "both answers are marked now");
    // Bad input.
    assert.strictEqual((await save("abc")).code, 400);
    assert.strictEqual((await save(2, 2147483000)).code, 404);
    // A locked test refuses new marks.
    await client.query("UPDATE assessments SET is_locked = TRUE WHERE assessment_id = $1", [set.assessment_id]);
    assert.strictEqual((await save(1)).code, 403);
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  }
});

test("a teacher sees and marks only the subjects they teach", async (t) => {
  let client;
  try { client = await pool.connect(); } catch (_) { return t.skip("no database"); }
  try {
    await client.query("BEGIN");
    const data = await seed(client);
    if (!data) return t.skip("no test data");
    const { set, q, attempts } = data;
    const teacher = (await client.query("SELECT user_id FROM users WHERE organization_id = $1 AND account_type::text = 'Teacher' LIMIT 1", [set.organization_id])).rows[0];
    if (!teacher) return t.skip("no teacher");
    await client.query("DELETE FROM user_subjects WHERE user_id = $1", [teacher.user_id]);
    const asTeacher = () => ({ session: { organizationId: set.organization_id, userId: teacher.user_id, userRole: "Teacher" }, query: {}, body: {} });
    // Teaches nothing: nothing to mark, and the scope check refuses the test.
    assert.deepStrictEqual(await marking.setsToMark(client, asTeacher()), []);
    const gate = requireQuestionScope(client);
    const run = async () => { const r = res(); let passed = false; await gate({ ...asTeacher(), query: { questionSetId: set.question_set_id } }, r, () => { passed = true; }); return { passed, code: r.code }; };
    assert.deepStrictEqual(await run(), { passed: false, code: 403 });
    // Teaches its subject: sees it and may mark it.
    await client.query("INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2)", [teacher.user_id, set.subject_id]);
    assert.ok((await marking.setsToMark(client, asTeacher())).some((s) => s.questionSetId === set.question_set_id));
    assert.deepStrictEqual(await run(), { passed: true, code: 200 });
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  }
});
