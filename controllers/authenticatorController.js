"use strict";

// /account/authenticator: a member of staff (or a school signed in as itself) turns two-step
// sign-in with an authenticator app on or off for themselves (utils/signInMfa.js). Setting up
// shows a QR code, the first right code turns it on and shows 10 recovery codes once. Turning it
// off needs the person's own password, and isn't offered while their school requires it.
const mfa = require("../utils/mfa");
const signInMfa = require("../utils/signInMfa");
const { logOrganizationActivity } = require("../utils/activityLog");

const nameOf = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(" ")
  || (req.session.user && req.session.user.email) || "Someone";

function log(req, description) {
  logOrganizationActivity({
    organizationId: req.session.organizationId,
    userId: req.session.userId || (req.session.user && req.session.user.user_id) || null,
    userName: nameOf(req),
    userRole: req.session.userRole,
    actionType: "Updated",
    moduleName: "Security",
    pagePath: "/account/authenticator",
    recordType: "Security",
    recordLabel: "Authenticator app",
    description,
    ipAddress: req.ip,
  }).catch(() => {});
}

async function context(req, db) {
  const account = signInMfa.accountOfSession(req.session);
  if (!account || !signInMfa.featureOn(account.organizationId)) return null;
  const [on, required, self] = await Promise.all([signInMfa.hasApp(db, account), signInMfa.requiredFor(db, req.session), signInMfa.canSelfServe(db, req)]);
  // Managers and people with Settings access set it up themselves; anyone it's required for can too.
  return { account, on, required, allowed: self || required };
}

const fail = (res, status, message) => res.status(status).json({ success: false, message });

module.exports = {
  // The old address opens Settings › Two-step sign-in, where it lives now.
  page: (req, res) => res.redirect(`/account/settings?section=two-step${req.query.required === "1" ? "&required=1" : ""}`),

  // What Settings › Two-step sign-in shows (public/js/authenticatorSettings.js).
  status: async (req, res, db) => {
    try {
      const ctx = await context(req, db);
      if (!ctx || !ctx.allowed) return fail(res, 404, "Not available.");
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, on: ctx.on, required: ctx.required, sso: req.session.signedInWith === "sso", who: signInMfa.accountOfSession(req.session).kind });
    } catch (error) {
      console.error("[Authenticator] status:", error.message);
      return fail(res, 500, "That didn't load. Try again.");
    }
  },

  // A QR code to scan (the same one on a reload until it's confirmed).
  start: async (req, res, db) => {
    try {
      const ctx = await context(req, db);
      if (!ctx || !ctx.allowed) return fail(res, 404, "Not available.");
      if (ctx.on) return fail(res, 400, "Your authenticator app is already on.");
      const setup = await mfa.startSetup(db, ctx.account, mfa.labelOf(req));
      if (setup.error) return fail(res, 400, setup.error);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, qr: setup.qr, secret: setup.secret });
    } catch (error) {
      console.error("[Authenticator] start:", error.message);
      return fail(res, 500, "That didn't work. Try again.");
    }
  },

  // The first right code turns it on; the recovery codes are shown this once.
  confirm: async (req, res, db) => {
    try {
      const ctx = await context(req, db);
      if (!ctx || !ctx.allowed) return fail(res, 404, "Not available.");
      const result = await mfa.confirmSetup(db, ctx.account, String((req.body && req.body.code) || ""));
      if (result.error) return fail(res, 400, result.error);
      req.session.appCheck = { key: mfa.keyOf(ctx.account), ok: true, at: Date.now() };
      log(req, `${nameOf(req)} turned on two-step sign-in with an authenticator app.`);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, recovery: result.recovery });
    } catch (error) {
      console.error("[Authenticator] confirm:", error.message);
      return fail(res, 500, "That didn't work. Try again.");
    }
  },

  // Off again, with the person's own password; never while the school requires it.
  off: async (req, res, db) => {
    try {
      const ctx = await context(req, db);
      if (!ctx || !ctx.allowed) return fail(res, 404, "Not available.");
      if (ctx.required) return fail(res, 403, "Your school requires an authenticator app, so it can't be turned off. To move it to a new phone, ask a manager to reset it, then set it up again.");
      try {
        await require("../utils/confirmOwnPassword").confirmOwnPassword(req, req.body && req.body.password, { purpose: "turn off the authenticator app" });
      } catch (refusal) {
        return fail(res, refusal.status || 401, refusal.message);
      }
      await mfa.reset(db, ctx.account);
      req.session.appCheck = null;
      log(req, `${nameOf(req)} turned off two-step sign-in with an authenticator app.`);
      return res.json({ success: true });
    } catch (error) {
      console.error("[Authenticator] off:", error.message);
      return fail(res, 500, "That didn't work. Try again.");
    }
  },
};
