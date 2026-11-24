"use strict";
// The assessments flow: approving grades so parents and the student
// see them, the gradebook's remembered columns, pictures for questions, and the library of
// earlier question sets a teacher can start from.
const assessmentApproval = require("../utils/assessmentApproval");
const questionMedia = require("../utils/questionMedia");
const uiPreferences = require("../utils/uiPreferences");

const SUMMARY_COLUMNS = ["raw", "scaled", "percent", "grade", "position"];
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const userOf = (req) => Number(req.session.userId || (req.session.user && req.session.user.user_id) || 0) || null;
// A teacher works with the question sets of the subjects they teach, the same rule as every other
// question-set action (utils/questionScope.js).
const teacherOnly = (req) => String(req.session.userRole || (req.session.user && req.session.user.account_type) || "").trim().toLowerCase() === "teacher"
  ? userOf(req)
  : null;

module.exports = {
  // Approves every waiting score of one assessment (a gradebook column): parents and the
  // student see them from now on, and each family gets a bell.
  approve: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    if (!assessmentApproval.flowOn(organizationId)) return fail(res, 404, "Approving grades isn't turned on for this school.");
    const assessmentId = toId(req.body && req.body.assessmentId);
    if (!assessmentId) return fail(res, 400, "Choose the assessment to approve.");
    try {
      const { rows } = await db.query(
        "SELECT assessment_id, title FROM assessments WHERE assessment_id = $1 AND organization_id = $2",
        [assessmentId, organizationId]
      );
      if (!rows[0]) return fail(res, 404, "That assessment no longer exists.");
      const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds.map(toId).filter(Boolean) : null;
      const approved = await assessmentApproval.approve(db, { organizationId, assessmentIds: [assessmentId], studentIds, userId: userOf(req) });
      assessmentApproval.tellFamilies(db, organizationId, approved).catch((error) => console.error("[Approve grades] bell:", error.message));
      return res.json({
        success: true,
        approved: approved.length,
        message: approved.length
          ? `${approved.length} grade${approved.length === 1 ? "" : "s"} posted for “${rows[0].title}”. Parents can see ${approved.length === 1 ? "it" : "them"} now.`
          : "Nothing was waiting for approval.",
      });
    } catch (error) {
      console.error("[Approve grades]", error.message);
      return fail(res, 500, "The grades couldn't be approved. Try again.");
    }
  },

  // After fixing an answer key: mark that one question again for everyone who handed in. Each
  // score moves by the difference on this question only (a teacher's own changes to a score stay),
  // and the grade goes back to waiting, so nothing reaches families until it is posted again.
  remark: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const questionSetId = toId(req.body && req.body.questionSetId);
    const questionId = toId(req.body && req.body.questionId);
    if (!questionSetId || !questionId) return fail(res, 400, "Choose the question to mark again.");
    const newKey = req.body && typeof req.body.answerKey === "string" ? req.body.answerKey.trim().slice(0, 2000) : null;
    try {
      const found = await db.query(
        `SELECT q.question_id, q.question_type, q.answer_key, q.marks, q.options_json,
                ${assessmentApproval.columnsReady() ? "q.media_json" : "NULL::jsonb AS media_json"},
                ${require("../utils/rubric").ready() ? "q.rubric_json" : "NULL::jsonb AS rubric_json"}
           FROM assessment_questions q
           JOIN assessment_question_sets qs ON qs.question_set_id = q.question_set_id
          WHERE q.question_id = $1 AND q.question_set_id = $2 AND qs.organization_id = $3`,
        [questionId, questionSetId, organizationId]
      );
      const question = found.rows[0];
      if (!question) return fail(res, 404, "That question no longer exists.");
      if (["essay", "matching"].includes(String(question.question_type || "").toLowerCase())) {
        return fail(res, 400, "Essays are marked by hand. Open the student's test to change their mark.");
      }
      if (newKey !== null) {
        if (!newKey) return fail(res, 400, "Type the right answer.");
        await db.query("UPDATE assessment_questions SET answer_key = $1 WHERE question_id = $2", [newKey, questionId]);
        question.answer_key = newKey;
      }
      const { evaluateResponse } = require("./studentController");
      const answers = await db.query(
        `SELECT r.response_id, r.attempt_id, r.response_text, r.response_json, COALESCE(r.awarded_marks, 0) AS awarded_marks
           FROM student_assessment_responses r
           JOIN student_assessment_attempts saa ON saa.attempt_id = r.attempt_id
          WHERE r.question_id = $1 AND saa.question_set_id = $2 AND saa.organization_id = $3 AND saa.status = 'submitted'`,
        [questionId, questionSetId, organizationId]
      );
      const changedAttempts = new Map();
      for (const answer of answers.rows) {
        const raw = answer.response_json && Array.isArray(answer.response_json.values) ? answer.response_json.values : (answer.response_text || "");
        const evaluated = evaluateResponse(question, raw);
        const awarded = Number(evaluated.awardedMarks || 0);
        const before = Number(answer.awarded_marks || 0);
        await db.query("UPDATE student_assessment_responses SET is_correct = $1, awarded_marks = $2, updated_at = NOW() WHERE response_id = $3", [evaluated.isCorrect, awarded, answer.response_id]);
        if (Math.abs(awarded - before) > 0.0001) changedAttempts.set(Number(answer.attempt_id), (changedAttempts.get(Number(answer.attempt_id)) || 0) + (awarded - before));
      }
      for (const [attemptId, delta] of changedAttempts) {
        await db.query(
          `UPDATE student_assessment_attempts
              SET score = GREATEST(ROUND((COALESCE(score, 0) + $2)::numeric, 2), 0), auto_graded_score = GREATEST(ROUND((COALESCE(auto_graded_score, 0) + $2)::numeric, 2), 0),
                  posted_at = CASE WHEN $3 THEN posted_at ELSE NULL END, updated_at = NOW()
            WHERE attempt_id = $1`,
          [attemptId, delta, assessmentApproval.columnsReady()]
        );
        // The grade goes back to waiting on the gradebook (it isn't posted again by itself).
        if (assessmentApproval.columnsReady()) await assessmentApproval.placeOnlineResult(db, { organizationId, attemptId });
      }
      return res.json({
        success: true,
        marked: answers.rows.length,
        changed: changedAttempts.size,
        message: changedAttempts.size
          ? `${changedAttempts.size} of ${answers.rows.length} score${answers.rows.length === 1 ? "" : "s"} changed. Post the grades again when you're ready.`
          : "No score changed.",
      });
    } catch (error) {
      console.error("[Re-mark]", error.message);
      return fail(res, 500, "The question couldn't be marked again. Try again.");
    }
  },

  // The gradebook's columns for this person, on any device: the last few assessments only,
  // and which totals show.
  saveGradebookView: async (req, res) => {
    const lastN = Number(req.body && req.body.lastN);
    const hidden = Array.isArray(req.body && req.body.hidden) ? req.body.hidden.filter((key) => SUMMARY_COLUMNS.includes(key)) : [];
    const value = { lastN: Number.isInteger(lastN) && lastN >= 1 && lastN <= 500 ? lastN : null, hidden: [...new Set(hidden)] };
    try {
      await uiPreferences.setPreference(req.session, "gradebook-view", value.lastN === null && !value.hidden.length ? null : value);
      return res.json({ success: true, view: value });
    } catch (error) {
      return fail(res, error.status || 500, error.status ? error.message : "Your columns couldn't be saved.");
    }
  },

  // A picture for a question (shown above it, or labeled by students).
  uploadQuestionImage: async (req, res) => {
    const organizationId = Number(req.session.organizationId);
    if (!req.file) return fail(res, 400, "Choose a picture.");
    if (req.file.size > 8 * 1024 * 1024) return fail(res, 400, "Use a picture under 8 MB.");
    try {
      const key = await questionMedia.storeImage(req.file, organizationId);
      return res.json({ success: true, image: { key, url: res.locals.publicImageUrl(key) } });
    } catch (error) {
      if (error.status) return fail(res, error.status, error.message);
      console.error("[Question picture]", error.message);
      return fail(res, 500, "The picture couldn't be uploaded. Try again.");
    }
  },

  // Earlier question sets of this school to start a new one from, newest first.
  library: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const search = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const like = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;
    try {
      const { rows } = await db.query(
        `SELECT qs.question_set_id, qs.set_title, qs.class_id, qs.subject_id, qs.term_id, qs.assessment_id, qs.updated_at,
                c.class_name, s.subject_name, t.term_name, sy.year_label, a.title AS assessment_title,
                (SELECT COUNT(*)::int FROM assessment_questions q WHERE q.question_set_id = qs.question_set_id) AS question_count
           FROM assessment_question_sets qs
           LEFT JOIN classes c ON c.class_id = qs.class_id
           LEFT JOIN subjects s ON s.subject_id = qs.subject_id
           LEFT JOIN terms t ON t.term_id = qs.term_id
           LEFT JOIN school_years sy ON sy.id = t.school_year_id
           LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id
          WHERE qs.organization_id = $1 AND qs.retake_student_id IS NULL
            AND ($3::int IS NULL OR qs.subject_id IN (SELECT us.subject_id FROM user_subjects us WHERE us.user_id = $3))
            AND ($2::text IS NULL OR qs.set_title ILIKE $2 ESCAPE '\\' OR s.subject_name ILIKE $2 ESCAPE '\\'
                 OR c.class_name ILIKE $2 ESCAPE '\\' OR a.title ILIKE $2 ESCAPE '\\')
            AND EXISTS (SELECT 1 FROM assessment_questions q WHERE q.question_set_id = qs.question_set_id)
          ORDER BY qs.updated_at DESC NULLS LAST, qs.question_set_id DESC
          LIMIT 60`,
        [organizationId, like, teacherOnly(req)]
      );
      return res.json({
        success: true,
        sets: rows.map((row) => ({
          questionSetId: Number(row.question_set_id),
          title: row.set_title || [row.subject_name, row.assessment_title].filter(Boolean).join(" · ") || "Questions",
          className: row.class_name || "",
          subjectName: row.subject_name || "",
          termName: [row.term_name, row.year_label].filter(Boolean).join(" · "),
          assessmentTitle: row.assessment_title || "",
          questionCount: Number(row.question_count) || 0,
          classId: Number(row.class_id) || null,
          subjectId: Number(row.subject_id) || null,
          termId: Number(row.term_id) || null,
          assessmentId: Number(row.assessment_id) || null,
        })),
      });
    } catch (error) {
      console.error("[Question library]", error.message);
      return fail(res, 500, "Earlier questions couldn't be loaded.");
    }
  },

  // One earlier set's questions, to copy into a new set (copies: the original isn't touched).
  librarySet: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const setId = toId(req.params.setId);
    if (!setId) return fail(res, 400, "Choose a question set.");
    try {
      const { rows } = await db.query(
        `SELECT q.question_type, q.question_text, q.options_json, q.options_layout, q.answer_key, q.marks,
                ${assessmentApproval.columnsReady() ? "q.media_json" : "NULL::jsonb AS media_json"}
           FROM assessment_questions q
           JOIN assessment_question_sets qs ON qs.question_set_id = q.question_set_id
          WHERE qs.organization_id = $1 AND q.question_set_id = $2
            AND ($3::int IS NULL OR qs.subject_id IN (SELECT us.subject_id FROM user_subjects us WHERE us.user_id = $3))
          ORDER BY q.position_index ASC, q.question_id ASC`,
        [organizationId, setId, teacherOnly(req)]
      );
      return res.json({
        success: true,
        questions: rows.map((row) => ({
          questionType: row.question_type,
          questionText: row.question_text,
          options: Array.isArray(row.options_json) ? row.options_json : [],
          optionLayout: row.options_layout === "side_by_side" ? "side_by_side" : "stacked",
          answerKey: row.answer_key || "",
          marks: Number(row.marks || 1),
          media: questionMedia.forDisplay(row.media_json, res.locals.publicImageUrl, { withAnswers: true }),
          rubric: row.rubric_json || null,
        })),
      });
    } catch (error) {
      console.error("[Question library]", error.message);
      return fail(res, 500, "Those questions couldn't be loaded.");
    }
  },
};

