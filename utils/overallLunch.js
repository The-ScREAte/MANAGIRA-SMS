"use strict";

// Overall lunch: for a student and term, the days with lunch out of the
// days lunch was taken for them (class_lunch holds one row per student per school day; no row
// means lunch wasn't taken that day). Pages show it beside overall attendance and read it for
// all their students in one statement.

const ids = (list) => [...new Set((list || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];

// Map(studentId -> { days, taken }) for one term. Students with nothing taken are left out.
async function totalsFor(db, organizationId, termId, studentIds) {
  const out = new Map();
  const students = ids(studentIds);
  const term = Number(termId);
  if (!students.length || !Number.isInteger(term) || term <= 0) return out;
  try {
    const { rows } = await db.query(
      `SELECT student_id, COUNT(*) FILTER (WHERE had_lunch)::int AS days, COUNT(*)::int AS taken
         FROM class_lunch
        WHERE organization_id = $1 AND term_id = $2 AND student_id = ANY($3::int[])
        GROUP BY student_id`,
      [Number(organizationId), term, students]
    );
    rows.forEach((row) => out.set(Number(row.student_id), { days: Number(row.days) || 0, taken: Number(row.taken) || 0 }));
  } catch (error) {
    if (!error || error.code !== "42P01") throw error; // the class_lunch migration hasn't run here yet
  }
  return out;
}

// "42 of 58 days", or "—" when lunch was never taken.
function label(total) {
  if (!total || !total.taken) return "—";
  return `${total.days} of ${total.taken} ${total.taken === 1 ? "day" : "days"}`;
}

module.exports = { totalsFor, label };
