const db = require('./config/db');
(async () => {
  try {
    const rows = await db.query(`
      SELECT g.guardian_id,
             g.student_id,
             s.first_name AS student_first_name,
             s.last_name AS student_last_name,
             g.first_name,
             g.last_name,
             g.phone,
             g.email,
             g.organization_id
      FROM guardians g
      LEFT JOIN students s ON s.student_id = g.student_id
      WHERE g.organization_id = 63
        AND (
          LOWER(COALESCE(g.email, '')) = LOWER($1)
          OR COALESCE(g.phone, '') = $2
          OR (
            LOWER(TRIM(COALESCE(g.first_name, ''))) = LOWER($3)
            AND LOWER(TRIM(COALESCE(g.last_name, ''))) = LOWER($4)
          )
        )
      ORDER BY g.guardian_id, g.student_id
    `, ['jefferyguardian@gmail.com', '3854589960', 'Jeffery', 'Wilson']);

    console.log('LEGACY_GUARDIAN_ROWS');
    console.log(JSON.stringify(rows.rows, null, 2));

    const linkRows = await db.query(`
      SELECT psg.guardian_id, psg.pending_student_id, ps.first_name, ps.last_name
      FROM pending_student_guardians psg
      JOIN pending_students ps ON ps.pending_id = psg.pending_student_id
      WHERE psg.guardian_id = 1
      ORDER BY ps.first_name, ps.last_name
    `);

    console.log('PENDING_LINKS_FOR_GUARDIAN_1');
    console.log(JSON.stringify(linkRows.rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await db.end();
  }
})();
