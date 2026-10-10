// One definition of an "active" student - the students a school is charged for
// and bills fees to. Graduated students (Close Graduation Year Group) and
// archived students (Archived Students) are excluded from new charges; their
// past bills and balances stay visible in finance.

// SQL condition for a students-table alias, e.g. `WHERE s.organization_id = $1 AND ${activeStudentSql("s")}`.
function activeStudentSql(alias = "s") {
  return `COALESCE(${alias}.graduated, FALSE) = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM archived_student_info archived
       WHERE archived.student_id = ${alias}.student_id
         AND archived.organization_id = ${alias}.organization_id
    )`;
}

async function countActiveStudents(db, organizationId) {
  if (!organizationId) return 0;
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM students s WHERE s.organization_id = $1 AND ${activeStudentSql("s")}`,
      [organizationId]
    );
    return Number(rows[0]?.cnt || 0);
  } catch (_) {
    // Environments without archived_student_info: graduated is still excluded.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM students WHERE organization_id = $1 AND COALESCE(graduated, FALSE) = FALSE`,
      [organizationId]
    );
    return Number(rows[0]?.cnt || 0);
  }
}

module.exports = { activeStudentSql, countActiveStudents };
