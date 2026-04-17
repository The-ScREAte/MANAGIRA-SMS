const db = require('./config/db');
(async () => {
  try {
    const portal = await db.query(`
      SELECT guardian_id, first_name, last_name, email, phone, organization_id
      FROM guardian_profiles
      WHERE organization_id = 63
      ORDER BY guardian_id
      LIMIT 20
    `);
    console.log('GUARDIAN_PROFILES');
    console.log(JSON.stringify(portal.rows, null, 2));

    const legacy = await db.query(`
      SELECT guardian_id, student_id, first_name, last_name, email, phone, organization_id
      FROM guardians
      WHERE organization_id = 63
      ORDER BY guardian_id, student_id
      LIMIT 40
    `);
    console.log('LEGACY_GUARDIANS');
    console.log(JSON.stringify(legacy.rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await db.end();
  }
})();
