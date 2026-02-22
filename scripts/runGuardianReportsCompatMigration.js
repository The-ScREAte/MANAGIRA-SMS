const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function main() {
  const migrationPath = path.join(
    __dirname,
    '..',
    'database',
    'migrations',
    '2026-02-22_fix_guardian_reports_staff_submission_compat.sql'
  );

  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await db.query(sql);
    console.log('Applied migration: 2026-02-22_fix_guardian_reports_staff_submission_compat.sql');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
