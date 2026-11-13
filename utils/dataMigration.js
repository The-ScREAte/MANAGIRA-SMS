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
const { tell } = require("./migration/notify");
const tidy = require("./migration/tidy");
const lists = require("./migration/lists");
const documents = require("./migration/documents");
const tasks = require("./migration/tasks");
const readerPool = require("./migration/readerPool");
const schoolRoles = require("./schoolRoles");
const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);
const tick = tasks.tick;
// A statement that's safe to repeat (an upsert, a delete by time) is tried again when the
// connection drops under it: a long import doesn't fail for one network hiccup.
const DROPPED = /Connection terminated|ECONNRESET|server closed the connection|Connection ended|EPIPE|connection timeout|terminating connection/i;
async function again(fn, tries = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await fn(); } catch (error) {
      if (attempt >= tries || !DROPPED.test(String(error && error.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
}
const quiet = () => {};
const { PERMISSIONS_SAVED_KEY, invalidateUserPermissionCache } = require("../middleware/permissionMiddleware");

const MAX_FILE_BYTES = 60 * 1024 * 1024; // per file as uploaded (stored compressed)
const MAX_UPLOAD_FILES = 20;
const BATCH = 2000; // rows written to the database per statement
const MAX_ROWS = 200000;
const KEEP_DAYS = 30;
const SECTIONS = ["students", "guardians", "staff", "roles", "classes", "enrollments", "grades", "attendance", "custom_fields", "archive"];
const SECTION_LABELS = { students: "Students", guardians: "Parents & guardians", staff: "Staff accounts", roles: "Staff roles (the role report)", classes: "Sections & teachers", enrollments: "Class enrollments", grades: "Final grades", attendance: "Attendance", custom_fields: "Custom and extra fields", archive: "Archive" };
const ACTIONS = ["map", "custom", "extra", "archive", "exclude", "alert"];
const SENSITIVE_LABELS = { custody: "Custody or pickup restriction", ssn: "Social Security number", sped: "Special education", medical: "Medical", discipline: "Discipline", programs: "Special programs or benefits", secret: "Codes and PINs" };
// Whole modules Managira doesn't run yet: their columns are kept read-only per student.
const ARCHIVE_MODULES = ["Special education", "Health records", "Transportation", "Fees", "Library", "Discipline", "Grades history", "Attendance history", "Other"];

const featureOn = (organizationId) => features.isOn("data_migration", { organizationId: Number(organizationId) || null });

const TABLES = ["migration_jobs", "migration_files", "migration_columns", "migration_records", "migration_links", "migration_events", "migration_snapshots", "record_extra_fields",
  "migration_archives", "student_alerts", "student_course_history", "student_attendance_totals", "migration_loaded", "account_mfa",
  "migration_roles", "staff_role_history", "staff_role_changes", "staff_access_seen", "student_source_gpas", "migration_requests", "migration_tasks", "migration_uploads", "migration_documents"];
let tablesReady = false;
let lastCheck = 0;
// The database updates have run (2026-11-27_data_migration, 2026-11-28_migration_core,
// 2026-11-29_staff_roles_assistant, 2026-11-30_gpa_backups, 2026-12-01_migration_requests, 2026-12-02_migration_tasks, 2026-12-03_migration_documents).
async function ready(db) {
  if (tablesReady || Date.now() - lastCheck < 60000) return tablesReady;
  lastCheck = Date.now();
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[]))::int AS tables,
            (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema()
                AND ((table_name = 'migration_links' AND column_name = 'job_id') OR (table_name = 'migration_jobs' AND column_name = 'role_approvals')
                  OR (table_name = 'student_course_history' AND column_name = 'gpa_added_value')
                  OR (table_name = 'migration_links' AND column_name = 'loaded') OR (table_name = 'migration_jobs' AND column_name = 'match_decisions')
                  OR (table_name = 'migration_files' AND column_name = 'compressed') OR (table_name = 'migration_snapshots' AND column_name = 'content_gz')))::int AS cols`,
    [TABLES]
  ).catch(() => ({ rows: [{ tables: 0, cols: 0 }] }));
  tablesReady = Number(rows[0].tables) === TABLES.length && Number(rows[0].cols) === 7;
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
  // The school's open request, if it sent one, is approved with it.
  const { rows: [request] } = await db.query(
    "UPDATE migration_requests SET status = 'approved', job_id = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE organization_id = $1 AND status IN ('new', 'contacted') RETURNING contact_email",
    [organizationId, job.job_id, actor]
  ).catch(() => ({ rows: [] }));
  tell(db, organizationId, "approved", { codes: require("./mfa").neededFor(organizationId) }, { alsoEmail: request ? [request.contact_email] : [] });
  return job;
}

// Off only once the school is live (it closes) or the migration was cancelled.
async function stopJob(db, organizationId, actor, { cancel = false } = {}) {
  const job = await openJob(db, organizationId);
  if (!job) return { ok: true };
  const running = await tasks.openTask(db, job.job_id);
  if (running) return { error: `Wait until "${tasks.LABELS[running.kind]}" finishes.` };
  if (["sandbox", "review"].includes(job.status) && !cancel) return { error: "The migration isn't finished. Cancel it first, or go live." };
  if (cancel && job.status === "live") return { error: "This school is already live. Turn the sandbox off instead." };
  if (cancel) {
    await db.query("DELETE FROM migration_records WHERE job_id = $1", [job.job_id]);
    await db.query("UPDATE migration_files SET content = NULL WHERE job_id = $1", [job.job_id]);
    await db.query("UPDATE migration_uploads SET content = NULL WHERE job_id = $1", [job.job_id]);
    await documents.removeAll(db, job.job_id);
  }
  await db.query("UPDATE migration_jobs SET status = $2, locked = FALSE, updated_at = NOW() WHERE job_id = $1", [job.job_id, cancel ? "cancelled" : "closed"]);
  forget(organizationId);
  await event(db, { jobId: job.job_id, organizationId, actor, actorKind: "managira", action: cancel ? "cancelled" : "sandbox_off" });
  tell(db, organizationId, cancel ? "cancelled" : "closed");
  return { ok: true };
}

// ── 1. Files ────────────────────────────────────────────────────────────────────────────
// An upload is kept, compressed, until the reader thread has read it (`readUploads`, a background
// task): CSV, tab- or semicolon-separated text, Excel workbooks and .zip files of them.
function parse(text) {
  const { header, rows } = require("./migration/reader").parseText(text);
  return { header, rows };
}
async function storeUploads(db, job, files, { entity = null, actor }) {
  const stored = [];
  const refused = [];
  for (const f of files.slice(0, MAX_UPLOAD_FILES)) {
    const name = String(f.originalname || "export.csv").slice(0, 200);
    if (!f.buffer || !f.buffer.length) { refused.push(`${name}: the file is empty.`); continue; }
    if (f.buffer.length > MAX_FILE_BYTES) { refused.push(`${name}: files can be up to ${MAX_FILE_BYTES / 1048576} MB. Export it in parts.`); continue; }
    const content = await gzip(f.buffer); // on libuv's thread pool, not the main thread
    const { rows: [upload] } = await db.query(
      `INSERT INTO migration_uploads (job_id, organization_id, file_name, size_bytes, entity, content, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING upload_id, file_name, size_bytes`,
      [job.job_id, job.organization_id, name, f.buffer.length, ps.ENTITIES[entity] ? entity : null, content, actor]
    );
    stored.push(upload);
  }
  if (files.length > MAX_UPLOAD_FILES) refused.push(`Up to ${MAX_UPLOAD_FILES} files at a time: the rest weren't uploaded.`);
  return { stored, refused };
}

// One list read from an upload: kept compressed, its columns matched.
const lastPart = (name) => String(name || "").split("›").pop().trim();
async function addList(db, job, list, { entity = null, actor = null, sourceName = null, uploadId = null }) {
  // What it is from its name first, then its columns (utils/migration/lists.js); the school can say.
  const kind = ps.ENTITIES[entity] && entity !== "other" ? entity : lists.recognize(list.name, list.header).entity;
  await db.query(
    "UPDATE migration_files SET replaced_at = NOW() WHERE job_id = $1 AND replaced_at IS NULL AND upload_id IS DISTINCT FROM $3 AND LOWER(regexp_replace(file_name, '^.*› ', '')) = LOWER($2)",
    [job.job_id, lastPart(list.name), uploadId]
  );
  if (kind === "other") {
    // A list kept read-only replaces the one of the same name from an earlier upload.
    await db.query(
      "UPDATE migration_files SET replaced_at = NOW() WHERE job_id = $1 AND entity = 'other' AND replaced_at IS NULL AND upload_id IS DISTINCT FROM $3 AND LOWER(regexp_replace(file_name, '^.*› ', '')) = LOWER($2)",
      [job.job_id, lastPart(list.name), uploadId]
    );
  } else {
    // A list replaces the ones of its kind from earlier uploads (they stay, unchanged, until the
    // clean-up); lists of one kind sent together, a long list in parts, are read together.
    await db.query("UPDATE migration_files SET replaced_at = NOW() WHERE job_id = $1 AND entity = $2 AND replaced_at IS NULL AND upload_id IS DISTINCT FROM $3", [job.job_id, kind, uploadId]);
  }
  const { rows: [file] } = await db.query(
    `INSERT INTO migration_files (job_id, organization_id, entity, file_name, sha256, size_bytes, row_count, header, content, uploaded_by, compressed, source_name, upload_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, TRUE, $11, $12) RETURNING file_id, entity, file_name, row_count`,
    [job.job_id, job.organization_id, kind, String(list.name).slice(0, 200), list.sha256, list.size, list.rowCount, JSON.stringify(list.header), list.gz, actor, sourceName, uploadId]
  );
  if (kind !== "other") await autoMap(db, job, kind, list.header, list.sample || []);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "file_uploaded", detail: { file: file.file_name, entity: kind, rows: list.rowCount, sha256: list.sha256 } });
  return file;
}

// The background task: every upload still waiting, one at a time, until none is left.
async function readUploads(db, job, task, progress = quiet) {
  const files = [];
  const problems = [];
  let read = 0;
  let documentCount = 0;
  for (;;) {
    const { rows: [upload] } = await db.query("SELECT * FROM migration_uploads WHERE job_id = $1 AND status = 'waiting' ORDER BY upload_id LIMIT 1", [job.job_id]);
    if (!upload) break;
    progress({ phase: 1, phases: 3, step: `Opening ${upload.file_name}`, done: 0, total: 0 });
    let lists;
    try {
      lists = await readerPool.expand(upload.content, { compressed: true, name: upload.file_name });
    } catch (error) {
      lists = [{ name: upload.file_name, error: /^That file/.test(error.message) ? error.message : "It couldn't be read. Export it again and upload it." }];
    }
    const made = [];
    const docs = lists.filter((l) => l.document);
    // A list longer than Managira reads is refused whole: totals worked out from part of it would be wrong.
    for (const list of lists) if (!list.error && !list.document && list.cut) list.error = `It has more than ${MAX_ROWS.toLocaleString("en-US")} rows. Split it into parts (by date or by grade) and send the parts together in one .zip, or export attendance as totals per term.`;
    const usable = lists.filter((l) => !l.error && !l.document);
    progress({ phase: 2, phases: 3, step: "Reading the lists", done: 0, total: usable.length });
    for (const list of usable) {
      const file = await addList(db, job, list, { entity: usable.length === 1 ? upload.entity : null, actor: upload.uploaded_by, sourceName: list.name === upload.file_name ? null : upload.file_name, uploadId: upload.upload_id });
      made.push({ name: file.file_name, entity: file.entity, label: (ps.ENTITIES[file.entity] || {}).label || file.entity, rows: file.row_count });
      progress({ done: made.length });
      await tick();
    }
    const listProblems = lists.filter((l) => l.error && !l.document).map((l) => ({ name: l.name, error: l.error, skipped: Boolean(l.skipped) }));
    problems.push(...listProblems);
    // Every file that isn't a list is a document, kept as it is: several stored at a time.
    progress({ phase: 3, phases: 3, step: "Storing documents", done: 0, total: docs.length });
    let kept = 0;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, docs.length) }, async () => {
      while (next < docs.length) {
        const doc = docs[next++];
        await documents.put(db, job, { path: doc.path, buffer: doc.content, uploadId: upload.upload_id, actor: upload.uploaded_by });
        doc.content = null;
        if (doc.note) problems.push({ name: doc.name, error: doc.note, skipped: true });
        kept += 1;
        progress({ done: kept });
      }
    }));
    documentCount += kept;
    files.push(...made);
    await db.query(
      "UPDATE migration_uploads SET status = $2, content = NULL, result = $3::jsonb, error = $4, read_at = NOW() WHERE upload_id = $1",
      [upload.upload_id, made.length || kept ? "read" : "failed", JSON.stringify({ lists: made, documents: kept, problems: listProblems.slice(0, 50) }), made.length || kept ? null : ((lists.find((l) => l.error) || {}).error || null)]
    );
    read += 1;
  }
  progress({ done: read, total: read });
  const core = files.filter((f) => f.entity !== "other");
  const keptLists = files.length - core.length;
  const words = core.map((f) => `${lastPart(f.name)} (${f.label}, ${f.rows.toLocaleString("en-US")} rows)`);
  const parts = [
    core.length ? `Read ${words.join(", ")}` : null,
    keptLists ? `${keptLists.toLocaleString("en-US")} other ${keptLists === 1 ? "list" : "lists"} to keep read-only` : null,
    documentCount ? `${documentCount.toLocaleString("en-US")} ${documentCount === 1 ? "document" : "documents"} kept` : null,
  ].filter(Boolean);
  return {
    files, problems, documents: documentCount,
    message: parts.length ? `${parts.join("; ")}. ${core.length ? "Check the matches next." : "Import when you're ready."}` : "Nothing could be read from those files.",
    ...(files.length || documentCount ? {} : { error: problems.map((p) => `${p.name}: ${p.error}`).join(" ") || "Nothing could be read from those files." }),
  };
}

async function currentFiles(db, job) {
  const { rows } = await db.query(
    "SELECT file_id, entity, file_name, row_count, header, uploaded_at, uploaded_by, size_bytes, source_name FROM migration_files WHERE job_id = $1 AND replaced_at IS NULL AND content IS NOT NULL ORDER BY file_id",
    [job.job_id]
  );
  return rows;
}
// A stored list's rows as arrays in heading order, a chunk at a time, read on the reader thread.
async function* fileChunks(db, file) {
  const { rows: [stored] } = await db.query("SELECT content, compressed FROM migration_files WHERE file_id = $1", [file.file_id]);
  if (!stored || !stored.content) return;
  yield* readerPool.rows(stored.content, stored.compressed);
}

// ── 2. Auto-map ─────────────────────────────────────────────────────────────────────────
const customFieldsOf = async (db, organizationId) => (await db.query(
  "SELECT field_id, label, field_type FROM student_form_fields WHERE organization_id = $1 AND status = 'active' ORDER BY position", [organizationId]
).catch(() => ({ rows: [] }))).rows;

// Where a column nobody matched goes at first (the school, or Managira, can change it): on the
// student, a labeled detail; on the other lists, kept read-only with the record it belongs to.
const DEFAULT_HOME = {
  students: { action: "custom" },
  student_details: { action: "custom" },
  guardians: { action: "archive", label: "Parents & contacts" },
  staff: { action: "archive", label: "Staff (old system)" },
  staff_roles: { action: "archive", label: "Staff roles" },
  classes: { action: "archive", label: "Sections (old system)" },
  section_teachers: { action: "archive", label: "Class roles (old system)" },
  enrollments: { action: "archive", label: "Class schedule (old system)" },
  grades: { action: "archive", label: "Grades history" },
  attendance: { action: "archive", label: "Attendance history" },
  student_gpas: { action: "archive", label: "GPA and class rank" },
};
async function autoMap(db, job, entity, header, rows) {
  const custom = await customFieldsOf(db, job.organization_id);
  const { rows: had } = await db.query("SELECT source_column, confirmed, action, target, resolved_at, notes FROM migration_columns WHERE job_id = $1 AND entity = $2", [job.job_id, entity]);
  // Someone's decision (a confirmed match, an action Managira or the school chose, notes) is kept;
  // a home a column only got by default is worked out again.
  const decided = (row) => row && (row.confirmed || row.resolved_at || row.notes);
  const kept = new Map(had.filter(decided).map((row) => [row.source_column, row]));
  const taken = new Set(had.filter((row) => row.confirmed && row.target && !row.target.startsWith("custom:")).map((row) => row.target));
  const exactOf = new Map();
  for (const column of header) {
    const before = kept.get(column);
    if (before && (before.confirmed || before.action)) continue;
    const exact = ps.matchColumn(entity, column, custom, taken);
    if (exact.confidence === "confident" && exact.target && !exact.target.startsWith("custom:") && !ps.sensitiveOf(column, [])) { exactOf.set(column, exact.target); taken.add(exact.target); }
  }
  for (const column of header) {
    const samples = [...new Set(rows.slice(0, 500).map((row) => String(row[column] == null ? "" : row[column]).trim()).filter(Boolean))].slice(0, 5);
    let sensitive = ps.sensitiveOf(column, samples);
    // A yes / no flag (Legal_Custody: 1) isn't a custody note: kept with its record, not an alert.
    if (sensitive === "custody" && samples.length && samples.every((v) => /^(0|1|y|n|yes|no|true|false|t|f|x)$/i.test(v))) sensitive = null;
    const before = kept.get(column);
    if (before && (before.confirmed || before.action)) {
      await db.query("UPDATE migration_columns SET samples = $3::jsonb, sensitive = COALESCE(sensitive, $4) WHERE job_id = $1 AND entity = $5 AND source_column = $2", [job.job_id, column, JSON.stringify(samples), sensitive, entity]);
      continue;
    }
    const match = sensitive === "custody" || sensitive === "ssn" ? { target: null, confidence: "none" }
      : exactOf.has(column) ? { target: exactOf.get(column), confidence: "confident" } : ps.matchColumn(entity, column, custom, taken);
    if (match.target && !match.target.startsWith("custom:")) taken.add(match.target);
    // Custody always becomes an alert; an SSN is left out unless the school confirms a legal need.
    const fallback = !match.target ? DEFAULT_HOME[entity] : null;
    const fallbackAction = fallback && fallback.action === "custom" && sensitive ? "extra" : fallback ? fallback.action : null;
    const action = sensitive === "custody" ? "alert" : sensitive === "ssn" ? "exclude" : match.confidence === "confident" ? "map" : fallbackAction;
    await db.query(
      `INSERT INTO migration_columns (job_id, organization_id, entity, source_column, target, confidence, confirmed, samples, sensitive, action, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT (job_id, entity, source_column) DO UPDATE SET target = EXCLUDED.target, confidence = EXCLUDED.confidence, confirmed = EXCLUDED.confirmed,
         samples = EXCLUDED.samples, sensitive = EXCLUDED.sensitive, action = EXCLUDED.action, label = EXCLUDED.label`,
      [job.job_id, job.organization_id, entity, column, match.target, match.confidence, match.confidence === "confident", JSON.stringify(samples), sensitive, action,
        sensitive === "custody" ? prettyLabel(column) : action === "extra" || action === "custom" ? prettyLabel(column) : action === "archive" && fallback ? fallback.label : null]
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
  const result = await saveNotesOnly(db, job, columnId, raw, actor);
  if (result && result.ok) tell(db, job.organization_id, "notes", {}, { throttleMinutes: 60 });
  return result;
}
async function saveNotesOnly(db, job, columnId, raw, actor) {
  const notes = Object.fromEntries(NOTE_KEYS.map((key) => [key, String((raw || {})[key] || "").trim().slice(0, 1000)]));
  if (!notes.what) return { error: "Say what the column is." };
  // A column with only the home it was given at first (a detail, kept read-only) goes back to the
  // Managira team with the school's words; one Managira or the school decided keeps its action.
  const { rowCount } = await db.query(
    `UPDATE migration_columns SET notes = $3::jsonb, notes_at = NOW(),
            label = CASE WHEN action IS NULL THEN label ELSE NULL END, action = NULL
      WHERE job_id = $1 AND column_id = $2 AND (action IS NULL OR (action IN ('extra', 'archive', 'custom') AND target IS NULL AND resolved_at IS NULL AND confidence = 'none'))`,
    [job.job_id, columnId, JSON.stringify(notes)]
  );
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
async function resolveColumn(db, job, columnId, body, actor) {
  const result = await resolveColumnOnly(db, job, columnId, body, actor);
  if (result && result.ok) await tellIfAnswered(db, job);
  return result;
}
// Once nothing the school explained is still waiting for Managira, the school hears.
async function tellIfAnswered(db, job) {
  const waitingColumns = openItems(await columnsOf(db, job)).needAction.length;
  const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM migration_roles WHERE job_id = $1 AND target IS NULL", [job.job_id]);
  if (!waitingColumns && !n) tell(db, job.organization_id, "answered", {}, { throttleMinutes: 60 });
}
async function resolveColumnOnly(db, job, columnId, { action, label, module, fieldType }, actor) {
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
const TOTAL_FIELDS = ["days_present", "days_absent", "days_excused", "days_unexcused", "days_tardy"];
function addAttendance(sum, data) {
  if (!data.date && TOTAL_FIELDS.some((f) => num(data[f]) !== null)) {
    const n = (f) => num(data[f]) || 0;
    sum.present += n("days_present");
    sum.excused += n("days_excused");
    sum.tardy += n("days_tardy");
    // Absences as sent, or excused and unexcused together.
    sum.absent += num(data.days_absent) !== null ? n("days_absent") : n("days_excused") + n("days_unexcused");
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
// Grades and attendance can run to hundreds of thousands of rows: they're read, checked and
// written a chunk at a time (`streamHeavy`), never held in memory whole.
const HEAVY = new Set(["grades", "attendance"]);

// One row of a list as a staged record: mapped fields, extra fields, archived columns, alerts.
function toRecord(entity, cols, header, cells, index, source, fileKey = "") {
  const row = {};
  for (let i = 0; i < header.length; i += 1) row[header[i]] = cells[i];
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
    else if (c.action === "custom") (data.customNew = data.customNew || {})[c.label || prettyLabel(c.source_column)] = value;
  }
  if (entity === "grades") {
    const credits = num(data.credits);
    if (credits !== null) source.credits += credits;
    source.grades.push({ gpa: num(data.gpa_points), attempted: num(data.credits_attempted), earned: credits });
  }
  if (entity === "attendance") {
    // Totals and days are counted apart: where a school sends both, its totals are the record.
    if (data.date) addAttendance(source.attendanceDays, data); else { addAttendance(source.attendance, data); source.attendanceTotalRows = (source.attendanceTotalRows || 0) + 1; }
  }
  if (Object.keys(custom).length) data.custom = custom;
  // Staff and class roles keep the row exactly as exported (bar columns left out), for their role history.
  if (entity === "staff" || entity === "section_teachers" || entity === "staff_roles") {
    data._raw = Object.fromEntries(cols.filter((c) => c.action !== "exclude").map((c) => [c.source_column, row[c.source_column] == null ? "" : String(row[c.source_column])]));
  }
  if (Object.keys(alerts).length) data.alerts = alerts;
  source.tidied = (source.tidied || 0) + tidy.record(entity, data);
  let id = clean(data.source_id, 120);
  // One parent with several children appears once per child: each (contact, child) is a record,
  // and the contact stays one person (`contact_id`).
  if (id && entity === "guardians" && data.student_source_id) { data.contact_id = id; id = `${id}:${clean(data.student_source_id, 60)}`; }
  if (!id && ["grades", "attendance"].includes(entity)) id = hashId(fileKey, data.student_source_id, data.course_name, data.term, data.school_year, data.date, data.code, index);
  if (!id && entity === "guardians") id = hashId(data.student_source_id, data.email, data.full_name, data.first_name, data.last_name);
  if (!id && entity === "enrollments") id = hashId(data.student_source_id, data.section_source_id, data.term);
  if (!id && entity === "section_teachers") id = hashId(data.section_source_id, data.teacher_source_id, data.class_role, data.start_date, index);
  if (!id && entity === "student_gpas") id = hashId(data.student_source_id, data.as_of, index);
  if (!id && entity === "student_details") id = clean(data.student_source_id, 120); // one row per student
  return { entity, sourceId: id, line: index + 2, data, extra, archive, issues: [], fileKey: String(fileKey) };
}
// The same record in two lists of one kind (a contacts list and a relationships list): one record,
// with what either list has. Within one list a repeat is a mistake, reported and left out.
function mergeInto(first, again) {
  for (const [k, v] of Object.entries(again.data || {})) if (first.data[k] === undefined || first.data[k] === "") first.data[k] = v;
  for (const [k, v] of Object.entries(again.extra || {})) if (!first.extra[k]) first.extra[k] = v;
  for (const [module, row] of Object.entries(again.archive || {})) first.archive[module] = { ...(row || {}), ...(first.archive[module] || {}) };
}

async function buildRecords(db, job, progress = quiet, { skip = new Set() } = {}) {
  const files = await currentFiles(db, job);
  const columns = await columnsOf(db, job);
  const byEntity = {};
  const source = { rows: {}, credits: 0, grades: [], attendance: { present: 0, absent: 0, excused: 0, tardy: 0 }, attendanceDays: { present: 0, absent: 0, excused: 0, tardy: 0 } };
  const totalRows = files.filter((f) => !skip.has(f.entity)).reduce((sum, f) => sum + (Number(f.row_count) || 0), 0);
  let seen = 0;
  for (const file of files) {
    if (skip.has(file.entity)) continue;
    const cols = columns.filter((c) => c.entity === file.entity);
    const out = (byEntity[file.entity] = byEntity[file.entity] || []);
    progress({ step: `Reading ${file.file_name}`, done: seen, total: totalRows });
    for await (const chunk of fileChunks(db, file)) {
    source.rows[file.entity] = (source.rows[file.entity] || 0) + chunk.rows.length;
    chunk.rows.forEach((cells, k) => {
      const index = chunk.offset + k;
      out.push(toRecord(file.entity, cols, chunk.header, cells, index, source, file.file_id));
    });
    seen += chunk.rows.length;
    progress({ done: seen });
    await tick();
    }
  }
  // A separate roles list (security groups) completes each member of staff's record.
  const staffById = new Map((byEntity.staff || []).map((t) => [String(t.sourceId), t]));
  for (const r of byEntity.staff_roles || []) {
    const t = staffById.get(String(r.sourceId));
    if (!t) { r.issues.push({ kind: "orphan", text: `Staff number ${r.sourceId || "(none)"} isn't in the staff file.`, blocking: false }); continue; }
    if (r.data.access_group || r.data.role) t.data.access_group = r.data.access_group || r.data.role;
    if (r.data.role && !t.data.title) t.data.title = r.data.role;
    t.data._raw = { ...(t.data._raw || {}), ...(r.data._raw || {}) };
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
  for (const entity of Object.keys(byEntity)) {
    if (HEAVY.has(entity) || entity === "other") continue;
    const firstOf = new Map();
    byEntity[entity] = byEntity[entity].filter((r) => {
      const first = r.sourceId && firstOf.get(r.sourceId);
      if (!first) { if (r.sourceId) firstOf.set(r.sourceId, r); return true; }
      if (first.fileKey === r.fileKey) return true; // a repeat within one list: reported by the checks
      mergeInto(first, r);
      return false;
    });
  }
  await check(byEntity);
  return { byEntity, source, files, columns };
}

async function check(byEntity) {
  let beat = 0;
  const add = (record, kind, text, blocking = false) => record.issues.push({ kind, text, blocking });
  const students = byEntity.students || [];
  const studentIds = new Set(students.map((s) => s.data.source_id).filter(Boolean));
  const seen = new Map();
  const people = new Map();
  for (const s of students) {
    if (++beat % 4000 === 0) await tick();
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
    if (++beat % 4000 === 0) await tick();
    checkHeavy(r, studentIds);
  }
}
function checkHeavy(r, studentIds, { schoolTotals = false } = {}) {
  const add = (kind, text, blocking = false) => r.issues.push({ kind, text, blocking });
  if (!studentIds.has(r.data.student_source_id)) add("orphan", `Student number ${r.data.student_source_id || "(none)"} isn't in the students file.`, true);
  if (r.entity === "grades" && !r.data.course_name) add("missing", "No course.", true);
  if (r.entity !== "attendance") return;
  const totals = TOTAL_FIELDS.some((f) => num(r.data[f]) !== null);
  if (!r.data.date && !totals) add("missing", "No date and no totals.", true);
  else if (r.data.date && isoDate(r.data.date) === "invalid") add("date", `"${r.data.date}" isn't a date.`, true);
  else if (r.data.date && !schoolTotals && ps.attendanceKind(r.data.code, r.data.present) === null) add("code", `Code "${r.data.code}" isn't one we know: it counts as absent.`);
}

// Writes the sandbox: every record upserted by its old ID, anything no longer in the files
// removed (so test edits and stale rows never reach go-live). One statement per kind.
async function runImport(db, job, actor, { progress = quiet, offset = 0, phases = 3 } = {}) {
  const step = (phase, words, extra = {}) => progress({ phase: offset + phase, phases, step: words, done: 0, total: 0, ...extra });
  step(1, "Reading your files");
  const { byEntity, source, files, columns } = await buildRecords(db, job, (u) => progress({ phase: offset + 1, phases, ...u }), { skip: new Set([...HEAVY, "other"]) });
  if (!files.length) return { error: "Upload at least one file first." };
  step(2, "Checking your records");
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
  // Every record is written in batches; whatever this import didn't write (gone from the files) is
  // then removed, by time, not by a list of every ID.
  const { rows: [{ started }] } = await db.query("SELECT clock_timestamp() AS started");
  const heavyFiles = files.filter((f) => HEAVY.has(f.entity) || f.entity === "other");
  const toWrite = Object.keys(ps.ENTITIES).reduce((sum, entity) => sum + (byEntity[entity] || []).length, 0) + heavyFiles.reduce((sum, f) => sum + (Number(f.row_count) || 0), 0);
  let written = 0;
  step(3, "Saving to the sandbox", { total: toWrite });
  const write = (entity, part) => again(() => db.query(
    `INSERT INTO migration_records (job_id, organization_id, entity, source_id, data, extra, archive, issues)
     SELECT $1, $2, $3, x.id, x.data, x.extra, x.archive, x.issues
       FROM unnest($4::text[], $5::jsonb[], $6::jsonb[], $7::jsonb[], $8::jsonb[]) AS x(id, data, extra, archive, issues)
     ON CONFLICT (job_id, entity, source_id) DO UPDATE SET data = EXCLUDED.data, extra = EXCLUDED.extra, archive = EXCLUDED.archive, issues = EXCLUDED.issues, updated_at = NOW()`,
    [job.job_id, job.organization_id, entity, part.map((r) => r.sourceId), part.map((r) => JSON.stringify(r.data)), part.map((r) => JSON.stringify(r.extra)), part.map((r) => JSON.stringify(r.archive)), part.map((r) => JSON.stringify(r.issues))]
  ));
  const noteIssues = (entity, r) => {
    for (const issue of r.issues) {
      const key = `${entity}:${issue.kind}`;
      report.issues[key] = (report.issues[key] || 0) + 1;
      if (report.examples.filter((e) => e.key === key).length < 8) report.examples.push({ key, entity, line: r.line, sourceId: r.sourceId, text: issue.text, blocking: issue.blocking });
    }
  };
  for (const entity of Object.keys(ps.ENTITIES)) {
    if (HEAVY.has(entity) || entity === "other") continue; // streamed below
    // One record per old ID: a repeat within one list keeps its first row (it's in the check
    // report); the same ID in another list of the same kind adds what that list has.
    const firstOf = new Map();
    const list = [];
    for (const r of byEntity[entity] || []) {
      if (!r.sourceId) continue;
      const first = firstOf.get(r.sourceId);
      if (!first) { firstOf.set(r.sourceId, r); list.push(r); } else if (first.fileKey !== r.fileKey) mergeInto(first, r);
    }
    for (let i = 0; i < list.length; i += BATCH) {
      const part = list.slice(i, i + BATCH);
      await write(entity, part);
      written += part.length;
      progress({ done: written });
      await tick();
    }
    written += (byEntity[entity] || []).length - list.length; // repeats (reported) and merged rows
    await db.query("DELETE FROM migration_records WHERE job_id = $1 AND entity = $2 AND updated_at < $3", [job.job_id, entity, started]);
    report.entities[entity] = { source: source.rows[entity] || 0, staged: list.length };
    for (const r of byEntity[entity] || []) noteIssues(entity, r);
  }
  // Grades and attendance: read, checked and written a chunk at a time.
  const studentIds = new Set((byEntity.students || []).map((r) => r.data.source_id).filter(Boolean));
  const attendanceTotals = columns.some((c) => c.entity === "attendance" && c.action === "map" && /^days_/.test(c.target || "") && (c.confirmed || c.confidence === "confident"));
  for (const entity of HEAVY) {
    const seenIds = new Set();
    let staged = 0;
    for (const file of heavyFiles.filter((f) => f.entity === entity)) {
      const cols = columns.filter((c) => c.entity === entity);
      progress({ step: `Saving ${file.file_name}` });
      for await (const chunk of fileChunks(db, file)) {
        source.rows[entity] = (source.rows[entity] || 0) + chunk.rows.length;
        const part = [];
        for (let k = 0; k < chunk.rows.length; k += 1) {
          const r = toRecord(entity, cols, chunk.header, chunk.rows[k], chunk.offset + k, source, file.file_id);
          checkHeavy(r, studentIds, { schoolTotals: attendanceTotals });
          noteIssues(entity, r);
          if (r.sourceId && !seenIds.has(r.sourceId)) { seenIds.add(r.sourceId); part.push(r); }
        }
        for (let i = 0; i < part.length; i += BATCH) { await write(entity, part.slice(i, i + BATCH)); await tick(); }
        staged += part.length;
        written += chunk.rows.length;
        progress({ done: written });
        await tick();
      }
    }
    await db.query("DELETE FROM migration_records WHERE job_id = $1 AND entity = $2 AND updated_at < $3", [job.job_id, entity, started]);
    if (source.rows[entity] || staged) report.entities[entity] = { source: source.rows[entity] || 0, staged };
  }
  // Every other list: each row kept whole (bar Social Security numbers), with its student number.
  report.lists = [];
  let otherRows = 0;
  for (const file of heavyFiles.filter((f) => f.entity === "other")) {
    const seen = lists.recognize(file.file_name, file.header);
    progress({ step: `Keeping ${seen.label}` });
    let rows = 0;
    let students = 0;
    for await (const chunk of fileChunks(db, file)) {
      const at = seen.studentColumn ? chunk.header.indexOf(seen.studentColumn) : -1;
      const keepCol = chunk.header.map((h) => Boolean(h) && ps.sensitiveOf(h, []) !== "ssn");
      const part = chunk.rows.map((cells, k) => {
        const row = {};
        for (let i = 0; i < chunk.header.length; i += 1) if (keepCol[i] && cells[i] !== "" && cells[i] != null) row[chunk.header[i]] = clean(cells[i], 4000);
        const student = at >= 0 ? clean(cells[at], 120) || null : null;
        if (student && studentIds.has(student)) students += 1;
        return { sourceId: hashId(file.file_id, file.file_name, chunk.offset + k), line: chunk.offset + k + 2, data: { list: seen.label, restricted: seen.restricted, details: seen.details, student_source_id: student, row }, extra: {}, archive: {}, issues: [] };
      });
      for (let i = 0; i < part.length; i += BATCH) { await write("other", part.slice(i, i + BATCH)); await tick(); }
      rows += part.length;
      written += chunk.rows.length;
      progress({ done: written });
      await tick();
    }
    otherRows += rows;
    report.lists.push({ name: file.file_name, label: seen.label, rows, restricted: seen.restricted, details: seen.details, perStudent: Boolean(seen.studentColumn), students });
  }
  await db.query("DELETE FROM migration_records WHERE job_id = $1 AND entity = 'other' AND updated_at < $2", [job.job_id, started]);
  if (otherRows) report.entities.other = { source: otherRows, staged: otherRows };
  report.documents = await matchDocuments(db, job, studentIds);
  report.tidied = source.tidied || 0;
  const totals = { ...job.totals, report, source: { credits: round(source.credits), gpa: gpaOf(source.grades), attendance: source.attendanceTotalRows ? source.attendance : source.attendanceDays }, importedAt: new Date().toISOString() };
  await db.query("UPDATE migration_jobs SET totals = $2::jsonb, updated_at = NOW() WHERE job_id = $1", [job.job_id, JSON.stringify(totals)]);
  job.totals = totals;
  await refreshRoles(db, job, byEntity.staff || []);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "imported", detail: { entities: report.entities } });
  return { report };
}
const round = (n) => Math.round(n * 100) / 100;

// Each document's student: the school's document index (by its path), else a student number in
// its folder or file name. The index's type and "confidential" flag win over what the name says.
async function matchDocuments(db, job, studentIds) {
  const { rows: docs } = await db.query("SELECT document_id, path, file_name, kind, restricted FROM migration_documents WHERE job_id = $1", [job.job_id]);
  if (!docs.length) return { total: 0, matched: 0, restricted: 0 };
  const index = new Map();
  const { rows: indexRows } = await db.query("SELECT data FROM migration_records WHERE job_id = $1 AND entity = 'other' AND data->>'list' ~* 'document'", [job.job_id]);
  const pick = (row, keys) => { const k = Object.keys(row).find((c) => keys.includes(String(c).toLowerCase().replace(/[^a-z0-9]/g, ""))); return k ? row[k] : null; };
  for (const { data } of indexRows) {
    const row = data.row || {};
    const path = pick(row, ["filepath", "path", "filename", "file", "documentpath", "location", "documentfile"]);
    if (!path) continue;
    const confidential = pick(row, ["confidential", "restricted", "sensitive", "private"]);
    index.set(String(path).toLowerCase().replace(/\\/g, "/").replace(/^\.?\//, ""), {
      student: data.student_source_id || null, kind: pick(row, ["documenttype", "type", "doctype", "category", "description", "title"]),
      restricted: confidential == null ? null : /^(1|y|yes|true|t)$/i.test(String(confidential).trim()),
    });
  }
  const ids = [];
  const students = [];
  const kinds = [];
  const restricted = [];
  let matched = 0;
  for (const doc of docs) {
    const path = String(doc.path).toLowerCase();
    let hit = null;
    for (const [key, value] of index) if (path === key || path.endsWith(`/${key}`)) { hit = value; break; }
    let student = hit && hit.student;
    if (!student) student = path.split(/[^a-z0-9]+/).find((token) => studentIds.has(token)) || null;
    if (student) matched += 1;
    ids.push(doc.document_id);
    students.push(student);
    kinds.push(String((hit && hit.kind) || doc.kind || "Document").slice(0, 120));
    restricted.push(hit && hit.restricted !== null ? hit.restricted : doc.restricted); // the school's own "confidential" flag wins
  }
  for (let i = 0; i < ids.length; i += 2000) {
    await db.query(
      `UPDATE migration_documents d SET student_source_id = x.s, kind = x.k, restricted = x.r FROM unnest($1::bigint[], $2::text[], $3::text[], $4::boolean[]) AS x(id, s, k, r) WHERE d.document_id = x.id`,
      [ids.slice(i, i + 2000), students.slice(i, i + 2000), kinds.slice(i, i + 2000), restricted.slice(i, i + 2000)]
    );
  }
  return { total: docs.length, matched, restricted: restricted.filter(Boolean).length };
}
// The documents, for the screen: a few at a time, with their student's name.
async function documentsOf(db, job, { limit = 300 } = {}) {
  const { rows } = await db.query(
    `SELECT d.document_id, d.file_name, d.path, d.kind, d.restricted, d.size_bytes, d.student_source_id, d.student_id,
            COALESCE(NULLIF(TRIM(CONCAT(r.data->>'first_name', ' ', r.data->>'last_name')), ''), '') AS student_name
       FROM migration_documents d
       LEFT JOIN migration_records r ON r.job_id = d.job_id AND r.entity = 'students' AND r.source_id = d.student_source_id
      WHERE d.job_id = $1 ORDER BY d.student_source_id NULLS LAST, d.path LIMIT $2`,
    [job.job_id, limit]
  );
  const { rows: [sum] } = await db.query(
    "SELECT COUNT(*)::int AS total, COUNT(student_source_id)::int AS matched, COUNT(*) FILTER (WHERE restricted)::int AS restricted, COALESCE(SUM(size_bytes), 0)::bigint AS bytes, COUNT(DISTINCT student_source_id)::int AS students FROM migration_documents WHERE job_id = $1",
    [job.job_id]
  );
  return { list: rows, ...sum };
}

// What the sandbox holds, for the screen: counts, totals, a few rows of each kind.
// What's in the sandbox (counts, credits, a few rows of each kind): it changes only with an
// import, so each import's summary is kept for ten minutes rather than counted on every view.
const summaries = new BoundedMap(200);
async function sandboxSummary(db, job) {
  const key = `${job.job_id}|${(job.totals && job.totals.importedAt) || ""}`;
  const hit = summaries.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  const value = await countSandbox(db, job);
  summaries.set(key, { at: Date.now(), value });
  return value;
}
async function countSandbox(db, job) {
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
  // The first five of each kind, read from the index (never the whole sandbox sorted).
  const { rows: sample } = await db.query(
    `SELECT e.entity, r.source_id, r.data FROM unnest($2::text[]) AS e(entity)
       CROSS JOIN LATERAL (SELECT source_id, data FROM migration_records WHERE job_id = $1 AND entity = e.entity ORDER BY source_id LIMIT 5) r`, // in the index's order: no sort
    [job.job_id, Object.keys(out)]
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
  // One of the school's own roles (Users › Add user › Add a role), for any old role, even one
  // Managira couldn't match: never one based on Manager. Whatever it gives beyond the old role
  // still needs the school admin's approval, person by person.
  const own = /^school:(\d+)$/.exec(target);
  if (own) {
    const role = await schoolRoles.byId(db, job.organization_id, own[1]);
    if (!role || role.base_type === "Manager") return { error: "Choose one of your school's roles (not one based on Manager)." };
    await db.query(
      `UPDATE migration_roles SET target = 'custom', label = $3, account_type = $4, permissions = $5::jsonb, school_role_id = $6, confirmed = TRUE, updated_at = NOW()
        WHERE job_id = $1 AND role_id = $2`,
      [job.job_id, roleId, role.name, role.base_type, JSON.stringify(role.permissions || []), role.role_id]
    );
    await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "role_confirmed", detail: { role: row.old_role, target: role.name } });
    return { ok: true };
  }
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
  tell(db, job.organization_id, "notes", {}, { throttleMinutes: 60 });
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
    if (await schoolRoles.ready(db)) await db.query("UPDATE migration_roles SET school_role_id = NULL WHERE job_id = $1 AND role_id = $2", [job.job_id, roleId]);
  } else {
    if (!roles.ROLES[body.target]) return { error: "Choose a Managira role." };
    await db.query("UPDATE migration_roles SET level = $3, target = $4, label = NULL, account_type = NULL, permissions = NULL, confirmed = TRUE, resolved_by = $5, resolved_at = NOW(), updated_at = NOW() WHERE job_id = $1 AND role_id = $2",
      [job.job_id, roleId, level, body.target, actor]);
  }
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, actorKind: "managira", action: "role_resolved", detail: { role: row.old_role, level, target: body.target } });
  await tellIfAnswered(db, job);
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
      // No role at all in the export (one waiting for Managira's match is counted with its role).
      existing, noAccount, noRole: active && !existing && !noAccount && !choice && !oldRole, needsApproval, key,
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
  // Which kinds of list are uploaded: one small read, not every list twice.
  const present = new Set((await db.query("SELECT DISTINCT entity FROM migration_files WHERE job_id = $1 AND replaced_at IS NULL AND content IS NOT NULL", [job.job_id])).rows.map((r) => r.entity));
  if (!present.size) out.push("Upload the export files.");
  if (open.unsure.length) out.push(`Confirm ${open.unsure.length} unsure ${open.unsure.length === 1 ? "match" : "matches"}.`);
  if (open.needAction.length) out.push(`${open.needAction.length} ${open.needAction.length === 1 ? "column needs" : "columns need"} an action from the Managira team.`);
  if (open.needApproval.length) out.push(`Approve leaving out ${open.needApproval.length} ${open.needApproval.length === 1 ? "column" : "columns"}.`);
  const blocking = ((job.totals && job.totals.report && job.totals.report.examples) || []).filter((e) => e.blocking).length;
  if (blocking) out.push("Fix the errors in the check report (red) in the export, upload it again and import.");
  const needed = SECTIONS.filter((s) => (ps.ENTITIES[s] ? present.has(s) : s === "roles" ? present.has("staff") : s === "custom_fields" ? columns.some((c) => c.target && c.target.startsWith("custom:") || c.action === "extra") : columns.some((c) => c.action === "archive") || present.has("attendance") || present.has("other")));
  if (present.has("staff")) {
    const { open: roleOpen } = await roleReport(db, job);
    const n = (list, one, many) => `${list.length} ${list.length === 1 ? one : many}`;
    if (roleOpen.unsure.length) out.push(`Confirm ${n(roleOpen.unsure, "unsure role match", "unsure role matches")} (Staff roles).`);
    if (roleOpen.waiting.length) out.push(`${n(roleOpen.waiting, "role needs", "roles need")} a Managira role: explain ${roleOpen.waiting.length === 1 ? "it" : "them"} in Staff roles; the Managira team then matches ${roleOpen.waiting.length === 1 ? "it" : "them"}.`);
    if (roleOpen.noRole.length) out.push(`${n(roleOpen.noRole, "active member of staff has", "active members of staff have")} no role: give them one in your export, or mark them inactive.`);
    if (roleOpen.toApprove.length) out.push(`Approve ${n(roleOpen.toApprove, "person whose", "people whose")} access goes up or is admin-level (Staff roles).`);
  }
  if (present.has("students")) {
    const { waiting } = await studentMatches(db, job, await stagedStudents(db, job));
    if (waiting) out.push(`Say whether ${waiting === 1 ? "1 student is" : `${waiting} students are`} already in Managira, or in your files twice (Review & sign, Already in Managira).`);
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
  tell(db, job.organization_id, "signed", { signedBy: signed });
  return { ok: true };
}

// The migration summary the school signs: every column by what happened to it.
function summary(columns, customFields = []) {
  const groups = { mapped: [], custom: [], extra: [], archived: [], excluded: [], alerts: [] };
  for (const c of columns) {
    const where = `${ps.ENTITIES[c.entity] ? ps.ENTITIES[c.entity].label : c.entity}: ${c.source_column}`;
    if (c.action === "map" && c.target && c.target.startsWith("custom:")) groups.custom.push(`${where} → ${ps.targetLabel(c.entity, c.target, customFields)}`);
    else if (c.action === "map" && c.target) groups.mapped.push(`${where} → ${ps.targetLabel(c.entity, c.target)}`);
    else if (c.action === "custom") groups.custom.push(`${where} → new custom field "${c.label}"`);
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
  student_form_fields: ["field_id"],
  school_roles: ["role_id"],
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
// Columns about a student with no built-in place in Managira: each is one of the school's custom
// fields (its own, matched by name, or a new one made at go-live) or a read-only detail.
const FIELD_ENTITIES = ["students", "student_details"];
const fieldChoices = (columns) => columns.filter((c) => FIELD_ENTITIES.includes(c.entity)
  && ((c.action === "map" && String(c.target || "").startsWith("custom:")) || c.action === "custom" || c.action === "extra"));
async function setCustomFields(db, job, chosen, actor) {
  const ticked = new Set(chosen.map(Number));
  let fields = 0;
  let details = 0;
  for (const c of fieldChoices(await columnsOf(db, job))) {
    if (c.action === "map") continue; // already one of the school's own fields
    const custom = ticked.has(Number(c.column_id));
    await db.query("UPDATE migration_columns SET action = $3, target = NULL, label = COALESCE(label, $4), resolved_by = $5, resolved_at = NOW() WHERE job_id = $1 AND column_id = $2",
      [job.job_id, c.column_id, custom ? "custom" : "extra", prettyLabel(c.source_column), actor]);
    if (custom) fields += 1; else details += 1;
  }
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "custom_fields_chosen", detail: { fields, details } });
  return { ok: true, fields, details };
}

// A new custom field's type, from the values it will hold.
function fieldTypeOf(samples) {
  const values = (samples || []).map((v) => String(v).trim()).filter(Boolean);
  if (!values.length) return "text";
  if (values.every((v) => /^(0|1|y|n|yes|no|true|false)$/i.test(v))) return "yes_no";
  if (values.every((v) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v))) return "date";
  if (values.every((v) => /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v))) return "number";
  return values.some((v) => v.length > 120) ? "long_text" : "text";
}
function fieldValueAs(type, value) {
  const text = clean(value, 4000);
  if (!text) return null;
  if (type === "yes_no") return /^(1|y|yes|true)$/i.test(text) ? "yes" : "no";
  if (type === "date") { const iso = isoDate(text); return iso && iso !== "invalid" ? iso : text; }
  return text;
}
// A pickup list's "do not release" (or not authorized, restricted): a custody alert naming the person.
function releaseAlertOf(list, row) {
  if (!/pickup|release|authori[sz]ed|dismissal/i.test(list)) return null;
  const pick = (...names) => { const key = Object.keys(row).find((k) => names.includes(String(k).toLowerCase().replace(/[^a-z0-9]/g, ""))); return key ? clean(row[key], 600) : ""; };
  const status = pick("status", "pickupstatus", "authorization", "allowed");
  const note = pick("restrictionnote", "restriction", "note", "notes", "courtorder");
  if (!/do\s*not\s*release|not\s*authori|restrict|prohibit|no\s*contact/i.test(`${status} ${/^(0|n|no)$/i.test(status) ? "not authorised" : ""}`)) return null;
  const person = pick("personname", "name", "adultname", "authorizedadult");
  const relationship = pick("relationship");
  return { label: `Do not release to ${person || "this person"}${relationship ? ` (${relationship})` : ""}`, text: note || `${status}.` };
}
// An alert for the top of a student's record from a health list: an emergency care plan, or a
// condition marked severe or with an emergency action plan. Others stay in the restricted list.
function medicalAlertOf(list, row) {
  const pick = (...names) => { const key = Object.keys(row).find((k) => names.includes(String(k).toLowerCase().replace(/[^a-z0-9]/g, ""))); return key ? clean(row[key], 600) : ""; };
  const condition = pick("condition", "diagnosis", "allergy", "healthcondition", "medicalcondition");
  if (/care.?plan|emergency.?plan|health.?plan/i.test(list)) {
    const steps = pick("emergencysteps", "emergencyaction", "actionplan", "steps", "instructions");
    const trained = pick("trainedstaff", "trained");
    if (!condition && !steps) return null;
    return { label: pick("plantype", "type", "plan") || "Health care plan", text: `${condition}${steps ? ` — ${steps}` : ""}${trained ? ` (trained staff: ${trained})` : ""}` };
  }
  if (/allerg|health.?condition|medical.?condition|conditions/i.test(list)) {
    const severity = pick("severity", "level");
    const plan = pick("emergencyactionplan", "emergencyplan", "actionplan");
    if (!condition || !(/severe|life|anaphyla/i.test(`${severity} ${condition}`) || /^(1|y|yes|true)$/i.test(plan))) return null;
    const notes = pick("notes", "note", "comments");
    return { label: condition, text: `${severity ? `${severity}. ` : ""}${notes || "See the student's health records."}` };
  }
  return null;
}

// ── Records already in Managira ─────────────────────────────────────────────────────────
// Nothing the school already has is replaced. A student in the files is one Managira already
// has when it has them by this migration's link, by their old student number (with the same
// first or last name), or by the same name and date of birth (and nobody else matches): they keep
// everything, and only what's empty is filled in. Someone with the same name but another (or no)
// date of birth, or several possible matches, is asked about; so is the same name and date of
// birth twice in the files. Answers live in migration_jobs.match_decisions until go-live.
const STUDENT_COLUMNS = ["first_name", "last_name", "date_of_birth", "date_of_birth_unknown", "gender", "class_id", "email", "address", "custom_student_id"];
const FIELD_LABELS = { first_name: "First name", last_name: "Last name", date_of_birth: "Date of birth", gender: "Gender", class_id: "Class", class_name: "Class", email: "Email", address: "Address", custom_student_id: "Student number", phone: "Phone", phone_number: "Phone", org_role_title: "Title" };
const isEmpty = (v) => v === null || v === undefined || String(v).trim() === "";
const sameValue = (a, b) => tidy.key(a) === tidy.key(b);
// What to write to a record: what's empty, and what the migration wrote last time if the school
// hasn't changed it since (`loaded`). Anything else stays as Managira has it (`kept`).
function mergePlan(live, incoming, loaded = {}) {
  const set = {};
  const kept = [];
  for (const [field, value] of Object.entries(incoming)) {
    if (isEmpty(value)) continue;
    const now = live ? live[field] : null;
    if (isEmpty(now)) set[field] = value;
    else if (sameValue(now, value)) continue;
    else if (loaded && Object.prototype.hasOwnProperty.call(loaded, field) && sameValue(now, loaded[field])) set[field] = value;
    else kept.push({ field, live: now, file: value });
  }
  return { set, kept };
}
function studentValues(d) {
  const dob = isoDate(d.date_of_birth);
  const address = [d.address, [d.city, [d.state, d.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  return {
    first_name: clean(d.first_name, 100) || null, last_name: clean(d.last_name, 100) || null, date_of_birth: dob && dob !== "invalid" ? dob : null,
    gender: clean(d.gender, 20) || null, email: clean(d.email, 200) || null, address, custom_student_id: clean(d.source_id, 50) || null,
  };
}
const nameOf = (d) => [d.first_name, d.last_name].filter(Boolean).join(" ") || "(no name)";
async function studentMatches(db, job, staged) {
  const org = job.organization_id;
  const decisions = job.match_decisions || {};
  const [{ rows: live }, { rows: links }] = await Promise.all([
    db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth::text AS date_of_birth, s.gender, s.class_id, s.email, s.address, s.custom_student_id, c.class_name
         FROM students s LEFT JOIN classes c ON c.class_id = s.class_id WHERE s.organization_id = $1`,
      [org]
    ),
    db.query("SELECT source_id, managira_id, loaded FROM migration_links WHERE organization_id = $1 AND entity = 'students' AND source_system = $2", [org, job.source_system]),
  ]);
  const byId = new Map(live.map((r) => [Number(r.student_id), r]));
  const linkOfSource = new Map(links.filter((l) => byId.has(Number(l.managira_id))).map((l) => [String(l.source_id), l]));
  const linked = new Set([...linkOfSource.values()].map((l) => Number(l.managira_id)));
  const index = { number: new Map(), person: new Map(), name: new Map() };
  const add = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
  for (const r of live) {
    if (!isEmpty(r.custom_student_id)) add(index.number, tidy.key(r.custom_student_id), r);
    add(index.name, tidy.key(r.first_name, r.last_name), r);
    if (r.date_of_birth) add(index.person, tidy.key(r.first_name, r.last_name, r.date_of_birth), r);
  }
  const out = new Map();
  const questions = [];
  const claimed = new Set();
  const firstInFiles = new Map();
  const card = (r) => ({ id: Number(r.student_id), name: nameOf(r), dob: r.date_of_birth || null, className: r.class_name || null, number: r.custom_student_id || null });
  const free = (list) => (list || []).filter((r) => !linked.has(Number(r.student_id)) && !claimed.has(Number(r.student_id)));
  const take = (sid, id, how) => { claimed.add(id); out.set(sid, { id, how }); };
  for (const rec of staged) {
    const sid = String(rec.source_id);
    const d = rec.data || {};
    const v = studentValues(d);
    const link = linkOfSource.get(sid);
    if (link) { out.set(sid, { id: Number(link.managira_id), how: "link", loaded: link.loaded || null }); continue; }
    // The same name and date of birth twice in the files.
    const person = v.date_of_birth && tidy.key(v.first_name, v.last_name, v.date_of_birth);
    if (person && firstInFiles.has(person)) {
      const other = firstInFiles.get(person);
      const key = `file:${sid}`;
      const answer = decisions[key] && (decisions[key].different || decisions[key].sameAs === other.sid) ? decisions[key] : null;
      questions.push({ key, kind: "file", sourceId: sid, name: nameOf(d), dob: v.date_of_birth, other: other.sid, otherName: other.name, answer });
      if (!answer) { out.set(sid, { waiting: true }); continue; }
      if (answer.sameAs) { out.set(sid, { sameAs: other.sid }); continue; }
    } else if (person) firstInFiles.set(person, { sid, name: nameOf(d) });
    // Already in Managira?
    const byNumber = free(index.number.get(tidy.key(sid)));
    const sameName = (r) => sameValue(r.first_name, v.first_name) || sameValue(r.last_name, v.last_name);
    const exact = person ? free(index.person.get(person)) : [];
    if (byNumber.length === 1 && sameName(byNumber[0])) { take(sid, Number(byNumber[0].student_id), "number"); continue; }
    if (!byNumber.length && exact.length === 1) { take(sid, Number(exact[0].student_id), "name and date of birth"); continue; }
    const maybe = [...new Map([...byNumber, ...exact, ...free(index.name.get(tidy.key(v.first_name, v.last_name)))].map((r) => [Number(r.student_id), r])).values()];
    if (!maybe.length) { out.set(sid, { fresh: true }); continue; }
    const key = `students:${sid}`;
    const saved = decisions[key];
    const answer = saved && (saved.different || (saved.same && maybe.some((r) => Number(r.student_id) === Number(saved.same)))) ? saved : null;
    questions.push({ key, kind: "live", sourceId: sid, name: nameOf(d), dob: v.date_of_birth, candidates: maybe.slice(0, 5).map(card), answer });
    if (!answer) out.set(sid, { waiting: true });
    else if (answer.different) out.set(sid, { fresh: true });
    else take(sid, Number(answer.same), "your answer");
  }
  return { out, questions, byId, waiting: questions.filter((q) => !q.answer).length };
}
const stagedStudents = async (db, job) => (await db.query("SELECT source_id, data FROM migration_records WHERE job_id = $1 AND entity = 'students' ORDER BY record_id", [job.job_id])).rows;

// For Review: who is already in Managira, what will be filled in and what stays as it is.
async function liveMatches(db, job) {
  const staged = await stagedStudents(db, job);
  const found = await studentMatches(db, job, staged);
  const matched = [];
  let fresh = 0;
  for (const rec of staged) {
    const o = found.out.get(String(rec.source_id)) || {};
    if (o.fresh) { fresh += 1; continue; }
    if (!o.id) continue;
    const live = found.byId.get(o.id) || {};
    const incoming = { ...studentValues(rec.data || {}), class_name: gradeClass(rec.data && rec.data.class_name) || null };
    const plan = mergePlan({ ...live, date_of_birth: live.date_of_birth || null }, incoming, o.loaded || {});
    matched.push({
      sourceId: String(rec.source_id), name: nameOf(rec.data || {}), id: o.id, how: o.how, liveName: nameOf(live),
      fills: Object.keys(plan.set).map((f) => FIELD_LABELS[f] || f), kept: plan.kept.map((k) => ({ label: FIELD_LABELS[k.field] || k.field, live: k.live, file: k.file })),
    });
  }
  const { rows: [people] } = await db.query(
    `SELECT (SELECT COUNT(DISTINCT LOWER(r.data->>'email'))::int FROM migration_records r
               JOIN guardian_profiles g ON g.organization_id = $2 AND LOWER(g.email) = LOWER(r.data->>'email')
              WHERE r.job_id = $1 AND r.entity = 'guardians' AND COALESCE(r.data->>'email', '') <> '') AS guardians,
            (SELECT COUNT(DISTINCT LOWER(r.data->>'email'))::int FROM migration_records r
               JOIN users u ON u.organization_id = $2 AND LOWER(u.email) = LOWER(r.data->>'email')
              WHERE r.job_id = $1 AND r.entity = 'staff' AND COALESCE(r.data->>'email', '') <> '') AS staff`,
    [job.job_id, job.organization_id]
  );
  return { matched, fresh, questions: found.questions, waiting: found.waiting, guardians: people.guardians, staff: people.staff, tidied: (job.totals && job.totals.report && job.totals.report.tidied) || 0 };
}
// The school's answer to one question: the same student (one of those shown), or a different one.
async function decideMatch(db, job, body, actor) {
  if (!["sandbox", "live"].includes(job.status)) return { error: "Your summary is signed, and these answers are part of it. Ask Managira if one needs changing." };
  const found = await studentMatches(db, job, await stagedStudents(db, job));
  const question = found.questions.find((q) => q.key === String(body.key || ""));
  if (!question) return { error: "That question isn't open any more. Import again if your files changed." };
  let answer = null;
  if (body.choice === "different") answer = { different: true };
  else if (body.choice === "same" && question.kind === "file") answer = { sameAs: question.other };
  else if (body.choice === "same" && question.candidates.some((c) => c.id === Number(body.id))) answer = { same: Number(body.id) };
  else if (body.choice !== "undo") return { error: "Choose one of the students shown." };
  if (answer) Object.assign(answer, { by: actor, at: new Date().toISOString() });
  await db.query(
    answer
      ? "UPDATE migration_jobs SET match_decisions = COALESCE(match_decisions, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb), updated_at = NOW() WHERE job_id = $1"
      : "UPDATE migration_jobs SET match_decisions = COALESCE(match_decisions, '{}'::jsonb) - $2::text, updated_at = NOW() WHERE job_id = $1",
    answer ? [job.job_id, question.key, JSON.stringify(answer)] : [job.job_id, question.key]
  );
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "match_answered", detail: { key: question.key, choice: body.choice } });
  return { ok: true };
}

async function loadLive(db, job, actor, progress = quiet) {
  await require("./studentFormFields").ensureStudentFormFieldsSchema(db).catch(() => {}); // outside the go-live's transaction
  const org = job.organization_id;
  const system = job.source_system;
  const client = await db.connect();
  const counts = {
    students: 0, enrolled: 0, guardians: 0, classes: 0, subjects: 0, staff: 0, staffNew: 0, staffInactive: 0, teacherLinks: 0, mainTeachers: 0, assistants: 0, sectionsUnplaced: 0,
    courses: 0, credits: 0, gpa: null, attendanceTerms: 0, attendance: { present: 0, absent: 0, excused: 0, tardy: 0 }, customValues: 0, extras: 0, alerts: 0, archives: 0,
    // Records Managira already had: kept, with only empty fields filled in; differences kept as Managira had them.
    matched: 0, guardiansMatched: 0, staffMatched: 0, filled: 0, keptValues: 0, kept: [], studentsWaiting: 0, lists: 0, listRows: 0, listRowsUnmatched: 0, documents: 0,
    customFieldsMade: 0, customFieldsSkipped: 0, detailsUnmatched: 0, medicalAlerts: 0,
  };
  const noteKept = (who, kept) => {
    counts.keptValues += kept.length;
    if (kept.length && counts.kept.length < 100) counts.kept.push({ who, fields: kept.map((k) => ({ label: FIELD_LABELS[k.field] || k.field, live: String(k.live), file: String(k.file) })) });
  };
  const staffSkipped = [];
  try {
    await client.query("BEGIN");
    const q = (sql, args) => client.query(sql, args);
    const ledger = await ledgerFor(client, job);
    const records = async (entity) => (await q("SELECT source_id, data, extra, archive FROM migration_records WHERE job_id = $1 AND entity = $2 ORDER BY record_id", [job.job_id, entity])).rows;
    const linkOf = async (entity, sourceId) => (await q("SELECT managira_id, loaded FROM migration_links WHERE organization_id = $1 AND entity = $2 AND source_system = $3 AND source_id = $4", [org, entity, system, String(sourceId)])).rows[0];
    // `loaded`: what the migration last wrote to the record, so a later load never overwrites a change the school made since.
    const link = (entity, sourceId, id, loaded = null) => q(
      `INSERT INTO migration_links (organization_id, entity, source_system, source_id, managira_id, job_id, loaded) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (organization_id, entity, source_system, source_id) DO UPDATE SET managira_id = EXCLUDED.managira_id, job_id = EXCLUDED.job_id,
         loaded = COALESCE(EXCLUDED.loaded, migration_links.loaded), updated_at = NOW()`,
      [org, entity, system, String(sourceId), id, job.job_id, loaded ? JSON.stringify(loaded) : null]
    );
    const written = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v)));
    const extraOn = (entity, id, label, item) => q(
      `INSERT INTO record_extra_fields (organization_id, entity, record_id, label, value, sensitive, source, job_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, entity, record_id, label) DO UPDATE SET value = EXCLUDED.value, sensitive = EXCLUDED.sensitive, job_id = EXCLUDED.job_id, updated_at = NOW()`,
      [org, entity, id, label.slice(0, 80), clean(item.value, 4000), Boolean(item.sensitive), system, job.job_id]
    ).then(() => { counts.extras += 1; });

    // Everything kept read-only, gathered here and written in batches at the end: per student and
    // module, or for the school (student null). Restricted when its module or list is sensitive.
    const archived = new Map();
    const keep = (studentId, module, rows, restricted = false) => {
      const key = `${studentId || ""}|${module}`;
      if (!archived.has(key)) archived.set(key, { studentId: studentId || null, module: String(module).slice(0, 120), restricted: false, rows: [] });
      const a = archived.get(key);
      a.restricted = a.restricted || Boolean(restricted) || SENSITIVE_MODULES.has(module);
      for (const row of rows) a.rows.push(row);
    };

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
    // A student the school already had stays in the class it put them in (`keep`).
    const enroll = async (studentId, classId, keep = false) => {
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
      } else if (!keep && Number(had.class_id) !== Number(classId)) {
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
    // A custom role becomes one of the school's own roles (Users › Add user), so its name stays
    // with the people who have it: the school's role it was matched to, or one made now (once,
    // by name) from the role the Managira team made.
    const rolesReady = schoolRoles.on(org) && (await schoolRoles.ready(db));
    const schoolRoleOf = new Map();
    const schoolRoleFor = async (choice) => {
      if (!rolesReady || !choice || !choice.custom) return null;
      if (schoolRoleOf.has(choice.key)) return schoolRoleOf.get(choice.key);
      let roleId = null;
      if (choice.schoolRoleId) {
        roleId = ((await q("SELECT role_id FROM school_roles WHERE role_id = $1 AND organization_id = $2 AND base_type = $3 AND archived_at IS NULL", [choice.schoolRoleId, org, choice.accountType])).rows[0] || {}).role_id || null;
      } else if (choice.label && !schoolRoles.BASE_TYPES.some((b) => b.toLowerCase() === choice.label.toLowerCase())) {
        const { rows: [hit] } = await q("SELECT role_id, base_type FROM school_roles WHERE organization_id = $1 AND LOWER(name) = LOWER($2) AND archived_at IS NULL", [org, choice.label]);
        if (hit) roleId = hit.base_type === choice.accountType ? hit.role_id : null;
        else {
          ({ rows: [{ role_id: roleId }] } = await q(
            "INSERT INTO school_roles (organization_id, name, base_type, permissions) VALUES ($1, $2, $3, $4::text[]) RETURNING role_id",
            [org, choice.label.slice(0, 60), choice.accountType, choice.permissions]
          ));
          ledger.made("school_roles", { role_id: roleId });
          counts.schoolRoles = (counts.schoolRoles || 0) + 1;
        }
      }
      schoolRoleOf.set(choice.key, roleId);
      return roleId;
    };
    const nameRole = async (userId, choice) => {
      if (!rolesReady) return;
      await q("UPDATE users SET school_role_id = $2 WHERE user_id = $1", [userId, await schoolRoleFor(choice)]);
    };
    progress({ step: "Loading staff accounts", done: 0, total: staffRows.length });
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
      let staffLoaded = null;
      const known = await linkOf("staff", t.source_id);
      if (known && (await q("SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2", [known.managira_id, org])).rowCount) id = known.managira_id;
      if (!id && email) id = ((await q("SELECT user_id FROM users WHERE LOWER(email) = $1 AND organization_id = $2 ORDER BY user_id LIMIT 1", [email, org])).rows[0] || {}).user_id || null;
      const mine = id && ledger.mine("users", { user_id: id });
      const staffValues = { first_name: first || null, last_name: last || null, org_role_title: clean(d.title, 120) || null, phone_number: clean(d.phone, 40) || null };
      if (active && id) {
        // An account this migration made follows the files, except what the school changed since;
        // its role too, unless the school has changed it. An account the school already had keeps
        // its access and details: only an empty title or phone is filled in.
        const { rows: [was] } = await q("SELECT first_name, last_name, org_role_title, phone_number, account_type::text AS role FROM users WHERE user_id = $1", [id]);
        const plan = mine
          ? mergePlan(was, staffValues, (known && known.loaded) || {})
          : mergePlan(was, { org_role_title: staffValues.org_role_title, phone_number: staffValues.phone_number }, {});
        const fields = Object.keys(plan.set);
        if (fields.length) {
          if (!mine) await ledger.before("users", { user_id: id }, ["org_role_title", "phone_number"]);
          await q(`UPDATE users SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE user_id = $1`, [id, ...fields.map((f) => plan.set[f])]);
        }
        if (!mine) { counts.staffMatched += 1; counts.filled += fields.length; }
        noteKept(name, plan.kept);
        staffLoaded = { ...((known && known.loaded) || {}), ...plan.set };
        const changedHere = mine && (await q("SELECT 1 FROM staff_role_changes WHERE organization_id = $1 AND user_id = $2 AND changed_by <> 'Data migration' LIMIT 1", [org, id])).rowCount;
        if (mine && choice && !changedHere) {
          if (was.role !== choice.accountType) await q("UPDATE users SET account_type = $2, updated_at = NOW() WHERE user_id = $1", [id, choice.accountType]);
          await savePermissions(id, choice.permissions);
          await nameRole(id, choice);
          if (was.role !== choice.accountType) await logRole(id, was.role, `${choice.label} (${choice.accountType})`);
        }
      }
      if (!id && active) {
        if (!email || !EMAIL_RX.test(email)) staffSkipped.push({ name, why: "No email" });
        else if (!choice) staffSkipped.push({ name, email, why: waitingApproval ? "Waiting for the school admin's approval" : "No role" });
        else if ((await q("SELECT 1 FROM users WHERE LOWER(email) = $1 UNION ALL SELECT 1 FROM organizations WHERE LOWER(email) = $1 LIMIT 1", [email])).rowCount) staffSkipped.push({ name, email, why: "Email used by another Managira account" });
        else {
          ({ rows: [{ user_id: id }] } = await q(
            `INSERT INTO users (first_name, last_name, email, account_type, organization_id, on_hold, phone_number, org_role_title, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, NOW(), NOW()) RETURNING user_id`,
            [first || "Unknown", last || "Unknown", email, choice.accountType, org, staffValues.phone_number, staffValues.org_role_title]
          ));
          ledger.made("users", { user_id: id });
          staffLoaded = written(staffValues);
          await savePermissions(id, choice.permissions);
          await nameRole(id, choice);
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
      await link("staff", t.source_id, id, staffLoaded);
      if (active) { staffIds.set(String(t.source_id), id); counts.staff += 1; }
      for (const [label, item] of Object.entries(t.extra || {})) await extraOn("staff", id, label, item);
    }
    // Staff columns kept as an archive: one read-only list for the school.
    const staffArchive = staffRows.filter((t) => Object.keys(t.archive || {}).length).map((t) => ({ "Staff number": t.source_id, Name: [t.data.first_name, t.data.last_name].filter(Boolean).join(" "), ...flat(t.archive) }));
    if (staffArchive.length) keep(null, "Staff (old system)", staffArchive);

    // The school's new custom fields (columns set to become one), made now and filled below; one
    // with the same name is the school's own and is used as it is. Each takes the type its values have.
    const fieldTypes = new Map((await customFieldsOf(client, org)).map((f) => [Number(f.field_id), f.field_type]));
    const fieldByName = new Map((await customFieldsOf(client, org)).map((f) => [String(f.label).toLowerCase(), Number(f.field_id)]));
    const { rows: wanted } = await q(
      `SELECT DISTINCT ON (LOWER(label)) label, samples, sensitive FROM migration_columns
        WHERE job_id = $1 AND action = 'custom' AND target IS NULL AND entity IN ('students', 'student_details') AND label IS NOT NULL ORDER BY LOWER(label), column_id`,
      [job.job_id]
    );
    for (const column of wanted) {
      const key = String(column.label).toLowerCase();
      if (fieldByName.has(key)) continue;
      const type = fieldTypeOf(column.samples || []);
      if (fieldByName.size >= 60) { counts.customFieldsSkipped += 1; continue; } // the school's limit: kept as details instead
      const { rows: [made] } = await q(
        `INSERT INTO student_form_fields (organization_id, label, field_type, options, help_text, is_required, on_student_form, on_application, position, created_by, section)
         VALUES ($1, $2, $3, '[]'::jsonb, $4, FALSE, TRUE, FALSE, (SELECT COALESCE(MAX(position), 0) + 1 FROM student_form_fields WHERE organization_id = $1), NULL, 'more') RETURNING field_id`,
        [org, column.label.slice(0, 80), type, `From your old system (${system === "powerschool" ? "PowerSchool" : system})`]
      );
      ledger.made("student_form_fields", { field_id: made.field_id });
      fieldByName.set(key, Number(made.field_id));
      fieldTypes.set(Number(made.field_id), type);
      counts.customFieldsMade += 1;
    }
    const fieldValues = (d) => {
      const values = { ...(d.custom || {}) };
      for (const [label, value] of Object.entries(d.customNew || {})) { const id = fieldByName.get(String(label).toLowerCase()); if (id) values[id] = value; }
      for (const id of Object.keys(values)) values[id] = fieldValueAs(fieldTypes.get(Number(id)), values[id]);
      return values;
    };

    // Students. One Managira already has (studentMatches) keeps everything it has: only what's
    // empty is filled in, and it stays in its class. One this migration made follows the files,
    // except what the school changed since. Someone the school hasn't answered about waits.
    const studentIds = new Map();
    const studentClass = new Map();
    const staged = await records("students");
    const found = await studentMatches(client, job, staged);
    const sameAsFile = [];
    let loadedStudents = 0;
    progress({ step: "Loading students", done: 0, total: staged.length });
    for (const s of staged) {
      if (++loadedStudents % 100 === 0) progress({ done: loadedStudents });
      const d = s.data;
      const match = found.out.get(String(s.source_id)) || {};
      if (match.waiting) { counts.studentsWaiting += 1; continue; }
      if (match.sameAs) { sameAsFile.push([s.source_id, match.sameAs]); continue; }
      const fileClass = await classFor(d.class_name);
      const incoming = { ...studentValues(d), class_id: fileClass };
      let id = match.id || null;
      let mine = false;
      let loaded = (match.loaded && { ...match.loaded }) || {};
      let classId = fileClass;
      if (id) {
        mine = ledger.mine("students", { student_id: id });
        const { rows: [live] } = await q("SELECT first_name, last_name, date_of_birth::text AS date_of_birth, gender, class_id, email, address, custom_student_id FROM students WHERE student_id = $1", [id]);
        const plan = mergePlan(live, incoming, loaded);
        const fields = Object.keys(plan.set);
        if (fields.length) {
          await ledger.before("students", { student_id: id }, STUDENT_COLUMNS);
          const sets = fields.map((f, i) => `${f} = $${i + 3}`);
          if (fields.includes("date_of_birth")) sets.push("date_of_birth_unknown = FALSE");
          await q(`UPDATE students SET ${sets.join(", ")} WHERE student_id = $1 AND organization_id = $2`, [id, org, ...fields.map((f) => plan.set[f])]);
        }
        if (!mine) { counts.matched += 1; counts.filled += fields.length; }
        noteKept(nameOf(d), plan.kept);
        Object.assign(loaded, plan.set);
        classId = plan.set.class_id || live.class_id || fileClass;
      } else {
        ({ rows: [{ student_id: id }] } = await q(
          `INSERT INTO students (organization_id, first_name, last_name, date_of_birth, date_of_birth_unknown, gender, class_id, email, address, custom_student_id)
           VALUES ($1, $2, $3, $4, ($4::date IS NULL), $5, $6, $7, $8, $9) RETURNING student_id`,
          [org, incoming.first_name || "Unknown", incoming.last_name || "Unknown", incoming.date_of_birth, incoming.gender, fileClass, incoming.email, incoming.address, incoming.custom_student_id]
        ));
        ledger.made("students", { student_id: id });
        mine = true;
        loaded = written(incoming);
      }
      studentIds.set(s.source_id, id);
      studentClass.set(s.source_id, classId);
      counts.students += 1;
      await enroll(id, classId, !mine);
      // Custom fields: the same rule, field by field.
      for (const [fieldId, value] of Object.entries(fieldValues(d))) {
        if (value === null) continue;
        const slot = `custom:${Number(fieldId)}`;
        const { rows: [had] } = await q("SELECT value FROM student_field_values WHERE field_id = $1 AND student_id = $2", [Number(fieldId), id]);
        const plan = mergePlan({ [slot]: had ? had.value : null }, { [slot]: value }, loaded);
        noteKept(nameOf(d), plan.kept.map((k) => ({ ...k, field: "Custom field" })));
        if (plan.set[slot] === undefined) continue;
        await ledger.before("student_field_values", { field_id: Number(fieldId), student_id: id }, ["value"]);
        await q(
          `INSERT INTO student_field_values (field_id, student_id, organization_id, value, updated_at) VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (field_id, student_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [Number(fieldId), id, org, value]
        );
        loaded[slot] = value;
        counts.customValues += 1;
      }
      await link("students", s.source_id, id, loaded);
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
      for (const [module, row] of Object.entries(s.archive || {})) keep(id, module, [row]);
    }
    // The same student twice in the files (the school said so): one record, both old numbers linked to it.
    for (const [sourceId, other] of sameAsFile) {
      const id = studentIds.get(other) || ((await linkOf("students", other)) || {}).managira_id;
      if (!id) continue;
      studentIds.set(sourceId, id);
      studentClass.set(sourceId, studentClass.get(other) || null);
      await link("students", sourceId, id);
    }
    const studentOf = async (sourceId) => studentIds.get(sourceId) || ((await linkOf("students", sourceId)) || {}).managira_id || null;

    // More about each student (the school's own list of lockers, house, pathway…): its custom
    // fields filled, its details kept. Only an empty value is filled in.
    for (const r of await records("student_details")) {
      const sid = await studentOf(r.data.student_source_id);
      if (!sid) { counts.detailsUnmatched += 1; continue; }
      for (const [label, item] of Object.entries(r.extra || {})) await extraOn("student", sid, label, item);
      for (const [fieldId, value] of Object.entries(fieldValues(r.data))) {
        if (value === null) continue;
        const { rows: [had] } = await q("SELECT value FROM student_field_values WHERE field_id = $1 AND student_id = $2", [Number(fieldId), sid]);
        if (had && String(had.value || "").trim()) continue;
        await ledger.before("student_field_values", { field_id: Number(fieldId), student_id: sid }, ["value"]);
        await q(
          `INSERT INTO student_field_values (field_id, student_id, organization_id, value, updated_at) VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (field_id, student_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [Number(fieldId), sid, org, value]
        );
        counts.customValues += 1;
      }
    }

    // Parents: one profile per person (the same email is the same parent), linked to each child.
    const byEmail = new Map();
    const byContact = new Map();
    const parentRecords = await records("guardians");
    progress({ step: "Linking parents to their children", done: 0, total: parentRecords.length });
    let parentsDone = 0;
    for (const g of parentRecords) {
      if (++parentsDone % 100 === 0) progress({ done: parentsDone });
      const studentId = await studentOf(g.data.student_source_id);
      if (!studentId) continue;
      let [first, last] = [clean(g.data.first_name, 100), clean(g.data.last_name, 100)];
      if (!first && g.data.full_name) [first, last] = splitName(g.data.full_name);
      if (!first) continue;
      const email = clean(g.data.email, 200).toLowerCase() || null;
      const parentValues = { first_name: first, last_name: last || null, email, phone: clean(g.data.phone, 40) || null };
      // The same parent: one already loaded with this email, the one this migration linked before,
      // one with this email in the school, or one of the same name already on this child.
      let id = (email && byEmail.get(email)) || (g.data.contact_id && byContact.get(String(g.data.contact_id))) || null;
      const again = Boolean(id);
      let loaded = null;
      const known = !id && await linkOf("guardians", g.source_id);
      if (!id && known && (await q("SELECT 1 FROM guardian_profiles WHERE guardian_id = $1 AND organization_id = $2", [known.managira_id, org])).rowCount) { id = known.managira_id; loaded = known.loaded || null; }
      if (!id && email) id = ((await q("SELECT guardian_id FROM guardian_profiles WHERE organization_id = $1 AND LOWER(email) = $2 ORDER BY guardian_id LIMIT 1", [org, email])).rows[0] || {}).guardian_id;
      if (!id) {
        id = ((await q(
          `SELECT p.guardian_id FROM guardian_profiles p JOIN guardian_students gs ON gs.guardian_id = p.guardian_id
            WHERE gs.student_id = $1 AND p.organization_id = $2 AND LOWER(TRIM(p.first_name)) = LOWER($3) AND LOWER(TRIM(COALESCE(p.last_name, ''))) = LOWER($4)
            ORDER BY p.guardian_id LIMIT 1`,
          [studentId, org, first, last || ""]
        )).rows[0] || {}).guardian_id;
      }
      if (id && !again) {
        const mine = ledger.mine("guardian_profiles", { guardian_id: id });
        const { rows: [live] } = await q("SELECT first_name, last_name, email, phone FROM guardian_profiles WHERE guardian_id = $1", [id]);
        const plan = mergePlan(live, parentValues, loaded || {});
        const fields = Object.keys(plan.set);
        if (fields.length) {
          await ledger.before("guardian_profiles", { guardian_id: id }, ["first_name", "last_name", "email", "phone"]);
          await q(`UPDATE guardian_profiles SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE guardian_id = $1`, [id, ...fields.map((f) => plan.set[f])]);
        }
        if (!mine) { counts.guardiansMatched += 1; counts.filled += fields.length; }
        noteKept(`${first} ${last || ""}`.trim(), plan.kept);
        loaded = { ...(loaded || {}), ...plan.set };
      }
      if (!id) {
        ({ rows: [{ guardian_id: id }] } = await q(
          "INSERT INTO guardian_profiles (organization_id, first_name, last_name, email, phone, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING guardian_id",
          [org, first, last || null, email, parentValues.phone]
        ));
        ledger.made("guardian_profiles", { guardian_id: id });
        loaded = written(parentValues);
      }
      if (email) byEmail.set(email, id);
      if (g.data.contact_id) byContact.set(String(g.data.contact_id), id);
      await link("guardians", g.source_id, id, again ? null : loaded);
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
      for (const [label, text] of Object.entries(g.data.alerts || {})) {
        await q(
          `INSERT INTO student_alerts (organization_id, student_id, kind, label, text, source, job_id) VALUES ($1, $2, 'custody', $3, $4, $5, $6)
           ON CONFLICT (organization_id, student_id, kind, label) DO UPDATE SET text = EXCLUDED.text, job_id = EXCLUDED.job_id`,
          [org, studentId, `${label} (${[first, last].filter(Boolean).join(" ")})`.slice(0, 120), clean(text, 2000), system, job.job_id]
        );
        counts.alerts += 1;
      }
      if (Object.keys(g.archive || {}).length) keep(studentId, "Parents & contacts", [{ Name: [first, last].filter(Boolean).join(" "), Relationship: clean(g.data.relationship, 60) || "", Email: email || "", Phone: parentValues.phone || "", ...flat(g.archive) }]);
      counts.guardians += 1;
    }

    // Sections: a subject of each class that takes it (its grade level, or the classes of the
    // students enrolled in it), taught by its teacher. A homeroom section makes no subject:
    // its teacher is put in charge of the class, unless the school already chose someone.
    const sectionStudents = new Map();
    for (const e of await records("enrollments")) {
      if (Object.keys(e.archive || {}).length) { const sid = await studentOf(e.data.student_source_id); if (sid) keep(sid, "Class schedule (old system)", [{ Section: String(e.data.section_source_id || ""), ...flat(e.archive) }]); }
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
      if (d.grade_level && /^(-?\d+|k|kg|pk|tk|pre-?k)$/i.test(clean(d.grade_level, 12))) { const id = await classFor(d.grade_level); if (id) placed.add(id); }
      if (Object.keys(section.archive || {}).length) keep(null, "Sections (old system)", [{ Section: String(section.source_id), Name: name, ...flat(section.archive) }]);
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
      if (Object.keys(r.archive || {}).length) keep(null, "Class roles (old system)", [{ Section: String(d.section_source_id || ""), Staff: String(d.teacher_source_id || ""), ...flat(r.archive) }]);
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
    // A list's staged records a page at a time (grades and attendance can be very long).
    const pages = async function* (entity) {
      let last = 0;
      for (;;) {
        const { rows: page } = await q("SELECT record_id, source_id, data, archive FROM migration_records WHERE job_id = $1 AND entity = $2 AND record_id > $3 ORDER BY record_id LIMIT 5000", [job.job_id, entity, last]);
        if (!page.length) return;
        last = page[page.length - 1].record_id;
        yield page;
      }
    };
    const countOf = async (entity) => Number((await q("SELECT COUNT(*)::int AS n FROM migration_records WHERE job_id = $1 AND entity = $2", [job.job_id, entity])).rows[0].n);
    const gradeTotal = await countOf("grades");
    progress({ step: "Loading final grades", done: 0, total: gradeTotal });
    if (gradeTotal) {
      const rows = [];
      const kept = new Map();
      let gradesDone = 0;
      for await (const page of pages("grades")) {
      gradesDone += page.length;
      progress({ done: gradesDone });
      await tick(); // an await on a ready value never lets other requests in: this does
      for (const r of page) {
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
      }
      await q("DELETE FROM student_course_history WHERE organization_id = $1 AND job_id = $2", [org, job.job_id]);
      for (let at = 0; at < rows.length; at += 5000) {
        const part = rows.slice(at, at + 5000);
        const col = (i) => part.map((r) => r[i]);
        await q(
          `INSERT INTO student_course_history (organization_id, student_id, school_year, term, grade_level, course_number, course_name, grade, percent, gpa_points, credits_attempted, credits_earned, school_name, gpa_added_value, source, job_id)
           SELECT $1, x.* , $15, $16 FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::text[], $14::numeric[])
             AS x(student_id, school_year, term, grade_level, course_number, course_name, grade, percent, gpa_points, credits_attempted, credits_earned, school_name, gpa_added_value)`,
          [org, col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7), col(8), col(9), col(10), col(11), col(12), system, job.job_id]
        );
      }
      for (const k of kept.values()) keep(k.studentId, k.module, k.rows);
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
    for (const gr of await records("student_gpas")) {
      takeGpa(gr.data.student_source_id, gr.data);
      if (Object.keys(gr.archive || {}).length) { const sid = await studentOf(gr.data.student_source_id); if (sid) keep(sid, "GPA and class rank", [flat(gr.archive)]); }
    }
    await q("DELETE FROM student_source_gpas WHERE organization_id = $1 AND job_id = $2", [org, job.job_id]);
    const gpaRows = [];
    let gpaBeat = 0;
    for (const [sourceId, g] of sourceGpas) { if (++gpaBeat % 2000 === 0) await tick(); const studentId = await studentOf(sourceId); if (studentId) gpaRows.push([studentId, g]); }
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
    const attendanceTotal = await countOf("attendance");
    progress({ step: "Loading attendance", done: 0, total: attendanceTotal });
    if (attendanceTotal) {
      const hasTotals = (await q(
        "SELECT 1 FROM migration_records WHERE job_id = $1 AND entity = 'attendance' AND COALESCE(data->>'date', '') = '' AND (data ? 'days_present' OR data ? 'days_absent' OR data ? 'days_excused' OR data ? 'days_unexcused' OR data ? 'days_tardy') LIMIT 1",
        [job.job_id]
      )).rowCount > 0;
      const terms = (await q(
        `SELECT t.term_id, t.term_name, to_char(t.start_date, 'YYYY-MM-DD') AS starts, to_char(t.end_date, 'YYYY-MM-DD') AS ends, y.year_label
           FROM terms t LEFT JOIN school_years y ON y.id = t.school_year_id
          WHERE t.organization_id = $1 AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL`,
        [org]
      )).rows;
      const totals = new Map();
      const days = new Map();
      let attendanceDone = 0;
      for await (const page of pages("attendance")) {
      attendanceDone += page.length;
      progress({ done: attendanceDone });
      await tick();
      for (const r of page) {
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
          days.get(studentId).push({ Date: iso, Code: d.code || "", Meaning: ps.attendanceKind(d.code, d.present) || (hasTotals ? "as recorded" : "not known (counted absent)"), ...flat(r.archive) });
          if (hasTotals) continue; // the school's own totals are the count
        } else {
          year = clean(d.school_year, 20) || ps.schoolYearOfTermId(d.term_id) || "";
          label = clean(d.term, 60);
          const t = terms.find((x) => (x.year_label || "") === year && String(x.term_name).toLowerCase() === label.toLowerCase());
          termId = t ? t.term_id : null;
          if (Object.keys(r.archive || {}).length) keep(studentId, "Attendance totals (old system)", [{ "School year": year, Term: label, ...flat(r.archive) }]);
        }
        const key = `${studentId}|${year}|${label}`;
        if (!totals.has(key)) totals.set(key, { studentId, termId, year, label, present: 0, absent: 0, excused: 0, tardy: 0 });
        const total = totals.get(key);
        if (!total.termId && termId) total.termId = termId;
        addAttendance(total, d);
      }
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
      for (const [studentId, rows] of days) keep(studentId, "Attendance history", rows);
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
    const listTotal = await countOf("other");
    progress({ step: "Keeping your other lists read-only", done: 0, total: listTotal });
    let listDone = 0;
    const listNames = new Set();
    for await (const page of pages("other")) {
      listDone += page.length;
      progress({ done: listDone });
      await tick();
      for (const r of page) {
        const d = r.data || {};
        listNames.add(d.list);
        const studentId = d.student_source_id ? await studentOf(d.student_source_id) : null;
        if (studentId && d.details) {
          const studentColumn = Object.keys(d.row || {}).find((k) => lists.STUDENT_KEYS.includes(String(k).toLowerCase().replace(/^\[[^\]]*\]/, "").replace(/[^a-z0-9]/g, "")));
          for (const [column, value] of Object.entries(d.row || {})) if (column !== studentColumn && !/^last_?first$|^student_?name$/i.test(column)) await extraOn("student", studentId, prettyLabel(column), { value, sensitive: Boolean(d.restricted) });
          continue;
        }
        const release = releaseAlertOf(d.list, d.row || {});
        if (studentId && release) {
          const said = await q("SELECT 1 FROM student_alerts WHERE organization_id = $1 AND student_id = $2 AND kind = 'custody' AND job_id = $3 AND LOWER(text) = LOWER($4) LIMIT 1", [org, studentId, job.job_id, release.text]);
          if (!said.rowCount) {
            await q(
              `INSERT INTO student_alerts (organization_id, student_id, kind, label, text, source, job_id) VALUES ($1, $2, 'custody', $3, $4, $5, $6)
               ON CONFLICT (organization_id, student_id, kind, label) DO UPDATE SET text = EXCLUDED.text, job_id = EXCLUDED.job_id`,
              [org, studentId, release.label.slice(0, 120), release.text.slice(0, 2000), system, job.job_id]
            );
            counts.alerts += 1;
          }
        }
        const medical = medicalAlertOf(d.list, d.row || {});
        if (studentId && medical) {
          await q(
            `INSERT INTO student_alerts (organization_id, student_id, kind, label, text, source, job_id) VALUES ($1, $2, 'medical', $3, $4, $5, $6)
             ON CONFLICT (organization_id, student_id, kind, label) DO UPDATE SET text = EXCLUDED.text, job_id = EXCLUDED.job_id`,
            [org, studentId, medical.label.slice(0, 120), medical.text.slice(0, 2000), system, job.job_id]
          );
          counts.medicalAlerts += 1;
        }
        if (studentId) keep(studentId, d.list, [d.row], d.restricted);
        else { keep(null, d.list, [d.row], d.restricted); if (d.student_source_id) counts.listRowsUnmatched += 1; }
      }
    }
    counts.lists = listNames.size;
    counts.listRows = listDone;
    // Documents, on their student's record.
    const { rows: docs } = await q("SELECT document_id, student_source_id FROM migration_documents WHERE job_id = $1 AND student_source_id IS NOT NULL", [job.job_id]);
    const docIds = [];
    const docStudents = [];
    for (const doc of docs) { const sid = await studentOf(doc.student_source_id); if (sid) { docIds.push(doc.document_id); docStudents.push(sid); } }
    for (let i = 0; i < docIds.length; i += 2000) {
      await q("UPDATE migration_documents d SET student_id = x.s FROM unnest($1::bigint[], $2::int[]) AS x(id, s) WHERE d.document_id = x.id", [docIds.slice(i, i + 2000), docStudents.slice(i, i + 2000)]);
    }
    counts.documents = docIds.length;

    // Everything kept read-only, written a batch at a time.
    progress({ step: "Saving what's kept read-only", done: 0, total: archived.size });
    const perStudent = [...archived.values()].filter((a) => a.studentId);
    for (let i = 0; i < perStudent.length; i += 500) {
      const part = perStudent.slice(i, i + 500);
      await q(
        `INSERT INTO migration_archives (organization_id, job_id, student_id, module, sensitive, content)
         SELECT $1, $2, x.s, x.m, x.r, x.c FROM unnest($3::int[], $4::text[], $5::boolean[], $6::jsonb[]) AS x(s, m, r, c)
         ON CONFLICT (organization_id, student_id, module) DO UPDATE SET content = EXCLUDED.content, sensitive = EXCLUDED.sensitive, job_id = EXCLUDED.job_id`,
        [org, job.job_id, part.map((a) => a.studentId), part.map((a) => a.module), part.map((a) => a.restricted), part.map((a) => JSON.stringify(a.rows))]
      );
      counts.archives += part.length;
      progress({ done: Math.min(i + 500, perStudent.length) });
      await tick();
    }
    for (const a of [...archived.values()].filter((x) => !x.studentId)) await keepArchive(client, job, null, a.module, a.rows, counts, true, a.restricted);

    progress({ step: "Finishing", done: 0, total: 0 });
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
async function keepArchive(client, job, studentId, module, rows, counts, replace = false, restricted = false) {
  if (studentId === null) {
    // One list for the school: replaced whole (a unique rule can't hold an empty student).
    await client.query("DELETE FROM migration_archives WHERE organization_id = $1 AND student_id IS NULL AND module = $2", [job.organization_id, module]);
  }
  await client.query(
    `INSERT INTO migration_archives (organization_id, job_id, student_id, module, sensitive, content) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (organization_id, student_id, module) DO UPDATE SET content = ${replace ? "EXCLUDED.content" : "migration_archives.content || EXCLUDED.content"}, job_id = EXCLUDED.job_id`,
    [job.organization_id, job.job_id, studentId, module, Boolean(restricted) || SENSITIVE_MODULES.has(module), JSON.stringify(rows)]
  );
  counts.archives += 1;
}

// Exactly what went live, one line per record, compressed; read a batch at a time.
async function snapshot(db, job, progress = quiet) {
  const parts = [];
  const gz = zlib.createGzip();
  gz.on("data", (chunk) => parts.push(chunk));
  const ended = new Promise((resolve, reject) => { gz.on("end", resolve); gz.on("error", reject); });
  const { rows: [{ n: total }] } = await db.query("SELECT COUNT(*)::int AS n FROM migration_records WHERE job_id = $1", [job.job_id]);
  let last = 0;
  let count = 0;
  for (;;) {
    const { rows } = await db.query(
      "SELECT record_id, entity, source_id, data, extra, archive FROM migration_records WHERE job_id = $1 AND record_id > $2 ORDER BY record_id LIMIT 5000",
      [job.job_id, last]
    );
    if (!rows.length) break;
    gz.write(rows.map((r) => JSON.stringify({ entity: r.entity, source_id: r.source_id, data: r.data, extra: r.extra, archive: r.archive })).join("\n") + "\n");
    last = rows[rows.length - 1].record_id;
    count += rows.length;
    progress({ done: count, total });
    await tick();
  }
  gz.end();
  await ended;
  const { rows: [snap] } = await db.query(
    "INSERT INTO migration_snapshots (job_id, organization_id, record_count, content_gz) VALUES ($1, $2, $3, $4) RETURNING snapshot_id, record_count",
    [job.job_id, job.organization_id, count, Buffer.concat(parts)]
  );
  return snap;
}

async function goLive(db, job, actor, progress = quiet) {
  if (job.status !== "review" || !job.signed_at) return { error: "Sign the migration summary first." };
  const imported = await runImport(db, job, actor, { progress, phases: 5 });
  if (imported.error) return imported;
  const { list } = await blockers(db, job);
  const left = list.filter((item) => !/^Approve: /.test(item)); // the fresh import keeps the sign-off
  if (left.length) return { error: left[0] };
  const snap = await snapshot(db, job, (u) => progress({ phase: 4, phases: 5, step: "Keeping a snapshot of what goes live", ...u }));
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "snapshot", detail: { snapshotId: snap.snapshot_id, records: snap.record_count } });
  const counts = await loadLive(db, job, actor, (u) => progress({ phase: 5, phases: 5, ...u }));
  await db.query(
    `UPDATE migration_jobs SET status = 'live', locked = FALSE, live_at = NOW(), purge_after = CURRENT_DATE + ${KEEP_DAYS}, rolled_back_at = NULL, totals = totals || $2::jsonb, updated_at = NOW() WHERE job_id = $1`,
    [job.job_id, JSON.stringify({ loaded: counts })]
  );
  forget(job.organization_id);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "went_live", detail: { students: counts.students, staff: counts.staff, courses: counts.courses } });
  tell(db, job.organization_id, "live", { students: counts.students, guardians: counts.guardians, staff: counts.staff, courses: counts.courses, kept: counts.matched + counts.guardiansMatched + counts.staffMatched, filled: counts.filled });
  return { counts };
}

async function catchUp(db, job, actor, progress = quiet) {
  if (job.status !== "live") return { error: "Catch-up is for after go-live." };
  if (job.catch_up_at) return { error: "The catch-up import was already used." };
  const imported = await runImport(db, job, actor, { progress, phases: 4 });
  if (imported.error) return imported;
  const counts = await loadLive(db, job, actor, (u) => progress({ phase: 4, phases: 4, ...u }));
  await db.query("UPDATE migration_jobs SET catch_up_at = NOW(), totals = totals || $2::jsonb, updated_at = NOW() WHERE job_id = $1", [job.job_id, JSON.stringify({ loaded: counts })]);
  await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor, action: "catch_up", detail: { students: counts.students, staff: counts.staff, courses: counts.courses } });
  tell(db, job.organization_id, "catch_up");
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
// Super Admin: empty a sandbox that hasn't gone live (every upload, list, record, document,
// column match, staff role and answer) and keep it open, so the school uploads again from the
// start. Nothing in the school's live account is touched; the activity log stays.
async function startOver(db, organizationId, actor) {
  const job = await openJob(db, organizationId);
  if (!job) return { error: "This school has no migration open." };
  if (!["sandbox", "review"].includes(job.status)) return { error: "Only a sandbox that isn't live can start over. Roll the go-live back first." };
  const running = await tasks.openTask(db, job.job_id);
  if (running) return { error: `Wait until "${tasks.LABELS[running.kind]}" finishes.` };
  const { rows: [{ n }] } = await db.query("SELECT COUNT(*)::int AS n FROM migration_loaded WHERE job_id = $1", [job.job_id]);
  if (n) return { error: "Roll the go-live back first." };
  const counted = {};
  const count = async (table) => { counted[table] = (await db.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE job_id = $1`, [job.job_id])).rows[0].n; };
  for (const table of ["migration_uploads", "migration_files", "migration_records", "migration_documents"]) await count(table);
  await documents.removeAll(db, job.job_id);
  for (const table of ["migration_records", "migration_columns", "migration_roles", "migration_snapshots", "migration_archives", "migration_links", "migration_files", "migration_uploads", "migration_tasks"]) {
    await db.query(`DELETE FROM ${table} WHERE job_id = $1`, [job.job_id]);
  }
  await db.query(
    `UPDATE migration_jobs SET status = 'sandbox', approvals = '{}'::jsonb, totals = '{}'::jsonb, role_approvals = '{}'::jsonb, match_decisions = '{}'::jsonb,
            signed_name = NULL, signed_by = NULL, signed_at = NULL, updated_at = NOW() WHERE job_id = $1`,
    [job.job_id]
  );
  forget(organizationId);
  await event(db, { jobId: job.job_id, organizationId, actor, actorKind: "managira", action: "started_over", detail: counted });
  return { ok: true, removed: counted };
}

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
    // Documents stay with the sandbox, no longer on a student's record.
    await client.query("UPDATE migration_documents SET student_id = NULL WHERE job_id = $1", [job.job_id]);
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
      } else if (table === "school_roles") {
        // A role it made goes, unless the school has since given it to someone.
        removed = (await client.query(
          "DELETE FROM school_roles r WHERE r.role_id = ANY($1::int[]) AND r.organization_id = $2 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.school_role_id = r.role_id)",
          [made.map((k) => k.role_id), org]
        )).rowCount;
      } else if (keys.length === 1) {
        const scoped = ["students", "guardian_profiles", "guardians", "student_form_fields"].includes(table) ? " AND organization_id = $2" : "";
        removed = (await client.query(`DELETE FROM ${table} WHERE ${keys[0]} = ANY($1::int[])${scoped}`, scoped ? [made.map((k) => k[keys[0]]), org] : [made.map((k) => k[keys[0]])])).rowCount;
      } else {
        removed = (await client.query(`DELETE FROM ${table} WHERE (${keys[0]}, ${keys[1]}) IN (SELECT * FROM unnest($1::int[], $2::int[]))`, [made.map((k) => k[keys[0]]), made.map((k) => k[keys[1]])])).rowCount;
      }
      if (removed) result.removed[table] = removed;
      // The accounts it made are gone: so are the role changes logged for them.
      if (table === "users" && removed) {
        const { rowCount } = await client.query("DELETE FROM staff_role_changes c WHERE c.organization_id = $1 AND c.changed_by = 'Data migration' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = c.user_id)", [org]);
        if (rowCount) result.removed.staff_role_changes = rowCount;
      }
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
  tell(db, org, "rolled_back");
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
    await db.query("UPDATE migration_uploads SET content = NULL WHERE job_id = $1", [job.job_id]);
    await db.query("DELETE FROM migration_snapshots WHERE job_id = $1", [job.job_id]);
    await db.query("DELETE FROM migration_records WHERE job_id = $1", [job.job_id]);
    await db.query("DELETE FROM migration_loaded WHERE job_id = $1", [job.job_id]);
    await db.query("UPDATE migration_jobs SET status = 'closed', purged_at = NOW(), totals = COALESCE(totals, '{}'::jsonb) #- '{loaded,kept}', match_decisions = '{}'::jsonb, updated_at = NOW() WHERE job_id = $1", [job.job_id]);
    forget(job.organization_id);
    await event(db, { jobId: job.job_id, organizationId: job.organization_id, actor: "Managira", actorKind: "system", action: "purged" });
  }
  return { purged: rows.length };
}

// ── Requests: a school asks; Managira gets in touch, then opens its sandbox or declines ────
const SYSTEMS = ["PowerSchool", "Infinite Campus", "Skyward", "Aeries", "Other"];
const TIMINGS = ["As soon as possible", "Within a month", "Over a school break", "On a date"];
const BRING = ["Students", "Parents & guardians", "Staff", "Classes & teachers", "Final grades & transcripts", "Attendance"];
const latestRequest = async (db, organizationId) => (await db.query("SELECT * FROM migration_requests WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1", [organizationId])).rows[0] || null;
async function requestMove(db, organizationId, body, { userId = null, actor = "School", role = "Manager" } = {}) {
  if (await openJob(db, organizationId)) return { error: "Your data migration is already open." };
  const system = SYSTEMS.includes(body.system) ? (body.system === "Other" ? clean(body.otherSystem, 80) : body.system) : "";
  const contactName = clean(body.contactName, 120);
  const contactEmail = clean(body.contactEmail, 200).toLowerCase();
  const count = (v) => { const n = Number.parseInt(String(v || "").replace(/[^0-9]/g, ""), 10); return Number.isInteger(n) && n >= 0 && n < 1000000 ? n : null; };
  const timing = TIMINGS.includes(body.timing) ? body.timing : null;
  const date = timing === "On a date" ? isoDate(body.preferredDate) : null;
  if (!system) return { error: "Choose the system you use now (or type it)." };
  if (!contactName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { error: "Give a contact name and email, so we can reach you." };
  if (timing === "On a date" && (!date || date === "invalid")) return { error: "Choose the date you'd like to move." };
  const bring = [].concat(body.bring || []).filter((b) => BRING.includes(b));
  try {
    const { rows: [request] } = await db.query(
      `INSERT INTO migration_requests (organization_id, requested_by, contact_name, contact_email, contact_phone, current_system, students_estimate, staff_estimate, timing, preferred_date, bring, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) RETURNING *`,
      [organizationId, userId, contactName, contactEmail, tidy.phone(clean(body.contactPhone, 40)) || null, system, count(body.students), count(body.staff), timing, date, JSON.stringify(bring), clean(body.notes, 2000) || null]
    );
    await event(db, { organizationId, actor, action: "migration_requested", detail: { requestId: request.request_id, system } });
    // The school as Managira knows it, so the team has everything in one email.
    const { rows: [facts] } = await db.query(
      `SELECT o.organization_address, o.organization_phone, o.email, h.hub_name,
              (SELECT COUNT(*) FROM students s WHERE s.organization_id = o.organization_id)::int AS students,
              (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.organization_id AND u.removed_at IS NULL)::int AS staff
         FROM organizations o LEFT JOIN managira_hubs h ON h.hub_id = o.hub_id AND o.is_hub_member = true WHERE o.organization_id = $1`,
      [organizationId]
    ).catch(() => ({ rows: [{}] }));
    const when = timing ? `${timing}${date ? ` (${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })})` : ""}` : "Not sure yet";
    tell(db, organizationId, "requested", {
      system, when, contactName, contactEmail, phone: request.contact_phone, students: request.students_estimate, staff: request.staff_estimate,
      bring: bring.join(", ") || null, notes: request.notes, requestedBy: `${actor} (${role})`,
      address: (facts && facts.organization_address) || null, schoolPhone: (facts && facts.organization_phone) || null, schoolEmail: (facts && facts.email) || null,
      hub: (facts && facts.hub_name) || null, inManagira: facts && facts.students !== undefined ? `${facts.students} students, ${facts.staff} staff accounts` : null,
    }, { alsoEmail: [contactEmail] });
    return { ok: true, request };
  } catch (error) {
    if (error.code === "23505") return { error: "Your school has already sent a request. We'll be in touch." };
    throw error;
  }
}
async function withdrawRequest(db, organizationId, actor) {
  const { rowCount } = await db.query("UPDATE migration_requests SET status = 'withdrawn', updated_at = NOW() WHERE organization_id = $1 AND status IN ('new', 'contacted')", [organizationId]);
  if (!rowCount) return { error: "There's no request to withdraw." };
  await event(db, { organizationId, actor, action: "migration_request_withdrawn" });
  tell(db, organizationId, "withdrawn");
  return { ok: true };
}
async function listRequests(db) {
  const { rows } = await db.query(
    `SELECT r.*, o.organization_name, h.hub_name FROM migration_requests r JOIN organizations o ON o.organization_id = r.organization_id
       LEFT JOIN managira_hubs h ON h.hub_id = o.hub_id AND o.is_hub_member = true
      WHERE r.status IN ('new', 'contacted') OR r.updated_at > NOW() - INTERVAL '30 days'
      ORDER BY (r.status IN ('new', 'contacted')) DESC, r.created_at DESC LIMIT 100`
  );
  return rows;
}
// Managira: in touch (contacted), approved (the sandbox opens), or declined (with a note).
async function decideRequest(db, requestId, what, note, actor) {
  const { rows: [request] } = await db.query("SELECT * FROM migration_requests WHERE request_id = $1", [requestId]);
  if (!request || !["new", "contacted"].includes(request.status)) return { error: "That request isn't open." };
  if (what === "contacted") {
    await db.query("UPDATE migration_requests SET status = 'contacted', updated_at = NOW() WHERE request_id = $1", [requestId]);
    await event(db, { organizationId: request.organization_id, actor, actorKind: "managira", action: "migration_request_contacted" });
    return { ok: true, request };
  }
  if (what === "approve") {
    const job = await startJob(db, request.organization_id, actor);
    await db.query("UPDATE migration_requests SET status = 'approved', job_id = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE request_id = $1 AND status IN ('new', 'contacted')", [requestId, job.job_id, actor]);
    return { ok: true, request, job };
  }
  if (what === "decline") {
    const reason = clean(note, 1000);
    await db.query("UPDATE migration_requests SET status = 'declined', decision_note = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE request_id = $1", [requestId, reason || null, actor]);
    await event(db, { organizationId: request.organization_id, actor, actorKind: "managira", action: "migration_request_declined" });
    tell(db, request.organization_id, "declined", { note: reason || null }, { alsoEmail: [request.contact_email] });
    return { ok: true, request };
  }
  return { error: "Unknown action." };
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

const plural = (n, one, many) => `${Number(n || 0).toLocaleString("en-US")} ${n === 1 ? one : many}`;
tasks.register("read_files", (db, job, task, progress) => readUploads(db, job, task, progress));
tasks.register("import", async (db, job, task, progress) => {
  if (job.status === "live" || !["sandbox", "review"].includes(job.status)) return { error: "There's nothing to import now." };
  const result = await runImport(db, job, task.actor, { progress });
  return result.error ? result : { message: "Imported into the sandbox. The check report is below.", entities: result.report.entities };
});
tasks.register("go_live", async (db, job, task, progress) => {
  const result = await goLive(db, job, task.actor, progress);
  if (result.error) return result;
  const c = result.counts;
  return { message: `You're live: ${plural(c.students, "student", "students")}, ${plural(c.guardians, "parent link", "parent links")} and ${plural(c.staff, "staff account", "staff accounts")} loaded.`, counts: { students: c.students, guardians: c.guardians, staff: c.staff } };
});
tasks.register("catch_up", async (db, job, task, progress) => {
  const result = await catchUp(db, job, task.actor, progress);
  return result.error ? result : { message: `Catch-up loaded: ${plural(result.counts.students, "student", "students")} updated.` };
});
// Starts one of them for the school (a second while one is open starts nothing).
const startTask = (db, job, kind, actor, payload = {}) => tasks.enqueue(db, job, kind, { actor, payload });
const taskStatus = (db, job) => tasks.statusOf(db, job.job_id);
const busyTask = (db, job) => tasks.openTask(db, job.job_id);

module.exports = {
  storeUploads, readUploads, startTask, taskStatus, busyTask, MAX_UPLOAD_FILES, snapshot,
  ENTITIES: ps.ENTITIES, TASK_LABELS: tasks.LABELS, SECTIONS, SECTION_LABELS, SENSITIVE_LABELS, ARCHIVE_MODULES, ACTIONS, NOTE_KEYS, MAX_FILE_BYTES,
  featureOn, ready, event, openJob, stateFor, forget, startJob, stopJob,
  currentFiles, columnsOf, confirmColumn, saveNotes, approveExclude, legalNeed, resolveColumn, openItems, customFieldsOf,
  runImport, sandboxSummary, approveSection, blockers, sign, summary, goLive, catchUp, loadLive, purgeDue, queue, needsAcrossSchools,
  staffAccounts, inviteStaff, rollbackJob, rollbackPreview, rollback, startOver, gpaOf, addAttendance, currentEnrollment, LOADED,
  rolesOf, roleReport, confirmRole, roleNotes, resolveRole, approvePerson, gpaCheck, statusesFor, startHub,
  requestMove, withdrawRequest, listRequests, decideRequest, latestRequest, SYSTEMS, TIMINGS, BRING,
  liveMatches, decideMatch, mergePlan, studentMatches, documentsOf, matchDocuments, fieldChoices, setCustomFields, fieldTypeOf, ROLES: roles.ROLES, LEVELS: roles.LEVELS, pickableRoles: roles.pickable, ACCOUNT_TYPES: roles.ACCOUNT_TYPES,
  isoDate, parse, targetLabel: ps.targetLabel,
};
