"use strict";

// "Today" in the user's own time zone. The browser stores its IANA time zone
// in the mgr_tz cookie (views/layout.ejs); without it we fall back to
// DEFAULT_TIME_ZONE, then UTC. Dates are keys like "2026-11-02".
const COOKIE = "mgr_tz";

// One formatter per time zone, reused: building an Intl.DateTimeFormat is slow, and this runs
// on many requests. The zone comes from a cookie, so the list is capped.
const formatters = new Map();
function formatterFor(zone) {
  let entry = formatters.get(zone);
  if (entry === undefined) {
    try { entry = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }); } catch (_e) { entry = null; }
    if (formatters.size >= 500) formatters.clear();
    formatters.set(zone, entry);
  }
  return entry;
}

function validZone(zone) {
  if (!zone) return null;
  return formatterFor(zone) ? zone : null;
}

function timeZoneOf(req) {
  const raw = String((req && req.headers && req.headers.cookie) || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const fromCookie = raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : "";
  return validZone(fromCookie) || validZone(process.env.DEFAULT_TIME_ZONE) || "UTC";
}

// YYYY-MM-DD for a moment in a time zone.
function dateKeyIn(timeZone, date = new Date()) {
  const formatter = formatterFor(timeZone);
  if (!formatter) throw new RangeError(`Invalid time zone specified: ${timeZone}`);
  return formatter.format(date);
}

const todayKeyFor = (req) => dateKeyIn(timeZoneOf(req));

module.exports = { COOKIE, timeZoneOf, dateKeyIn, todayKeyFor };
