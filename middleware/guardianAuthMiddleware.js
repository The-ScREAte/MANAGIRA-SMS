const db = require("../config/db");
const { hasGuardianPortalFeature } = require("../utils/guardianPortalAccess");

const isGuardianAuthenticated = async (req, res, next) => {
  const safeFlashError = (message) => {
    try {
      if (req.session && typeof req.flash === "function") {
        req.flash("error", message);
      }
    } catch (_) {
    }
  };

  try {
    if (!req.session || !req.session.guardianId || req.session.userRole !== "Guardian") {
      safeFlashError("Please login as a parent/guardian.");
      return res.redirect("/account/login");
    }

    // Validate organization is active
    if (req.session.organizationId) {
      const org = await db.query(
        "SELECT deleted, on_hold FROM organizations WHERE organization_id = $1",
        [req.session.organizationId]
      );
      if (!org.rows.length || org.rows[0].deleted || org.rows[0].on_hold) {
        safeFlashError("School account is not active.");
        req.session.destroy(() => {});
        return res.redirect("/account/login");
      }

      const guardianPortalEnabled = await hasGuardianPortalFeature(
        db,
        req.session.organizationId
      );

      if (!guardianPortalEnabled) {
        safeFlashError("Parent portal access is not enabled for this school.");
        req.session.destroy(() => {});
        return res.redirect("/account/guardian-login");
      }
    }

    next();
  } catch (error) {
    console.error('Guardian auth error:', error);
    safeFlashError("Authentication error.");
    return res.redirect("/account/login");
  }
};

module.exports = { isGuardianAuthenticated };
