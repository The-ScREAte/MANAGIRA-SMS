"use strict";
// Marking written answers (essays) one QUESTION at a time across everyone who handed in: the "By question"
// side of the existing grading screen (views/common/allClassAssessmentExams.ejs, Students, Grade).
// A saved mark moves the grade back to "waiting" like any other change, so nothing reaches families
// until it is posted. A teacher only sees tests of the subjects they teach (utils/questionScope.js).
const assessmentApproval = require("../utils/assessmentApproval");
const { teacherSubjectIds } = require("../utils/questionScope");
const rubricUtil = require("../utils/rubric");

const MANUAL_TYPES = ["essay", "matching"];
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const fail = (res, status, error) => res.status(status).json({ success: false, error });

// A written answer is "marked" once it has a mark (even 0, saved here) or a verdict.
const UNMARKED_SQL = "(r.is_correct IS NULL AND COALESCE(r.awarded_marks, 0) = 0 AND TRIM(COALESCE(r.response_text, '')) <> '')";

// Tests with unmarked written answers: [{ questionSetId, title, className, subjectName, toMark, handedIn }].
async function setsToMark(db, req) {
  const organizationId = Number(req.session.organizationId);
  const mine = await teacherSubjectIds(db, req); // null for everyone but teachers
  if (mine && !mine.size) return [];
  const { rows } = await db.query(
    `SELECT qs.question_set_id, qs.set_title, a.title AS assessment_title, c.class_name, s.subject_name,
            COUNT(*) FILTER (WHERE ${UNMARKED_SQL})::int AS to_mark,
            COUNT(DISTINCT saa.attempt_id)::int AS handed_in
       FROM student_assessment_responses r
       JOIN student_assessment_attempts saa ON saa.attempt_id = r.attempt_id AND saa.status = 'submitted'
       JOIN assessment_questions q ON q.question_id = r.question_id
       JOIN assessment_question_sets qs ON qs.question_set_id = q.question_set_id AND qs.organization_id = saa.organization_id
       JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
       LEFT JOIN classes c ON c.class_id = a.class_id
       LEFT JOIN subjects s ON s.subject_id = a.subject_id
      WHERE saa.organization_id = $1 AND q.question_type = ANY($2::text[])
        AND ($3::int[] IS NULL OR a.subject_id = ANY($3::int[]))
      GROUP BY qs.question_set_id, qs.set_title, a.title, c.class_name, s.subject_name
     HAVING COUNT(*) FILTER (WHERE ${UNMARKED_SQL}) > 0
      ORDER BY COUNT(*) FILTER (WHERE ${UNMARKED_SQL}) DESC, qs.question_set_id DESC
      LIMIT 200`,
    [organizationId, MANUAL_TYPES, mine ? [...mine] : null]
  );
  return rows.map((row) => ({
    questionSetId: Number(row.question_set_id),
    title: row.assessment_title || row.set_title || "Test",
    className: row.class_name || "",
    subjectName: row.subject_name || "",
    toMark: Number(row.to_mark),
    handedIn: Number(row.handed_in),
  }));
}

// How many written answers wait for a mark in each of these question sets: Map(setId -> count).
async function countsFor(db, organizationId, questionSetIds) {
  const ids = (questionSetIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT q.question_set_id, COUNT(*)::int AS n
       FROM student_assessment_responses r
       JOIN student_assessment_attempts saa ON saa.attempt_id = r.attempt_id AND saa.status = 'submitted'
       JOIN assessment_questions q ON q.question_id = r.question_id
      WHERE saa.organization_id = $1 AND q.question_set_id = ANY($2::int[]) AND q.question_type = ANY($3::text[])
        AND ${UNMARKED_SQL}
      GROUP BY q.question_set_id`,
    [organizationId, ids, MANUAL_TYPES]
  );
  return new Map(rows.map((row) => [Number(row.question_set_id), Number(row.n)]));
}

// Written answers waiting for a mark in one class, per subject: Map(subjectId -> count).
// A teacher only gets the subjects they teach.
async function countsBySubject(db, req, classId, termId) {
  const mine = await teacherSubjectIds(db, req);
  if (mine && !mine.size) return new Map();
  const { rows } = await db.query(
    `SELECT a.subject_id, COUNT(*)::int AS n
       FROM student_assessment_responses r
       JOIN student_assessment_attempts saa ON saa.attempt_id = r.attempt_id AND saa.status = 'submitted'
       JOIN assessment_questions q ON q.question_id = r.question_id
       JOIN assessments a ON a.assessment_id = saa.assessment_id AND a.organization_id = saa.organization_id
      WHERE saa.organization_id = $1 AND a.class_id = $2 AND ($3::int IS NULL OR a.term_id = $3)
        AND q.question_type = ANY($4::text[])
        AND ($5::int[] IS NULL OR a.subject_id = ANY($5::int[]))
        AND ${UNMARKED_SQL}
      GROUP BY a.subject_id`,
    [Number(req.session.organizationId), Number(classId), Number(termId) || null, MANUAL_TYPES, mine ? [...mine] : null]
  );
  return new Map(rows.map((row) => [Number(row.subject_id), Number(row.n)]));
}

module.exports = {
  setsToMark,
  countsFor,
  countsBySubject,

  // The counts shown on the class overview and beside "To review", fresh after marking.
  counts: async (req, res, db) => {
    const classId = toId(req.query.classId);
    if (!classId) return fail(res, 400, "Choose a class.");
    try {
      const bySubject = await countsBySubject(db, req, classId, toId(req.query.termId));
      return res.json({ success: true, bySubject: Object.fromEntries(bySubject), total: [...bySubject.values()].reduce((sum, n) => sum + n, 0) });
    } catch (error) {
      console.error("[To review] counts:", error.message);
      return fail(res, 500, "The counts couldn't be loaded.");
    }
  },

  // One test's written questions, with how many answers of each wait for a mark.
  questions: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const questionSetId = toId(req.query.questionSetId);
    if (!questionSetId) return fail(res, 400, "Choose a test.");
    try {
      const { rows } = await db.query(
        `SELECT q.question_id, q.question_text, q.marks, q.position_index,
                ${rubricUtil.ready() ? "q.rubric_json" : "NULL::jsonb AS rubric_json"},
                COUNT(r.response_id)::int AS answered,
                COUNT(r.response_id) FILTER (WHERE ${UNMARKED_SQL})::int AS to_mark
           FROM assessment_questions q
           JOIN assessment_question_sets qs ON qs.question_set_id = q.question_set_id
           LEFT JOIN student_assessment_attempts saa ON saa.question_set_id = q.question_set_id AND saa.status = 'submitted'
           LEFT JOIN student_assessment_responses r ON r.attempt_id = saa.attempt_id AND r.question_id = q.question_id
                AND TRIM(COALESCE(r.response_text, '')) <> ''
          WHERE q.question_set_id = $1 AND qs.organization_id = $2 AND q.question_type = ANY($3::text[])
          GROUP BY q.question_id, q.question_text, q.marks, q.position_index${rubricUtil.ready() ? ", q.rubric_json" : ""}
          ORDER BY q.position_index, q.question_id`,
        [questionSetId, organizationId, MANUAL_TYPES]
      );
      return res.json({
        success: true,
        questions: rows.map((row) => ({ questionId: Number(row.question_id), text: row.question_text, marks: Number(row.marks || 0), rubric: row.rubric_json || null, answered: Number(row.answered), toMark: Number(row.to_mark) })),
      });
    } catch (error) {
      console.error("[To mark] questions:", error.message);
      return fail(res, 500, "The questions couldn't be loaded.");
    }
  },

  // The answers to one question, everyone who handed in, in a steady order (unmarked first).
  answers: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const questionSetId = toId(req.query.questionSetId);
    const questionId = toId(req.query.questionId);
    if (!questionSetId || !questionId) return fail(res, 400, "Choose a question.");
    try {
      const { rows } = await db.query(
        `SELECT saa.attempt_id, st.first_name, st.last_name, r.response_text, COALESCE(r.awarded_marks, 0) AS awarded_marks,
                ${rubricUtil.ready() ? "r.rubric_marks" : "NULL::jsonb AS rubric_marks"},
                (NOT ${UNMARKED_SQL}) AS marked, q.marks
           FROM student_assessment_responses r
           JOIN student_assessment_attempts saa ON saa.attempt_id = r.attempt_id AND saa.status = 'submitted'
           JOIN assessment_questions q ON q.question_id = r.question_id
           JOIN students st ON st.student_id = saa.student_id
          WHERE q.question_id = $1 AND saa.question_set_id = $2 AND saa.organization_id = $3 AND q.question_type = ANY($4::text[])
            AND TRIM(COALESCE(r.response_text, '')) <> ''
          ORDER BY (NOT ${UNMARKED_SQL}) ASC, LOWER(COALESCE(st.last_name, '')), LOWER(COALESCE(st.first_name, '')), saa.attempt_id`,
        [questionId, questionSetId, organizationId, MANUAL_TYPES]
      );
      return res.json({
        success: true,
        answers: rows.map((row) => ({
          attemptId: Number(row.attempt_id),
          student: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Student",
          text: row.response_text || "",
          marks: Number(row.awarded_marks),
          rubricMarks: Array.isArray(row.rubric_marks) ? row.rubric_marks : null,
          marked: Boolean(row.marked),
          outOf: Number(row.marks || 0),
        })),
      });
    } catch (error) {
      console.error("[To mark] answers:", error.message);
      return fail(res, 500, "The answers couldn't be loaded.");
    }
  },

  // Saves one mark. The attempt's score is the sum of its marks; the grade goes back to waiting.
  save: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const questionSetId = toId(req.body && req.body.questionSetId);
    const questionId = toId(req.body && req.body.questionId);
    const attemptId = toId(req.body && req.body.attemptId);
    if (!questionSetId || !questionId || !attemptId) return fail(res, 400, "Choose the answer to mark.");
    try {
      const found = await db.query(
        `SELECT q.marks, ${rubricUtil.ready() ? "q.rubric_json" : "NULL::jsonb AS rubric_json"}, a.is_locked, a.obsolete_at, saa.student_id
           FROM student_assessment_responses r
           JOIN student_assessment_attempts saa ON saa.attempt_id = r.attempt_id AND saa.status = 'submitted'
           JOIN assessment_questions q ON q.question_id = r.question_id
           JOIN assessments a ON a.assessment_id = saa.assessment_id AND a.organization_id = saa.organization_id
          WHERE r.attempt_id = $1 AND r.question_id = $2 AND saa.question_set_id = $3 AND q.question_set_id = $3
            AND saa.organization_id = $4 AND q.question_type = ANY($5::text[])`,
        [attemptId, questionId, questionSetId, organizationId, MANUAL_TYPES]
      );
      const row = found.rows[0];
      if (!row) return fail(res, 404, "That answer no longer exists.");
      if (row.obsolete_at) return fail(res, 403, "This test is obsolete, so its marks can't change.");
      if (row.is_locked) return fail(res, 403, "This test is locked. Unlock it to change marks.");
      const max = Number(row.marks || 0);
      // With a rubric the marker gives marks per criterion, and the total is the mark.
      const scored = row.rubric_json && Array.isArray(req.body.rubricMarks) ? rubricUtil.score(row.rubric_json, req.body.rubricMarks) : null;
      if (row.rubric_json && !scored) return fail(res, 400, "Give a mark for each criterion.");
      let awarded = scored ? scored.total : Number(req.body.marks);
      if (!Number.isFinite(awarded)) return fail(res, 400, "Type a mark.");
      awarded = Math.round(Math.max(0, Math.min(awarded, max)) * 100) / 100;
      await db.query(
        "UPDATE student_assessment_responses SET awarded_marks = $1, is_correct = $2, updated_at = NOW() WHERE attempt_id = $3 AND question_id = $4",
        [awarded, awarded >= max, attemptId, questionId]
      );
      if (scored) {
        await db.query("UPDATE student_assessment_responses SET rubric_marks = $1::jsonb WHERE attempt_id = $2 AND question_id = $3", [JSON.stringify(scored.marks), attemptId, questionId]);
      }
      const total = await db.query("SELECT COALESCE(SUM(awarded_marks), 0) AS total FROM student_assessment_responses WHERE attempt_id = $1", [attemptId]);
      const score = Math.round((Number(total.rows[0].total) || 0) * 100) / 100;
      await db.query(
        `UPDATE student_assessment_attempts
            SET score = $2, posted_at = CASE WHEN $3 THEN posted_at ELSE NULL END, updated_at = NOW()
          WHERE attempt_id = $1`,
        [attemptId, score, assessmentApproval.columnsReady()]
      );
      // The grade goes back to waiting on the gradebook; it is posted again from there.
      if (assessmentApproval.columnsReady()) await assessmentApproval.placeOnlineResult(db, { organizationId, attemptId });
      return res.json({ success: true, marks: awarded, rubricMarks: scored ? scored.marks : null, score });
    } catch (error) {
      console.error("[To mark] save:", error.message);
      return fail(res, 500, "That mark couldn't be saved. Try again.");
    }
  },
};
