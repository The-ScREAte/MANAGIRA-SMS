const db = require('../config/db');

async function main() {
  const tables = ['guardian_profiles', 'guardian_accounts', 'guardian_reports', 'guardian_report_replies', 'guardian_report_recipients'];
  try {
    for (const table of tables) {
      const r = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1
         ORDER BY ordinal_position`,
        [table]
      );
      if (!r.rows.length) {
        console.log(`${table}: NOT FOUND`);
      } else {
        console.log(`${table}: ${r.rows.map(x => x.column_name).join(', ')}`);
      }
    }
  } catch (e) {
    console.error('probe failed:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
