// Only a manager can change a manager, and only a manager can change their own
// account through the staff pages. Everyone else who holds the staff permissions,
// a lead driver included, works on staff whose role is at or below their own, and
// gives only what they could give: a role at or below theirs and permissions they
// hold themselves (the same rule as the school's own roles, utils/schoolRoles.js keep).
const { isManagerLikeRole, getPrimaryManagerUserId } = require("../middleware/permissionMiddleware");
const { ensureRemovedUsersSchema } = require("./removedUsers");

const isManager = (role) => isManagerLikeRole(role) || String(role || "").trim() === "Manager";

// The built-in roles, most access first. A lead driver manages drivers; a teacher, teachers and
// drivers; a supervisor, supervisors, teachers and drivers. A role not listed outranks everyone.
const RANK = { Manager: 3, Supervisor: 2, Teacher: 1, Driver: 0 };
const rankOf = (role) => {
  const name = String(role || "").trim();
  return Object.prototype.hasOwnProperty.call(RANK, name) ? RANK[name] : Infinity;
};
const roleOfSession = (req) => {
  const session = (req && req.session) || {};
  return session.userRole || session.user?.account_type || session.accountType;
};
// The roles a school's staff can have. Managira's own roles (Admin, Mini Admin, Internal Worker)
// share the database column, so a school account must never be given one: they open Managira's
// admin pages for every school.
const SCHOOL_ROLES = Object.freeze(Object.keys(RANK));
const isSchoolRole = (role) => Object.prototype.hasOwnProperty.call(RANK, String(role || "").trim());

// Whether the signed-in person may give someone this role: always one of the school's roles, and
// for anyone but a manager, at or below their own.
function canGiveRole(req, role) {
  if (!isSchoolRole(role)) return false;
  const own = roleOfSession(req);
  if (isManager(own)) return true;
  return rankOf(role) <= rankOf(own);
}

// What the signed-in person may hand out on the staff form: { manager, role(type), holds(key) }.
// A manager gives anything (high-risk permissions included); anyone else, only the permissions
// they hold themselves.
async function grantLimits(db, req) {
  const session = (req && req.session) || {};
  const own = roleOfSession(req);
  if (isManager(own)) return { manager: true, role: (type) => canGiveRole(req, type), holds: () => true };
  const perms = require("../middleware/permissionMiddleware");
  const userId = session.userId || session.user?.user_id;
  const saved = userId ? await perms.getUserPermissions(db, userId, session.organizationId).catch(() => []) : [];
  const held = new Set(perms.effectivePermissionsForRole(own, saved));
  return { manager: false, role: (type) => canGiveRole(req, type), holds: (key) => held.has(key) };
}

async function staffChangeRefusal(db, req, targetUserId) {
  const session = req.session || {};
  const role = session.userRole || session.user?.account_type || session.accountType;
  if (isManager(role)) return null;

  const requesterId = session.userId || session.user?.user_id;
  if (String(requesterId) === String(targetUserId)) return "You can't change your own account here. Ask a manager.";

  try {
    await ensureRemovedUsersSchema(db);
    const organizationId = session.organizationId;
    const [target, primaryId] = await Promise.all([
      db.query(
        "SELECT account_type FROM users WHERE user_id = $1 AND (organization_id = $2 OR removed_from_organization_id = $2)",
        [targetUserId, organizationId]
      ),
      getPrimaryManagerUserId(db, organizationId),
    ]);
    const isPrimary = primaryId !== null && String(primaryId) === String(targetUserId);
    if (isPrimary || isManager(target.rows[0]?.account_type)) return "Only a manager can change a manager.";
    // Above their own role (a lead driver and a teacher, a teacher and a supervisor): a manager's.
    if (target.rows[0] && !canGiveRole(req, target.rows[0].account_type)) return "You can only change staff whose role is at or below your own. Ask a manager.";
    return null;
  } catch (error) {
    console.error("[staffChangeRefusal]", error.message);
    return "That couldn't be checked. Please try again.";
  }
}

// The school's signup email belongs to its owner. Someone else moving onto it could pick up
// their password resets and their single sign-on, so it can't be taken by editing a profile.
async function takesOwnersEmail(db, organizationId, userId, email) {
  const { rows } = await db.query(
    `SELECT 1 FROM organizations o
      WHERE o.organization_id = $1 AND LOWER(o.email) = LOWER($2)
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = $3 AND u.organization_id = o.organization_id AND LOWER(u.email) = LOWER($2))`,
    [organizationId, String(email || ""), userId]
  );
  return rows.length > 0;
}

module.exports = { staffChangeRefusal, takesOwnersEmail, canGiveRole, grantLimits, rankOf, isSchoolRole, SCHOOL_ROLES };
