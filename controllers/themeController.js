const db = require('../config/db');

/**
 * Update organization theme color
 * POST /account/personalization/theme
 */
const updateThemePost = async (req, res) => {
  try {
    const { themeColor, redirectTo } = req.body;
    const orgId = req.session.organizationId;

    // Valid theme colors
    const validThemes = ['teal', 'blue', 'green', 'purple', 'indigo', 'rose', 'amber', 'yellow', 'slate'];

    if (!themeColor || !validThemes.includes(themeColor)) {
      req.flash("error", "Invalid theme color selected.");
      return res.redirect(redirectTo || "/account/personalization");
    }

    if (!orgId) {
      req.flash("error", "Organization not found.");
      return res.redirect(redirectTo || "/account/personalization");
    }

    await db.query(
      "UPDATE organizations SET theme_color = $1 WHERE organization_id = $2",
      [themeColor, orgId]
    );

    // Update session with new theme color
    req.session.themeColor = themeColor;
    
    req.flash("success", "Theme color updated successfully.");
    return res.redirect(redirectTo || "/account/personalization");
  } catch (err) {
        req.flash("error", "Failed to update theme color.");
    return res.redirect(req.body.redirectTo || "/account/personalization");
  }
};

module.exports = { updateThemePost };
