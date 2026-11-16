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
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_report_definitions' AND column_name = 'state_file_json') AS settings`
    ).then(({ rows }) => Boolean(rows[0] && rows[0].files && rows[0].settings)).catch(() => false);
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
    recordType: "State file",
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
    if (total > MOST_ROWS) throw new StateFileError(`This report has ${total.toLocaleString()} rows; a state file holds up to ${MOST_ROWS.toLocaleString()}. Narrow it with a filter (a class or a school year).`);
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
  });

  async function filesOf(organizationId, reportId) {
    const { rows } = await db.query(
      `SELECT file_id, file_name, row_count, problem_count, for_date, made_at, made_by_name, made_automatically,
              content_locked IS NOT NULL AS has_content, expires_at, download_count, last_downloaded_at, last_downloaded_by,
              submitted_at, submitted_by, submitted_reference, sha256
         FROM state_report_files WHERE organization_id = $1 AND report_id = $2 ORDER BY made_at DESC LIMIT 50`,
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
    log(context.identity, `${automatic ? "Managira made" : `${nameOf(context.identity)} made`} the state file ${fileName} (${built.rows} rows${built.problems.length ? `, ${built.problems.length} things to check` : ""}) from "${saved.report_name}".`, fileName);
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
      if (!(await mayUse(identity))) throw new StateFileError("State files need the State filing permission (under Report Builder). Ask a manager.", 403);
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
      if (Number(saved.created_by) !== Number(context.identity.userId)) throw new StateFileError("Only the person who saved this report changes its state file.", 403);
      const input = inputOf(context, saved);
      const settings = stateFile.normalizeSettings(req.body && req.body.settings, input.columns);
      await db.query("UPDATE custom_report_definitions SET state_file_json = $3::jsonb, updated_at = NOW() WHERE report_id = $1 AND organization_id = $2",
        [saved.report_id, context.organizationId, JSON.stringify(settings)]);
      log(context.identity, `${nameOf(context.identity)} changed the state file settings of "${saved.report_name}"${settings.dates.length ? ` (count dates: ${settings.dates.join(", ")})` : ""}.`, saved.report_name);
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
      if (!saved.state_file_json) throw new StateFileError("Save the state file settings first.");
      const school = await schoolOf(context.organizationId);
      const result = await make(context, saved, { school: school.name, forDate: school.today });
      return res.json({ success: true, ...result });
    }),

    // POST /common/report-builder/state-files/:fileId/download: the person's own password, then the file.
    download: handle(async (req, res, context) => {
      const file = await fileFor(context, positiveInt(req.params.fileId));
      if (!file.content_locked) throw new StateFileError("This file's content was removed after a year. Make it again from the report.", 410);
      try {
        await require("../utils/confirmOwnPassword").confirmOwnPassword(req, req.body && req.body.password, { purpose: `download the state file ${file.file_name}` });
      } catch (refusal) {
        throw new StateFileError(refusal.message || "That password isn't right.", refusal.status || 401);
      }
      const content = stateFile.unlock(file.content_locked);
      await db.query(
        "UPDATE state_report_files SET download_count = download_count + 1, last_downloaded_at = NOW(), last_downloaded_by = $3 WHERE file_id = $1 AND organization_id = $2",
        [file.file_id, context.organizationId, nameOf(context.identity)]
      );
      log(context.identity, `${nameOf(context.identity)} downloaded the state file ${file.file_name} (${file.row_count} rows, fingerprint ${String(file.sha256).slice(0, 12)}).`, file.file_name);
      res.set("Content-Type", file.content_type);
      res.set("Content-Disposition", `attachment; filename="${String(file.file_name).replace(/[^A-Za-z0-9_.\-]/g, "_")}"`);
      res.set("X-Content-Type-Options", "nosniff");
      return res.send(content);
    }),

    // POST …/state-files/:fileId/submitted: record that it went to the state, with the state's reference.
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
        if (!(await tool.mayUse(identity))) throw new StateFileError("The report's owner no longer has State filing (under Report Builder).");
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

async function tellReady(db, row, result, day, late, { send, hasPermission }) {
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
  const deliver = send || sendEmailSafely;
  const problems = result.file.problems;
  for (const person of await recipientsOf(db, row, hasPermission)) {
    await deliver({
      to: person.email,
      sender: "reports",
      subject: `State file ready: ${row.report_name} (${day})`,
      html: renderCleanEmail({
        title: "Your state file is ready",
        greeting: "Hello,",
        paragraphs: [
          `The state file <strong>${escapeHtml(result.file.fileName)}</strong> was made from the report <strong>${escapeHtml(row.report_name)}</strong> for ${escapeHtml(day)}${late ? " (a day or more late, as the server couldn't make it on the day)" : ""}: ${Number(result.file.rows).toLocaleString()} rows.`,
          problems ? `The check found <strong>${problems}</strong> ${problems === 1 ? "thing" : "things"} to look at before you send it.` : "The check found nothing to fix.",
          "To keep students' information safe, the file isn't attached. Sign in to Managira and open Reports, Report Builder, the report, then State file, to download it and upload it to the state's portal.",
        ],
        note: `${escapeHtml(row.organization_name)} · Managira`,
      }),
    }, "State file ready").catch(() => {});
  }
}

async function tellFailed(db, row, day, error, { send }) {
  if (!row.email) return;
  const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
  await (send || sendEmailSafely)({
    to: row.email,
    sender: "reports",
    subject: `State file not made: ${row.report_name} (${day})`,
    html: renderCleanEmail({
      title: "Your state file wasn't made",
      greeting: "Hello,",
      paragraphs: [
        `The state file for <strong>${escapeHtml(row.report_name)}</strong>, due ${escapeHtml(day)}, couldn't be made: ${escapeHtml(String(error.message || "an error"))}`,
        "Open Reports, Report Builder, the report, then State file, to check it and make it by hand.",
      ],
    }),
  }, "State file failed");
}

module.exports = { createStateReporting, runDueStateFiles, StateFileError, ready };
