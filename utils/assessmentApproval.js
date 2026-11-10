"use strict";
// Grades wait for the teacher's approval before parents and the student see them (feature
// assessment_flow). A result with pending_since is waiting: parents and the student keep
// seeing posted_score / posted_choice (what they saw before; nothing for a new score) until
// the teacher approves it on the gradebook. A result without pending_since is what everyone
// sees, so scores from before the flow, or from a school without it, need nothing done.
const features = require("./shards/features");
const { createNotifications } = require("./notificationService");

// The flow needs the columns from database/migrations/2026-11-12_assessment_flow.sql. Until
// they exist on this server's database everything works as before (checked again each
// minute, so it turns on soon after the migration runs).
const COLUMN_COUNT = 8;
let columnsKnownReady = false;
let lastColumnCheck = 0;
let columnCheck = null;
function checkColumns() {
  if (columnCheck) return columnCheck;
  columnCheck = require("../config/db").query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'assessment_results' AND column_name IN ('pending_since', 'pending_source', 'posted_score', 'posted_choice', 'approved_at', 'approved_by'))
          OR (table_name = 'assessment_questions' AND column_name = 'media_json')
          OR (table_name = 'assessment_question_sets' AND column_name = 'parent_share'))`
  )
    .then(({ rows }) => { columnsKnownReady = Number(rows[0] && rows[0].n) === COLUMN_COUNT; })
    .catch(() => {})
    .finally(() => { lastColumnCheck = Date.now(); columnCheck = null; });
  return columnCheck;
}
function columnsReady() {
  if (!columnsKnownReady && Date.now() - lastColumnCheck > 60000) checkColumns();
  return columnsKnownReady;
}
// For a request that should see the answer of a check started just now.
async function whenColumnsChecked() {
  if (!columnsKnownReady && Date.now() - lastColumnCheck > 60000) await checkColumns();
  return columnsKnownReady;
}

// The new screens (toolbar, Filter, columns, + Assessment, the questions prompts): only the
// feature decides. Approval, the dots, pictures and sharing also need the columns (flowOn).
const flowUi = (organizationId) => features.isOn("assessment_flow", { organizationId: Number(organizationId) || null });
const flowOn = (organizationId) => columnsReady() && flowUi(organizationId);

// What parents and the student see of a result row aliased `a` (SQL). With the flow off it's
// the score itself, as before.
const visibleScore = (a = "ar", on = true) => (on ? `CASE WHEN ${a}.pending_since IS NULL THEN ${a}.score ELSE ${a}.posted_score END` : `${a}.score`);
const visibleChoice = (a = "ar", on = true) => (on ? `CASE WHEN ${a}.pending_since IS NULL THEN ${a}.choice_label ELSE ${a}.posted_choice END` : `${a}.choice_label`);
const waitingSql = (a = "ar", on = true) => (on ? `(${a}.pending_since IS NOT NULL)` : "FALSE");

// A gradebook cell: posted (everyone sees it), waiting (typed or changed, not approved yet)
// or new (from an online test, not approved yet).
function cellState(row) {
  if (!row) return null;
  const hasValue = (row.score !== null && row.score !== undefined && row.score !== "") || Boolean(row.choice_label);
  if (!hasValue) return null;
  if (!row.pending_since) return "posted";
  return row.pending_source === "online" ? "new" : "waiting";
}

// Approve every waiting score of these assessments (optionally only some students'):
// parents and the student see them from now on. Returns the rows approved.
async function approve(db, { organizationId, assessmentIds, studentIds = null, userId = null }) {
  const ids = (assessmentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  const students = Array.isArray(studentIds) ? studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : null;
  const { rows } = await db.query(
    `UPDATE assessment_results
        SET pending_since = NULL, pending_source = NULL, posted_score = NULL, posted_choice = NULL,
            approved_at = NOW(), approved_by = $3
      WHERE organization_id = $1 AND assessment_id = ANY($2::int[]) AND pending_since IS NOT NULL
        AND ($4::int[] IS NULL OR student_id = ANY($4::int[]))
      RETURNING assessment_id, student_id`,
    [organizationId, ids, Number(userId) || null, students]
  );
  return rows.map((row) => ({ assessmentId: Number(row.assessment_id), studentId: Number(row.student_id) }));
}

// How many scores wait in each assessment.
async function waitingCounts(db, organizationId, assessmentIds) {
  const ids = (assessmentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT assessment_id, COUNT(*)::int AS waiting
       FROM assessment_results
      WHERE organization_id = $1 AND assessment_id = ANY($2::int[]) AND pending_since IS NOT NULL
      GROUP BY assessment_id`,
    [organizationId, ids]
  );
  return new Map(rows.map((row) => [Number(row.assessment_id), Number(row.waiting)]));
}

// A bell for each family whose child just got a grade: one per child and assessment.
async function tellFamilies(db, organizationId, approved) {
  if (!approved.length) return;
  const assessmentIds = [...new Set(approved.map((row) => row.assessmentId))];
  const studentIds = [...new Set(approved.map((row) => row.studentId))];
  const [tests, families] = await Promise.all([
    db.query(
      `SELECT a.assessment_id, a.title, s.subject_name
         FROM assessments a LEFT JOIN subjects s ON s.subject_id = a.subject_id
        WHERE a.organization_id = $1 AND a.assessment_id = ANY($2::int[])`,
      [organizationId, assessmentIds]
    ),
    db.query(
      `SELECT DISTINCT x.guardian_id, x.student_id, st.first_name
         FROM (
           SELECT g.guardian_id, g.student_id FROM guardians g WHERE g.organization_id = $1 AND g.student_id = ANY($2::int[])
           UNION
           SELECT gs.guardian_id, gs.student_id FROM guardian_students gs WHERE gs.student_id = ANY($2::int[])
         ) x
         JOIN students st ON st.student_id = x.student_id AND st.organization_id = $1
        WHERE x.guardian_id IS NOT NULL`,
      [organizationId, studentIds]
    ),
  ]);
  const testById = new Map(tests.rows.map((row) => [Number(row.assessment_id), row]));
  const guardiansByStudent = new Map();
  families.rows.forEach((row) => {
    const list = guardiansByStudent.get(Number(row.student_id)) || [];
    list.push(row);
    guardiansByStudent.set(Number(row.student_id), list);
  });
  const notices = [];
  approved.forEach(({ assessmentId, studentId }) => {
    const test = testById.get(assessmentId);
    if (!test) return;
    (guardiansByStudent.get(studentId) || []).forEach((family) => {
      notices.push({
        orgId: organizationId,
        recipientType: "guardian",
        recipientId: Number(family.guardian_id),
        type: "grade_posted",
        title: `New grade: ${[test.subject_name, test.title].filter(Boolean).join(" · ")}`,
        body: family.first_name ? `For ${family.first_name}` : "",
        link: `/guardian/academic-details?studentId=${studentId}`,
        refId: assessmentId,
      });
    });
  });
  if (notices.length) await createNotifications(db, notices);
}

// A finished online test goes on the gradebook as new, waiting for the teacher (who can
// change it, then approve it). Its attempt counts as posted, so it isn't posted twice.
async function placeOnlineResult(db, { organizationId, attemptId }) {
  const assessmentEntry = require("./assessmentEntry");
  const { rows } = await db.query(
    `SELECT saa.attempt_id, saa.student_id, saa.score, saa.max_score, saa.assessment_id,
            a.subject_id, a.term_id, a.class_id, a.category, a.max_score AS assessment_max,
            COALESCE(a.entry_mode, 'score') AS entry_mode, a.choice_options
       FROM student_assessment_attempts saa
       JOIN assessments a ON a.assessment_id = saa.assessment_id AND a.organization_id = saa.organization_id
      WHERE saa.organization_id = $1 AND saa.attempt_id = $2 AND saa.status = 'submitted'`,
    [organizationId, attemptId]
  );
  const attempt = rows[0];
  if (!attempt) return false;
  let score = attempt.score === null ? null : Number(attempt.score);
  let choice = null;
  if (assessmentEntry.isChoice(attempt)) {
    const attemptMax = Number(attempt.max_score) || 0;
    const scaled = attemptMax > 0 ? (Number(attempt.score) / attemptMax) * Number(attempt.assessment_max || 0) : Number(attempt.score);
    const picked = assessmentEntry.choiceForScore(attempt, scaled);
    if (!picked) return false; // choices without points: the teacher picks it on the gradebook
    score = picked.points;
    choice = picked.label;
  }
  // Scores are NUMERIC(5,2).
  if (score !== null) score = Math.min(Math.round(score * 100) / 100, 999.99);
  await db.query(
    `INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, term_id, organization_id, class_id, category, choice_label,
                                     pending_since, pending_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'online')
     ON CONFLICT (student_id, assessment_id) DO UPDATE SET
       posted_score = CASE WHEN assessment_results.pending_since IS NULL THEN assessment_results.score ELSE assessment_results.posted_score END,
       posted_choice = CASE WHEN assessment_results.pending_since IS NULL THEN assessment_results.choice_label ELSE assessment_results.posted_choice END,
       score = EXCLUDED.score,
       choice_label = EXCLUDED.choice_label,
       pending_since = COALESCE(assessment_results.pending_since, NOW()),
       pending_source = 'online'`,
    [attempt.student_id, attempt.assessment_id, score, attempt.subject_id, attempt.term_id, organizationId, attempt.class_id, attempt.category, choice]
  );
  await db.query("UPDATE student_assessment_attempts SET posted_at = COALESCE(posted_at, NOW()) WHERE attempt_id = $1", [attempt.attempt_id]);
  const { commonController, recomputeSubjectTotalsForStudent } = require("../controllers/commonController");
  await recomputeSubjectTotalsForStudent(db, {
    studentId: attempt.student_id, subjectId: attempt.subject_id, classId: attempt.class_id, termId: attempt.term_id, organizationId,
  });
  await commonController.updateStudentPositions(db, attempt.subject_id, organizationId, attempt.class_id, attempt.term_id);
  return true;
}

// Parents and students: a subject's totals wait while any of its grades waits, so a total
// never includes a grade they can't see. Rows carry grade_waiting (waitingSql) and subject_id.
function hideWaitingTotals(rows) {
  const waiting = new Set(rows.filter((row) => row.grade_waiting).map((row) => String(row.subject_id)));
  if (!waiting.size) return rows;
  rows.forEach((row) => {
    if (!waiting.has(String(row.subject_id))) return;
    row.total_percentage = null;
    row.total_subject_score = null;
    row.grade = null;
    row.totals_waiting = true;
  });
  return rows;
}

module.exports = { flowUi, flowOn, columnsReady, whenColumnsChecked, hideWaitingTotals, visibleScore, visibleChoice, waitingSql, cellState, approve, waitingCounts, tellFamilies, placeOnlineResult };
