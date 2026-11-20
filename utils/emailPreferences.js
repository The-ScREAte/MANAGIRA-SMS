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

    // Organization-wide preferences — settings an admin picks on behalf of
    // the whole school (as opposed to a single user/guardian opting out for
    // themselves), e.g. whether the org auto-sends the parent-portal
    // password-setup invite when a student is added.
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS organization_email_preferences (
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          preference_key VARCHAR(80) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (organization_id, preference_key)
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_organization_email_preferences_org
          ON organization_email_preferences(organization_id)
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
  {
    key: 'tasks_and_invitations',
    label: 'Tasks, invitations and shared calendars',
    description: 'When someone assigns you a task, replies to it, adds you to an event or shares a calendar with you.',
    roles: ['Manager', 'Supervisor', 'Teacher', 'Cashier', 'Mini Admin'],
  },
  {
    key: 'scheduled_reports',
    label: 'Scheduled reports',
    description: 'Report Builder reports someone scheduled to arrive in your inbox.',
    roles: ['Manager', 'Supervisor', 'Teacher', 'Cashier', 'Mini Admin'],
  },
  {
    key: 'managira_news',
    label: 'News from Managira',
    description: 'Occasional product news and updates from the Managira team.',
    roles: ['Manager', 'Supervisor'],
  },
];

const GUARDIAN_TOGGLEABLE = [
  { key: 'parent_absence_alert', label: 'Attendance alerts', description: 'When your child is absent multiple times in a week.' },
  { key: 'weekly_parent_digest', label: 'Weekly briefing', description: 'A short summary of your children\u2019s week, on the day your school chooses.' },
  { key: 'student_class_change', label: 'Class change notifications', description: 'When your child is moved to a different class.' },
  { key: 'staff_report_to_guardian', label: 'Reports from school staff', description: 'Reports staff send to you with the email option enabled.' },
  { key: 'staff_reply_to_guardian', label: 'Replies on your reports', description: 'When school staff reply on a report you filed.' },
  { key: 'report_card_email', label: 'Report card delivery', description: 'Receive your child\u2019s report card by email when sent.' },
  { key: 'broadcast_event_or_announcement', label: 'Events & announcements', description: 'New school events and announcements visible to parents.' },
  { key: 'admission_application_received', label: 'Application received confirmations', description: 'Confirmation when an application is submitted for your child.' },
  { key: 'guardian_additional_student_added', label: 'Additional child added to your portal', description: 'When another child is linked to your existing parent-portal account.' },
  { key: 'activity_reminders', label: 'Activity reminders', description: 'A reminder the day before a class activity your child takes part in.' },
  { key: 'school_forms', label: 'Forms from the school', description: 'When the school asks you to fill in a form, and one reminder before it is due.' },
  { key: 'bus_arrival', label: 'Bus arrival notices', description: 'When your child\u2019s bus arrives at school or at their stop.' },
  { key: 'birthday_greetings', label: 'Birthday greetings', description: 'A birthday message from the school on your child\u2019s birthday.' },
];

// The short name each kind of email goes by in its unsubscribe line ("Don't want weekly
// progress digests?") and on the unsubscribe page.
const EMAIL_NOUNS = {
  weekly_manager_digest: 'weekly leadership reports',
  student_tier_exceeded: 'plan growth notices',
  weekly_teacher_digest: 'weekly teaching digests',
  teacher_reassignment: 'class and subject assignment emails',
  assessment_control_teacher: 'assessment lock and unlock emails',
  assessment_access_update: 'assessment access updates',
  files_assigned_to_class: 'file assignment emails',
  guardian_report_created_staff: 'new parent message emails',
  guardian_report_reply_staff: 'parent reply emails',
  broadcast_event_or_announcement: 'school events and announcements',
  account_hold_or_resume: 'account status emails',
  tasks_and_invitations: 'task and invitation emails',
  scheduled_reports: 'scheduled reports',
  managira_news: 'news from Managira',
  parent_absence_alert: 'attendance alerts',
  weekly_parent_digest: 'weekly briefings',
  alert_rules: 'the alerts you set up',
  weekly_student_digest: 'weekly briefings',
  student_class_change: 'class change emails',
  staff_report_to_guardian: 'messages from school staff',
  staff_reply_to_guardian: 'replies from school staff',
  report_card_email: 'report cards by email',
  admission_application_received: 'application confirmations',
  guardian_additional_student_added: 'parent portal updates',
  activity_reminders: 'activity reminders',
  school_forms: 'form requests and reminders',
  bus_arrival: 'bus arrival notices',
  birthday_greetings: 'birthday greetings',
  weekly_hub_digest: 'weekly hub overviews',
};

// Students have no settings page for email: the unsubscribe link in each email is their choice.
const STUDENT_TOGGLEABLE = [
  { key: 'weekly_student_digest', label: 'Weekly briefing', description: 'A short summary of your week, on the day your school chooses.' },
];

const HUB_TOGGLEABLE = [
  { key: 'weekly_hub_digest', label: 'Weekly hub overview (Saturday)', description: 'Weekly cross-organization summary across all member schools.' },
];

// Organization-wide toggles — decided once for the whole school, not per user.
const ORG_TOGGLEABLE = [
  {
    key: 'guardian_auto_invite_on_student_add',
    label: 'Auto-send parent portal password setup invite',
    description: 'When a new parent/guardian is added while creating a student, automatically email them a link to set their Parent Portal password. If turned off, staff will need to send that invite manually from the guardian’s page.',
  },
];

const ALL_KEYS = new Set([
  ...STAFF_TOGGLEABLE.map(e => e.key),
  ...GUARDIAN_TOGGLEABLE.map(e => e.key),
  ...HUB_TOGGLEABLE.map(e => e.key),
  ...STUDENT_TOGGLEABLE.map(e => e.key),
  ...ORG_TOGGLEABLE.map(e => e.key),
]);

// An optional email's kind, for sendEmailSafely: its key and the name it goes by.
function categoryOf(key) {
  if (!key || !ALL_KEYS.has(key)) return null;
  const entry = [...STAFF_TOGGLEABLE, ...GUARDIAN_TOGGLEABLE, ...HUB_TOGGLEABLE, ...STUDENT_TOGGLEABLE].find((item) => item.key === key);
  return { key, label: EMAIL_NOUNS[key] || (entry ? entry.label : 'these emails') };
}

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

function getOrgPreferences() {
  return ORG_TOGGLEABLE.slice();
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
  await mirrorChoices(db, `SELECT email FROM users WHERE user_id = $1`, userId, allowedKeys, enabledSet);
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
  await mirrorChoices(db, `SELECT email FROM guardian_profiles WHERE guardian_id = $1`, guardianId, allowedKeys, enabledSet);
}

// A settings page's choices, kept by address in email_opt_outs as well, where every send
// checks them in one read (sendEmailSafely).
async function mirrorChoices(db, emailSql, id, allowedKeys, enabledSet) {
  const on = allowedKeys.filter((key) => enabledSet.has(key));
  const off = allowedKeys.filter((key) => !enabledSet.has(key));
  const address = `(SELECT LOWER(TRIM(email)) FROM (${emailSql}) person WHERE NULLIF(TRIM(email), '') IS NOT NULL LIMIT 1)`;
  try {
    if (on.length) {
      await db.query(`DELETE FROM email_opt_outs WHERE email = ${address} AND category = ANY($2::text[])`, [id, on]);
    }
    if (off.length) {
      await db.query(
        `INSERT INTO email_opt_outs (email, category)
         SELECT ${address}, category FROM unnest($2::text[]) AS category WHERE ${address} IS NOT NULL
         ON CONFLICT (email, category) DO NOTHING`,
        [id, off]
      );
    }
  } catch (_) { /* email_opt_outs not made yet */ }
}

// The unsubscribe link (and its "turn back on"): saved on every account with this address,
// so their settings page shows it, and in email_opt_outs, where every send looks.
async function setEmailChoice(db, email, key, enabled) {
  const address = String(email || '').trim().toLowerCase();
  if (!address || !ALL_KEYS.has(key)) return false;
  await ensureEmailPreferencesSchema(db);
  const on = Boolean(enabled);
  await db.query(
    `INSERT INTO user_email_preferences (user_id, preference_key, enabled, updated_at)
     SELECT user_id, $2, $3, CURRENT_TIMESTAMP FROM users WHERE LOWER(email) = $1
     ON CONFLICT (user_id, preference_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
    [address, key, on]
  ).catch(() => ({ rowCount: 0 }));
  await db.query(
    `INSERT INTO guardian_email_preferences (guardian_id, preference_key, enabled, updated_at)
     SELECT guardian_id, $2, $3, CURRENT_TIMESTAMP FROM guardian_profiles WHERE LOWER(email) = $1
     ON CONFLICT (guardian_id, preference_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
    [address, key, on]
  ).catch(() => ({ rowCount: 0 }));
  if (on) {
    await db.query(`DELETE FROM email_opt_outs WHERE email = $1 AND category = $2`, [address, key]);
  } else {
    await db.query(
      `INSERT INTO email_opt_outs (email, category) VALUES ($1, $2) ON CONFLICT (email, category) DO NOTHING`,
      [address, key]
    );
  }
  return true;
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

async function getOrgPreferenceMap(db, organizationId) {
  if (!organizationId) return {};
  await ensureEmailPreferencesSchema(db);
  try {
    const r = await db.query(
      `SELECT preference_key, enabled FROM organization_email_preferences WHERE organization_id = $1`,
      [organizationId]
    );
    const out = {};
    for (const row of r.rows) out[row.preference_key] = !!row.enabled;
    return out;
  } catch (err) {
    if (err && err.code === '42P01') return {};
    throw err;
  }
}

async function setOrgPreferences(db, organizationId, allowedKeys, submittedKeys) {
  if (!organizationId) return;
  await ensureEmailPreferencesSchema(db);
  const allowedSet = new Set(allowedKeys);
  const enabledSet = new Set((submittedKeys || []).filter(k => allowedSet.has(k)));

  for (const key of allowedKeys) {
    const enabled = enabledSet.has(key);
    try {
      await db.query(
        `INSERT INTO organization_email_preferences (organization_id, preference_key, enabled, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (organization_id, preference_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
        [organizationId, key, enabled]
      );
    } catch (err) {
      if (err && err.code === '42P01') return;
      throw err;
    }
  }
}

// Default to ENABLED when no row exists — matches "auto-send by default"
// until a school actively turns it off.
async function isOrgEmailEnabled(db, organizationId, key) {
  if (!organizationId || !key) return true;
  if (!ALL_KEYS.has(key)) return true;
  try {
    await ensureEmailPreferencesSchema(db);
    const r = await db.query(
      `SELECT enabled FROM organization_email_preferences WHERE organization_id = $1 AND preference_key = $2`,
      [organizationId, key]
    );
    if (!r.rows.length) return true;
    return !!r.rows[0].enabled;
  } catch (_) {
    return true; // fail open: do not block emails on schema errors
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

    // An unsubscribe link used by this address (kept here when it had no account).
    try {
      const r = await db.query(
        `SELECT 1 FROM email_opt_outs WHERE email = $1 AND category = $2 LIMIT 1`,
        [norm, key]
      );
      if (r.rows.length) return false;
    } catch (_) { /* email_opt_outs not made yet */ }

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

    try {
      const r = await db.query(
        `SELECT email FROM email_opt_outs WHERE category = $1 AND email = ANY($2)`,
        [key, lowered]
      );
      for (const row of r.rows) disabled.add(row.email);
    } catch (_) { /* email_opt_outs not made yet */ }

    if (!disabled.size) return list;
    return list.filter(e => !disabled.has(String(e).trim().toLowerCase()));
  } catch (_) {
    return list;
  }
}

module.exports = {
  ensureEmailPreferencesSchema,
  EMAIL_NOUNS,
  categoryOf,
  setEmailChoice,
  STAFF_TOGGLEABLE,
  GUARDIAN_TOGGLEABLE,
  HUB_TOGGLEABLE,
  STUDENT_TOGGLEABLE,
  ORG_TOGGLEABLE,
  getStaffPreferencesForRole,
  getGuardianPreferences,
  getHubPreferences,
  getOrgPreferences,
  getUserPreferenceMap,
  getGuardianPreferenceMap,
  getHubPreferenceMap,
  getOrgPreferenceMap,
  setUserPreferences,
  setGuardianPreferences,
  setHubPreferences,
  setOrgPreferences,
  isUserEmailEnabled,
  isGuardianEmailEnabled,
  isHubEmailEnabled,
  isOrgEmailEnabled,
  isEmailEnabledForRecipient,
  filterEmailsByPreference,
};
