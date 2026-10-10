// Calendar sync with Google Calendar / Outlook (and any iCal app):
// - Out: each person gets a private iCal feed URL their calendar app subscribes to,
//   so Managira events, tagged events and their tasks stay up to date there.
// - In: a person can connect the private iCal address of their Google/Outlook
//   calendar; those events then show inside the Managira calendar.
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const axios = require("axios");
const ical = require("node-ical");

const MAX_ICS_BYTES = 5 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // url -> { at, data }

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
function fold(line) {
  if (line.length <= 74) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = rest.slice(74); }
  parts.push(rest);
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

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.") || v6.startsWith("::ffff:192.168.");
}

// Fetch an external calendar safely (https only, no internal addresses, size + time limits).
async function fetchIcs(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const host = new URL(url).hostname;
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) throw new Error("That address can't be reached.");
  const res = await axios.get(url, {
    timeout: 8000,
    maxContentLength: MAX_ICS_BYTES,
    maxRedirects: 3,
    responseType: "text",
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
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Events from one connected calendar between start and end (YYYY-MM-DD). */
async function importedEvents(imp, start, end) {
  const data = await fetchIcs(imp.url);
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T23:59:59`);
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
      out.push({
        id: `ext-${imp.import_id}-${String(ev.uid || title).slice(0, 60)}-${i}-${s.getTime()}`,
        title: String(title),
        start: inst.isFullDay ? localKey(s) : `${localKey(s)}T${localTime(s)}`,
        end: e ? (inst.isFullDay ? localKey(e) : `${localKey(e)}T${localTime(e)}`) : null,
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

module.exports = { ensureFeedToken, buildIcs, normalizeIcsUrl, detectProvider, fetchIcs, importedEvents };
