const db = require("../config/db");

const isGuardianAuthenticated = async (req, res, next) => {
  try {
    if (!req.session.guardianId || req.session.userRole !== "Guardian") {
      req.flash("error", "Please login as a parent/guardian.");
      return res.redirect("/account/login");
    }

    // Validate organization is active
    if (req.session.organizationId) {
      const org = await db.query(
        "SELECT deleted, on_hold FROM organizations WHERE organization_id = $1",
        [req.session.organizationId]
      );
      if (!org.rows.length || org.rows[0].deleted || org.rows[0].on_hold) {
        req.session.destroy(() => {});
        req.flash("error", "School account is not active.");
        return res.redirect("/account/login");
      }
    }

    next();
  } catch (error) {
    console.error('Guardian auth error:', error);
    req.flash("error", "Authentication error.");
    return res.redirect("/account/login");
  }
};

module.exports = { isGuardianAuthenticated };
