const db = require('../config/db');

async function main() {
  try {
    const result = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'guardian_reports'
       ORDER BY ordinal_position`
    );

    if (!result.rows.length) {
      console.log('guardian_reports table not found');
      return;
    }

    console.log('guardian_reports columns:');
    for (const row of result.rows) {
      console.log(`- ${row.column_name}`);
    }
  } catch (error) {
    console.error('DB probe failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
