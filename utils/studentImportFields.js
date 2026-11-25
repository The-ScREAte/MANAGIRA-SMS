// Custom student fields in a student import (Add student > Import).
//
// Pure helpers, no database and no HTTP: matching file columns to the school's
// own student fields (Admissions > Admission Settings), reading each cell into
// a value the Add student form accepts, and building the download template.
// Anything that cannot be understood is returned as an "issue" (never thrown,
// never silently dropped) so the import screen can show it.

const FIELD_LIMITS = { text: 500, long_text: 4000 };
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‍⁠﻿]/g;

const pad = (n) => String(n).padStart(2, "0");

function numToString(n) {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? String(n) : BigInt(n).toString();
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

// A spreadsheet cell can hold rich text, a formula, a hyperlink or an error.
// Returns the plain value (string, number, boolean, Date or null).
function unwrap(v, depth = 0) {
  if (v == null) return null;
  if (depth > 4) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (t === "bigint") return String(v);
  if (Array.isArray(v)) return v.map((x) => cellText(x)).join(" ");
  if (t === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => (r && r.text != null ? String(r.text) : "")).join("");
    if ("error" in v && !("result" in v)) return null;
    if ("result" in v) return unwrap(v.result, depth + 1);
    if ("formula" in v || "sharedFormula" in v) return null;
    if ("text" in v) return unwrap(v.text, depth + 1);
    if ("hyperlink" in v) return String(v.hyperlink || "").replace(/^mailto:/i, "");
    if ("value" in v) return unwrap(v.value, depth + 1);
    return null;
  }
  return null;
}

// Any cell as a clean string. Never "[object Object]".
function cellText(v) {
  const p = unwrap(v);
  if (p == null) return "";
  if (p instanceof Date) return `${p.getUTCFullYear()}-${pad(p.getUTCMonth() + 1)}-${pad(p.getUTCDate())}`;
  if (typeof p === "number") return numToString(p);
  if (typeof p === "boolean") return p ? "true" : "false";
  return String(p).replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
}

// Case, spacing, punctuation, accents, a trailing "*" and "(required)" don't matter.
function normKey(v) {
  const raw = cellText(v);
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/\(\s*(required|optional|mandatory)\s*\)/g, " ").replace(/[*＊]/g, " ");
  s = s.replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, "");
  return s || raw.toLowerCase().replace(/\s+/g, " ");
}

// ---------- Columns ----------

function buildFieldIndex(fields) {
  const byKey = new Map();
  (fields || []).forEach((f) => {
    if (!f || f.status === "obsolete" || f.onStudentForm === false) return;
    const k = normKey(f.label);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  });
  return byKey;
}

// headers: header cells. reserved: column numbers the standard student columns
// own (they win). Returns { columns, unmatched, ambiguous }.
function mapCustomColumns(headers, fields, reserved) {
  const byKey = buildFieldIndex(fields);
  const taken = new Map();
  const columns = [];
  const unmatched = [];
  const skip = reserved instanceof Set ? reserved : new Set(reserved || []);
  (headers || []).forEach((h, index) => {
    const text = cellText(h);
    if (!text || skip.has(index)) return;
    const k = normKey(text);
    const list = byKey.get(k);
    if (!list) { unmatched.push({ index, header: text.slice(0, 60) }); return; }
    const n = taken.get(k) || 0;
    if (n >= list.length) { unmatched.push({ index, header: text.slice(0, 60), reason: "duplicate" }); return; }
    columns.push({ index, field: list[n], header: text.slice(0, 60) });
    taken.set(k, n + 1);
  });
  const ambiguous = [];
  byKey.forEach((list, k) => { if (list.length > 1 && (taken.get(k) || 0) < list.length) ambiguous.push(...list.slice(taken.get(k) || 0).map((f) => f.label)); });
  return { columns, unmatched, ambiguous };
}

// ---------- Values ----------

const ASCII_DIGITS = (s) => s
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
  .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));

function parseNumber(raw) {
  const p = unwrap(raw);
  if (p == null || p === "") return { value: "" };
  if (typeof p === "number") return Number.isFinite(p) ? { value: numToString(p) } : { value: "", issue: "number" };
  if (typeof p === "boolean" || p instanceof Date) return { value: "", issue: "number" };
  let s = ASCII_DIGITS(String(p)).replace(/[−–]/g, "-").replace(/[\s   ']/g, "").replace(/^\+/, "");
  if (!s) return { value: "" };
  if (s.length > 40) return { value: "", issue: "number" };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (/^-?\.\d+$/.test(s)) s = s.replace(".", "0.");
  else if (/^-?\d+\.$/.test(s)) s = s.slice(0, -1);
  else if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && Math.abs(n) < 1e15 ? { value: numToString(n) } : { value: "", issue: "number" };
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? { value: s } : { value: "", issue: "number" };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
}

const SLASH_DATE = /^(\d{1,2})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{4})$/;

// order is "mdy" or "dmy": which way an ambiguous 05/06/2012 reads. The
// date-of-birth import reads it month first, so that is the default.
function parseDate(raw, order = "mdy") {
  const p = unwrap(raw);
  if (p == null || p === "") return { value: "" };
  if (p instanceof Date) {
    const v = ymd(p.getUTCFullYear(), p.getUTCMonth() + 1, p.getUTCDate());
    return v ? { value: v } : { value: "", issue: "date" };
  }
  if (typeof p === "boolean") return { value: "", issue: "date" };
  const s = ASCII_DIGITS(String(p)).trim();
  if (!s) return { value: "" };
  let n = null;
  if (typeof p === "number") n = p;
  else if (/^\d{5}(\.\d+)?$/.test(s)) n = Number(s);
  if (n != null) {
    if (n >= 10000 && n <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      const v = ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      if (v) return { value: v };
    }
    return { value: "", issue: "date" };
  }
  let m = s.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:$|[T\s].*)/);
  let v = m ? ymd(m[1], m[2], m[3]) : "";
  if (!v && (m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) v = ymd(m[1], m[2], m[3]);
  if (!v && (m = s.match(SLASH_DATE))) {
    const a = Number(m[1]); const b = Number(m[2]);
    let day; let mon;
    if (a > 12) { day = a; mon = b; } else if (b > 12) { day = b; mon = a; } else if (order === "dmy") { day = a; mon = b; } else { day = b; mon = a; }
    v = ymd(m[3], mon, day);
  }
  if (!v && (m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{4})$/)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) v = ymd(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  if (!v && (m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) v = ymd(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  return v ? { value: v } : { value: "", issue: "date" };
}

// A column of 31/12/2012 and 05/06/2012 is day-first; 12/31/2012 month-first.
function inferDateOrder(values) {
  let dmy = 0; let mdy = 0;
  (values || []).forEach((raw) => {
    const p = unwrap(raw);
    if (typeof p !== "string") return;
    const m = ASCII_DIGITS(p).trim().match(SLASH_DATE);
    if (!m) return;
    if (Number(m[1]) > 12 && Number(m[2]) <= 12) dmy += 1;
    else if (Number(m[2]) > 12 && Number(m[1]) <= 12) mdy += 1;
  });
  return dmy > mdy ? "dmy" : "mdy";
}

const YES = new Set(["yes", "y", "true", "t", "1", "on", "✓", "✔", "ye", "yeah", "yep"]);
const NO = new Set(["no", "n", "false", "f", "0", "off", "✗", "✘", "nope"]);

function parseYesNo(raw) {
  const p = unwrap(raw);
  if (p == null || p === "") return { value: "" };
  if (typeof p === "boolean") return { value: p ? "yes" : "no" };
  const s = ASCII_DIGITS(String(p)).trim().toLowerCase().replace(/[.!]+$/, "");
  if (!s) return { value: "" };
  if (YES.has(s)) return { value: "yes" };
  if (NO.has(s)) return { value: "no" };
  return { value: "", issue: "yes/no" };
}

function parseChoice(field, raw) {
  const text = cellText(raw).replace(/\s+/g, " ");
  if (!text) return { value: "" };
  const options = field.options || [];
  const lower = text.toLowerCase();
  let hit = options.find((o) => o.toLowerCase() === lower);
  if (!hit) { const k = normKey(text); hit = options.find((o) => normKey(o) === k); }
  return hit ? { value: hit } : { value: text.slice(0, FIELD_LIMITS.text), issue: "choice" };
}

function parseText(field, raw) {
  const long = field.type === "long_text";
  let text = cellText(raw);
  if (!text) return { value: "" };
  if (!long) text = text.replace(/\s+/g, " ");
  else text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const max = long ? FIELD_LIMITS.long_text : FIELD_LIMITS.text;
  return text.length > max ? { value: text.slice(0, max).trim(), issue: "long" } : { value: text };
}

// One cell into a value the Add student form takes. { value, issue? }.
// A cell that doesn't fit gives { value: "" or the kept text, issue }.
function coerceValue(field, raw, ctx = {}) {
  try {
    switch (field.type) {
      case "number": return parseNumber(raw);
      case "date": return parseDate(raw, ctx.order);
      case "yes_no": return parseYesNo(raw);
      case "choice": return parseChoice(field, raw);
      default: return parseText(field, raw);
    }
  } catch (_) {
    return { value: "", issue: "unreadable" };
  }
}

// Reads one row. columns come from mapCustomColumns (with .order on date columns).
function extractCustom(row, columns) {
  const custom = {};
  const issues = [];
  (columns || []).forEach((c) => {
    const raw = Array.isArray(row) ? row[c.index] : undefined;
    const r = coerceValue(c.field, raw, { order: c.order });
    if (r.value !== "") custom[c.field.id] = r.value;
    if (r.issue) issues.push({ fieldId: c.field.id, label: c.field.label, reason: r.issue, raw: cellText(raw).replace(/\s+/g, " ").slice(0, 30) });
  });
  return { custom, issues };
}

// Decide how 05/06/2012 reads for each date column from the rows themselves.
function prepareColumns(columns, rows) {
  (columns || []).forEach((c) => {
    if (c.field.type !== "date") return;
    c.order = inferDateOrder((rows || []).map((r) => (Array.isArray(r) ? r[c.index] : undefined)));
  });
  return columns;
}

// "Blood group: O+" in a Word / PDF / image text. { field, text } or null.
function matchLabeledLine(line, fields, index) {
  const m = String(line || "").match(/^\s*([^:：=]{1,80}?)\s*[:：]\s*(.+)$/);
  if (!m) return null;
  const list = (index || buildFieldIndex(fields)).get(normKey(m[1]));
  return list && list.length ? { field: list[0], text: m[2] } : null;
}

// ---------- CSV ----------

function decodeText(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer || "");
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.slice(2).toString("utf16le");
  const text = buffer.toString("utf8");
  if (text.includes("�")) return buffer.toString("latin1").replace(/^﻿/, "");
  return text.replace(/^﻿/, "");
}

function detectDelimiter(text) {
  const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  let inQuotes = false; let lines = 0;
  for (let i = 0; i < text.length && lines < 30; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === "\n") lines += 1;
      else if (c in counts) counts[c] += 1;
    }
  }
  let best = ","; let max = 0;
  Object.keys(counts).forEach((d) => { if (counts[d] > max) { max = counts[d]; best = d; } });
  return best;
}

// Quote-aware CSV: embedded commas and newlines, "" escapes, CRLF, BOM, ; and tab.
function parseCsv(input) {
  const text = decodeText(input);
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = []; let cell = ""; let inQuotes = false; let any = false;
  const endCell = () => { row.push(cell.trim()); cell = ""; };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = []; any = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === "") { inQuotes = true; cell = ""; any = true; }
    else if (c === delimiter) { endCell(); any = true; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; endRow(); }
    else { cell += c; any = true; }
  }
  if (any || cell !== "" || row.length) endRow();
  return rows.map((r) => r.map((c) => c.replace(CONTROL_CHARS, "")));
}

// A cell starting with = + - @ is read as a formula by Excel. Keep it as text.
function csvSafe(value) {
  if (typeof value !== "string") return value == null ? "" : value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function toCsv(rows, delimiter = ",") {
  const esc = (v) => {
    const s = String(csvSafe(v));
    return /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(delimiter)).join("\r\n") + "\r\n";
}

// ---------- Template ----------

const STANDARD_HEADERS = [
  "First Name", "Last Name", "Date of Birth", "Gender", "Class", "Hometown", "Student Address", "Student Email",
  "Graduation Year Group", "Subjects", "Guardian 1 First Name", "Guardian 1 Last Name", "Guardian 1 Phone",
  "Guardian 1 Email", "Guardian 1 Address", "Guardian 1 Hometown",
];

function sampleFor(field) {
  switch (field.type) {
    case "number": return 12;
    case "date": return "2012-05-15";
    case "yes_no": return "Yes";
    case "choice": return (field.options && field.options[0]) || "";
    case "long_text": return "A short note";
    default: return "Example";
  }
}

// { headers, sample, customStart } for the download: every standard column,
// then one column per active custom field that is on the Add student form.
function templateModel(fields, { sampleClass = "" } = {}) {
  const active = (fields || []).filter((f) => f && f.status !== "obsolete" && f.onStudentForm !== false);
  const sample = ["Ama", "Mensah", "2012-05-15", "Female", sampleClass || "", "Salt Lake City", "1746 W 400 N", "ama.mensah@example.com", "", "", "Kwame", "Mensah", "0241234567", "kwame.mensah@example.com", "", ""];
  return {
    headers: [...STANDARD_HEADERS, ...active.map((f) => `${f.label}${f.required ? " *" : ""}`)],
    sample: [...sample, ...active.map(sampleFor)],
    customStart: STANDARD_HEADERS.length,
    fields: active,
  };
}

module.exports = {
  cellText, unwrap, normKey, buildFieldIndex, mapCustomColumns, parseNumber, parseDate, parseYesNo, parseChoice, parseText,
  coerceValue, extractCustom, prepareColumns, inferDateOrder, matchLabeledLine, parseCsv, decodeText, csvSafe, toCsv,
  templateModel, STANDARD_HEADERS, FIELD_LIMITS,
};
