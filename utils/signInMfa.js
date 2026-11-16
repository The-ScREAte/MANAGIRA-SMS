"use strict";

// Two-step sign-in with an authenticator app (feature sign_in_authenticator). Built on the codes in
// utils/mfa.js (TOTP, RFC 6238; 10 recovery codes; 5 wrong codes wait 10 minutes).
//
// - Any member of staff (and a school signed in as itself) can turn it on for themselves at
//   /account/authenticator. Once on, signing in with a password asks for the app's code instead
//   of the emailed code (utils/loginCode.js).
// - A school can require it (Settings › Tenant configuration, tenant_settings.mfa_required):
//   "admins" = managers, supervisors and the school's own account; "staff" = all staff. A manager
//   can also require it for one person (Edit user, users.mfa_required).
// - Someone required to use it who hasn't set it up is sent to set it up before anything else
//   (`gate`). Single sign-on is left to the school's provider, which carries its own MFA.
// - Parents, students and hub people sign in as before (the emailed code).

const features = require("./shards/features");
const mfa = require("./mfa");
const { settingsFor } = require("./tenantSettings");

const ADMIN_ROLES = new Set(["manager", "supervisor"]);
const CHECK_MS = 5 * 60 * 1000;

const featureOn = (organizationId) => features.isOn("sign_in_authenticator", { organizationId: Number(organizationId) || null });

// The account a (possibly held) session belongs to: a member of staff or a school signed in as
// itself. Null for parents, students, hub people and platform accounts without a school.
function accountOfSession(session) {
  const s = session || {};
  if (s.guardianId || s.studentId) return null;
  const organizationId = Number(s.organizationId) || null;
  if (!organizationId) return null;
  if (String(s.accountType || "").toLowerCase() === "organization") return { kind: "organization", id: organizationId, organizationId };
  const id = Number(s.userId || (s.user && s.user.user_id));
  return id ? { kind: "user", id, organizationId } : null;
}

const roleOf = (session) => String((session && (session.userRole || (session.user && session.user.account_type) || session.accountType)) || "").trim().toLowerCase();

// Whether this person must use an authenticator app: the school's rule for their role, or a
// manager's choice for them alone.
async function requiredFor(db, session) {
  const account = accountOfSession(session);
  if (!account || !featureOn(account.organizationId)) return false;
  const settings = await settingsFor(db, account.organizationId);
  if (settings.mfa_required === "staff") return true;
  if (settings.mfa_required === "admins" && (account.kind === "organization" || ADMIN_ROLES.has(roleOf(session)))) return true;
  if (account.kind !== "user") return false;
  const { rows } = await db.query(
    "SELECT (to_jsonb(u) ->> 'mfa_required')::boolean AS required FROM users u WHERE u.user_id = $1 AND u.organization_id = $2",
    [account.id, account.organizationId]
  ).catch(() => ({ rows: [] }));
  return Boolean(rows[0] && rows[0].required);
}

const hasApp = async (db, account) => Boolean(account && (await mfa.isSetUp(db, account)));

// Who sets up an authenticator app themselves (Settings › Two-step sign-in): managers, the school's
// own account, and people with Settings access. Anyone the school requires it for can always set
// it up (that's how they get back in).
async function canSelfServe(db, req) {
  const s = (req && req.session) || {};
  const role = roleOf(s);
  if (role === "manager" || String(s.accountType || "").toLowerCase() === "organization") return true;
  const { userHasPermission, sessionActor } = require("../middleware/permissionMiddleware");
  return Boolean(await userHasPermission(db, sessionActor(req), "manage_settings").catch(() => false));
}

// Pages someone who must set up their app can still open: the set-up itself, signing out, and
// what the page needs to draw.
const OPEN_PATHS = /^\/(account\/(authenticator|logout|login)|health|favicon\.ico|service-worker\.js|public-image|notifications\/count)(\/|$|\?)/;
// The set-up lives in Settings (section two-step): the Settings page itself opens, read only.
const SETUP_PAGE = "/account/settings?section=two-step&required=1";

function gate(db) {
  return async (req, res, next) => {
    try {
      const s = req.session;
      if (!s || s.signedInWith === "sso" || OPEN_PATHS.test(req.path)) return next();
      if (req.method === "GET" && req.path === "/account/settings") return next();
      const account = accountOfSession(s);
      if (!account || !featureOn(account.organizationId)) return next();
      const mark = s.appCheck;
      if (mark && mark.key === mfa.keyOf(account) && mark.ok && Date.now() - mark.at < CHECK_MS) return next();
      const required = await requiredFor(db, s);
      const ok = !required || (await hasApp(db, account));
      s.appCheck = { key: mfa.keyOf(account), ok, at: Date.now() };
      if (ok) return next();
      const message = "Your school asks you to use an authenticator app to sign in. Set it up to continue.";
      if (req.xhr || /json/i.test(req.get("accept") || "") || req.method !== "GET") return res.status(403).json({ success: false, message });
      return res.redirect(SETUP_PAGE);
    } catch (error) {
      // Never lock someone out because a check couldn't run; it runs again on the next page.
      console.error("[Authenticator] gate:", error.message);
      return next();
    }
  };
}

// For Settings › Tenant configuration: who uses an app now, with each person's name.
async function peopleWithApp(db, organizationId) {
  return mfa.forSchool(db, organizationId).catch(() => []);
}

module.exports = { featureOn, accountOfSession, requiredFor, hasApp, canSelfServe, gate, peopleWithApp, OPEN_PATHS, SETUP_PAGE };
