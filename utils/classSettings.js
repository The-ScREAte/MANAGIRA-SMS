"use strict";

// Class settings (feature class_settings): what each class has switched on and who sees what
// about it. One row per class in class_settings (database/migrations/2026-12-09_class_settings.sql);
// a class without a row, or a key missing from its row, uses DEFAULTS. Read through here only.
//
// "Share with": each item (attendance, lunch, report cards, GPA, bus & transport, student files,
// portfolio, and a teacher's email, phone and About me) has a switch for parents and one for
// students. Everything is on until a school turns it off, except a teacher's phone (off until on).
//
// Who may change them (permission Class Settings, follow-up Every Class):
//  - Every Class: every class, from Management › Class settings and in any classroom;
//  - Class Settings alone: the classes the person leads (main or assistant teacher), in the classroom;
//  - neither: nothing, and the page isn't offered.
// The school's attendance calendar stays in Settings › School rules (one per school and term);
// Class settings shows it and links there.

const { BoundedMap } = require("./boundedMap");

const FEATURE = "class_settings";

// What each item covers. Every audience starts with everything shared.
const SHARE_ITEMS = [
  { key: "attendance", label: "Attendance", help: "Daily attendance and overall attendance." },
  { key: "lunch", label: "Lunch", help: "Lunch days and overall lunch." },
  { key: "reportCards", label: "Report cards", help: "Report cards, as soon as they're published." },
  { key: "gpa", label: "GPA", help: "This term's GPA and the cumulative GPA over finished terms (letter grades only)." },
  { key: "transport", label: "Bus & transport", help: "The bus tracker, boarding and driver reports about the student." },
  { key: "files", label: "Student files", help: "Files on the student's record set to Family." },
  { key: "portfolio", label: "Portfolio", help: "Marked work and documented tests, term by term." },
  // Feature alert_rules. The school decides whether families can set alerts about this class's students;
  // an alert about attendance, the bus or report cards also follows that item's own switch.
  { key: "alerts", label: "Alerts", help: "Whether they can set alerts about scores, absences and the bus. Each alert also follows its own item (attendance, bus & transport, report cards)." },
  // About the child's teachers (feature teacher_cards; their names always show on the Teachers page).
  { key: "teacherEmail", label: "Teacher's email", help: "Each teacher's email on the Teachers page." },
  { key: "teacherPhone", label: "Teacher's phone", help: "Each teacher's phone number on the Teachers page. Off until a school turns it on." },
  { key: "teacherAbout", label: "Teacher's About me", help: "The fun fact and photos each teacher adds to their profile." },
];
// Off until a school turns it on: a teacher's phone is often their own.
const OFF_BY_DEFAULT = new Set(["teacherPhone"]);
const AUDIENCES = [
  { key: "parents", label: "Parents" },
  { key: "students", label: "Students" },
];
const shareDefaults = () => Object.freeze(Object.fromEntries(SHARE_ITEMS.map((item) => [item.key, !OFF_BY_DEFAULT.has(item.key)])));

// Tell parents when a student is absent or late several times in a week (feature attendance_notices): on, after 3.
const NOTICE_DEFAULTS = Object.freeze({ absent: Object.freeze({ on: true, count: 3 }), late: Object.freeze({ on: true, count: 3 }) });
const NOTICE_KINDS = ["absent", "late"];
const NOTICE_MAX = 10;
function normalizeNotices(raw) {
  const given = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(NOTICE_KINDS.map((kind) => {
    const row = given[kind] && typeof given[kind] === "object" ? given[kind] : {};
    const count = Math.round(Number(row.count));
    return [kind, {
      on: typeof row.on === "boolean" ? row.on : NOTICE_DEFAULTS[kind].on,
      count: Number.isFinite(count) ? Math.min(NOTICE_MAX, Math.max(1, count)) : NOTICE_DEFAULTS[kind].count,
    }];
  }));
}

const DEFAULTS = Object.freeze({
  // Take lunch beside attendance on the class attendance page (also needs the class_lunch feature).
  lunch: true,
  // Whether this class's students may use the student portal: on, and management or the class can
  // turn it off (the invite on a student's page and its endpoints follow it).
  portal: true,
  parents: shareDefaults(),
  students: shareDefaults(),
});

// Every switch, with its stored key ("lunch", "parents.attendance", "students.lunch", ...).
const SWITCHES = [
  { key: "lunch", group: "class", label: "Take lunch", help: "A plate beside each student's checkbox on the attendance page, saved with attendance." },
  { key: "portal", group: "class", label: "Student portal", help: "Lets this class's students use the student portal; it decides who can be invited." },
  ...SHARE_ITEMS.flatMap((item) => AUDIENCES.map((audience) => ({
    key: `${audience.key}.${item.key}`, group: "share", item: item.key, audience: audience.key,
    label: `${item.label} · ${audience.label}`, help: item.help,
  }))),
];
const SWITCH_KEYS = new Set(SWITCHES.map((s) => s.key));

const isOn = (organizationId) => require("./shards/features").isOn(FEATURE, { organizationId: Number(organizationId) });

// A full settings object: the stored values over the defaults, every key a boolean.
function withDefaults(stored) {
  const raw = stored && typeof stored === "object" ? stored : {};
  const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  const share = (audience) => {
    const given = raw[audience] && typeof raw[audience] === "object" ? raw[audience] : {};
    return Object.fromEntries(SHARE_ITEMS.map((item) => [item.key, bool(given[item.key], DEFAULTS[audience][item.key])]));
  };
  // Settings management has locked: the class's own teachers can't change them (only Every Class can).
  const locks = {};
  if (raw.locks && typeof raw.locks === "object") Object.keys(raw.locks).forEach((key) => { if (SWITCH_KEYS.has(key) && raw.locks[key] === true) locks[key] = true; });
  return { lunch: bool(raw.lunch, DEFAULTS.lunch), portal: bool(raw.portal, DEFAULTS.portal), parents: share("parents"), students: share("students"), notices: normalizeNotices(raw.notices), locks };
}

// Where the feature is off for a school, every class behaves as before: everything on.
const everythingOn = () => ({ ...withDefaults(null), portal: true });
const isLocked = (settings, key) => Boolean(settings && settings.locks && settings.locks[key] === true);

// A school's rows, read at most every few seconds (pages ask once per class or student).
const CACHE_MS = 5000;
const cache = new BoundedMap(2000);
// When the table is missing (migration not run yet), ask again after a minute rather than never.
let missingSince = 0;
const MISSING_RETRY_MS = 60 * 1000;
const tableMissingNow = () => missingSince && Date.now() - missingSince < MISSING_RETRY_MS;

async function schoolRows(db, organizationId) {
  const orgId = Number(organizationId);
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  let rows = new Map();
  if (!tableMissingNow()) {
    try {
      const result = await db.query("SELECT class_id, settings FROM class_settings WHERE organization_id = $1", [orgId]);
      rows = new Map(result.rows.map((r) => [Number(r.class_id), r.settings]));
      missingSince = 0;
    } catch (error) {
      if (error && error.code === "42P01") missingSince = Date.now(); // the migration hasn't run here yet
      else throw error;
    }
  }
  cache.set(orgId, { at: Date.now(), rows });
  return rows;
}

function forget(organizationId) { cache.delete(Number(organizationId)); }

// Whether the class_settings table exists on this database (pages show a note until it does).
async function ready(db) {
  if (tableMissingNow()) return false;
  try { await db.query("SELECT 1 FROM class_settings LIMIT 0"); missingSince = 0; return true; } catch (error) {
    if (error && error.code === "42P01") { missingSince = Date.now(); return false; }
    throw error;
  }
}

// One class's settings.
async function settingsFor(db, organizationId, classId) {
  if (!isOn(organizationId)) return everythingOn();
  const rows = await schoolRows(db, organizationId);
  return withDefaults(rows.get(Number(classId)));
}

// Many classes at once: Map(classId -> settings).
async function settingsForClasses(db, organizationId, classIds) {
  const out = new Map();
  const ids = [...new Set((classIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!isOn(organizationId)) { ids.forEach((id) => out.set(id, everythingOn())); return out; }
  const rows = await schoolRows(db, organizationId);
  ids.forEach((id) => out.set(id, withDefaults(rows.get(id))));
  return out;
}

// Whether something about a student is shared with an audience ("parents" or "students"; key:
// attendance, lunch, reportCards, transport), decided by the student's class (students.class_id).
// A student without a class: the defaults.
async function shared(db, organizationId, studentId, audience, key) {
  if (!isOn(organizationId)) return true;
  const { rows } = await db.query("SELECT class_id FROM students WHERE student_id = $1 AND organization_id = $2", [Number(studentId), Number(organizationId)]);
  const classId = rows[0] && rows[0].class_id;
  const settings = classId ? await settingsFor(db, organizationId, classId) : withDefaults(null);
  return (settings[audience] || {})[key] !== false;
}

// For a list of students (a parent with several children): Map(studentId -> { attendance, lunch, ... }).
async function sharedFor(db, organizationId, studentIds, audience) {
  const out = new Map();
  const ids = [...new Set((studentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return out;
  if (!isOn(organizationId)) { ids.forEach((id) => out.set(id, everythingOn()[audience])); return out; }
  const { rows } = await db.query("SELECT student_id, class_id FROM students WHERE student_id = ANY($1::int[]) AND organization_id = $2", [ids, Number(organizationId)]);
  const byClass = await settingsForClasses(db, organizationId, rows.map((r) => r.class_id));
  const classOf = new Map(rows.map((r) => [Number(r.student_id), Number(r.class_id) || null]));
  ids.forEach((id) => out.set(id, (byClass.get(classOf.get(id)) || withDefaults(null))[audience]));
  return out;
}

// Whether a class's students may use the student portal (every class, while the feature is off).
async function portalOn(db, organizationId, classId) {
  if (!isOn(organizationId)) return true;
  if (!classId) return DEFAULTS.portal;
  return Boolean((await settingsFor(db, organizationId, classId)).portal);
}

const parentsSee = (db, organizationId, studentId, key) => shared(db, organizationId, studentId, "parents", key);
const parentsSeeFor = (db, organizationId, studentIds) => sharedFor(db, organizationId, studentIds, "parents");
const studentsSee = (db, organizationId, studentId, key) => shared(db, organizationId, studentId, "students", key);
const studentsSeeFor = (db, organizationId, studentIds) => sharedFor(db, organizationId, studentIds, "students");

// Turn changes like { "parents.lunch": false, "students.attendance": true, lunch: true } into a
// stored object, keeping only known keys.
function applyChanges(current, changes) {
  const next = withDefaults(current);
  Object.entries(changes || {}).forEach(([key, value]) => {
    // "notices": { absent: { on, count }, late: { on, count } }, any part of it.
    if (key === "notices") {
      if (value && typeof value === "object") NOTICE_KINDS.forEach((kind) => { if (value[kind] && typeof value[kind] === "object") next.notices[kind] = normalizeNotices({ [kind]: { ...next.notices[kind], ...value[kind] } })[kind]; });
      return;
    }
    const on = value === true || value === "true" || value === "on" || value === 1 || value === "1";
    // "lock:<switch>": management locks (or unlocks) a switch for the class.
    if (key.startsWith("lock:")) {
      const target = key.slice(5);
      if (!SWITCH_KEYS.has(target)) return;
      if (on) next.locks[target] = true; else delete next.locks[target];
      return;
    }
    if (!SWITCH_KEYS.has(key)) return;
    const [first, second] = key.split(".");
    if (second) next[first][second] = on;
    else next[first] = on;
  });
  return next;
}

// Saves changes for one or more classes in one statement (one array per column). Two saves at
// once take turns (a per-school lock) and each starts from what the other wrote, so neither is lost.
async function save(db, organizationId, classIds, changes, { userId = null } = {}) {
  const orgId = Number(organizationId);
  const ids = [...new Set((classIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`class-settings:${orgId}`]);
    const { rows: owned } = await client.query("SELECT class_id FROM classes WHERE organization_id = $1 AND class_id = ANY($2::int[])", [orgId, ids]);
    const ownedIds = owned.map((r) => Number(r.class_id));
    if (!ownedIds.length) { await client.query("ROLLBACK"); return []; }
    const { rows: current } = await client.query(
      "SELECT class_id, settings FROM class_settings WHERE organization_id = $1 AND class_id = ANY($2::int[])",
      [orgId, ownedIds]
    );
    const stored = new Map(current.map((r) => [Number(r.class_id), r.settings]));
    const values = ownedIds.map((id) => JSON.stringify(applyChanges(stored.get(id), changes)));
    await client.query(
      `INSERT INTO class_settings (organization_id, class_id, settings, updated_by, updated_at)
       SELECT $1, u.class_id, u.settings::jsonb, $4, NOW()
         FROM unnest($2::int[], $3::text[]) AS u(class_id, settings)
       ON CONFLICT (organization_id, class_id) DO UPDATE
         SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         WHERE class_settings.settings IS DISTINCT FROM EXCLUDED.settings`,
      [orgId, ownedIds, values, userId ? Number(userId) : null]
    );
    await client.query("COMMIT");
    forget(orgId);
    return ownedIds;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// What the signed-in person may manage: { all, classIds } (classIds: a Set, for "own classes").
async function access(db, req) {
  const { userHasPermission, PERMISSIONS, sessionActor } = require("../middleware/permissionMiddleware");
  const organizationId = Number(req.session && req.session.organizationId);
  if (!organizationId || !isOn(organizationId)) return { all: false, classIds: new Set(), on: false };
  const who = sessionActor(req);
  const [all, own] = await Promise.all([
    userHasPermission(db, who, PERMISSIONS.CLASS_SETTINGS_ALL),
    userHasPermission(db, who, PERMISSIONS.CLASS_SETTINGS),
  ]);
  if (all) return { all: true, classIds: null, on: true };
  if (!own) return { all: false, classIds: new Set(), on: true };
  const userId = Number(req.session.userId || (req.session.user && req.session.user.user_id) || 0);
  if (!userId) return { all: false, classIds: new Set(), on: true };
  const whole = await require("./mainTeacher").wholeClassSql(db, "uc");
  const { rows } = await db.query(
    `SELECT uc.class_id FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2
      WHERE uc.user_id = $1 AND ${whole}`,
    [userId, organizationId]
  );
  return { all: false, classIds: new Set(rows.map((r) => Number(r.class_id))), on: true };
}

const canManage = (granted, classId) => Boolean(granted && granted.on && (granted.all || (granted.classIds && granted.classIds.has(Number(classId)))));

module.exports = {
  FEATURE, DEFAULTS, SHARE_ITEMS, AUDIENCES, SWITCHES, isOn, ready, withDefaults, settingsFor, settingsForClasses,
  isLocked, portalOn, shared, sharedFor, parentsSee, parentsSeeFor, studentsSee, studentsSeeFor, applyChanges, save, access, canManage, forget,
  NOTICE_DEFAULTS, NOTICE_MAX, normalizeNotices,
};
