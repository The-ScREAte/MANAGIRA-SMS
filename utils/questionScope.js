"use strict";

// Online tests a teacher may work on: only those of the subjects they teach (user_subjects),
// the same subjects the class dashboard shows them. Managers, supervisors and other staff
// with the permission work on every class. Used by the Assessment Questions page and, as
// route middleware, by every question-set action (writing, approving, deleting, grading,
// posting, unlocking), so a teacher can't reach another teacher's test by its number.

const isTeacher = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "")
  .trim().toLowerCase() === "teacher";

// The subject ids a teacher teaches in this school, or null when the person isn't a teacher.
async function teacherSubjectIds(db, req) {
  if (!isTeacher(req)) return null;
  const userId = Number(req.session.userId || req.session.user?.user_id || 0);
  if (!userId) return new Set();
  const { rows } = await db.query(
    `SELECT DISTINCT s.subject_id
       FROM user_subjects us
       JOIN subjects s ON s.subject_id = us.subject_id
      WHERE us.user_id = $1 AND s.organization_id = $2`,
    [userId, Number(req.session.organizationId)]
  );
  return new Set(rows.map((row) => Number(row.subject_id)));
}

const idOf = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// The subjects a request names, through whichever of its ids it carries.
async function subjectsNamed(db, organizationId, source) {
  const subjects = [];
  const lookups = [
    [source.questionSetId ?? source.sourceQuestionSetId ?? source.setId,
      `SELECT a.subject_id FROM assessment_question_sets qs
         JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
        WHERE qs.organization_id = $1 AND qs.question_set_id = $2`],
    [source.assessmentId, "SELECT subject_id FROM assessments WHERE organization_id = $1 AND assessment_id = $2"],
    [source.attemptId,
      `SELECT a.subject_id FROM student_assessment_attempts saa
         JOIN assessments a ON a.assessment_id = saa.assessment_id AND a.organization_id = saa.organization_id
        WHERE saa.organization_id = $1 AND saa.attempt_id = $2`],
  ];
  for (const [raw, sql] of lookups) {
    const id = idOf(raw);
    if (!id) continue;
    const { rows } = await db.query(sql, [organizationId, id]);
    // An id from another school, or one that no longer exists, names nothing here: the
    // action itself answers "not found".
    if (rows[0]) subjects.push(Number(rows[0].subject_id));
  }
  const resourceId = idOf(source.resourceId);
  if (resourceId) {
    const { rows } = await db.query(
      `SELECT a.subject_id FROM assessment_set_resources r
         JOIN assessment_question_sets qs ON qs.question_set_id = r.question_set_id AND qs.organization_id = r.organization_id
         JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
        WHERE r.organization_id = $1 AND r.resource_id = $2`,
      [organizationId, resourceId]
    );
    if (rows[0]) subjects.push(Number(rows[0].subject_id));
  }
  for (const raw of [source.subjectId, source.targetSubjectId]) {
    const id = idOf(raw);
    if (id) subjects.push(id);
  }
  return subjects;
}

// Route middleware for the question-set actions (JSON answers). `resourceParam` names the
// route parameter holding an attached file's id.
function requireQuestionScope(db, { resourceParam = null } = {}) {
  return async (req, res, next) => {
    try {
      const mine = await teacherSubjectIds(db, req);
      if (!mine) return next();
      const source = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
      if (resourceParam) source.resourceId = req.params[resourceParam];
      const named = await subjectsNamed(db, Number(req.session.organizationId), source);
      if (named.every((subjectId) => mine.has(subjectId))) return next();
      return res.status(403).json({ success: false, error: "You can only work on tests for the subjects you teach.", message: "You can only work on tests for the subjects you teach." });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { teacherSubjectIds, requireQuestionScope };
