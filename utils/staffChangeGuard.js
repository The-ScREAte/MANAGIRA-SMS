// Only a manager can change a manager, and only a manager can change their own
// account through the staff pages. Everyone else who holds the staff permissions,
// a lead driver included, works on the rest of the staff.
const { isManagerLikeRole, getPrimaryManagerUserId } = require("../middleware/permissionMiddleware");
const { ensureRemovedUsersSchema } = require("./removedUsers");

const isManager = (role) => isManagerLikeRole(role) || String(role || "").trim() === "Manager";

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
    return isPrimary || isManager(target.rows[0]?.account_type) ? "Only a manager can change a manager." : null;
  } catch (error) {
    console.error("[staffChangeRefusal]", error.message);
    return "That couldn't be checked. Please try again.";
  }
}

module.exports = { staffChangeRefusal };
