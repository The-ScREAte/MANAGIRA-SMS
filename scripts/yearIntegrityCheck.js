#!/usr/bin/env node
"use strict";

// Runs the school-year health check (utils/yearIntegrity.js) and prints what is wrong, if anything.
//   node scripts/yearIntegrityCheck.js            every school
//   node scripts/yearIntegrityCheck.js 63         one school
// Read-only. It uses the app's own database connection, so point DATABASE_URL at a local copy
// unless you mean to read the live one. Exits 1 when any school has a finding.

const db = require("../config/db");
const { CHECKS, checkSchool } = require("../utils/yearIntegrity");

(async () => {
  const only = Number(process.argv[2]) || null;
  const schools = only
    ? [{ organization_id: only }]
    : (await db.query("SELECT organization_id FROM organizations ORDER BY organization_id")).rows;
  let unhealthy = 0;
  for (const school of schools) {
    const findings = await checkSchool(db, school.organization_id);
    if (!findings.length) { if (only) console.log(`School ${school.organization_id}: healthy (${CHECKS.length} checks)`); continue; }
    unhealthy += 1;
    console.log(`School ${school.organization_id}:`);
    findings.forEach((f) => console.log(`  - ${f.title}: ${f.detail}`));
  }
  console.log(unhealthy ? `${unhealthy} of ${schools.length} schools need attention.` : `All ${schools.length} schools checked: healthy.`);
  await db.end?.();
  process.exit(unhealthy ? 1 : 0);
})().catch((error) => { console.error(error.message); process.exit(2); });
