const fs = require("fs");
const path = require("path");
const db = require("../config/db");

async function main() {
  const migrationPath = path.join(__dirname, "..", "database", "migrations", "2026-04-15_create_class_schedules.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(sql);
    const result = await db.query(`
      SELECT to_regclass('public.class_schedules') AS class_schedules,
             to_regclass('public.class_schedule_entries') AS class_schedule_entries
    `);

    console.log(JSON.stringify(result.rows[0] || {}, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error && (error.stack || error.message) ? (error.stack || error.message) : error);
  process.exit(1);
});