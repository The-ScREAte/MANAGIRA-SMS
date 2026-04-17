const db = require('./config/db');
(async () => {
  try {
    const email = 'jefferyguardian@gmail.com';
    const phone = '3854589960';
    const result = await db.query(`
      SELECT o.organization_id,
             o.nickname,
             gp.guardian_id,
             gp.first_name,
             gp.last_name,
             gp.phone,
             gp.email,
             ga.id AS guardian_account_id,
             ga.login_email,
             ga.login_phone
      FROM guardian_profiles gp
      LEFT JOIN guardian_accounts ga
        ON ga.guardian_id = gp.guardian_id
       AND ga.organization_id = gp.organization_id
      LEFT JOIN organizations o
        ON o.organization_id = gp.organization_id
      WHERE LOWER(COALESCE(gp.email, '')) = LOWER($1)
         OR COALESCE(gp.phone, '') = $2
         OR LOWER(COALESCE(ga.login_email, '')) = LOWER($1)
         OR COALESCE(ga.login_phone, '') = $2
      ORDER BY gp.organization_id, gp.guardian_id
    `, [email, phone]);

    console.log('GUARDIAN_MATCHES');
    console.log(JSON.stringify(result.rows, null, 2));

    for (const row of result.rows) {
      const links = await db.query(`
        SELECT 'guardian_students' AS source, gs.student_id, s.first_name, s.last_name, s.organization_id
        FROM guardian_students gs
        JOIN students s ON s.student_id = gs.student_id
        WHERE gs.guardian_id = $1
        UNION ALL
        SELECT 'guardians' AS source, g.student_id, s.first_name, s.last_name, s.organization_id
        FROM guardians g
        JOIN students s ON s.student_id = g.student_id
        WHERE g.guardian_id = $1 AND g.organization_id = $2
        ORDER BY source, first_name, last_name
      `, [row.guardian_id, row.organization_id]);

      console.log(`LINKS_FOR_GUARDIAN_${row.guardian_id}_ORG_${row.organization_id}`);
      console.log(JSON.stringify(links.rows, null, 2));
    }
  } catch (error) {
    console.error(error);
  } finally {
    await db.end();
  }
})();
