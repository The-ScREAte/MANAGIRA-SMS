"use strict";
// Moving a school from another system (feature data_migration). Steps:
//   1 Upload: export files are kept exactly as received (migration_files), so any import can run
//     again from the source.
//   2 Auto-map: every column is matched to a Managira field or one of the school's own student
//     fields: confident, unsure (the school confirms) or can't map.
//   3 Check and import: duplicates, students without parents, missing names, bad dates and
//     orphaned rows are reported, and every mapped value goes into the sandbox
//     (migration_records) with its old system ID, so running it again updates, never duplicates.
//   4 Notes: the school describes each column that can't be mapped; the notes reach the
//     Migration queue in Super Admin.
//   5 The Managira team gives each such column an action: a custom field, an extra field (label
//     and value on the record), an archive (read-only per student) or, with the school's
//     approval, exclude.
//   6 Review: counts and grade totals beside the source; the school approves each area and signs.
//   7 Go live: imports the latest files again, keeps a snapshot, and loads the sandbox into the
//     school's live records: students (enrolled in the current term), parents, staff accounts
//     (on hold until invited), sections as subjects of their classes with their teachers, final
//     grades with credits and GPA (student_course_history, on the transcript) and attendance
//     totals per term (student_attendance_totals, on report cards). migration_links keeps each
//     old ID beside its new one; migration_loaded records every row written, for a rollback.
//   8 Catch-up: one more load for last changes. 30 days later the files, snapshot, sandbox and
//     rollback record go, and the go-live can no longer be rolled back.
// Custody and pickup restrictions always become an alert on the student; SSNs are left out
// unless the school confirms a legal need. Every step is logged (migration_events).

const crypto = require("crypto");
const Papa = require("papaparse");
const features = require("./shards/features");
const { BoundedMap } = require("./boundedMap");
const ps = require("./migration/powerschool");
const roles = require("./migration/roles");
const { PERMISSIONS_SAVED_KEY, invalidateUserPermissionCache } = require("../middleware/permissionMiddleware");

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 200000;
const KEEP_DAYS = 30;
const SECTIONS = ["students", "guardians", "staff", "roles", "classes", "enrollments", "grades", "attendance", "custom_fields", "archive"];
const SECTION_LABELS = { students: "Students", guardians: "Parents & guardians", staff: "Staff accounts", roles: "Staff roles (the role report)", classes: "Sections & teachers", enrollments: "Class enrollments", grades: "Final grades", attendance: "Attendance", custom_fields: "Custom and extra fields", archive: "Archive" };
const ACTIONS = ["map", "custom", "extra", "archive", "exclude", "alert"];
const SENSITIVE_LABELS = { custody: "Custody or pickup restriction", ssn: "Social Security number", sped: "Special education", medical: "Medical", discipline: "Discipline" };
// Whole modules Managira doesn't run yet: their columns are kept read-only per student.
const ARCHIVE_MODULES = ["Special education", "Health records", "Transportation", "Fees", "Library", "Discipline", "Grades history", "Attendance history", "Other"];

const featureOn = (organizationId) => features.isOn("data_migration", { organizationId: Number(organizationId) || null });

const TABLES = ["migration_jobs", "migration_files", "migration_columns", "migration_records", "migration_links", "migration_events", "migration_snapshots", "record_extra_fields",
  "migration_archives", "student_alerts", "student_course_history", "student_attendance_totals", "migration_loaded", "account_mfa",
  "migration_roles", "staff_role_history", "staff_role_changes", "staff_access_seen", "student_source_gpas"];
let tablesReady = false;
let lastCheck = 0;
// The database updates have run (2026-11-27_data_migration, 2026-11-28_migration_core,
// 2026-11-29_staff_roles_assistant, 2026-11-30_gpa_backups).
async function ready(db) {
  if (tablesReady || Date.now() - lastCheck < 60000) return tablesReady;
  lastCheck = Date.now();
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[]))::int AS tables,
            (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema()
                AND ((table_name = 'migration_links' AND column_name = 'job_id') OR (table_name = 'migration_jobs' AND column_name = 'role_approvals')
                  OR (table_name = 'student_course_history' AND column_name = 'gpa_added_value')))::int AS cols`,
    [TABLES]
  ).catch(() => ({ rows: [{ tables: 0, cols: 0 }] }));
  tablesReady = Number(rows[0].tables) === TABLES.length && Number(rows[0].cols) === 3;
  return tablesReady;
}

// ── The log ─────────────────────────────────────────────────────────────────────────────
function event(db, { jobId = null, organizationId, actor = null, actorKind = "school", action, detail = null, ip = null }) {
  return db.query(
    "INSERT INTO migration_events (job_id, organization_id, actor, actor_kind, action, detail, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [jobId, organizationId, actor, actorKind, action, detail ? JSON.stringify(detail) : null, ip]
  ).catch((error) => console.error("[Migration] log:", error.message));
}

// ── The migration of a school ───────────────────────────────────────────────────────────
async function openJob(db, organizationId) {
  const { rows } = await db.query(
    "SELECT * FROM migration_jobs WHERE organization_id = $1 AND status IN ('sandbox', 'review', 'live') ORDER BY job_id DESC LIMIT 1",
    [organizationId]
  );
  return rows[0] || null;
}

// The banner and the lock, read once per school every 30 seconds (every page asks).
const lockCache = new BoundedMap(2000);
const forget = (organizationId) => lockCache.delete(Number(organizationId));
async function stateFor(db, organizationId) {
  const key = Number(organizationId);
  if (!key) return null;
  const hit = lockCache.get(key);
  if (hit && Date.now() - hit.at < 30000) return hit.value;
  let value = null;
  if (await ready(db)) {
    const job = await openJob(db, key).catch(() => null);
    value = job ? { jobId: job.job_id, status: job.status, locked: job.locked && ["sandbox", "review"].includes(job.status) } : null;
  }
  lockCache.set(key, { at: Date.now(), value });
  return value;
}

async function startJob(db, organizationId, actor) {
  const existing = await openJob(db, organizationId);
  if (existing) return existing;
  const { rows: [job] } = await db.query("INSERT INTO migration_jobs (organization_id, created_by) VALUES ($1, $2) RETURNING *", [organizationId, actor]);
  forget(organizationId);
  await event(db, { jobId: job.job_id, organizationId, actor, actorKind: "managira", action: "sandbox_on" });
  return job;
}

// Off only once the school is live (it closes) or the migration was cancelled.
async function stopJob(db, organizationId, actor, { cancel = false } = {}) {
  const job = await openJob(db, organizationId);
  if (!job) return { ok: true };
  if (["sandbox", "review"].includes(job.status) && !cancel) return { error: "The migration isn't finished. Cancel it first, or go live." };
  if (cancel && job.status === "live") return { error: "This school is already live. Turn the sandbox off instead." };
  if (cancel) {
    await db.query("DELETE FROM migration_records WHERE job_id = $1", [job.job_id]);
    await db.query("UPDATE migration_files SET content = NULL WHERE job_id = $1", [job.job_id]);
  }
  await db.query("UPDATE migration_jobs SET status = $2, locked = FALSE, updated_at = NOW() WHERE job_id = $1", [job.job_id, cancel ? "cancelled" : "closed"]);
  forget(organizationId);
  await event(db, { jobId: job.job_id, organizationId, actor, actorKind: "managira", action: cancel ? "cancelled" : "sandbox_off" });
  return { ok: true };
}

// ── 1. Files ────────────────────────────────────────────────────────────────────────────
function parse(text) {
  const result = Papa.parse(String(text || "").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => String(h || "").trim() });
  const header = (result.meta.fields || []).filter(Boolean);
  return { header, rows: result.data.slice(0, MAX_ROWS) };
}

async function addFile(db, job, { name, buffer, entity = null, actor }) {
  if (!buffer || !buffer.length) return { error: "That file is empty." };
  if (buffer.length > MAX_FILE_BYTES) return { error: "Files can be up to 30 MB. Export a smaller part at a time." };
  const text = buffer.toString("utf8");
  if (/\u0000/.test(text.slice(0, 2000))) return { error: "That isn't a CSV file. Export it from PowerSchool as CSV." };
  const { header, rows } = parse(text);
  if (header.length < 2 || !rows.length) return { error: "No columns or rows were found. Check it's a CSV export with a heading row." };
  const kind = ps.ENTITIES[entity] ? entity : ps.detectEntity(header);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  // The file a new one replaces stays, unchanged, until the clean-up.
  await db.query("UPDATE migration_files SET replaced_at = NOW() WHERE job_id = $1 AND entity = $2 AND replaced_at IS NULL", [job.job_id, kind]);
  const { rows: [file] } = await db.query(
    `INSERT INTO migration_files (job_id, organization_id, entity, file_name, sha256, size_bytes, row_count, header, content, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING file_id, entity, file_name, row_count`,
    [job.job_id, job.organization_id, kind, String(name || "export.csv").slice(0, 200), sha256, buffer.length, rows.length, JSON.stringify(header), buffer, actor]
  );
  await autoMap(db, job, kind, header, rows);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "file_uploaded", detail: { file: file.file_name, entity: kind, rows: rows.length, sha256 } });
  return { file };
}

async function currentFiles(db, job) {
  const { rows } = await db.query(
    "SELECT file_id, entity, file_name, row_count, header, uploaded_at, uploaded_by, size_bytes FROM migration_files WHERE job_id = $1 AND replaced_at IS NULL AND content IS NOT NULL ORDER BY file_id",
    [job.job_id]
  );
  return rows;
}
async function fileRows(db, fileId) {
  const { rows } = await db.query("SELECT content FROM migration_files WHERE file_id = $1", [fileId]);
  return rows[0] && rows[0].content ? parse(rows[0].content.toString("utf8")).rows : [];
}

// ── 2. Auto-map ─────────────────────────────────────────────────────────────────────────
const customFieldsOf = async (db, organizationId) => (await db.query(
  "SELECT field_id, label, field_type FROM student_form_fields WHERE organization_id = $1 AND status = 'active' ORDER BY position", [organizationId]
).catch(() => ({ rows: [] }))).rows;

async function autoMap(db, job, entity, header, rows) {
  const custom = await customFieldsOf(db, job.organization_id);
  const { rows: had } = await db.query("SELECT source_column, confirmed, action, target FROM migration_columns WHERE job_id = $1 AND entity = $2", [job.job_id, entity]);
  const kept = new Map(had.map((row) => [row.source_column, row]));
  const taken = new Set(had.filter((row) => row.confirmed && row.target && !row.target.startsWith("custom:")).map((row) => row.target));
  for (const column of header) {
    const samples = [...new Set(rows.slice(0, 500).map((row) => String(row[column] == null ? "" : row[column]).trim()).filter(Boolean))].slice(0, 5);
    const sensitive = ps.sensitiveOf(column, samples);
    const before = kept.get(column);
    if (before && (before.confirmed || before.action)) {
      await db.query("UPDATE migration_columns SET samples = $3::jsonb, sensitive = COALESCE(sensitive, $4) WHERE job_id = $1 AND entity = $5 AND source_column = $2", [job.job_id, column, JSON.stringify(samples), sensitive, entity]);
      continue;
    }
    const match = sensitive === "custody" || sensitive === "ssn" ? { target: null, confidence: "none" } : ps.matchColumn(entity, column, custom, taken);
    if (match.target && !match.target.startsWith("custom:")) taken.add(match.target);
    // Custody always becomes an alert; an SSN is left out unless the school confirms a legal need.
    const action = sensitive === "custody" ? "alert" : sensitive === "ssn" ? "exclude" : match.confidence === "confident" ? "map" : null;
    await db.query(
      `INSERT INTO migration_columns (job_id, organization_id, entity, source_column, target, confidence, confirmed, samples, sensitive, action, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT (job_id, entity, source_column) DO UPDATE SET target = EXCLUDED.target, confidence = EXCLUDED.confidence, confirmed = EXCLUDED.confirmed,
         samples = EXCLUDED.samples, sensitive = EXCLUDED.sensitive, action = EXCLUDED.action, label = EXCLUDED.label`,
      [job.job_id, job.organization_id, entity, column, match.target, match.confidence, match.confidence === "confident", JSON.stringify(samples), sensitive, action,
        sensitive === "custody" ? prettyLabel(column) : null]
    );
  }
}
const prettyLabel = (column) => String(column).replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 80);

async function columnsOf(db, job) {
  const { rows } = await db.query("SELECT * FROM migration_columns WHERE job_id = $1 ORDER BY entity, column_id", [job.job_id]);
  return rows;
}

// The school confirms or corrects an unsure match ("none": it can't be mapped).
async function confirmColumn(db, job, columnId, target, actor) {
  const { rows: [column] } = await db.query("SELECT * FROM migration_columns WHERE job_id = $1 AND column_id = $2", [job.job_id, columnId]);
  if (!column) return { error: "That column isn't in this migration." };
  if (column.sensitive === "custody") return { error: "Custody and pickup restrictions always become an alert on the student." };
  const fields = ps.ENTITIES[column.entity].fields;
  const custom = target && target.startsWith("custom:") ? (await customFieldsOf(db, job.organization_id)).some((f) => `custom:${f.field_id}` === target) : false;
  const valid = target === "none" || fields[target] || custom;
  if (!valid) return { error: "Choose a field from the list." };
  await db.query(
    "UPDATE migration_columns SET target = $3, confirmed = TRUE, confidence = $4, action = $5, resolved_by = $6, resolved_at = NOW() WHERE job_id = $1 AND column_id = $2",
    [job.job_id, columnId, target === "none" ? null : target, target === "none" ? "none" : column.confidence === "none" ? "unsure" : column.confidence, target === "none" ? null : "map", actor]
  );
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "column_confirmed", detail: { column: column.source_column, target } });
  return { ok: true };
}

// ── 4. Notes from the school ────────────────────────────────────────────────────────────
const NOTE_KEYS = ["what", "who", "often", "required", "rules"];
async function saveNotes(db, job, columnId, raw, actor) {
  const notes = Object.fromEntries(NOTE_KEYS.map((key) => [key, String((raw || {})[key] || "").trim().slice(0, 1000)]));
  if (!notes.what) return { error: "Say what the column is." };
  const { rowCount } = await db.query("UPDATE migration_columns SET notes = $3::jsonb, notes_at = NOW() WHERE job_id = $1 AND column_id = $2 AND action IS NULL", [job.job_id, columnId, JSON.stringify(notes)]);
  if (!rowCount) return { error: "That column already has an action." };
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "notes_sent", detail: { columnId } });
  return { ok: true };
}

// The school approves leaving a column out, or confirms a legal need to keep an SSN.
async function approveExclude(db, job, columnId, userId, actor) {
  const { rowCount } = await db.query("UPDATE migration_columns SET exclude_approved_by = $3, exclude_approved_at = NOW() WHERE job_id = $1 AND column_id = $2 AND action = 'exclude'", [job.job_id, columnId, userId]);
  if (rowCount) await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "exclude_approved", detail: { columnId } });
  return rowCount ? { ok: true } : { error: "That column isn't waiting to be left out." };
}
async function legalNeed(db, job, columnId, userId, actor) {
  const { rows: [column] } = await db.query("SELECT * FROM migration_columns WHERE job_id = $1 AND column_id = $2 AND sensitive = 'ssn'", [job.job_id, columnId]);
  if (!column) return { error: "That isn't a Social Security number column." };
  await db.query("UPDATE migration_columns SET action = 'extra', label = $3, legal_need_by = $4, exclude_approved_at = NULL, exclude_approved_by = NULL WHERE column_id = $2 AND job_id = $1",
    [job.job_id, columnId, prettyLabel(column.source_column), userId]);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "ssn_legal_need", detail: { column: column.source_column } });
  return { ok: true };
}

// ── 5. The Managira team gives each column an action ────────────────────────────────────
async function resolveColumn(db, job, columnId, { action, label, module, fieldType }, actor) {
  const { rows: [column] } = await db.query("SELECT * FROM migration_columns WHERE job_id = $1 AND column_id = $2", [job.job_id, columnId]);
  if (!column) return { error: "That column isn't in this migration." };
  if (column.sensitive === "custody" && action !== "alert") return { error: "Custody and pickup restrictions can't be archived or left out: they become an alert on the student." };
  if (!["custom", "extra", "archive", "exclude", "alert"].includes(action)) return { error: "Choose an action." };
  if (action === "alert" && column.sensitive !== "custody") return { error: "Alerts are for custody and pickup restrictions." };
  const name = String(label || (column.notes && column.notes.what) || prettyLabel(column.source_column)).trim().slice(0, 80) || prettyLabel(column.source_column);
  if (action === "custom") {
    if (column.entity !== "students") return { error: "Custom fields are for student files. Use an extra field for this one." };
    const fields = require("./studentFormFields");
    try {
      const type = ["text", "long_text", "number", "date", "yes_no"].includes(fieldType) ? fieldType : "text";
      await fields.createField(db, job.organization_id, { label: name, type, helpText: column.notes && column.notes.rules ? String(column.notes.rules).slice(0, 200) : "", onStudentForm: true, section: "more" }, null);
    } catch (error) {
      if (!/already a field/.test(error.message)) return { error: error.message };
    }
    const created = (await customFieldsOf(db, job.organization_id)).find((f) => f.label.toLowerCase() === name.toLowerCase());
    await db.query("UPDATE migration_columns SET action = 'map', target = $3, confirmed = TRUE, label = $4, resolved_by = $5, resolved_at = NOW() WHERE job_id = $1 AND column_id = $2",
      [job.job_id, columnId, `custom:${created.field_id}`, name, actor]);
  } else {
    await db.query(
      `UPDATE migration_columns SET action = $3, label = $4, target = NULL, resolved_by = $5, resolved_at = NOW(),
              exclude_approved_at = CASE WHEN $3 = 'exclude' THEN exclude_approved_at ELSE NULL END
        WHERE job_id = $1 AND column_id = $2`,
      [job.job_id, columnId, action, action === "archive" ? (ARCHIVE_MODULES.includes(module) ? module : "Other") : name, actor]
    );
  }
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, actorKind: "managira", action: "column_resolved", detail: { column: column.source_column, action, label: name } });
  return { ok: true };
}

// What still needs someone: unsure matches (the school), notes (the school), actions (Managira),
// approvals to leave a column out (the school).
function openItems(columns) {
  const unsure = columns.filter((c) => c.confidence === "unsure" && !c.confirmed && !c.action);
  // Can't map: no match at all, or the school said the suggested one is wrong.
  const unmapped = columns.filter((c) => !c.action && (c.confidence === "none" || (c.confirmed && !c.target)));
  return {
    unsure,
    needNotes: unmapped.filter((c) => !c.notes),
    needAction: unmapped,
    needApproval: columns.filter((c) => c.action === "exclude" && !c.exclude_approved_at),
  };
}

// ── 3. Import into the sandbox, with the checks ─────────────────────────────────────────
const DATE_RX = [[/^(\d{4})-(\d{1,2})-(\d{1,2})/, (m) => [m[1], m[2], m[3]]], [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [m[3], m[1], m[2]]], [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, (m) => [Number(m[3]) > 30 ? `19${m[3]}` : `20${m[3]}`, m[1], m[2]]]];
function isoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  for (const [rx, parts] of DATE_RX) {
    const m = text.match(rx);
    if (!m) continue;
    const [y, mo, d] = parts(m).map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y > 1900 && y < 2100) return date.toISOString().slice(0, 10);
    return "invalid";
  }
  return "invalid";
}
const num = (value) => { const n = Number(String(value == null ? "" : value).replace(/[^0-9.\-]/g, "")); return String(value || "").trim() && Number.isFinite(n) ? n : null; };
const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);
const hashId = (...parts) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
const splitName = (full) => {
  const text = clean(full, 200);
  if (text.includes(",")) { const [last, first] = text.split(",").map((s) => s.trim()); return [first || "", last || ""]; }
  const parts = text.split(/\s+/);
  return [parts.slice(0, -1).join(" ") || parts[0] || "", parts.length > 1 ? parts[parts.length - 1] : ""];
};

// GPA as schools work it out: grade points weighted by the credits attempted (earned when
// that's all there is, so a failed course still counts); equal weights without credits.
function gpaOf(rows) {
  const scored = rows.filter((r) => r.gpa !== null && r.gpa !== undefined && Number.isFinite(Number(r.gpa)));
  if (!scored.length) return null;
  const weight = (r) => Number(r.attempted ?? r.earned ?? 0);
  const weighted = scored.filter((r) => weight(r) > 0);
  if (weighted.length) return round(weighted.reduce((sum, r) => sum + Number(r.gpa) * weight(r), 0) / weighted.reduce((sum, r) => sum + weight(r), 0));
  return round(scored.reduce((sum, r) => sum + Number(r.gpa), 0) / scored.length);
}
// Days of attendance in a row: a day with its code, or a row of totals. Tardy counts as present
// and tardy; excused as absent and excused; a code we don't know as absent.
const TOTAL_FIELDS = ["days_present", "days_absent", "days_excused", "days_tardy"];
function addAttendance(sum, data) {
  if (!data.date && TOTAL_FIELDS.some((f) => num(data[f]) !== null)) {
    for (const f of TOTAL_FIELDS) sum[f.slice(5)] += num(data[f]) || 0;
    return;
  }
  if (!data.date) return;
  const kind = ps.attendanceKind(data.code, data.present) || "absent";
  if (kind === "present" || kind === "tardy") sum.present += 1; else sum.absent += 1;
  if (kind === "tardy") sum.tardy += 1;
  if (kind === "excused") sum.excused += 1;
}
const HOMEROOM = /\bhome\s*room\b|\badvis(ory|ement)\b/i;
// A class enrollment that still holds: not dropped (PowerSchool makes a dropped one's section
// negative) and not over.
function currentEnrollment(data, today = new Date().toISOString().slice(0, 10)) {
  const section = String(data.section_source_id || "");
  const left = isoDate(data.date_left);
  return Boolean(section) && !section.startsWith("-") && !(left && left !== "invalid" && left < today);
}

// Every record of every current file, with its issues; nothing is written yet.
async function buildRecords(db, job) {
  const files = await currentFiles(db, job);
  const columns = await columnsOf(db, job);
  const byEntity = {};
  const source = { rows: {}, credits: 0, grades: [], attendance: { present: 0, absent: 0, excused: 0, tardy: 0 } };
  for (const file of files) {
    const cols = columns.filter((c) => c.entity === file.entity);
    const rows = await fileRows(db, file.file_id);
    source.rows[file.entity] = (source.rows[file.entity] || 0) + rows.length;
    const out = (byEntity[file.entity] = byEntity[file.entity] || []);
    rows.forEach((row, index) => {
      const data = {};
      const extra = {};
      const archive = {};
      const alerts = {};
      const custom = {};
      for (const c of cols) {
        const value = clean(row[c.source_column], 4000);
        if (!value) continue;
        const mapped = c.action === "map" && c.target && (c.confirmed || c.confidence === "confident");
        if (mapped && c.target.startsWith("custom:")) custom[c.target.slice(7)] = value;
        else if (mapped) data[c.target] = value;
        else if (c.action === "extra") extra[c.label || prettyLabel(c.source_column)] = { value, sensitive: Boolean(c.sensitive) };
        else if (c.action === "archive") (archive[c.label || "Other"] = archive[c.label || "Other"] || {})[prettyLabel(c.source_column)] = value;
        else if (c.action === "alert") alerts[c.label || prettyLabel(c.source_column)] = value;
      }
      if (file.entity === "grades") {
        const credits = num(data.credits);
        if (credits !== null) source.credits += credits;
        source.grades.push({ gpa: num(data.gpa_points), attempted: num(data.credits_attempted), earned: credits });
      }
      if (file.entity === "attendance") addAttendance(source.attendance, data);
      if (Object.keys(custom).length) data.custom = custom;
      // Staff and class roles keep the row exactly as exported (bar columns left out), for their role history.
      if (file.entity === "staff" || file.entity === "section_teachers") {
        data._raw = Object.fromEntries(cols.filter((c) => c.action !== "exclude").map((c) => [c.source_column, row[c.source_column] == null ? "" : String(row[c.source_column])]));
      }
      if (Object.keys(alerts).length) data.alerts = alerts;
      let id = clean(data.source_id, 120);
      if (!id && ["grades", "attendance"].includes(file.entity)) id = hashId(data.student_source_id, data.course_name, data.term, data.date, data.code, index);
      if (!id && file.entity === "guardians") id = hashId(data.student_source_id, data.email, data.full_name, data.first_name, data.last_name);
      if (!id && file.entity === "enrollments") id = hashId(data.student_source_id, data.section_source_id, data.term);
      if (!id && file.entity === "section_teachers") id = hashId(data.section_source_id, data.teacher_source_id, data.class_role, data.start_date, index);
      if (!id && file.entity === "student_gpas") id = hashId(data.student_source_id, data.as_of, index);
      out.push({ entity: file.entity, sourceId: id, line: index + 2, data, extra, archive, issues: [] });
    });
  }
  // Parents listed in the student file become parent records of their own.
  for (const student of byEntity.students || []) {
    for (const n of [1, 2]) {
      const name = student.data[`guardian${n}_name`];
      const email = student.data[`guardian${n}_email`];
      const phone = student.data[`guardian${n}_phone`];
      if (!name && !email && !phone) continue;
      (byEntity.guardians = byEntity.guardians || []).push({
        entity: "guardians", sourceId: `${student.data.source_id || student.sourceId}:p${n}`, line: student.line, fromStudent: true,
        data: { student_source_id: student.data.source_id, full_name: name, email, phone, relationship: n === 1 ? "Parent" : "Parent" }, extra: {}, archive: {}, issues: [],
      });
    }
  }
  check(byEntity);
  return { byEntity, source, files, columns };
}

function check(byEntity) {
  const add = (record, kind, text, blocking = false) => record.issues.push({ kind, text, blocking });
  const students = byEntity.students || [];
  const studentIds = new Set(students.map((s) => s.data.source_id).filter(Boolean));
  const seen = new Map();
  const people = new Map();
  for (const s of students) {
    if (!s.sourceId) add(s, "missing", "No student number.", true);
    if (!s.data.first_name || !s.data.last_name) add(s, "missing", "No first or last name.", true);
    if (s.data.date_of_birth && isoDate(s.data.date_of_birth) === "invalid") add(s, "date", `Date of birth "${s.data.date_of_birth}" isn't a date.`);
    if (s.sourceId) { if (seen.has(s.sourceId)) add(s, "duplicate", `Student number ${s.sourceId} is also on line ${seen.get(s.sourceId)}.`, true); else seen.set(s.sourceId, s.line); }
    const person = [s.data.first_name, s.data.last_name, s.data.date_of_birth].map((v) => String(v || "").toLowerCase()).join("|");
    if (s.data.first_name && s.data.date_of_birth) { if (people.has(person)) add(s, "duplicate", `Same name and date of birth as line ${people.get(person)}.`); else people.set(person, s.line); }
  }
  const withParent = new Set((byEntity.guardians || []).map((g) => g.data.student_source_id));
  for (const s of students) if (s.data.source_id && !withParent.has(s.data.source_id)) add(s, "no_parent", "No parent or guardian.");
  for (const g of byEntity.guardians || []) {
    if (!studentIds.has(g.data.student_source_id)) add(g, "orphan", `Student number ${g.data.student_source_id || "(none)"} isn't in the students file.`, true);
    if (!g.data.email && !g.data.phone) add(g, "missing", "No email or phone.");
    if (!g.data.full_name && !g.data.first_name && !g.data.last_name) add(g, "missing", "No name.", true);
  }
  const staffIds = new Set((byEntity.staff || []).map((t) => t.data.source_id).filter(Boolean));
  const emails = new Map();
  for (const t of byEntity.staff || []) {
    if (!t.data.first_name || !t.data.last_name) add(t, "missing", "No first or last name.", true);
    const email = String(t.data.email || "").trim().toLowerCase();
    if (!email) add(t, "no_email", "No email, so no Managira account can be made for them.");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) add(t, "no_email", `"${t.data.email}" isn't an email address, so no account can be made.`);
    else if (emails.has(email)) add(t, "duplicate", `Email ${email} is also on line ${emails.get(email)}: one account is made.`);
    else emails.set(email, t.line);
  }
  const sectionIds = new Set((byEntity.classes || []).map((c) => c.data.source_id).filter(Boolean));
  const enrolledSections = new Set((byEntity.enrollments || []).filter((e) => currentEnrollment(e.data)).map((e) => e.data.section_source_id));
  for (const c of byEntity.classes || []) {
    if (!c.data.class_name) add(c, "missing", "No course name.", true);
    if (c.data.teacher_source_id && staffIds.size && !staffIds.has(c.data.teacher_source_id)) add(c, "orphan", `Teacher ${c.data.teacher_source_id} isn't in the staff file.`);
    if (!c.data.grade_level && !enrolledSections.has(c.data.source_id)) add(c, "unplaced", `Can't tell which class takes ${c.data.class_name || "it"}: add the grade level to the sections file, or upload class enrollments.`);
  }
  for (const e of byEntity.enrollments || []) {
    if (!studentIds.has(e.data.student_source_id)) add(e, "orphan", `Student number ${e.data.student_source_id || "(none)"} isn't in the students file.`, true);
    if (sectionIds.size && !sectionIds.has(e.data.section_source_id)) add(e, "orphan", `Section ${e.data.section_source_id || "(none)"} isn't in the sections file.`);
  }
  const GPA_FIELDS = ["gpa_weighted", "gpa_unweighted", "gpa_value"];
  for (const r of [...students, ...(byEntity.student_gpas || [])]) {
    for (const f of GPA_FIELDS) if (r.data[f] && (num(r.data[f]) === null || num(r.data[f]) < 0 || num(r.data[f]) > 20)) add(r, "gpa", `GPA "${r.data[f]}" isn't a number: it's left out.`);
    if (r.entity === "student_gpas" && !studentIds.has(r.data.student_source_id)) add(r, "orphan", `Student number ${r.data.student_source_id || "(none)"} isn't in the students file.`, true);
  }
  for (const r of byEntity.section_teachers || []) {
    if (staffIds.size && !staffIds.has(r.data.teacher_source_id)) add(r, "orphan", `Staff number ${r.data.teacher_source_id || "(none)"} isn't in the staff file.`);
    if (sectionIds.size && !sectionIds.has(r.data.section_source_id)) add(r, "orphan", `Section ${r.data.section_source_id || "(none)"} isn't in the sections file.`);
    for (const f of ["start_date", "end_date"]) if (r.data[f] && isoDate(r.data[f]) === "invalid") add(r, "date", `"${r.data[f]}" isn't a date.`);
  }
  for (const r of [...(byEntity.grades || []), ...(byEntity.attendance || [])]) {
    if (!studentIds.has(r.data.student_source_id)) add(r, "orphan", `Student number ${r.data.student_source_id || "(none)"} isn't in the students file.`, true);
    if (r.entity === "grades" && !r.data.course_name) add(r, "missing", "No course.", true);
    if (r.entity !== "attendance") continue;
    const totals = TOTAL_FIELDS.some((f) => num(r.data[f]) !== null);
    if (!r.data.date && !totals) add(r, "missing", "No date and no totals.", true);
    else if (r.data.date && isoDate(r.data.date) === "invalid") add(r, "date", `"${r.data.date}" isn't a date.`, true);
    else if (r.data.date && ps.attendanceKind(r.data.code, r.data.present) === null) add(r, "code", `Code "${r.data.code}" isn't one we know: it counts as absent.`);
  }
}

// Writes the sandbox: every record upserted by its old ID, anything no longer in the files
// removed (so test edits and stale rows never reach go-live). One statement per kind.
async function runImport(db, job, actor) {
  const { byEntity, source, files } = await buildRecords(db, job);
  if (!files.length) return { error: "Upload at least one file first." };
  // An email another school (or Managira) already uses can't be a second account.
  const staffEmails = [...new Set((byEntity.staff || []).map((t) => String(t.data.email || "").trim().toLowerCase()).filter(Boolean))];
  if (staffEmails.length) {
    const { rows } = await db.query(
      `SELECT LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1::text[]) AND organization_id IS DISTINCT FROM $2
       UNION SELECT LOWER(email) FROM organizations WHERE LOWER(email) = ANY($1::text[])`,
      [staffEmails, job.organization_id]
    );
    const taken = new Set(rows.map((r) => r.email));
    for (const t of byEntity.staff || []) {
      const email = String(t.data.email || "").trim().toLowerCase();
      if (taken.has(email)) t.issues.push({ kind: "email", text: `${email} is already used by another Managira account, so no account is made for them here.`, blocking: false });
    }
  }
  const report = { entities: {}, issues: {}, examples: [] };
  for (const entity of Object.keys(ps.ENTITIES)) {
    // One record per old ID: a repeated ID keeps its first row (the repeat is in the check report).
    const seenIds = new Set();
    const list = (byEntity[entity] || []).filter((r) => r.sourceId && !seenIds.has(r.sourceId) && seenIds.add(r.sourceId));
    const ids = list.map((r) => r.sourceId);
    if (list.length) {
      await db.query(
        `INSERT INTO migration_records (job_id, organization_id, entity, source_id, data, extra, archive, issues)
         SELECT $1, $2, $3, x.id, x.data, x.extra, x.archive, x.issues
           FROM unnest($4::text[], $5::jsonb[], $6::jsonb[], $7::jsonb[], $8::jsonb[]) AS x(id, data, extra, archive, issues)
         ON CONFLICT (job_id, entity, source_id) DO UPDATE SET data = EXCLUDED.data, extra = EXCLUDED.extra, archive = EXCLUDED.archive, issues = EXCLUDED.issues, updated_at = NOW()`,
        [job.job_id, job.organization_id, entity, ids, list.map((r) => JSON.stringify(r.data)), list.map((r) => JSON.stringify(r.extra)), list.map((r) => JSON.stringify(r.archive)), list.map((r) => JSON.stringify(r.issues))]
      );
    }
    await db.query("DELETE FROM migration_records WHERE job_id = $1 AND entity = $2 AND NOT (source_id = ANY($3::text[]))", [job.job_id, entity, ids]);
    report.entities[entity] = { source: source.rows[entity] || 0, staged: list.length };
    for (const r of byEntity[entity] || []) {
      for (const issue of r.issues) {
        const key = `${entity}:${issue.kind}`;
        report.issues[key] = (report.issues[key] || 0) + 1;
        if (report.examples.filter((e) => e.key === key).length < 8) report.examples.push({ key, entity, line: r.line, sourceId: r.sourceId, text: issue.text, blocking: issue.blocking });
      }
    }
  }
  const totals = { ...job.totals, report, source: { credits: round(source.credits), gpa: gpaOf(source.grades), attendance: source.attendance }, importedAt: new Date().toISOString() };
  await db.query("UPDATE migration_jobs SET totals = $2::jsonb, updated_at = NOW() WHERE job_id = $1", [job.job_id, JSON.stringify(totals)]);
  job.totals = totals;
  await refreshRoles(db, job, byEntity.staff || []);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "imported", detail: { entities: report.entities } });
  return { report };
}
const round = (n) => Math.round(n * 100) / 100;

// What the sandbox holds, for the screen: counts, totals, a few rows of each kind.
async function sandboxSummary(db, job) {
  const NUM = "'^-?[0-9]+(\\.[0-9]+)?$'";
  const { rows } = await db.query(
    `SELECT entity, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE jsonb_array_length(issues) > 0)::int AS with_issues
       FROM migration_records WHERE job_id = $1 GROUP BY entity`,
    [job.job_id]
  );
  const out = Object.fromEntries(rows.map((r) => [r.entity, { count: r.n, withIssues: r.with_issues }]));
  if (out.grades) {
    const { rows: g } = await db.query(
      `SELECT CASE WHEN data->>'gpa_points' ~ ${NUM} THEN (data->>'gpa_points')::numeric END AS gpa,
              CASE WHEN data->>'credits_attempted' ~ ${NUM} THEN (data->>'credits_attempted')::numeric END AS attempted,
              CASE WHEN data->>'credits' ~ ${NUM} THEN (data->>'credits')::numeric END AS earned
         FROM migration_records WHERE job_id = $1 AND entity = 'grades'`,
      [job.job_id]
    );
    const list = g.map((r) => ({ gpa: r.gpa === null ? null : Number(r.gpa), attempted: r.attempted === null ? null : Number(r.attempted), earned: r.earned === null ? null : Number(r.earned) }));
    out.grades.credits = round(list.reduce((sum, r) => sum + (r.earned || 0), 0));
    out.grades.gpa = gpaOf(list);
  }
  const { rows: sample } = await db.query(
    `SELECT entity, source_id, data FROM (SELECT entity, source_id, data, ROW_NUMBER() OVER (PARTITION BY entity ORDER BY record_id) AS n FROM migration_records WHERE job_id = $1) x WHERE n <= 5`,
    [job.job_id]
  );
  return { counts: out, sample };
}

// ── 3b. Staff roles ─────────────────────────────────────────────────────────────────────
// Each old role or access group (the access group, else the title) of the active staff, with
// how many have it, matched to a Managira role (utils/migration/roles.js). Refreshed with each
// import; a role no longer in the files goes.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const oldRoleOf = (d) => clean(d.access_group, 120) || clean(d.title, 120);
async function refreshRoles(db, job, staff) {
  const counts = new Map();
  for (const t of staff) {
    const role = oldRoleOf(t.data);
    if (role && roles.isActive(t.data.status)) counts.set(role, (counts.get(role) || 0) + 1);
  }
  const known = new Set((await db.query("SELECT old_role FROM migration_roles WHERE job_id = $1", [job.job_id])).rows.map((r) => r.old_role));
  for (const [role, n] of counts) {
    if (known.has(role)) {
      await db.query("UPDATE migration_roles SET staff_count = $3, updated_at = NOW() WHERE job_id = $1 AND old_role = $2", [job.job_id, role, n]);
    } else {
      const m = roles.matchRole(role);
      await db.query(
        "INSERT INTO migration_roles (job_id, organization_id, old_role, staff_count, level, target, confidence) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (job_id, old_role) DO NOTHING",
        [job.job_id, job.organization_id, role, n, m.level, m.target, m.confidence]
      );
    }
  }
  await db.query("DELETE FROM migration_roles WHERE job_id = $1 AND NOT (old_role = ANY($2::text[]))", [job.job_id, [...counts.keys()]]);
}
const rolesOf = async (db, job) => (await db.query("SELECT * FROM migration_roles WHERE job_id = $1 ORDER BY staff_count DESC, old_role", [job.job_id])).rows;
// A role's state on screen: ready (matched), unsure (the school confirms) or waiting (Managira).
function roleState(row) {
  const choice = roles.choiceOf(row);
  const check = roles.compare(row.level, choice);
  const state = !row.target ? "waiting" : row.confidence === "unsure" && !row.confirmed ? "unsure" : "ready";
  return { ...row, choice, ...check, state };
}

// The school confirms an unsure match, or picks a more limited built-in role for any match.
async function confirmRole(db, job, roleId, target, actor) {
  const { rows: [row] } = await db.query("SELECT * FROM migration_roles WHERE job_id = $1 AND role_id = $2", [job.job_id, roleId]);
  if (!row) return { error: "That role isn't in this migration." };
  if (!row.target) return { error: "The Managira team gives this role its match first." };
  const keep = target === "custom" && row.target === "custom";
  if (!keep && !roles.ROLES[target]) return { error: "Choose a role from the list." };
  await db.query("UPDATE migration_roles SET target = $3, confirmed = TRUE, updated_at = NOW() WHERE job_id = $1 AND role_id = $2", [job.job_id, roleId, keep ? "custom" : target]);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "role_confirmed", detail: { role: row.old_role, target } });
  return { ok: true };
}
// What a role nobody could match does at the school, for the Managira team.
async function roleNotes(db, job, roleId, body, actor) {
  const notes = { what: clean(body.what, 1000), who: clean(body.who, 1000) };
  if (!notes.what) return { error: "Say what the role lets people do." };
  const { rowCount } = await db.query("UPDATE migration_roles SET notes = $3::jsonb, updated_at = NOW() WHERE job_id = $1 AND role_id = $2 AND target IS NULL", [job.job_id, roleId, JSON.stringify(notes)]);
  if (!rowCount) return { error: "That role already has a match." };
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "role_notes_sent", detail: { roleId } });
  return { ok: true };
}
// The Managira team: what the old role gave, and its Managira role (built-in or custom).
async function resolveRole(db, job, roleId, body, actor) {
  const { rows: [row] } = await db.query("SELECT * FROM migration_roles WHERE job_id = $1 AND role_id = $2", [job.job_id, roleId]);
  if (!row) return { error: "That role isn't in this migration." };
  const level = roles.LEVELS[body.level] ? body.level : null;
  if (!level) return { error: "Say what the role gave in the old system." };
  if (body.target === "custom") {
    const label = clean(body.label, 60);
    const accountType = roles.ACCOUNT_TYPES.includes(body.accountType) ? body.accountType : null;
    const allowed = new Set(roles.pickable().map((o) => o.key));
    const permissions = [...new Set([].concat(body.permissions || []).map(String).filter((k) => allowed.has(k)))];
    if (!label || !accountType) return { error: "A custom role needs a name and an account type." };
    await db.query(
      `UPDATE migration_roles SET level = $3, target = 'custom', label = $4, account_type = $5, permissions = $6::jsonb, confirmed = TRUE, resolved_by = $7, resolved_at = NOW(), updated_at = NOW()
        WHERE job_id = $1 AND role_id = $2`,
      [job.job_id, roleId, level, label, accountType, JSON.stringify(permissions), actor]
    );
  } else {
    if (!roles.ROLES[body.target]) return { error: "Choose a Managira role." };
    await db.query("UPDATE migration_roles SET level = $3, target = $4, label = NULL, account_type = NULL, permissions = NULL, confirmed = TRUE, resolved_by = $5, resolved_at = NOW(), updated_at = NOW() WHERE job_id = $1 AND role_id = $2",
      [job.job_id, roleId, level, body.target, actor]);
  }
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, actorKind: "managira", action: "role_resolved", detail: { role: row.old_role, level, target: body.target } });
  return { ok: true };
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const heldNow = (start, end, today = todayIso()) => {
  const a = isoDate(start); const b = isoDate(end);
  return !(a && a !== "invalid" && a > today) && !(b && b !== "invalid" && b < today);
};
// The role report: one row per member of staff, their old role, Managira role, schools, classes
// and what they can do, flagged when their access goes up, is admin-level, or they have no role.
async function roleReport(db, job) {
  const records = async (entity) => (await db.query("SELECT source_id, data FROM migration_records WHERE job_id = $1 AND entity = $2 ORDER BY record_id", [job.job_id, entity])).rows;
  const [staff, sections, classRoles, roleRows] = [await records("staff"), await records("classes"), await records("section_teachers"), (await rolesOf(db, job)).map(roleState)];
  const emails = [...new Set(staff.map((t) => clean(t.data.email, 200).toLowerCase()).filter(Boolean))];
  const { rows: users } = emails.length ? await db.query(
    "SELECT LOWER(email) AS email, organization_id FROM users WHERE LOWER(email) = ANY($1::text[]) UNION ALL SELECT LOWER(email), -1 FROM organizations WHERE LOWER(email) = ANY($1::text[])",
    [emails]
  ) : { rows: [] };
  const mine = new Set(users.filter((u) => Number(u.organization_id) === Number(job.organization_id)).map((u) => u.email));
  const elsewhere = new Set(users.filter((u) => Number(u.organization_id) !== Number(job.organization_id)).map((u) => u.email));
  const course = new Map(sections.map((s) => [String(s.source_id), clean(s.data.class_name, 100) || String(s.source_id)]));
  const byRole = new Map(roleRows.map((r) => [r.old_role, r]));
  const approvals = job.role_approvals || {};
  const people = staff.map((t) => {
    const d = t.data;
    const email = clean(d.email, 200).toLowerCase();
    const active = roles.isActive(d.status);
    const oldRole = oldRoleOf(d);
    const row = oldRole ? byRole.get(oldRole) : null;
    const choice = row && row.state !== "waiting" ? row.choice : null;
    const existing = mine.has(email);
    const noAccount = !existing && (!EMAIL_FORMAT.test(email) ? "No email" : elsewhere.has(email) ? "Email used by another Managira account" : null);
    const classes = [
      ...sections.filter((s) => s.data.teacher_source_id && String(s.data.teacher_source_id) === String(d.source_id)).map((s) => ({ name: course.get(String(s.source_id)), as: "Lead teacher", now: true })),
      ...classRoles.filter((c) => String(c.data.teacher_source_id) === String(d.source_id)).map((c) => ({
        name: course.get(String(c.data.section_source_id)) || String(c.data.section_source_id), as: roles.isCoTeacher(c.data.class_role) ? "Co-teacher" : "Lead teacher",
        from: c.data.start_date || "", to: c.data.end_date || "", now: heldNow(c.data.start_date, c.data.end_date),
      })),
    ];
    // The same class role from both files (the sections file's teacher, and its class roles) once.
    const seenClass = new Set();
    const uniqueClasses = classes.filter((c) => { const k = `${c.name}|${c.as}|${c.from || ""}`; if (seenClass.has(k)) return false; seenClass.add(k); return true; });
    const getsAccount = active && !existing && !noAccount;
    const key = choice ? `${oldRole}|${choice.key}` : null;
    const needsApproval = Boolean(getsAccount && choice && (row.up.length || row.adminLevel));
    return {
      sourceId: String(t.source_id), name: [d.first_name, d.last_name].filter(Boolean).join(" ") || String(t.source_id), email, active, oldRole: oldRole || "",
      newRole: choice ? choice.label : null, accountType: choice ? choice.accountType : null, schools: roles.schoolsOf(d.schools), classes: uniqueClasses,
      can: existing ? "Keeps the access they have in Managira" : getsAccount ? roles.summary(choice) : "", up: getsAccount && choice ? row.up : [], adminLevel: Boolean(getsAccount && choice && row.adminLevel),
      existing, noAccount, noRole: active && !existing && !noAccount && !choice, needsApproval, key,
      approved: needsApproval && approvals[t.source_id] && approvals[t.source_id].key === key ? approvals[t.source_id] : null,
    };
  });
  return {
    roles: roleRows,
    people,
    open: {
      unsure: roleRows.filter((r) => r.state === "unsure"),
      waiting: roleRows.filter((r) => r.state === "waiting"),
      noRole: people.filter((p) => p.noRole),
      toApprove: people.filter((p) => p.needsApproval && !p.approved),
    },
  };
}
// The school admin approves (or takes back) one person's flagged access: kept with the role it
// was given, so a changed match needs approving again.
async function approvePerson(db, job, sourceId, on, actor) {
  const person = (await roleReport(db, job)).people.find((p) => p.sourceId === String(sourceId));
  if (!person || !person.needsApproval) return { error: "That person doesn't need an approval." };
  const approvals = { ...(job.role_approvals || {}) };
  if (on) approvals[person.sourceId] = { key: person.key, by: actor, at: new Date().toISOString() }; else delete approvals[person.sourceId];
  await db.query("UPDATE migration_jobs SET role_approvals = $2::jsonb, signed_at = NULL, signed_name = NULL, updated_at = NOW() WHERE job_id = $1", [job.job_id, JSON.stringify(approvals)]);
  job.role_approvals = approvals;
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: on ? "role_approved" : "role_unapproved", detail: { sourceId: person.sourceId, role: person.newRole, up: person.up, adminLevel: person.adminLevel } });
  return { ok: true };
}

// Each student's GPA from the old system beside the one Managira works out from their final
// grades (credits attempted as weights; an honors/AP course's added value in the weighted one).
// The old system's stays on the transcript either way: a difference usually means grades left
// out of the export, or a weighting Managira doesn't know.
async function gpaCheck(db, job) {
  const rowsOf = async (entity) => (await db.query("SELECT source_id, data FROM migration_records WHERE job_id = $1 AND entity = $2", [job.job_id, entity])).rows;
  const [students, gpaFile, grades] = [await rowsOf("students"), await rowsOf("student_gpas"), await rowsOf("grades")];
  const names = new Map(students.map((r) => [String(r.data.source_id || r.source_id), [r.data.first_name, r.data.last_name].filter(Boolean).join(" ")]));
  const source = new Map();
  const take = (id, d) => {
    const g = { weighted: num(d.gpa_weighted), unweighted: num(d.gpa_unweighted), gpa: num(d.gpa_value) };
    if (g.weighted === null && g.unweighted === null && g.gpa === null) return;
    source.set(String(id), { ...(source.get(String(id)) || {}), ...Object.fromEntries(Object.entries(g).filter(([, v]) => v !== null)) });
  };
  students.forEach((r) => take(r.data.source_id || r.source_id, r.data));
  gpaFile.forEach((r) => take(r.data.student_source_id, r.data));
  const courses = new Map();
  for (const r of grades) {
    const id = String(r.data.student_source_id);
    if (!courses.has(id)) courses.set(id, []);
    courses.get(id).push({ points: num(r.data.gpa_points), added: num(r.data.gpa_added_value), attempted: num(r.data.credits_attempted), earned: num(r.data.credits) });
  }
  const close = (a, b) => a !== null && a !== undefined && b !== null && Math.abs(Number(a) - Number(b)) <= 0.01;
  const list = [...source].map(([id, src]) => {
    const rows = courses.get(id) || [];
    const unweighted = gpaOf(rows.map((c) => ({ gpa: c.points, attempted: c.attempted, earned: c.earned })));
    const weighted = gpaOf(rows.map((c) => ({ gpa: c.points === null ? null : c.points + (c.points > 0 && c.added > 0 ? c.added : 0), attempted: c.attempted, earned: c.earned })));
    const differs = [];
    if (src.weighted !== undefined && !close(src.weighted, weighted)) differs.push("weighted");
    if (src.unweighted !== undefined && !close(src.unweighted, unweighted)) differs.push("unweighted");
    if (src.gpa !== undefined && !close(src.gpa, unweighted) && !close(src.gpa, weighted)) differs.push("GPA");
    return { sourceId: id, name: names.get(id) || id, source: src, managira: { weighted, unweighted }, courses: rows.length, differs };
  });
  return { checked: list.length, differ: list.filter((g) => g.differs.length), matching: list.filter((g) => !g.differs.length).length };
}

// ── 6. Review and sign-off ──────────────────────────────────────────────────────────────
async function approveSection(db, job, section, on, actor) {
  if (!SECTIONS.includes(section)) return { error: "Unknown area." };
  const approvals = { ...(job.approvals || {}) };
  if (on) approvals[section] = { by: actor, at: new Date().toISOString() }; else delete approvals[section];
  await db.query("UPDATE migration_jobs SET approvals = $2::jsonb, signed_at = NULL, signed_name = NULL, updated_at = NOW() WHERE job_id = $1", [job.job_id, JSON.stringify(approvals)]);
  job.approvals = approvals;
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: on ? "section_approved" : "section_unapproved", detail: { section } });
  return { ok: true };
}

// What still stops go-live, in words.
async function blockers(db, job) {
  const columns = await columnsOf(db, job);
  const open = openItems(columns);
  const out = [];
  if (!(await currentFiles(db, job)).length) out.push("Upload the export files.");
  if (open.unsure.length) out.push(`Confirm ${open.unsure.length} unsure ${open.unsure.length === 1 ? "match" : "matches"}.`);
  if (open.needAction.length) out.push(`${open.needAction.length} ${open.needAction.length === 1 ? "column needs" : "columns need"} an action from the Managira team.`);
  if (open.needApproval.length) out.push(`Approve leaving out ${open.needApproval.length} ${open.needApproval.length === 1 ? "column" : "columns"}.`);
  const blocking = ((job.totals && job.totals.report && job.totals.report.examples) || []).filter((e) => e.blocking).length;
  if (blocking) out.push("Fix the errors in the check report (red) in the export, upload it again and import.");
  const present = new Set((await currentFiles(db, job)).map((f) => f.entity));
  const needed = SECTIONS.filter((s) => (ps.ENTITIES[s] ? present.has(s) : s === "roles" ? present.has("staff") : s === "custom_fields" ? columns.some((c) => c.target && c.target.startsWith("custom:") || c.action === "extra") : columns.some((c) => c.action === "archive") || present.has("attendance")));
  if (present.has("staff")) {
    const { open: roleOpen } = await roleReport(db, job);
    const n = (list, one, many) => `${list.length} ${list.length === 1 ? one : many}`;
    if (roleOpen.unsure.length) out.push(`Confirm ${n(roleOpen.unsure, "unsure role match", "unsure role matches")} (Staff roles).`);
    if (roleOpen.waiting.length) out.push(`${n(roleOpen.waiting, "role needs", "roles need")} a Managira role: explain ${roleOpen.waiting.length === 1 ? "it" : "them"} in Staff roles; the Managira team then matches ${roleOpen.waiting.length === 1 ? "it" : "them"}.`);
    if (roleOpen.noRole.length) out.push(`${n(roleOpen.noRole, "active member of staff has", "active members of staff have")} no role: give them one in your export, or mark them inactive.`);
    if (roleOpen.toApprove.length) out.push(`Approve ${n(roleOpen.toApprove, "person whose", "people whose")} access goes up or is admin-level (Staff roles).`);
  }
  if (present.has("students") && !(await db.query("SELECT 1 FROM terms WHERE organization_id = $1 AND current = TRUE LIMIT 1", [job.organization_id])).rowCount) {
    out.push("Set up your current school year and term (Management › School years), so the students can be enrolled in it.");
  }
  const missing = needed.filter((s) => !(job.approvals || {})[s]);
  if (missing.length) out.push(`Approve: ${missing.map((s) => SECTION_LABELS[s]).join(", ")}.`);
  return { list: out, needed, columns };
}

async function sign(db, job, name, userId, actor) {
  const { list } = await blockers(db, job);
  if (list.length) return { error: list[0] };
  const signed = String(name || "").trim().slice(0, 120);
  if (signed.length < 3) return { error: "Type your full name to sign." };
  await db.query("UPDATE migration_jobs SET signed_name = $2, signed_by = $3, signed_at = NOW(), status = 'review', updated_at = NOW() WHERE job_id = $1", [job.job_id, signed, userId]);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "signed", detail: { name: signed } });
  forget(job.organization_id);
  return { ok: true };
}

// The migration summary the school signs: every column by what happened to it.
function summary(columns, customFields = []) {
  const groups = { mapped: [], custom: [], extra: [], archived: [], excluded: [], alerts: [] };
  for (const c of columns) {
    const where = `${ps.ENTITIES[c.entity] ? ps.ENTITIES[c.entity].label : c.entity}: ${c.source_column}`;
    if (c.action === "map" && c.target && c.target.startsWith("custom:")) groups.custom.push(`${where} → ${ps.targetLabel(c.entity, c.target, customFields)}`);
    else if (c.action === "map" && c.target) groups.mapped.push(`${where} → ${ps.targetLabel(c.entity, c.target)}`);
    else if (c.action === "extra") groups.extra.push(`${where} → ${c.label}${c.sensitive ? " (restricted)" : ""}`);
    else if (c.action === "archive") groups.archived.push(`${where} → ${c.label}`);
    else if (c.action === "exclude") groups.excluded.push(where);
    else if (c.action === "alert") groups.alerts.push(`${where} → alert on the student`);
  }
  return groups;
}

// ── 7. Go live, 8. catch-up ─────────────────────────────────────────────────────────────
const gradeClass = (value) => {
  const text = clean(value, 80);
  if (/^-?\d+$/.test(text)) { const n = Number(text); return n === 0 ? "Kindergarten" : n < 0 ? "Pre-K" : `Grade ${n}`; }
  if (/^k$/i.test(text)) return "Kindergarten";
  return text;
};
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The role an imported member of staff starts with, from their title. Never a Manager: the
// school chooses those itself.
const roleOf = (title) => {
  const text = String(title || "");
  if (/\b(principal|dean|director|head ?(of ?school|master|mistress|teacher)|superintendent|supervisor)\b/i.test(text)) return "Supervisor";
  if (/\b(bus|driver)\b/i.test(text)) return "Driver";
  return "Teacher";
};
const fit = (n, max) => (n === null || !Number.isFinite(n) || Math.abs(n) > max ? null : n);
// The school year a day belongs to (August to July), as Managira writes it: "2026-2027".
const yearOfDate = (iso) => { const y = Number(iso.slice(0, 4)); return Number(iso.slice(5, 7)) >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };

// The school's live tables a go-live writes, each with its key. A rollback deletes the rows it
// made in this order (whatever points at a row goes first) and puts back the ones it changed.
const LOADED = {
  student_field_values: ["field_id", "student_id"],
  enrolled_students: ["enrolled_student_id"],
  enrolled_classes: ["enrolled_class_id"],
  guardians: ["guardian_id"],
  guardian_students: ["guardian_id", "student_id"],
  user_subjects: ["user_id", "subject_id"],
  user_classes: ["user_id", "class_id"],
  students: ["student_id"],
  guardian_profiles: ["guardian_id"],
  subjects: ["subject_id"],
  users: ["user_id"],
  classes: ["class_id"],
  enrollments: ["enrollment_id"],
};
// The migration's own tables: every row it writes there carries its job_id.
const OWN = ["student_course_history", "student_attendance_totals", "record_extra_fields", "student_alerts", "migration_archives", "migration_links", "staff_role_history", "student_source_gpas"];

// What a load writes into live tables, saved to migration_loaded in one statement at its end.
async function ledgerFor(client, job) {
  const keyOf = (table, key) => `${table}|${LOADED[table].map((c) => Number(key[c])).join(",")}`;
  const tidy = (table, key) => Object.fromEntries(LOADED[table].map((c) => [c, Number(key[c])]));
  const prior = new Map((await client.query("SELECT table_name, row_key, created FROM migration_loaded WHERE job_id = $1", [job.job_id])).rows
    .filter((r) => LOADED[r.table_name]).map((r) => [keyOf(r.table_name, r.row_key), r.created]));
  const fresh = new Map();
  return {
    // A row this load has just made.
    made(table, key) {
      const k = keyOf(table, key);
      if (!prior.has(k) && !fresh.has(k)) fresh.set(k, { table, key: tidy(table, key), created: true, before: null });
    },
    // Before a row is written: one this migration didn't make keeps its values until now
    // (once); one that isn't there yet is about to be made.
    async before(table, key, columns) {
      const k = keyOf(table, key);
      if (prior.has(k) || fresh.has(k)) return;
      const cols = LOADED[table];
      const { rows: [hit] } = await client.query(
        `SELECT to_jsonb(r) AS row FROM (SELECT ${columns.join(", ")} FROM ${table} WHERE ${cols.map((c, i) => `${c} = $${i + 1}`).join(" AND ")}) r`,
        cols.map((c) => key[c])
      );
      fresh.set(k, { table, key: tidy(table, key), created: !hit, before: hit ? hit.row : null });
    },
    mine(table, key) { const k = keyOf(table, key); return prior.get(k) === true || Boolean(fresh.get(k) && fresh.get(k).created); },
    async save() {
      if (!fresh.size) return;
      const list = [...fresh.values()];
      await client.query(
        `INSERT INTO migration_loaded (job_id, organization_id, table_name, row_key, created, before)
         SELECT $1, $2, x.t, x.k, x.c, x.b FROM unnest($3::text[], $4::jsonb[], $5::boolean[], $6::jsonb[]) AS x(t, k, c, b)
         ON CONFLICT (job_id, table_name, row_key) DO NOTHING`,
        [job.job_id, job.organization_id, list.map((e) => e.table), list.map((e) => JSON.stringify(e.key)), list.map((e) => e.created), list.map((e) => (e.before ? JSON.stringify(e.before) : null))]
      );
    },
  };
}

// Loads the sandbox into the school's live records. Every record finds its earlier self by its
// old ID (migration_links), so a second load updates; nothing is ever loaded twice. One
// transaction: it all goes in, or nothing does.
async function loadLive(db, job, actor) {
  const org = job.organization_id;
  const system = job.source_system;
  const client = await db.connect();
  const counts = {
    students: 0, enrolled: 0, guardians: 0, classes: 0, subjects: 0, staff: 0, staffNew: 0, staffInactive: 0, teacherLinks: 0, mainTeachers: 0, assistants: 0, sectionsUnplaced: 0,
    courses: 0, credits: 0, gpa: null, attendanceTerms: 0, attendance: { present: 0, absent: 0, excused: 0, tardy: 0 }, customValues: 0, extras: 0, alerts: 0, archives: 0,
  };
  const staffSkipped = [];
  try {
    await client.query("BEGIN");
    const q = (sql, args) => client.query(sql, args);
    const ledger = await ledgerFor(client, job);
    const records = async (entity) => (await q("SELECT source_id, data, extra, archive FROM migration_records WHERE job_id = $1 AND entity = $2 ORDER BY record_id", [job.job_id, entity])).rows;
    const linkOf = async (entity, sourceId) => (await q("SELECT managira_id FROM migration_links WHERE organization_id = $1 AND entity = $2 AND source_system = $3 AND source_id = $4", [org, entity, system, String(sourceId)])).rows[0];
    const link = (entity, sourceId, id) => q(
      `INSERT INTO migration_links (organization_id, entity, source_system, source_id, managira_id, job_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, entity, source_system, source_id) DO UPDATE SET managira_id = EXCLUDED.managira_id, job_id = EXCLUDED.job_id, updated_at = NOW()`,
      [org, entity, system, String(sourceId), id, job.job_id]
    );
    const extraOn = (entity, id, label, item) => q(
      `INSERT INTO record_extra_fields (organization_id, entity, record_id, label, value, sensitive, source, job_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, entity, record_id, label) DO UPDATE SET value = EXCLUDED.value, sensitive = EXCLUDED.sensitive, job_id = EXCLUDED.job_id, updated_at = NOW()`,
      [org, entity, id, label.slice(0, 80), clean(item.value, 4000), Boolean(item.sensitive), system, job.job_id]
    ).then(() => { counts.extras += 1; });

    // Classes: by name, or a new one ("Grade 6" for a grade level of 6).
    const classIds = new Map((await q("SELECT class_id, LOWER(class_name) AS name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL", [org])).rows.map((r) => [r.name, r.class_id]));
    const classFor = async (name) => {
      const label = gradeClass(name);
      if (!label) return null;
      if (classIds.has(label.toLowerCase())) return classIds.get(label.toLowerCase());
      const { rows: [row] } = await q("INSERT INTO classes (class_name, organization_id) VALUES ($1, $2) RETURNING class_id", [label.slice(0, 100), org]);
      ledger.made("classes", { class_id: row.class_id });
      classIds.set(label.toLowerCase(), row.class_id);
      counts.classes += 1;
      return row.class_id;
    };

    // The current term: every imported student is enrolled in it, in their class.
    const { rows: [term] } = await q("SELECT term_id, school_year_id FROM terms WHERE organization_id = $1 AND current = TRUE ORDER BY start_date DESC NULLS LAST, term_id DESC LIMIT 1", [org]);
    let enrollmentId = null;
    if (term) {
      enrollmentId = ((await q("SELECT enrollment_id FROM enrollments WHERE organization_id = $1 AND term_id = $2 ORDER BY enrollment_id LIMIT 1", [org, term.term_id])).rows[0] || {}).enrollment_id || null;
      if (!enrollmentId) {
        ({ rows: [{ enrollment_id: enrollmentId }] } = await q("INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING enrollment_id", [term.school_year_id, term.term_id, org]));
        ledger.made("enrollments", { enrollment_id: enrollmentId });
      }
    }
    const termClasses = new Set();
    const enroll = async (studentId, classId) => {
      if (!enrollmentId || !classId) return;
      if (!termClasses.has(classId)) {
        termClasses.add(classId);
        const { rows: [row] } = await q("INSERT INTO enrolled_classes (enrollment_id, class_id) VALUES ($1, $2) ON CONFLICT (enrollment_id, class_id) DO NOTHING RETURNING enrolled_class_id", [enrollmentId, classId]);
        if (row) ledger.made("enrolled_classes", { enrolled_class_id: row.enrolled_class_id });
      }
      const { rows: [had] } = await q("SELECT enrolled_student_id, class_id FROM enrolled_students WHERE enrollment_id = $1 AND student_id = $2", [enrollmentId, studentId]);
      if (!had) {
        const { rows: [row] } = await q("INSERT INTO enrolled_students (enrollment_id, student_id, class_id) VALUES ($1, $2, $3) RETURNING enrolled_student_id", [enrollmentId, studentId, classId]);
        ledger.made("enrolled_students", { enrolled_student_id: row.enrolled_student_id });
      } else if (Number(had.class_id) !== Number(classId)) {
        await ledger.before("enrolled_students", { enrolled_student_id: had.enrolled_student_id }, ["class_id"]);
        await q("UPDATE enrolled_students SET class_id = $2 WHERE enrolled_student_id = $1", [had.enrolled_student_id, classId]);
      }
      counts.enrolled += 1;
    };

    // Staff: an account each, matched by old ID, then by email in this school, with the role their
    // old role was matched to (its account type and permissions, saved: utils/migration/roles.js).
    // A new account is on hold (it can't sign in) until the school invites them. An account the
    // school already had keeps its access. Inactive staff get no account: only their history.
    const staffIds = new Map();
    const staffRows = await records("staff");
    const roleByOld = new Map((await q("SELECT * FROM migration_roles WHERE job_id = $1", [job.job_id])).rows.map((r) => [r.old_role, r]));
    const history = [];
    const touched = new Set();
    const savePermissions = async (userId, keys) => {
      await q("DELETE FROM user_permissions WHERE user_id = $1 AND organization_id = $2", [userId, org]);
      await q("INSERT INTO user_permissions (user_id, organization_id, permission_key) SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING", [userId, org, [...new Set([...keys, PERMISSIONS_SAVED_KEY])]]);
      touched.add(userId);
    };
    const logRole = (userId, oldValue, newValue) => q(
      "INSERT INTO staff_role_changes (organization_id, user_id, changed_by, what, old_value, new_value) VALUES ($1, $2, 'Data migration', 'role', $3, $4)",
      [org, userId, JSON.stringify(oldValue), JSON.stringify(newValue)]
    );
    for (const t of staffRows) {
      const d = t.data;
      const first = clean(d.first_name, 100);
      const last = clean(d.last_name, 100);
      const email = clean(d.email, 200).toLowerCase();
      const name = [first, last].filter(Boolean).join(" ") || t.source_id;
      const active = roles.isActive(d.status);
      const oldRole = oldRoleOf(d);
      const roleRow = oldRole ? roleByOld.get(oldRole) : null;
      let choice = roleRow && roleRow.target && (roleRow.confidence !== "unsure" || roleRow.confirmed) ? roles.choiceOf(roleRow) : null;
      // More access than before, or admin-level, only with the school admin's approval of this
      // person for this role (checked here too: a catch-up isn't signed again).
      const rise = choice ? roles.compare(roleRow.level, choice) : null;
      const approval = (job.role_approvals || {})[t.source_id];
      const waitingApproval = Boolean(rise && (rise.up.length || rise.adminLevel) && !(approval && approval.key === `${oldRole}|${choice.key}`));
      if (waitingApproval) choice = null;
      let id = null;
      const known = await linkOf("staff", t.source_id);
      if (known && (await q("SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2", [known.managira_id, org])).rowCount) id = known.managira_id;
      if (!id && email) id = ((await q("SELECT user_id FROM users WHERE LOWER(email) = $1 AND organization_id = $2 ORDER BY user_id LIMIT 1", [email, org])).rows[0] || {}).user_id || null;
      const mine = id && ledger.mine("users", { user_id: id });
      if (active && mine && choice) {
        // An account this migration made follows the files, role included.
        const { rows: [was] } = await q("SELECT account_type::text AS role FROM users WHERE user_id = $1", [id]);
        await q("UPDATE users SET first_name = $2, last_name = $3, org_role_title = $4, phone_number = COALESCE($5, phone_number), account_type = $6, updated_at = NOW() WHERE user_id = $1",
          [id, first || "Unknown", last || "Unknown", clean(d.title, 120) || null, clean(d.phone, 40) || null, choice.accountType]);
        await savePermissions(id, choice.permissions);
        if (was && was.role !== choice.accountType) await logRole(id, was.role, `${choice.label} (${choice.accountType})`);
      }
      if (!id && active) {
        if (!email || !EMAIL_RX.test(email)) staffSkipped.push({ name, why: "No email" });
        else if (!choice) staffSkipped.push({ name, email, why: waitingApproval ? "Waiting for the school admin's approval" : "No role" });
        else if ((await q("SELECT 1 FROM users WHERE LOWER(email) = $1 UNION ALL SELECT 1 FROM organizations WHERE LOWER(email) = $1 LIMIT 1", [email])).rowCount) staffSkipped.push({ name, email, why: "Email used by another Managira account" });
        else {
          ({ rows: [{ user_id: id }] } = await q(
            `INSERT INTO users (first_name, last_name, email, account_type, organization_id, on_hold, phone_number, org_role_title, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, NOW(), NOW()) RETURNING user_id`,
            [first || "Unknown", last || "Unknown", email, choice.accountType, org, clean(d.phone, 40) || null, clean(d.title, 120) || null]
          ));
          ledger.made("users", { user_id: id });
          await savePermissions(id, choice.permissions);
          await logRole(id, null, `${choice.label} (${choice.accountType})`);
          counts.staffNew += 1;
        }
      }
      if (!active) counts.staffInactive += 1;
      // Their old roles, as exported: read-only on their profile (an inactive one's by email).
      const base = { userId: id || null, sourceId: String(t.source_id), email: email || null, name, active };
      history.push({ ...base, kind: "role", value: oldRole || null, detail: d._raw || {} });
      for (const school of roles.schoolsOf(d.schools)) history.push({ ...base, kind: "school", value: school, detail: { school } });
      if (id && active) {
        const made = ledger.mine("users", { user_id: id }) && choice;
        history.push({ ...base, kind: "mapped", value: made ? choice.label : "Kept their Managira access", detail: { from: oldRole, accountType: made ? choice.accountType : null, can: made ? roles.summary(choice) : null } });
      }
      if (!id) continue;
      await link("staff", t.source_id, id);
      if (active) { staffIds.set(String(t.source_id), id); counts.staff += 1; }
      for (const [label, item] of Object.entries(t.extra || {})) await extraOn("staff", id, label, item);
    }
    // Staff columns kept as an archive: one read-only list for the school.
    const staffArchive = staffRows.filter((t) => Object.keys(t.archive || {}).length).map((t) => ({ "Staff number": t.source_id, Name: [t.data.first_name, t.data.last_name].filter(Boolean).join(" "), ...flat(t.archive) }));
    if (staffArchive.length) await keepArchive(client, job, null, "Staff (old system)", staffArchive, counts, true);

    // Students
    const studentIds = new Map();
    const studentClass = new Map();
    for (const s of await records("students")) {
      const d = s.data;
      const dob = isoDate(d.date_of_birth);
      const address = [d.address, [d.city, [d.state, d.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
      const classId = await classFor(d.class_name);
      const values = [clean(d.first_name, 100) || "Unknown", clean(d.last_name, 100) || "Unknown", dob && dob !== "invalid" ? dob : null, clean(d.gender, 20) || null,
        classId, clean(d.email, 200) || null, address, clean(d.source_id, 50)];
      const known = await linkOf("students", s.source_id);
      let id;
      if (known && (await q("SELECT 1 FROM students WHERE student_id = $1 AND organization_id = $2", [known.managira_id, org])).rowCount) {
        id = known.managira_id;
        await ledger.before("students", { student_id: id }, ["first_name", "last_name", "date_of_birth", "date_of_birth_unknown", "gender", "class_id", "email", "address", "custom_student_id"]);
        await q(
          `UPDATE students SET first_name = $3, last_name = $4, date_of_birth = $5, date_of_birth_unknown = ($5::date IS NULL), gender = $6, class_id = COALESCE($7, class_id),
                  email = $8, address = $9, custom_student_id = $10 WHERE student_id = $1 AND organization_id = $2`,
          [id, org, ...values]
        );
      } else {
        ({ rows: [{ student_id: id }] } = await q(
          `INSERT INTO students (organization_id, first_name, last_name, date_of_birth, date_of_birth_unknown, gender, class_id, email, address, custom_student_id)
           VALUES ($1, $2, $3, $4, ($4::date IS NULL), $5, $6, $7, $8, $9) RETURNING student_id`,
          [org, ...values]
        ));
        ledger.made("students", { student_id: id });
      }
      await link("students", s.source_id, id);
      studentIds.set(s.source_id, id);
      studentClass.set(s.source_id, classId);
      counts.students += 1;
      await enroll(id, classId);
      for (const [fieldId, value] of Object.entries(d.custom || {})) {
        await ledger.before("student_field_values", { field_id: Number(fieldId), student_id: id }, ["value"]);
        await q(
          `INSERT INTO student_field_values (field_id, student_id, organization_id, value, updated_at) VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (field_id, student_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [Number(fieldId), id, org, value]
        );
        counts.customValues += 1;
      }
      const extras = { ...s.extra };
      if (d.middle_name) extras["Middle name"] = { value: d.middle_name };
      if (d.phone) extras["Home phone"] = { value: d.phone };
      if (d.enroll_status) extras["Enrollment status (old system)"] = { value: d.enroll_status };
      for (const [label, item] of Object.entries(extras)) await extraOn("student", id, label, item);
      for (const [label, text] of Object.entries(d.alerts || {})) {
        await q(
          `INSERT INTO student_alerts (organization_id, student_id, kind, label, text, source, job_id) VALUES ($1, $2, 'custody', $3, $4, $5, $6)
           ON CONFLICT (organization_id, student_id, kind, label) DO UPDATE SET text = EXCLUDED.text, job_id = EXCLUDED.job_id`,
          [org, id, label.slice(0, 120), clean(text, 2000), system, job.job_id]
        );
        counts.alerts += 1;
      }
      for (const [module, row] of Object.entries(s.archive || {})) await keepArchive(client, job, id, module, [row], counts);
    }
    const studentOf = async (sourceId) => studentIds.get(sourceId) || ((await linkOf("students", sourceId)) || {}).managira_id || null;

    // Parents: one profile per person (the same email is the same parent), linked to each child.
    const byEmail = new Map();
    for (const g of await records("guardians")) {
      const studentId = await studentOf(g.data.student_source_id);
      if (!studentId) continue;
      let [first, last] = [clean(g.data.first_name, 100), clean(g.data.last_name, 100)];
      if (!first && g.data.full_name) [first, last] = splitName(g.data.full_name);
      if (!first) continue;
      const email = clean(g.data.email, 200).toLowerCase() || null;
      let id = email && byEmail.get(email);
      const known = !id && await linkOf("guardians", g.source_id);
      if (!id && known && (await q("SELECT 1 FROM guardian_profiles WHERE guardian_id = $1 AND organization_id = $2", [known.managira_id, org])).rowCount) {
        id = known.managira_id;
        await ledger.before("guardian_profiles", { guardian_id: id }, ["first_name", "last_name", "email", "phone"]);
        await q("UPDATE guardian_profiles SET first_name = $3, last_name = $4, email = COALESCE($5, email), phone = COALESCE($6, phone), updated_at = NOW() WHERE guardian_id = $1 AND organization_id = $2",
          [id, org, first, last || null, email, clean(g.data.phone, 40) || null]);
      }
      if (!id && email) id = ((await q("SELECT guardian_id FROM guardian_profiles WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1", [org, email])).rows[0] || {}).guardian_id;
      if (!id) {
        ({ rows: [{ guardian_id: id }] } = await q(
          "INSERT INTO guardian_profiles (organization_id, first_name, last_name, email, phone, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING guardian_id",
          [org, first, last || null, email, clean(g.data.phone, 40) || null]
        ));
        ledger.made("guardian_profiles", { guardian_id: id });
      }
      if (email) byEmail.set(email, id);
      await link("guardians", g.source_id, id);
      const { rows: [joined] } = await q(
        `INSERT INTO guardian_students (guardian_id, student_id, relationship, created_at) SELECT $1, $2, $3, NOW()
          WHERE NOT EXISTS (SELECT 1 FROM guardian_students WHERE guardian_id = $1 AND student_id = $2) RETURNING guardian_id`,
        [id, studentId, clean(g.data.relationship, 60) || "Parent"]
      );
      if (joined) ledger.made("guardian_students", { guardian_id: id, student_id: studentId });
      // The per-student parent row as well, as Add Student writes it: older pages (the student's
      // page) still read it. One per first name per student (the table's own rule).
      const { rows: [legacy] } = await q(
        `INSERT INTO guardians (first_name, last_name, phone, email, student_id, organization_id)
         SELECT $1::text, $2::text, $3::text, $4::text, $5::int, $6::int
          WHERE NOT EXISTS (SELECT 1 FROM guardians WHERE student_id = $5::int AND first_name = $1::text)
         ON CONFLICT DO NOTHING RETURNING guardian_id`,
        [first, last || "", clean(g.data.phone, 40) || null, email, studentId, org]
      );
      if (legacy) ledger.made("guardians", { guardian_id: legacy.guardian_id });
      counts.guardians += 1;
    }

    // Sections: a subject of each class that takes it (its grade level, or the classes of the
    // students enrolled in it), taught by its teacher. A homeroom section makes no subject:
    // its teacher is put in charge of the class, unless the school already chose someone.
    const sectionStudents = new Map();
    for (const e of await records("enrollments")) {
      if (!currentEnrollment(e.data)) continue;
      const section = String(e.data.section_source_id);
      if (!sectionStudents.has(section)) sectionStudents.set(section, new Set());
      sectionStudents.get(section).add(e.data.student_source_id);
    }
    const subjects = new Map((await q("SELECT subject_id, class_id, LOWER(subject_name) AS name FROM subjects WHERE organization_id = $1 AND obsolete_at IS NULL", [org])).rows.map((r) => [`${r.class_id}|${r.name}`, r.subject_id]));
    const subjectFor = async (classId, name) => {
      const key = `${classId}|${name.toLowerCase()}`;
      if (subjects.has(key)) return subjects.get(key);
      const { rows: [row] } = await q("INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3) RETURNING subject_id", [name, classId, org]);
      ledger.made("subjects", { subject_id: row.subject_id });
      subjects.set(key, row.subject_id);
      counts.subjects += 1;
      return row.subject_id;
    };
    const teaches = async (userId, classId, subjectId, inCharge) => {
      const { rows: [had] } = await q("SELECT main FROM user_classes WHERE user_id = $1 AND class_id = $2", [userId, classId]);
      if (!had) {
        await q("INSERT INTO user_classes (user_id, class_id, main) VALUES ($1, $2, FALSE)", [userId, classId]);
        ledger.made("user_classes", { user_id: userId, class_id: classId });
        counts.teacherLinks += 1;
      }
      if (inCharge && !(had && had.main)) {
        const { rowCount: someoneElse } = await q("SELECT 1 FROM user_classes WHERE class_id = $1 AND main = TRUE AND user_id <> $2 LIMIT 1", [classId, userId]);
        if (!someoneElse) {
          await ledger.before("user_classes", { user_id: userId, class_id: classId }, ["main"]);
          await q("UPDATE user_classes SET main = TRUE WHERE user_id = $1 AND class_id = $2", [userId, classId]);
          counts.mainTeachers += 1;
        }
      }
      if (subjectId) {
        const { rowCount } = await q("INSERT INTO user_subjects (user_id, subject_id) VALUES ($1, $2) ON CONFLICT (user_id, subject_id) DO NOTHING", [userId, subjectId]);
        if (rowCount) { ledger.made("user_subjects", { user_id: userId, subject_id: subjectId }); counts.teacherLinks += 1; }
      }
    };
    const placement = new Map(); // section -> { name, classIds, homeroom }
    for (const section of await records("classes")) {
      const d = section.data;
      const name = clean(d.class_name, 100);
      if (!name) continue;
      const teacherId = d.teacher_source_id ? staffIds.get(d.teacher_source_id) || ((await linkOf("staff", d.teacher_source_id)) || {}).managira_id || null : null;
      const placed = new Set();
      if (d.grade_level) { const id = await classFor(d.grade_level); if (id) placed.add(id); }
      for (const sid of sectionStudents.get(String(section.source_id)) || []) { const id = studentClass.get(sid); if (id) placed.add(id); }
      if (!placed.size) { counts.sectionsUnplaced += 1; continue; }
      const homeroom = HOMEROOM.test(name);
      placement.set(String(section.source_id), { name, classIds: [...placed], homeroom });
      if (teacherId) {
        const staffRow = staffRows.find((t) => String(t.source_id) === String(d.teacher_source_id));
        if (staffRow) history.push({ userId: teacherId, sourceId: String(staffRow.source_id), email: clean(staffRow.data.email, 200).toLowerCase() || null, name: [staffRow.data.first_name, staffRow.data.last_name].filter(Boolean).join(" "), active: true,
          kind: "class", value: `${name} (${section.source_id})`, detail: { _classRole: homeroom ? "Homeroom teacher" : "Lead teacher", Section: String(section.source_id), Course: name } });
      }
      let first = null;
      for (const classId of placed) {
        const subjectId = homeroom ? null : await subjectFor(classId, name);
        first = first || subjectId || classId;
        if (teacherId) await teaches(teacherId, classId, subjectId, homeroom);
      }
      await link(homeroom ? "homerooms" : "sections", section.source_id, first);
    }

    // Class roles (lead or co-teacher, with their dates): links for the ones that hold today. A
    // co-teacher of a homeroom is the class's assistant teacher (where the school has them);
    // of any other section, a teacher of its subject. Every row stays in the person's history.
    const assistantsAllowed = await require("./mainTeacher").assistantsOn(client, org);
    const assists = async (userId, classId) => {
      const { rows: [had] } = await q("SELECT main, assistant FROM user_classes WHERE user_id = $1 AND class_id = $2", [userId, classId]);
      if (!had) {
        await q("INSERT INTO user_classes (user_id, class_id, main, assistant) VALUES ($1, $2, FALSE, TRUE)", [userId, classId]);
        ledger.made("user_classes", { user_id: userId, class_id: classId });
      } else if (!had.main && !had.assistant) {
        await ledger.before("user_classes", { user_id: userId, class_id: classId }, ["assistant"]);
        await q("UPDATE user_classes SET assistant = TRUE WHERE user_id = $1 AND class_id = $2", [userId, classId]);
      }
      counts.assistants += 1;
    };
    for (const r of await records("section_teachers")) {
      const d = r.data;
      const staffRow = staffRows.find((t) => String(t.source_id) === String(d.teacher_source_id));
      const co = roles.isCoTeacher(d.class_role);
      const where = placement.get(String(d.section_source_id));
      const now = heldNow(d.start_date, d.end_date);
      const start = isoDate(d.start_date); const end = isoDate(d.end_date);
      if (staffRow) {
        history.push({ userId: staffIds.get(String(d.teacher_source_id)) || null, sourceId: String(staffRow.source_id), email: clean(staffRow.data.email, 200).toLowerCase() || null,
          name: [staffRow.data.first_name, staffRow.data.last_name].filter(Boolean).join(" "), active: now, kind: "class",
          value: `${where ? where.name : d.section_source_id} (${d.section_source_id})`, detail: { ...(d._raw || {}), _classRole: co ? "Co-teacher" : "Lead teacher" },
          start: start && start !== "invalid" ? start : null, end: end && end !== "invalid" ? end : null });
      }
      const teacherId = staffIds.get(String(d.teacher_source_id));
      if (!now || !teacherId || !where) continue;
      for (const classId of where.classIds) {
        if (where.homeroom && co && assistantsAllowed) await assists(teacherId, classId);
        else if (where.homeroom) await teaches(teacherId, classId, null, !co);
        else await teaches(teacherId, classId, await subjectFor(classId, where.name), false);
      }
    }

    // Final grades: each student's academic record (credits and GPA points), printed on their
    // transcript. This migration's rows are replaced as a whole, so a second load never doubles them.
    const gradeRecords = await records("grades");
    if (gradeRecords.length) {
      const rows = [];
      const kept = new Map();
      for (const r of gradeRecords) {
        const studentId = await studentOf(r.data.student_source_id);
        if (!studentId || !clean(r.data.course_name)) continue;
        const d = r.data;
        rows.push([studentId, clean(d.school_year, 20) || ps.schoolYearOfTermId(d.term_id) || "", clean(d.term, 40), clean(d.grade_level, 20) || null, clean(d.course_number, 40) || null,
          clean(d.course_name, 200), clean(d.grade, 10) || null, fit(num(d.percent), 9999), fit(num(d.gpa_points), 999), fit(num(d.credits_attempted), 9999), fit(num(d.credits), 9999), clean(d.school_name, 200) || null,
          fit(num(d.gpa_added_value), 99)]);
        for (const [module, row] of Object.entries(r.archive || {})) {
          const k = `${studentId}|${module}`;
          if (!kept.has(k)) kept.set(k, { studentId, module, rows: [] });
          kept.get(k).rows.push({ Course: d.course_name, Term: d.term || "", ...row });
        }
      }
      await q("DELETE FROM student_course_history WHERE organization_id = $1 AND job_id = $2", [org, job.job_id]);
      if (rows.length) {
        const col = (i) => rows.map((r) => r[i]);
        await q(
          `INSERT INTO student_course_history (organization_id, student_id, school_year, term, grade_level, course_number, course_name, grade, percent, gpa_points, credits_attempted, credits_earned, school_name, gpa_added_value, source, job_id)
           SELECT $1, x.* , $15, $16 FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::text[], $14::numeric[])
             AS x(student_id, school_year, term, grade_level, course_number, course_name, grade, percent, gpa_points, credits_attempted, credits_earned, school_name, gpa_added_value)`,
          [org, col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7), col(8), col(9), col(10), col(11), col(12), system, job.job_id]
        );
      }
      for (const k of kept.values()) await keepArchive(client, job, k.studentId, k.module, k.rows, counts, true);
      counts.courses = rows.length;
      counts.credits = round(rows.reduce((sum, r) => sum + (r[10] || 0), 0));
      counts.gpa = gpaOf(rows.map((r) => ({ gpa: r[8], attempted: r[9], earned: r[10] })));
    }
    // GPA as the old system worked it out (the students file, or a GPA file of its own): kept as
    // it is and printed on the transcript, never worked out again.
    const sourceGpas = new Map();
    const asExported = (value) => (fit(num(value), 99) === null ? null : clean(value, 20));
    const takeGpa = (sourceId, d) => {
      const g = { weighted: asExported(d.gpa_weighted), unweighted: asExported(d.gpa_unweighted), gpa: asExported(d.gpa_value), asOf: clean(d.as_of, 60) || null };
      if (g.weighted === null && g.unweighted === null && g.gpa === null) return;
      sourceGpas.set(String(sourceId), { ...(sourceGpas.get(String(sourceId)) || {}), ...Object.fromEntries(Object.entries(g).filter(([, v]) => v !== null)) });
    };
    for (const sr of await records("students")) takeGpa(sr.source_id, sr.data);
    for (const gr of await records("student_gpas")) takeGpa(gr.data.student_source_id, gr.data);
    await q("DELETE FROM student_source_gpas WHERE organization_id = $1 AND job_id = $2", [org, job.job_id]);
    const gpaRows = [];
    for (const [sourceId, g] of sourceGpas) { const studentId = await studentOf(sourceId); if (studentId) gpaRows.push([studentId, g]); }
    if (gpaRows.length) {
      await q(
        `INSERT INTO student_source_gpas (organization_id, student_id, source, gpa_weighted, gpa_unweighted, gpa, as_of, job_id)
         SELECT $1, x.student_id, $2, x.w, x.u, x.g, x.a, $3 FROM unnest($4::int[], $5::text[], $6::text[], $7::text[], $8::text[]) AS x(student_id, w, u, g, a)
         ON CONFLICT (organization_id, student_id, source) DO UPDATE SET gpa_weighted = EXCLUDED.gpa_weighted, gpa_unweighted = EXCLUDED.gpa_unweighted, gpa = EXCLUDED.gpa,
           as_of = EXCLUDED.as_of, job_id = EXCLUDED.job_id, updated_at = NOW()`,
        [org, system, job.job_id, gpaRows.map((r) => r[0]), gpaRows.map((r) => r[1].weighted ?? null), gpaRows.map((r) => r[1].unweighted ?? null), gpaRows.map((r) => r[1].gpa ?? null), gpaRows.map((r) => r[1].asOf ?? null)]
      );
    }
    counts.sourceGpas = gpaRows.length;

    // Attendance: totals per student per term (one of the school's own terms when the dates or
    // the name match, so it counts on that term's report cards). The days themselves stay
    // read-only in each student's "Attendance history".
    const attendance = await records("attendance");
    if (attendance.length) {
      const terms = (await q(
        `SELECT t.term_id, t.term_name, to_char(t.start_date, 'YYYY-MM-DD') AS starts, to_char(t.end_date, 'YYYY-MM-DD') AS ends, y.year_label
           FROM terms t LEFT JOIN school_years y ON y.id = t.school_year_id
          WHERE t.organization_id = $1 AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL`,
        [org]
      )).rows;
      const totals = new Map();
      const days = new Map();
      for (const r of attendance) {
        const studentId = await studentOf(r.data.student_source_id);
        if (!studentId) continue;
        const d = r.data;
        let termId = null;
        let year = "";
        let label = "";
        if (d.date) {
          const iso = isoDate(d.date);
          if (!iso || iso === "invalid") continue;
          const t = terms.find((x) => iso >= x.starts && iso <= x.ends);
          if (t) { termId = t.term_id; year = t.year_label || yearOfDate(iso); label = t.term_name; } else year = yearOfDate(iso);
          if (!days.has(studentId)) days.set(studentId, []);
          days.get(studentId).push({ Date: iso, Code: d.code || "", Meaning: ps.attendanceKind(d.code, d.present) || "not known (counted absent)", ...flat(r.archive) });
        } else {
          year = clean(d.school_year, 20) || ps.schoolYearOfTermId(d.term_id) || "";
          label = clean(d.term, 60);
          const t = terms.find((x) => (x.year_label || "") === year && String(x.term_name).toLowerCase() === label.toLowerCase());
          termId = t ? t.term_id : null;
        }
        const key = `${studentId}|${year}|${label}`;
        if (!totals.has(key)) totals.set(key, { studentId, termId, year, label, present: 0, absent: 0, excused: 0, tardy: 0 });
        const total = totals.get(key);
        if (!total.termId && termId) total.termId = termId;
        addAttendance(total, d);
      }
      await q("DELETE FROM student_attendance_totals WHERE organization_id = $1 AND job_id = $2", [org, job.job_id]);
      const list = [...totals.values()];
      if (list.length) {
        await q(
          `INSERT INTO student_attendance_totals (organization_id, student_id, term_id, school_year, term, days_present, days_absent, days_excused, days_tardy, source, job_id)
           SELECT $1, x.* , $10, $11 FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[])
             AS x(student_id, term_id, school_year, term, days_present, days_absent, days_excused, days_tardy)
           ON CONFLICT (organization_id, student_id, source, school_year, term) DO UPDATE SET term_id = EXCLUDED.term_id, days_present = EXCLUDED.days_present,
             days_absent = EXCLUDED.days_absent, days_excused = EXCLUDED.days_excused, days_tardy = EXCLUDED.days_tardy, job_id = EXCLUDED.job_id, updated_at = NOW()`,
          [org, list.map((t) => t.studentId), list.map((t) => t.termId), list.map((t) => t.year), list.map((t) => t.label), list.map((t) => t.present), list.map((t) => t.absent),
            list.map((t) => t.excused), list.map((t) => t.tardy), system, job.job_id]
        );
      }
      for (const [studentId, rows] of days) await keepArchive(client, job, studentId, "Attendance history", rows, counts, true);
      counts.attendanceTerms = list.length;
      for (const t of list) for (const k of Object.keys(counts.attendance)) counts.attendance[k] += t[k];
    }

    await q("DELETE FROM staff_role_history WHERE organization_id = $1 AND job_id = $2", [org, job.job_id]);
    if (history.length) {
      await q(
        `INSERT INTO staff_role_history (organization_id, user_id, job_id, source_system, source_id, email, name, kind, value, detail, start_date, end_date, active)
         SELECT $1, x.user_id, $2, $3, x.source_id, x.email, x.name, x.kind, x.value, x.detail, x.start_date, x.end_date, x.active
           FROM unnest($4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::jsonb[], $11::date[], $12::date[], $13::boolean[])
             AS x(user_id, source_id, email, name, kind, value, detail, start_date, end_date, active)`,
        [org, job.job_id, system, history.map((h) => h.userId), history.map((h) => h.sourceId), history.map((h) => h.email), history.map((h) => h.name), history.map((h) => h.kind),
          history.map((h) => h.value), history.map((h) => JSON.stringify(h.detail || {})), history.map((h) => h.start || null), history.map((h) => h.end || null), history.map((h) => h.active)]
      );
    }
    counts.roleHistory = history.length;
    await ledger.save();
    await client.query("COMMIT");
    for (const userId of touched) invalidateUserPermissionCache(org, userId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  counts.staffSkipped = staffSkipped.slice(0, 100);
  await event(db, { jobId: job.job_id, organizationId: org, actor, action: "loaded", detail: { ...counts, staffSkipped: staffSkipped.length } });
  return counts;
}
const flat = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, v && typeof v === "object" && "value" in v ? v.value : v && typeof v === "object" ? JSON.stringify(v) : v]));
const SENSITIVE_MODULES = new Set(["Special education", "Health records", "Discipline"]);
async function keepArchive(client, job, studentId, module, rows, counts, replace = false) {
  if (studentId === null) {
    // One list for the school: replaced whole (a unique rule can't hold an empty student).
    await client.query("DELETE FROM migration_archives WHERE organization_id = $1 AND student_id IS NULL AND module = $2", [job.organization_id, module]);
  }
  await client.query(
    `INSERT INTO migration_archives (organization_id, job_id, student_id, module, sensitive, content) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (organization_id, student_id, module) DO UPDATE SET content = ${replace ? "EXCLUDED.content" : "migration_archives.content || EXCLUDED.content"}, job_id = EXCLUDED.job_id`,
    [job.organization_id, job.job_id, studentId, module, SENSITIVE_MODULES.has(module), JSON.stringify(rows)]
  );
  counts.archives += 1;
}

async function goLive(db, job, actor) {
  if (job.status !== "review" || !job.signed_at) return { error: "Sign the migration summary first." };
  const imported = await runImport(db, job, actor);
  if (imported.error) return imported;
  const { list } = await blockers(db, job);
  const left = list.filter((item) => !/^Approve: /.test(item)); // the fresh import keeps the sign-off
  if (left.length) return { error: left[0] };
  const { rows: [snap] } = await db.query(
    `INSERT INTO migration_snapshots (job_id, organization_id, record_count, content)
     SELECT $1, $2, COUNT(*), COALESCE(jsonb_agg(jsonb_build_object('entity', entity, 'source_id', source_id, 'data', data, 'extra', extra, 'archive', archive)), '[]'::jsonb)
       FROM migration_records WHERE job_id = $1 RETURNING snapshot_id, record_count`,
    [job.job_id, job.organization_id]
  );
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "snapshot", detail: { snapshotId: snap.snapshot_id, records: snap.record_count } });
  const counts = await loadLive(db, job, actor);
  await db.query(
    `UPDATE migration_jobs SET status = 'live', locked = FALSE, live_at = NOW(), purge_after = CURRENT_DATE + ${KEEP_DAYS}, rolled_back_at = NULL, totals = totals || $2::jsonb, updated_at = NOW() WHERE job_id = $1`,
    [job.job_id, JSON.stringify({ loaded: counts })]
  );
  forget(job.organization_id);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "went_live", detail: { students: counts.students, staff: counts.staff, courses: counts.courses } });
  return { counts };
}

async function catchUp(db, job, actor) {
  if (job.status !== "live") return { error: "Catch-up is for after go-live." };
  if (job.catch_up_at) return { error: "The catch-up import was already used." };
  const imported = await runImport(db, job, actor);
  if (imported.error) return imported;
  const counts = await loadLive(db, job, actor);
  await db.query("UPDATE migration_jobs SET catch_up_at = NOW(), totals = totals || $2::jsonb, updated_at = NOW() WHERE job_id = $1", [job.job_id, JSON.stringify({ loaded: counts })]);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "catch_up", detail: { students: counts.students, staff: counts.staff, courses: counts.courses } });
  return { counts };
}

// ── Staff invitations ───────────────────────────────────────────────────────────────────
// Imported staff and their state: waiting (an account this migration made, on hold, never
// invited), invited, or one the school already had.
async function staffAccounts(db, job) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (u.user_id) u.user_id, u.first_name, u.last_name, u.email, u.account_type::text AS role, COALESCE(u.on_hold, FALSE) AS on_hold,
            (u.password IS NOT NULL) AS has_password, l.invited_at, l.source_id, l.job_id = $3 AS ours,
            (SELECT string_agg(DISTINCT c.class_name, ', ') FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = u.user_id) AS classes
       FROM migration_links l JOIN users u ON u.user_id = l.managira_id AND u.organization_id = l.organization_id
      WHERE l.organization_id = $1 AND l.entity = 'staff' AND l.source_system = $2
      ORDER BY u.user_id, l.invited_at DESC NULLS LAST`,
    [job.organization_id, job.source_system, job.job_id]
  );
  return rows
    .map((r) => ({ ...r, waiting: r.on_hold && !r.has_password && !r.invited_at }))
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
}
// Takes the chosen staff (all waiting ones when none are chosen) off hold with a set-password
// link valid for 3 days; the caller sends the emails. Returns each person and their link.
async function inviteStaff(db, job, userIds, { baseUrl, actor }) {
  const chosen = Array.isArray(userIds) && userIds.length ? new Set(userIds.map(Number)) : null;
  const list = (await staffAccounts(db, job)).filter((s) => s.waiting && (!chosen || chosen.has(Number(s.user_id))));
  const out = [];
  for (const person of list) {
    const token = crypto.randomBytes(32).toString("hex");
    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    await db.query("UPDATE users SET on_hold = FALSE, reset_password_token = $2, reset_password_expires = NOW() + INTERVAL '3 days', updated_at = NOW() WHERE user_id = $1 AND organization_id = $3",
      [person.user_id, hashed, job.organization_id]);
    await db.query("UPDATE migration_links SET invited_at = NOW() WHERE organization_id = $1 AND entity = 'staff' AND managira_id = $2", [job.organization_id, person.user_id]);
    out.push({ ...person, link: `${baseUrl}/common/set-password?token=${token}` });
  }
  if (out.length) await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "staff_invited", detail: { count: out.length, userIds: out.map((p) => p.user_id) } });
  return out;
}

// ── Rolling back a go-live ──────────────────────────────────────────────────────────────
// Possible until the 30-day clean-up deletes the sandbox and the record of what was loaded.
async function rollbackJob(db, organizationId) {
  const { rows: [job] } = await db.query(
    "SELECT * FROM migration_jobs WHERE organization_id = $1 AND live_at IS NOT NULL AND purged_at IS NULL AND status IN ('live', 'closed') ORDER BY job_id DESC LIMIT 1",
    [organizationId]
  );
  return job || null;
}
// What a rollback would remove, and what the school has done since with the imported records
// (that goes too). Payments stop it: they'd be left without a student.
async function rollbackPreview(db, job) {
  const org = job.organization_id;
  const { rows: tables } = await db.query(
    "SELECT table_name, COUNT(*) FILTER (WHERE created)::int AS made, COUNT(*) FILTER (WHERE NOT created)::int AS changed FROM migration_loaded WHERE job_id = $1 GROUP BY 1 ORDER BY 1",
    [job.job_id]
  );
  const idsOf = async (table, column) => (await db.query(`SELECT (row_key->>'${column}')::int AS id FROM migration_loaded WHERE job_id = $1 AND table_name = $2 AND created`, [job.job_id, table])).rows.map((r) => r.id);
  const [students, parents, users] = [await idsOf("students", "student_id"), await idsOf("guardian_profiles", "guardian_id"), await idsOf("users", "user_id")];
  const count = async (sql, args) => Number(((await db.query(sql, args).catch(() => ({ rows: [{ n: 0 }] }))).rows[0] || {}).n || 0);
  const since = { attendance: 0, scores: 0, bills: 0, payments: 0, forms: 0, studentLogins: 0, parentLogins: 0, staffSignedUp: 0 };
  if (students.length) {
    since.attendance = await count("SELECT COUNT(*) AS n FROM attendance_records WHERE organization_id = $1 AND student_id = ANY($2::int[])", [org, students]);
    since.scores = await count("SELECT COUNT(*) AS n FROM assessment_results WHERE organization_id = $1 AND student_id = ANY($2::int[])", [org, students]);
    since.bills = await count("SELECT COUNT(*) AS n FROM finance_bill_assignments WHERE student_id = ANY($1::int[])", [students]);
    since.payments = await count("SELECT COUNT(*) AS n FROM finance_payments WHERE student_id = ANY($1::int[])", [students]);
    since.forms = await count("SELECT COUNT(*) AS n FROM custom_section_entries WHERE student_id = ANY($1::int[])", [students]);
    since.studentLogins = await count("SELECT COUNT(*) AS n FROM student_accounts WHERE student_id = ANY($1::int[])", [students]);
  }
  if (parents.length) since.parentLogins = await count("SELECT COUNT(*) AS n FROM guardian_accounts WHERE guardian_id = ANY($1::int[])", [parents]);
  if (users.length) since.staffSignedUp = await count("SELECT COUNT(*) AS n FROM users WHERE user_id = ANY($1::int[]) AND password IS NOT NULL", [users]);
  const blocked = since.payments
    ? `${since.payments} ${since.payments === 1 ? "payment was" : "payments were"} recorded for imported students since go-live. A rollback would leave ${since.payments === 1 ? "it" : "them"} without a student, so move or refund ${since.payments === 1 ? "it" : "them"} first.`
    : null;
  return { tables, since, blocked, students: students.length, parents: parents.length, users: users.length };
}

// Removes everything the go-live (and catch-up) loaded, puts back what it changed, and opens
// the sandbox again, locked, with its records as they were: the school checks, signs and goes
// live again. A class, subject or staff account the school has since built on can't be deleted
// without what it holds: it stays (an account on hold) and is listed.
async function rollback(db, job, actor) {
  if (!job || !job.live_at || job.purged_at || !["live", "closed"].includes(job.status)) return { error: "This go-live can no longer be rolled back: the 30-day clean-up has run." };
  const preview = await rollbackPreview(db, job);
  if (preview.blocked) return { error: preview.blocked };
  const open = await openJob(db, job.organization_id);
  if (open && open.job_id !== job.job_id) return { error: "Another migration is open for this school." };
  const org = job.organization_id;
  const result = { removed: {}, restored: 0, kept: [] };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Checked row by row, so a row something still points at is caught (and kept) where it is
    // deleted, not at the end (some of the school's foreign keys are checked at commit).
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const { rows: entries } = await client.query("SELECT table_name, row_key, created, before FROM migration_loaded WHERE job_id = $1", [job.job_id]);
    for (const table of OWN) {
      const { rowCount } = await client.query(`DELETE FROM ${table} WHERE organization_id = $1 AND job_id = $2`, [org, job.job_id]);
      if (rowCount) result.removed[table] = rowCount;
    }
    for (const e of entries.filter((x) => !x.created && x.before && LOADED[x.table_name])) {
      const keys = LOADED[e.table_name];
      const cols = Object.keys(e.before).filter((c) => /^[a-z_]+$/.test(c) && !keys.includes(c));
      if (!cols.length) continue;
      await client.query(
        `UPDATE ${e.table_name} AS t SET ${cols.map((c) => `${c} = r.${c}`).join(", ")} FROM jsonb_populate_record(NULL::${e.table_name}, $1::jsonb) AS r
          WHERE ${keys.map((k, i) => `t.${k} = $${i + 2}`).join(" AND ")}`,
        [JSON.stringify(e.before), ...keys.map((k) => e.row_key[k])]
      );
      result.restored += 1;
    }
    for (const [table, keys] of Object.entries(LOADED)) {
      const made = entries.filter((e) => e.created && e.table_name === table).map((e) => e.row_key);
      if (!made.length) continue;
      let removed = 0;
      if (["classes", "subjects", "users"].includes(table)) {
        for (const key of made) {
          await client.query("SAVEPOINT one_row");
          try {
            removed += (await client.query(`DELETE FROM ${table} WHERE ${keys[0]} = $1 AND organization_id = $2`, [key[keys[0]], org])).rowCount;
            await client.query("RELEASE SAVEPOINT one_row");
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT one_row");
            if (table === "users") await client.query("UPDATE users SET on_hold = TRUE WHERE user_id = $1 AND organization_id = $2", [key.user_id, org]);
            result.kept.push({ table, id: key[keys[0]] });
          }
        }
      } else if (table === "enrollments") {
        removed = (await client.query(
          `DELETE FROM enrollments e WHERE e.enrollment_id = ANY($1::int[]) AND e.organization_id = $2
              AND NOT EXISTS (SELECT 1 FROM enrolled_classes c WHERE c.enrollment_id = e.enrollment_id)
              AND NOT EXISTS (SELECT 1 FROM enrolled_students s WHERE s.enrollment_id = e.enrollment_id)`,
          [made.map((k) => k.enrollment_id), org]
        )).rowCount;
      } else if (keys.length === 1) {
        const scoped = ["students", "guardian_profiles", "guardians"].includes(table) ? " AND organization_id = $2" : "";
        removed = (await client.query(`DELETE FROM ${table} WHERE ${keys[0]} = ANY($1::int[])${scoped}`, scoped ? [made.map((k) => k[keys[0]]), org] : [made.map((k) => k[keys[0]])])).rowCount;
      } else {
        removed = (await client.query(`DELETE FROM ${table} WHERE (${keys[0]}, ${keys[1]}) IN (SELECT * FROM unnest($1::int[], $2::int[]))`, [made.map((k) => k[keys[0]]), made.map((k) => k[keys[1]])])).rowCount;
      }
      if (removed) result.removed[table] = removed;
    }
    await client.query("DELETE FROM migration_loaded WHERE job_id = $1", [job.job_id]);
    await client.query(
      `UPDATE migration_jobs SET status = 'sandbox', locked = TRUE, live_at = NULL, catch_up_at = NULL, purge_after = NULL, signed_at = NULL, signed_name = NULL, signed_by = NULL,
              approvals = '{}'::jsonb, totals = totals - 'loaded', rolled_back_at = NOW(), rolled_back_by = $2, updated_at = NOW()
        WHERE job_id = $1`,
      [job.job_id, actor]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  forget(org);
  await event(db, { jobId: job.job_id, organizationId: org, actor, actorKind: "managira", action: "rolled_back", detail: result });
  return result;
}

// Daily: 30 days after go-live the uploaded files, the snapshot, the sandbox and the record of
// what was loaded are deleted, and the sandbox closes: the go-live can't be rolled back after
// that. The loaded records and the old-ID links stay.
async function purgeDue(db) {
  if (!(await ready(db))) return { purged: 0 };
  const { rows } = await db.query("SELECT job_id, organization_id FROM migration_jobs WHERE status IN ('live', 'closed') AND purged_at IS NULL AND purge_after <= CURRENT_DATE");
  for (const job of rows) {
    await db.query("UPDATE migration_files SET content = NULL WHERE job_id = $1", [job.job_id]);
    await db.query("DELETE FROM migration_snapshots WHERE job_id = $1", [job.job_id]);
    await db.query("DELETE FROM migration_records WHERE job_id = $1", [job.job_id]);
    await db.query("DELETE FROM migration_loaded WHERE job_id = $1", [job.job_id]);
    await db.query("UPDATE migration_jobs SET status = 'closed', purged_at = NOW(), updated_at = NOW() WHERE job_id = $1", [job.job_id]);
    forget(job.organization_id);
    await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor: "Managira", actorKind: "system", action: "purged" });
  }
  return { purged: rows.length };
}

// ── Super Admin: the queue and what schools need ────────────────────────────────────────
// Each school's open migration (its status), for the Organizations and hub pages.
async function statusesFor(db, organizationIds = null) {
  if (!(await ready(db))) return {};
  const { rows } = await db.query(
    "SELECT organization_id, status FROM migration_jobs WHERE status IN ('sandbox', 'review', 'live') AND ($1::int[] IS NULL OR organization_id = ANY($1::int[]))",
    [organizationIds]
  );
  return Object.fromEntries(rows.map((r) => [r.organization_id, r.status]));
}
// A hub moving in: a sandbox for each of its schools that hasn't one (each school's data is its own).
async function startHub(db, hubId, actor) {
  const { rows: schools } = await db.query(
    "SELECT organization_id FROM organizations WHERE hub_id = $1 AND deleted = false AND is_hub_member = true ORDER BY organization_name",
    [hubId]
  );
  let started = 0;
  for (const school of schools) {
    if (await openJob(db, school.organization_id)) continue;
    await startJob(db, school.organization_id, actor);
    started += 1;
  }
  return { schools: schools.length, started };
}

async function queue(db) {
  const { rows } = await db.query(
    `SELECT j.job_id, j.organization_id, j.status, j.created_at, o.organization_name, h.hub_name,
            COUNT(c.column_id) FILTER (WHERE c.action IS NULL AND NOT (c.confirmed AND c.target IS NOT NULL) AND c.confidence <> 'unsure')::int AS need_action,
            COUNT(c.column_id) FILTER (WHERE c.action IS NULL AND c.notes IS NOT NULL)::int AS with_notes,
            COUNT(c.column_id) FILTER (WHERE c.sensitive IS NOT NULL)::int AS sensitive,
            (SELECT COUNT(*) FROM migration_roles r WHERE r.job_id = j.job_id AND r.target IS NULL)::int AS roles_waiting
       FROM migration_jobs j JOIN organizations o ON o.organization_id = j.organization_id
       LEFT JOIN managira_hubs h ON h.hub_id = o.hub_id AND o.is_hub_member = true
       LEFT JOIN migration_columns c ON c.job_id = j.job_id
      WHERE j.status IN ('sandbox', 'review', 'live')
      GROUP BY j.job_id, o.organization_name, h.hub_name ORDER BY need_action DESC, j.job_id DESC`
  );
  return rows;
}
async function needsAcrossSchools(db) {
  const { rows } = await db.query(
    `SELECT CASE WHEN c.action = 'map' AND c.target LIKE 'custom:%' THEN 'Custom field' WHEN c.action = 'extra' THEN 'Extra field' WHEN c.action = 'archive' THEN 'Archive' END AS kind,
            COALESCE(c.label, c.source_column) AS name, COUNT(DISTINCT c.organization_id)::int AS schools
       FROM migration_columns c
      WHERE (c.action = 'map' AND c.target LIKE 'custom:%' AND c.confidence <> 'confident') OR c.action IN ('extra', 'archive')
      GROUP BY 1, 2
      UNION ALL
     SELECT 'Custom role', r.label, COUNT(DISTINCT r.organization_id)::int FROM migration_roles r WHERE r.target = 'custom' AND r.label IS NOT NULL GROUP BY 2
      ORDER BY 3 DESC, 2 LIMIT 100`
  );
  return rows;
}

module.exports = {
  ENTITIES: ps.ENTITIES, SECTIONS, SECTION_LABELS, SENSITIVE_LABELS, ARCHIVE_MODULES, ACTIONS, NOTE_KEYS, MAX_FILE_BYTES,
  featureOn, ready, event, openJob, stateFor, forget, startJob, stopJob,
  addFile, currentFiles, columnsOf, confirmColumn, saveNotes, approveExclude, legalNeed, resolveColumn, openItems, customFieldsOf,
  runImport, sandboxSummary, approveSection, blockers, sign, summary, goLive, catchUp, loadLive, purgeDue, queue, needsAcrossSchools,
  staffAccounts, inviteStaff, rollbackJob, rollbackPreview, rollback, gpaOf, addAttendance, currentEnrollment, LOADED,
  rolesOf, roleReport, confirmRole, roleNotes, resolveRole, approvePerson, gpaCheck, statusesFor, startHub, ROLES: roles.ROLES, LEVELS: roles.LEVELS, pickableRoles: roles.pickable, ACCOUNT_TYPES: roles.ACCOUNT_TYPES,
  isoDate, parse, targetLabel: ps.targetLabel,
};
