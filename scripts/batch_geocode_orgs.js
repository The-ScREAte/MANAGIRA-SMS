/**
 * scripts/batch_geocode_orgs.js
 *
 * One-time script: geocode all organizations that have an address but no
 * geo_lat/geo_lng yet, using OpenStreetMap Nominatim (free, no API key).
 *
 * Nominatim rate limit: 1 request/second — this script respects it.
 *
 * Usage:
 *   node scripts/batch_geocode_orgs.js
 *
 * Safe to re-run — only processes orgs with NULL coordinates.
 */
require("dotenv").config();
const { Pool } = require("pg");
const { geocodeAddress } = require("../utils/geocode");

const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const { rows } = await pool.query(
    `SELECT organization_id, organization_name, organization_address, organization_province, organization_country
     FROM organizations
     WHERE deleted = false
       AND geo_lat IS NULL
       AND organization_address IS NOT NULL
       AND organization_address <> ''
     ORDER BY organization_id`
  );

  console.log(`Found ${rows.length} org(s) to geocode.`);

  let success = 0;
  let failed = 0;

  for (const org of rows) {
    const coords = await geocodeAddress(
      org.organization_address,
      org.organization_province,
      org.organization_country
    );

    if (coords) {
      await pool.query(
        "UPDATE organizations SET geo_lat = $1, geo_lng = $2 WHERE organization_id = $3",
        [coords.lat, coords.lng, org.organization_id]
      );
      console.log(`✓ [${org.organization_id}] ${org.organization_name} → ${coords.lat}, ${coords.lng}`);
      success++;
    } else {
      console.log(`✗ [${org.organization_id}] ${org.organization_name} — not found`);
      failed++;
    }

    // Respect Nominatim's 1 request/second rate limit
    await sleep(1100);
  }

  console.log(`\nDone. ${success} geocoded, ${failed} not found.`);
  await pool.end();
}

run().catch((e) => {
  console.error("Fatal error:", e.message);
  pool.end();
  process.exit(1);
});
