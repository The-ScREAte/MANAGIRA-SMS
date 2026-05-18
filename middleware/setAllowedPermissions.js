const db = require('../config/db');
const { getUserPermissions, isManagerLikeRole, PERMISSION_OPTIONS } = require('./permissionMiddleware');

/**
 * Global middleware: sets res.locals.userPermissions to an array of permission
 * keys explicitly granted to the current user in the DB.
 *
 * - Platform admins (Admin, Mini Admin, Internal Worker) and org Managers get
 *   the full permission list so every gated UI element is visible to them.
 * - Regular employees (Teacher, Supervisor, etc.) only get what is stored in
 *   user_permissions for their userId + organizationId.
 * - Unauthenticated / no-org requests get an empty array.
 *
 * This mirrors the pattern used by setAllowedFeatures.
 */
const ALL_PERMISSION_KEYS = PERMISSION_OPTIONS.map((o) => o.key);

const setAllowedPermissions = async (req, res, next) => {
  res.locals.userPermissions = [];

  try {
    const organizationId = req.session?.organizationId || null;
    const userRole = req.session?.userRole || req.session?.user?.account_type || null;
    const accountType = req.session?.accountType || req.session?.user?.account_type || null;

    if (!organizationId) {
      return next();
    }

    // Platform admins (org-switch) and manager-like roles get all permissions.
    if (isManagerLikeRole(userRole) || isManagerLikeRole(accountType)) {
      res.locals.userPermissions = ALL_PERMISSION_KEYS;
      return next();
    }

    // Org owner (Manager role + Organization accountType) always gets everything.
    if (
      String(userRole || '').trim().toLowerCase() === 'manager' &&
      String(accountType || '').trim().toLowerCase() === 'organization'
    ) {
      res.locals.userPermissions = ALL_PERMISSION_KEYS;
      return next();
    }

    const userId = req.session?.user?.user_id || req.session?.userId || null;
    if (!userId) {
      return next();
    }

    const permissions = await getUserPermissions(db, userId, organizationId);
    res.locals.userPermissions = Array.isArray(permissions) ? permissions : [];
  } catch (err) {
    // Non-fatal — templates fall back to empty array.
  }

  next();
};

module.exports = setAllowedPermissions;
