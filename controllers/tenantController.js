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
  mfa_required: "Authenticator app at sign-in",
};
const RULE_WORDS = { off: "each person chooses", admins: "required for managers and supervisors", staff: "required for all staff" };

// Two-step sign-in with an authenticator app (utils/signInMfa.js): whether the school has it, and
// who uses an app now (a manager can reset one when someone loses their phone).
async function authenticatorState(req, db) {
  const signInMfa = require("../utils/signInMfa");
  const organizationId = req.session.organizationId;
  if (!signInMfa.featureOn(organizationId)) return { available: false, people: [] };
  const people = await signInMfa.peopleWithApp(db, organizationId);
  return {
    available: true,
    people: people.map((p) => ({ kind: p.account_kind, id: Number(p.account_id), name: p.name, since: p.confirmed_at, recoveryLeft: Number(p.recovery_left || 0) })),
  };
}

async function state(req, db, settings) {
  const organizationId = req.session.organizationId;
  return {
    success: true,
    settings,
    choices: { ...tenantSettings.CHOICES, ...tenantSettings.WORD_CHOICES },
    codeAvailable: features.isOn("login_code", { organizationId }),
    authenticator: await authenticatorState(req, db),
  };
}

module.exports = {
  // A manager resets someone's authenticator app (a lost phone), with their own password. The
  // person sets it up again the next time they sign in (if the school requires it) or when they choose.
  resetAuthenticator: async (req, res, db) => {
    try {
      const organizationId = Number(req.session.organizationId);
      const kind = String((req.body && req.body.kind) || "");
      const id = Number(req.body && req.body.id);
      const belongs = kind === "organization"
        ? id === organizationId
        : kind === "user" && Number.isInteger(id) && (await db.query("SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2", [id, organizationId])).rowCount > 0;
      if (!belongs) return res.status(404).json({ success: false, message: "That person isn't in your school." });
      try {
        await require("../utils/confirmOwnPassword").confirmOwnPassword(req, req.body && req.body.password, { purpose: "reset someone's authenticator app" });
      } catch (refusal) {
        return res.status(refusal.status || 401).json({ success: false, message: refusal.message });
      }
      const mfa = require("../utils/mfa");
      await mfa.reset(db, { kind, id });
      logOrganizationActivity({
        organizationId,
        userId: req.session.userId || null,
        userName: actorName(req),
        userRole: req.session.userRole,
        actionType: "Updated",
        moduleName: "Tenant configuration",
        pagePath: "/account/settings",
        recordType: "Security",
        recordLabel: "Authenticator app",
        description: `${actorName(req)} reset an authenticator app (${kind} ${id}).`,
        ipAddress: req.ip,
      }).catch(() => {});
      return res.json(await state(req, db, await tenantSettings.settingsFor(db, organizationId)));
    } catch (error) {
      console.error("[Tenant configuration] reset authenticator:", error.message);
      return res.status(500).json({ success: false, message: "That didn't work. Try again." });
    }
  },

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
      return res.json(await state(req, db, await tenantSettings.settingsFor(db, req.session.organizationId)));
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
          changedFields: changed.map((key) => ({ field: LABELS[key], oldValue: String(RULE_WORDS[before[key]] || before[key]), newValue: String(RULE_WORDS[after[key]] || after[key]) })),
          ipAddress: req.ip,
        }).catch(() => {});
      }
      return res.json(await state(req, db, after));
    } catch (error) {
      if (error instanceof tenantSettings.TenantSettingsError) return res.status(400).json({ success: false, message: error.message });
      console.error("[Tenant configuration] save:", error.message);
      return res.status(500).json({ success: false, message: "That didn't save. Try again." });
    }
  },
};
