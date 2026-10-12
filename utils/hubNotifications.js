// The notification bell for people signed in to a hub. Items come from the
// hub's activity log (what other people in the hub and its schools did), kept
// to what each person is allowed to see. Read / dismissed state is per person.
const { ensureHubAccessSchema, actorCan } = require('./hubAccess');

// action_type -> who may see it, the bell icon type, a title and where it links.
const EVENTS = {
  invitation_accepted: { perm: 'schools.view', type: 'admission_approved', title: 'A school joined your hub', link: '/hub/dashboard#schools' },
  organization_joined: { perm: 'schools.view', type: 'admission_approved', title: 'A school joined your hub', link: '/hub/dashboard#schools' },
  detachment_requested: { perm: 'requests.manage', type: 'admission_pending', title: 'A school asked to leave', link: '/hub/dashboard#requests' },
  detachment_approved: { perm: 'schools.view', type: 'employee_on_hold', title: 'A school left your hub', link: '/hub/dashboard#schools' },
  detachment_rejected: { perm: 'requests.manage', type: 'admission_rejected', title: 'Leave request declined', link: '/hub/dashboard#requests' },
  organization_held: { perm: 'schools.view', type: 'employee_on_hold', title: 'School put on hold', link: '/hub/dashboard#schools' },
  organization_resumed: { perm: 'schools.view', type: 'employee_resumed', title: 'School resumed', link: '/hub/dashboard#schools' },
  organization_removed: { perm: 'schools.view', type: 'employee_on_hold', title: 'School removed from the hub', link: '/hub/dashboard#schools' },
  organization_deleted: { perm: 'schools.view', type: 'document_deleted', title: 'School deleted', link: '/hub/dashboard#schools' },
  organization_invited: { perm: 'invitations.manage', type: 'event_created', title: 'School invited', link: '/hub/dashboard#invitations' },
  invitation_sent: { perm: 'invitations.manage', type: 'event_created', title: 'School invited', link: '/hub/dashboard#invitations' },
  invitation_resent: { perm: 'invitations.manage', type: 'event_created', title: 'Invitation sent again', link: '/hub/dashboard#invitations' },
  invitation_cancelled: { perm: 'invitations.manage', type: 'admission_rejected', title: 'Invitation cancelled', link: '/hub/dashboard#invitations' },
  organization_updated: { perm: 'schools.view', type: 'class_reassigned', title: 'School details changed', link: '/hub/dashboard#schools' },
  USER_ADDED: { perm: 'users.manage', type: 'task_assigned', title: 'Hub user added', link: '/hub/users' },
  USER_REMOVED: { perm: 'users.manage', type: 'employee_on_hold', title: 'Hub user removed', link: '/hub/users' },
  USER_HELD: { perm: 'users.manage', type: 'employee_on_hold', title: 'Hub user put on hold', link: '/hub/users' },
  USER_RESUMED: { perm: 'users.manage', type: 'employee_resumed', title: 'Hub user resumed', link: '/hub/users' },
  USER_UPDATE: { perm: 'users.manage', type: 'class_reassigned', title: 'Hub user access changed', link: '/hub/users' },
  CONTACT_UPDATE: { perm: 'contacts.manage', type: 'class_reassigned', title: 'Contact people updated', link: '/hub/settings#contacts' },
  SCHOOL_OPENED: { perm: 'schools.view', type: 'class_reassigned', title: 'School opened from the hub', link: '/hub/dashboard#schools' },
  LOGO_UPDATE: { perm: 'settings.manage', type: 'class_reassigned', title: 'Hub logo changed', link: '/hub/settings' },
  BILLING_CHARGE_REQUESTED: { perm: 'billing.view', type: 'admission_pending', title: 'A charge needs your approval', link: '/hub/billing' },
  BILLING_CHARGE_APPROVED: { perm: 'billing.view', type: 'admission_approved', title: 'Charge approved', link: '/hub/billing' },
  BILLING_CHARGE_DECLINED: { perm: 'billing.view', type: 'admission_rejected', title: 'Charge declined', link: '/hub/billing' },
  BILLING_CHARGE_REMOVED: { perm: 'billing.view', type: 'class_reassigned', title: 'Charge removed', link: '/hub/billing' },
  BILLING_ADDON_ADDED: { perm: 'billing.view', type: 'task_assigned', title: 'Add-on added to your bill', link: '/hub/billing' },
  BILLING_EXTRA_ADDED: { perm: 'billing.view', type: 'task_assigned', title: 'Extra place added to your bill', link: '/hub/billing' },
  BILLING_PAID: { perm: 'billing.view', type: 'admission_approved', title: 'Payment received', link: '/hub/billing' },
  BILLING_FAILED: { perm: 'billing.view', type: 'admission_rejected', title: 'A payment failed', link: '/hub/billing' },
  BILLING_CARD_SAVED: { perm: 'billing.view', type: 'class_reassigned', title: 'Billing card saved', link: '/hub/billing' },
  BILLING_UPDATED: { perm: 'billing.view', type: 'class_reassigned', title: 'Your plan was updated', link: '/hub/billing' },
  BILLING_HOLD: { perm: 'billing.view', type: 'employee_on_hold', title: 'Hub put on hold', link: '/hub/billing' },
  BILLING_RESUMED: { perm: 'billing.view', type: 'employee_resumed', title: 'Hub resumed', link: '/hub/billing' },
};

let ready = null;
function ensureSchema(db) {
  if (!ready) {
    ready = (async () => {
      await ensureHubAccessSchema(db);
      await db.query(`
        CREATE TABLE IF NOT EXISTS hub_notification_marks (
          hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
          person_key VARCHAR(40) NOT NULL,
          notif_id VARCHAR(60) NOT NULL,
          dismissed BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (hub_id, person_key, notif_id)
        )`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const personKey = (actor) => (actor.isOwner ? 'owner' : `user:${actor.hubUserId}`);

async function buildFeed(db, hubId, actor) {
  await ensureSchema(db);
  const hub = (await db.query('SELECT hub_name, hub_email, first_name, last_name FROM managira_hubs WHERE hub_id = $1', [hubId])).rows[0] || {};
  // Leave out what this person did themselves.
  const mine = new Set((actor.isOwner
    ? [hub.hub_name, hub.hub_email, `${hub.first_name || ''} ${hub.last_name || ''}`.trim()]
    : [actor.user.email, `${actor.user.first_name} ${actor.user.last_name}`.trim()]
  ).filter(Boolean).map((v) => String(v).toLowerCase()));

  const types = Object.keys(EVENTS).filter((t) => actorCan(actor, EVENTS[t].perm));
  if (!types.length) return [];
  const [logs, marks] = await Promise.all([
    db.query(
      `SELECT log_id, action_type, description, performed_by, created_at
         FROM hub_activity_logs
        WHERE hub_id = $1 AND action_type = ANY($2::text[]) AND created_at > NOW() - INTERVAL '60 days'
        ORDER BY created_at DESC LIMIT 60`,
      [hubId, types]
    ),
    db.query('SELECT notif_id, dismissed FROM hub_notification_marks WHERE hub_id = $1 AND person_key = $2', [hubId, personKey(actor)]),
  ]);
  const markMap = new Map(marks.rows.map((m) => [m.notif_id, m]));
  return logs.rows
    .filter((row) => !mine.has(String(row.performed_by || '').toLowerCase()))
    .map((row) => {
      const ev = EVENTS[row.action_type];
      const id = `hub:${row.log_id}`;
      const mark = markMap.get(id);
      return {
        id,
        type: ev.type,
        title: ev.title,
        body: [row.description, row.performed_by ? `by ${row.performed_by}` : ''].filter(Boolean).join(' · '),
        link: ev.link,
        created_at: row.created_at,
        is_read: !!mark,
        dismissed: !!(mark && mark.dismissed),
      };
    })
    .filter((item) => !item.dismissed)
    .slice(0, 30);
}

async function mark(db, hubId, actor, ids, dismissed) {
  await ensureSchema(db);
  for (const id of ids) {
    if (!/^hub:\d+$/.test(String(id))) continue;
    await db.query(
      `INSERT INTO hub_notification_marks (hub_id, person_key, notif_id, dismissed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (hub_id, person_key, notif_id) DO UPDATE SET dismissed = hub_notification_marks.dismissed OR EXCLUDED.dismissed`,
      [hubId, personKey(actor), String(id), !!dismissed]
    );
  }
}

module.exports = { buildFeed, mark };
