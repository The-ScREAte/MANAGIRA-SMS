/**
 * Email notification preferences.
 *
 * Provides:
 *  - Schema-ensure helper for user_email_preferences and guardian_email_preferences
 *  - A catalog of "toggleable" email keys grouped by recipient type / role
 *  - Read/write helpers for both subject types
 *  - Lookup helpers used at email send-sites:
 *      isUserEmailEnabled(db, userId, key)           -> bool, default true
 *      isGuardianEmailEnabled(db, guardianId, key)   -> bool, default true
 *      isEmailEnabledForRecipient(db, email, key)    -> bool, default true
 *      filterEmailsByPreference(db, emails, key)     -> string[] of opted-in emails
 *
 *  Defaults to ENABLED if no preference row exists, so existing behaviour is
 *  preserved until users actively opt out.
 */

let schemaReady = false;
let schemaPromise = null;

async function ensureEmailPreferencesSchema(db) {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_email_preferences (
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        preference_key VARCHAR(80) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, preference_key)
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_user_email_preferences_user
        ON user_email_preferences(user_id)
    `);

    // Guardian preferences only created if guardian_profiles exists.
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS guardian_email_preferences (
          guardian_id INTEGER NOT NULL REFERENCES guardian_profiles(guardian_id) ON DELETE CASCADE,
          preference_key VARCHAR(80) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (guardian_id, preference_key)
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_guardian_email_preferences_guardian
          ON guardian_email_preferences(guardian_id)
      `);
    } catch (err) {
      // guardian_profiles table missing — skip silently.
      if (err && err.code !== '42P01') throw err;
    }

    // Hub-side preferences (separate auth from users/guardians).
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_email_preferences (
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          preference_key VARCHAR(80) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (hub_id, preference_key)
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_hub_email_preferences_hub
          ON hub_email_preferences(hub_id)
      `);
    } catch (err) {
      if (err && err.code !== '42P01') throw err;
    }

    schemaReady = true;
  })().finally(() => { schemaPromise = null; });

  return schemaPromise;
}

// ─────────────────────────────────────────────────────────────
// Catalog: which keys are user-toggleable, grouped by recipient role.
// ─────────────────────────────────────────────────────────────

const STAFF_TOGGLEABLE = [
  // Manager / Supervisor (org leadership)
  {
    key: 'weekly_manager_digest',
    label: 'Weekly leadership report',
    description: 'Saturday digest of at-risk students and key school metrics.',
    roles: ['Manager', 'Supervisor'],
  },
  {
    key: 'student_tier_exceeded',
    label: 'School-growth (student tier) notice',
    description: 'When your enrollment exceeds your current plan tier.',
    roles: ['Manager'],
  },

  // Teacher
  {
    key: 'weekly_teacher_digest',
    label: 'Weekly teaching digest',
    description: 'Saturday summary of your assigned classes and subjects.',
    roles: ['Teacher'],
  },
  {
    key: 'teacher_reassignment',
    label: 'Class & subject assignment changes',
    description: 'When your class or subject assignments are updated.',
    roles: ['Teacher'],
  },
  {
    key: 'assessment_control_teacher',
    label: 'Assessment lock / unlock activity',
    description: 'When an assessment you teach is activated, locked, or unlocked.',
    roles: ['Teacher'],
  },
  {
    key: 'assessment_access_update',
    label: 'Assessment access updates',
    description: 'When the access window or settings for an assessment change.',
    roles: ['Teacher'],
  },
  {
    key: 'files_assigned_to_class',
    label: 'Files assigned to your class',
    description: 'When a document or spreadsheet is assigned to a class you teach.',
    roles: ['Teacher'],
  },

  // Staff-shared (Manager + Supervisor + Teacher)
  {
    key: 'guardian_report_created_staff',
    label: 'New guardian reports',
    description: 'When a parent files a new report and you are a routed recipient.',
    roles: ['Manager', 'Supervisor', 'Teacher'],
  },
  {
    key: 'guardian_report_reply_staff',
    label: 'Replies on guardian reports',
    description: 'When a parent posts a reply on a guardian report.',
    roles: ['Manager', 'Supervisor', 'Teacher'],
  },
  {
    key: 'broadcast_event_or_announcement',
    label: 'Events & announcements',
    description: 'New events and announcements broadcast to staff.',
    roles: ['Manager', 'Supervisor', 'Teacher'],
  },

  // All staff incl. Cashier / Mini Admin
  {
    key: 'account_hold_or_resume',
    label: 'Account suspension / reactivation',
    description: 'When your account is placed on hold or reactivated.',
    roles: ['Manager', 'Supervisor', 'Teacher', 'Cashier', 'Mini Admin'],
  },
];

const GUARDIAN_TOGGLEABLE = [
  { key: 'parent_absence_alert', label: 'Attendance alerts', description: 'When your child is absent multiple times in a week.' },
  { key: 'weekly_parent_digest', label: 'Weekly progress digest (Saturday)', description: 'Weekly summary of your children\u2019s progress.' },
  { key: 'student_class_change', label: 'Class change notifications', description: 'When your child is moved to a different class.' },
  { key: 'staff_report_to_guardian', label: 'Reports from school staff', description: 'Reports staff send to you with the email option enabled.' },
  { key: 'staff_reply_to_guardian', label: 'Replies on your reports', description: 'When school staff reply on a report you filed.' },
  { key: 'report_card_email', label: 'Report card delivery', description: 'Receive your child\u2019s report card by email when sent.' },
  { key: 'broadcast_event_or_announcement', label: 'Events & announcements', description: 'New school events and announcements visible to parents.' },
  { key: 'admission_application_received', label: 'Application received confirmations', description: 'Confirmation when an application is submitted for your child.' },
  { key: 'guardian_additional_student_added', label: 'Additional child added to your portal', description: 'When another child is linked to your existing parent-portal account.' },
];

const HUB_TOGGLEABLE = [
  { key: 'weekly_hub_digest', label: 'Weekly hub overview (Saturday)', description: 'Weekly cross-organization summary across all member schools.' },
];

const ALL_KEYS = new Set([
  ...STAFF_TOGGLEABLE.map(e => e.key),
  ...GUARDIAN_TOGGLEABLE.map(e => e.key),
  ...HUB_TOGGLEABLE.map(e => e.key),
]);

function getStaffPreferencesForRole(accountType) {
  if (!accountType) return [];
  return STAFF_TOGGLEABLE.filter(p => p.roles.includes(accountType));
}

function getGuardianPreferences() {
  return GUARDIAN_TOGGLEABLE.slice();
}

function getHubPreferences() {
  return HUB_TOGGLEABLE.slice();
}

// ─────────────────────────────────────────────────────────────
// Read / write
// ─────────────────────────────────────────────────────────────

async function getUserPreferenceMap(db, userId) {
  if (!userId) return {};
  await ensureEmailPreferencesSchema(db);
  const r = await db.query(
    `SELECT preference_key, enabled FROM user_email_preferences WHERE user_id = $1`,
    [userId]
  );
  const out = {};
  for (const row of r.rows) out[row.preference_key] = !!row.enabled;
  return out;
}

async function getGuardianPreferenceMap(db, guardianId) {
  if (!guardianId) return {};
  await ensureEmailPreferencesSchema(db);
  try {
    const r = await db.query(
      `SELECT preference_key, enabled FROM guardian_email_preferences WHERE guardian_id = $1`,
      [guardianId]
    );
    const out = {};
    for (const row of r.rows) out[row.preference_key] = !!row.enabled;
    return out;
  } catch (err) {
    if (err && err.code === '42P01') return {};
    throw err;
  }
}

async function setUserPreferences(db, userId, allowedKeys, submittedKeys) {
  if (!userId) return;
  await ensureEmailPreferencesSchema(db);
  const allowedSet = new Set(allowedKeys);
  const enabledSet = new Set((submittedKeys || []).filter(k => allowedSet.has(k)));

  // Upsert one row per allowed key.
  for (const key of allowedKeys) {
    const enabled = enabledSet.has(key);
    await db.query(
      `INSERT INTO user_email_preferences (user_id, preference_key, enabled, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, preference_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
      [userId, key, enabled]
    );
  }
}

async function setGuardianPreferences(db, guardianId, allowedKeys, submittedKeys) {
  if (!guardianId) return;
  await ensureEmailPreferencesSchema(db);
  const allowedSet = new Set(allowedKeys);
  const enabledSet = new Set((submittedKeys || []).filter(k => allowedSet.has(k)));

  for (const key of allowedKeys) {
    const enabled = enabledSet.has(key);
    try {
      await db.query(
        `INSERT INTO guardian_email_preferences (guardian_id, preference_key, enabled, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (guardian_id, preference_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
        [guardianId, key, enabled]
      );
    } catch (err) {
      if (err && err.code === '42P01') return;
      throw err;
    }
  }
}

async function getHubPreferenceMap(db, hubId) {
  if (!hubId) return {};
  await ensureEmailPreferencesSchema(db);
  try {
    const r = await db.query(
      `SELECT preference_key, enabled FROM hub_email_preferences WHERE hub_id = $1`,
      [hubId]
    );
    const out = {};
    for (const row of r.rows) out[row.preference_key] = !!row.enabled;
    return out;
  } catch (err) {
    if (err && err.code === '42P01') return {};
    throw err;
  }
}

async function setHubPreferences(db, hubId, allowedKeys, submittedKeys) {
  if (!hubId) return;
  await ensureEmailPreferencesSchema(db);
  const allowedSet = new Set(allowedKeys);
  const enabledSet = new Set((submittedKeys || []).filter(k => allowedSet.has(k)));

  for (const key of allowedKeys) {
    const enabled = enabledSet.has(key);
    try {
      await db.query(
        `INSERT INTO hub_email_preferences (hub_id, preference_key, enabled, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (hub_id, preference_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
        [hubId, key, enabled]
      );
    } catch (err) {
      if (err && err.code === '42P01') return;
      throw err;
    }
  }
}

async function isHubEmailEnabled(db, hubId, key) {
  if (!hubId || !key) return true;
  if (!ALL_KEYS.has(key)) return true;
  try {
    await ensureEmailPreferencesSchema(db);
    const r = await db.query(
      `SELECT enabled FROM hub_email_preferences WHERE hub_id = $1 AND preference_key = $2`,
      [hubId, key]
    );
    if (!r.rows.length) return true;
    return !!r.rows[0].enabled;
  } catch (_) {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
// Send-site lookups
// ─────────────────────────────────────────────────────────────

async function isUserEmailEnabled(db, userId, key) {
  if (!userId || !key) return true;
  if (!ALL_KEYS.has(key)) return true; // unknown / not toggleable -> always send
  try {
    await ensureEmailPreferencesSchema(db);
    const r = await db.query(
      `SELECT enabled FROM user_email_preferences WHERE user_id = $1 AND preference_key = $2`,
      [userId, key]
    );
    if (!r.rows.length) return true;
    return !!r.rows[0].enabled;
  } catch (_) {
    return true; // fail open: do not block emails on schema errors
  }
}

async function isGuardianEmailEnabled(db, guardianId, key) {
  if (!guardianId || !key) return true;
  if (!ALL_KEYS.has(key)) return true;
  try {
    await ensureEmailPreferencesSchema(db);
    const r = await db.query(
      `SELECT enabled FROM guardian_email_preferences WHERE guardian_id = $1 AND preference_key = $2`,
      [guardianId, key]
    );
    if (!r.rows.length) return true;
    return !!r.rows[0].enabled;
  } catch (_) {
    return true;
  }
}

/**
 * Look up an arbitrary email and check whether it has opted out of `key`.
 * Falls back to enabled (true) if email is not on file or schema is missing.
 */
async function isEmailEnabledForRecipient(db, email, key) {
  if (!email || !key) return true;
  if (!ALL_KEYS.has(key)) return true;
  try {
    await ensureEmailPreferencesSchema(db);
    const norm = String(email).trim().toLowerCase();

    // user side
    try {
      const r = await db.query(
        `SELECT COALESCE(uep.enabled, TRUE) AS enabled
           FROM users u
           LEFT JOIN user_email_preferences uep
             ON uep.user_id = u.user_id AND uep.preference_key = $2
          WHERE LOWER(u.email) = $1
          LIMIT 1`,
        [norm, key]
      );
      if (r.rows.length) return !!r.rows[0].enabled;
    } catch (_) { /* ignore */ }

    // guardian side
    try {
      const r = await db.query(
        `SELECT COALESCE(gep.enabled, TRUE) AS enabled
           FROM guardian_profiles g
           LEFT JOIN guardian_email_preferences gep
             ON gep.guardian_id = g.guardian_id AND gep.preference_key = $2
          WHERE LOWER(g.email) = $1
          LIMIT 1`,
        [norm, key]
      );
      if (r.rows.length) return !!r.rows[0].enabled;
    } catch (_) { /* ignore */ }

    return true;
  } catch (_) {
    return true;
  }
}

/**
 * Filter a list of recipient emails, returning only those who haven't opted
 * out of `key`. Emails not associated with any user/guardian are returned
 * unchanged (they have no preference record).
 */
async function filterEmailsByPreference(db, emails, key) {
  const list = (Array.isArray(emails) ? emails : []).filter(Boolean);
  if (!list.length || !key || !ALL_KEYS.has(key)) return list;

  try {
    await ensureEmailPreferencesSchema(db);
    const lowered = list.map(e => String(e).trim().toLowerCase());

    // Anyone who explicitly disabled this key.
    const disabled = new Set();

    try {
      const r = await db.query(
        `SELECT LOWER(u.email) AS email
           FROM user_email_preferences uep
           JOIN users u ON u.user_id = uep.user_id
          WHERE uep.preference_key = $1
            AND uep.enabled = FALSE
            AND LOWER(u.email) = ANY($2)`,
        [key, lowered]
      );
      for (const row of r.rows) disabled.add(row.email);
    } catch (_) { /* ignore */ }

    try {
      const r = await db.query(
        `SELECT LOWER(g.email) AS email
           FROM guardian_email_preferences gep
           JOIN guardian_profiles g ON g.guardian_id = gep.guardian_id
          WHERE gep.preference_key = $1
            AND gep.enabled = FALSE
            AND LOWER(g.email) = ANY($2)`,
        [key, lowered]
      );
      for (const row of r.rows) disabled.add(row.email);
    } catch (_) { /* ignore */ }

    if (!disabled.size) return list;
    return list.filter(e => !disabled.has(String(e).trim().toLowerCase()));
  } catch (_) {
    return list;
  }
}

module.exports = {
  ensureEmailPreferencesSchema,
  STAFF_TOGGLEABLE,
  GUARDIAN_TOGGLEABLE,
  HUB_TOGGLEABLE,
  getStaffPreferencesForRole,
  getGuardianPreferences,
  getHubPreferences,
  getUserPreferenceMap,
  getGuardianPreferenceMap,
  getHubPreferenceMap,
  setUserPreferences,
  setGuardianPreferences,
  setHubPreferences,
  isUserEmailEnabled,
  isGuardianEmailEnabled,
  isHubEmailEnabled,
  isEmailEnabledForRecipient,
  filterEmailsByPreference,
};
