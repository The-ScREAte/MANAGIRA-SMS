const db = require('./config/db');
(async () => {
  try {
    const rows = await db.query(`
      SELECT sub.subject_name,
             MAX(ar.total_percentage) AS total_percentage,
             MAX(ar.grade) AS grade,
             t.term_name,
             t.start_date,
             t.end_date,
             sy.year_label
      FROM assessment_results ar
      JOIN assessments a ON ar.assessment_id = a.assessment_id
      JOIN subjects sub ON a.subject_id = sub.subject_id
      JOIN terms t ON ar.term_id = t.term_id
      JOIN school_years sy ON t.school_year_id = sy.id
      WHERE ar.student_id = 181 AND ar.organization_id = 63
        AND (
          t.current = FALSE
          OR (t.end_date IS NOT NULL AND t.end_date < CURRENT_DATE)
        )
      GROUP BY sub.subject_name, t.term_name, t.start_date, t.end_date, sy.year_label
      ORDER BY COALESCE(t.end_date, t.start_date), t.start_date, sub.subject_name
    `);
    console.log(JSON.stringify(rows.rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await db.end();
  }
})();
