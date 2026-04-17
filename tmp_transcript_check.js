const db = require('./config/db');
(async () => {
  try {
    const termCheck = await db.query(`
      SELECT t.term_id, t.term_name, t.current AS term_current, t.start_date, t.end_date,
             sy.id AS school_year_id, sy.year_label, sy.current AS school_year_current,
             c.class_id, c.class_name, c.organization_id
      FROM terms t
      JOIN school_years sy ON sy.id = t.school_year_id
      LEFT JOIN classes c ON c.class_id = 46
      WHERE t.term_id = 150
    `);

    const classStudents = await db.query(`
      SELECT s.student_id, s.first_name, s.last_name, s.class_id, s.organization_id
      FROM students s
      WHERE s.class_id = 46
      ORDER BY s.student_id
      LIMIT 10
    `);

    const transcriptCandidate = await db.query(`
      SELECT s.student_id, s.first_name, s.last_name, s.organization_id,
             COUNT(ar.*) AS assessment_rows,
             COUNT(*) FILTER (WHERE ar.total_percentage IS NOT NULL) AS rows_with_percentage
      FROM students s
      LEFT JOIN assessment_results ar
        ON ar.student_id = s.student_id AND ar.organization_id = s.organization_id
      WHERE s.student_id = 181
      GROUP BY s.student_id, s.first_name, s.last_name, s.organization_id
    `);

    const transcriptRows = await db.query(`
      SELECT ar.student_id, ar.subject_id, sub.subject_name, ar.term_id, t.term_name,
             sy.year_label, sy.current AS school_year_current,
             ar.total_percentage, ar.grade, ar.organization_id, ar.class_id
      FROM assessment_results ar
      JOIN assessments a ON a.assessment_id = ar.assessment_id
      JOIN subjects sub ON sub.subject_id = a.subject_id
      JOIN terms t ON t.term_id = ar.term_id
      JOIN school_years sy ON sy.id = t.school_year_id
      WHERE ar.student_id = 181
      ORDER BY sy.year_label, t.term_name, sub.subject_name
      LIMIT 100
    `);

    console.log('=== TERM CHECK ===');
    console.log(JSON.stringify(termCheck.rows, null, 2));
    console.log('=== CLASS 46 STUDENTS ===');
    console.log(JSON.stringify(classStudents.rows, null, 2));
    console.log('=== STUDENT 181 SUMMARY ===');
    console.log(JSON.stringify(transcriptCandidate.rows, null, 2));
    console.log('=== STUDENT 181 TRANSCRIPT SOURCE ROWS ===');
    console.log(JSON.stringify(transcriptRows.rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await db.end();
  }
})();
