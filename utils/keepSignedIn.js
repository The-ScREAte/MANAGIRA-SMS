"use strict";

// "Keep me logged in" on the sign-in forms. Ticked: the sign-in lasts the school's Keep me logged
// in time (30 days unless it chose otherwise), through closed browsers and quiet spells. Not ticked:
// it ends when the browser closes, after 4 hours without use, or at the school's session timeout
// (24 hours unless it chose otherwise). Platform admins never stay signed in: their accounts reach every school.
const PLATFORM_ROLES = new Set(["admin", "mini admin", "internal worker"]);

const signedIn = (session) => Boolean(session && (session.userId || session.organizationId || session.guardianId || session.studentId || session.hubId));

function keepSignedInChoice(req, res, next) {
  const asked = ["on", "true", "1", "yes"].includes(String((req.body && req.body.remember) || "").trim().toLowerCase());
  let applied = false;
  const apply = async () => {
    if (applied) return;
    const session = req.session;
    if (!signedIn(session)) return;
    applied = true;
    const role = String(session.userRole || session.accountType || "").trim().toLowerCase();
    const tenantSettings = require("./tenantSettings");
    const settings = await tenantSettings.settingsFor(require("../config/db"), session.organizationId).catch(() => tenantSettings.DEFAULTS);
    const keep = asked && !PLATFORM_ROLES.has(role) && settings.keep_signed_in_allowed;
    session.keepSignedIn = keep;
    session.signedInAt = Date.now();
    if (keep) session.cookie.maxAge = settings.keep_signed_in_days * 24 * 60 * 60 * 1000;
    else session.cookie.expires = false; // gone when the browser closes
  };
  // Every sign-in ends by sending the person on, or by showing the page that takes them there.
  for (const name of ["redirect", "render"]) {
    const original = res[name].bind(res);
    res[name] = (...args) => { apply().then(() => original(...args), () => original(...args)); };
  }
  return next();
}

// A kept sign-in isn't ended by a quiet spell of hours; it ends at the school's Keep me logged in
// time (server.js), and never lasts past the longest a school can choose.
const LONGEST_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const idleLimitFor = (session, normalMs) => (session && session.keepSignedIn ? LONGEST_KEEP_MS : normalMs);

module.exports = { keepSignedInChoice, idleLimitFor };
