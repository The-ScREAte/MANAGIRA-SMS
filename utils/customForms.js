"use strict";
// The Custom editor (feature custom_forms). A school designs a section of fields about its
// students, says where it lives (the classroom, the parent, student or driver portal), for which
// classes, and how often it's collected: once, every term, every school year, or many times (a
// log). A section collected once per student can lock when it's sent. Fields are stored with the
// section (custom_sections, extra choices in `options`); answers are custom_section_entries, each
// tagged with the term and school year it was given in.
//
// Answers are read in the editor (Answers: download, remind), on the classroom Forms tab, on
// report cards (`reportCardSections`) and in Report Builder (Students, Custom forms).
//
// Two things happen on their own, with nothing to set up: when a parent, student or driver sends
// a form, the class's main teacher hears of it; and families who haven't filled in a required
// form hear once, two days before its deadline (custom_section_runs keeps it to once).
//
// A school's sections are cached for a few seconds (BoundedMap, dropped on every save), and every
// list is read in one statement however many sections or students there are.
//
// The pure parts (normalizing a section or an entry, deciding which fields show) are exported for
// the tests and the pages; the browser renderer (public/js/customFormRender.js) applies the same
// visibility rules.

const crypto = require("crypto");
const features = require("./shards/features");
const { BoundedMap } = require("./boundedMap");

// ── What a section can hold ──────────────────────────────────────────────────────────────
const FIELD_TYPES = {
  text: { label: "Text – single line" },
  textarea: { label: "Text – multiple lines" },
  number: { label: "Number" },
  date: { label: "Date" },
  time: { label: "Time" },
  yesno: { label: "Yes / No" },
  choice: { label: "Dropdown list", options: true },
  checklist: { label: "Checklist (pick several)", options: true },
  rating: { label: "Rating (1–5)" },
  email: { label: "Email" },
  phone: { label: "Phone" },
  url: { label: "Link" },
  file: { label: "File upload" },
  signature: { label: "Signature" },
  seat: { label: "Seat (seating chart)" },
  instructions: { label: "Instructions", input: false },
};
// Section icons (drawn by public/js/customFormRender.js), in the order the picker shows them.
const ICONS = ["form", "clipboard", "check", "survey", "star", "medal", "trophy", "flag", "calendar", "time", "bell", "megaphone",
  "health", "medicine", "thermometer", "bandage", "heart", "shield", "alert", "eye", "consent", "lock", "key", "pin",
  "lunch", "apple", "water", "seat", "groups", "meeting", "behaviour", "chat", "phone", "email",
  "book", "pencil", "cap", "laptop", "science", "art", "music", "sports", "globe", "sun",
  "bus", "pickup", "home", "camera", "shirt", "box", "ticket", "gift", "money"];
const OPS = ["is", "is_not", "contains", "filled", "empty", "more", "less"];
// Where a section lives: the classroom (staff), the parent, student or driver portal.
const FILLED_BY = ["staff", "parent", "student", "driver"];
const REPEATS = ["day", "week", "term", "year"];
// Fields answered with a tap. A section made only of these (a few, none shown on a condition)
// is "quick": its list carries each student's answer, so a class can be filled in on one screen
// (inline, as a seating chart, in groups, or as a column on the attendance page).
const QUICK_TYPES = new Set(["yesno", "choice", "rating", "seat"]);
const MAX_QUICK_FIELDS = 4;
const MAX_SEAT = 40;
// Icons an answer can show (a dropdown's choices shown as icons; Yes / No as a tick and a cross).
const ANSWER_ICONS = ["check", "close", "none", "lunch", "bag", "apple", "water", "home", "bus", "pickup", "star", "heart",
  "smile", "meh", "frown", "thumbsUp", "thumbsDown", "flag", "health", "medicine", "book", "pencil", "music", "sports", "art",
  "science", "groups", "sun", "time", "alert", "lock", "money"];
const MAX_SECTIONS = 200;
const MAX_FIELDS = 80;
const MAX_FILES = 5;

const text = (value, max) => String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max);
const intOr = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const newId = (prefix) => `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
const ID = /^f_[a-z0-9]{4,16}$/;

// "Severity of injury" -> "severityOfInjury": the field's name in {{tags}}.
function keyFrom(label) {
  // A name typed as one word keeps its capitals ("hasAllergies"); anything else is camel-cased.
  const raw = String(label || "").trim();
  if (/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(raw)) return raw[0].toLowerCase() + raw.slice(1);
  const words = String(label || "").normalize("NFKD").replace(/[^\w\s]/g, " ").trim().split(/[\s_]+/).filter(Boolean).slice(0, 6);
  const key = words.map((word, i) => (i ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase())).join("").replace(/^\d+/, "");
  return key.slice(0, 40) || "field";
}

// ── Sections ─────────────────────────────────────────────────────────────────────────────
function normalizeCondition(raw, fieldIds) {
  if (!raw || typeof raw !== "object" || !fieldIds.has(String(raw.field))) return null;
  const op = OPS.includes(raw.op) ? raw.op : "is";
  return {
    action: raw.action === "hide" ? "hide" : "show",
    field: String(raw.field),
    op,
    value: ["filled", "empty"].includes(op) ? "" : text(raw.value, 200),
  };
}

function normalizeField(raw, used) {
  const type = FIELD_TYPES[raw && raw.type] ? raw.type : "text";
  const label = text(raw.label, 200) || FIELD_TYPES[type].label;
  let id = ID.test(String(raw.id || "")) ? String(raw.id) : newId("f");
  while (used.ids.has(id)) id = newId("f");
  used.ids.add(id);
  let key = keyFrom(raw.key || label);
  for (let n = 2; used.keys.has(key); n += 1) key = `${keyFrom(raw.key || label)}${n}`;
  used.keys.add(key);
  const field = {
    id,
    type,
    label,
    key,
    help: text(raw.help, 1000),
    required: FIELD_TYPES[type].input !== false && raw.required === true,
    retired: raw.retired === true,
    width: raw.width === "half" ? "half" : "full",
    notes: text(raw.notes, 1000),
    cond: raw.cond || null, // checked once every field is known
  };
  if (FIELD_TYPES[type].options) {
    const seen = new Set();
    field.options = (Array.isArray(raw.options) ? raw.options : [])
      .map((option) => text(option, 120))
      .filter((option) => option && !seen.has(option.toLowerCase()) && seen.add(option.toLowerCase()))
      .slice(0, 60);
    if (type === "choice") {
      // Dropdown, plain-text buttons, or icon buttons (each choice may carry an icon).
      field.display = ["buttons", "icons"].includes(raw.display) ? raw.display : "dropdown";
      if (field.display === "icons") {
        const given = raw.icons && typeof raw.icons === "object" ? raw.icons : {};
        field.icons = Object.fromEntries(field.options.filter((option) => ANSWER_ICONS.includes(given[option])).map((option) => [option, given[option]]));
      }
    }
  }
  // Yes / No as words or as a tick and a cross; a seat on the chart with the student's photo or name only.
  if (type === "yesno" && raw.display === "icons") field.display = "icons";
  if (type === "seat" && raw.display === "names") field.display = "names";
  if (type === "instructions") field.help = text(raw.help, 4000);
  return field;
}

// A section as the editor sent it, made safe and complete. Unknown values fall back to defaults.
function normalizeSection(raw = {}) {
  const used = { ids: new Set(), keys: new Set() };
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).slice(0, MAX_FIELDS).map((field) => normalizeField(field || {}, used));
  const fieldIds = new Set(fields.map((field) => field.id));
  fields.forEach((field) => {
    const cond = normalizeCondition(field.cond, fieldIds);
    field.cond = cond && cond.field !== field.id ? cond : null;
  });
  const filledBy = FILLED_BY.includes(raw.filledBy) ? raw.filledBy : "staff";
  // Deadlines and "required" are for what families and students fill in.
  const portal = filledBy === "parent" || filledBy === "student";
  const dueDate = portal && DAY.test(String(raw.dueDate || "")) ? String(raw.dueDate) : null;
  const multiple = raw.multiple === true;
  const repeat = !multiple && REPEATS.includes(raw.repeat) ? raw.repeat : "";
  const tell = raw.tell && typeof raw.tell === "object" ? raw.tell : {};
  const via = raw.via && typeof raw.via === "object" ? raw.via : {};
  return {
    name: text(raw.name, 120) || "Untitled section",
    icon: ICONS.includes(raw.icon) ? raw.icon : "form",
    notes: text(raw.notes, 2000),
    multiple,
    // Locked once sent: it can't be changed and leaves the filler's list.
    once: !multiple && raw.once === true,
    // Collected again every day, week, term or school year (a list just keeps growing).
    repeat,
    // Prints on report cards (never a list, a daily or weekly count, or a protected section).
    reportCard: !multiple && raw.protected !== true && raw.reportCard === true && repeat !== "day" && repeat !== "week",
    // A column on the attendance page: a classroom section collected every day.
    attendance: filledBy === "staff" && repeat === "day" && raw.attendance === true,
    // Who hears when someone sends it: the class's main teacher (unless switched off) and,
    // when asked, the people who build forms.
    tell: { teacher: tell.teacher !== false, builders: tell.builders === true },
    // How families hear about a parent form, besides their bell (text and WhatsApp only go out
    // while the school has them switched on).
    via: { email: filledBy === "parent" && via.email === true, sms: filledBy === "parent" && via.sms === true, whatsapp: filledBy === "parent" && via.whatsapp === true },
    // Its own tile or menu item where it lives, instead of sitting under "Forms".
    tile: raw.tile === true,
    filledBy,
    classIds: [...new Set((Array.isArray(raw.classIds) ? raw.classIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500),
    // Whoever fills it in always sees it.
    showParents: filledBy === "parent" || raw.showParents === true,
    showStudents: filledBy === "student" || raw.showStudents === true,
    protected: raw.protected === true,
    required: portal && raw.required === true,
    dueDate,
    status: ["draft", "live", "archived"].includes(raw.status) ? raw.status : "draft",
    fields,
  };
}

// ── Which fields show ───────────────────────────────────────────────────────────────────
const isEmpty = (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)
  || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);

function asText(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === "object" ? item.name : item)).join(", ");
  if (value && typeof value === "object") return value.name || "";
  return value === null || value === undefined ? "" : String(value);
}

// Whether a value meets one condition (field op value).
function conditionMet(cond, value) {
  if (!cond) return true;
  const want = String(cond.value || "").trim().toLowerCase();
  if (cond.op === "filled") return !isEmpty(value);
  if (cond.op === "empty") return isEmpty(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item && typeof item === "object" ? item.name : item).toLowerCase());
    if (cond.op === "contains" || cond.op === "is") return items.includes(want);
    if (cond.op === "is_not") return !items.includes(want);
    return false;
  }
  const have = asText(value).trim().toLowerCase();
  if (cond.op === "is") return have === want;
  if (cond.op === "is_not") return have !== want;
  if (cond.op === "contains") return have.includes(want);
  if (cond.op === "more" || cond.op === "less") {
    if (isEmpty(value)) return false;
    const a = Number(have);
    const b = Number(want);
    if (Number.isFinite(a) && Number.isFinite(b) && have !== "" && want !== "") return cond.op === "more" ? a > b : a < b;
    return cond.op === "more" ? have > want : have < want; // dates as YYYY-MM-DD
  }
  return false;
}

// A field shows when it has no condition, or its condition (on a field that itself shows) holds.
function isVisible(field, data, byId, depth = 0) {
  if (!field || field.retired) return false;
  if (!field.cond || depth > 10) return true;
  const control = byId.get(field.cond.field);
  if (!control) return true;
  const value = isVisible(control, data, byId, depth + 1) ? data[control.id] : null;
  const met = conditionMet(field.cond, value);
  return field.cond.action === "hide" ? !met : met;
}

// ── Entries ──────────────────────────────────────────────────────────────────────────────
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanValue(field, raw, { organizationId, previous }) {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  switch (field.type) {
    case "text": return { value: text(raw, 2000) || null };
    case "textarea": return { value: text(raw, 10000) || null };
    case "number": {
      const n = Number(String(raw).replace(/,/g, ""));
      return Number.isFinite(n) ? { value: n } : { error: `${field.label}: enter a number.` };
    }
    case "date": {
      const v = String(raw);
      const real = DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
      return real ? { value: v } : { error: `${field.label}: choose a date.` };
    }
    case "time": {
      const v = String(raw);
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? { value: v } : { error: `${field.label}: choose a time.` };
    }
    case "yesno": {
      const v = String(raw).toLowerCase();
      if (raw === true || v === "yes" || v === "true") return { value: true };
      if (raw === false || v === "no" || v === "false") return { value: false };
      return { value: null };
    }
    case "choice": {
      const pick = text(raw, 120);
      return field.options.includes(pick) ? { value: pick } : { error: `${field.label}: choose one of the options.` };
    }
    case "checklist": {
      const picks = (Array.isArray(raw) ? raw : [raw]).map((item) => text(item, 120)).filter((item) => field.options.includes(item));
      return { value: picks.length ? [...new Set(picks)] : null };
    }
    case "rating": {
      const n = Number.parseInt(raw, 10);
      return n >= 1 && n <= 5 ? { value: n } : { value: null };
    }
    case "email": {
      const v = text(raw, 200);
      return EMAIL.test(v) ? { value: v } : { error: `${field.label}: enter an email address.` };
    }
    case "phone": {
      const v = text(raw, 40);
      return /^[0-9+()\-.\s]{5,40}$/.test(v) ? { value: v } : { error: `${field.label}: enter a phone number.` };
    }
    case "url": {
      const v = text(raw, 1000);
      return /^https?:\/\/[^\s]+$/i.test(v) ? { value: v } : { error: `${field.label}: enter a link starting with https://` };
    }
    case "file": {
      const prefix = `custom-forms/${organizationId}/`;
      const files = (Array.isArray(raw) ? raw : []).filter((file) => file && typeof file === "object"
        && String(file.key || "").startsWith(prefix) && String(file.url || "").endsWith(String(file.key)))
        .slice(0, MAX_FILES)
        .map((file) => ({ name: text(file.name, 200) || "File", key: String(file.key), url: String(file.url) }));
      return { value: files.length ? files : null };
    }
    case "seat": {
      const r = Number.parseInt(raw && raw.r, 10);
      const c = Number.parseInt(raw && raw.c, 10);
      return r >= 1 && r <= MAX_SEAT && c >= 1 && c <= MAX_SEAT ? { value: { r, c } } : { value: null };
    }
    case "signature": {
      const name = text(raw && raw.name, 120);
      if (!name) return { value: null };
      if (!(raw && raw.agreed === true)) return { error: `${field.label}: tick the box to sign.` };
      const kept = previous && previous.name === name && previous.at ? previous.at : new Date().toISOString();
      return { value: { name, agreed: true, at: kept } };
    }
    default: return { value: null };
  }
}

// What a person sent, checked against the section: values of hidden or retired fields are
// dropped, and a required field that shows must be filled in.
function normalizeEntry(section, payload = {}, { organizationId, previous = {}, partial = false } = {}) {
  const fields = section.fields || [];
  const byId = new Map(fields.map((field) => [field.id, field]));
  const data = {};
  const errors = [];
  // First the raw values (conditions read them), then visibility on the cleaned values.
  fields.forEach((field) => {
    if (FIELD_TYPES[field.type] && FIELD_TYPES[field.type].input === false) return;
    if (field.retired) {
      if (previous[field.id] !== undefined) data[field.id] = previous[field.id]; // kept, not shown
      return;
    }
    const result = cleanValue(field, payload[field.id], { organizationId, previous: previous[field.id] });
    if (result.error) errors.push({ field: field.id, message: result.error });
    else if (result.value !== null) data[field.id] = result.value;
  });
  fields.forEach((field) => {
    if (field.retired || (FIELD_TYPES[field.type] && FIELD_TYPES[field.type].input === false)) return;
    if (!isVisible(field, data, byId)) {
      delete data[field.id];
      for (let i = errors.length - 1; i >= 0; i -= 1) if (errors[i].field === field.id) errors.splice(i, 1);
      return;
    }
    // A quick section is answered a tap at a time, so a row may be saved part done.
    if (!partial && field.required && isEmpty(data[field.id]) && !errors.some((error) => error.field === field.id)) {
      errors.push({ field: field.id, message: `${field.label} is required.` });
    }
  });
  return { data, errors };
}

// A value as words, for notifications, lists, spreadsheets and report cards.
function display(field, value) {
  if (isEmpty(value)) return "";
  if (field && field.type === "yesno") return value ? "Yes" : "No";
  if (field && field.type === "rating") return `${value} / 5`;
  if (field && field.type === "time") {
    const [h, m] = String(value).split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (field && field.type === "signature") return `Signed by ${value.name}`;
  if (field && field.type === "seat") return `Row ${value.r}, seat ${value.c}`;
  if (field && field.type === "date") {
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return asText(value);
}

// ── Readiness ────────────────────────────────────────────────────────────────────────────
// The tables and columns come from database/migrations (2026-11-22 to 2026-11-26); until they
// all exist the pages say so instead of failing (checked again each minute).
let tablesReady = false;
let lastCheck = 0;
let checking = null;
function checkTables(db) {
  if (!checking) {
    checking = (db || require("../config/db")).query(
      `SELECT (SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = current_schema() AND table_name IN ('custom_sections', 'custom_section_entries', 'custom_section_runs'))
            + (SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'custom_sections' AND column_name IN ('once', 'options'))
            + (SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'custom_section_entries' AND column_name IN ('term_id', 'entry_date', 'period_key')) AS n`
    ).then(({ rows }) => { tablesReady = Number(rows[0] && rows[0].n) === 8; })
      .catch(() => {})
      .finally(() => { lastCheck = Date.now(); checking = null; });
  }
  return checking;
}
async function ready(db) {
  if (!tablesReady && Date.now() - lastCheck > 60000) await checkTables(db);
  return tablesReady;
}
// For pages and menus that can't wait: the last known answer, checked again in the background.
function readySync() {
  if (!tablesReady && Date.now() - lastCheck > 60000) checkTables();
  return tablesReady;
}
const featureOn = (organizationId) => features.isOn("custom_forms", { organizationId: Number(organizationId) || null });

// ── Sections ─────────────────────────────────────────────────────────────────────────────
function fromRow(row) {
  const options = row.options && typeof row.options === "object" ? row.options : {};
  return {
    id: Number(row.section_id),
    name: row.name,
    icon: row.icon,
    notes: row.notes || "",
    multiple: row.multiple,
    once: Boolean(row.once),
    repeat: !row.multiple && REPEATS.includes(options.repeat) ? options.repeat : "",
    reportCard: !row.multiple && !row.protected && options.reportCard === true,
    tile: options.tile === true,
    attendance: row.filled_by === "staff" && options.repeat === "day" && options.attendance === true,
    tell: { teacher: !(options.tell && options.tell.teacher === false), builders: Boolean(options.tell && options.tell.builders === true) },
    via: { email: Boolean(options.via && options.via.email), sms: Boolean(options.via && options.via.sms), whatsapp: Boolean(options.via && options.via.whatsapp) },
    filledBy: row.filled_by,
    classIds: (row.class_ids || []).map(Number),
    showParents: row.show_parents,
    showStudents: row.show_students,
    protected: row.protected,
    required: row.required,
    dueDate: row.due_date ? (row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date).slice(0, 10)) : null,
    status: row.status,
    fields: Array.isArray(row.fields) ? row.fields : [],
    position: Number(row.position || 0),
    updatedAt: row.updated_at,
  };
}

// A school's sections are read by every bell, portal page and report card, so each server keeps
// them for a few seconds (dropped at once when one is saved here). Callers only read them.
const SECTION_TTL_MS = 20 * 1000;
const sectionCache = new BoundedMap(500);
function forget(organizationId) {
  sectionCache.delete(Number(organizationId));
}
async function listSections(db, organizationId, { status = null, fresh = false } = {}) {
  const key = Number(organizationId);
  let hit = sectionCache.get(key);
  if (fresh || !hit || Date.now() - hit.at > SECTION_TTL_MS) {
    const { rows } = await db.query(
      "SELECT * FROM custom_sections WHERE organization_id = $1 AND status <> 'archived' ORDER BY position, LOWER(name), section_id",
      [key]
    );
    hit = { at: Date.now(), sections: rows.map(fromRow) };
    sectionCache.set(key, hit);
  }
  return status ? hit.sections.filter((section) => section.status === status) : hit.sections;
}

async function getSection(db, organizationId, sectionId) {
  const { rows } = await db.query("SELECT * FROM custom_sections WHERE organization_id = $1 AND section_id = $2", [organizationId, sectionId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

// Saves a section (new when there is no id). Returns it with whether it just went live.
async function saveSection(db, organizationId, raw, actorId) {
  const clean = normalizeSection(raw);
  const values = [clean.name, clean.icon, clean.notes || null, clean.multiple, clean.filledBy, clean.classIds, clean.showParents, clean.showStudents,
    clean.protected, clean.required, clean.dueDate, clean.status, JSON.stringify(clean.fields), JSON.stringify({ repeat: clean.repeat, reportCard: clean.reportCard, tile: clean.tile, attendance: clean.attendance, tell: clean.tell, via: clean.via }), clean.once];
  const id = Number.parseInt(raw.id, 10);
  forget(organizationId);
  if (Number.isInteger(id) && id > 0) {
    const { rows } = await db.query(
      `WITH before AS (SELECT status FROM custom_sections WHERE section_id = $16 AND organization_id = $17)
       UPDATE custom_sections SET name = $1, icon = $2, notes = $3, multiple = $4, filled_by = $5, class_ids = $6, show_parents = $7,
              show_students = $8, protected = $9, required = $10, due_date = $11, status = $12, fields = $13::jsonb, options = $14::jsonb, once = $15, updated_at = NOW()
        WHERE section_id = $16 AND organization_id = $17
        RETURNING *, (SELECT status FROM before) AS was`,
      [...values, id, organizationId]
    );
    if (!rows[0]) return null;
    return { section: fromRow(rows[0]), wentLive: rows[0].was !== "live" && rows[0].status === "live" };
  }
  // A school keeps at most MAX_SECTIONS, so its lists stay quick to read.
  const { rows } = await db.query(
    `INSERT INTO custom_sections (name, icon, notes, multiple, filled_by, class_ids, show_parents, show_students, protected, required, due_date, status, fields, options,
                                  once, organization_id, created_by, position)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,
            COALESCE((SELECT MAX(position) + 1 FROM custom_sections WHERE organization_id = $16), 0)
      WHERE (SELECT COUNT(*) FROM custom_sections WHERE organization_id = $16) < $18
     RETURNING *`,
    [...values, organizationId, actorId || null, MAX_SECTIONS]
  );
  if (!rows[0]) return { error: `A school can have up to ${MAX_SECTIONS} sections. Remove one you no longer use.` };
  return { section: fromRow(rows[0]), wentLive: rows[0].status === "live" };
}

async function deleteSection(db, organizationId, sectionId) {
  forget(organizationId);
  const { rowCount } = await db.query("DELETE FROM custom_sections WHERE organization_id = $1 AND section_id = $2", [organizationId, sectionId]);
  return rowCount > 0;
}

async function saveOrder(db, organizationId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_SECTIONS);
  if (!list.length) return;
  forget(organizationId);
  await db.query(
    `UPDATE custom_sections s SET position = o.pos FROM unnest($2::int[]) WITH ORDINALITY AS o(id, pos)
      WHERE s.section_id = o.id AND s.organization_id = $1`,
    [organizationId, list]
  );
}

async function entryCounts(db, organizationId) {
  const { rows } = await db.query(
    "SELECT section_id, COUNT(*)::int AS entries FROM custom_section_entries WHERE organization_id = $1 GROUP BY section_id",
    [organizationId]
  );
  return new Map(rows.map((row) => [Number(row.section_id), { entries: row.entries }]));
}

// ── Terms and school years ───────────────────────────────────────────────────────────────
// Every answer remembers the term and school year it was given in. A section collected "every
// term" (or "every year") counts only the answers of that term (or year).
const PERIOD_TTL_MS = 60 * 1000;
const periodCache = new BoundedMap(500);
async function currentPeriod(db, organizationId) {
  const key = Number(organizationId);
  const hit = periodCache.get(key);
  if (hit && Date.now() - hit.at < PERIOD_TTL_MS) return hit.value;
  const { rows } = await db.query(
    `SELECT t.term_id, t.school_year_id FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
      WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
      ORDER BY t.start_date DESC NULLS LAST LIMIT 1`,
    [key]
  );
  const value = { termId: rows[0] ? Number(rows[0].term_id) : null, yearId: rows[0] ? Number(rows[0].school_year_id) : null };
  periodCache.set(key, { at: Date.now(), value });
  return value;
}
// The term a page is showing (the classroom can look at another term), else the current one.
async function periodFor(db, organizationId, termId) {
  const id = Number.parseInt(termId, 10);
  if (Number.isInteger(id) && id > 0) {
    const { rows } = await db.query("SELECT term_id, school_year_id FROM terms WHERE organization_id = $1 AND term_id = $2", [organizationId, id]);
    if (rows[0]) return { termId: Number(rows[0].term_id), yearId: Number(rows[0].school_year_id) };
  }
  return currentPeriod(db, organizationId);
}
// A period also carries the day a page is working on ("2026-11-12", in the person's own time
// zone); without one it is today.
const dayOf = (period) => (period && DAY.test(String(period.day || "")) ? String(period.day) : todayKey());
const weekStart = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
};
// SQL for "this entry counts in this period" (the value is bound as `placeholder`), and the value.
const periodSql = (section, alias, placeholder) => {
  if (section.repeat === "day") return `${alias}.entry_date = ${placeholder}::date`;
  if (section.repeat === "week") return `${alias}.entry_date >= ${placeholder}::date AND ${alias}.entry_date < ${placeholder}::date + 7`;
  if (section.repeat === "term") return `${alias}.term_id IS NOT DISTINCT FROM ${placeholder}::int`;
  if (section.repeat === "year") return `${alias}.school_year_id IS NOT DISTINCT FROM ${placeholder}::int`;
  return `${placeholder}::int IS NULL`;
};
const periodValue = (section, period) => (section.repeat === "day" ? dayOf(period) : section.repeat === "week" ? weekStart(dayOf(period))
  : section.repeat === "term" ? period.termId : section.repeat === "year" ? period.yearId : null);
// The same test on a row already read (it carries entry_day, "2026-11-12").
const inPeriod = (section, period, row) => {
  if (section.repeat === "day") return String(row.entry_day || "") === dayOf(period);
  if (section.repeat === "week") { const start = weekStart(dayOf(period)); const day = String(row.entry_day || ""); return day >= start && day < addDays(start, 7); }
  if (section.repeat === "term") return Number(row.term_id || 0) === Number(period.termId || 0);
  if (section.repeat === "year") return Number(row.school_year_id || 0) === Number(period.yearId || 0);
  return true;
};

// What makes an answer the only one for its student and period (a unique index keeps it so,
// even when two saves land together). A list that grows has none.
const periodKey = (section, period) => {
  if (section.multiple) return null;
  if (section.repeat === "day") return `d:${dayOf(period)}`;
  if (section.repeat === "week") return `w:${weekStart(dayOf(period))}`;
  if (section.repeat === "term") return `t:${Number(period.termId) || 0}`;
  if (section.repeat === "year") return `y:${Number(period.yearId) || 0}`;
  return "once";
};

// The fields of a quick section (see QUICK_TYPES), or none.
function quickFields(section) {
  if (!section || section.multiple) return [];
  const fields = (section.fields || []).filter((field) => !field.retired && FIELD_TYPES[field.type] && FIELD_TYPES[field.type].input !== false);
  return fields.length && fields.length <= MAX_QUICK_FIELDS && fields.every((field) => QUICK_TYPES.has(field.type) && !field.cond) ? fields : [];
}

// ── Who sees what ───────────────────────────────────────────────────────────────────────
const FULL_ROLES = new Set(["organization", "manager", "supervisor", "superviser", "admin", "mini admin"]);
const roleOf = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "").trim().toLowerCase();

// A member of staff's reach: every student (managers, supervisors, builders) or the students of
// their own classes (teachers and other staff with classes). A driver reaches the students who
// ride with them (`riders`), and only driver-portal sections.
async function staffReach(db, req, { builder = false, riders = null } = {}) {
  const role = roleOf(req);
  if (role === "driver") return { all: false, classes: new Set(), students: new Set(riders || []), driver: true, builder: false };
  if (builder || FULL_ROLES.has(role) || String(req.session?.accountType || "").toLowerCase() === "organization") {
    return { all: true, classes: null, builder };
  }
  const userId = Number(req.session?.userId || req.session?.user?.user_id || 0);
  const { rows } = await db.query(
    `SELECT DISTINCT uc.class_id FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id
      WHERE uc.user_id = $1 AND c.organization_id = $2`,
    [userId, Number(req.session.organizationId)]
  );
  return { all: false, classes: new Set(rows.map((row) => Number(row.class_id))), builder: false };
}

// Sections a member of staff may open: live ones (and hidden ones for builders), protected ones
// only for builders, each limited to classes in their reach.
function sectionsForStaff(sections, reach) {
  return sections.filter((section) => {
    if (section.status === "archived") return false;
    if (section.status !== "live" && !reach.builder) return false;
    if (section.protected && !reach.builder) return false;
    if (reach.driver) return section.filledBy === "driver";
    // Driver sections stay with the drivers and the people who run the school.
    if (section.filledBy === "driver" && !reach.all) return false;
    if (reach.all) return true;
    if (!reach.classes.size) return false;
    return !section.classIds.length || section.classIds.some((id) => reach.classes.has(id));
  });
}

const inSection = (section, classId) => !section.classIds.length || section.classIds.includes(Number(classId));

// Sections that asked for a tile or menu item of their own. It shows where the section lives,
// for the people who fill it in: a child's page ("parent"), a student's dashboard ("student"),
// the driver's page ("driver") or a class's tools ("staff"). Anywhere else the section stays
// under Forms. Read from the school's cached list, so a page pays nothing extra for them.
const ownTile = (section, place) => section.tile && section.filledBy === place;
async function tilesFor(db, organizationId, place, { classId = null, builder = false } = {}) {
  if (!featureOn(organizationId) || !(await ready(db))) return [];
  const sections = (await listSections(db, organizationId, { status: "live" })).filter((section) => ownTile(section, place));
  const shown = sections.filter((section) => {
    if (place !== "driver" && classId && !inSection(section, classId)) return false;
    // A protected section opens only for people who build forms (as in sectionsForStaff).
    return place !== "staff" || !section.protected || builder;
  });
  return shown.map((section) => ({ id: section.id, name: section.name, icon: section.icon }));
}

// The students a section is for, within a reach, with what each has in this period. One pass
// over the section's answers, however many students there are.
async function studentsFor(db, organizationId, section, { reachClasses = null, classId = null, studentIds = null, period = null } = {}) {
  const { activeStudentSql } = require("./activeStudents");
  const now = period || await currentPeriod(db, organizationId);
  const quick = quickFields(section).length > 0;
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.class_id, c.class_name,
            COALESCE(e.entries, 0) AS entries, e.last_at, e.last_by${quick ? ", e.data, e.saved_by_type, s.image_url" : ""}
       FROM students s
       JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
       LEFT JOIN (
         SELECT x.student_id, COUNT(*)::int AS entries, MAX(x.updated_at) AS last_at,
                (ARRAY_AGG(x.saved_by_name ORDER BY x.updated_at DESC))[1] AS last_by${quick ? `,
                (ARRAY_AGG(x.data ORDER BY x.updated_at DESC))[1] AS data,
                (ARRAY_AGG(x.saved_by_type ORDER BY x.updated_at DESC))[1] AS saved_by_type` : ""}
           FROM custom_section_entries x
          WHERE x.section_id = $2 AND ${periodSql(section, "x", "$7")}
          GROUP BY x.student_id
       ) e ON e.student_id = s.student_id
      WHERE s.organization_id = $1 AND ${activeStudentSql("s")}
        AND (cardinality($3::int[]) = 0 OR s.class_id = ANY($3::int[]))
        AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[]))
        AND ($5::int IS NULL OR s.class_id = $5)
        AND ($6::int[] IS NULL OR s.student_id = ANY($6::int[]))
      ORDER BY LOWER(c.class_name), LOWER(s.last_name), LOWER(s.first_name)
      LIMIT 5000`,
    [organizationId, section.id, section.classIds, reachClasses ? [...reachClasses] : null, classId || null, studentIds ? [...studentIds] : null, periodValue(section, now)]
  );
  return rows.map((row) => ({
    id: Number(row.student_id),
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    classId: Number(row.class_id),
    className: row.class_name || "",
    entries: Number(row.entries || 0),
    lastAt: row.last_at,
    lastBy: row.last_by || "",
    // A quick section: the answer itself, and who gave it (a family's answer is theirs to change).
    ...(quick ? { data: row.data || null, by: row.saved_by_type || "", photo: row.image_url && row.image_url !== "profilePlaceholder.png" ? row.image_url : "" } : {}),
  }));
}

async function studentInfo(db, organizationId, studentId) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.class_id, s.email, c.class_name
       FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.student_id = $2`,
    [organizationId, studentId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.student_id),
    firstName: row.first_name || "",
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    classId: row.class_id ? Number(row.class_id) : null,
    className: row.class_name || "",
    email: row.email || "",
  };
}

const toEntry = (row) => ({
  id: Number(row.entry_id),
  data: row.data || {},
  savedByType: row.saved_by_type,
  savedById: row.saved_by_id,
  savedBy: row.saved_by_name || "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// A student's answers to a section in this period, newest first. `previous` is what they
// answered last term or year (a section collected again), to start the new answer from.
async function entriesFor(db, organizationId, section, studentId, period = null) {
  const now = period || await currentPeriod(db, organizationId);
  const { rows } = await db.query(
    `SELECT entry_id, data, saved_by_type, saved_by_id, saved_by_name, created_at, updated_at, term_id, school_year_id, entry_date::text AS entry_day
       FROM custom_section_entries WHERE organization_id = $1 AND section_id = $2 AND student_id = $3
      ORDER BY created_at DESC, entry_id DESC LIMIT 500`,
    [organizationId, section.id, studentId]
  );
  const current = rows.filter((row) => inPeriod(section, now, row));
  const earlier = section.repeat && !current.length ? rows.find((row) => !inPeriod(section, now, row)) : null;
  return { entries: current.map(toEntry), previous: earlier ? earlier.data || {} : null };
}

// Saves what a person filled in, for this period. One entry per student unless it's a list.
//   override: someone who builds forms may correct anything.
//   paperOnly: staff entering a family's paper form may not change what the family sent.
//   partial: a quick section's row, answered a tap at a time (nothing required yet; emptied, it is removed).
async function saveEntry(db, { organizationId, section, studentId, entryId = null, payload, saver, override = false, paperOnly = false, period = null, partial = false }) {
  const now = period || await currentPeriod(db, organizationId);
  const columns = "entry_id, data, saved_by_type, saved_by_id, term_id, school_year_id";
  let existing = null;
  if (entryId) {
    const { rows } = await db.query(
      `SELECT ${columns} FROM custom_section_entries WHERE organization_id = $1 AND section_id = $2 AND student_id = $3 AND entry_id = $4`,
      [organizationId, section.id, studentId, entryId]
    );
    existing = rows[0] || null;
    if (!existing) return { error: "That entry no longer exists.", status: 404 };
  } else if (!section.multiple) {
    const { rows } = await db.query(
      `SELECT ${columns} FROM custom_section_entries x
        WHERE x.organization_id = $1 AND x.section_id = $2 AND x.student_id = $3 AND ${periodSql(section, "x", "$4")}
        ORDER BY x.entry_id LIMIT 1`,
      [organizationId, section.id, studentId, periodValue(section, now)]
    );
    existing = rows[0] || null;
  }
  // Parents and students change only what someone of their kind saved.
  if (existing && ["parent", "student"].includes(saver.type) && existing.saved_by_type !== saver.type) {
    return { error: "The school already filled this in. Ask the school to change it.", status: 403 };
  }
  if (existing && paperOnly && existing.saved_by_type !== "staff") {
    return { error: "The family already sent this. Someone who builds forms can correct it.", status: 403 };
  }
  // Locked once sent (someone who builds forms can still correct it).
  if (existing && section.once && !override) return { error: "This was already submitted. It can only be sent once.", status: 409 };
  const { data, errors } = normalizeEntry(section, payload, { organizationId, previous: existing ? existing.data || {} : {}, partial });
  if (errors.length) return { errors, status: 400 };
  if (!Object.keys(data).length) {
    if (!partial) return { error: "Fill in at least one field.", status: 400 };
    if (existing) await db.query("DELETE FROM custom_section_entries WHERE entry_id = $1 AND organization_id = $2", [existing.entry_id, organizationId]);
    return { entry: null, cleared: true };
  }
  let row;
  if (existing) {
    ({ rows: [row] } = await db.query(
      `UPDATE custom_section_entries SET data = $1::jsonb, saved_by_type = $2, saved_by_id = $3, saved_by_name = $4, submitted = TRUE, updated_at = NOW()
        WHERE entry_id = $5 RETURNING *`,
      [JSON.stringify(data), saver.type, saver.id || null, saver.name || null, existing.entry_id]
    ));
  } else {
    ({ rows: [row] } = await db.query(
      // Two saves in the same instant end as one answer (the later one), never two.
      `INSERT INTO custom_section_entries (organization_id, section_id, student_id, data, saved_by_type, saved_by_id, saved_by_name, term_id, school_year_id, entry_date, period_key)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::date, $11)
       ON CONFLICT (section_id, student_id, period_key) WHERE period_key IS NOT NULL
       DO UPDATE SET data = EXCLUDED.data, saved_by_type = EXCLUDED.saved_by_type, saved_by_id = EXCLUDED.saved_by_id, saved_by_name = EXCLUDED.saved_by_name, submitted = TRUE, updated_at = NOW()
       RETURNING *`,
      [organizationId, section.id, studentId, JSON.stringify(data), saver.type, saver.id || null, saver.name || null, now.termId, now.yearId, dayOf(now), periodKey(section, now)]
    ));
  }
  return { entry: { id: Number(row.entry_id), data: row.data, createdAt: row.created_at, updatedAt: row.updated_at }, created: !existing };
}

async function deleteEntry(db, organizationId, sectionId, entryId) {
  const { rowCount } = await db.query(
    "DELETE FROM custom_section_entries WHERE organization_id = $1 AND section_id = $2 AND entry_id = $3",
    [organizationId, sectionId, entryId]
  );
  return rowCount > 0;
}

// Whether a school has a live section this audience fills in or reads: decided from the kept
// list, so bells and tiles of schools without one cost no query.
async function liveFor(db, organizationId, audience) {
  const sections = await listSections(db, organizationId, { status: "live" });
  return sections.filter((section) => (audience === "parent" ? section.showParents : audience === "student" ? section.showStudents : section.filledBy === audience));
}

// What a family or a student sees: live sections for the child's class that they fill in or are
// shown, with this period's answers (and whether one is still to do).
async function portalForms(db, organizationId, student, audience, { day = null } = {}) {
  if (!student || !student.classId) return [];
  const sections = (await liveFor(db, organizationId, audience)).filter((section) => inSection(section, student.classId));
  if (!sections.length) return [];
  const [period, { rows }] = await Promise.all([
    currentPeriod(db, organizationId),
    db.query(
      `SELECT entry_id, section_id, data, saved_by_type, saved_by_name, created_at, updated_at, term_id, school_year_id, entry_date::text AS entry_day
         FROM custom_section_entries WHERE organization_id = $1 AND student_id = $2 AND section_id = ANY($3::int[])
        ORDER BY created_at DESC, entry_id DESC LIMIT 1000`,
      [organizationId, student.id, sections.map((section) => section.id)]
    ),
  ]);
  const now = { ...period, day };
  return sections.map((section) => {
    const all = rows.filter((row) => Number(row.section_id) === section.id);
    const current = all.filter((row) => inPeriod(section, now, row));
    const entries = current.map((row) => ({
      id: Number(row.entry_id),
      data: row.data || {},
      savedByType: row.saved_by_type,
      savedBy: row.saved_by_name || "",
      updatedAt: row.updated_at,
      mine: row.saved_by_type === audience,
    }));
    const fillsIn = section.filledBy === audience;
    // Sent once and locked: it leaves their list.
    if (fillsIn && section.once && entries.length) return null;
    const earlier = fillsIn && section.repeat && !current.length ? all.find((row) => row.saved_by_type === audience) : null;
    return {
      id: section.id,
      name: section.name,
      icon: section.icon,
      tile: ownTile(section, audience),
      multiple: section.multiple,
      once: section.once,
      repeat: section.repeat,
      fillsIn,
      required: fillsIn && section.required,
      dueDate: section.dueDate,
      todo: fillsIn && !entries.length,
      // Last term's or year's answers, to confirm or change.
      previous: earlier ? earlier.data || {} : null,
      // Obsolete fields and staff notes never leave the server.
      fields: section.fields.filter((field) => !field.retired).map(({ notes, ...field }) => field),
      entries,
    };
  }).filter(Boolean);
}

// ── What happens on its own ─────────────────────────────────────────────────────────────
const addDays = (key, days) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const todayKey = () => new Date().toISOString().slice(0, 10);
const REMIND_DAYS_BEFORE = 2;

// The class's main teacher(s): never drivers, people on hold or removed accounts.
async function mainTeachersOf(db, organizationId, classId) {
  if (!classId) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT u.user_id FROM user_classes uc JOIN users u ON u.user_id = uc.user_id
      WHERE uc.class_id = $1 AND COALESCE(uc.main, FALSE) AND u.organization_id = $2
        AND u.account_type IS DISTINCT FROM 'Driver' AND COALESCE(u.on_hold, FALSE) = FALSE AND u.removed_at IS NULL`,
    [classId, organizationId]
  );
  return rows.map((row) => Number(row.user_id));
}

// Emails leave one after another in the background, so a whole school's families never open
// hundreds of mail connections at once or hold up the request.
function emailPeople(people, { subject, title, paragraphs, ctaUrl, ctaText, reminder = false }) {
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("./emailHelper");
  const list = people.filter((person) => person.email);
  (async () => {
    // Start after the request that asked has been answered.
    await new Promise((resolve) => setImmediate(resolve));
    for (const person of list) {
      const lines = typeof paragraphs === "function" ? paragraphs(person) : paragraphs;
      const html = renderCleanEmail({
        title,
        greeting: `Hi ${escapeHtml(person.first_name || "there")},`,
        paragraphs: lines.map((line) => escapeHtml(line)),
        details: [],
        cta: ctaUrl ? { url: typeof ctaUrl === "function" ? ctaUrl(person) : ctaUrl, text: ctaText || "Open Managira" } : null,
        noReply: true,
      });
      await sendEmailSafely({ to: person.email, subject, html, ...(reminder ? { sender: "reminders" } : {}) }, "Custom forms").catch(() => {});
      // Let the server answer everyone else between two emails, however fast the sender is.
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
}

// Opens where the person works on it: the classroom, the driver portal or the Custom editor.
const staffLink = (section, student) => `/common/custom-forms/go?section=${section.id}${student ? `&student=${student.id}` : ""}`;
const parentLink = (studentId) => `/guardian/child/forms?studentId=${studentId}`;

// The people who build forms, kept for a minute per school (the same check as the pages).
const builderCache = new BoundedMap(500);
async function buildersOf(db, organizationId) {
  const key = Number(organizationId);
  const hit = builderCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.ids;
  const { PERMISSIONS, userHasPermission } = require("../middleware/permissionMiddleware");
  const { rows } = await db.query(
    `SELECT user_id, account_type::text AS role, email FROM users
      WHERE organization_id = $1 AND COALESCE(on_hold, FALSE) = FALSE AND removed_at IS NULL AND account_type IS DISTINCT FROM 'Driver'`,
    [key]
  );
  const ids = [];
  for (const user of rows) {
    const who = { userId: user.user_id, userRole: user.role, accountType: user.role, organizationId: key, userEmail: user.email };
    if (await userHasPermission(db, who, PERMISSIONS.CUSTOM_FORMS)) ids.push(Number(user.user_id));
  }
  builderCache.set(key, { at: Date.now(), ids });
  return ids;
}

// Someone sent a form. A parent, student or driver: the class's main teacher hears of it on
// their bell (unless the section says not to), and the people who build forms when it asks.
// Staff filling in their own class tell nobody, except a log the builders asked to hear about
// (a health office visit, an incident).
async function afterSave(db, { organizationId, section, student, saver }) {
  if (section.status !== "live" || !saver || !student) return;
  const fromStaff = saver.type === "staff";
  if (fromStaff && !(section.multiple && section.tell.builders)) return;
  const ids = new Set();
  if (!fromStaff && section.tell.teacher) (await mainTeachersOf(db, organizationId, student.classId)).forEach((id) => ids.add(id));
  if (section.tell.builders) (await buildersOf(db, organizationId)).forEach((id) => ids.add(id));
  if (fromStaff) ids.delete(Number(saver.id));
  if (!ids.size) return;
  const who = fromStaff ? saver.name || "A member of staff" : saver.type === "parent" ? "A parent" : saver.type === "student" ? student.firstName || "The student" : "The driver";
  await require("./notificationService").createNotifications(db, [...ids].map((id) => ({
    orgId: organizationId, recipientType: "staff", recipientId: id, type: "custom_form",
    title: `${section.name}: ${student.name}`.slice(0, 250), body: `${who} ${fromStaff ? "added an entry" : "sent it"}.`, link: staffLink(section, student), refId: section.id,
  })));
}

// A text or WhatsApp message to each parent (one per parent, their first child on the list),
// through the school's own provider: only while the school has that channel switched on. It
// leaves in the background and never holds up or fails the request.
function messagePeople(db, organizationId, parents, channel, textFor) {
  (async () => {
    const { sendGuardianMessages, getMessagingChannelStatus } = require("./guardianMessaging");
    const status = await getMessagingChannelStatus(db, organizationId);
    if (!status[channel] || !status[channel].ready) return;
    const seen = new Set();
    const recipients = parents.filter((p) => p.phone && !seen.has(p.guardian_id) && seen.add(p.guardian_id))
      .map((p) => ({ phone: p.phone, guardianName: p.first_name || "", studentName: p.child || "", text: textFor(p) }));
    if (!recipients.length) return;
    const { rows } = await db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [organizationId]);
    await sendGuardianMessages(db, organizationId, { channel, recipients, messageTemplate: "{{schoolName}}: {{text}}", schoolName: rows[0] ? rows[0].organization_name : "" });
  })().catch((error) => console.error(`[Custom forms] ${channel}:`, error.message));
}

// Tells the families of these students: their bell always, and email, text or WhatsApp when
// the section asks (`via`). Three statements however many students there are. With `key`, each
// student's family hears once per `fireKey`.
async function tellFamilies(db, { organizationId, section, studentIds, title, bodyFor, key = null, fireKey = "", siteUrl = "", email = false, reminder = false }) {
  const via = section.via || {};
  let ids = [...new Set(studentIds.map(Number))];
  if (key && ids.length) {
    const { rows } = await db.query(
      `INSERT INTO custom_section_runs (organization_id, section_id, entry_id, student_id, rule_id, fire_key)
       SELECT $1, $2, 0, x, $4, $5 FROM unnest($3::int[]) AS x
       ON CONFLICT DO NOTHING RETURNING student_id`,
      [organizationId, section.id, ids, key, fireKey]
    );
    ids = rows.map((row) => Number(row.student_id));
  }
  if (!ids.length) return 0;
  const { rows: parents } = await db.query(
    `SELECT DISTINCT gs.student_id, g.guardian_id, g.first_name, g.email, g.phone, s.first_name AS child
       FROM guardian_students gs
       JOIN guardian_profiles g ON g.guardian_id = gs.guardian_id AND g.organization_id = $2
       JOIN students s ON s.student_id = gs.student_id
      WHERE gs.student_id = ANY($1::int[])`,
    [ids, organizationId]
  );
  await require("./notificationService").createNotifications(db, parents.map((p) => ({
    orgId: organizationId, recipientType: "guardian", recipientId: p.guardian_id, type: "custom_form",
    title: title.slice(0, 250), body: bodyFor(p.child || "your child"), link: parentLink(p.student_id), refId: section.id,
  })));
  ["sms", "whatsapp"].filter((channel) => via[channel]).forEach((channel) => {
    messagePeople(db, organizationId, parents, channel, (p) => `${title}. ${bodyFor(p.child || "your child")}${siteUrl ? ` ${siteUrl}${parentLink(p.student_id)}` : ""}`);
  });
  if (email || via.email) {
    // One email per parent, about their first child on the list.
    const seen = new Set();
    emailPeople(parents.filter((p) => p.email && !seen.has(p.guardian_id) && seen.add(p.guardian_id)), {
      subject: title, title: section.name, reminder,
      paragraphs: (p) => [bodyFor(p.child || "your child")],
      ctaUrl: siteUrl ? (p) => siteUrl + parentLink(p.student_id) : "",
      ctaText: "Fill it in",
    });
  }
  return ids.length;
}

const dueWords = (section) => (section.dueDate ? ` by ${display({ type: "date" }, section.dueDate)}` : "");

// A parent form went live: the families of its classes hear of it. (Students see theirs on
// their portal and bell.)
async function announce(db, { organizationId, section, siteUrl }) {
  if (section.status !== "live" || section.filledBy !== "parent") return 0;
  const students = await studentsFor(db, organizationId, section);
  return tellFamilies(db, {
    organizationId, section, studentIds: students.map((student) => student.id), siteUrl,
    title: `Please fill in: ${section.name}`, bodyFor: (child) => `For ${child}${dueWords(section)}.`,
  });
}

// "Send a reminder" in Answers: families who haven't filled it in hear now, at most once a day.
async function remindMissing(db, { organizationId, section, reachClasses = null, siteUrl = "", email = false, period = null }) {
  if (section.filledBy !== "parent" || section.status !== "live") return 0;
  const missing = (await studentsFor(db, organizationId, section, { reachClasses, period })).filter((student) => !student.entries);
  return tellFamilies(db, {
    organizationId, section, studentIds: missing.map((student) => student.id), key: "remind", fireKey: todayKey(), siteUrl, email, reminder: true,
    title: `Reminder: ${section.name}`, bodyFor: (child) => `Please fill it in for ${child}${dueWords(section)}.`,
  });
}

// Hourly: a required parent form with a deadline reminds the families who haven't filled it in,
// once, two days before (a missed hour catches up; nothing more than three days late).
async function runReminders(db, { today = todayKey(), siteUrl = process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "" } = {}) {
  if (!(await ready(db))) return { runs: 0 };
  const { rows } = await db.query(
    `SELECT * FROM custom_sections WHERE status = 'live' AND filled_by = 'parent' AND required AND due_date IS NOT NULL
        AND due_date - $1::int BETWEEN $2::date - 3 AND $2::date`,
    [REMIND_DAYS_BEFORE, today]
  );
  let runs = 0;
  for (const row of rows) {
    const section = fromRow(row);
    const organizationId = Number(row.organization_id);
    if (!featureOn(organizationId)) continue;
    const missing = (await studentsFor(db, organizationId, section)).filter((student) => !student.entries);
    runs += await tellFamilies(db, {
      organizationId, section, studentIds: missing.map((student) => student.id), key: "due", fireKey: section.dueDate, siteUrl, email: true, reminder: true,
      title: `Reminder: ${section.name}`, bodyFor: (child) => `Please fill it in for ${child}${dueWords(section)}.`,
    });
  }
  return { runs };
}

// ── Answers elsewhere: a spreadsheet, and the report card ───────────────────────────────
const answerFields = (section) => section.fields.filter((field) => FIELD_TYPES[field.type] && FIELD_TYPES[field.type].input !== false);
const EXPORT_ROWS = 50000;

// Every answer of a section as spreadsheet rows (Answers › Download): one row per answer, a
// column per field, values as people read them; then the students with nothing yet.
async function exportRows(db, organizationId, section, { reachClasses = null, studentIds = null, period = null } = {}) {
  const students = await studentsFor(db, organizationId, section, { reachClasses, studentIds, period });
  const byId = new Map(students.map((student) => [student.id, student]));
  const fields = answerFields(section);
  const { rows } = await db.query(
    `SELECT e.student_id, e.data, e.saved_by_type, e.saved_by_name, e.updated_at, e.entry_date::text AS entry_day, t.term_name, sy.year_label
       FROM custom_section_entries e
       LEFT JOIN terms t ON t.term_id = e.term_id AND t.organization_id = e.organization_id
       LEFT JOIN school_years sy ON sy.id = e.school_year_id
      WHERE e.organization_id = $1 AND e.section_id = $2 AND e.student_id = ANY($3::int[])
      ORDER BY e.student_id, e.created_at LIMIT ${EXPORT_ROWS}`,
    [organizationId, section.id, students.map((student) => student.id)]
  );
  const header = ["Student", "Class", "Day", "Term", "School year", "Saved", "Saved by", ...fields.map((field) => field.label)];
  const out = rows.map((row) => {
    const student = byId.get(Number(row.student_id)) || {};
    return [student.name || "", student.className || "", row.entry_day || "", row.term_name || "", row.year_label || "", new Date(row.updated_at).toISOString().slice(0, 16).replace("T", " "),
      [row.saved_by_name, row.saved_by_type === "staff" ? "" : `(${row.saved_by_type})`].filter(Boolean).join(" "),
      ...fields.map((field) => (field.type === "file" && Array.isArray(row.data[field.id]) ? row.data[field.id].map((f) => f.url).join(" ") : display(field, row.data[field.id])))];
  });
  students.filter((student) => !student.entries).forEach((student) => out.push([student.name, student.className, "", "", "", "", "Not yet", ...fields.map(() => "")]));
  return [header, ...out];
}

// The attendance page's extra columns: classroom sections collected every day that asked for a
// column (a lunch count), with that day's answers for the class. A school without one costs no
// query; with one, a single read for the whole class.
async function attendanceColumns(db, organizationId, { classId, day, builder = false }) {
  if (!featureOn(organizationId) || !(await ready(db)) || !classId) return [];
  const sections = (await listSections(db, organizationId, { status: "live" }))
    .filter((section) => section.attendance && inSection(section, classId) && (!section.protected || builder))
    .map((section) => ({ section, fields: quickFields(section).filter((field) => field.type !== "seat") }))
    .filter((item) => item.fields.length);
  if (!sections.length) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (e.section_id, e.student_id) e.section_id, e.student_id, e.data
       FROM custom_section_entries e JOIN students s ON s.student_id = e.student_id AND s.organization_id = e.organization_id
      WHERE e.organization_id = $1 AND e.section_id = ANY($2::int[]) AND e.entry_date = $3::date AND s.class_id = $4
      ORDER BY e.section_id, e.student_id, e.updated_at DESC`,
    [organizationId, sections.map((item) => item.section.id), dayOf({ day }), classId]
  );
  return sections.map(({ section, fields }) => ({
    id: section.id,
    name: section.name,
    fields: fields.map((field) => ({ id: field.id, label: field.label, type: field.type, options: field.options || [], display: field.display || "", icons: field.icons || {} })),
    values: Object.fromEntries(rows.filter((row) => Number(row.section_id) === section.id).map((row) => [row.student_id, row.data || {}])),
  }));
}

// What prints on report cards: the sections marked "Show on report cards" for this class, with
// each student's answers for the report's term. Schools without one cost no query.
async function reportCardSections(db, organizationId, { classId, termId, studentIds }) {
  const out = new Map();
  if (!featureOn(organizationId) || !(await ready(db)) || !studentIds || !studentIds.length) return out;
  const sections = (await listSections(db, organizationId, { status: "live" })).filter((section) => section.reportCard && inSection(section, classId));
  if (!sections.length) return out;
  const [period, { rows }] = await Promise.all([
    periodFor(db, organizationId, termId),
    db.query(
      `SELECT section_id, student_id, data, term_id, school_year_id FROM custom_section_entries
        WHERE organization_id = $1 AND section_id = ANY($2::int[]) AND student_id = ANY($3::int[])
        ORDER BY updated_at DESC LIMIT 20000`,
      [organizationId, sections.map((section) => section.id), studentIds.map(Number)]
    ),
  ]);
  sections.forEach((section) => {
    const byId = new Map(section.fields.map((field) => [field.id, field]));
    const done = new Set();
    rows.forEach((row) => {
      const studentId = Number(row.student_id);
      if (Number(row.section_id) !== section.id || done.has(studentId) || !inPeriod(section, period, row)) return;
      done.add(studentId); // the newest answer of the period
      const data = row.data || {};
      const lines = answerFields(section)
        .filter((field) => field.type !== "file" && isVisible(field, data, byId) && !isEmpty(data[field.id]))
        .map((field) => ({ label: field.label, value: display(field, data[field.id]) }));
      if (!lines.length) return;
      if (!out.has(studentId)) out.set(studentId, []);
      out.get(studentId).push({ name: section.name, rows: lines });
    });
  });
  return out;
}

// Forms a student still has to fill in, for their bell and dashboard.
async function studentToDo(db, organizationId, studentId) {
  if (!featureOn(organizationId) || !(await ready(db))) return [];
  if (!(await liveFor(db, organizationId, "student")).some((section) => section.filledBy === "student")) return [];
  const student = await studentInfo(db, organizationId, studentId);
  const forms = await portalForms(db, organizationId, student, "student");
  return forms.filter((form) => form.todo);
}

// A student's dashboard: how many forms under "Forms" are waiting, and the forms with a tile of
// their own (each says whether it is still to do). Nothing is read when no form is for students.
async function studentDashboard(db, organizationId, studentId, { day = null } = {}) {
  const none = { toDo: 0, tiles: [] };
  if (!featureOn(organizationId) || !(await ready(db))) return none;
  if (!(await liveFor(db, organizationId, "student")).length) return none;
  const forms = await portalForms(db, organizationId, await studentInfo(db, organizationId, studentId), "student", { day });
  return {
    toDo: forms.filter((form) => form.todo && !form.tile).length,
    tiles: forms.filter((form) => form.tile).map((form) => ({ id: form.id, name: form.name, icon: form.icon, todo: form.todo })),
  };
}

module.exports = {
  FIELD_TYPES, ICONS, OPS, keyFrom,
  normalizeSection, normalizeEntry, conditionMet, isVisible, isEmpty, display,
  ready, readySync, featureOn, staffReach, sectionsForStaff, inSection, liveFor, tilesFor, ownTile,
  listSections, getSection, saveSection, deleteSection, saveOrder, entryCounts, forget,
  currentPeriod, periodFor,
  studentsFor, studentInfo, entriesFor, saveEntry, deleteEntry, portalForms,
  afterSave, announce, runReminders, remindMissing, exportRows, reportCardSections, studentToDo, studentDashboard,
  quickFields, attendanceColumns, REPEATS, ANSWER_ICONS,
};
