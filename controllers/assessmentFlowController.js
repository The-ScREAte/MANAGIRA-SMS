"use strict";
// The assessments flow (feature assessment_flow): approving grades so parents and the student
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
// A teacher works with the question sets of their own classes, as on the questions page.
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

  // The gradebook's columns for this person, on any device: the last few assessments only,
  // and which totals show.
  saveGradebookView: async (req, res) => {
    const lastN = Number(req.body && req.body.lastN);
    const hidden = Array.isArray(req.body && req.body.hidden) ? req.body.hidden.filter((key) => SUMMARY_COLUMNS.includes(key)) : [];
    const value = { lastN: [1, 2, 3, 4, 5].includes(lastN) ? lastN : null, hidden: [...new Set(hidden)] };
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
            AND ($3::int IS NULL OR qs.class_id IN (SELECT uc.class_id FROM user_classes uc WHERE uc.user_id = $3))
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
            AND ($3::int IS NULL OR qs.class_id IN (SELECT uc.class_id FROM user_classes uc WHERE uc.user_id = $3))
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
        })),
      });
    } catch (error) {
      console.error("[Question library]", error.message);
      return fail(res, 500, "Those questions couldn't be loaded.");
    }
  },
};
