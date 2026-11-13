"use strict";
// Lists a school kept by hand in its old system (nurse visits, service hours, lockers, library
// loans, tutoring…) keep working in Managira: each the school chooses becomes a section of the
// Custom editor in a group of its own ("From your old system"), staff only, a list that grows, with
// every old row an entry on its student, dated by the row's own date. Staff open them on the
// student and in the classroom's Forms tab and keep adding to them; Report Builder and Download
// work as for any section. Logs a machine wrote (scans, GPS, clicks, transactions) stay history:
// nobody fills those in. Every list, form or not, is grouped by topic wherever it's shown.
const crypto = require("crypto");
const ps = require("./powerschool");
const lists = require("./lists");

const MAX_FORMS = 60; // per migration: the school's Custom editor holds 200 sections in all
const MAX_COLUMNS = 40; // a form people fill in, not a spreadsheet
const MAX_PER_STUDENT = 40; // more rows than this for each student is a log, not a record kept by hand
const SOURCE_NAME = "Old system";

// Logs a system wrote by itself (from the list's name or its columns), reference tables, another
// app's own records (accounts, messages, scores) and archives of past years: history, never a form.
const MACHINE = /(^|_)(gps|telemetry|clickstream|swipes?|badge|wifi|battery|print_?quota|usb|vpn|proxy|geolocation|proctoring|screen_?control|lockdown|web_?filter|vape|sensors?|cctv|dvr|scans?|taps?|sync|audit|analytics|revision|kiosk|transactions?|minutes|seat_?time|counts?|metrics|usage|snapshots?|provisioning|rostering|crosswalk|merge|definitions?|templates?|rules|formulas?|inventory|catalog|clearinghouse|growth|risk_?scores?|value_?added|index|documents?|attachments?|files?|images?|scanned|notifications?|messages?|accounts?|portal|sso|mdm|aliases|ids|state_?reporting|rosters?|grades?|scores?|standards?|deposits?|billing|orders?|passes|points|comments?|history|progress|visitors?)(_|$)|(19|20)\d{2}_(19|20)?\d{2}(_|$)/;
const MACHINE_COLUMNS = new Set(["latitude", "longitude", "lat", "lng", "ipaddress", "ip", "speedmph", "speed", "heading", "macaddress", "accesspoint", "sessionid", "deviceid", "useragent", "pageviews", "keystrokes", "batterypct"]);

// Topics, for grouping a school's lists wherever they're shown (first match wins). Each word
// matches at the start of a word of the list's name ("nap" never matches "snap").
const word = (text) => new RegExp(`(^|_)(${text})`);
const TOPICS = [
  ["Health", word("health|nurse|medic|immuni|allerg|vision|hearing|dental|screening|glucose|vital|seizure|diabet|concuss|physicals?(_|$)|injur|ouch|lice|contagious|quarantine|insurance|feeding|g_?tube|diaper|personal_?care|nap(_|$)|sleep|sensory|athletic_?trainer|controlled|clinic|wellness")],
  ["Special education & support", word("iep|504|sped|special_?(ed|education|needs)|related_?services|mtss|rti(_|$)|intervention|progress_?monitor|fba|bip|manifestation|esy(_|$)|reevaluation|referral|assistive|testing_?accommodation|para(professional)?|1_?to_?1|gifted|talented|caseload|dyslex|goal_?progress|ell(_|$)|esl|english_?learner")],
  ["Behavior & counseling", word("disciplin|behavior|incident|detention|suspen|expul|pbis|reward|infraction|minor_?classroom|conduct|counsel|social_?work|restorative|mediation|peer_?mediation|bully|threat|title_?ix|sro(_|$)|tip_?line|crisis|risk|safety|dress_?code|confiscat|hall_?pass|academic_?integrity|sel(_|$)|mood")],
  ["Attendance", word("attendance|absen|tard|truanc|sarb|chronic|homebound|hospital|early_?dismissal|sign_?outs?|check_?ins?|perfect")],
  ["Academics", word("grades?|transcript|gpa|rank|honor|course|class|section|schedule|gradebook|scores?|test|exam|assessment|standard|report_?card|comment|credit|graduat|diploma|requirement|reading|lexile|tutor|study|lab(_|$)|lab_?group|dual|cte|career|college|ncaa|naia|portfolio|seating|curriculum|ap(_|$)|ib(_|$)|incomplete|recovery")],
  ["Meals & fees", word("fr_?application|free_?reduced|meal|lunch|breakfast|cafeteria|food|nutrition|dietary|fees?(_|$)|payment|tuition|invoice|billing|balance|fundrais|donation|dues|store|vending|ticket|financial|collections")],
  ["Family & contacts", word("parent|guardian|family|household|sibling|contact|emergency|pickup|custody|legal|order|consent|release|communicat|language|interpreter|portal|volunteer|home_?visit|outreach|host|homestay|registration|application|enrollment|admission|lottery|waitlist|transfer|withdraw|residen|address|entry")],
  ["Transportation", word("bus|route|stop|transport|driver|rider|vehicle|parking|walk_?zone|crossing")],
  ["Activities & athletics", word("activit|athletic|sport|team|club|practice|game|tryout|eligib|uniform|equipment|music|band(_|$)|art(_|$)|arts|theat|perform|yearbook|newspaper|election|service_?hours|community_?service|field_?trip|summer|camp|ffa|work_?permit|work_?based|internship")],
  ["Library & devices", word("librar|books?(_|$)|textbook|circulation|device|chromebook|laptop|ipad|technology|asset|locker|keys?(_|$)|makerspace|print|login|lms|app_?usage")],
];
function topicOf(label) {
  const name = lists.baseName(label) || String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const hit = TOPICS.find(([, rule]) => rule.test(name));
  return hit ? hit[0] : "Other records";
}
const TOPIC_ORDER = [...TOPICS.map(([topic]) => topic), "Other records"];

// The Custom editor's icon for a list.
const ICONS = [[word("health|nurse|medic|clinic|immuni|screening"), "health"], [word("allerg|medication"), "medicine"], [word("librar|books?(_|$)|reading"), "book"], [word("locker|keys?(_|$)"), "key"],
  [word("service|volunteer"), "heart"], [word("bus|transport|route"), "bus"], [word("meal|lunch|cafeteria|food"), "lunch"], [word("disciplin|behavior|detention|pbis|conduct"), "behaviour"],
  [word("counsel|social_?work|mediation"), "chat"], [word("athletic|sport|team|practice|game"), "sports"], [word("music|band(_|$)|perform"), "music"], [word("art(_|$)|arts|yearbook"), "art"],
  [word("lab(_|$)|science|makerspace"), "science"], [word("device|chromebook|laptop|technology|asset"), "laptop"], [word("consent|permission|release"), "consent"], [word("visitor|pickup|dismissal"), "pickup"],
  [word("test|scores?|exam|assessment"), "star"], [word("award|honor|perfect"), "trophy"], [word("attendance|tard|absen|check_?in"), "calendar"], [word("fees?(_|$)|payment|fundrais|dues|balance"), "money"],
  [word("club|activit|election"), "groups"], [word("tutor|study|homework"), "pencil"], [word("college|career|graduat|diploma|transcript"), "cap"], [word("safety|threat|drill"), "shield"]];
const iconOf = (label) => { const name = lists.baseName(label); const hit = ICONS.find(([rule]) => rule.test(name)); return hit ? hit[1] : "clipboard"; };

// Columns that are only the student (their numbers, their name): the entry is already theirs.
const STUDENT_NAME = /^(studentname|lastfirst|firstlast|studentfullname|studentdisplayname|student)$/;
const onlyTheStudent = (column) => {
  const b = ps.bare(column);
  return ps.ALIAS_KEYS.includes(b) || ps.FAMILY_KEYS.includes(b) || STUDENT_NAME.test(b) || ps.sensitiveOf(column, []) === "ssn";
};

// Whether a kept list is suggested as a form the school keeps using, and why not when it isn't.
// `list`: what the import reported (utils/dataMigration.js runImport, report.lists).
function suggest(list) {
  if (!list.perStudent || !list.students) return { use: "history", why: "For the school" };
  // A parent's or a family's list is the same on each child: history on each, never a form.
  if (list.via && list.via !== "student") return { use: "history", why: "About the family: kept on each child", fixed: true };
  if (list.feature) return { use: "history", why: "Goes into a Managira feature" };
  if (list.details) return { use: "history", why: "Details on each student" };
  const header = list.header || [];
  if (MACHINE.test(lists.baseName(list.name || list.label)) || header.some((h) => MACHINE_COLUMNS.has(ps.bare(h)))) return { use: "history", why: "A log your old system kept by itself", fixed: true };
  if ((list.columns || header.length) > MAX_COLUMNS) return { use: "history", why: `More than ${MAX_COLUMNS} columns`, fixed: true };
  if (list.people && list.students / list.people > MAX_PER_STUDENT) return { use: "history", why: "A log: many rows for each student", fixed: true };
  if (list.restricted) return { use: "history", why: "Restricted: only for your managers unless you keep using it", restricted: true };
  return { use: "form", why: "Kept by hand: your staff can keep using it" };
}
// Lists that may be offered as a form at all (the school can tick or untick them).
const offered = (list) => { const s = suggest(list); return Boolean(list.perStudent && list.students > 0 && !list.feature && !list.details && !s.fixed); };
// Columns a form never shows (codes, PINs, ID numbers): kept, restricted, with the read-only copy.
const SECRET = new Set(["secret", "ssn", "identity"]);
// Columns that make a form protected (only the people who build forms open it).
const PRIVATE = new Set(["medical", "sped", "discipline", "custody", "demographics", "programs"]);
// The school's choice, else the suggestion.
function useOf(job, list) {
  const chosen = ((job && job.options) || {}).lists || {};
  if (!offered(list)) return "history";
  return chosen[list.label] === "form" || chosen[list.label] === "history" ? chosen[list.label] : suggest(list).use;
}

// The type a column's values have, read from every value (so every old row fits its field).
function typeOf(values, isoDate) {
  const v = values.map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  if (!v.length) return "text";
  if (v.every((x) => { const d = isoDate(x); return d && d !== "invalid"; })) return "date";
  if (v.every((x) => /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?(\s?[ap]\.?m\.?)?$/i.test(x))) return "time";
  if (v.every((x) => /^(y|n|yes|no|true|false)$/i.test(x))) return "yesno";
  if (v.every((x) => /^-?\$?\d{1,9}(,\d{3})*(\.\d+)?$/.test(x)) && !v.some((x) => /^0\d/.test(x))) return "number";
  const distinct = [...new Set(v)];
  if (distinct.length <= 8 && v.length >= 12 && distinct.every((x) => x.length <= 40)) return "choice";
  if (v.some((x) => x.length > 120 || /\n/.test(x))) return "textarea";
  return "text";
}
function valueAs(type, raw, isoDate) {
  const v = String(raw == null ? "" : raw).trim();
  if (!v) return undefined;
  switch (type) {
    case "date": { const d = isoDate(v); return d && d !== "invalid" ? d : undefined; }
    case "time": {
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?/i.exec(v);
      if (!m) return undefined;
      let h = Number(m[1]);
      if (m[3]) { const pm = /p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
      return `${String(h).padStart(2, "0")}:${m[2]}`;
    }
    case "yesno": return /^(y|yes|true)$/i.test(v);
    case "number": { const n = Number(v.replace(/[$,]/g, "")); return Number.isFinite(n) ? n : undefined; }
    case "textarea": return v.slice(0, 10000);
    default: return v.slice(0, 2000);
  }
}
const prettyLabel = (column) => String(column).replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 200);

// A section for a list and the columns its fields come from: the student's own columns left out,
// each field typed by its values, at most MAX_COLUMNS. The first date says when each entry was.
function sectionFor(list, rows, { isoDate, normalizeSection, today = new Date().toISOString().slice(0, 10) }) {
  const columns = [];
  for (const row of rows) for (const column of Object.keys(row || {})) if (!columns.includes(column)) columns.push(column);
  const sample = (column) => rows.slice(0, 50).map((r) => r[column]).filter((v) => v !== undefined && v !== null && v !== "");
  const kind = new Map(columns.map((column) => [column, ps.sensitiveOf(column, sample(column))]));
  const secret = columns.filter((column) => SECRET.has(kind.get(column)));
  const used = columns.filter((column) => column !== list.keyColumn && !onlyTheStudent(column) && !SECRET.has(kind.get(column))).slice(0, MAX_COLUMNS);
  const types = used.map((column) => typeOf(rows.map((r) => r[column]), isoDate));
  const raw = {
    name: list.label, icon: iconOf(list.name || list.label), multiple: true, filledBy: "staff", status: "live", classIds: [],
    protected: Boolean(list.restricted) || used.some((column) => PRIVATE.has(kind.get(column))),
    notes: `From your old system: ${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "row" : "rows"}, brought over on ${today}. Your staff can keep adding to it here.`,
    fields: used.map((column, i) => ({
      type: types[i], label: prettyLabel(column), width: types[i] === "textarea" ? "full" : "half",
      ...(types[i] === "choice" ? { options: [...new Set(rows.map((r) => String(r[column] == null ? "" : r[column]).trim()).filter(Boolean))], display: "dropdown" } : {}),
    })),
  };
  const section = normalizeSection(raw);
  const columnOf = Object.fromEntries(section.fields.map((field, i) => [field.id, used[i]]));
  section.origin = { kind: "old_system", list: list.label, columns: columnOf };
  const dateField = section.fields.find((field, i) => field.type === "date" && /date|day|when|visit|issued|checked|out|in$|start|on$/i.test(used[i])) || section.fields.find((field) => field.type === "date");
  // `secret`: columns left out of the form (their values stay in the restricted read-only copy).
  return { section, dateField: dateField ? dateField.id : null, secret };
}
// An old row as an entry of its section (by the column each field came from).
function entryFor(section, row, isoDate) {
  const columns = (section.origin && section.origin.columns) || {};
  const data = {};
  for (const field of section.fields || []) {
    const column = columns[field.id];
    if (!column || field.retired) continue;
    let value = valueAs(field.type === "choice" ? "text" : field.type, row[column], isoDate);
    if (value === undefined) continue;
    if (field.type === "choice" && !(field.options || []).includes(value)) continue;
    data[field.id] = value;
  }
  return data;
}
// What makes an old row the same row on a later load: its student and content, and which time
// that same content appears for them.
const rowKey = (student, row, nth) => crypto.createHash("sha1").update(`${student}|${JSON.stringify(row)}|${nth}`).digest("hex").slice(0, 24);

module.exports = { MAX_FORMS, MAX_COLUMNS, SOURCE_NAME, TOPIC_ORDER, topicOf, iconOf, suggest, offered, useOf, typeOf, valueAs, sectionFor, entryFor, rowKey, onlyTheStudent };
