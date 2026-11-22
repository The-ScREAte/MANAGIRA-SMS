"use strict";

// The school-year health check: what has to be true for enrollment, assessments and reports to
// agree with each other. Read-only. `checkSchool(db, organizationId)` answers a list of findings
// (empty = healthy); scripts/yearIntegrityCheck.js runs it for one school or every school.
//
//   one current term               exactly one term, in the current school year, is current
//   terms don't overlap            within a year and across years
//   students are enrolled          every active student with a class is in the current term, in that class
//   classes are in the term        every class that has students enrolled is listed in that term
//   assessments sit in real places an assessment's class is enrolled in its term, and its subject is that class's
//
// Each check is one statement; none writes.

const CHECKS = [
  {
    key: "current-term",
    title: "Exactly one current term",
    sql: `SELECT COUNT(*) FILTER (WHERE t.current)::int AS n FROM terms t WHERE t.organization_id = $1`,
    bad: (row) => Number(row.n) !== 1,
    say: (row) => `${row.n} terms are marked current (there should be exactly one).`,
  },
  {
    key: "current-flags-agree",
    title: "The two current-term flags agree",
    sql: `SELECT COUNT(*)::int AS n FROM terms WHERE organization_id = $1 AND COALESCE(current, FALSE) <> COALESCE(current_term, FALSE)`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} terms have different current flags.`,
  },
  {
    key: "term-dates",
    title: "Terms end after they start",
    sql: `SELECT COUNT(*)::int AS n FROM terms WHERE organization_id = $1 AND end_date < start_date`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} terms end before they start.`,
  },
  {
    key: "terms-overlap",
    title: "Terms don't overlap",
    sql: `SELECT COUNT(*)::int AS n
            FROM terms a JOIN terms b ON b.organization_id = a.organization_id AND b.term_id > a.term_id
           WHERE a.organization_id = $1 AND a.start_date <= b.end_date AND b.start_date <= a.end_date`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} pairs of terms overlap.`,
  },
  {
    key: "students-enrolled",
    title: "Every active student with a class is enrolled in the current term",
    sql: `SELECT COUNT(*)::int AS n
            FROM students s
           WHERE s.organization_id = $1 AND s.class_id IS NOT NULL AND NOT COALESCE(s.graduated, FALSE)
             AND EXISTS (SELECT 1 FROM terms t WHERE t.organization_id = $1 AND t.current)
             AND NOT EXISTS (SELECT 1 FROM enrolled_students es
                               JOIN enrollments e ON e.enrollment_id = es.enrollment_id
                               JOIN terms t ON t.term_id = e.term_id
                              WHERE es.student_id = s.student_id AND t.current AND t.organization_id = $1)`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} students have a class but are not enrolled in the current term.`,
  },
  {
    key: "enrolled-class-matches",
    title: "A student's enrolled class is their class",
    sql: `SELECT COUNT(*)::int AS n
            FROM enrolled_students es
            JOIN enrollments e ON e.enrollment_id = es.enrollment_id
            JOIN terms t ON t.term_id = e.term_id
            JOIN students s ON s.student_id = es.student_id
           WHERE t.organization_id = $1 AND t.current AND NOT COALESCE(s.graduated, FALSE)
             AND s.class_id IS DISTINCT FROM es.class_id`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} students are enrolled in a different class from the one on their record.`,
  },
  {
    key: "classes-in-term",
    title: "Classes with enrolled students are listed in their term",
    sql: `SELECT COUNT(DISTINCT es.class_id)::int AS n
            FROM enrolled_students es
            JOIN enrollments e ON e.enrollment_id = es.enrollment_id
           WHERE e.organization_id = $1
             AND NOT EXISTS (SELECT 1 FROM enrolled_classes ec WHERE ec.enrollment_id = es.enrollment_id AND ec.class_id = es.class_id)`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} classes have students enrolled but are not listed in the term.`,
  },
  {
    key: "assessment-class-enrolled",
    title: "Every assessment's class is enrolled in its term",
    sql: `SELECT COUNT(*)::int AS n
            FROM assessments a
           WHERE a.organization_id = $1 AND a.obsolete_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM enrolled_classes ec JOIN enrollments e ON e.enrollment_id = ec.enrollment_id
                              WHERE e.term_id = a.term_id AND ec.class_id = a.class_id)`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} assessments belong to a class that is not enrolled in their term.`,
  },
  {
    key: "assessment-subject-in-class",
    title: "Every assessment's subject belongs to its class",
    sql: `SELECT COUNT(*)::int AS n
            FROM assessments a JOIN subjects s ON s.subject_id = a.subject_id
           WHERE a.organization_id = $1 AND a.obsolete_at IS NULL AND s.class_id IS DISTINCT FROM a.class_id`,
    bad: (row) => Number(row.n) > 0,
    say: (row) => `${row.n} assessments use a subject that belongs to another class.`,
  },
];

async function checkSchool(db, organizationId) {
  const findings = [];
  for (const check of CHECKS) {
    try {
      const { rows } = await db.query(check.sql, [organizationId]);
      const row = rows[0] || { n: 0 };
      if (check.bad(row)) findings.push({ key: check.key, title: check.title, detail: check.say(row) });
    } catch (error) {
      findings.push({ key: check.key, title: check.title, detail: `Could not be checked: ${error.message}` });
    }
  }
  return findings;
}

module.exports = { CHECKS, checkSchool };
