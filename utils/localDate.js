"use strict";

// "Today" in the user's own time zone. The browser stores its IANA time zone
// in the mgr_tz cookie (views/layout.ejs); without it we fall back to
// DEFAULT_TIME_ZONE, then UTC. Dates are keys like "2026-11-02".
const COOKIE = "mgr_tz";

function validZone(zone) {
  if (!zone) return null;
  try { Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch (_e) { return null; }
}

function timeZoneOf(req) {
  const raw = String((req && req.headers && req.headers.cookie) || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const fromCookie = raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : "";
  return validZone(fromCookie) || validZone(process.env.DEFAULT_TIME_ZONE) || "UTC";
}

// YYYY-MM-DD for a moment in a time zone.
function dateKeyIn(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const todayKeyFor = (req) => dateKeyIn(timeZoneOf(req));

module.exports = { COOKIE, timeZoneOf, dateKeyIn, todayKeyFor };
