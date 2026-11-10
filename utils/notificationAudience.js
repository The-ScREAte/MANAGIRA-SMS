'use strict';
// A school-wide notification ("broadcast") is one row for the whole school; each
// member of staff sees it only when it concerns them:
// - events and announcements: every member of staff except drivers, whose app
//   doesn't open the school's pages;
// - a failed email: the people who can act on it, by the permission behind it
//   (a failed fee-recovery email goes to PayGira recovery, a failed invite to
//   Manage Employees); managers and supervisors, who run Email Issues, also see
//   the ones not listed here;
// - anything else: managers only.
// Notices sent to one person are theirs, except class work they can't act on, which is hidden
// (`hide`): a driver never sees a class's assessments, new students or documents, and nobody
// sees assessment notices without Manage Assessments.
const { BoundedMap } = require('./boundedMap');

const SCHOOL_TYPES = ['event_created', 'announcement_created'];
const EMAIL_FAILED = 'email_delivery_failed';
const KNOWN_TYPES = [...SCHOOL_TYPES, EMAIL_FAILED];
const MANAGER_ROLES = new Set(['organization', 'admin', 'mini admin', 'manager']);
const EMAIL_ISSUES_ROLES = new Set([...MANAGER_ROLES, 'supervisor', 'superviser']);

// Failed-email titles (set where each email is sent) and the permissions, any one
// of which shows it.
function emailFailureRules(P) {
  return {
    'Report email delivery failed': [P.REPORTS_TERMINAL, P.MANAGE_REPORTS],
    'Staff report email failed': [P.MANAGE_STUDENTS],
    'Payment notification email failed': [P.PAYGIRA_PAYMENTS, P.PAYGIRA_CLASSROOM],
    'Fee recovery email failed': [P.PAYGIRA_RECOVERY],
    'Registration payment confirmation email failed': [P.APPROVE_ADMISSIONS, P.PAYGIRA_PAYMENTS],
    'Assessment access email failed': [P.MANAGE_ASSESSMENTS],
    'Assessment update email failed': [P.MANAGE_ASSESSMENTS],
    'Admission approval email failed': [P.APPROVE_ADMISSIONS],
    'Admission rejection email failed': [P.APPROVE_ADMISSIONS],
    'Admission confirmation email failed': [P.APPROVE_ADMISSIONS],
    'Guardian password email failed': [P.MANAGE_GUARDIANS],
    'Guardian welcome email failed': [P.MANAGE_GUARDIANS],
    'Guardian student-added email failed': [P.MANAGE_GUARDIANS],
    'Guardian reply email failed': [P.MAILROOM, P.MANAGE_GUARDIANS],
    'Student password email failed': [P.MANAGE_STUDENTS],
    'Class change email failed': [P.MANAGE_STUDENTS],
    'Teacher reassignment email failed': [P.MANAGE_EMPLOYEES, P.MANAGE_CLASSES_SUBJECTS],
    'Account status email failed': [P.MANAGE_EMPLOYEES],
    'Employee invite email failed': [P.MANAGE_EMPLOYEES],
    'Password set success email failed': [P.MANAGE_EMPLOYEES],
  };
}

const ASSESSMENT_TYPES = ['assessment_created', 'assessment_modified', 'assessment_locked', 'assessment_unlocked'];
const CLASS_WORK_TYPES = [...ASSESSMENT_TYPES, 'enrollment_added', 'document_shared_class'];
const NOTHING = Object.freeze({ school: false, managers: false, generic: false, titles: [], hide: [] });
const DRIVER = Object.freeze({ ...NOTHING, hide: CLASS_WORK_TYPES });
const EVERYTHING_TITLES = () => Object.keys(emailFailureRules(require('../middleware/permissionMiddleware').PERMISSIONS));

// One answer per person for a minute: the bell asks on every page.
const cache = new BoundedMap(5000);
const CACHE_MS = 60 * 1000;

async function lookUpStaff(db, { recipientId, orgId }) {
  const r = await db.query(
    `SELECT account_type::text AS role, email FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
    [recipientId, orgId]
  );
  const row = r.rows[0];
  return row ? { userId: recipientId, userRole: row.role, accountType: row.role, organizationId: orgId, userEmail: row.email || null } : null;
}

// What this member of staff sees of the school-wide notifications.
async function broadcastAudience(db, context) {
  const recipientId = Number(context.recipientId || 0);
  const orgId = Number(context.orgId || 0);
  if (!orgId) return NOTHING;
  // The school's own account (signed in from the organization record) sees everything.
  if (recipientId === 0) return { school: true, managers: true, generic: true, titles: EVERYTHING_TITLES(), hide: [] };

  const key = `${orgId}:${recipientId}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.audience;

  const { PERMISSIONS, userHasPermission } = require('../middleware/permissionMiddleware');
  const given = context.who && context.who.userId ? { ...context.who, organizationId: orgId } : null;
  const who = given || await lookUpStaff(db, { recipientId, orgId });
  if (!who) return NOTHING;
  const role = String(who.userRole || who.accountType || '').trim().toLowerCase();
  if (role === 'driver') return DRIVER;
  if (role === 'guardian' || role === 'student') return NOTHING;

  const rules = emailFailureRules(PERMISSIONS);
  const keys = [...new Set([...Object.values(rules).flat(), PERMISSIONS.MANAGE_ASSESSMENTS])];
  const held = new Set();
  await Promise.all(keys.map(async (permission) => {
    if (await userHasPermission(db, who, permission)) held.add(permission);
  }));
  const audience = {
    school: true,
    managers: MANAGER_ROLES.has(role),
    generic: EMAIL_ISSUES_ROLES.has(role),
    titles: Object.keys(rules).filter((title) => rules[title].some((permission) => held.has(permission))),
    hide: held.has(PERMISSIONS.MANAGE_ASSESSMENTS) ? [] : ASSESSMENT_TYPES,
  };
  cache.set(key, { audience, until: Date.now() + CACHE_MS });
  return audience;
}

// The SQL for "a broadcast this person sees", for notifications aliased `n`.
// Its values go after the query's own, starting at $<from>.
function broadcastCondition(audience, from) {
  const at = (offset) => `$${from + offset}`;
  return {
    sql: `(n.recipient_type = 'broadcast' AND (
             (n.type = ANY(${at(0)}::text[]) AND ${at(1)}::boolean)
             OR (n.type = '${EMAIL_FAILED}' AND (n.title = ANY(${at(2)}::text[]) OR (${at(3)}::boolean AND NOT (n.title = ANY(${at(4)}::text[])))))
             OR (NOT (n.type = ANY(${at(5)}::text[])) AND ${at(6)}::boolean)
           ))`,
    params: [SCHOOL_TYPES, audience.school, audience.titles, audience.generic, EVERYTHING_TITLES(), KNOWN_TYPES, audience.managers],
  };
}

// Who is signed in, as the permission checks read it (the same fields as requirePermission).
function staffWho(session = {}) {
  return {
    userId: session.user?.user_id || session.userId || null,
    userRole: session.userRole || session.user?.account_type || null,
    accountType: session.accountType || session.user?.account_type || null,
    userEmail: session.user?.email || null,
  };
}

function forgetAudience(orgId, recipientId) {
  cache.delete(`${Number(orgId)}:${Number(recipientId)}`);
}

module.exports = { broadcastAudience, broadcastCondition, forgetAudience, staffWho, emailFailureRules, ASSESSMENT_TYPES, CLASS_WORK_TYPES };
