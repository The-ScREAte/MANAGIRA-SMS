const db = require("../config/db");
const {
  ensureOrganizationDisplayPreferencesSchema,
  applyDisplayPreferencesToSession,
} = require("./organizationDisplayPreferences");

// How long the organization's display settings (theme, font, name and date
// format) stay cached in a session before being re-read.
const ORGANIZATION_DISPLAY_REFRESH_MS = 5 * 60 * 1000;

// Login stores the organization id but not all display settings, so pages
// (and the report/transcript PDFs rendered from them) used default name and
// date formats until some other page loaded them. Load them on the first
// request and refresh periodically so changes by other admins show up.
async function refreshOrganizationDisplaySettings(req) {
  const lastLoadedAt = Number(req.session.organizationDisplayLoadedAt || 0);
  const loadedForCurrentOrganization =
    String(req.session.organizationDisplayLoadedFor || "") === String(req.session.organizationId);
  if (loadedForCurrentOrganization && Date.now() - lastLoadedAt < ORGANIZATION_DISPLAY_REFRESH_MS) {
    return;
  }

  await ensureOrganizationDisplayPreferencesSchema(db);
  const result = await db.query(
    `SELECT font_style, theme_color, name_display_format, date_display_format
       FROM organizations
      WHERE organization_id = $1
      LIMIT 1`,
    [req.session.organizationId]
  );

  const organization = result.rows[0];
  if (organization) {
    req.session.fontStyle = organization.font_style || req.session.fontStyle || null;
    req.session.themeColor = organization.theme_color || req.session.themeColor || "teal";
    applyDisplayPreferencesToSession(req.session, organization);
  }
  req.session.organizationDisplayLoadedAt = Date.now();
  req.session.organizationDisplayLoadedFor = req.session.organizationId;
}

async function hydrateOrganizationSession(req) {
  if (!req || !req.session) {
    return false;
  }

  if (req.session.organizationId) {
    await refreshOrganizationDisplaySettings(req);
    return true;
  }

  const userId = req.session.userId || (req.session.passport && req.session.passport.user) || (req.user && req.user.user_id);
  if (!userId) {
    return false;
  }

  await ensureOrganizationDisplayPreferencesSchema(db);

  const result = await db.query(
    `SELECT u.user_id, u.organization_id, u.account_type, u.first_name, u.last_name, u.profile_image_url,
            o.organization_name, o.logo, o.font_style, o.theme_color,
            o.name_display_format, o.date_display_format
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
  applyDisplayPreferencesToSession(req.session, user);
  req.session.organizationDisplayLoadedAt = Date.now();
  req.session.organizationDisplayLoadedFor = user.organization_id;

  return true;
}

module.exports = {
  hydrateOrganizationSession,
};