const db = require('../config/db');
const {
  getUserPermissions,
  isManagerLikeRole,
  effectivePermissionsForRole,
  isOrganizationOwnerEmail,
  withinPlan,
  PERMISSION_OPTIONS,
} = require('./permissionMiddleware');
const { workspaceAccess } = require('../utils/workspaceAccess');

/**
 * Global middleware: sets res.locals.userPermissions to an array of permission
 * keys explicitly granted to the current user in the DB.
 *
 * - Platform admins (Admin, Mini Admin, Internal Worker) and org Managers get
 *   the full permission list so every gated UI element is visible to them.
 * - Regular employees (Teacher, Supervisor, etc.) get what the server enforces:
 *   their saved permissions, or their role's defaults if never saved.
 * - Unauthenticated / no-org requests get an empty array.
 *
 * This mirrors the pattern used by setAllowedFeatures.
 */
const ALL_PERMISSION_KEYS = PERMISSION_OPTIONS.map((o) => o.key);

const setAllowedPermissions = async (req, res, next) => {
  res.locals.userPermissions = [];
  // What the plan doesn't include is never in this list, for anyone.
  const grant = (keys) => {
    res.locals.userPermissions = res.locals.planFeaturesKnown
      ? keys.filter((key) => withinPlan(key, res.locals.allowedFeatures))
      : keys;
  };
  // Called from views and controllers so it reads the final permissions and features.
  res.locals.workspaceAccess = () => workspaceAccess({
    permissions: res.locals.userPermissions,
    features: res.locals.allowedFeatures,
    role: req.session?.userRole || req.session?.user?.account_type || req.session?.accountType,
  });

  try {
    const organizationId = req.session?.organizationId || null;
    const userRole = req.session?.userRole || req.session?.user?.account_type || null;
    const accountType = req.session?.accountType || req.session?.user?.account_type || null;

    if (!organizationId) {
      return next();
    }

    // Platform admins (org-switch) and manager-like roles get all permissions.
    if (isManagerLikeRole(userRole) || isManagerLikeRole(accountType)) {
      grant(ALL_PERMISSION_KEYS);
      return next();
    }

    // Org owner (Manager role + Organization accountType) always gets everything.
    if (
      String(userRole || '').trim().toLowerCase() === 'manager' &&
      String(accountType || '').trim().toLowerCase() === 'organization'
    ) {
      grant(ALL_PERMISSION_KEYS);
      return next();
    }

    const userId = req.session?.user?.user_id || req.session?.userId || null;
    if (!userId) {
      return next();
    }

    // The school's signup email is its owner, whatever role the record holds.
    const userEmail = req.session?.user?.email || null;
    if (userEmail && await isOrganizationOwnerEmail(db, organizationId, userEmail)) {
      grant(ALL_PERMISSION_KEYS);
      return next();
    }

    const permissions = await getUserPermissions(db, userId, organizationId);
    grant(effectivePermissionsForRole(userRole, Array.isArray(permissions) ? permissions : []));
  } catch (err) {
    // Non-fatal — templates fall back to empty array.
  }

  next();
};

module.exports = setAllowedPermissions;
