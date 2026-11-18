"use strict";

// One parent sign-in for children at several Managira schools (feature family_link).
//
// Who is the same parent: parent accounts (guardian_accounts) at other schools with the same sign-in
// email as the account the person signed in with. Each school decided that whoever owns that email
// is its child's parent (it sends that address the child's notices), so the person sees those
// children only once they have PROVEN they own the email: an emailed sign-in code accepted for this
// account (utils/loginCode.js), or the dashboard's one-time "confirm your email" code. The proof is
// kept as the email it proved (guardian_accounts.email_proven); if the sign-in email ever changes,
// the proof no longer matches and nothing else shows until it's proven again. A phone number never
// links anyone.
//
// Opening another school's child switches the session to that school's parent account (its logo,
// its rules, every page's usual checks), through a POST that checks the link again; the dashboard
// switches back to the school the person signed in with (`session.familyHome`). Children from other
// schools are read with that school's own id, so nothing crosses unless the link holds.

const crypto = require("crypto");

const FEATURE = "family_link";
const features = () => require("./shards/features");
const isOn = (organizationId) => features().isOn(FEATURE, { organizationId: Number(organizationId) });
const lower = (value) => String(value || "").trim().toLowerCase();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Whether the column exists yet (2026-12-20_family_link.sql). A failed check keeps its last answer.
let known = null;
let checkedAt = 0;
async function ready(db) {
  if (known === true || (known === false && Date.now() - checkedAt < 60000)) return known;
  try {
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'guardian_accounts' AND column_name = 'email_proven'"
    );
    known = rows.length > 0;
    checkedAt = Date.now();
  } catch (_) {
    return Boolean(known);
  }
  return known;
}

// The account the person signed in with (home), whatever school they're looking at now.
function homeOf(session) {
  if (!session || !session.guardianId || session.userRole !== "Guardian") return null;
  const home = session.familyHome;
  if (home && home.guardianId && home.organizationId) return { guardianId: Number(home.guardianId), organizationId: Number(home.organizationId) };
  return { guardianId: Number(session.guardianId), organizationId: Number(session.organizationId) };
}

async function accountOf(db, guardianId, organizationId) {
  const { rows } = await db.query(
    `SELECT guardian_id, organization_id, login_email, email_proven
       FROM guardian_accounts WHERE guardian_id = $1 AND organization_id = $2
      ORDER BY (password_hash IS NOT NULL) DESC LIMIT 1`,
    [guardianId, organizationId]
  );
  return rows[0] || null;
}

const proven = (account) => Boolean(account && EMAIL.test(lower(account.login_email)) && lower(account.email_proven) === lower(account.login_email));

// Records that the person owns `email` for this account (only while it's still its sign-in email).
async function markProven(db, guardianId, organizationId, email) {
  if (!EMAIL.test(lower(email)) || !(await ready(db))) return false;
  const { rowCount } = await db.query(
    `UPDATE guardian_accounts SET email_proven = LOWER(login_email)
      WHERE guardian_id = $1 AND organization_id = $2 AND LOWER(login_email) = $3
        AND email_proven IS DISTINCT FROM LOWER(login_email)`,
    [guardianId, organizationId, lower(email)]
  );
  return rowCount > 0;
}

// Other schools' parent accounts for this email, where those schools are open, have the parent
// portal and have the feature. Never the home school itself.
async function otherAccounts(db, email, homeOrganizationId) {
  if (!EMAIL.test(lower(email))) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (ga.organization_id)
            ga.guardian_id, ga.organization_id, gp.first_name, gp.last_name,
            o.organization_name, o.nickname, o.nickname_display, o.logo, o.font_style, o.theme_color
       FROM guardian_accounts ga
       JOIN guardian_profiles gp ON gp.guardian_id = ga.guardian_id AND gp.organization_id = ga.organization_id
       JOIN organizations o ON o.organization_id = ga.organization_id
      WHERE LOWER(ga.login_email) = $1 AND ga.organization_id <> $2
        AND COALESCE(o.deleted, FALSE) = FALSE AND COALESCE(o.on_hold, FALSE) = FALSE
      ORDER BY ga.organization_id, ga.guardian_id`,
    [lower(email), Number(homeOrganizationId)]
  );
  const { hasGuardianPortalFeature } = require("./guardianPortalAccess");
  const open = await Promise.all(rows.map(async (row) => isOn(row.organization_id) && (await hasGuardianPortalFeature(db, row.organization_id).catch(() => false))));
  return rows.filter((_row, i) => open[i]);
}

const schoolOf = (row) => ({
  id: Number(row.organization_id),
  name: (row.nickname_display && String(row.nickname_display).trim() && row.nickname_display !== row.nickname) ? row.nickname_display : row.organization_name,
  fullName: row.organization_name,
  logo: row.logo || null,
});

// The family across schools for the dashboard: { home, proven, schools: [{ school, guardianId,
// children }] }, or null where it doesn't apply. `waiting` = other schools exist but the email
// isn't proven yet (nothing about them is shown, only that confirming would add them).
async function familyFor(db, session) {
  const home = homeOf(session);
  if (!home || !isOn(home.organizationId) || !(await ready(db))) return null;
  const account = await accountOf(db, home.guardianId, home.organizationId);
  if (!account || !EMAIL.test(lower(account.login_email))) return null;
  const others = await otherAccounts(db, account.login_email, home.organizationId);
  if (!others.length) return { home, proven: proven(account), schools: [], waiting: false, email: account.login_email };
  if (!proven(account)) return { home, proven: false, schools: [], waiting: true, email: account.login_email };
  const { rows } = await db.query(
    `SELECT gs.guardian_id, s.student_id, s.first_name, s.last_name, s.image_url, s.organization_id, c.class_name
       FROM guardian_students gs
       JOIN students s ON s.student_id = gs.student_id
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
       JOIN UNNEST($1::int[], $2::int[]) AS link(guardian_id, organization_id)
         ON link.guardian_id = gs.guardian_id AND link.organization_id = s.organization_id
      WHERE COALESCE(s.graduated, FALSE) = FALSE
      ORDER BY LOWER(s.first_name), s.student_id`,
    [others.map((o) => Number(o.guardian_id)), others.map((o) => Number(o.organization_id))]
  );
  const schools = others.map((o) => ({
    school: schoolOf(o),
    guardianId: Number(o.guardian_id),
    children: rows
      .filter((r) => Number(r.guardian_id) === Number(o.guardian_id) && Number(r.organization_id) === Number(o.organization_id))
      .map((r) => ({ id: Number(r.student_id), firstName: r.first_name || "", name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Your child", imageUrl: r.image_url, className: r.class_name || "" })),
  })).filter((s) => s.children.length);
  return { home, proven: true, schools, waiting: false, email: account.login_email };
}

// Points the session at a parent account (its school's look and its guardian id), as sign-in does.
function applyAccount(session, row, email) {
  session.guardianId = Number(row.guardian_id);
  session.organizationId = Number(row.organization_id);
  session.organizationName = row.organization_name;
  session.orgNickName = row.nickname;
  session.orgNickNameDisplay = (row.nickname_display && String(row.nickname_display).trim()) || row.nickname;
  session.logo = row.logo;
  session.fontStyle = row.font_style;
  session.themeColor = row.theme_color || "teal";
  session.firstName = row.first_name;
  session.lastName = row.last_name;
  session.user = { user_id: null, first_name: row.first_name, last_name: row.last_name, email: email || null, account_type: "Guardian" };
}

class LinkError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

// Opens another school's child: checks again that the link holds (proven email, that school's
// account for it, the child linked to that account in that school), then switches.
async function switchToChild(db, req, organizationId, studentId) {
  const session = req.session;
  const home = homeOf(session);
  if (!home || !isOn(home.organizationId) || !(await ready(db))) throw new LinkError("That isn't available.");
  const orgId = Number(organizationId);
  const childId = Number(studentId);
  if (!Number.isInteger(orgId) || orgId <= 0 || !Number.isInteger(childId) || childId <= 0) throw new LinkError("That isn't available.", 400);
  if (orgId === home.organizationId) {
    await switchHome(db, req);
    return;
  }
  const account = await accountOf(db, home.guardianId, home.organizationId);
  if (!proven(account)) throw new LinkError("Confirm your email first.");
  const target = (await otherAccounts(db, account.login_email, home.organizationId)).find((row) => Number(row.organization_id) === orgId);
  if (!target) throw new LinkError("That child isn't on your sign-in.");
  const { rows } = await db.query(
    `SELECT 1 FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id
      WHERE gs.guardian_id = $1 AND s.student_id = $2 AND s.organization_id = $3 AND COALESCE(s.graduated, FALSE) = FALSE`,
    [Number(target.guardian_id), childId, orgId]
  );
  if (!rows.length) throw new LinkError("That child isn't on your sign-in.");
  if (!session.familyHome) session.familyHome = { guardianId: home.guardianId, organizationId: home.organizationId };
  applyAccount(session, target, account.login_email);
  logSwitch(req, target, `Opened from the parent's sign-in at another school.`);
}

// A background warm-up (the page-switcher's X-SPA-Preload, a browser prefetch): never switches.
const isWarmUp = (req) => req.get("X-SPA-Preload") === "1" || /prefetch|prerender/i.test(String(req.get("Sec-Purpose") || req.get("Purpose") || ""));

// Middleware for a parent's pages about one child (?studentId=): a linked child at another school
// opens in that school (the link is checked again by switchToChild), and a home child opens at
// home, whichever school the session is looking at, so two tabs or an old link never bounce.
function followChild(db) {
  return async (req, res, next) => {
    try {
      const session = req.session;
      const studentId = Number.parseInt(req.query && req.query.studentId, 10);
      if (req.method !== "GET" || isWarmUp(req) || !session || session.userRole !== "Guardian" || !Number.isInteger(studentId) || studentId <= 0) return next();
      const home = homeOf(session);
      if (!home || !isOn(home.organizationId)) return next();
      const { rows } = await db.query(
        `SELECT s.organization_id,
                EXISTS (SELECT 1 FROM guardian_students gs WHERE gs.guardian_id = $2 AND gs.student_id = s.student_id) AS mine
           FROM students s WHERE s.student_id = $1`,
        [studentId, Number(session.guardianId)]
      );
      const row = rows[0];
      if (!row || (row.mine && Number(row.organization_id) === Number(session.organizationId))) return next();
      await switchToChild(db, req, row.organization_id, studentId);
      await new Promise((resolve, reject) => session.save((error) => (error ? reject(error) : resolve())));
      return res.redirect(req.originalUrl);
    } catch (_) {
      return next(); // the page's own check answers
    }
  };
}

// Back to the school the person signed in with.
async function switchHome(db, req) {
  const session = req.session;
  const home = session && session.familyHome;
  if (!home) return false;
  const { rows } = await db.query(
    `SELECT ga.guardian_id, ga.organization_id, ga.login_email, gp.first_name, gp.last_name,
            o.organization_name, o.nickname, o.nickname_display, o.logo, o.font_style, o.theme_color
       FROM guardian_accounts ga
       JOIN guardian_profiles gp ON gp.guardian_id = ga.guardian_id AND gp.organization_id = ga.organization_id
       JOIN organizations o ON o.organization_id = ga.organization_id
      WHERE ga.guardian_id = $1 AND ga.organization_id = $2 LIMIT 1`,
    [Number(home.guardianId), Number(home.organizationId)]
  );
  if (!rows[0]) throw new LinkError("Your sign-in changed. Sign in again.", 401);
  applyAccount(session, rows[0], rows[0].login_email);
  delete session.familyHome;
  return true;
}

function logSwitch(req, row, description) {
  require("./activityLog").logOrganizationActivity({
    organizationId: Number(row.organization_id),
    userId: Number(row.guardian_id),
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Parent",
    userRole: "Guardian",
    actionType: "Login",
    moduleName: "Authentication",
    pagePath: "/guardian/family/open",
    recordType: "Session",
    recordLabel: `${row.organization_name} parent portal`,
    description,
    changedFields: [],
    ipAddress: req.ip,
  }).catch(() => {});
}

// ── Confirming the email from the dashboard (when the sign-in didn't prove it) ───────────────
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
const RESEND_MS = 60 * 1000;

async function sendConfirmCode(db, req) {
  const home = homeOf(req.session);
  if (!home || !isOn(home.organizationId) || !(await ready(db))) throw new LinkError("That isn't available.");
  const account = await accountOf(db, home.guardianId, home.organizationId);
  if (!account || !EMAIL.test(lower(account.login_email))) throw new LinkError("Your sign-in has no email to confirm.", 400);
  const pending = req.session.familyConfirm;
  if (pending && Date.now() - pending.sentAt < RESEND_MS) throw new LinkError("A code was just sent. Wait a minute before asking for another.", 429);
  const loginCode = require("./loginCode");
  const code = loginCode.newCode();
  req.session.familyConfirm = { hash: loginCode.hashOf(code), email: lower(account.login_email), sentAt: Date.now(), tries: 0 };
  await loginCode.sendCode(account.login_email, code, { organizationId: home.organizationId });
  return loginCode.masked(lower(account.login_email));
}

async function confirmCode(db, req, given) {
  const home = homeOf(req.session);
  const pending = req.session.familyConfirm;
  if (!home || !pending || Date.now() - pending.sentAt > CODE_TTL_MS) {
    delete req.session.familyConfirm;
    throw new LinkError("That code has expired. Ask for a new one.", 400);
  }
  const loginCode = require("./loginCode");
  const a = Buffer.from(loginCode.hashOf(given));
  const b = Buffer.from(pending.hash);
  if (loginCode.tidy(given).length !== loginCode.CODE_LENGTH || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    pending.tries += 1;
    if (pending.tries >= MAX_TRIES) { delete req.session.familyConfirm; throw new LinkError("Too many wrong codes. Ask for a new one.", 400); }
    throw new LinkError(`That code isn't right. ${MAX_TRIES - pending.tries} ${MAX_TRIES - pending.tries === 1 ? "try" : "tries"} left.`, 400);
  }
  delete req.session.familyConfirm;
  await markProven(db, home.guardianId, home.organizationId, pending.email);
  return true;
}

// For a school adding a parent: is this email already a proven parent sign-in at another school
// (with a password)? Then the parent hears "it's on the sign-in you already have" instead of
// "set your password". Returns that school's name, or null.
async function existingSignIn(db, email, organizationId) {
  if (!EMAIL.test(lower(email)) || !isOn(organizationId) || !(await ready(db))) return null;
  const { rows } = await db.query(
    `SELECT o.organization_name, o.organization_id
       FROM guardian_accounts ga JOIN organizations o ON o.organization_id = ga.organization_id
      WHERE LOWER(ga.login_email) = $1 AND ga.organization_id <> $2 AND ga.password_hash IS NOT NULL
        AND COALESCE(ga.must_reset_password, FALSE) = FALSE
        AND ga.email_proven = LOWER(ga.login_email)
        AND COALESCE(o.deleted, FALSE) = FALSE AND COALESCE(o.on_hold, FALSE) = FALSE
      LIMIT 1`,
    [lower(email), Number(organizationId)]
  );
  return rows[0] && isOn(rows[0].organization_id) ? rows[0].organization_name : null;
}

// The email a parent gets when another school adds them and their email already signs in to
// Managira: no new password, the child is on the sign-in they have (in place of "set your password").
function sendLinkedNotice({ to, firstName, studentName, schoolName, organizationId, homeSchool }) {
  const he = require("he");
  const { renderCleanEmail, sendEmailInBackground, buildFailureNotification } = require("./emailHelper");
  const school = ["school", "your school", "our school", "the school"].includes(String(schoolName || "").trim().toLowerCase()) ? "" : String(schoolName || "").trim();
  const signInUrl = process.env.NODE_ENV === "production" ? "https://www.managira.com/account/guardian-login" : "http://localhost:4000/account/guardian-login";
  const html = renderCleanEmail({
    title: `${studentName} is on your Managira sign-in`,
    greeting: firstName ? `Hi ${he.encode(String(firstName).trim())},` : "Hello,",
    paragraphs: [
      `${school ? he.encode(school) : "A school"} added you as a parent or guardian of <strong>${he.encode(studentName)}</strong>.`,
      `You don't need a new account. Sign in with the email and password you already use for ${he.encode(homeSchool)}: ${he.encode(studentName)} is under <strong>My children</strong>, with ${school ? he.encode(school) + "'s" : "their school's"} logo.`,
    ],
    cta: { text: "Sign in", url: signInUrl },
    note: "If you don't know this school, contact it before signing in.",
    schoolName: school,
    organizationId,
  });
  sendEmailInBackground({
    to,
    subject: String(school ? `${studentName} at ${school} is on your Managira sign-in` : `${studentName} is on your Managira sign-in`).replace(/\s*[\r\n]+\s*/g, " ").trim(),
    html,
    onBehalfOf: organizationId,
    failureNotification: buildFailureNotification(organizationId, {
      title: "Guardian welcome email failed",
      body: `The guardian welcome email for ${studentName} could not be delivered to ${to}.`,
    }),
  }, "Guardian Linked Email");
}

module.exports = {
  sendLinkedNotice,
  FEATURE, LinkError, isOn, ready, homeOf, proven, markProven, otherAccounts, familyFor,
  switchToChild, switchHome, sendConfirmCode, confirmCode, existingSignIn, followChild, isWarmUp,
};
