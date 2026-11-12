"use strict";
// A student's portfolio (feature student_portfolio): one folder per term holding everything the
// student did that term: each assessment, assignment and piece of homework with its mark, every
// marked online test as a document (and PDF) and the term's report card. Parents and the student
// see marks exactly as the gradebook lets them (a score waiting for the teacher's approval stays
// hidden, utils/assessmentApproval.js).
const assessmentApproval = require("./assessmentApproval");
const testResults = require("./testResults");
const features = require("./shards/features");

const featureOn = (organizationId) => features.isOn("student_portfolio", { organizationId: Number(organizationId) || null });
const HOMEWORK = /home\s*work|assignment|take[-\s]?home|project/i;
const TEST = /test|exam|quiz|midterm|final/i;
const kindOf = (category, title) => {
  const words = `${category || ""} ${title || ""}`;
  if (HOMEWORK.test(words)) return "assignment";
  if (TEST.test(words)) return "test";
  return "other";
};

// Terms the student has anything in (enrolled or marked), newest first.
async function termsFor(db, organizationId, studentId) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.term_name, t.current, t.start_date, t.end_date, sy.year_label
       FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1 AND (
            t.current = TRUE
         OR EXISTS (SELECT 1 FROM enrollments e JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
                     WHERE e.organization_id = $1 AND e.term_id = t.term_id AND es.student_id = $2)
         OR EXISTS (SELECT 1 FROM assessment_results ar JOIN assessments a ON a.assessment_id = ar.assessment_id
                     WHERE ar.student_id = $2 AND a.organization_id = $1 AND a.term_id = t.term_id))
      ORDER BY t.start_date DESC NULLS LAST, t.term_id DESC`,
    [organizationId, studentId]
  );
  return rows.map((row) => ({
    id: Number(row.term_id),
    name: row.term_name,
    year: row.year_label || "",
    current: row.current,
    start: row.start_date,
    end: row.end_date,
  }));
}

// The class the student was in that term (their enrollment, else their class now).
async function classFor(db, organizationId, studentId, termId) {
  const { rows } = await db.query(
    `SELECT c.class_id, c.class_name FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       JOIN classes c ON c.class_id = es.class_id
      WHERE e.organization_id = $1 AND e.term_id = $2 AND es.student_id = $3
      ORDER BY e.created_at DESC LIMIT 1`,
    [organizationId, termId, studentId]
  );
  if (rows[0]) return { id: Number(rows[0].class_id), name: rows[0].class_name };
  const { rows: now } = await db.query(
    `SELECT c.class_id, c.class_name FROM students s JOIN classes c ON c.class_id = s.class_id
      WHERE s.organization_id = $1 AND s.student_id = $2`,
    [organizationId, studentId]
  );
  return now[0] ? { id: Number(now[0].class_id), name: now[0].class_name } : null;
}

const pct = (score, max) => (Number.isFinite(score) && Number(max) > 0 ? Math.round((score / Number(max)) * 1000) / 10 : null);

// One term's folder, as the family sees it.
async function build(db, organizationId, studentId, termId) {
  const flow = assessmentApproval.flowOn(organizationId);
  const klass = await classFor(db, organizationId, studentId, termId);
  const scoreSql = assessmentApproval.visibleScore("ar", flow);
  const choiceSql = assessmentApproval.visibleChoice("ar", flow);
  const [assessments, shared, reports] = await Promise.all([
    klass ? db.query(
      `SELECT a.assessment_id, a.title, a.category, a.max_score, a.edit_window_end, s.subject_id, s.subject_name,
              ${scoreSql} AS score, ${choiceSql} AS choice
         FROM assessments a
         JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
         LEFT JOIN assessment_results ar ON ar.assessment_id = a.assessment_id AND ar.student_id = $2
        WHERE a.organization_id = $1 AND a.term_id = $3 AND a.class_id = $4
          AND COALESCE(a.is_active, TRUE) AND a.obsolete_at IS NULL
          AND (ar.result_id IS NOT NULL OR EXISTS (
                SELECT 1 FROM student_subjects ss WHERE ss.organization_id = $1 AND ss.student_id = $2 AND ss.subject_id = a.subject_id))
        ORDER BY LOWER(s.subject_name), a.assessment_id`,
      [organizationId, studentId, termId, klass.id]
    ) : { rows: [] },
    flow ? testResults.sharedResults(db, organizationId, studentId, { termId }).catch(() => []) : [],
    db.query(
      `SELECT posted_report_card_id, pdf_url, pdf_s3_key, posted_at FROM posted_report_cards
        WHERE organization_id = $1 AND student_id = $2 AND term_id = $3 ORDER BY posted_at DESC LIMIT 1`,
      [organizationId, studentId, termId]
    ).catch(() => ({ rows: [] })),
  ]);
  const testByAssessment = new Map(shared.map((row) => [row.assessmentId, row]));
  const subjects = new Map();
  let marked = 0;
  let pctSum = 0;
  let pctCount = 0;
  assessments.rows.forEach((row) => {
    const score = row.score === null || row.score === undefined ? null : Number(row.score);
    const choice = row.choice || "";
    const done = score !== null || Boolean(choice);
    if (done) marked += 1;
    const percent = score !== null ? pct(score, row.max_score) : null;
    if (percent !== null) { pctSum += percent; pctCount += 1; }
    const test = testByAssessment.get(Number(row.assessment_id));
    const key = Number(row.subject_id);
    if (!subjects.has(key)) subjects.set(key, { name: row.subject_name, items: [] });
    subjects.get(key).items.push({
      id: Number(row.assessment_id),
      title: row.title,
      category: row.category || "",
      kind: kindOf(row.category, row.title),
      maxScore: Number(row.max_score || 0),
      score,
      choice,
      percent,
      due: row.edit_window_end,
      attemptId: test ? test.attemptId : null,
    });
  });
  const documents = shared.map((row) => ({
    attemptId: row.attemptId,
    title: row.title,
    subject: row.subject,
    submittedAt: row.submittedAt,
    grade: row.choice || (row.score !== null ? `${Number(row.score.toFixed(2))} / ${row.maxScore}` : ""),
    full: row.full,
  }));
  const report = reports.rows[0];
  return {
    className: klass ? klass.name : "",
    summary: {
      total: assessments.rows.length,
      marked,
      average: pctCount ? Math.round((pctSum / pctCount) * 10) / 10 : null,
      documents: documents.length + (report ? 1 : 0),
    },
    subjects: [...subjects.values()],
    documents,
    reportCard: report ? { id: Number(report.posted_report_card_id), url: report.pdf_url || null, postedAt: report.posted_at } : null,
  };
}

// The marked test as a document: the grade, and the questions with answers when the teacher
// shared them in full. Null when it isn't shared or posted (or isn't this student's).
async function testDocument(db, organizationId, studentId, attemptId, imageUrl) {
  const shared = (await testResults.sharedResults(db, organizationId, studentId)).find((row) => row.attemptId === Number(attemptId));
  if (!shared) return null;
  const full = shared.full ? await testResults.review(db, organizationId, studentId, attemptId, imageUrl) : null;
  const { rows } = await db.query(
    `SELECT s.first_name, s.last_name, c.class_name, t.term_name, sy.year_label, o.organization_name
       FROM student_assessment_attempts saa
       JOIN students s ON s.student_id = saa.student_id
       JOIN assessments a ON a.assessment_id = saa.assessment_id
       LEFT JOIN classes c ON c.class_id = a.class_id
       LEFT JOIN terms t ON t.term_id = a.term_id
       LEFT JOIN school_years sy ON sy.id = t.school_year_id
       JOIN organizations o ON o.organization_id = saa.organization_id
      WHERE saa.organization_id = $1 AND saa.attempt_id = $2 AND saa.student_id = $3`,
    [organizationId, attemptId, studentId]
  );
  const meta = rows[0] || {};
  // An answer saved as a letter ("B") reads as its option, like the right answer does.
  const questions = (full ? full.questions : []).map((q) => {
    const letters = (q.given || []).every((v) => /^[A-Za-z]$/.test(v) && !q.options.includes(v));
    if (!q.options.length || !q.given || !q.given.length || !letters) return q;
    const mapped = q.given.map((v) => q.options[v.toUpperCase().charCodeAt(0) - 65]);
    return mapped.every((v) => v !== undefined) ? { ...q, given: mapped } : q;
  });
  return {
    ...shared,
    questions,
    studentName: [meta.first_name, meta.last_name].filter(Boolean).join(" "),
    className: meta.class_name || "",
    termName: [meta.term_name, meta.year_label].filter(Boolean).join(", "),
    schoolName: meta.organization_name || "",
    percent: shared.score !== null ? pct(shared.score, shared.maxScore) : null,
  };
}

module.exports = { featureOn, termsFor, build, testDocument };
