// Determines whether the current session is a Managira Worker (Admin/Mini Admin
// excluded) who is inside a granted org-switch — i.e. viewing a school's
// dashboard that isn't theirs, via /admin/org/:organization_id. Such sessions
// get full org-owner-equivalent access everywhere else in the app (by design,
// req.session.userRole is set to 'Admin' for that), so Billing/Security/PayGira
// visibility inside that switched session has to be gated here explicitly,
// independent of the normal permission system.

async function getOrgSwitchFeatureRestriction(db, req) {
  const session = req.session || {};
  const isOrgSwitch = !!(session.superAdminOrgSwitch && session.organizationId && session.originalAdminUserId);
  const originalAccountType = String(session.originalAccountType || "").trim();
  const isRestrictedWorker = isOrgSwitch && originalAccountType !== "Admin" && originalAccountType !== "Mini Admin";

  if (!isRestrictedWorker) {
    return { isRestricted: false, flags: { canViewBilling: true, canViewSecurity: true, canViewPaygira: true } };
  }

  try {
    const result = await db.query(
      `SELECT can_view_billing, can_view_security, can_view_paygira
       FROM user_feature_flags
       WHERE user_id = $1`,
      [session.originalAdminUserId]
    );
    const row = result.rows[0] || {};
    return {
      isRestricted: true,
      flags: {
        canViewBilling: !!row.can_view_billing,
        canViewSecurity: !!row.can_view_security,
        canViewPaygira: !!row.can_view_paygira,
      },
    };
  } catch (_) {
    return { isRestricted: true, flags: { canViewBilling: false, canViewSecurity: false, canViewPaygira: false } };
  }
}

module.exports = { getOrgSwitchFeatureRestriction };
