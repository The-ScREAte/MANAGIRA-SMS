"use strict";

// "Keep me logged in" on the sign-in forms. Ticked: the sign-in lasts 30 days, through closed
// browsers and quiet spells. Not ticked: it ends when the browser closes, and after 4 hours
// without use, as before. Platform admins never stay signed in: their accounts reach every school.
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const PLATFORM_ROLES = new Set(["admin", "mini admin", "internal worker"]);

const signedIn = (session) => Boolean(session && (session.userId || session.organizationId || session.guardianId || session.studentId || session.hubId));

function keepSignedInChoice(req, res, next) {
  const asked = ["on", "true", "1", "yes"].includes(String((req.body && req.body.remember) || "").trim().toLowerCase());
  let applied = false;
  const apply = () => {
    if (applied) return;
    const session = req.session;
    if (!signedIn(session)) return;
    applied = true;
    const role = String(session.userRole || session.accountType || "").trim().toLowerCase();
    const keep = asked && !PLATFORM_ROLES.has(role);
    session.keepSignedIn = keep;
    if (keep) session.cookie.maxAge = KEEP_MS;
    else session.cookie.expires = false; // gone when the browser closes
  };
  // Every sign-in ends by sending the person on, or by showing the page that takes them there.
  for (const name of ["redirect", "render"]) {
    const original = res[name].bind(res);
    res[name] = (...args) => { apply(); return original(...args); };
  }
  return next();
}

const idleLimitFor = (session, normalMs) => (session && session.keepSignedIn ? KEEP_MS : normalMs);

module.exports = { keepSignedInChoice, idleLimitFor, KEEP_MS };
