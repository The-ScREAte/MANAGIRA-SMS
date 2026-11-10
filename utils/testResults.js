"use strict";
// Finished online tests as parents and the student see them (the assessments flow): only once
// the teacher has posted the grade, and only as much as the teacher chose to share with the
// question set (assessment_question_sets.parent_share): 'grade', or 'full' (the grade with the
// questions, the student's answers and the right answers). Every attempt is kept; this shows
// the latest finished one for each test.
const sanitizeHtml = require("./sanitizeHtml");
const questionMedia = require("./questionMedia");

const SIMPLE_TAGS = { allowedTags: ["b", "strong", "i", "em", "u", "br", "sub", "sup", "p"], allowedAttributes: {} };

// The finished tests of a student this term that the teacher shared and posted, newest first.
async function sharedResults(db, organizationId, studentId, { classId = null, termId = null } = {}) {
  if (!studentId) return [];
  const { rows } = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (saa.assessment_id)
              saa.attempt_id, saa.assessment_id, saa.question_set_id, saa.submitted_at, saa.score AS attempt_score, saa.max_score AS attempt_max
         FROM student_assessment_attempts saa
        WHERE saa.organization_id = $1 AND saa.student_id = $2 AND saa.status = 'submitted'
        ORDER BY saa.assessment_id, saa.submitted_at DESC NULLS LAST, saa.attempt_id DESC
     )
     SELECT l.attempt_id, l.assessment_id, l.submitted_at, a.title, a.max_score, s.subject_name, qs.parent_share,
            ar.score, ar.choice_label
       FROM latest l
       JOIN assessments a ON a.assessment_id = l.assessment_id AND a.organization_id = $1
       JOIN assessment_question_sets qs ON qs.question_set_id = l.question_set_id AND qs.organization_id = $1
       LEFT JOIN subjects s ON s.subject_id = a.subject_id
       JOIN assessment_results ar ON ar.assessment_id = l.assessment_id AND ar.student_id = $2 AND ar.pending_since IS NULL
      WHERE qs.parent_share IN ('grade', 'full')
        AND ($3::int IS NULL OR a.class_id = $3)
        AND ($4::int IS NULL OR a.term_id = $4)
        AND (ar.score IS NOT NULL OR ar.choice_label IS NOT NULL)
      ORDER BY l.submitted_at DESC NULLS LAST, l.attempt_id DESC`,
    [organizationId, studentId, classId || null, termId || null]
  );
  return rows.map((row) => ({
    attemptId: Number(row.attempt_id),
    assessmentId: Number(row.assessment_id),
    title: row.title || "Test",
    subject: row.subject_name || "",
    submittedAt: row.submitted_at,
    score: row.score === null ? null : Number(row.score),
    maxScore: Number(row.max_score || 0),
    choice: row.choice_label || "",
    full: row.parent_share === "full",
  }));
}

// One shared, posted test with its questions, the student's answers and the right ones.
async function review(db, organizationId, studentId, attemptId, imageUrl) {
  const shared = (await sharedResults(db, organizationId, studentId)).find((row) => row.attemptId === Number(attemptId));
  if (!shared || !shared.full) return null;
  const { rows } = await db.query(
    `SELECT q.question_id, q.question_type, q.question_text, q.options_json, q.answer_key, q.marks, q.media_json,
            r.response_text, r.response_json, r.awarded_marks
       FROM student_assessment_attempts saa
       JOIN assessment_questions q ON q.question_set_id = saa.question_set_id
       LEFT JOIN student_assessment_responses r ON r.attempt_id = saa.attempt_id AND r.question_id = q.question_id
      WHERE saa.organization_id = $1 AND saa.attempt_id = $2 AND saa.student_id = $3
      ORDER BY q.position_index ASC, q.question_id ASC`,
    [organizationId, attemptId, studentId]
  );
  const questions = rows.map((row) => {
    const type = String(row.question_type || "short_text").toLowerCase();
    const given = row.response_json && Array.isArray(row.response_json.values)
      ? row.response_json.values.map((value) => String(value))
      : (row.response_text ? [String(row.response_text)] : []);
    const options = Array.isArray(row.options_json)
      ? row.options_json.map((option) => String(option && typeof option === "object" ? option.text || option.label || "" : option))
      : [];
    const media = questionMedia.forDisplay(row.media_json, imageUrl, { withAnswers: true });
    let correct = type === "image_label"
      ? ((media && media.labels) || []).map((label) => label.answer)
      : String(row.answer_key || "").split(",").map((part) => part.trim()).filter(Boolean);
    // Choice answers may be saved as letters ("B"): show the option itself.
    if (options.length && correct.length && correct.every((part) => /^[A-Za-z]$/.test(part)) && !correct.every((part) => options.includes(part))) {
      const mapped = correct.map((part) => options[part.toUpperCase().charCodeAt(0) - 65]);
      if (mapped.every((value) => value !== undefined)) correct = mapped;
    }
    return {
      type,
      html: sanitizeHtml(String(row.question_text || ""), SIMPLE_TAGS),
      marks: Number(row.marks || 0),
      awarded: row.awarded_marks === null || row.awarded_marks === undefined ? null : Number(row.awarded_marks),
      options,
      given: type === "multiple_choice" && given.length === 1 ? given[0].split(",").map((part) => part.trim()).filter(Boolean) : given,
      correct: type === "essay" ? [] : correct,
      media,
    };
  });
  return { ...shared, questions };
}

module.exports = { sharedResults, review };
