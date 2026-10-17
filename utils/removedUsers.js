"use strict";

// Removing a staff account from a school keeps the person and everything they
// did. Their attendance marks, scores, payments, documents and messages stay
// linked to them, so records still show who did what.
//
// A removed account:
//   - can't sign in (signed out everywhere, on hold);
//   - leaves the school's staff lists, pickers and user licenses (it is no
//     longer attached to the school: organization_id is cleared and the school
//     is kept in removed_from_organization_id);
//   - keeps its email and password, so enabling it again brings the person back
//     with the same sign-in. Their classes, subjects, mailroom classes,
//     permissions and team links are saved in removed_snapshot and put back.

const { revokeSessions } = require("./sessionRevoke");

let ready = null;
function ensureRemovedUsersSchema(db) {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS removed_by INTEGER,
          ADD COLUMN IF NOT EXISTS removed_from_organization_id INTEGER,
          ADD COLUMN IF NOT EXISTS removed_snapshot JSONB
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_removed_from_org
          ON users (removed_from_organization_id) WHERE removed_from_organization_id IS NOT NULL
      `);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

const tableExists = async (db, table) =>
  Boolean((await db.query("SELECT to_regclass($1) AS t", [`public.${table}`])).rows[0].t);

// What the person was set up with at this school, saved before removal.
async function snapshotAssignments(client, organizationId, userId) {
  const [classes, subjects, permissions, reports] = await Promise.all([
    client.query("SELECT class_id, COALESCE(main, FALSE) AS main FROM user_classes WHERE user_id = $1", [userId]),
    client.query("SELECT subject_id FROM user_subjects WHERE user_id = $1", [userId]),
    client.query("SELECT permission_key FROM user_permissions WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]),
    client.query("SELECT user_id FROM users WHERE supervisor_user_id = $1 AND organization_id = $2", [userId, organizationId]),
  ]);
  const mailroom = (await tableExists(client, "user_mailroom_classes"))
    ? (await client.query("SELECT class_id FROM user_mailroom_classes WHERE user_id = $1", [userId])).rows
    : [];
  return {
    classes: classes.rows.map((r) => ({ class_id: Number(r.class_id), main: Boolean(r.main) })),
    subjects: subjects.rows.map((r) => Number(r.subject_id)),
    mailroomClasses: mailroom.map((r) => Number(r.class_id)),
    permissions: permissions.rows.map((r) => r.permission_key),
    directReports: reports.rows.map((r) => Number(r.user_id)),
  };
}

/**
 * Removes a staff account from a school, keeping it and its records.
 * Runs inside the caller's transaction (client).
 */
async function removeUser(client, { organizationId, userId, removedBy }) {
  await ensureRemovedUsersSchema(client);
  const snapshot = await snapshotAssignments(client, organizationId, userId);

  await client.query("DELETE FROM user_classes WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM user_subjects WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM user_permissions WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  if (snapshot.mailroomClasses.length) {
    await client.query("DELETE FROM user_mailroom_classes WHERE user_id = $1", [userId]);
  }
  // People who reported to them now report to no one (put back on enable).
  await client.query(
    "UPDATE users SET supervisor_user_id = NULL, updated_at = NOW() WHERE supervisor_user_id = $1 AND organization_id = $2",
    [userId, organizationId]
  );

  const result = await client.query(
    `UPDATE users
        SET organization_id = NULL,
            removed_from_organization_id = $2,
            removed_at = NOW(),
            removed_by = $3,
            removed_snapshot = $4::jsonb,
            on_hold = TRUE,
            updated_at = NOW()
      WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId, Number.isInteger(Number(removedBy)) ? Number(removedBy) : null, JSON.stringify(snapshot)]
  );
  return result.rowCount > 0;
}

// Signs the removed person out everywhere (call after COMMIT).
function signOutRemovedUser(db, userId) {
  return revokeSessions(db, { userId });
}

/**
 * Puts a removed account back in its school with the same sign-in, classes,
 * subjects and permissions. Classes or subjects that were deleted or made
 * obsolete in the meantime are skipped. Runs inside the caller's transaction.
 * Returns { ok, reason, user }.
 */
async function restoreUser(client, { organizationId, userId }) {
  await ensureRemovedUsersSchema(client);
  const found = await client.query(
    `SELECT user_id, first_name, last_name, email, removed_snapshot
       FROM users
      WHERE user_id = $1 AND removed_from_organization_id = $2 AND organization_id IS NULL
      FOR UPDATE`,
    [userId, organizationId]
  );
  if (!found.rows.length) return { ok: false, reason: "not_found" };

  const license = await require("./licenses").orgLicense(client, organizationId);
  if (license.full) return { ok: false, reason: "license_full", license };

  const user = found.rows[0];
  const snap = user.removed_snapshot || {};
  await client.query(
    `UPDATE users
        SET organization_id = $2,
            removed_from_organization_id = NULL,
            removed_at = NULL,
            removed_by = NULL,
            removed_snapshot = NULL,
            on_hold = FALSE,
            updated_at = NOW()
      WHERE user_id = $1`,
    [userId, organizationId]
  );

  const liveClassIds = new Set(
    (await client.query(
      `SELECT class_id FROM classes
        WHERE organization_id = $1 AND class_id = ANY($2::int[])
          AND obsolete_at IS NULL`,
      [organizationId, [...(snap.classes || []).map((c) => c.class_id), ...(snap.mailroomClasses || [])]]
    )).rows.map((r) => Number(r.class_id))
  );
  for (const cls of snap.classes || []) {
    if (!liveClassIds.has(Number(cls.class_id))) continue;
    await client.query(
      `INSERT INTO user_classes (user_id, class_id, main)
       SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM user_classes WHERE user_id = $1 AND class_id = $2)`,
      [userId, cls.class_id, Boolean(cls.main)]
    );
  }
  if ((snap.subjects || []).length) {
    await client.query(
      `INSERT INTO user_subjects (user_id, subject_id)
       SELECT $1, s.subject_id FROM subjects s
        WHERE s.organization_id = $2 AND s.subject_id = ANY($3::int[]) AND s.obsolete_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_subjects us WHERE us.user_id = $1 AND us.subject_id = s.subject_id)`,
      [userId, organizationId, snap.subjects]
    );
  }
  const mailroom = (snap.mailroomClasses || []).filter((id) => liveClassIds.has(Number(id)));
  if (mailroom.length && (await tableExists(client, "user_mailroom_classes"))) {
    await client.query(
      `INSERT INTO user_mailroom_classes (user_id, class_id)
       SELECT $1, c FROM unnest($2::int[]) AS c
        WHERE NOT EXISTS (SELECT 1 FROM user_mailroom_classes m WHERE m.user_id = $1 AND m.class_id = c)`,
      [userId, mailroom]
    );
  }
  if ((snap.permissions || []).length) {
    await client.query(
      `INSERT INTO user_permissions (user_id, organization_id, permission_key)
       SELECT $1, $2, k FROM unnest($3::text[]) AS k
        WHERE NOT EXISTS (
          SELECT 1 FROM user_permissions p WHERE p.user_id = $1 AND p.organization_id = $2 AND p.permission_key = k)`,
      [userId, organizationId, snap.permissions]
    );
  }
  if ((snap.directReports || []).length) {
    await client.query(
      `UPDATE users SET supervisor_user_id = $1, updated_at = NOW()
        WHERE organization_id = $2 AND user_id = ANY($3::int[]) AND supervisor_user_id IS NULL`,
      [userId, organizationId, snap.directReports]
    );
  }
  return { ok: true, user };
}

// Removed accounts of a school, newest first, for the Users page.
async function listRemovedUsers(db, organizationId) {
  await ensureRemovedUsersSchema(db);
  const { rows } = await db.query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type, u.phone_number,
            u.org_role_title, u.created_at, u.removed_at, u.removed_snapshot,
            COALESCE(NULLIF(u.profile_image_url, ''), NULLIF(u.image_url, '')) AS photo_url,
            NULLIF(TRIM(CONCAT_WS(' ', rb.first_name, rb.last_name)), '') AS removed_by_name
       FROM users u
       LEFT JOIN users rb ON rb.user_id = u.removed_by
      WHERE u.removed_from_organization_id = $1 AND u.organization_id IS NULL
      ORDER BY u.removed_at DESC NULLS LAST, u.user_id DESC`,
    [organizationId]
  );
  return rows;
}

// A removed account of this school with this email, if any (for clear messages
// when someone tries to add the same person again).
async function findRemovedByEmail(db, organizationId, email) {
  await ensureRemovedUsersSchema(db);
  const { rows } = await db.query(
    `SELECT user_id, first_name, last_name FROM users
      WHERE LOWER(email) = LOWER($1) AND removed_from_organization_id = $2 AND organization_id IS NULL
      LIMIT 1`,
    [String(email || "").trim(), organizationId]
  );
  return rows[0] || null;
}

module.exports = {
  ensureRemovedUsersSchema,
  removeUser,
  restoreUser,
  signOutRemovedUser,
  listRemovedUsers,
  findRemovedByEmail,
};
