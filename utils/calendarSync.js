const { BoundedMap } = require("./boundedMap");
// Calendar sync with Google Calendar / Outlook (and any iCal app):
// - Out: each person gets a private iCal feed URL their calendar app subscribes to,
//   so Managira events, tagged events and their tasks stay up to date there.
// - In: a person can connect the private iCal address of their Google/Outlook
//   calendar; those events then show inside the Managira calendar.
const crypto = require("crypto");
const axios = require("axios");
const ical = require("node-ical");
const { safeAgent, checkedUrl, lookupPublic } = require("./safeFetch");
const { encryptSecret, decryptSecret, isSettingsEncryptionKeyConfigured } = require("./encryption");

const MAX_ICS_BYTES = 5 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const cache = new BoundedMap(500); // url -> { at, data }

// Google and Microsoft sign-ins and secret calendar links are stored locked. Older rows may
// still be plain; they open as they are and get locked the next time they're written.
const LOCKED = "enc1:";
function lockSecret(value) {
  if (!value || String(value).startsWith(LOCKED) || !isSettingsEncryptionKeyConfigured()) return value || null;
  return LOCKED + encryptSecret(String(value));
}
function openSecret(value) {
  if (!value) return null;
  const text = String(value);
  return text.startsWith(LOCKED) ? decryptSecret(text.slice(LOCKED.length)) || null : text;
}

// A moment in a person's own time zone, not the server's.
const formats = new Map();
function zoned(date, timeZone) {
  const zone = timeZone || "UTC";
  if (!formats.has(zone)) {
    let format;
    try {
      format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch (_error) {
      format = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    if (formats.size > 200) formats.clear();
    formats.set(zone, format);
  }
  const parts = {};
  formats.get(zone).formatToParts(date).forEach((part) => { parts[part.type] = part.value; });
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function ensureFeedToken(db, organizationId, userId, { reset = false } = {}) {
  if (!reset) {
    const r = await db.query(`SELECT token FROM calendar_feed_tokens WHERE organization_id = $1 AND user_id = $2`, [organizationId, userId]);
    if (r.rows[0]) return r.rows[0].token;
  }
  const token = crypto.randomBytes(24).toString("hex");
  await db.query(
    `INSERT INTO calendar_feed_tokens (organization_id, user_id, token) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET token = EXCLUDED.token, created_at = NOW()`,
    [organizationId, userId, token]
  );
  return token;
}

// ---------- iCal output ----------
const icsText = (v) => String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (key) => key.replace(/-/g, "");
const icsDateTime = (key, time) => `${icsDate(key)}T${String(time).slice(0, 5).replace(":", "")}00`;
const icsStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Lines stop at 75 bytes, never in the middle of a character.
function fold(line) {
  if (Buffer.byteLength(line) <= 74) return line;
  const parts = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 73) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * items: [{ uid, title, details, location, date, endDate, startTime, endTime, allDay, url, updatedAt }]
 */
function buildIcs(items, { name = "Managira", host = "managira" } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Managira//School Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const stamp = icsStamp(new Date());
  items.forEach((it) => {
    if (!it.date) return;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${it.uid}@${host}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (it.updatedAt) lines.push(`LAST-MODIFIED:${icsStamp(it.updatedAt)}`);
    if (it.allDay || !it.startTime) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(it.date)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(addDaysKey(it.endDate || it.date, 1))}`);
    } else {
      lines.push(`DTSTART:${icsDateTime(it.date, it.startTime)}`);
      if (it.endTime) lines.push(`DTEND:${icsDateTime(it.endDate || it.date, it.endTime)}`);
      else lines.push("DURATION:PT1H");
    }
    lines.push(`SUMMARY:${icsText(it.title)}`);
    if (it.location) lines.push(`LOCATION:${icsText(it.location)}`);
    const desc = [it.details, it.url ? `Open in Managira: ${it.url}` : ""].filter(Boolean).join("\n\n");
    if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
    if (it.url) lines.push(`URL:${it.url}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---------- iCal input ----------
function normalizeIcsUrl(raw) {
  let s = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, "https://");
  let url;
  try { url = new URL(s); } catch (_e) { return null; }
  if (url.protocol !== "https:") return null;
  return url.toString();
}

function detectProvider(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("google.com")) return "google";
  if (host.includes("outlook") || host.includes("office365") || host.includes("live.com") || host.includes("office.com")) return "outlook";
  if (host.includes("icloud.com")) return "apple";
  return "other";
}

// Fetch an external calendar safely (https only, no internal addresses, size + time limits).
async function fetchIcs(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  await lookupPublic(checkedUrl(url).hostname);
  const res = await axios.get(url, {
    timeout: 8000,
    maxContentLength: MAX_ICS_BYTES,
    maxRedirects: 3,
    responseType: "text",
    httpsAgent: safeAgent,
    proxy: false,
    beforeRedirect: (options) => { checkedUrl(options.href); },
    headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "Managira-Calendar/1.0" },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const text = String(res.data || "");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link isn't an iCal calendar.");
  const data = ical.sync.parseICS(text);
  cache.set(url, { at: Date.now(), data });
  return data;
}

const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Events from one connected calendar between start and end (YYYY-MM-DD). */
async function importedEvents(imp, start, end, timeZone) {
  const data = await fetchIcs(openSecret(imp.url));
  // A day either side, because the server's day isn't the viewer's.
  const from = new Date(Date.parse(`${start}T00:00:00Z`) - 864e5);
  const to = new Date(Date.parse(`${end}T23:59:59Z`) + 864e5);
  const out = [];
  Object.values(data).forEach((ev) => {
    if (!ev || ev.type !== "VEVENT" || ev.recurrenceid) return;
    let instances = [];
    try { instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true }); } catch (_e) { instances = []; }
    instances.forEach((inst, i) => {
      if (out.length > 1500) return;
      const s = new Date(inst.start);
      const e = inst.end ? new Date(inst.end) : null;
      const title = typeof inst.summary === "string" ? inst.summary : (inst.summary && inst.summary.val) || ev.summary || "Busy";
      const at = zoned(s, timeZone);
      const until = e ? zoned(e, timeZone) : null;
      out.push({
        id: `ext-${imp.import_id}-${String(ev.uid || title).slice(0, 60)}-${i}-${s.getTime()}`,
        title: String(title),
        start: inst.isFullDay ? localKey(s) : `${at.day}T${at.time}`,
        end: e ? (inst.isFullDay ? localKey(e) : `${until.day}T${until.time}`) : null,
        allDay: !!inst.isFullDay,
        editable: false,
        classNames: ["cal-ev", "cal-ev--external"],
        extendedProps: {
          kind: "external",
          source: imp.label,
          provider: imp.provider,
          owner: imp.owner_name || null,
          details: typeof ev.description === "string" ? ev.description.slice(0, 2000) : "",
          location: typeof ev.location === "string" ? ev.location : "",
        },
      });
    });
  });
  return out;
}

module.exports = { ensureFeedToken, buildIcs, normalizeIcsUrl, detectProvider, fetchIcs, importedEvents, lockSecret, openSecret, zoned };
