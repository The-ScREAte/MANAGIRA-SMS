"use strict";

// Settings, Tenant configuration: a school's sign-in rules. Managers only.
const features = require("../utils/shards/features");
const tenantSettings = require("../utils/tenantSettings");
const { logOrganizationActivity } = require("../utils/activityLog");

const actorName = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(" ") || "A manager";
const LABELS = {
  session_hours: "Session timeout",
  keep_signed_in_allowed: "Allow Keep me logged in",
  keep_signed_in_days: "Keep me logged in for",
  login_code_required: "Verification code at sign-in",
  remember_device_allowed: "Allow a browser to be remembered",
  remember_device_days: "Remember a browser for",
};

function state(req, settings) {
  const organizationId = req.session.organizationId;
  return {
    success: true,
    settings,
    choices: tenantSettings.CHOICES,
    codeAvailable: features.isOn("login_code", { organizationId }),
  };
}

module.exports = {
  // Sign-in rules decide who stays signed in, so only a manager changes them.
  managersOnly: (req, res, next) => {
    const role = String(req.session.userRole || "").trim().toLowerCase();
    if (role === "manager" || req.session.accountType === "Organization") return next();
    return res.status(403).json({ success: false, message: "Only a manager can change the tenant configuration." });
  },

  guard: (req, res, next) => {
    if (features.isOn("tenant_config", { organizationId: req.session.organizationId })) return next();
    return res.status(404).json({ success: false, message: "Not available." });
  },

  get: async (req, res, db) => {
    try {
      return res.json(state(req, await tenantSettings.settingsFor(db, req.session.organizationId)));
    } catch (error) {
      console.error("[Tenant configuration] read:", error.message);
      return res.status(500).json({ success: false, message: "That didn't load. Try again." });
    }
  },

  save: async (req, res, db) => {
    try {
      const { before, after } = await tenantSettings.saveSettings(db, req.session.organizationId, req.body || {}, actorName(req));
      const changed = Object.keys(LABELS).filter((key) => before[key] !== after[key]);
      if (changed.length) {
        logOrganizationActivity({
          organizationId: req.session.organizationId,
          userId: req.session.userId || null,
          userName: actorName(req),
          userRole: req.session.userRole,
          actionType: "Updated",
          moduleName: "Tenant configuration",
          pagePath: "/account/settings",
          recordType: "Setting",
          recordLabel: "Sign-in rules",
          description: `${actorName(req)} changed ${changed.map((key) => LABELS[key]).join(", ")}.`,
          changedFields: changed.map((key) => ({ field: LABELS[key], oldValue: String(before[key]), newValue: String(after[key]) })),
          ipAddress: req.ip,
        }).catch(() => {});
      }
      return res.json(state(req, after));
    } catch (error) {
      if (error instanceof tenantSettings.TenantSettingsError) return res.status(400).json({ success: false, message: error.message });
      console.error("[Tenant configuration] save:", error.message);
      return res.status(500).json({ success: false, message: "That didn't save. Try again." });
    }
  },
};
