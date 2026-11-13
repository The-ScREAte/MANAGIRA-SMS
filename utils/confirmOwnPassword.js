const { BoundedMap } = require("./boundedMap");
// "Enter your password to continue" for sensitive actions: checks the signed-in person's own
// password, never anyone else's. A member of staff confirms with their own password; someone
// signed in as the school's own account, with the school's. Whoever may open the page may act
// on it, with their own password. Wrong tries are limited (correct ones never count against it),
// and every confirmation and wrong try is in the school's activity log, saying what it was for.
const bcrypt = require("./passwordHashing");
const db = require("../config/db");

const MAX_WRONG = 5;
const WINDOW_MS = 10 * 60 * 1000;
const wrongTries = new BoundedMap(5000, { keepUnderPressure: true });

// Who is really signed in, and where their password is kept:
//  - a hub person who opened one of the hub's schools (hubOrgSwitch): their own hub sign-in (a hub
//    user's, or the hub's own), or the Managira admin viewing that hub; never the school's;
//  - a Managira admin who opened a school from Admin (superAdminOrgSwitch): the admin's own;
//  - the school's own account (accountType "Organization", its id kept in session.user.user_id):
//    the school's;
//  - a member of staff: their own.
const ADMIN_TYPES = ["Admin", "Mini Admin", "Internal Worker"];
const fullName = (a, b) => `${a || ""} ${b || ""}`.trim();
function whoIsSignedIn(req) {
  const session = (req && req.session) || {};
  const organizationId = Number(session.organizationId) || null;
  const role = session.userRole || session.accountType || (session.user && session.user.account_type) || "User";
  const hubSwitch = session.hubOrgSwitch && session.hubOrgSwitch.saved;
  if (hubSwitch) {
    const name = String(session.hubOrgSwitch.by || "").trim() || fullName(hubSwitch.firstName, hubSwitch.lastName) || hubSwitch.hubName || "Hub";
    if (hubSwitch.adminHubView && Number(hubSwitch.userId)) return { organizationId, kind: "admin", id: Number(hubSwitch.userId), userId: null, name, role: "Managira admin" };
    if (Number(hubSwitch.hubUserId)) return { organizationId, kind: "hubUser", id: Number(hubSwitch.hubUserId), hubId: Number(hubSwitch.hubId) || null, userId: null, name, role: "Hub" };
    if (Number(hubSwitch.hubId)) return { organizationId, kind: "hub", id: Number(hubSwitch.hubId), userId: null, name, role: "Hub" };
  }
  if (session.superAdminOrgSwitch || session.originalAdminUserId) {
    const id = Number(session.originalAdminUserId || session.userId) || null;
    return { organizationId, kind: "admin", id, userId: null, name: fullName(session.firstName, session.lastName) || session.userEmail || "Managira admin", role: "Managira admin" };
  }
  const schoolAccount = String(session.accountType || "").toLowerCase() === "organization";
  const userId = schoolAccount ? null : Number(session.userId || (session.user && session.user.user_id)) || null;
  const name = fullName(session.firstName || (session.user && session.user.first_name), session.lastName || (session.user && session.user.last_name))
    || session.organizationName || session.email || (session.user && session.user.email) || "Someone";
  return { organizationId, kind: schoolAccount ? "school" : "staff", id: schoolAccount ? organizationId : userId, schoolAccount, userId, name, role };
}

// The stored password hash of whoever is signed in (null when they have none).
async function storedHash(who) {
  const read = async (sql, args) => ((await db.query(sql, args)).rows[0] || {});
  if (!who.id) return null;
  if (who.kind === "school") return (await read("SELECT password FROM organizations WHERE organization_id = $1", [who.id])).password || null;
  if (who.kind === "staff") return (await read("SELECT password FROM users WHERE user_id = $1 AND organization_id = $2", [who.id, who.organizationId])).password || null;
  if (who.kind === "admin") return (await read("SELECT password FROM users WHERE user_id = $1 AND organization_id IS NULL AND account_type::text = ANY($2::text[])", [who.id, ADMIN_TYPES])).password || null;
  if (who.kind === "hubUser") return (await read("SELECT password FROM hub_users WHERE hub_user_id = $1 AND ($2::int IS NULL OR hub_id = $2)", [who.id, who.hubId])).password || null;
  if (who.kind === "hub") return (await read("SELECT hub_password FROM managira_hubs WHERE hub_id = $1", [who.id])).hub_password || null;
  return null;
}

function logConfirmation(req, who, purpose, ok) {
  if (!who.organizationId || !purpose) return;
  require("./activityLog").logOrganizationActivity({
    organizationId: who.organizationId,
    userId: who.userId || who.organizationId,
    userName: who.name,
    userRole: who.role,
    actionType: ok ? "Confirmed password" : "Wrong password",
    moduleName: "Settings",
    pagePath: String((req && req.originalUrl) || "/account/settings").slice(0, 300),
    recordType: "Security",
    recordLabel: purpose.slice(0, 200),
    description: ok ? `${who.name} confirmed their password to ${purpose}.` : `${who.name} entered a wrong password while trying to ${purpose}.`,
    ipAddress: req && req.ip,
  }).catch(() => {});
}

// Throws (with a status and words for the person) unless the password is the signed-in
// person's own. `purpose`: what it unlocks, for the activity log ("turn WhatsApp on").
async function confirmOwnPassword(req, password, { purpose = "" } = {}) {
  const key = req.sessionID || req.ip;
  const now = Date.now();
  const entry = wrongTries.get(key);
  if (entry && now - entry.start < WINDOW_MS && entry.count >= MAX_WRONG) {
    throw Object.assign(new Error("Too many wrong tries. Wait a few minutes and try again."), { status: 429 });
  }
  const typed = String(password || "");
  if (!typed) throw Object.assign(new Error("Enter your password."), { status: 400 });
  const who = whoIsSignedIn(req);
  if (!who.organizationId || !who.id) throw Object.assign(new Error("Sign in again to continue."), { status: 401 });
  const hash = await storedHash(who);
  // Someone who signs in through the school's single sign-on has no Managira password to give.
  if (!hash) {
    const why = who.kind === "staff"
      ? "Your account signs in through your school's single sign-on, so it has no Managira password to confirm with. Ask your school's main manager to do this."
      : "Your account has no password to confirm with. Sign in again, then try once more.";
    throw Object.assign(new Error(why), { status: 403 });
  }
  if (!(await bcrypt.compare(typed, hash))) {
    if (!entry || now - entry.start >= WINDOW_MS) wrongTries.set(key, { start: now, count: 1 });
    else entry.count += 1;
    logConfirmation(req, who, purpose, false);
    throw Object.assign(new Error("That password is not correct."), { status: 401 });
  }
  logConfirmation(req, who, purpose, true);
  return who;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of wrongTries.entries()) if (now - entry.start > WINDOW_MS) wrongTries.delete(key);
}, 15 * 60 * 1000).unref();

module.exports = { confirmOwnPassword, whoIsSignedIn };
