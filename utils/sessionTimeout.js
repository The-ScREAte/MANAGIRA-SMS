// A sign-in that ends on its own (a quiet spell, or the school's sign-in time) leaves a small
// note in the browser so the login page can say what happened: "Your session timed out. Sign in
// again to continue." The note holds only the reason, lives 12 hours, is read by the server only
// (httpOnly), and is dropped by the next sign-in. public/js/sessionWatch.js takes an open page
// there the moment it happens. Every door into the app (staff, parents, students, drivers, hubs)
// sends someone no longer signed in to the same page and banner (`endedLoginUrl`); only a Log out,
// which leaves "out" here for 10 minutes, goes to a plain login page.

const COOKIE = "mg_timeout";
const REASONS = new Set(["idle", "expired"]);
const LIFETIME_MS = 12 * 60 * 60 * 1000;
const LOGOUT_MS = 10 * 60 * 1000;

function cookieOptions() {
  if (process.env.NODE_ENV !== "production") return { httpOnly: true, sameSite: "lax", path: "/" };
  const domain = process.env.SESSION_COOKIE_DOMAIN === undefined ? ".managira.com" : process.env.SESSION_COOKIE_DOMAIN || undefined;
  return { httpOnly: true, sameSite: "lax", path: "/", domain, secure: process.env.SESSION_COOKIE_SECURE !== "false" };
}

// Called as a timed-out session is destroyed.
function remember(res, reason) {
  if (!REASONS.has(reason)) return;
  res.cookie(COOKIE, reason, { ...cookieOptions(), maxAge: LIFETIME_MS });
}

// A Log out: the other open tabs and pages go to a plain login page, not "timed out".
function rememberLogout(res) {
  res.cookie(COOKIE, "out", { ...cookieOptions(), maxAge: LOGOUT_MS });
}

function read(req) {
  const header = String((req && req.headers && req.headers.cookie) || "");
  const match = header.match(/(?:^|;\s*)mg_timeout=(idle|expired|out)(?:;|$)/);
  return match ? { reason: match[1] } : null;
}

function forget(req, res) {
  if (!read(req)) return;
  res.clearCookie(COOKIE, cookieOptions());
}

function loginUrl(reason) {
  return REASONS.has(reason) ? `/account/login?reason=${reason}` : "/account/login";
}

const signedIn = (session) => Boolean(session && (session.userId || session.user || session.guardianId || session.studentId || session.hubId));

// Why someone nobody is signed in for has to sign in again: the note's reason, nothing after a
// Log out, otherwise their session timed out.
function endedReason(req) {
  const note = read(req);
  if (note) return note.reason === "out" ? "" : note.reason;
  return "idle";
}

// Where a door sends someone no longer signed in.
function endedLoginUrl(req) {
  return loginUrl(endedReason(req));
}

// What the login page says for each reason.
const NOTICES = {
  idle: { title: "Your session timed out.", text: "Sign in again to continue where you left off." },
  expired: { title: "Your sign-in has expired.", text: "For your security, sign-ins last a set time. Sign in again to continue." },
};

module.exports = { COOKIE, REASONS, remember, rememberLogout, read, forget, loginUrl, endedReason, endedLoginUrl, signedIn, NOTICES };
