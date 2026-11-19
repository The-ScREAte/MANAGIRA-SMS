"use strict";

// One place that keeps students enrolled, term by term. Rules:
// - Enrolling is always ADD-only: it never removes a student from a term. Only an explicit,
//   guarded action (Delete Enrollment, Modify Enrollment, a promotion's own reverse) removes anyone.
// - A year's students are enrolled in a TERM of it (the current term of the current year, otherwise
//   the year's first term), never in a term-less or "latest created" enrollment.
// - Every active student with a class is enrolled in the school's current term
//   (`ensureCurrentTermEnrollment`); a student who has attendance, scores or a report card in a term
//   is enrolled in that term (`ensureEnrollmentWhereRecordsExist`). A student already enrolled in a
//   later term (a future intake) is left as they are.
// `db` is a pool or a client.

async function currentTerm(db, organizationId) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.school_year_id, t.start_date
       FROM terms t JOIN school_years sy ON sy.id = t.school_year_id AND sy.organization_id = t.organization_id
      WHERE t.organization_id = $1 AND t.current = TRUE AND sy.current = TRUE
      ORDER BY t.start_date DESC LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

// The term a school year's students are enrolled in: its current term when it is the current year,
// otherwise its first term. null when the year has no terms yet.
async function termForYear(db, organizationId, yearId) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.school_year_id, t.start_date
       FROM terms t JOIN school_years sy ON sy.id = t.school_year_id AND sy.organization_id = t.organization_id
      WHERE t.organization_id = $1 AND t.school_year_id = $2
      ORDER BY (sy.current AND t.current) DESC, t.start_date ASC, t.term_id ASC LIMIT 1`,
    [organizationId, yearId]
  );
  return rows[0] || null;
}

async function enrollmentFor(db, organizationId, term) {
  const found = await db.query(
    `SELECT enrollment_id FROM enrollments WHERE organization_id = $1 AND term_id = $2 ORDER BY enrollment_id LIMIT 1`,
    [organizationId, term.term_id]
  );
  if (found.rows.length) return found.rows[0].enrollment_id;
  const created = await db.query(
    `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING enrollment_id`,
    [term.school_year_id, term.term_id, organizationId]
  );
  return created.rows[0].enrollment_id;
}

// Edit Student / bulk edit with a school year: enroll these students in that year's term, only
// adding. A student already in the term keeps their place (and takes the new class only when one
// was chosen); every other enrollment they have stays exactly as it was.
async function enrollStudentsInYear(db, { organizationId, yearId, studentIds, classId = null }) {
  const term = await termForYear(db, organizationId, yearId);
  if (!term) {
    const error = new Error("That school year has no terms yet. Add a term to it first, then enroll the student.");
    error.userFacing = true;
    throw error;
  }
  const enrollmentId = await enrollmentFor(db, organizationId, term);
  const ids = (studentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return { termId: term.term_id, enrollmentId, added: 0 };
  const added = await db.query(
    `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
     SELECT $1, s.student_id, COALESCE($4::int, s.class_id)
       FROM students s WHERE s.organization_id = $2 AND s.student_id = ANY($3::int[])
     ON CONFLICT (enrollment_id, student_id) DO NOTHING`,
    [enrollmentId, organizationId, ids, classId]
  );
  if (classId) {
    await db.query(
      `UPDATE enrolled_students SET class_id = $2 WHERE enrollment_id = $1 AND student_id = ANY($3::int[]) AND class_id IS DISTINCT FROM $2`,
      [enrollmentId, classId, ids]
    );
  }
  return { termId: term.term_id, enrollmentId, added: added.rowCount || 0 };
}

// A class change moves the student in the school's CURRENT term only: earlier terms keep the class
// they had (report cards and transcripts show it), later terms are planned separately.
async function moveStudentsToClassInCurrentTerm(db, { organizationId, studentIds, classId }) {
  const ids = (studentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length || !classId) return 0;
  const term = await currentTerm(db, organizationId);
  if (!term) return 0;
  const result = await db.query(
    `UPDATE enrolled_students es SET class_id = $1
       FROM enrollments e
      WHERE es.enrollment_id = e.enrollment_id AND e.organization_id = $2 AND e.term_id = $3
        AND es.student_id = ANY($4::int[]) AND es.class_id IS DISTINCT FROM $1`,
    [classId, organizationId, term.term_id, ids]
  );
  return result.rowCount || 0;
}

// Every active student with a class is enrolled in the current term. Add-only.
// neverEnrolledOnly: only students who have no enrollment anywhere (the nightly sweep, which must not
// undo a deliberate removal from a term).
async function ensureCurrentTermEnrollment(db, organizationId, { studentIds = null, neverEnrolledOnly = false } = {}) {
  const term = await currentTerm(db, organizationId);
  if (!term) return { added: 0, termId: null };
  const ids = Array.isArray(studentIds) ? studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : null;
  if (ids && !ids.length) return { added: 0, termId: term.term_id };
  const needs = await db.query(
    `SELECT s.student_id FROM students s
      WHERE s.organization_id = $1 AND NOT COALESCE(s.graduated, FALSE) AND s.class_id IS NOT NULL
        AND ($2::int[] IS NULL OR s.student_id = ANY($2::int[]))
        AND (NOT $5::boolean OR NOT EXISTS (SELECT 1 FROM enrolled_students any_es WHERE any_es.student_id = s.student_id))
        AND NOT EXISTS (
          SELECT 1 FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
            JOIN terms t ON t.term_id = e.term_id
           WHERE es.student_id = s.student_id AND e.organization_id = $1
             AND (t.term_id = $3 OR t.start_date > $4))
      LIMIT 20000`,
    [organizationId, ids, term.term_id, term.start_date, neverEnrolledOnly]
  );
  if (!needs.rows.length) return { added: 0, termId: term.term_id };
  const enrollmentId = await enrollmentFor(db, organizationId, term);
  const result = await db.query(
    `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
     SELECT $1, s.student_id, s.class_id FROM students s WHERE s.organization_id = $2 AND s.student_id = ANY($3::int[])
     ON CONFLICT (enrollment_id, student_id) DO NOTHING`,
    [enrollmentId, organizationId, needs.rows.map((r) => Number(r.student_id))]
  );
  return { added: result.rowCount || 0, termId: term.term_id };
}

// A student with attendance, scores or a report card in a term is enrolled in that term (their
// class there is the one on the record, else the class they are in now). Graduated students keep
// their history as it is.
async function ensureEnrollmentWhereRecordsExist(db, organizationId) {
  const { rows } = await db.query(
    `WITH rec AS (
       SELECT student_id, term_id, class_id FROM student_reports WHERE organization_id = $1 AND term_id IS NOT NULL
       UNION ALL SELECT student_id, term_id, class_id FROM attendance_records WHERE organization_id = $1 AND term_id IS NOT NULL
       UNION ALL SELECT ar.student_id, a.term_id, ar.class_id FROM assessment_results ar JOIN assessments a ON a.assessment_id = ar.assessment_id WHERE a.organization_id = $1 AND a.term_id IS NOT NULL)
     SELECT DISTINCT ON (rec.student_id, rec.term_id) rec.student_id, rec.term_id, COALESCE(rec.class_id, s.class_id) AS class_id
       FROM rec JOIN students s ON s.student_id = rec.student_id AND s.organization_id = $1
      WHERE NOT COALESCE(s.graduated, FALSE)
        AND NOT EXISTS (SELECT 1 FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
                         WHERE es.student_id = rec.student_id AND e.term_id = rec.term_id)
      ORDER BY rec.student_id, rec.term_id`,
    [organizationId]
  );
  let added = 0;
  const termRows = new Map();
  for (const row of rows) {
    if (!termRows.has(row.term_id)) {
      const t = await db.query(`SELECT term_id, school_year_id FROM terms WHERE term_id = $1 AND organization_id = $2`, [row.term_id, organizationId]);
      termRows.set(row.term_id, t.rows[0] || null);
    }
    const term = termRows.get(row.term_id);
    if (!term) continue;
    const enrollmentId = await enrollmentFor(db, organizationId, term);
    const r = await db.query(
      `INSERT INTO enrolled_students (enrollment_id, student_id, class_id) VALUES ($1, $2, $3) ON CONFLICT (enrollment_id, student_id) DO NOTHING`,
      [enrollmentId, row.student_id, row.class_id]
    );
    added += r.rowCount || 0;
  }
  return { added };
}

// The nightly sweep: every school, add-only. Returns what it repaired.
async function keepEveryoneEnrolled(db) {
  const { rows } = await db.query(`SELECT DISTINCT organization_id FROM students WHERE organization_id IS NOT NULL`);
  const repaired = [];
  for (const { organization_id: organizationId } of rows) {
    try {
      const a = await ensureCurrentTermEnrollment(db, organizationId, { neverEnrolledOnly: true });
      const b = await ensureEnrollmentWhereRecordsExist(db, organizationId);
      if (a.added || b.added) repaired.push({ organizationId, currentTerm: a.added, withRecords: b.added });
    } catch (error) {
      console.error(`[enrollmentKeeper] school ${organizationId}:`, error.message);
    }
  }
  return repaired;
}

module.exports = {
  currentTerm, termForYear, enrollStudentsInYear, moveStudentsToClassInCurrentTerm,
  ensureCurrentTermEnrollment, ensureEnrollmentWhereRecordsExist, keepEveryoneEnrolled,
};
