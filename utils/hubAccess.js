// Hub people, roles, permissions, contact people and who gets hub emails.
//
// The hub owner is the account on managira_hubs (hub_email / hub_password). The
// owner is always a hub admin. Everyone else who signs in to the hub is a row in
// hub_users with a role (hub_admin or hub_user) and, for hub users, the
// permissions an admin ticked for them — like employee permissions in a school.

const HUB_ROLES = {
  hub_admin: { label: 'Hub admin', description: 'Full access, including users, settings and every school.' },
  hub_user: { label: 'Hub user', description: 'Sees and does only what you allow below.' },
};

const HUB_PERMISSION_GROUPS = [
  {
    group: 'Reports',
    items: [
      { key: 'reports.view', label: 'View reports', description: 'School comparison, attendance, performance, enrollment, marks entry and support reports.' },
      { key: 'reports.export', label: 'Download reports', description: 'Download reports as CSV files.' },
    ],
  },
  {
    group: 'Schools',
    items: [
      { key: 'schools.view', label: 'View schools', description: 'Open each school and see its report.' },
      { key: 'people.view', label: 'View students and staff', description: 'See student, staff and class lists and their details.' },
      { key: 'schools.access', label: 'Open schools', description: 'Go into a school’s own Managira account to see everything, like its owner. Every visit is logged.' },
      { key: 'schools.edit', label: 'Edit school details', description: 'Change a school’s name, address, country and phone.' },
      { key: 'schools.hold', label: 'Put schools on hold', description: 'Pause and resume a school’s access.' },
      { key: 'schools.remove', label: 'Remove or delete schools', description: 'Take a school out of the hub or delete it.' },
    ],
  },
  {
    group: 'Invitations & requests',
    items: [
      { key: 'invitations.manage', label: 'Invite schools', description: 'Send, resend and cancel invitations to join the hub.' },
      { key: 'requests.manage', label: 'Handle leave requests', description: 'Approve or decline schools asking to leave.' },
    ],
  },
  {
    group: 'Hub settings',
    items: [
      { key: 'settings.manage', label: 'Edit hub details', description: 'Change the hub’s address, phone and logo.' },
      { key: 'contacts.manage', label: 'Manage contact people', description: 'Add and edit the people schools can contact.' },
      { key: 'users.manage', label: 'Manage hub users', description: 'Add users, choose their role and what they can see.' },
    ],
  },
  {
    group: 'Billing',
    items: [
      { key: 'billing.view', label: 'See billing', description: 'The plan, charges, bills and payments.' },
      { key: 'billing.manage', label: 'Manage billing', description: 'Approve or decline charges, add paid extras and change the card.' },
    ],
  },
];

const ALL_HUB_PERMISSIONS = HUB_PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
const DEFAULT_HUB_USER_PERMISSIONS = ['reports.view', 'schools.view'];

// Optional hub emails. `permission` = who may receive it (admins always may).
const HUB_NOTIFICATIONS = [
  { key: 'weekly_hub_digest', permission: 'reports.view', label: 'Weekly hub overview', description: 'Every Saturday: a summary across all your schools.' },
  { key: 'hub_school_joined', permission: 'schools.view', label: 'A school joins the hub', description: 'When a school accepts an invitation.' },
  { key: 'hub_invitation_sent', permission: 'invitations.manage', label: 'Invitations sent', description: 'When someone in your hub invites a school.' },
  { key: 'hub_leave_request', permission: 'requests.manage', label: 'A school asks to leave', description: 'When a school sends a request to leave the hub.' },
  { key: 'hub_school_status', permission: 'schools.view', label: 'School status changes', description: 'When a school is put on hold, resumed, removed or leaves.' },
  { key: 'hub_user_changes', permission: 'users.manage', label: 'Hub user changes', description: 'When someone is added, removed or their role changes.' },
  { key: 'hub_billing', permission: 'billing.view', label: 'Billing and payments', description: 'Payment links, receipts, failed payments and charges to approve.' },
];
const HUB_NOTIFICATION_KEYS = HUB_NOTIFICATIONS.map((n) => n.key);

let schemaReady = null;
function ensureHubAccessSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_users (
          hub_user_id SERIAL PRIMARY KEY,
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          email VARCHAR(255) NOT NULL,
          phone VARCHAR(40),
          job_title VARCHAR(120),
          password VARCHAR(255),
          role VARCHAR(20) NOT NULL DEFAULT 'hub_user',
          permissions TEXT[] NOT NULL DEFAULT '{}',
          on_hold BOOLEAN NOT NULL DEFAULT FALSE,
          reset_password_token VARCHAR(128),
          reset_password_expires TIMESTAMP,
          last_login_at TIMESTAMPTZ,
          created_by VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT hub_users_role_check CHECK (role IN ('hub_admin', 'hub_user'))
        )`);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS hub_users_email_unique ON hub_users (LOWER(email))`);
      await db.query(`CREATE INDEX IF NOT EXISTS hub_users_hub_idx ON hub_users (hub_id)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_contacts (
          contact_id SERIAL PRIMARY KEY,
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          full_name VARCHAR(150) NOT NULL,
          job_title VARCHAR(120),
          email VARCHAR(255),
          phone VARCHAR(40),
          is_primary BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.query(`CREATE INDEX IF NOT EXISTS hub_contacts_hub_idx ON hub_contacts (hub_id)`);
      await db.query(`ALTER TABLE hub_contacts ADD COLUMN IF NOT EXISTS share_with_schools BOOLEAN NOT NULL DEFAULT TRUE`);
      // A hub user can also be listed as a contact person (kept in step with their profile).
      await db.query(`ALTER TABLE hub_contacts ADD COLUMN IF NOT EXISTS hub_user_id INTEGER REFERENCES hub_users(hub_user_id) ON DELETE CASCADE`);
      // Each school can have one hub contact person assigned (optional).
      await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hub_contact_id INTEGER`);
      await db.query(`ALTER TABLE hub_organization_invitations ADD COLUMN IF NOT EXISTS hub_contact_id INTEGER`);
      await require('./licenses').ensureLicenseSchema(db);
      await require('./hubPlans').ensureHubPlanSchema(db);
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_user_email_preferences (
          hub_user_id INTEGER NOT NULL REFERENCES hub_users(hub_user_id) ON DELETE CASCADE,
          preference_key VARCHAR(100) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (hub_user_id, preference_key)
        )`);
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function normalizePermissions(list) {
  const wanted = new Set((Array.isArray(list) ? list : [list]).filter(Boolean).map(String));
  return ALL_HUB_PERMISSIONS.filter((key) => wanted.has(key));
}

function permissionsForRole(role, list) {
  return role === 'hub_admin' || role === 'owner' ? ALL_HUB_PERMISSIONS.slice() : normalizePermissions(list);
}

// Who is signed in to the hub right now: the owner (no hubUserId, which is also
// how a Managira admin opening the hub is treated) or a hub user.
async function loadHubActor(db, session) {
  if (!session || !session.hubId) return null;
  if (!session.hubUserId) {
    return { kind: 'owner', role: 'hub_admin', isOwner: true, hubUserId: null, permissions: ALL_HUB_PERMISSIONS.slice() };
  }
  await ensureHubAccessSchema(db);
  const { rows } = await db.query(
    `SELECT hub_user_id, hub_id, first_name, last_name, email, phone, job_title, role, permissions, on_hold
       FROM hub_users WHERE hub_user_id = $1 AND hub_id = $2`,
    [session.hubUserId, session.hubId]
  );
  const user = rows[0];
  if (!user || user.on_hold) return null;
  return {
    kind: 'user',
    role: user.role,
    isOwner: false,
    hubUserId: user.hub_user_id,
    user,
    permissions: permissionsForRole(user.role, user.permissions),
  };
}

function actorCan(actor, permission) {
  if (!actor) return false;
  if (actor.role === 'hub_admin') return true;
  return actor.permissions.includes(permission);
}

function notificationsFor(actor) {
  return HUB_NOTIFICATIONS.filter((n) => actorCan(actor, n.permission));
}

// sharedOnly: just the contacts the hub chose to show its schools.
async function getContacts(db, hubId, { sharedOnly = false } = {}) {
  await ensureHubAccessSchema(db);
  const { rows } = await db.query(
    `SELECT contact_id, full_name, job_title, email, phone, is_primary, share_with_schools, hub_user_id
       FROM hub_contacts WHERE hub_id = $1 ${sharedOnly ? 'AND share_with_schools = TRUE' : ''}
      ORDER BY is_primary DESC, sort_order ASC, contact_id ASC`,
    [hubId]
  );
  return rows;
}

// Everyone who should get an optional hub email: the owner (hub-level
// preference) and active hub users allowed to see it who have not switched it off.
async function getHubRecipients(db, hubId, key, { excludeEmail } = {}) {
  const note = HUB_NOTIFICATIONS.find((n) => n.key === key);
  if (!note) return [];
  await ensureHubAccessSchema(db);
  const out = new Map();

  const owner = (await db.query(
    `SELECT h.hub_email, h.first_name,
            COALESCE((SELECT enabled FROM hub_email_preferences p WHERE p.hub_id = h.hub_id AND p.preference_key = $2), TRUE) AS enabled
       FROM managira_hubs h
      WHERE h.hub_id = $1 AND COALESCE(h.deleted, FALSE) = FALSE`,
    [hubId, key]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (owner && owner.enabled && owner.hub_email) out.set(owner.hub_email.toLowerCase(), { email: owner.hub_email, firstName: owner.first_name });

  const users = (await db.query(
    `SELECT u.email, u.first_name, u.role, u.permissions,
            COALESCE(p.enabled, TRUE) AS enabled
       FROM hub_users u
       LEFT JOIN hub_user_email_preferences p ON p.hub_user_id = u.hub_user_id AND p.preference_key = $2
      WHERE u.hub_id = $1 AND u.on_hold = FALSE AND u.password IS NOT NULL`,
    [hubId, key]
  )).rows;
  users.forEach((u) => {
    if (!u.enabled || !u.email) return;
    if (u.role !== 'hub_admin' && !(u.permissions || []).includes(note.permission)) return;
    out.set(u.email.toLowerCase(), { email: u.email, firstName: u.first_name });
  });

  if (excludeEmail) out.delete(String(excludeEmail).toLowerCase());
  return Array.from(out.values());
}

// Send an optional hub email to everyone who should get it. `build(recipient)`
// returns { subject, html } so each person can be greeted by name.
async function notifyHub(db, hubId, key, build, options = {}) {
  try {
    const recipients = await getHubRecipients(db, hubId, key, options);
    if (!recipients.length) return 0;
    const { sendEmailInBackground } = require('./emailHelper');
    recipients.forEach((recipient) => {
      const { subject, html, ...extra } = build(recipient);
      sendEmailInBackground({ from: process.env.NOTIFY_EMAIL_USER, ...extra, to: recipient.email, subject, html }, `Hub notice: ${key}`);
    });
    return recipients.length;
  } catch (err) {
    console.error('[notifyHub]', key, err && err.message);
    return 0;
  }
}

module.exports = {
  HUB_ROLES,
  HUB_PERMISSION_GROUPS,
  ALL_HUB_PERMISSIONS,
  DEFAULT_HUB_USER_PERMISSIONS,
  HUB_NOTIFICATIONS,
  HUB_NOTIFICATION_KEYS,
  ensureHubAccessSchema,
  normalizePermissions,
  permissionsForRole,
  loadHubActor,
  actorCan,
  notificationsFor,
  getContacts,
  getHubRecipients,
  notifyHub,
};
