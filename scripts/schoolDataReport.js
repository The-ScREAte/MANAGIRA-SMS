#!/usr/bin/env node
// Read-only: how many rows each table still holds for one school (every table with an
// organization_id column). Used before and after deleting a school's data at the end of its
// agreement (docs/security/DATA_DELETION.md): after deletion every count must be 0.
//
//   node scripts/schoolDataReport.js <organizationId>
"use strict";

require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const organizationId = Number(process.argv[2]);
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error("Give the school's organization id.");
  const cs = process.env.DB_CONNECTION_STRING;
  const db = new Client({ connectionString: cs, ssl: cs.includes("sslmode=require") ? { rejectUnauthorized: false } : false, application_name: "school-data-report" });
  await db.connect();
  try {
    await db.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const { rows: tables } = await db.query(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
        ORDER BY c.table_name`
    );
    let total = 0;
    const left = [];
    for (const { table_name: table } of tables) {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${table.replace(/"/g, '""')}" WHERE organization_id = $1`, [organizationId]);
      if (rows[0].n) { left.push([table, rows[0].n]); total += rows[0].n; }
    }
    const school = (await db.query("SELECT organization_name, deleted FROM organizations WHERE organization_id = $1", [organizationId])).rows[0];
    console.log(school ? `School ${organizationId}: ${school.organization_name}${school.deleted ? " (marked deleted)" : ""}` : `School ${organizationId}: no organizations row`);
    left.forEach(([table, n]) => console.log(`  ${table}: ${n}`));
    console.log(`${total} rows in ${left.length} of ${tables.length} tables with an organization_id.`);
    console.log("Files are listed separately: node scripts/s3PrivateFolders.js prints counts per folder (school folders carry the school's id).");
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error("Report failed:", error.message);
  process.exit(1);
});
