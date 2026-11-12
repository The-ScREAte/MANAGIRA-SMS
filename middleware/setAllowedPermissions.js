const crypto = require('crypto');
const db = require('../config/db');
const {
  getUserPermissions,
  isManagerLikeRole,
  effectivePermissionsForRole,
  isOrganizationOwnerEmail,
  withinPlan,
  integrationOf,
  PERMISSION_OPTIONS,
  isPortalRole,
  isManagerRole,
} = require('./permissionMiddleware');
const { workspaceAccess } = require('../utils/workspaceAccess');
const features = require("../utils/shards/features");
const integrationSwitches = require("../utils/integrationSwitches");

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
  res.locals.integrationSwitches = {};
  // What the plan doesn't include is never in this list, for anyone; nor is anything of an
  // integration the school has switched off (a driver, there for transportation alone, then
  // holds nothing). Menus and pages read this list, so they show a school as it is.
  const grant = async (keys) => {
    const inPlan = res.locals.planFeaturesKnown
      ? keys.filter((key) => withinPlan(key, res.locals.allowedFeatures, req.session?.organizationId))
      : keys;
    const switches = await integrationSwitches.switchesFor(db, req.session?.organizationId);
    res.locals.integrationSwitches = switches || {};
    const isDriver = String(req.session?.userRole || req.session?.user?.account_type || "").trim().toLowerCase() === "driver";
    const off = (integration) => Boolean(integration && switches && switches[integration] === false);
    res.locals.userPermissions = isDriver && off("transportation") ? [] : inPlan.filter((key) => !off(integrationOf(key)));
    // A short fingerprint of this person's access. When it changes, the browser
    // drops its saved copies of pages (public/service-worker.js).
    // Custom editor items join it once they can show, so a page saved before then is not kept.
    const stamp = crypto.createHash('md5')
      .update(JSON.stringify([req.session?.user?.user_id || req.session?.userId, res.locals.userPermissions, res.locals.allowedFeatures]
        .concat(res.locals.customFormsReady() && features.isOn('custom_forms', { organizationId: req.session?.organizationId }) ? ['custom_forms'] : [])))
      .digest('base64url')
      .slice(0, 12);
    res.locals.accessStamp = stamp;
    res.setHeader('X-Managira-Access', stamp);
  };
  // Called from views and controllers so it reads the final permissions and features.
  res.locals.featureOn = (key) => features.isOn(key, { organizationId: req.session?.organizationId });
  // Custom forms also need their tables (database/migrations, 2026-11-22 to 2026-11-24): until
  // they exist no menu or tile offers a form page.
  res.locals.customFormsReady = () => require('../utils/customForms').readySync();
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
    // Known before the page is drawn, so Forms is in the menu from the very first page after a
    // restart (one small check per process, then remembered; it never throws).
    if (features.isOn('custom_forms', { organizationId })) await require('../utils/customForms').ready(db);

    // Platform admins (org-switch) and manager-like roles get all permissions.
    if (isManagerLikeRole(userRole) || isManagerLikeRole(accountType)) {
      await grant(ALL_PERMISSION_KEYS);
      return next();
    }

    // Org owner (Manager role + Organization accountType) always gets everything.
    if (
      String(userRole || '').trim().toLowerCase() === 'manager' &&
      String(accountType || '').trim().toLowerCase() === 'organization'
    ) {
      await grant(ALL_PERMISSION_KEYS);
      return next();
    }

    const userId = req.session?.user?.user_id || req.session?.userId || null;
    // A parent or student holds no staff permission: their ids come from other tables. Their
    // pages still need to know which integrations the school has on (the bus, for one).
    if (!userId || isPortalRole(userRole)) {
      res.locals.integrationSwitches = (await integrationSwitches.switchesFor(db, organizationId)) || {};
      return next();
    }

    // The manager with the school's signup email is its owner.
    const userEmail = req.session?.user?.email || null;
    if (userEmail && isManagerRole(userRole) && await isOrganizationOwnerEmail(db, organizationId, userEmail)) {
      await grant(ALL_PERMISSION_KEYS);
      return next();
    }

    const permissions = await getUserPermissions(db, userId, organizationId);
    await grant(effectivePermissionsForRole(userRole, Array.isArray(permissions) ? permissions : []));
  } catch (err) {
    // Non-fatal — templates fall back to empty array.
  }

  next();
};

module.exports = setAllowedPermissions;
