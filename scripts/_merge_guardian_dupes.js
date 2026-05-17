/**
 * Merge duplicate guardian_profiles for the same person (same name + email).
 * Strategy: keep the guardian_id that has a guardian_accounts entry (login).
 * For any guardian_student links that point to the OLD id only, re-link to the KEEP id.
 * Then delete the OLD profile.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DB_CONNECTION_STRING, ssl: { rejectUnauthorized: false } });

async function mergeDuplicates() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find all duplicate groups (same name + email, multiple guardian_ids)
    const dupes = await client.query(`
      SELECT
        organization_id,
        LOWER(first_name) AS fn,
        LOWER(last_name)  AS ln,
        LOWER(email)      AS em,
        ARRAY_AGG(guardian_id ORDER BY guardian_id) AS ids
      FROM guardian_profiles
      WHERE email IS NOT NULL AND email != ''
      GROUP BY organization_id, LOWER(first_name), LOWER(last_name), LOWER(email)
      HAVING COUNT(*) > 1
    `);

    console.log(`Found ${dupes.rows.length} duplicate group(s).`);

    for (const group of dupes.rows) {
      const ids = group.ids; // sorted ascending

      // Prefer the id that has a guardian_accounts entry; else keep the newest (highest id)
      const acctRes = await client.query(
        `SELECT guardian_id FROM guardian_accounts WHERE guardian_id = ANY($1) LIMIT 1`,
        [ids]
      );
      const keepId = acctRes.rows.length ? acctRes.rows[0].guardian_id : ids[ids.length - 1];
      const removeIds = ids.filter(id => id !== keepId);

      console.log(`\nGroup [${ids.join(',')}]: keeping ${keepId}, removing ${removeIds.join(',')}`);

      for (const oldId of removeIds) {
        // Re-link any student links from oldId that aren't already on keepId
        const links = await client.query(
          `SELECT student_id FROM guardian_students WHERE guardian_id = $1`, [oldId]
        );
        for (const { student_id } of links.rows) {
          const existing = await client.query(
            `SELECT 1 FROM guardian_students WHERE guardian_id = $1 AND student_id = $2`, [keepId, student_id]
          );
          if (!existing.rows.length) {
            await client.query(
              `UPDATE guardian_students SET guardian_id = $1 WHERE guardian_id = $2 AND student_id = $3`,
              [keepId, oldId, student_id]
            );
            console.log(`  Re-linked student ${student_id} from ${oldId} → ${keepId}`);
          } else {
            await client.query(
              `DELETE FROM guardian_students WHERE guardian_id = $1 AND student_id = $2`, [oldId, student_id]
            );
            console.log(`  Removed duplicate student link ${oldId} → student ${student_id} (${keepId} already linked)`);
          }
        }

        // Remove guardian_reports links if any
        await client.query(`DELETE FROM guardian_reports WHERE guardian_id = $1`, [oldId]);

        // Delete the duplicate profile (cascade will clean up any remaining FK refs)
        await client.query(`DELETE FROM guardian_profiles WHERE guardian_id = $1`, [oldId]);
        console.log(`  Deleted guardian_profile ${oldId}`);
      }
    }

    await client.query('COMMIT');
    console.log('\nDone. Duplicates merged successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error — rolled back:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

mergeDuplicates();
