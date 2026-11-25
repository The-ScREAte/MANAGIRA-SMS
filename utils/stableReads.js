"use strict";

// Lookups that every page repeats and that only change when someone saves a setting (the school's
// switches and plan, terms, classes, calendars, class schedules, a person's preferences) are kept
// for a few seconds, per school. A page that used to ask the database for them again and again
// (and every other page of the same school the same second) now asks once.
//
// What makes it safe (each rule has a test in tests/stableReadsSafety.test.js):
//  - Only a SELECT whose every table is on the list below is kept. The statement is read word by
//    word after comments, strings and quoted names are taken apart (utils/sqlScan.js), so a join
//    with anything else (attendance, scores, fees, ...), a view, a function that reads hidden
//    tables, a lock, a clock, a random value or a secret function is never kept.
//  - The key is the school, the statement and every value it was asked with, so one person's rows
//    are never another person's answer (a lookup "by user" carries the user in its values).
//  - A write clears the answers of every table it touches (including tables reached through
//    foreign keys that cascade or set null) for ALL schools, and the school's own answers too; it
//    does so before the writer's next statement, also when the write failed half way. A write in a
//    transaction clears them when the connection is handed back (config/db.js), and the request
//    that opened a transaction reads fresh from then on.
//  - An answer that was being fetched while a write happened is never kept.
//  - An answer is a private copy for each caller; failures are never kept; memory is capped by
//    entries and by bytes.
//  - What other processes write (worker.js, a second server) is seen after at most STABLE_READ_MS.
// STABLE_READ_MS=0 turns all of this off.
const { forgetSchool, generationOf } = require("./shortCache");
const { BoundedMap } = require("./boundedMap");
const sqlScan = require("./sqlScan");

const TTL_MS = process.env.STABLE_READ_MS === undefined ? 15000 : Math.max(0, Number(process.env.STABLE_READ_MS) || 0);
const MAX_ROWS = 300;
const MAX_ENTRY_BYTES = 512 * 1024;
const BUDGET_BYTES = 48 * 1024 * 1024;

const STABLE_TABLES = new Set([
  "organizations", "terms", "school_years", "classes", "subjects", "term_classes", "graduation_year_groups",
  "enrollments", "enrolled_students", "enrolled_classes",
  "organization_attendance_calendars", "class_schedules", "class_schedule_periods", "class_schedule_entries",
  "user_ui_preferences", "report_settings", "score_remarks", "organization_custom_remark_types",
  "contact_field_sections", "contact_fields", "weekly_briefing_settings", "class_settings",
  "features", "plan_features", "feature_routes", "app_demo_capture_windows", "managira_hubs",
  "user_classes", "users", "user_subjects",
  "students", "student_subjects", "guardian_profiles", "guardian_students", "guardians", "assessments",
  // What a teacher or office edits through a page (every such save clears the answers)
  "assessment_question_sets", "assessment_questions", "student_assessment_lock_overrides", "student_reports",
  "school_events", "announcements", "class_activities", "personal_events", "personal_event_tags", "class_lunch",
  "posted_report_cards", "guardian_reports", "pending_students", "pending_student_guardians",
  "finance_bill_assignments", "organization_dashboard", "notification_policies",
  "organization_email_preferences", "user_email_preferences", "api_allowances", "hub_contacts", "sso_connections",
  "plans",
  // Platform price lists and switches: changed only by Managira staff (a save clears every school's answers).
  // Left out on purpose: payments, paystack_subaccounts, dynamic_billing_cycles. The billing jobs (worker.js,
  // another process) write them and a payment lookup must never be a few seconds old.
  "app_settings", "pricing_regions", "pricing_region_countries", "plan_region_prices",
]);

// Tables whose rows go (or change) when a row of another table changes: ON DELETE / UPDATE CASCADE,
// SET NULL, SET DEFAULT (what the database says, load() below), and the trigger entries kept here.
// parent -> children.
// Always included, with what the database says on top. The second group is what triggers do (utils/recordSafety.js):
// a term or school year becoming current, and an enrollment, move students (sync_classes_to_term,
// enrollment_keeps_class). tests/stableReadsSafety.test.js reads every trigger and fails when a new one writes
// another listed table without an entry here.
const FALLBACK_EDGES = [
  ["term_definitions", "terms"], ["assessment_definitions", "assessments"], ["plan_student_tiers", "organizations"],
  ["subject_library", "subjects"], ["finance_bills", "finance_bill_assignments"], ["school_roles", "users"],
  ["hub_users", "hub_contacts"],
  ["terms", "students"], ["school_years", "students"], ["enrolled_students", "students"], ["enrolled_students", "enrolled_classes"],
];
const edgeMap = (pairs) => {
  const map = new Map();
  for (const [parent, child] of pairs) {
    if (!map.has(parent)) map.set(parent, new Set());
    map.get(parent).add(child);
  }
  return map;
};

let known = new Set(); // every table, view and materialized view of the public schema
let userFunctions = new Set(); // functions this app installed (they read or write tables the text doesn't name)
let edges = edgeMap(FALLBACK_EDGES);
let knownAt = 0;
let knownDirty = false; // a create / alter / drop ran in this process and the list isn't re-read yet
let loading = false;
let version = 0; // changes whenever the list above changes: older decisions are asked again

// Read what the database says. `run(sql)` must NOT be a wrapped pool.query (config/db.js passes the raw one).
async function load(run) {
  const [tables, functions, keys] = await Promise.all([
    run("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' UNION SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'"),
    run("SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')"),
    run("SELECT pc.relname AS parent, cc.relname AS child FROM pg_constraint c JOIN pg_class pc ON pc.oid = c.confrelid JOIN pg_class cc ON cc.oid = c.conrelid WHERE c.contype = 'f' AND (c.confdeltype IN ('c', 'n', 'd') OR c.confupdtype IN ('c', 'n', 'd'))"),
  ]);
  known = new Set(tables.rows.map((row) => String(row.name).toLowerCase()));
  userFunctions = new Set(functions.rows.map((row) => String(row.name).toLowerCase()));
  edges = edgeMap([...FALLBACK_EDGES, ...keys.rows.map((row) => [String(row.parent).toLowerCase(), String(row.child).toLowerCase()])]);
  knownAt = Date.now();
  knownDirty = false;
  version += 1;
  decisions.clear();
}

function refreshKnown(run) {
  if (loading || Date.now() - knownAt < 60000) return;
  loading = true;
  load(run)
    .catch(() => { knownAt = Date.now() - 50000; }) // try again in 10 seconds
    .finally(() => { loading = false; });
}

// The listed tables that change when `name` changes: itself, and what hangs on it by foreign keys.
function listedFrom(name, into) {
  const seen = new Set();
  const queue = [name];
  while (queue.length) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (STABLE_TABLES.has(current)) into.add(current);
    for (const child of edges.get(current) || []) queue.push(child);
  }
}

// Words that make a SELECT depend on something other than its text and the tables it names.
const TIME_AND_LUCK = new Set(["now", "current_timestamp", "current_date", "current_time", "localtime", "localtimestamp",
  "clock_timestamp", "statement_timestamp", "transaction_timestamp", "timeofday", "random", "setseed",
  "uuid_generate_v1", "uuid_generate_v4", "current_user", "session_user", "user", "current_role", "current_schema",
  "current_setting", "txid_current"]);
// Passwords and keys travel in the values of these: never held in a key, never kept.
const SECRET_FUNCTIONS = /^(crypt|gen_salt|digest|hmac|encrypt|decrypt|encrypt_iv|decrypt_iv|gen_random_bytes|gen_random_uuid|armor|dearmor|fips_mode|pgp_[a-z_]+)$/;
const TIME_STRING = /'\s*(now|today|tomorrow|yesterday)\s*'/i;
const SCHEMA_QUERY = /\b(information_schema|to_regclass|pg_catalog|pg_trigger|pg_indexes)\b/;
const BROAD_WRITERS = new Set(["sync_classes_to_term", "cleanup_old_email_history"]);

const decisions = new BoundedMap(2000); // statement text -> what it is (see describe)

// What a statement is: whether its answer may be kept (and which tables it names), whether it is a
// write and which listed tables it touches, whether it changes the schema.
let lastLong = null; // a very long statement (an import's bulk insert) is looked at once, not once per question
function describe(sql) {
  const text = typeof sql === "string" ? sql : "";
  const long = text.length > 4000;
  const cached = long ? (lastLong && lastLong.text === text ? lastLong.info : undefined) : decisions.get(text);
  if (cached && cached.version === version) return cached;
  const lower = sqlScan.strip(text).toLowerCase();
  const words = lower.match(/[a-z_][a-z0-9_]*/g) || [];
  const first = words[0] || "";
  const readOnly = sqlScan.readOnlyText(lower);
  const info = { version, first, keep: false, tables: [], schemaFact: false, write: !readOnly, affected: new Set(), broad: false, ddl: /^(create|alter|drop|do)$/.test(first) };
  if (!readOnly) {
    for (const word of words) listedFrom(word, info.affected);
    info.broad = /^(do|call)$/.test(first) || words.some((word) => BROAD_WRITERS.has(word));
  } else if (!TIME_STRING.test(text)) {
    let clean = true;
    for (const word of words) {
      if (TIME_AND_LUCK.has(word) || SECRET_FUNCTIONS.test(word) || userFunctions.has(word)) { clean = false; break; }
    }
    if (clean) {
      const mentioned = [...new Set(words.filter((word) => known.has(word)))];
      if (SCHEMA_QUERY.test(lower)) info.schemaFact = known.size > 0 && mentioned.length === 0;
      else info.keep = !knownDirty && mentioned.length > 0 && mentioned.every((name) => STABLE_TABLES.has(name));
      if (info.keep) info.tables = mentioned;
    }
  }
  if (long) lastLong = { text, info }; else decisions.set(text, info);
  return info;
}

const keepable = (sql) => describe(sql).keep;

// ---- the kept answers ----
// Entries count their size, so a few wide answers can't use up the memory a server has.
class SizedMap extends BoundedMap {
  constructor(max, budget) { super(max); this.bytes = 0; this.budget = budget; }
  set(key, value) {
    super.set(key, value);
    this.bytes += (value && value.bytes) || 0;
    while (this.bytes > this.budget && this.size > 1) this.delete(this.keys().next().value);
    return this;
  }
  delete(key) {
    const value = Map.prototype.get.call(this, key);
    if (value && value.bytes) this.bytes -= value.bytes;
    return super.delete(key);
  }
  clear() { this.bytes = 0; super.clear(); }
}
const kept = new SizedMap(5000, BUDGET_BYTES);
const ANYONE = 0; // the generation every answer, of every school, carries

// A deep copy that keeps what the driver hands out: Buffers (structuredClone would make them plain
// Uint8Arrays, whose toString() is not the text), Dates, and objects of a class (an interval, a point).
function clone(value, depth = 0) {
  if (value === null || typeof value !== "object") return value;
  if (depth > 40) throw new Error("too deep to copy");
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (ArrayBuffer.isView(value)) return value.slice();
  if (Array.isArray(value)) return value.map((item) => clone(item, depth + 1));
  if (value instanceof Map || value instanceof Set || value instanceof Promise) throw new Error("not a plain row value");
  const copyOf = Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value)) copyOf[key] = clone(value[key], depth + 1);
  return copyOf;
}
function copy(result) {
  return { command: result.command, rowCount: result.rowCount, oid: result.oid, fields: result.fields, rows: clone(result.rows) };
}
// A copy, or null when the rows can't be copied (then the answer isn't kept and the caller asks itself).
function tryCopy(result) {
  try { return copy(result); } catch (_) { return null; }
}

// The values a statement was asked with, as text; two askings with different values never share a key.
function valuesKey(values) {
  try {
    return JSON.stringify(values || [], function (name, value) {
      const raw = this[name];
      if (typeof raw === "bigint") return { __big: String(raw) };
      if (typeof raw === "number" && !Number.isFinite(raw)) return { __num: String(raw) };
      if (raw instanceof Date) return { __date: Number.isNaN(raw.getTime()) ? "invalid" : raw.toISOString() };
      if (Buffer.isBuffer(raw)) return { __bytes: raw.toString("base64") };
      return value;
    });
  } catch (_) { return null; }
}

// A read: the answer, or null when this statement isn't one to keep (the caller then runs it).
function read(args, run, store) {
  if (!TTL_MS || !store || !store.schoolId || store.noShared) return null;
  const sql = typeof args[0] === "string" ? args[0] : "";
  if (!sql || typeof args[args.length - 1] === "function" || (args.length > 1 && args[1] !== undefined && !Array.isArray(args[1]))) return null;
  const info = describe(sql);
  if (!info.keep) return null;
  const values = valuesKey(args[1]);
  if (values === null) return null;
  const school = store.schoolId;
  const generation = () => `${generationOf(school)}:${generationOf(ANYONE)}:${info.tables.map((name) => generationOf(`t:${name}`)).join(".")}`;
  const at = generation();
  const key = `${school}:${at}:${sql}\u0000${values}`;
  const hit = kept.get(key);
  if (hit && hit.pending) return hit.pending.then((result) => tryCopy(result) || run());
  if (hit && hit.expires > Date.now()) {
    const answer = tryCopy(hit.value);
    if (answer) return Promise.resolve(answer);
    kept.delete(key);
  } else if (hit) kept.delete(key);
  const pending = run().then((result) => {
    // Kept only if nothing was saved meanwhile, and it is small enough and can be copied.
    let size = 0;
    if (generation() === at && result && Array.isArray(result.rows) && result.rows.length <= MAX_ROWS && tryCopy(result)) {
      try { size = key.length * 2 + JSON.stringify(result.rows).length * 2; } catch (_) { size = Infinity; }
    }
    if (size <= MAX_ENTRY_BYTES && size > 0) kept.set(key, { value: result, expires: Date.now() + TTL_MS, bytes: size });
    else kept.delete(key);
    return result;
  }, (error) => { kept.delete(key); throw error; });
  kept.set(key, { pending });
  return pending.then((result) => tryCopy(result) || result);
}

// ---- writes ----
// The answers of these tables (for every school) and of this school go now. `broad`: it can't be
// told which tables (a DO block, a function that writes): everything goes.
function bump(tables, store, broad) {
  for (const name of tables) forgetSchool(`t:${name}`);
  if (broad || !store || !store.schoolId) forgetSchool(ANYONE); // a visitor's form or a background job: every school's answers go
  else forgetSchool(store.schoolId);
}

function sqlTextOf(sql) {
  if (typeof sql === "string") return sql;
  return sql && typeof sql.text === "string" ? sql.text : "";
}

// What a statement will change, for a connection that keeps a transaction's writes until it commits.
function statementInfo(sql) {
  const info = describe(sqlTextOf(sql));
  return { write: info.write, affected: info.affected, broad: info.broad, ddl: info.ddl, first: info.first };
}

// A statement has run (or failed): when it wrote one of the listed tables the answers go.
function noteWrite(sql, store, result) {
  if (!TTL_MS) return;
  const text = sqlTextOf(sql);
  if (!text) return;
  const info = describe(text);
  if (info.ddl) noteSchemaChange(text);
  if (!info.write || (!info.affected.size && !info.broad)) return;
  // An INSERT / UPDATE / DELETE that matched nothing changed nothing (a failed one is not asked: result is null).
  if (result && result.rowCount === 0 && /^(insert|update|delete)$/.test(info.first) && !info.broad) return;
  bump(info.affected, store, info.broad);
}

// "Is this table / column / trigger there yet?" checks that pages used to run again on every request.
// A "yes" stays a yes (migrations only add), so it is kept for a minute; a "no" is never kept, and any
// statement that creates or alters something in this process clears them all.
const SCHEMA_MS = process.env.STABLE_SCHEMA_MS === undefined ? 60000 : Math.max(0, Number(process.env.STABLE_SCHEMA_MS) || 0);
const schemaFacts = new BoundedMap(500);
const isPositive = (result) => Boolean(result) && Array.isArray(result.rows) && result.rows.length > 0 && result.rows.every((row) => Object.values(row).every((value) => (typeof value === "number" ? value > 0 : typeof value === "string" ? value !== "" && !/^0+$/.test(value) : value === true || (value !== null && typeof value === "object"))));

function readSchema(args, run) {
  if (!SCHEMA_MS) return null;
  const sql = typeof args[0] === "string" ? args[0] : "";
  if (!sql || typeof args[args.length - 1] === "function" || (args.length > 1 && args[1] !== undefined && !Array.isArray(args[1]))) return null;
  if (!describe(sql).schemaFact) return null;
  const values = valuesKey(args[1]);
  if (values === null) return null;
  const key = `${sql}\u0000${values}`;
  const hit = schemaFacts.get(key);
  if (hit && hit.expires > Date.now()) {
    const answer = tryCopy(hit.value);
    if (answer) return Promise.resolve(answer);
  }
  const startedAt = schemaEpoch;
  return run().then((result) => {
    // Not kept when a create / alter / drop ran while it was being asked.
    if (startedAt === schemaEpoch && isPositive(result) && tryCopy(result)) schemaFacts.set(key, { value: result, expires: Date.now() + SCHEMA_MS });
    return result;
  });
}

let schemaEpoch = 0;
// A create / alter / drop (or a DO block) ran in this process: the schema facts and the list of tables are stale.
function noteSchemaChange(sql) {
  if (!/^(create|alter|drop|do)$/.test(describe(sqlTextOf(sql)).first)) return;
  schemaEpoch += 1;
  schemaFacts.clear();
  knownDirty = true;
  knownAt = 0;
  version += 1;
  decisions.clear();
}

// A once-per-process schema statement (config/db.js runSchemaOnce) finished: it may have added
// columns or backfilled rows, so every kept answer goes.
function schemaApplied() {
  schemaEpoch += 1;
  schemaFacts.clear();
  knownDirty = true;
  knownAt = 0;
  version += 1;
  decisions.clear();
  kept.clear();
  forgetSchool(ANYONE);
}

module.exports = {
  readSchema, noteSchemaChange, schemaApplied, read, noteWrite, statementInfo, bump, refreshKnown, load, STABLE_TABLES,
  _keepable: keepable,
  _describe: describe,
  _keptSize: () => ({ entries: kept.size, bytes: kept.bytes }),
  _setKnown: (names, { functions = [], fkEdges } = {}) => {
    known = new Set(names);
    userFunctions = new Set(functions);
    edges = edgeMap([...FALLBACK_EDGES, ...(fkEdges || [])]);
    knownAt = Date.now();
    knownDirty = false;
    version += 1;
    decisions.clear();
  },
};
