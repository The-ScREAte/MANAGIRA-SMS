"use strict";
// Data migration (utils/dataMigration.js). The school's admins work through the steps in
// Management (/common/migration, never a page of its own); the Managira team toggles the
// sandbox, resolves columns and can roll a go-live back in Super Admin (/admin/migrations).
// Both sides confirm with an authenticator code (utils/mfa.js) as well as a recent password,
// every 30 minutes; so does anyone opening restricted data from the old system.
const multer = require("multer");
const m = require("../utils/dataMigration");
const mfa = require("../utils/mfa");
const bcrypt = require("../utils/passwordHashing");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { isOrgAdmin } = require("../middleware/migrationLock");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: m.MAX_FILE_BYTES, files: 12 } });
const orgOf = (req) => Number(req.session.organizationId);
const toId = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const userIdOf = (req) => req.session.userId || req.session.user?.user_id || null;
const actorOf = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(" ") || req.session.userEmail || req.session.user?.email || "School admin";
const STEPS = ["upload", "map", "check", "roles", "notes", "review", "live"];
const HUB_URL = (step) => `/common/management?panel=migration&page=${encodeURIComponent(`/common/migration${step ? `?step=${step}` : ""}`)}&label=${encodeURIComponent("Data migration")}`;
const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

// ── The authenticator code (school side) ────────────────────────────────────────────────
// Where the code page may send someone back to: the migration's pages and the student page.
const safeNext = (value) => (/^\/common\/(migration|studentDetails|management)(\/[\w/-]*)?(\?[\w=&%.+-]*)?$/.test(String(value || "")) ? String(value) : "/common/migration?embed=workspace");
const verifyUrl = (next) => `/common/migration/verify?embed=workspace&next=${encodeURIComponent(next)}`;
// Every migration page and action needs a code from the last 30 minutes.
function codeGate(req, res, next) {
  if (mfa.fresh(req)) return next();
  if (req.method === "GET") return res.redirect(verifyUrl(req.originalUrl));
  req.flash("error", "Confirm it's you with your authenticator code first.");
  return res.redirect(verifyUrl("/common/migration?embed=workspace"));
}
async function passwordOf(db, account) {
  const sql = account.kind === "organization" ? "SELECT password FROM organizations WHERE organization_id = $1" : "SELECT password FROM users WHERE user_id = $1";
  return ((await db.query(sql, [account.id])).rows[0] || {}).password || null;
}
const allowedHere = async (req, db) => orgOf(req) && isOrgAdmin(req.session) && m.featureOn(orgOf(req)) && (await m.ready(db));

async function verifyPage(req, res, db) {
  if (!(await allowedHere(req, db))) return res.redirect("/");
  const account = mfa.accountOf(req);
  if (!account) return res.redirect("/");
  const next = safeNext(req.query.next);
  const setUp = await mfa.isSetUp(db, account);
  res.render("migration/verify", {
    title: "Confirm it's you", isEmbedded: true, hideGlobalHeader: true, hideGlobalFooter: true, hideGlobalChatbot: true, messages: req.flash(),
    side: "school", action: "/common/migration/verify", next, setup: setUp ? null : await mfa.startSetup(db, account, mfa.labelOf(req)),
    needsPassword: Boolean(await passwordOf(db, account)), recovery: null,
  });
}
async function verifyPost(req, res, db) {
  if (!(await allowedHere(req, db))) return res.redirect("/");
  const account = mfa.accountOf(req);
  const next = safeNext(req.body.next);
  const again = () => res.redirect(`/common/migration/verify?embed=workspace&next=${encodeURIComponent(next)}`);
  const hash = await passwordOf(db, account);
  if (hash && !(await bcrypt.compare(String(req.body.password || ""), hash))) {
    await m.event(db, { organizationId: orgOf(req), actor: actorOf(req), action: "code_check_failed", detail: { why: "password" }, ip: req.ip });
    req.flash("error", "That password isn't right.");
    return again();
  }
  if (!(await mfa.isSetUp(db, account))) {
    const result = await mfa.confirmSetup(db, account, req.body.code);
    if (result.error) { req.flash("error", result.error); return again(); }
    mfa.markFresh(req);
    await m.event(db, { organizationId: orgOf(req), actor: actorOf(req), action: "authenticator_set_up", ip: req.ip });
    return res.render("migration/verify", {
      title: "Save your recovery codes", isEmbedded: true, hideGlobalHeader: true, hideGlobalFooter: true, hideGlobalChatbot: true, messages: {},
      side: "school", action: "/common/migration/verify", next, setup: null, needsPassword: false, recovery: result.recovery,
    });
  }
  const result = await mfa.verify(db, account, req.body.code);
  if (result.error) {
    await m.event(db, { organizationId: orgOf(req), actor: actorOf(req), action: "code_check_failed", ip: req.ip });
    req.flash("error", result.error);
    return again();
  }
  mfa.markFresh(req);
  await m.event(db, { organizationId: orgOf(req), actor: actorOf(req), action: result.recoveryLeft !== undefined ? "recovery_code_used" : "code_confirmed", ip: req.ip });
  if (result.recoveryLeft !== undefined) req.flash("info", `You used a recovery code: ${result.recoveryLeft} left. Ask Managira to reset your authenticator if you lost your phone.`);
  return res.redirect(next);
}

// ── School side ─────────────────────────────────────────────────────────────────────────
async function schoolContext(req, res, db) {
  if (!(await allowedHere(req, db))) return null;
  return m.openJob(db, orgOf(req));
}
const back = (req, res, step) => res.redirect(`/common/migration?step=${step}&embed=workspace`);
const done = (req, res, result, step, ok) => {
  if (result && result.error) req.flash("error", result.error);
  else if (ok) req.flash("success", ok);
  return back(req, res, step);
};

async function page(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) { req.flash("error", "There's no data migration open for your school."); return res.redirect("/"); }
  if (!isEmbeddedRequest(req, "migration") && String(req.get("Sec-Fetch-Dest") || "") !== "iframe") return res.redirect(HUB_URL(req.query.step));
  const [files, columns, custom, sandbox, check, events, staff, roleReport] = await Promise.all([
    m.currentFiles(db, job), m.columnsOf(db, job), m.customFieldsOf(db, job.organization_id), m.sandboxSummary(db, job), m.blockers(db, job),
    db.query("SELECT actor, action, detail, at FROM migration_events WHERE job_id = $1 ORDER BY at DESC LIMIT 25", [job.job_id]).then((r) => r.rows),
    job.status === "live" ? m.staffAccounts(db, job) : Promise.resolve([]),
    m.roleReport(db, job),
  ]);
  const open = m.openItems(columns);
  const step = STEPS.includes(req.query.step) ? req.query.step : job.status === "live" ? "live" : !files.length ? "upload" : open.unsure.length ? "map" : "check";
  // Each student's GPA from PowerSchool beside Managira's working, where the step shows it.
  const gpaCheck = ["review", "live"].includes(step) ? await m.gpaCheck(db, job) : null;
  res.render("migration/school", {
    title: "Data migration", isEmbedded: true, hideGlobalHeader: true, hideGlobalFooter: true, hideGlobalChatbot: true, messages: req.flash(),
    job, step, steps: STEPS, files, columns, custom, sandbox, open, blockers: check.list, needed: check.needed, events, staff, roleReport, roleChoices: m.ROLES, roleLevels: m.LEVELS, gpaCheck,
    entities: m.ENTITIES, sections: m.SECTIONS, sectionLabels: m.SECTION_LABELS, sensitiveLabels: m.SENSITIVE_LABELS, noteKeys: m.NOTE_KEYS,
    summary: m.summary(columns, custom), targetLabel: m.targetLabel,
  });
}

const uploadHandler = (req, res, next) => upload.array("files", 12)(req, res, (error) => {
  if (error) { req.flash("error", error.code === "LIMIT_FILE_SIZE" ? "Files can be up to 30 MB." : "The files couldn't be uploaded."); return back(req, res, "upload"); }
  return next();
});
async function uploadPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  if (job.status === "live" && job.catch_up_at) return done(req, res, { error: "The catch-up import was already used." }, "live");
  const files = req.files || [];
  if (!files.length) return done(req, res, { error: "Choose the CSV files to upload." }, "upload");
  const added = [];
  for (const file of files) {
    const result = await m.addFile(db, job, { name: file.originalname, buffer: file.buffer, entity: req.body.entity, actor: actorOf(req) });
    if (result.error) { req.flash("error", `${file.originalname}: ${result.error}`); continue; }
    added.push(`${result.file.file_name} (${m.ENTITIES[result.file.entity].label}, ${result.file.row_count} rows)`);
  }
  if (added.length) req.flash("success", `Uploaded ${added.join(", ")}. Check the matches next.`);
  return back(req, res, job.status === "live" ? "live" : added.length ? "map" : "upload");
}

const columnAction = (fn, step) => async (req, res, db) => {
  const job = await schoolContext(req, res, db);
  if (!job || job.status === "live") return res.redirect("/");
  return done(req, res, await fn(job, req), step, "Saved.");
};
const confirmPost = (req, res, db) => columnAction((job) => m.confirmColumn(db, job, toId(req.params.columnId), String(req.body.target || ""), actorOf(req)), "map")(req, res, db);
const notesPost = (req, res, db) => columnAction((job) => m.saveNotes(db, job, toId(req.params.columnId), req.body, actorOf(req)), "notes")(req, res, db);
const excludePost = (req, res, db) => columnAction((job) => m.approveExclude(db, job, toId(req.params.columnId), userIdOf(req), actorOf(req)), "notes")(req, res, db);
const legalPost = (req, res, db) => columnAction((job) => m.legalNeed(db, job, toId(req.params.columnId), userIdOf(req), actorOf(req)), "notes")(req, res, db);

async function importPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job || job.status === "live") return res.redirect("/");
  const result = await m.runImport(db, job, actorOf(req));
  return done(req, res, result, "check", "Imported into the sandbox. The check report is below.");
}
async function approvePost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job || job.status === "live") return res.redirect("/");
  return done(req, res, await m.approveSection(db, job, String(req.body.section || ""), req.body.on === "1", actorOf(req)), "review");
}
async function signPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job || job.status === "live") return res.redirect("/");
  return done(req, res, await m.sign(db, job, req.body.name, userIdOf(req), actorOf(req)), "review", "Signed. You can go live when you're ready.");
}
async function goLivePost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  try {
    const result = await m.goLive(db, job, actorOf(req));
    const c = result.counts;
    return done(req, res, result, result.error ? "review" : "live", c ? `You're live: ${c.students} students, ${c.guardians} parent links and ${c.staff} staff accounts loaded.` : "");
  } catch (error) {
    console.error("[Migration] go live:", error.message);
    return done(req, res, { error: "Going live stopped and nothing was changed. Try again, or contact Managira." }, "review");
  }
}
async function catchUpPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  try {
    const result = await m.catchUp(db, job, actorOf(req));
    return done(req, res, result, "live", result.counts ? `Catch-up loaded: ${result.counts.students} students updated.` : "");
  } catch (error) {
    console.error("[Migration] catch-up:", error.message);
    return done(req, res, { error: "The catch-up stopped and nothing was changed. Try again." }, "live");
  }
}

// ── Staff roles ──
const roleAction = (fn) => async (req, res, db) => {
  const job = await schoolContext(req, res, db);
  if (!job || job.status === "live") return res.redirect("/");
  return done(req, res, await fn(job, req), "roles", "Saved.");
};
const roleConfirmPost = (req, res, db) => roleAction((job) => m.confirmRole(db, job, toId(req.params.roleId), String(req.body.target || ""), actorOf(req)))(req, res, db);
const roleNotesPost = (req, res, db) => roleAction((job) => m.roleNotes(db, job, toId(req.params.roleId), req.body, actorOf(req)))(req, res, db);
const roleApprovePost = (req, res, db) => roleAction((job) => m.approvePerson(db, job, String(req.body.sourceId || ""), req.body.on === "1", actorOf(req)))(req, res, db);

// The role report on its own: as a spreadsheet, a page to print, or a PDF of that page.
const reportRows = (people) => people.map((p) => ({
  Name: p.name, Email: p.email, Status: p.active ? "Active" : "Inactive (history only)", "Old role": p.oldRole || "(none)",
  "Managira role": p.existing ? "Already in Managira" : p.noAccount ? `No account: ${p.noAccount}` : p.newRole || (p.active ? "No role yet" : ""),
  Schools: p.schools.join(", "), Classes: p.classes.map((c) => `${c.name} (${c.as}${c.now ? "" : ", past"})`).join("; "), "Can do": p.can,
  Flags: [p.noRole ? "No role" : "", p.up.length ? `Access goes up: ${p.up.join(", ")}` : "", p.adminLevel ? "Admin-level" : ""].filter(Boolean).join("; "),
  Approved: p.needsApproval ? (p.approved ? `Yes, by ${p.approved.by}` : "Not yet") : "",
}));
async function roleReportFile(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const report = await m.roleReport(db, job);
  const format = String(req.query.format || "print");
  await m.event(db, { jobId: job.job_id, organizationId: job.organization_id, actor: actorOf(req), action: "role_report_" + (format === "csv" ? "downloaded" : format === "pdf" ? "pdf" : "printed") });
  if (format === "csv") {
    const rows = reportRows(report.people);
    const columns = rows.length ? Object.keys(rows[0]) : ["Name"];
    const cell = (v) => { let t = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="role-report.csv"');
    res.setHeader("Cache-Control", "no-store");
    return res.send("\ufeff" + [columns, ...rows.map((r) => columns.map((c) => r[c]))].map((r) => r.map(cell).join(",")).join("\r\n"));
  }
  if (format === "pdf") {
    const { renderAppPagePdf, sessionCookieFromHeader } = require("../utils/pdfService");
    const pdf = await renderAppPagePdf({ baseUrl: baseUrlOf(req), sessionCookie: sessionCookieFromHeader(req.headers.cookie), path: "/common/migration/roles/report?format=print", landscape: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="role-report.pdf"');
    res.setHeader("Cache-Control", "no-store");
    return res.send(pdf);
  }
  const { rows: [org] } = await db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [job.organization_id]);
  return res.render("migration/roleReport", { layout: false, rows: reportRows(report.people), school: org ? org.organization_name : "", job });
}

// Imported staff can't sign in until invited: this sends the usual invitation (a link to set a
// password, valid 3 days), to everyone waiting or to the ones ticked.
async function invitePost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job || job.status !== "live") return res.redirect("/");
  const ids = [].concat(req.body.userIds || []).map(toId).filter(Boolean);
  const invited = await m.inviteStaff(db, job, req.body.all === "1" ? null : ids, { baseUrl: baseUrlOf(req), actor: actorOf(req) });
  if (!invited.length) return done(req, res, { error: "Nobody is waiting for an invitation." }, "live");
  const organizationId = job.organization_id;
  setImmediate(async () => {
    const { sendInviteEmail } = require("./commonController");
    const school = ((await db.query("SELECT COALESCE(NULLIF(nickname, ''), organization_name) AS name FROM organizations WHERE organization_id = $1", [organizationId]).catch(() => ({ rows: [] }))).rows[0] || {}).name || "Your school";
    const sso = await require("../utils/sso/connections").inviteSignIn(db, organizationId).catch(() => null);
    for (const person of invited) {
      try {
        const names = await db.query(
          `SELECT (SELECT array_agg(DISTINCT c.class_name) FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = $1) AS classes,
                  (SELECT array_agg(DISTINCT s.subject_name) FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id WHERE us.user_id = $1) AS subjects`,
          [person.user_id]
        );
        const row = names.rows[0] || {};
        await sendInviteEmail(person.email, person.first_name, person.last_name, person.link, school, organizationId, row.classes || [], row.subjects || [], { sso });
      } catch (error) {
        console.error("[Migration] staff invitation:", error.message);
      }
    }
  });
  return done(req, res, null, "live", `Invitations are on their way to ${invited.length} ${invited.length === 1 ? "person" : "people"}.`);
}

// A student's records from the old system: academic record, attendance totals, extra fields,
// alerts and archives. Restricted ones only for the school's admins, after their code.
async function studentOldSystem(db, req, studentId) {
  if (!(await m.ready(db))) return null;
  const organizationId = orgOf(req);
  const admin = isOrgAdmin(req.session);
  const unlocked = admin && mfa.fresh(req);
  const [extras, alerts, archives, history, attendance] = await Promise.all([
    db.query("SELECT label, value, sensitive FROM record_extra_fields WHERE organization_id = $1 AND entity = 'student' AND record_id = $2 ORDER BY label", [organizationId, studentId]),
    db.query("SELECT label, text FROM student_alerts WHERE organization_id = $1 AND student_id = $2 ORDER BY alert_id", [organizationId, studentId]),
    db.query("SELECT archive_id, module, sensitive, jsonb_array_length(content) AS n FROM migration_archives WHERE organization_id = $1 AND student_id = $2 ORDER BY module", [organizationId, studentId]),
    db.query(
      `SELECT school_year, term, grade_level, course_number, course_name, grade, percent, gpa_points, credits_attempted, credits_earned, school_name
         FROM student_course_history WHERE organization_id = $1 AND student_id = $2 ORDER BY school_year, term, course_name`,
      [organizationId, studentId]
    ),
    db.query("SELECT school_year, term, days_present, days_absent, days_excused, days_tardy FROM student_attendance_totals WHERE organization_id = $1 AND student_id = $2 ORDER BY school_year, term", [organizationId, studentId]),
  ]);
  const restricted = extras.rows.filter((x) => x.sensitive).length + archives.rows.filter((a) => a.sensitive).length;
  const out = {
    extras: extras.rows.filter((x) => !x.sensitive || unlocked),
    archives: archives.rows.filter((a) => !a.sensitive || unlocked),
    alerts: alerts.rows,
    history: history.rows,
    attendance: attendance.rows,
    hidden: unlocked ? 0 : restricted,
    canUnlock: admin && !unlocked && restricted > 0,
    credits: history.rows.reduce((sum, r) => sum + Number(r.credits_earned || 0), 0),
    // The old system's GPA as it was exported: never worked out again.
    sourceGpa: await require("../utils/gpa").sourceGpaOf(db, organizationId, studentId).catch(() => null),
  };
  if (!out.extras.length && !out.alerts.length && !out.archives.length && !out.history.length && !out.attendance.length && !out.hidden && !out.sourceGpa) return null;
  return out;
}
async function archivePage(req, res, db) {
  const organizationId = orgOf(req);
  const { rows: [archive] } = await db.query("SELECT * FROM migration_archives WHERE organization_id = $1 AND archive_id = $2", [organizationId, toId(req.params.archiveId)]);
  // The school's own lists, and anything restricted, are for its admins, after their code.
  if (!archive || ((archive.sensitive || !archive.student_id) && !isOrgAdmin(req.session))) return res.status(404).send("Not found.");
  if (archive.sensitive && !mfa.fresh(req)) return res.redirect(verifyUrl(req.originalUrl).replace("embed=workspace&", ""));
  const rows = Array.isArray(archive.content) ? archive.content : [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  if (req.query.format === "csv") {
    const cell = (v) => { let t = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${archive.module.replace(/[^\w -]+/g, "").replace(/\s+/g, "-")}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    await m.event(db, { organizationId, actor: actorOf(req), action: "archive_downloaded", detail: { archiveId: archive.archive_id, sensitive: archive.sensitive }, ip: req.ip });
    return res.send("﻿" + [columns, ...rows.map((row) => columns.map((c) => row[c]))].map((r) => r.map(cell).join(",")).join("\r\n"));
  }
  let student = null;
  if (archive.student_id) student = (await db.query("SELECT first_name, last_name FROM students WHERE organization_id = $1 AND student_id = $2", [organizationId, archive.student_id])).rows[0];
  await m.event(db, { organizationId, actor: actorOf(req), action: "archive_viewed", detail: { archiveId: archive.archive_id, sensitive: archive.sensitive }, ip: req.ip });
  return res.render("migration/archive", { layout: false, archive, rows, columns, student });
}

// ── Super Admin ─────────────────────────────────────────────────────────────────────────
const adminActor = (req) => req.shardActor || req.session.userEmail || "Managira";
const adminSafeNext = (value) => (/^\/admin\/(migrations|backups)(\/[\w/-]*)?(\?[\w=&%-]*)?$/.test(String(value || "")) ? String(value) : "/admin/migrations");
// After the fresh password (requireFreshPassword), the authenticator code.
function adminCodeGate(req, res, next) {
  if (mfa.fresh(req)) return next();
  return res.redirect(`/admin/migrations/code?next=${encodeURIComponent(req.method === "GET" ? req.originalUrl : "/admin/migrations")}`);
}
async function adminCodePage(req, res, db) {
  if (!(await m.ready(db))) { req.flash("error", "Run the data migration database update first."); return res.redirect("/admin"); }
  const account = mfa.accountOf(req);
  const setUp = await mfa.isSetUp(db, account);
  res.render("migration/verify", {
    title: "Confirm it's you", messages: req.flash(), side: "admin", action: "/admin/migrations/code", next: adminSafeNext(req.query.next),
    setup: setUp ? null : await mfa.startSetup(db, account, mfa.labelOf(req)), needsPassword: false, recovery: null,
  });
}
async function adminCodePost(req, res, db) {
  const account = mfa.accountOf(req);
  const next = adminSafeNext(req.body.next);
  const again = () => res.redirect(`/admin/migrations/code?next=${encodeURIComponent(next)}`);
  if (!(await mfa.isSetUp(db, account))) {
    const result = await mfa.confirmSetup(db, account, req.body.code);
    if (result.error) { req.flash("error", result.error); return again(); }
    mfa.markFresh(req);
    require("../utils/shards/registry").audit(req, "authenticator_set_up");
    return res.render("migration/verify", { title: "Save your recovery codes", messages: {}, side: "admin", action: "/admin/migrations/code", next, setup: null, needsPassword: false, recovery: result.recovery });
  }
  const result = await mfa.verify(db, account, req.body.code);
  if (result.error) { require("../utils/shards/registry").audit(req, "code_check_failed"); req.flash("error", result.error); return again(); }
  mfa.markFresh(req);
  if (result.recoveryLeft !== undefined) req.flash("info", `You used a recovery code: ${result.recoveryLeft} left.`);
  return res.redirect(next);
}

async function adminQueue(req, res, db) {
  if (!(await m.ready(db))) { req.flash("error", "Run the data migration database update first."); return res.redirect("/admin"); }
  const [queue, needs] = await Promise.all([m.queue(db), m.needsAcrossSchools(db)]);
  res.render("admin/migrations", { title: "Migration queue", queue, needs, job: null, columns: [], events: [], messages: req.flash() });
}
// The school's open migration, or its last go-live while it can still be rolled back.
const adminJobOf = async (db, organizationId) => organizationId && ((await m.openJob(db, organizationId)) || (await m.rollbackJob(db, organizationId)));
async function adminJob(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const job = await adminJobOf(db, organizationId);
  if (!job) { req.flash("error", "That school has no open migration."); return res.redirect("/admin/migrations"); }
  const canRollBack = Boolean(job.live_at && !job.purged_at && ["live", "closed"].includes(job.status));
  const [columns, org, events, custom, preview, codes, roleReport] = await Promise.all([
    m.columnsOf(db, job),
    db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [organizationId]).then((r) => r.rows[0] || {}),
    db.query("SELECT actor, actor_kind, action, detail, at FROM migration_events WHERE job_id = $1 ORDER BY at DESC LIMIT 60", [job.job_id]).then((r) => r.rows),
    m.customFieldsOf(db, organizationId),
    canRollBack ? m.rollbackPreview(db, job) : Promise.resolve(null),
    mfa.forSchool(db, organizationId),
    m.roleReport(db, job),
  ]);
  await m.event(db, { jobId: job.job_id, organizationId, actor: adminActor(req), actorKind: "managira", action: "queue_opened" });
  res.render("admin/migrations", {
    title: `Migration: ${org.organization_name || ""}`, queue: [], needs: [], job, org, columns, events, custom, open: m.openItems(columns), messages: req.flash(),
    entities: m.ENTITIES, sensitiveLabels: m.SENSITIVE_LABELS, archiveModules: m.ARCHIVE_MODULES, targetLabel: m.targetLabel, preview, codes,
    roleReport, roleChoices: m.ROLES, roleLevels: m.LEVELS, pickable: m.pickableRoles(), accountTypes: m.ACCOUNT_TYPES,
  });
}
async function adminToggle(req, res, db) {
  const organizationId = toId(req.params.orgId);
  if (!organizationId || !(await m.ready(db))) return res.redirect("/admin/hubs");
  const on = req.params.what === "start";
  const result = on ? (await m.startJob(db, organizationId, adminActor(req)), { ok: true }) : await m.stopJob(db, organizationId, adminActor(req), { cancel: req.params.what === "cancel" });
  if (result.error) req.flash("error", result.error);
  else req.flash("success", on ? "Sandbox on. The school's admins see a Sandbox button in their header." : req.params.what === "cancel" ? "Migration cancelled and its data deleted." : "Sandbox off.");
  const fromHub = /^\/admin\/hubs\/\d+\/organizations$/.test(new URL(req.get("Referer") || "http://x/", "http://x").pathname) ? new URL(req.get("Referer"), "http://x").pathname : null;
  return res.redirect(on ? `/admin/migrations/${organizationId}` : fromHub || "/admin/hubs");
}
// A hub moving in: a sandbox for each of its schools that hasn't one.
async function adminHubStart(req, res, db) {
  const hubId = toId(req.params.hubId);
  if (!hubId || !(await m.ready(db))) return res.redirect("/admin/hubs");
  const { rows: [hub] } = await db.query("SELECT hub_name FROM managira_hubs WHERE hub_id = $1 AND deleted = false", [hubId]);
  if (!hub) { req.flash("error", "That hub doesn't exist."); return res.redirect("/admin/hubs"); }
  const result = await m.startHub(db, hubId, adminActor(req));
  require("../utils/shards/registry").audit(req, "migration_hub_sandbox_on", `hub:${hubId}`, result);
  if (!result.schools) req.flash("error", "This hub has no schools yet.");
  else req.flash("success", `Sandbox on for ${result.started} ${result.started === 1 ? "school" : "schools"} of ${hub.hub_name}${result.started < result.schools ? ` (${result.schools - result.started} already had one)` : ""}. Each school's managers see a Sandbox button in their header.`);
  return res.redirect(`/admin/hubs/${hubId}/organizations`);
}
async function adminResolve(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const job = organizationId && await m.openJob(db, organizationId);
  if (!job) return res.redirect("/admin/migrations");
  const result = await m.resolveColumn(db, job, toId(req.params.columnId), req.body, adminActor(req));
  if (result.error) req.flash("error", result.error); else req.flash("success", "Saved. Run the import again to fill it in on the records.");
  return res.redirect(`/admin/migrations/${organizationId}#col-${req.params.columnId}`);
}
async function adminImport(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const job = organizationId && await m.openJob(db, organizationId);
  if (!job || job.status === "live") return res.redirect("/admin/migrations");
  const result = await m.runImport(db, job, adminActor(req));
  if (result.error) req.flash("error", result.error); else req.flash("success", "Imported again: the new fields are filled in on the sandbox records.");
  return res.redirect(`/admin/migrations/${organizationId}`);
}
async function adminRoleResolve(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const job = organizationId && await m.openJob(db, organizationId);
  if (!job || job.status === "live") return res.redirect("/admin/migrations");
  const result = await m.resolveRole(db, job, toId(req.params.roleId), req.body, adminActor(req));
  if (result.error) req.flash("error", result.error); else req.flash("success", "Saved. The school sees the role's match in Staff roles.");
  return res.redirect(`/admin/migrations/${organizationId}#roles`);
}
// Roll back a go-live: the school's name typed exactly, on top of the password and the code.
async function adminRollback(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const job = organizationId && await m.rollbackJob(db, organizationId);
  if (!job) { req.flash("error", "There's no go-live to roll back for that school."); return res.redirect("/admin/migrations"); }
  const { rows: [org] } = await db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [organizationId]);
  const typed = String(req.body.confirm || "").trim().toLowerCase();
  if (!org || !typed || typed !== String(org.organization_name || "").trim().toLowerCase()) {
    req.flash("error", "Type the school's name exactly to roll back.");
    return res.redirect(`/admin/migrations/${organizationId}#rollback`);
  }
  try {
    const result = await m.rollback(db, job, adminActor(req));
    require("../utils/shards/registry").audit(req, "migration_rolled_back", `organization:${organizationId}`, { jobId: job.job_id });
    if (result.error) req.flash("error", result.error);
    else {
      const removed = Object.values(result.removed).reduce((sum, n) => sum + n, 0);
      req.flash("success", `Rolled back: ${removed} rows removed${result.restored ? `, ${result.restored} put back as they were` : ""}. The sandbox is open again and locked.${result.kept.length ? ` ${result.kept.length} ${result.kept.length === 1 ? "record the school has built on was" : "records the school has built on were"} kept (staff accounts on hold): see the activity.` : ""}`);
    }
  } catch (error) {
    console.error("[Migration] rollback:", error.message);
    req.flash("error", "The rollback stopped and nothing was changed. Try again.");
  }
  return res.redirect(`/admin/migrations/${organizationId}`);
}
async function adminCodeReset(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const account = { kind: req.params.kind, id: toId(req.params.accountId) };
  const { rows } = await db.query("SELECT 1 FROM account_mfa WHERE account_kind = $1 AND account_id = $2 AND organization_id = $3", [account.kind, account.id, organizationId]);
  if (rows.length && await mfa.reset(db, account)) {
    await m.event(db, { organizationId, actor: adminActor(req), actorKind: "managira", action: "authenticator_reset", detail: account });
    require("../utils/shards/registry").audit(req, "authenticator_reset", `organization:${organizationId}`, account);
    req.flash("success", "Their authenticator was reset. They set it up again the next time they open the migration.");
  }
  return res.redirect(`/admin/migrations/${organizationId}#codes`);
}

const wrap = (fn) => async (req, res, db) => {
  try { return await fn(req, res, db); } catch (error) {
    console.error("[Migration]", error.message);
    req.flash("error", "Something went wrong. Try again.");
    return res.redirect(req.originalUrl.startsWith("/admin") ? "/admin/migrations" : "/");
  }
};
module.exports = {
  codeGate, verifyPage: wrap(verifyPage), verifyPost: wrap(verifyPost),
  page: wrap(page), uploadHandler, uploadPost: wrap(uploadPost), confirmPost: wrap(confirmPost), notesPost: wrap(notesPost), excludePost: wrap(excludePost),
  legalPost: wrap(legalPost), importPost: wrap(importPost), approvePost: wrap(approvePost), signPost: wrap(signPost), goLivePost, catchUpPost, invitePost: wrap(invitePost),
  roleConfirmPost: wrap(roleConfirmPost), roleNotesPost: wrap(roleNotesPost), roleApprovePost: wrap(roleApprovePost), roleReportFile: wrap(roleReportFile),
  archivePage: wrap(archivePage), studentOldSystem,
  adminCodeGate, adminCodePage: wrap(adminCodePage), adminCodePost: wrap(adminCodePost),
  adminQueue: wrap(adminQueue), adminJob: wrap(adminJob), adminToggle: wrap(adminToggle), adminResolve: wrap(adminResolve), adminImport: wrap(adminImport),
  adminRollback: wrap(adminRollback), adminCodeReset: wrap(adminCodeReset), adminRoleResolve: wrap(adminRoleResolve), adminHubStart: wrap(adminHubStart),
};
