"use strict";

// State reporting files (feature `state_reporting`, permission State filing, under Report Builder). A saved Report
// Builder report becomes the file a state asks for: comma-, tab- or pipe-separated, or fixed
// width, with the state's own field names, widths, date style and codes. US states publish their
// own layouts (no national standard): fixed-width and CSV text are the norm, with CCYYMMDD dates,
// text padded on the right with spaces, numbers padded on the left with zeros, CRLF line ends and
// plain ASCII. Everything here is pure, so it's tested without a database
// (tests/stateFile.test.js); controllers/stateReportingController.js reads and stores.
const zlib = require("zlib");
const crypto = require("crypto");

const LAYOUTS = ["comma", "tab", "pipe", "fixed"];
const DELIMITERS = { comma: ",", tab: "\t", pipe: "|" };
const DATE_FORMATS = ["YYYYMMDD", "YYYY-MM-DD", "MM/DD/YYYY", "MMDDYYYY", "MM-DD-YYYY"];
const LINE_ENDINGS = { crlf: "\r\n", lf: "\n" };
const EXTENSIONS = ["csv", "txt", "dat"];
const MAX_WIDTH = 500;
const MAX_TRANSLATIONS = 300;
const MAX_DATES = 12;
const KEEP_DAYS = 365; // a made file's content; its record (who, when, rows, fingerprint) stays

// Ready-made translations a school can start from (each still editable).
const PRESETS = {
  sex_mfx: { label: "Sex: M / F / X", map: { Male: "M", M: "M", Female: "F", F: "F", "Non-binary": "X", Nonbinary: "X", X: "X" } },
  yes_no_yn: { label: "Yes / No as Y / N", map: { Yes: "Y", No: "N", True: "Y", False: "N" } },
  yes_no_10: { label: "Yes / No as 1 / 0", map: { Yes: "1", No: "0", True: "1", False: "0" } },
  grade_federal: { label: "Grade: PK, KG, 01-12 (federal codes)", grade: true },
};

const clean = (value, max = 200) => String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const intIn = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const isoDay = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? String(value) : null);

// A school's class names (or any grade wording) as federal grade codes: PK, KG, 01-12.
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
function gradeCode(value) {
  const t = clean(value, 80).toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(pk|p k|pre-?k|prek|pre-?kindergarten|pk3|pk4|p3|p4|pre-?school|preschool|nursery)$/.test(t)) return "PK";
  if (/^(k|kg|kn|kinder|kindergarten|kindergarden|tk|transitional (k|kindergarten))$/.test(t)) return "KG";
  let m = /^(?:grade |gr |year )?0*(\d{1,2})(?:st|nd|rd|th)?(?: grade| gr)?$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return String(Number(m[1])).padStart(2, "0");
  m = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)(?: grade)?$/.exec(t);
  if (m) return String(ORDINALS.indexOf(m[1]) + 1).padStart(2, "0");
  return null;
}

// The settings a school saved, cleaned and limited to the report's own columns.
function normalizeSettings(raw, columnKeys = []) {
  const input = raw && typeof raw === "object" ? raw : {};
  const layout = LAYOUTS.includes(input.layout) ? input.layout : "comma";
  const columnsIn = input.columns && typeof input.columns === "object" ? input.columns : {};
  const columns = {};
  columnKeys.forEach((key) => {
    const c = columnsIn[key] && typeof columnsIn[key] === "object" ? columnsIn[key] : {};
    const translations = {};
    if (c.translations && typeof c.translations === "object") {
      Object.entries(c.translations).slice(0, MAX_TRANSLATIONS).forEach(([from, to]) => {
        const source = clean(from, 120);
        if (source) translations[source] = clean(to, 120);
      });
    }
    columns[key] = {
      name: clean(c.name, 80),
      width: intIn(c.width, 1, MAX_WIDTH, null),
      // "auto": numbers padded with zeros on the left, text with spaces on the right.
      pad: ["zeros", "spaces"].includes(c.pad) ? c.pad : "auto",
      required: c.required === true,
      preset: Object.prototype.hasOwnProperty.call(PRESETS, c.preset) ? c.preset : "",
      translations,
      onlyListed: c.onlyListed === true,
      fixed: clean(c.fixed, 120),
    };
  });
  const dates = [...new Set((Array.isArray(input.dates) ? input.dates : []).map(isoDay).filter(Boolean))].sort().slice(0, MAX_DATES);
  return {
    layout,
    header: layout === "fixed" ? input.header === true : input.header !== false,
    quote: ["needed", "always"].includes(input.quote) ? input.quote : "needed",
    dateFormat: DATE_FORMATS.includes(input.dateFormat) ? input.dateFormat : "YYYYMMDD",
    lineEnding: input.lineEnding === "lf" ? "lf" : "crlf",
    ascii: input.ascii !== false,
    upper: input.upper === true,
    extension: EXTENSIONS.includes(input.extension) ? input.extension : (layout === "comma" ? "csv" : "txt"),
    fileName: clean(input.fileName, 120).replace(/[^A-Za-z0-9 _{}.\-]/g, "") || "{report}_{date}",
    columns,
    dates,
    // Besides the count dates, a file can be made on a repeating schedule: every weekday (some
    // states take attendance daily), one day a week, or one date a month.
    repeat: ["weekdays", "weekly", "monthly"].includes(input.repeat) ? input.repeat : "none",
    weekday: intIn(input.weekday, 0, 6, 1),
    monthDay: intIn(input.monthDay, 1, 31, 1),
    sendHour: intIn(input.sendHour, 0, 23, 6),
  };
}

// Whether a file is due today: `local` is { isoDate, hour, weekday, day, daysInMonth } in the
// school's time. Count dates and the repeating schedule both count; each day is made once.
function dueToday(settings, local) {
  if (local.hour < settings.sendHour) return false;
  if (settings.dates.includes(local.isoDate)) return true;
  if (settings.repeat === "weekdays") return local.weekday >= 1 && local.weekday <= 5;
  if (settings.repeat === "weekly") return local.weekday === settings.weekday;
  if (settings.repeat === "monthly") return local.day === Math.min(settings.monthDay, local.daysInMonth);
  return false;
}

const pad2 = (n) => String(n).padStart(2, "0");
function formatDate(value, format) {
  let y; let m; let d;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    y = value.getUTCFullYear(); m = value.getUTCMonth() + 1; d = value.getUTCDate();
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!match) return String(value == null ? "" : value);
    [, y, m, d] = match.map(Number);
  }
  const map = { YYYY: String(y), MM: pad2(m), DD: pad2(d) };
  return format.replace(/YYYY|MM|DD/g, (part) => map[part]);
}

// Plain ASCII, as most state systems read it: accents dropped (José -> Jose), anything else that
// can't be shown becomes "?" so the problem is visible in the file and in the check.
function toAscii(text) {
  return String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "?");
}

// One value as the state wants it, and what's wrong with it (if anything).
function formatValue(raw, column, type, settings) {
  const spec = settings.columns[column] || {};
  if (spec.fixed) return { text: spec.fixed, issue: null };
  let value = raw;
  if (value instanceof Date || (type && /date/.test(type) && value)) value = formatDate(value, settings.dateFormat);
  // Tabs and line breaks inside a value become spaces: a state's flat file holds one record a line.
  let text = value === null || value === undefined ? "" : String(value).replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (type === "number" || type === "money") text = text.trim();
  let issue = null;
  if (text !== "") {
    const translated = translate(text, spec);
    if (translated === undefined) issue = { kind: "untranslated", value: text };
    else text = translated;
  }
  if (settings.ascii) text = toAscii(text);
  if (settings.upper) text = text.toUpperCase();
  if (!text && spec.required) issue = { kind: "missing" };
  if (settings.layout === "fixed" && spec.width && text.length > spec.width) issue = { kind: "too_long", value: text, width: spec.width };
  return { text, issue };
}

// undefined: the value has no translation and the column takes only listed values.
function translate(text, spec) {
  const key = Object.keys(spec.translations || {}).find((from) => from.toLowerCase() === text.toLowerCase());
  if (key !== undefined) return spec.translations[key];
  const preset = spec.preset ? PRESETS[spec.preset] : null;
  if (preset && preset.grade) {
    const code = gradeCode(text);
    if (code) return code;
  } else if (preset && preset.map) {
    const hit = Object.keys(preset.map).find((from) => from.toLowerCase() === text.toLowerCase());
    if (hit !== undefined) return preset.map[hit];
  }
  return spec.onlyListed || (preset && preset.grade) ? undefined : text;
}

function delimitedCell(text, settings) {
  const delimiter = DELIMITERS[settings.layout];
  // A formula-looking value can't run in a spreadsheet someone opens the file with.
  const safe = settings.layout === "comma" && /^[\s]*[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  const needs = safe.includes(delimiter) || /["\r\n]/.test(safe);
  if (settings.quote === "always" || needs) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function fixedCell(text, spec, type) {
  const width = spec.width || text.length;
  const cut = text.slice(0, width);
  const zeros = spec.pad === "zeros" || (spec.pad === "auto" && (type === "number" || type === "money"));
  return zeros ? cut.padStart(width, "0") : cut.padEnd(width, " ");
}

// The file: { content (Buffer), text, rows, problems, summary }. `report.columns[key]` gives
// each column's label and type; `columns` is the report's order.
function build(rows, columns, report, rawSettings) {
  const settings = normalizeSettings(rawSettings, columns);
  const eol = LINE_ENDINGS[settings.lineEnding];
  const headerName = (key) => settings.columns[key].name || report.columns[key].label;
  const problems = [];
  const counts = new Map();
  const note = (row, key, issue) => {
    const label = headerName(key);
    const id = `${key}:${issue.kind}`;
    const entry = counts.get(id) || { column: label, kind: issue.kind, rows: 0, examples: [], width: issue.width || null };
    entry.rows += 1;
    if (issue.value !== undefined && entry.examples.length < 5 && !entry.examples.includes(issue.value)) entry.examples.push(issue.value);
    if (entry.firstRow === undefined) entry.firstRow = row + 1;
    counts.set(id, entry);
  };
  const missingWidth = settings.layout === "fixed" ? columns.filter((key) => !settings.columns[key].width) : [];
  missingWidth.forEach((key) => problems.push({ column: headerName(key), kind: "no_width", rows: 0, examples: [] }));
  const lines = [];
  if (settings.header) {
    lines.push(columns.map((key) => {
      const name = settings.ascii ? toAscii(headerName(key)) : headerName(key);
      return settings.layout === "fixed" ? fixedCell(name, settings.columns[key], "text") : delimitedCell(name, settings);
    }).join(settings.layout === "fixed" ? "" : DELIMITERS[settings.layout]));
  }
  // The first rows as a table (each field as it will be written), for people to read before sending.
  const sample = { header: columns.map(headerName), rows: [] };
  rows.forEach((row, index) => {
    const values = [];
    const cells = columns.map((key) => {
      const type = report.columns[key].type;
      const { text, issue } = formatValue(row[key], key, type, settings);
      if (issue) note(index, key, issue);
      values.push(text);
      return settings.layout === "fixed" ? fixedCell(text, settings.columns[key], type) : delimitedCell(text, settings);
    });
    if (sample.rows.length < 5) sample.rows.push(values);
    lines.push(cells.join(settings.layout === "fixed" ? "" : DELIMITERS[settings.layout]));
  });
  problems.push(...counts.values());
  const text = lines.join(eol) + (lines.length ? eol : "");
  const content = Buffer.from(text, settings.ascii ? "latin1" : "utf8");
  return {
    content,
    rows: rows.length,
    problems,
    settings,
    sample,
    contentType: settings.layout === "comma" ? "text/csv; charset=us-ascii" : "text/plain; charset=us-ascii",
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

// What a problem means, in words for the person fixing it.
function describe(problem) {
  const rows = `${problem.rows} ${problem.rows === 1 ? "row" : "rows"}`;
  if (problem.kind === "missing") return `${problem.column}: empty in ${rows}, and the state requires it.`;
  if (problem.kind === "too_long") return `${problem.column}: longer than ${problem.width} characters in ${rows} (for example "${problem.examples[0] || ""}"). It would be cut, so shorten it or widen the field.`;
  if (problem.kind === "untranslated") return `${problem.column}: ${rows} have a value with no state code (${problem.examples.map((e) => `"${e}"`).join(", ")}). Add a translation.`;
  if (problem.kind === "no_width") return `${problem.column}: give it a width (fixed-width files need one for every field).`;
  return `${problem.column}: check this field.`;
}

function fileNameFor(pattern, { report, school, day }) {
  const safe = (value) => clean(value, 60).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return (pattern || "{report}_{date}")
    .replace(/\{report\}/g, safe(report) || "report")
    .replace(/\{school\}/g, safe(school) || "school")
    .replace(/\{date\}/g, String(day || "").replace(/-/g, ""))
    .replace(/[^A-Za-z0-9_.\-]/g, "_")
    .slice(0, 100);
}

// A made file is kept locked: gzipped, then AES-256-GCM with the server's settings key
// (utils/encryption.js). Nothing is stored unless the key is set.
function lock(buffer) {
  const { encryptSecret, isSettingsEncryptionKeyConfigured } = require("./encryption");
  if (!isSettingsEncryptionKeyConfigured()) throw Object.assign(new Error("This server can't store files safely yet (SETTINGS_ENCRYPTION_KEY isn't set). Contact Managira support."), { status: 503 });
  return encryptSecret(zlib.gzipSync(buffer).toString("base64"));
}
function unlock(text) {
  const { decryptSecretOrThrow } = require("./encryption");
  return zlib.gunzipSync(Buffer.from(decryptSecretOrThrow(text), "base64"));
}

module.exports = {
  LAYOUTS, DATE_FORMATS, EXTENSIONS, PRESETS, MAX_DATES, KEEP_DAYS,
  normalizeSettings, dueToday, formatValue, formatDate, toAscii, gradeCode, build, describe, fileNameFor, lock, unlock,
};
