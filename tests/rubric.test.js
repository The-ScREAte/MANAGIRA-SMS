// Rubrics on written questions: the rules, marking by criterion on both marking screens, and the
// By student grade save (which a plain written answer also goes through). Database tests run on the
// local copy inside a transaction that is always rolled back.
const test = require("node:test");
const assert = require("node:assert");
const pool = require("../config/db");
const rubric = require("../utils/rubric");
const marking = require("../controllers/markByQuestionController");
const { commonController } = require("../controllers/commonController");

const res = () => {
  const out = { code: 200, body: null, locals: { publicImageUrl: (k) => k } };
  out.status = (c) => { out.code = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
};

test("a rubric is kept clean, and its total is the question's marks", () => {
  const raw = { criteria: [{ name: "  Content ", marks: "5" }, { name: "Language", marks: 2.5 }, { name: "", marks: 3 }, { name: "Zero", marks: 0 }, { name: "Over", marks: 500 }] };
  const clean = rubric.clean(raw);
  assert.deepStrictEqual(clean, { criteria: [{ name: "Content", marks: 5 }, { name: "Language", marks: 2.5 }] });
  assert.strictEqual(rubric.total(raw), 7.5);
  assert.strictEqual(rubric.clean({ criteria: [] }), null);
  assert.strictEqual(rubric.clean("nope"), null);
  assert.strictEqual(rubric.clean({ criteria: Array.from({ length: 30 }, (_, i) => ({ name: "C" + i, marks: 1 })) }).criteria.length, rubric.MAX_CRITERIA);
});

test("marks per criterion are held to each criterion and added up", () => {
  const r = { criteria: [{ name: "Content", marks: 5 }, { name: "Language", marks: 2 }] };
  assert.deepStrictEqual(rubric.score(r, [4, 1]), { marks: [4, 1], total: 5 });
  assert.deepStrictEqual(rubric.score(r, [99, -3]), { marks: [5, 0], total: 5 });
  assert.deepStrictEqual(rubric.score(r, ["x"]), { marks: [0, 0], total: 0 });
  assert.strictEqual(rubric.score(null, [1]), null);
});

// A database whose transactions belong to the test: BEGIN, COMMIT and ROLLBACK from the code under test do nothing.
const inside = (client) => {
  const query = (sql, ...rest) => (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(String(sql)) ? Promise.resolve({ rows: [] }) : client.query(sql, ...rest));
  return { query, connect: async () => ({ query, release() {} }) };
};

async function seed(client) {
  const set = (await client.query(
    `SELECT qs.question_set_id, qs.organization_id, qs.assessment_id, a.class_id, a.term_id
       FROM assessment_question_sets qs JOIN assessments a ON a.assessment_id = qs.assessment_id
      WHERE qs.assessment_id IS NOT NULL LIMIT 1`)).rows[0];
  if (!set) return null;
  const student = (await client.query("SELECT student_id FROM students WHERE organization_id = $1 LIMIT 1", [set.organization_id])).rows[0];
  if (!student) return null;
  await client.query("UPDATE assessments SET is_locked = FALSE, obsolete_at = NULL, is_active = TRUE, edit_window_start = NULL, edit_window_end = NULL WHERE assessment_id = $1", [set.assessment_id]);
  const ruled = (await client.query(
    `INSERT INTO assessment_questions (question_set_id, organization_id, question_type, question_text, marks, position_index, rubric_json)
     VALUES ($1, $2, 'essay', 'Describe the water cycle.', 10, 998, $3::jsonb) RETURNING question_id`,
    [set.question_set_id, set.organization_id, JSON.stringify({ criteria: [{ name: "Content", marks: 5 }, { name: "Organisation", marks: 3 }, { name: "Language", marks: 2 }] })])).rows[0].question_id;
  const plain = (await client.query(
    `INSERT INTO assessment_questions (question_set_id, organization_id, question_type, question_text, marks, position_index)
     VALUES ($1, $2, 'essay', 'Why does it rain?', 4, 999) RETURNING question_id`, [set.question_set_id, set.organization_id])).rows[0].question_id;
  const attempt = (await client.query(
    `INSERT INTO student_assessment_attempts (organization_id, student_id, assessment_id, question_set_id, class_id, term_id, status, started_at, submitted_at, score, max_score)
     VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW(), NOW(), 0, 14) RETURNING attempt_id`,
    [set.organization_id, student.student_id, set.assessment_id, set.question_set_id, set.class_id, set.term_id])).rows[0].attempt_id;
  for (const id of [ruled, plain]) {
    await client.query("INSERT INTO student_assessment_responses (attempt_id, question_id, response_text) VALUES ($1, $2, 'An answer')", [attempt, id]);
  }
  return { set, ruled, plain, attempt };
}
const manager = (set) => ({ session: { organizationId: set.organization_id, userId: 1, userRole: "Manager" }, query: {}, body: {} });

test("marking a written answer by criterion, on the By question screen", async (t) => {
  let client;
  try { client = await pool.connect(); } catch (_) { return t.skip("no database"); }
  try {
    await client.query("BEGIN");
    if (!(await rubric.whenChecked())) return t.skip("rubric columns not on this database");
    const data = await seed(client);
    if (!data) return t.skip("no test data");
    const { set, ruled, attempt } = data;
    // The question comes with its criteria.
    const qs = res();
    await marking.questions({ ...manager(set), query: { questionSetId: set.question_set_id } }, qs, client);
    const found = qs.body.questions.find((q) => q.questionId === ruled);
    assert.deepStrictEqual(found.rubric.criteria.map((c) => c.name), ["Content", "Organisation", "Language"]);
    const save = async (body) => { const r = res(); await marking.save({ ...manager(set), body: { questionSetId: set.question_set_id, questionId: ruled, attemptId: attempt, ...body } }, r, client); return r; };
    // A rubric question needs its criteria, not one mark.
    assert.strictEqual((await save({ marks: 7 })).code, 400);
    const done = await save({ rubricMarks: [4, 2, 1] });
    assert.strictEqual(done.body.marks, 7);
    assert.deepStrictEqual(done.body.rubricMarks, [4, 2, 1]);
    const held = await save({ rubricMarks: [9, 9, 9] });
    assert.strictEqual(held.body.marks, 10, "each criterion is held to its own marks");
    const ans = res();
    await marking.answers({ ...manager(set), query: { questionSetId: set.question_set_id, questionId: ruled } }, ans, client);
    assert.deepStrictEqual(ans.body.answers[0].rubricMarks, [5, 3, 2]);
    assert.strictEqual(Number((await client.query("SELECT score FROM student_assessment_attempts WHERE attempt_id = $1", [attempt])).rows[0].score), 10);
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  }
});

test("the By student grade save: a rubric question by criterion, and a plain written answer as before", async (t) => {
  let client;
  try { client = await pool.connect(); } catch (_) { return t.skip("no database"); }
  try {
    await client.query("BEGIN");
    if (!(await rubric.whenChecked())) return t.skip("rubric columns not on this database");
    const data = await seed(client);
    if (!data) return t.skip("no test data");
    const { set, ruled, plain, attempt } = data;
    const db = inside(client);
    const load = res();
    await commonController.getAssessmentAttemptForGrading({ ...manager(set), query: { attemptId: attempt } }, load, db);
    const q = load.body.questions.find((item) => item.questionId === ruled);
    assert.ok(q.rubric && q.rubric.criteria.length === 3, "the grading screen gets the criteria");
    const r = res();
    await commonController.saveAssessmentAttemptGrade({ ...manager(set), body: { attemptId: attempt, marks: { [ruled]: 0, [plain]: 3 }, rubricMarks: { [ruled]: [5, 1, 1] } } }, r, db);
    assert.strictEqual(r.body && r.body.success, true, JSON.stringify(r.body));
    const rows = (await client.query("SELECT question_id, awarded_marks, rubric_marks, is_correct FROM student_assessment_responses WHERE attempt_id = $1", [attempt])).rows;
    const byQuestion = Object.fromEntries(rows.map((row) => [row.question_id, row]));
    assert.strictEqual(Number(byQuestion[ruled].awarded_marks), 7);
    assert.deepStrictEqual(byQuestion[ruled].rubric_marks, [5, 1, 1]);
    assert.strictEqual(Number(byQuestion[plain].awarded_marks), 3, "a plain written answer still saves");
    assert.strictEqual(byQuestion[plain].is_correct, false, "and counts as marked");
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  }
});
