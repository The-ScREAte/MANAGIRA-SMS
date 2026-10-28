// Rejected online applications (Admissions → Online Applications).
// Rejecting an application no longer deletes it: it is kept, marked rejected,
// for REJECTED_KEEP_DAYS so the school can look back at it or reverse the
// decision. After that a daily job removes it (and its guardians, subjects
// and form answers) for good.
const REJECTED_KEEP_DAYS = 60;

let schemaReady = null;
function ensureAdmissionStatusSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        ALTER TABLE pending_students
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
          ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS rejected_by_name TEXT
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_pending_students_org_status ON pending_students (organization_id, status)`);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function rejectApplication(db, { pendingId, organizationId, byName }) {
  await ensureAdmissionStatusSchema(db);
  const { rows } = await db.query(
    `UPDATE pending_students
        SET status = 'rejected', rejected_at = NOW(), rejected_by_name = $3
      WHERE pending_id = $1 AND organization_id = $2 AND status <> 'rejected'
      RETURNING pending_id, first_name, last_name`,
    [pendingId, organizationId, byName || null]
  );
  return rows[0] || null;
}

// Puts a rejected application back with the others waiting for a decision.
async function reverseRejection(db, { pendingId, organizationId }) {
  await ensureAdmissionStatusSchema(db);
  const { rows } = await db.query(
    `UPDATE pending_students
        SET status = 'pending', rejected_at = NULL, rejected_by_name = NULL
      WHERE pending_id = $1 AND organization_id = $2 AND status = 'rejected'
      RETURNING pending_id, first_name, last_name`,
    [pendingId, organizationId]
  );
  return rows[0] || null;
}

// Removes applications rejected more than REJECTED_KEEP_DAYS ago. Guardians,
// subjects and payments go with them (ON DELETE CASCADE); form answers are
// removed here.
async function purgeOldRejections(db, keepDays = REJECTED_KEEP_DAYS) {
  await ensureAdmissionStatusSchema(db);
  const { rows } = await db.query(
    `SELECT pending_id FROM pending_students
      WHERE status = 'rejected' AND rejected_at < NOW() - make_interval(days => $1)`,
    [keepDays]
  );
  if (!rows.length) return { deleted: 0 };
  const ids = rows.map((r) => r.pending_id);
  await db.query(`DELETE FROM application_field_values WHERE pending_id = ANY($1::int[])`, [ids]).catch(() => {});
  const result = await db.query(
    `DELETE FROM pending_students
      WHERE pending_id = ANY($1::int[]) AND status = 'rejected'
        AND rejected_at < NOW() - make_interval(days => $2)`,
    [ids, keepDays]
  );
  return { deleted: result.rowCount };
}

module.exports = { REJECTED_KEEP_DAYS, ensureAdmissionStatusSchema, rejectApplication, reverseRejection, purgeOldRejections };
