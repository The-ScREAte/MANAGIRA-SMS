require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DB_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });

pool.query(`
  SELECT
    MIN(first_name) AS first_name, MIN(last_name) AS last_name, MIN(email) AS email,
    organization_id,
    COUNT(*) AS count,
    ARRAY_AGG(guardian_id ORDER BY guardian_id) AS ids,
    ARRAY_AGG(COALESCE(phone,'—') ORDER BY guardian_id) AS phones
  FROM guardian_profiles
  WHERE email IS NOT NULL AND email != ''
  GROUP BY organization_id, LOWER(first_name), LOWER(last_name), LOWER(email)
  HAVING COUNT(*) > 1
  ORDER BY count DESC
  LIMIT 30
`).then(r => {
  console.log('=== Duplicate guardian_profiles (same name + email) ===');
  if (!r.rows.length) { console.log('No duplicates found.'); }
  else { r.rows.forEach(row => console.log(JSON.stringify(row))); }
  return pool.query(`
    SELECT COUNT(*) AS total_guardians,
           COUNT(DISTINCT LOWER(COALESCE(email,'')) || '|' || LOWER(first_name) || '|' || LOWER(last_name)) AS unique_combos
    FROM guardian_profiles
  `);
}).then(r => {
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(r.rows[0]));
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
