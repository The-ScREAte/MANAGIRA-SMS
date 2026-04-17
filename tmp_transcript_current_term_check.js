const db = require('./config/db');
(async () => {
  try {
    const currentTermRows = await db.query(`
      SELECT ar.student_id, ar.subject_id, sub.subject_name, ar.term_id, t.term_name,
             sy.year_label, sy.current AS school_year_current, t.current AS term_current,
             COUNT(*) AS result_rows,
             MAX(ar.total_percentage) AS total_percentage,
             MAX(ar.grade) AS grade
      FROM assessment_results ar
      JOIN assessments a ON a.assessment_id = ar.assessment_id
      JOIN subjects sub ON sub.subject_id = a.subject_id
      JOIN terms t ON t.term_id = ar.term_id
      JOIN school_years sy ON sy.id = t.school_year_id
      WHERE ar.student_id = 181
        AND ar.organization_id = 63
        AND ar.term_id = 150
      GROUP BY ar.student_id, ar.subject_id, sub.subject_name, ar.term_id, t.term_name, sy.year_label, sy.current, t.current
      ORDER BY sub.subject_name
    `);

    const transcriptQueryRows = await db.query(`
      SELECT COUNT(*) AS transcript_visible_rows
      FROM (
        SELECT sub.subject_name, ar.total_percentage, ar.grade, t.term_name, sy.year_label
        FROM assessment_results ar
        JOIN assessments a ON ar.assessment_id = a.assessment_id
        JOIN subjects sub ON a.subject_id = sub.subject_id
        JOIN terms t ON ar.term_id = t.term_id
        JOIN school_years sy ON t.school_year_id = sy.id
        WHERE ar.student_id = 181 AND ar.organization_id = 63
          AND sy.current = FALSE
        GROUP BY sub.subject_name, ar.total_percentage, ar.grade, t.term_name, sy.year_label
      ) q
    `);

    console.log('=== STUDENT 181 CURRENT TERM 150 ROWS ===');
    console.log(JSON.stringify(currentTermRows.rows, null, 2));
    console.log('=== TRANSCRIPT QUERY VISIBLE ROW COUNT ===');
    console.log(JSON.stringify(transcriptQueryRows.rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await db.end();
  }
})();
