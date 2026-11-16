"use strict";

// State reporting (feature `state_reporting`; permission State filing, under Report
// Builder). A saved report is written as the state's file (utils/stateFile.js): checked before it
// goes, made by hand or on the state's count dates, and kept locked on the server. A file never
// travels by email: people are told it's ready and download it after confirming their own
// password, and every file made, downloaded or marked as sent is in the activity log.
const stateFile = require("../utils/stateFile");
const features = require("../utils/shards/features");
const { userHasPermission } = require("../middleware/permissionMiddleware");
const { logOrganizationActivity } = require("../utils/activityLog");
const { exportRowsFor } = require("../utils/reportBuilder");
const reportBuilder = require("./reportBuilderController");

const { ensureReportSchema, createReportService, identityFromRequest, localParts, isElevated } = reportBuilder.shared;
const MOST_ROWS = exportRowsFor("csv");
const LATE_DAYS = 3; // a count date missed (the server was down) is still made within 3 days, marked late

class StateFileError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const positiveInt = (value) => (/^\d+$/.test(String(value || "")) && Number(value) > 0 ? Number(value) : null);
const nameOf = (identity) => identity.name || identity.userEmail || "Someone";

let tablesReady = null;
async function ready(db) {
  if (!tablesReady) {
    tablesReady = db.query(
      `SELECT to_regclass('public.state_report_files') IS NOT NULL AS files,
              to_regclass('public.state_report_shares') IS NOT NULL AS shares,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_report_definitions' AND column_name = 'state_file_json') AS settings`
    ).then(({ rows }) => Boolean(rows[0] && rows[0].files && rows[0].shares && rows[0].settings)).catch(() => false);
    tablesReady.then((ok) => { if (!ok) tablesReady = null; });
  }
  return tablesReady;
}

function log(identity, description, recordLabel) {
  logOrganizationActivity({
    organizationId: identity.organizationId,
    userId: identity.userId,
    userName: nameOf(identity),
    userRole: identity.userRole,
    actionType: "Updated",
    moduleName: "State reporting",
    pagePath: "/common/report-builder",
    recordType: "Gov/state report",
    recordLabel,
    description,
  }).catch(() => {});
}

function createStateReporting(db, { hasPermission = userHasPermission } = {}) {
  const service = createReportService(db, { hasPermission });

  // Both permissions, for the person or (on a count date) the report's owner.
  async function mayUse(identity) {
    const [builder, state] = await Promise.all([
      Promise.resolve(hasPermission(db, identity, "reports_builder")).catch(() => false),
      Promise.resolve(hasPermission(db, identity, "state_reporting")).catch(() => false),
    ]);
    return Boolean(builder && state);
  }

  // A saved report this person can open (their own, or shared with them), and its definition.
  async function savedFor(context, reportId) {
    const { rows } = await db.query(
      `SELECT r.report_id, r.report_name, r.report_type, r.columns_json, r.criteria_json, r.state_file_json, r.created_by
         FROM custom_report_definitions r
        WHERE r.report_id = $1 AND r.organization_id = $2
          AND (r.created_by = $3 OR EXISTS (SELECT 1 FROM custom_report_shares sh WHERE sh.report_id = r.report_id AND sh.user_id = $3))`,
      [reportId, context.organizationId, context.identity.userId]
    );
    const saved = rows[0];
    if (!saved || !context.accessibleReports.has(saved.report_type)) throw new StateFileError("Saved report not found.", 404);
    return saved;
  }

  function inputOf(context, saved) {
    const input = service.validateInput({ reportType: saved.report_type, columns: saved.columns_json, criteria: saved.criteria_json }, context);
    if (input.error) throw new StateFileError(input.error);
    return input;
  }

  // The report's rows, all of them (a state file is never cut short).
  async function rowsOf(context, input) {
    const { rows, total } = await service.loadData(context, input, { limit: MOST_ROWS });
    if (total > MOST_ROWS) throw new StateFileError(`This report has ${total.toLocaleString()} rows; a Gov/state report holds up to ${MOST_ROWS.toLocaleString()}. Narrow it with a filter (a class or a school year).`);
    return rows;
  }

  const columnsOf = (input) => input.columns.map((key) => ({ key, label: input.report.columns[key].label, type: input.report.columns[key].type || "text" }));

  // The values found in each column (up to 40 different ones), to translate into state codes.
  function valuesOf(rows, input) {
    const out = {};
    input.columns.forEach((key) => {
      const type = input.report.columns[key].type;
      if (type === "date" || type === "datetime" || type === "number" || type === "money") return;
      const seen = new Set();
      for (const row of rows) {
        const value = row[key];
        if (value === null || value === undefined || value === "") continue;
        seen.add(String(value).slice(0, 120));
        if (seen.size > 40) break;
      }
      if (seen.size && seen.size <= 40) out[key] = [...seen].sort((a, b) => a.localeCompare(b));
    });
    return out;
  }

  const fileRow = (row) => ({
    id: Number(row.file_id),
    fileName: row.file_name,
    rows: row.row_count,
    problems: row.problem_count,
    forDate: row.for_date ? String(row.for_date instanceof Date ? row.for_date.toISOString().slice(0, 10) : row.for_date).slice(0, 10) : null,
    madeAt: row.made_at,
    madeBy: row.made_by_name || "",
    automatic: row.made_automatically,
    available: Boolean(row.has_content),
    expiresAt: row.expires_at,
    downloads: row.download_count,
    lastDownloadedAt: row.last_downloaded_at,
    lastDownloadedBy: row.last_downloaded_by || "",
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by || "",
    submittedReference: row.submitted_reference || "",
    fingerprint: String(row.sha256 || "").slice(0, 12),
    // Who it was sent to outside the school, and whether they downloaded it.
    sentTo: (row.shares || []).map((share) => ({ email: share.email, downloads: share.downloads, expiresAt: share.expires_at, locked: share.wrong_tries >= stateFile.SHARE_TRIES })),
  });

  async function filesOf(organizationId, reportId) {
    const { rows } = await db.query(
      `SELECT file_id, file_name, row_count, problem_count, for_date, made_at, made_by_name, made_automatically,
              content_locked IS NOT NULL AS has_content, expires_at, download_count, last_downloaded_at, last_downloaded_by,
              submitted_at, submitted_by, submitted_reference, sha256,
              (SELECT COALESCE(json_agg(json_build_object('email', sh.email, 'downloads', sh.downloads, 'expires_at', sh.expires_at, 'wrong_tries', sh.wrong_tries) ORDER BY sh.created_at), '[]'::json)
                 FROM state_report_shares sh WHERE sh.file_id = f.file_id) AS shares
         FROM state_report_files f WHERE organization_id = $1 AND report_id = $2 ORDER BY made_at DESC LIMIT 50`,
      [organizationId, reportId]
    );
    return rows.map(fileRow);
  }

  // Make, lock and keep a file. `identity` is who made it (a person, or the owner on a count date).
  async function make(context, saved, { automatic = false, forDate = null, school = "" } = {}) {
    const input = inputOf(context, saved);
    const rows = await rowsOf(context, input);
    const built = stateFile.build(rows, input.columns, input.report, saved.state_file_json || {});
    const day = forDate || localParts(new Date(), "UTC").isoDate;
    const fileName = `${stateFile.fileNameFor(built.settings.fileName, { report: saved.report_name, school, day })}.${built.settings.extension}`;
    const { rows: made } = await db.query(
      `INSERT INTO state_report_files (organization_id, report_id, report_name, file_name, content_type, row_count, problem_count, problems,
                                       sha256, content_locked, for_date, made_by, made_by_name, made_automatically, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, NOW() + ($15 || ' days')::interval)
       RETURNING file_id, file_name, row_count, problem_count, for_date, made_at, made_by_name, made_automatically, TRUE AS has_content,
                 expires_at, download_count, last_downloaded_at, last_downloaded_by, submitted_at, submitted_by, submitted_reference, sha256`,
      [context.organizationId, saved.report_id, saved.report_name, fileName, built.contentType, built.rows, built.problems.length,
        JSON.stringify(built.problems.slice(0, 50)), built.sha256, stateFile.lock(built.content), day,
        context.identity.userId, nameOf(context.identity), automatic, String(stateFile.KEEP_DAYS)]
    );
    log(context.identity, `${automatic ? "Managira made" : `${nameOf(context.identity)} made`} the Gov/state report ${fileName} (${built.rows} rows${built.problems.length ? `, ${built.problems.length} things to check` : ""}) from "${saved.report_name}".`, fileName);
    return { file: fileRow(made[0]), problems: built.problems.map(stateFile.describe) };
  }

  async function schoolOf(organizationId) {
    const { rows } = await db.query("SELECT organization_name, whatsapp_timezone FROM organizations WHERE organization_id = $1", [organizationId]);
    return { name: (rows[0] && rows[0].organization_name) || "", today: localParts(new Date(), rows[0] && rows[0].whatsapp_timezone).isoDate };
  }

  // ---------------------------------------------------------------- requests
  const handle = (fn) => async (req, res) => {
    try {
      if (!features.isOn("state_reporting", { organizationId: req.session && req.session.organizationId })) throw new StateFileError("Not available.", 404);
      if (!(await ready(db))) throw new StateFileError("State reporting needs the 2026-12-14 database update first.", 503);
      await ensureReportSchema(db);
      const identity = identityFromRequest(req);
      if (!identity.organizationId || !identity.userId) throw new StateFileError("Please sign in again.", 401);
      if (!(await mayUse(identity))) throw new StateFileError("Gov/state reports need the Gov/state reporting permission (under Report Builder). Ask a manager.", 403);
      const context = await service.getContext(identity);
      res.set("Cache-Control", "no-store");
      return await fn(req, res, context);
    } catch (error) {
      if (!(error instanceof StateFileError) && !error.status) console.error("[stateReporting]", error);
      const status = error.status || 500;
      if (res.headersSent) return undefined;
      return res.status(status).json({ success: false, error: status === 500 ? "That didn't work. Try again." : error.message });
    }
  };

  return {
    make,
    mayUse,
    savedFor,

    // GET /common/report-builder/saved/:reportId/state-file
    get: handle(async (req, res, context) => {
      const saved = await savedFor(context, positiveInt(req.params.reportId));
      const input = inputOf(context, saved);
      const settings = stateFile.normalizeSettings(saved.state_file_json || {}, input.columns);
      return res.json({
        success: true,
        report: { id: Number(saved.report_id), name: saved.report_name, title: input.report.title + (input.report.variant && input.report.variant !== input.report.title ? ` · ${input.report.variant}` : "") },
        canEdit: Number(saved.created_by) === Number(context.identity.userId),
        configured: Boolean(saved.state_file_json),
        columns: columnsOf(input),
        settings,
        choices: {
          layouts: stateFile.LAYOUTS,
          dateFormats: stateFile.DATE_FORMATS,
          extensions: stateFile.EXTENSIONS,
          presets: Object.entries(stateFile.PRESETS).map(([key, preset]) => ({ key, label: preset.label })),
          maxDates: stateFile.MAX_DATES,
          keepDays: stateFile.KEEP_DAYS,
        },
        files: await filesOf(context.organizationId, saved.report_id),
      });
    }),

    // PUT …/state-file: the report's owner saves how its file is written and its count dates.
    save: handle(async (req, res, context) => {
      const saved = await savedFor(context, positiveInt(req.params.reportId));
      if (Number(saved.created_by) !== Number(context.identity.userId)) throw new StateFileError("Only the person who saved this report changes its Gov/state report settings.", 403);
      const input = inputOf(context, saved);
      const settings = stateFile.normalizeSettings(req.body && req.body.settings, input.columns);
      await db.query("UPDATE custom_report_definitions SET state_file_json = $3::jsonb, updated_at = NOW() WHERE report_id = $1 AND organization_id = $2",
        [saved.report_id, context.organizationId, JSON.stringify(settings)]);
      log(context.identity, `${nameOf(context.identity)} changed the Gov/state report settings of "${saved.report_name}"${settings.dates.length ? ` (count dates: ${settings.dates.join(", ")})` : ""}.`, saved.report_name);
      return res.json({ success: true, settings });
    }),

    // POST …/state-file/check: the file as it would be now, with what to fix. Nothing is stored.
    check: handle(async (req, res, context) => {
      const saved = await savedFor(context, positiveInt(req.params.reportId));
      const input = inputOf(context, saved);
      const settings = req.body && req.body.settings ? req.body.settings : (saved.state_file_json || {});
      const rows = await rowsOf(context, input);
      const built = stateFile.build(rows, input.columns, input.report, settings);
      const text = built.content.toString(built.settings.ascii ? "latin1" : "utf8");
      const preview = text.split(/\r?\n/).slice(0, built.settings.header ? 4 : 3).join("\n");
      const school = await schoolOf(context.organizationId);
      return res.json({
        success: true,
        rows: built.rows,
        problems: built.problems.map((p) => ({ ...p, text: stateFile.describe(p) })),
        values: valuesOf(rows, input),
        preview,
        sample: built.sample,
        header: built.settings.header,
        fileName: `${stateFile.fileNameFor(built.settings.fileName, { report: saved.report_name, school: school.name, day: school.today })}.${built.settings.extension}`,
      });
    }),

    // POST …/state-file/make: make and keep a file now.
    makeNow: handle(async (req, res, context) => {
      const saved = await savedFor(context, positiveInt(req.params.reportId));
      if (!saved.state_file_json) throw new StateFileError("Save the Gov/state report settings first.");
      const school = await schoolOf(context.organizationId);
      const result = await make(context, saved, { school: school.name, forDate: school.today });
      return res.json({ success: true, ...result });
    }),

    // POST /common/report-builder/state-files/:fileId/download: the person's own password, then the file.
    download: handle(async (req, res, context) => {
      const file = await fileFor(context, positiveInt(req.params.fileId));
      if (!file.content_locked) throw new StateFileError("This file's content was removed after a year. Make it again from the report.", 410);
      try {
        await require("../utils/confirmOwnPassword").confirmOwnPassword(req, req.body && req.body.password, { purpose: `download the Gov/state report ${file.file_name}` });
      } catch (refusal) {
        throw new StateFileError(refusal.message || "That password isn't right.", refusal.status || 401);
      }
      const content = stateFile.unlock(file.content_locked);
      await db.query(
        "UPDATE state_report_files SET download_count = download_count + 1, last_downloaded_at = NOW(), last_downloaded_by = $3 WHERE file_id = $1 AND organization_id = $2",
        [file.file_id, context.organizationId, nameOf(context.identity)]
      );
      log(context.identity, `${nameOf(context.identity)} downloaded the Gov/state report ${file.file_name} (${file.row_count} rows, fingerprint ${String(file.sha256).slice(0, 12)}).`, file.file_name);
      res.set("Content-Type", file.content_type);
      res.set("Content-Disposition", `attachment; filename="${String(file.file_name).replace(/[^A-Za-z0-9_.\-]/g, "_")}"`);
      res.set("X-Content-Type-Options", "nosniff");
      return res.send(content);
    }),

    // POST …/state-files/:fileId/submitted: record that it went to the state, with the state's reference.
    // POST …/state-files/:fileId/send: send a made file to the people on the report's list (or the
    // addresses given), the same way the schedule does.
    sendNow: handle(async (req, res, context) => {
      const file = await fileFor(context, positiveInt(req.params.fileId));
      if (!file.content_locked) throw new StateFileError("This file's content was removed after a year. Make it again from the report.", 410);
      const { rows: reportRows } = await db.query("SELECT report_name, state_file_json FROM custom_report_definitions WHERE report_id = $1 AND organization_id = $2", [file.report_id, context.organizationId]);
      const listed = stateFile.normalizeSettings((reportRows[0] && reportRows[0].state_file_json) || {}, []).recipients;
      const given = Array.isArray(req.body && req.body.recipients) ? stateFile.normalizeSettings({ recipients: req.body.recipients }, []).recipients : null;
      const recipients = given && given.length ? given : listed;
      if (!recipients.length) throw new StateFileError("Add who it goes to on the Schedule & send tab first.");
      const school = await schoolOf(context.organizationId);
      const sent = await sendFile(db, { organizationId: context.organizationId, schoolName: school.name, file, reportName: file.report_name, reportId: file.report_id, recipients, by: nameOf(context.identity), hasPermission });
      return res.json({ success: true, sent, files: await filesOf(context.organizationId, file.report_id) });
    }),

    submitted: handle(async (req, res, context) => {
      const file = await fileFor(context, positiveInt(req.params.fileId));
      const reference = String((req.body && req.body.reference) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
      const undo = req.body && req.body.undo === true;
      await db.query(
        `UPDATE state_report_files SET submitted_at = ${undo ? "NULL" : "NOW()"}, submitted_by = $3, submitted_reference = $4
          WHERE file_id = $1 AND organization_id = $2`,
        [file.file_id, context.organizationId, undo ? null : nameOf(context.identity), undo ? null : (reference || null)]
      );
      log(context.identity, undo
        ? `${nameOf(context.identity)} cleared "sent to the state" on ${file.file_name}.`
        : `${nameOf(context.identity)} marked ${file.file_name} as sent to the state${reference ? ` (reference ${reference})` : ""}.`, file.file_name);
      return res.json({ success: true, files: await filesOf(context.organizationId, file.report_id) });
    }),
  };

  // A made file of this school whose report the person can open, or that they made, or any file
  // for those who run the school.
  async function fileFor(context, fileId) {
    const { rows } = await db.query("SELECT * FROM state_report_files WHERE file_id = $1 AND organization_id = $2", [fileId || 0, context.organizationId]);
    const file = rows[0];
    if (!file) throw new StateFileError("That file wasn't found.", 404);
    if (Number(file.made_by) === Number(context.identity.userId) || isElevated(context.identity)) return file;
    if (file.report_id) {
      try { await savedFor(context, Number(file.report_id)); return file; } catch (_) { /* refused below */ }
    }
    throw new StateFileError("That file wasn't found.", 404);
  }
}

// ---------------------------------------------------------------- count dates (the job)
// Every hour: a report whose count date is today (school time, from its chosen hour) is made as
// its owner, with the owner's current access, and the owner and the people it's shared with who
// hold State filing are told it's ready. Nothing is attached: the email has no student data.
async function runDueStateFiles(db, { now = new Date(), send, hasPermission = userHasPermission } = {}) {
  const summary = { made: 0, failed: 0, purged: 0 };
  if (!(await ready(db))) return summary;
  // Which schools have state reporting is read before deciding (a server just started hasn't yet).
  await Promise.resolve(features.refresh && features.refresh()).catch(() => {});
  await ensureReportSchema(db);
  // Content kept past its year is removed; the record of what was made and sent stays.
  summary.purged = (await db.query("UPDATE state_report_files SET content_locked = NULL WHERE content_locked IS NOT NULL AND expires_at < NOW()")).rowCount;
  const { rows } = await db.query(
    `SELECT r.report_id, r.organization_id, r.report_name, r.report_type, r.columns_json, r.criteria_json, r.state_file_json, r.created_by,
            u.email, u.first_name, u.last_name, u.account_type::text AS role, o.organization_name, o.whatsapp_timezone
       FROM custom_report_definitions r
       JOIN users u ON u.user_id = r.created_by AND u.organization_id = r.organization_id AND u.removed_at IS NULL AND COALESCE(u.on_hold, FALSE) = FALSE
       JOIN organizations o ON o.organization_id = r.organization_id AND COALESCE(o.on_hold, FALSE) = FALSE AND COALESCE(o.deleted, FALSE) = FALSE
      WHERE r.state_file_json IS NOT NULL
        AND (jsonb_array_length(COALESCE(r.state_file_json -> 'dates', '[]'::jsonb)) > 0
             OR COALESCE(r.state_file_json ->> 'repeat', 'none') IN ('weekdays', 'weekly', 'monthly'))`
  );
  const tool = createStateReporting(db, { hasPermission });
  for (const row of rows) {
    if (!features.isOn("state_reporting", { organizationId: row.organization_id })) continue;
    const local = localParts(now, row.whatsapp_timezone);
    const settings = stateFile.normalizeSettings(row.state_file_json || {}, []);
    // Today's file (a count date or the repeating schedule), and any count date missed in the
    // last few days (the server was down), made late and said so.
    const due = [
      ...(stateFile.dueToday(settings, local) ? [local.isoDate] : []),
      ...settings.dates.filter((day) => day < local.isoDate && Date.parse(`${local.isoDate}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) <= LATE_DAYS * 864e5),
    ];
    for (const day of due) {
      // Claimed once, whichever server gets there first.
      const claim = await db.query(
        "INSERT INTO state_report_runs (report_id, organization_id, run_on) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING report_id",
        [row.report_id, row.organization_id, day]
      );
      if (!claim.rowCount) continue;
      const identity = { userId: Number(row.created_by), userRole: row.role, accountType: row.role, organizationId: Number(row.organization_id), userEmail: row.email, name: [row.first_name, row.last_name].filter(Boolean).join(" ") };
      try {
        if (!(await tool.mayUse(identity))) throw new StateFileError("The report's owner no longer has Gov/state reporting (under Report Builder).");
        const context = await reportBuilder.shared.createReportService(db, { hasPermission }).getContext(identity);
        const saved = await tool.savedFor(context, Number(row.report_id));
        const result = await tool.make(context, saved, { automatic: true, forDate: day, school: row.organization_name });
        await db.query("UPDATE state_report_runs SET file_id = $3 WHERE report_id = $1 AND run_on = $2", [row.report_id, day, result.file.id]);
        await tellReady(db, row, result, day, day < local.isoDate, { send, hasPermission });
        summary.made++;
      } catch (error) {
        summary.failed++;
        await db.query("UPDATE state_report_runs SET last_error = $3 WHERE report_id = $1 AND run_on = $2", [row.report_id, day, String(error.message || error).slice(0, 500)]).catch(() => {});
        await tellFailed(db, row, day, error, { send }).catch(() => {});
      }
    }
  }
  return summary;
}

async function recipientsOf(db, row, hasPermission) {
  const people = [{ userId: Number(row.created_by), email: row.email, role: row.role }];
  const { rows } = await db.query(
    `SELECT u.user_id, u.email, u.account_type::text AS role FROM custom_report_shares sh
       JOIN users u ON u.user_id = sh.user_id AND u.organization_id = $2 AND u.removed_at IS NULL AND COALESCE(u.on_hold, FALSE) = FALSE
      WHERE sh.report_id = $1 AND u.email IS NOT NULL`,
    [row.report_id, row.organization_id]
  );
  for (const person of rows) {
    const who = { userId: Number(person.user_id), userRole: person.role, accountType: person.role, organizationId: Number(row.organization_id), userEmail: person.email };
    const [a, b] = await Promise.all([hasPermission(db, who, "reports_builder"), hasPermission(db, who, "state_reporting")].map((p) => Promise.resolve(p).catch(() => false)));
    if (a && b && !people.some((p) => p.userId === who.userId)) people.push({ userId: who.userId, email: person.email, role: person.role });
  }
  return people.filter((p) => p.email);
}

const appUrl = () => String(process.env.NODE_ENV === "production"
  ? (process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com")
  : (process.env.BASE_URL_LOCAL || process.env.BASE_URL || "http://localhost:4000")).replace(/\/$/, "");
const hashOf = (text) => require("crypto").createHash("sha256").update(String(text)).digest("hex");
const codeHashOf = (token, code) => hashOf(`${token}:${code}`);
const longDay = (value) => new Date(value).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// Sends a made file to the people a school named. Staff of the school with Gov/state reporting get
// a link to sign in and download it; anyone else (a state or district data office) gets a link
// that works for 7 days and, in a separate email, a 6-digit code it asks for. The file itself is
// never attached. Every send is in the school's activity log.
async function sendFile(db, { organizationId, schoolName, file, reportName, reportId, recipients, by, send, hasPermission = userHasPermission }) {
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
  const deliver = send || sendEmailSafely;
  const crypto = require("crypto");
  const school = escapeHtml(schoolName || "Your school");
  const what = `<strong>${escapeHtml(file.file_name)}</strong> (${Number(file.row_count).toLocaleString()} ${Number(file.row_count) === 1 ? "row" : "rows"})`;
  const sent = { staff: [], outside: [] };
  for (const email of recipients) {
    const { rows: staff } = await db.query(
      `SELECT user_id, email, account_type::text AS role FROM users
        WHERE organization_id = $1 AND LOWER(email) = $2 AND removed_at IS NULL AND COALESCE(on_hold, FALSE) = FALSE LIMIT 1`,
      [organizationId, email]
    );
    const person = staff[0];
    const who = person && { userId: Number(person.user_id), userRole: person.role, accountType: person.role, organizationId, userEmail: person.email };
    const canSignIn = who && (await Promise.all(["reports_builder", "state_reporting"].map((key) => Promise.resolve(hasPermission(db, who, key)).catch(() => false)))).every(Boolean);
    if (canSignIn) {
      await deliver({
        to: email,
        sender: "reports",
        subject: `Gov/state report ready: ${reportName}`,
        html: renderCleanEmail({
          title: "Your Gov/state report is ready",
          greeting: "Hello,",
          paragraphs: [
            `${school} made the Gov/state report ${what} from the report <strong>${escapeHtml(reportName)}</strong>.`,
            "Sign in to Managira to download it (your password is asked), then upload it to the state’s portal and mark it as sent.",
          ],
          cta: { url: `${appUrl()}/common/report-builder?stateFile=${encodeURIComponent(reportId)}`, text: "Open it in Managira" },
        }),
      }, "Gov/state report ready").catch(() => {});
      sent.staff.push(email);
      continue;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const expires = new Date(Date.now() + stateFile.SHARE_DAYS * 864e5);
    await db.query(
      `INSERT INTO state_report_shares (organization_id, file_id, email, token_hash, code_hash, expires_at, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [organizationId, file.file_id, email, hashOf(token), codeHashOf(token, code), expires, by || "Managira"]
    );
    await deliver({
      to: email,
      sender: "reports",
      subject: `${schoolName}: Gov/state report ${file.file_name}`,
      html: renderCleanEmail({
        title: "A Gov/state report was sent to you",
        greeting: "Hello,",
        paragraphs: [
          `${school} sent you its Gov/state report ${what}.`,
          `Open the secure link and enter the 6-digit code we sent you in a separate email. The link works until ${escapeHtml(longDay(expires))}, for up to ${stateFile.SHARE_DOWNLOADS} downloads.`,
          "If you weren’t expecting this, you can ignore this email.",
        ],
        cta: { url: `${appUrl()}/gov-report/${token}`, text: "Download the report" },
      }),
    }, "Gov/state report link").catch(() => {});
    await deliver({
      to: email,
      sender: "reports",
      subject: `Your code for the Gov/state report from ${schoolName}`,
      html: renderCleanEmail({
        title: "Your code",
        greeting: "Hello,",
        paragraphs: [
          `Your code for the Gov/state report from ${school} is <strong style="font-size:20px;letter-spacing:.2em">${code}</strong>.`,
          "Enter it on the page the other email links to. Don’t share it with anyone.",
        ],
      }),
    }, "Gov/state report code").catch(() => {});
    sent.outside.push(email);
  }
  const all = sent.staff.concat(sent.outside);
  if (all.length) {
    logOrganizationActivity({
      organizationId, userName: by || "Managira", userRole: by ? null : "Managira", actionType: "Updated", moduleName: "State reporting",
      pagePath: "/common/report-builder", recordType: "Gov/state report", recordLabel: file.file_name,
      description: `${by || "Managira"} sent the Gov/state report ${file.file_name} to ${all.join(", ")}.`,
    }).catch(() => {});
  }
  return sent;
}

// After a file is made on schedule: it goes to the people on the report's list, and the owner
// (with the people it's shared with) is told; with nobody on the list, they're told it's ready.
async function tellReady(db, row, result, day, late, { send, hasPermission }) {
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
  const deliver = send || sendEmailSafely;
  const settings = stateFile.normalizeSettings(row.state_file_json || {}, []);
  const { rows: fileRows } = await db.query("SELECT file_id, file_name, row_count, problem_count FROM state_report_files WHERE file_id = $1", [result.file.id]);
  let sent = null;
  if (settings.recipients.length && fileRows[0]) {
    sent = await sendFile(db, { organizationId: Number(row.organization_id), schoolName: row.organization_name, file: fileRows[0], reportName: row.report_name, reportId: row.report_id, recipients: settings.recipients, by: null, send, hasPermission });
  }
  const sentTo = sent ? sent.staff.concat(sent.outside) : [];
  const problems = result.file.problems;
  for (const person of await recipientsOf(db, row, hasPermission)) {
    if (sentTo.includes(String(person.email).toLowerCase())) continue;
    await deliver({
      to: person.email,
      sender: "reports",
      subject: `Gov/state report ${sentTo.length ? "made and sent" : "ready"}: ${row.report_name} (${day})`,
      html: renderCleanEmail({
        title: sentTo.length ? "Your Gov/state report was made and sent" : "Your Gov/state report is ready",
        greeting: "Hello,",
        paragraphs: [
          `The Gov/state report <strong>${escapeHtml(result.file.fileName)}</strong> was made from the report <strong>${escapeHtml(row.report_name)}</strong> for ${escapeHtml(day)}${late ? " (a day or more late, as the server couldn't make it on the day)" : ""}: ${Number(result.file.rows).toLocaleString()} rows.`,
          problems ? `The check found <strong>${problems}</strong> ${problems === 1 ? "thing" : "things"} to look at.` : "The check found nothing to fix.",
          sentTo.length
            ? `It was sent to ${escapeHtml(sentTo.join(", "))}, each with a secure link. You can see every download in Managira.`
            : "To keep students' information safe, the file isn't attached. Sign in to Managira and open Reports, Report Builder, the report, then Gov/state report, to download it.",
        ],
        cta: { url: `${appUrl()}/common/report-builder?stateFile=${encodeURIComponent(row.report_id)}`, text: "Open it in Managira" },
        note: `${escapeHtml(row.organization_name)} · Managira`,
      }),
    }, "Gov/state report ready").catch(() => {});
  }
}

async function tellFailed(db, row, day, error, { send }) {
  if (!row.email) return;
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
  await (send || sendEmailSafely)({
    to: row.email,
    sender: "reports",
    subject: `Gov/state report not made: ${row.report_name} (${day})`,
    html: renderCleanEmail({
      title: "Your Gov/state report wasn't made",
      greeting: "Hello,",
      paragraphs: [
        `The Gov/state report for <strong>${escapeHtml(row.report_name)}</strong>, due ${escapeHtml(day)}, couldn't be made: ${escapeHtml(String(error.message || "an error"))}`,
        "Open Reports, Report Builder, the report, then Gov/state report, to check it and make it by hand.",
      ],
    }),
  }, "Gov/state report failed");
}

// ---------------------------------------------------------------- the link sent outside the school
// /gov-report/:token: someone a school named (a state or district data office) opens the link from
// their email and types the 6-digit code from the other email. Five wrong codes lock the link; it
// works for 7 days and 5 downloads. Only hashes of the link and code are stored; every download
// is in the school's activity log.
function createGovShare(db) {
  async function shareOf(token) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || "")) || !(await ready(db))) return null;
    const { rows } = await db.query(
      `SELECT sh.*, f.file_name, f.content_type, f.content_locked, f.row_count, o.organization_name
         FROM state_report_shares sh
         JOIN state_report_files f ON f.file_id = sh.file_id AND f.organization_id = sh.organization_id
         JOIN organizations o ON o.organization_id = sh.organization_id
        WHERE sh.token_hash = $1`,
      [hashOf(token)]
    );
    return rows[0] || null;
  }
  function stateOf(share) {
    if (!share) return "missing";
    if (new Date(share.expires_at) < new Date()) return "expired";
    if (share.wrong_tries >= stateFile.SHARE_TRIES) return "locked";
    if (share.downloads >= stateFile.SHARE_DOWNLOADS) return "used";
    if (!share.content_locked) return "removed";
    return "open";
  }
  function render(res, share, status, message, httpStatus = 200) {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Referrer-Policy", "no-referrer");
    return res.status(httpStatus).render("stateFile/share", {
      layout: false,
      school: (share && share.organization_name) || "",
      fileName: (share && share.file_name) || "",
      rows: (share && share.row_count) || 0,
      expires: share ? longDay(share.expires_at) : "",
      downloadsLeft: share ? Math.max(0, stateFile.SHARE_DOWNLOADS - share.downloads) : 0,
      status,
      message,
    });
  }
  const schoolLog = (share, description) => logOrganizationActivity({
    organizationId: share.organization_id, userName: share.email, userRole: "Outside recipient", actionType: "Updated", moduleName: "State reporting",
    pagePath: "/gov-report", recordType: "Gov/state report", recordLabel: share.file_name, description,
  }).catch(() => {});

  return {
    page: async (req, res) => {
      try {
        const share = await shareOf(req.params.token);
        return render(res, share, stateOf(share), "", share ? 200 : 404);
      } catch (error) {
        console.error("[govReport] page:", error.message);
        return render(res, null, "missing", "", 500);
      }
    },
    download: async (req, res) => {
      try {
        const share = await shareOf(req.params.token);
        const status = stateOf(share);
        if (status !== "open") return render(res, share, status, "", share ? 410 : 404);
        const code = String((req.body && req.body.code) || "").replace(/\D/g, "");
        const expected = Buffer.from(share.code_hash);
        const given = Buffer.from(codeHashOf(req.params.token, code));
        const right = code.length === 6 && given.length === expected.length && require("crypto").timingSafeEqual(given, expected);
        if (!right) {
          const { rows } = await db.query("UPDATE state_report_shares SET wrong_tries = wrong_tries + 1 WHERE share_id = $1 RETURNING wrong_tries", [share.share_id]);
          const left = stateFile.SHARE_TRIES - rows[0].wrong_tries;
          if (left <= 0) schoolLog(share, `The Gov/state report link sent to ${share.email} locked after ${stateFile.SHARE_TRIES} wrong codes.`);
          return render(res, { ...share, wrong_tries: rows[0].wrong_tries }, left <= 0 ? "locked" : "open", left <= 0 ? "" : `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`, 401);
        }
        // One download claimed at a time, so the limit holds even with several clicks at once.
        const claim = await db.query(
          "UPDATE state_report_shares SET downloads = downloads + 1, last_downloaded_at = NOW() WHERE share_id = $1 AND downloads < $2 AND expires_at > NOW() RETURNING downloads",
          [share.share_id, stateFile.SHARE_DOWNLOADS]
        );
        if (!claim.rowCount) return render(res, share, "used", "", 410);
        const content = stateFile.unlock(share.content_locked);
        schoolLog(share, `${share.email} downloaded the Gov/state report ${share.file_name} (${share.row_count} rows) through the link sent to them.`);
        res.set("Cache-Control", "no-store");
        res.set("X-Robots-Tag", "noindex, nofollow");
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Content-Type", share.content_type);
        res.set("Content-Disposition", `attachment; filename="${String(share.file_name).replace(/[^A-Za-z0-9_.\-]/g, "_")}"`);
        return res.send(content);
      } catch (error) {
        console.error("[govReport] download:", error.message);
        return render(res, null, "missing", "Something went wrong. Try again in a moment.", 500);
      }
    },
  };
}

module.exports = { createStateReporting, createGovShare, sendFile, runDueStateFiles, StateFileError, ready };
