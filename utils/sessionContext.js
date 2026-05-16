const db = require("../config/db");

async function hydrateOrganizationSession(req) {
  if (!req || !req.session) {
    return false;
  }

  if (req.session.organizationId) {
    return true;
  }

  const userId = req.session.userId || (req.session.passport && req.session.passport.user) || (req.user && req.user.user_id);
  if (!userId) {
    return false;
  }

  const result = await db.query(
    `SELECT u.user_id, u.organization_id, u.account_type, u.first_name, u.last_name, u.profile_image_url,
            o.organization_name, o.logo, o.font_style, o.theme_color
       FROM users u
       LEFT JOIN organizations o ON o.organization_id = u.organization_id
      WHERE u.user_id = $1
      LIMIT 1`,
    [userId]
  );

  if (!result.rows.length) {
    return false;
  }

  const user = result.rows[0];
  req.session.userId = req.session.userId || user.user_id;
  req.session.firstName = req.session.firstName || user.first_name;
  req.session.lastName = req.session.lastName || user.last_name;
  req.session.accountType = req.session.accountType || user.account_type;
  req.session.profileImageUrl = req.session.profileImageUrl || user.profile_image_url || null;

  if (!user.organization_id) {
    return false;
  }

  req.session.organizationId = user.organization_id;
  req.session.organizationName = user.organization_name || req.session.organizationName;
  req.session.logo = user.logo || req.session.logo || null;
  req.session.fontStyle = user.font_style || req.session.fontStyle || null;
  req.session.themeColor = user.theme_color || req.session.themeColor || "teal";

  return true;
}

module.exports = {
  hydrateOrganizationSession,
};