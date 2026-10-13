const db = require('../config/db');
const { saveAppearance } = require('../utils/organizationAppearance');

/**
 * Update organization theme color
 * POST /account/personalization/theme
 */
const updateThemePost = async (req, res) => {
  try {
    const { themeColor, redirectTo } = req.body;
    const orgId = req.session.organizationId;

    // Valid theme colors
    const validThemes = ['teal', 'blue', 'green', 'purple', 'indigo', 'rose', 'amber', 'yellow', 'slate', 'cyan', 'orange', 'charcoal'];

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

// POST /account/appearance — the signed-in person's own look (white, gray or dark).
const updateAppearancePost = async (req, res) => {
  const wantsJson = req.xhr || String(req.get('accept') || '').includes('application/json');
  try {
    const mode = await saveAppearance(db, req.session, String((req.body && req.body.appearanceMode) || ''));
    req.session.appearance = mode;
    if (wantsJson) return res.json({ success: true, mode });
    req.flash('success', 'Appearance updated.');
  } catch (err) {
    if (wantsJson) return res.status(400).json({ success: false, error: 'Unable to save your appearance. Please try again.' });
    req.flash('error', 'Unable to save your appearance. Please try again.');
  }
  return res.redirect('/account/settings?section=profile');
};

module.exports = { updateThemePost, updateAppearancePost };
