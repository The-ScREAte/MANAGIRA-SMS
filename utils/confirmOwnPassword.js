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

// Who is signed in: the school's own account, or a member of staff. A school's own account keeps
// its organization's id in session.user.user_id, so the account type decides, never that id.
function whoIsSignedIn(req) {
  const session = (req && req.session) || {};
  const organizationId = Number(session.organizationId) || null;
  const schoolAccount = String(session.accountType || "").toLowerCase() === "organization";
  const userId = schoolAccount ? null : Number(session.userId || (session.user && session.user.user_id)) || null;
  const name = `${session.firstName || (session.user && session.user.first_name) || ""} ${session.lastName || (session.user && session.user.last_name) || ""}`.trim()
    || session.organizationName || session.email || (session.user && session.user.email) || "Someone";
  const role = session.userRole || session.accountType || (session.user && session.user.account_type) || "User";
  return { organizationId, schoolAccount, userId, name, role };
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
  if (!who.organizationId || (!who.schoolAccount && !who.userId)) throw Object.assign(new Error("Sign in again to continue."), { status: 401 });
  const { rows } = who.schoolAccount
    ? await db.query("SELECT password FROM organizations WHERE organization_id = $1", [who.organizationId])
    : await db.query("SELECT password FROM users WHERE user_id = $1 AND organization_id = $2", [who.userId, who.organizationId]);
  const hash = rows[0] && rows[0].password;
  // Someone who signs in through the school's single sign-on has no Managira password to give.
  if (!hash) throw Object.assign(new Error("Your account signs in through your school's single sign-on, so it has no Managira password to confirm with. Ask your school's main manager to do this."), { status: 403 });
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
