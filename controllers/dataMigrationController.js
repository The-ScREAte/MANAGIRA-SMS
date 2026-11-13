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

// preservePath: a file chosen in a folder keeps its path, so a student's documents find them.
const upload = multer({ storage: multer.memoryStorage(), preservePath: true, limits: { fileSize: m.MAX_FILE_BYTES, files: m.MAX_UPLOAD_FILES } });
const orgOf = (req) => Number(req.session.organizationId);
const toId = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const userIdOf = (req) => req.session.userId || req.session.user?.user_id || null;
const actorOf = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(" ") || req.session.userEmail || req.session.user?.email || "School admin";
const STEPS = ["upload", "map", "notes", "check", "roles", "review", "live"]; // the order a school works in
const HUB_URL = (step) => `/common/management?panel=migration&page=${encodeURIComponent(`/common/migration${step ? `?step=${step}` : ""}`)}&label=${encodeURIComponent("Data migration")}`;
const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

// ── The authenticator code (school side) ────────────────────────────────────────────────
// Where the code page may send someone back to: the migration's pages and the student page.
const safeNext = (value) => (/^\/common\/(migration|studentDetails|management)(\/[\w/-]*)?(\?[\w=&%.+-]*)?$/.test(String(value || "")) ? String(value) : "/common/migration?embed=workspace");
const verifyUrl = (next) => `/common/migration/verify?embed=workspace&next=${encodeURIComponent(next)}`;
// Every migration page and action needs a code from the last 30 minutes.
function codeGate(req, res, next) {
  if (mfa.passed(req)) return next();
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
  if (!mfa.needed(req)) return res.redirect(safeNext(req.query.next)); // codes are switched off
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
// Long work runs in the background (utils/migration/tasks.js); while it does, nothing else changes the migration.
const waitFor = async (db, job) => {
  const open = await m.busyTask(db, job);
  return open ? `Wait until "${m.TASK_LABELS[open.kind]}" finishes: it's running now.` : null;
};
const wantsJson = (req) => /application\/json/.test(String(req.get("accept") || ""));
// Where each task's result is seen.
const NEXT_STEP = { read_files: "map", import: "check", go_live: "live", catch_up: "live" };
const done = (req, res, result, step, ok) => {
  if (result && result.error) req.flash("error", result.error);
  else if (ok) req.flash("success", ok);
  return back(req, res, step);
};

// Before Managira opens a migration, the page is a request (managers only, no code asked):
// prefilled with the person's own details, and once sent, where it stands.
const REQUEST_FIELDS = ["system", "otherSystem", "students", "staff", "bring", "timing", "preferredDate", "contactName", "contactEmail", "contactPhone", "notes"];
async function requestPage(req, res, db) {
  const organizationId = orgOf(req);
  const userId = userIdOf(req);
  const [request, me, org] = await Promise.all([
    m.latestRequest(db, organizationId),
    userId && req.session.accountType !== "organization"
      ? db.query("SELECT first_name, last_name, email, phone_number FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]).then((r) => r.rows[0] || null)
      : Promise.resolve(null),
    db.query("SELECT organization_name, email, organization_phone FROM organizations WHERE organization_id = $1", [organizationId]).then((r) => r.rows[0] || {}),
  ]);
  const draft = req.session.migrationRequestForm || null;
  delete req.session.migrationRequestForm;
  const form = draft || {
    contactName: me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : "",
    contactEmail: (me && me.email) || org.email || "",
    contactPhone: (me && me.phone_number) || org.organization_phone || "",
  };
  res.render("migration/request", {
    title: "Data migration", isEmbedded: true, hideGlobalHeader: true, hideGlobalFooter: true, hideGlobalChatbot: true, messages: req.flash(),
    request, form, schoolName: org.organization_name || "", codes: mfa.neededFor(organizationId), systems: m.SYSTEMS, timings: m.TIMINGS, bring: m.BRING, guideUrl: "/legal/user-documentation/moving-to-managira",
  });
}
async function requestPost(req, res, db) {
  if (!(await allowedHere(req, db))) return res.redirect("/");
  const result = await m.requestMove(db, orgOf(req), req.body || {}, { userId: userIdOf(req), actor: actorOf(req), role: req.session.accountType === "organization" ? "School account" : "Manager" });
  if (result.error) {
    req.session.migrationRequestForm = Object.fromEntries(REQUEST_FIELDS.map((k) => [k, Array.isArray(req.body[k]) ? req.body[k].map(String) : String(req.body[k] || "").slice(0, 2000)]));
    req.flash("error", result.error);
  } else {
    req.flash("success", `Request sent. We've emailed a copy to ${result.request.contact_email}; our migration team will be in touch within two business days.`);
  }
  return res.redirect("/common/migration?embed=workspace");
}
// The school ticks which student columns become custom fields; the import runs again with it.
async function customFieldsPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const wait = await waitFor(db, job);
  if (wait) return done(req, res, { error: wait }, "map");
  // Where each field lives: section_<column> and app_<column> (never a bare number as a key).
  const homes = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    const at = /^section_(\d+)$/.exec(key);
    if (at) homes[at[1]] = { section: String(value), onApplication: Boolean(req.body[`app_${at[1]}`]) };
  }
  const result = await m.setCustomFields(db, job, [].concat(req.body.columns || []), actorOf(req), homes);
  const reimport = result.changed && job.status !== "live"; // once live, Apply again loads it
  if (reimport) await m.startTask(db, job, "import", actorOf(req));
  req.flash("success", reimport ? "Saved. Importing again with your choice." : job.status === "live" ? "Saved. Apply again on the Go live step to load it." : "Saved.");
  return res.redirect("/common/migration?step=map&embed=workspace");
}
// A choice for the whole migration (meal balances: kept in the meal app, or moved into PayGira).
async function optionPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const result = await m.setOption(db, job, String(req.body.key || ""), String(req.body.value || ""), actorOf(req));
  if (result.error) req.flash("error", result.error);
  else req.flash("success", req.body.value === "paygira" ? "Meal balances will move into PayGira when you go live." : "Meal balances stay in your meal app.");
  return res.redirect("/common/migration?step=check&embed=workspace");
}
// The lists the school keeps using in Managira (a form each) and those kept as history.
async function listUsePost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const result = await m.setListUse(db, job, req.body.shown, req.body.forms, actorOf(req));
  if (result.error) req.flash("error", result.error);
  else req.flash("success", job.status === "live" ? "Saved. Apply again on the Go live step to make them." : `Saved: ${result.forms} ${result.forms === 1 ? "list becomes a form" : "lists become forms"} when you go live.`);
  return res.redirect("/common/migration?step=check&embed=workspace");
}
async function matchPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const wait = await waitFor(db, job);
  if (wait) { req.flash("error", wait); return res.redirect("/common/migration?step=review&embed=workspace"); }
  const result = await m.decideMatch(db, job, req.body || {}, actorOf(req));
  if (result.error) req.flash("error", result.error);
  return res.redirect(`/common/migration?step=review&embed=workspace#matches`);
}
async function withdrawPost(req, res, db) {
  if (!(await allowedHere(req, db))) return res.redirect("/");
  const result = await m.withdrawRequest(db, orgOf(req), actorOf(req));
  req.flash(result.error ? "error" : "success", result.error || "Request withdrawn. You can send a new one at any time.");
  return res.redirect("/common/migration?embed=workspace");
}

async function page(req, res, db) {
  if (!(await allowedHere(req, db))) { req.flash("error", "Data migration is for your school's managers."); return res.redirect("/"); }
  if (!isEmbeddedRequest(req, "migration") && String(req.get("Sec-Fetch-Dest") || "") !== "iframe") return res.redirect(HUB_URL(req.query.step));
  const job = await m.openJob(db, orgOf(req));
  if (!job) return requestPage(req, res, db);
  // Once Managira has opened it, every visit needs an authenticator code from the last 30 minutes.
  if (!mfa.passed(req)) return res.redirect(verifyUrl(req.originalUrl));
  // Each step reads only what it shows (a large school's sandbox is tens of thousands of rows):
  // the lists on Upload, Check and Review; the column matches on Match columns, Columns to explain
  // and Review; the activity on Review and Go live. Elsewhere a yes/no says whether anything is uploaded.
  const asked = STEPS.includes(req.query.step) ? req.query.step : null;
  const wants = (...steps) => !asked || steps.includes(asked);
  const skip = (value) => Promise.resolve(value);
  const [listed, anyUploaded, columns, custom, events, task] = await Promise.all([
    wants("upload", "check", "review") ? m.currentFiles(db, job) : skip(null),
    wants("upload", "check", "review") ? skip(null)
      : db.query("SELECT EXISTS (SELECT 1 FROM migration_files WHERE job_id = $1 AND replaced_at IS NULL AND content IS NOT NULL) AS any", [job.job_id]).then((r) => r.rows[0].any),
    wants("map", "notes", "review") ? m.columnsOf(db, job) : skip([]),
    asked === "map" ? m.customFieldsOf(db, job.organization_id) : skip([]),
    skip([]), // the activity log is kept for the Migration queue, not shown here
    m.taskStatus(db, job),
  ]);
  const files = listed || [];
  const anyFiles = listed ? listed.length > 0 : Boolean(anyUploaded);
  const open = m.openItems(columns);
  const progress = await m.stepProgress(db, job, { anyFiles, task });
  const step = asked || (job.status === "live" ? "live" : progress.next);
  const on = (...steps) => steps.includes(step);
  // A finished go-live or catch-up is news only while the school is live (not after a rollback).
  // A task that finished well shows only on its own step (reading on Upload, the import on Check,
  // the go-live on Go live); one running or failed shows on every step.
  const TASK_STEP = { read_files: "upload", import: "check", go_live: "live", catch_up: "live" };
  const shownTask = !task ? null
    : task.open || task.status === "failed" ? task
    : ["go_live", "catch_up"].includes(task.kind) && job.status !== "live" ? null
    : TASK_STEP[task.kind] && TASK_STEP[task.kind] !== step ? null : task;
  const none = (value) => Promise.resolve(value);
  const [sandbox, check, staff, roleReport, gpaCheck, matches, docs, uploads, transportOn, ownRoles] = await Promise.all([
    on("check", "review") ? m.sandboxSummary(db, job) : none({ counts: {}, sample: [] }),
    on("review", "live", "check") ? m.blockers(db, job) : none({ list: [], needed: [] }),
    on("live") && job.status === "live" ? m.staffAccounts(db, job) : none([]),
    on("roles") ? m.roleReport(db, job) : none({ roles: [], people: [], open: {} }),
    // Each student's GPA from PowerSchool beside Managira's working, where the step shows it.
    on("review", "live") ? m.gpaCheck(db, job) : none(null),
    // Who is already in Managira, and the questions the school answers before signing.
    on("review") && files.some((f) => f.entity === "students") ? m.liveMatches(db, job) : none(null),
    on("upload", "check") ? m.documentsOf(db, job) : none(null),
    on("upload", "live") ? db.query("SELECT upload_id, file_name, size_bytes, status, error, result, uploaded_by, created_at, read_at FROM migration_uploads WHERE job_id = $1 ORDER BY upload_id DESC LIMIT 3000", [job.job_id]).then((r) => r.rows) : none([]),
    // Whether the school uses Transportation (Go live says so when its buses came in while it's off).
    on("live") && job.status === "live" ? require("../utils/integrationSwitches").isOn(db, job.organization_id, "transportation").catch(() => true) : none(true),
    // The school's own roles (Users › Add user › Add a role), offered for its old roles; never one based on Manager.
    on("roles") ? require("../utils/schoolRoles").list(db, job.organization_id).then((list) => list.filter((r) => r.base_type !== "Manager")).catch(() => []) : none([]),
  ]);
  res.render("migration/school", {
    title: "Data migration", isEmbedded: true, hideGlobalHeader: true, hideGlobalFooter: true, hideGlobalChatbot: true, messages: req.flash(),
    job, step, steps: STEPS, progress, files, anyFiles, columns, custom, sandbox, open, blockers: check.list, needed: check.needed, events, staff, roleReport, roleChoices: m.ROLES, roleLevels: m.LEVELS, ownRoles, ownRolesOn: require("../utils/schoolRoles").on(job.organization_id), gpaCheck,
    // The other apps the school ran (library, food service, health office…), from its lists' names.
    listFeatures: require("../utils/migration/features").FEATURES,
    indicatorLabels: require("../utils/studentFormFields").INDICATORS.map((i) => i.label),
    suggestHome: require("../utils/studentFormFields").suggestHome,
    fieldHomes: Object.fromEntries(Object.entries(require("../utils/studentFormFields").SECTIONS).filter(([key]) => key !== "guardian")),
    transportOn,
    // Lists the school keeps using become forms in the Custom editor (where the school has it).
    formsOn: on("check", "live") ? require("../utils/customForms").featureOn(job.organization_id) && (await require("../utils/customForms").ready(db)) : false,
    topicOrder: require("../utils/migration/forms").TOPIC_ORDER,
    apps: on("check", "live") ? require("../utils/migration/apps").appsFrom(((job.totals && job.totals.report) || {}).lists, { areaLabels: Object.fromEntries(require("../utils/apiAccess").API_AREAS.map((a) => [a.key, a.label])) }) : [], matches, task: shownTask, docs, uploads, nextStep: NEXT_STEP, fieldChoices: m.fieldChoices(columns), fieldTypeOf: m.fieldTypeOf, maxFileMb: m.MAX_FILE_BYTES / 1048576, maxFiles: m.MAX_UPLOAD_FILES,
    entities: m.ENTITIES, sections: m.SECTIONS, sectionLabels: m.SECTION_LABELS, sensitiveLabels: m.SENSITIVE_LABELS, noteKeys: m.NOTE_KEYS,
    summary: m.summary(columns, custom), targetLabel: m.targetLabel,
  });
}

const uploadHandler = (req, res, next) => upload.array("files", m.MAX_UPLOAD_FILES)(req, res, (error) => {
  if (!error) return next();
  const message = error.code === "LIMIT_FILE_SIZE" ? `Files can be up to ${m.MAX_FILE_BYTES / 1048576} MB each. Export a large list in parts.`
    : error.code === "LIMIT_FILE_COUNT" ? `Up to ${m.MAX_UPLOAD_FILES} files in one go without the page's script: choose them on the page, which sends any number.` : "The files couldn't be uploaded. Try again.";
  if (wantsJson(req)) return res.status(400).json({ ok: false, error: message });
  req.flash("error", message);
  return back(req, res, "upload");
});
async function uploadPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  const reply = (status, body, step) => {
    if (wantsJson(req)) return res.status(status).json(body);
    if (body.error) req.flash("error", body.error);
    (body.refused || []).forEach((r) => req.flash("error", r));
    if (body.ok && body.message) req.flash("info", body.message);
    return back(req, res, step);
  };
  if (!job) return reply(403, { ok: false, error: "There's no data migration open for your school." }, "upload");
  const step = job.status === "live" ? "live" : "upload";
  const files = req.files || [];
  if (!files.length) return reply(400, { ok: false, error: "Choose the files to upload." }, step);
  // Files go on being read while more arrive; anything else running comes first.
  const open = await m.busyTask(db, job);
  if (open && open.kind !== "read_files") return reply(409, { ok: false, error: await waitFor(db, job) }, step);
  // Files the school chose together come in batches with one group: they're kept together.
  const group = /^[A-Za-z0-9-]{8,64}$/.test(String(req.body.group || "")) ? String(req.body.group) : null;
  const { stored, refused } = await m.storeUploads(db, job, files, { entity: req.body.entity, actor: actorOf(req), group });
  if (!stored.length) return reply(400, { ok: false, error: refused[0] || "Nothing could be uploaded.", refused: refused.slice(1) }, step);
  if (!open) await m.startTask(db, job, "read_files", actorOf(req));
  const message = stored.length === 1 ? `Uploaded ${stored[0].file_name}. It's being read now.` : `Uploaded ${stored.length} files. They're being read now.`;
  return reply(200, { ok: true, message, refused, next: `/common/migration?step=${step}&embed=workspace` }, step);
}
// Where the school's background task is, for its progress card.
async function taskPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.status(404).json({ task: null });
  res.set("Cache-Control", "no-store");
  const task = await m.taskStatus(db, job);
  return res.json({ task, next: task && !task.open ? `/common/migration?step=${task.status === "failed" && task.kind === "go_live" ? "review" : NEXT_STEP[task.kind] || "upload"}&embed=workspace` : null });
}

const columnAction = (fn, step) => async (req, res, db) => {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const wait = await waitFor(db, job);
  if (wait) return done(req, res, { error: wait }, step);
  return done(req, res, await fn(job, req), step, "Saved.");
};
const confirmPost = (req, res, db) => columnAction((job) => m.confirmColumn(db, job, toId(req.params.columnId), String(req.body.target || ""), actorOf(req)), "map")(req, res, db);
const notesPost = (req, res, db) => columnAction((job) => m.saveNotes(db, job, toId(req.params.columnId), req.body, actorOf(req)), "notes")(req, res, db);
const excludePost = (req, res, db) => columnAction((job) => m.approveExclude(db, job, toId(req.params.columnId), userIdOf(req), actorOf(req)), "notes")(req, res, db);
const legalPost = (req, res, db) => columnAction((job) => m.legalNeed(db, job, toId(req.params.columnId), userIdOf(req), actorOf(req)), "notes")(req, res, db);

// Import, go live and the catch-up start a background task; the page follows it.
const startFor = (kind, step, allowed) => async (req, res, db) => {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const refusal = allowed(job);
  if (refusal) return done(req, res, { error: refusal }, step);
  const started = await m.startTask(db, job, kind, actorOf(req));
  if (started.busy) return done(req, res, { error: await waitFor(db, job) || "It's already running." }, step);
  return back(req, res, step);
};
const importPost = startFor("import", "check", (job) => (job.status === "live" ? "You're live: use the catch-up instead." : null));
const goLivePost = startFor("go_live", "live", (job) => (job.status !== "review" || !job.signed_at ? "Sign the migration summary first." : null));
const catchUpPost = startFor("catch_up", "live", (job) => (job.status !== "live" ? "Applying again is for after go-live." : null));
async function approvePost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const wait = await waitFor(db, job);
  if (wait) return done(req, res, { error: wait }, "review");
  return done(req, res, await m.approveSection(db, job, String(req.body.section || ""), req.body.on === "1", actorOf(req)), "review");
}
async function signPost(req, res, db) {
  const job = await schoolContext(req, res, db);
  if (!job || job.status === "live") return res.redirect("/");
  const wait = await waitFor(db, job);
  if (wait) return done(req, res, { error: wait }, "review");
  return done(req, res, await m.sign(db, job, req.body.name, userIdOf(req), actorOf(req)), "review", "Signed. You can go live when you're ready.");
}
// ── Staff roles ──
const roleAction = (fn) => async (req, res, db) => {
  const job = await schoolContext(req, res, db);
  if (!job) return res.redirect("/");
  const wait = await waitFor(db, job);
  if (wait) return done(req, res, { error: wait }, "roles");
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
  const unlocked = admin && mfa.passed(req);
  const [extras, alerts, archives, history, attendance, docs, forms] = await Promise.all([
    db.query("SELECT label, value, sensitive FROM record_extra_fields WHERE organization_id = $1 AND entity = 'student' AND record_id = $2 ORDER BY label", [organizationId, studentId]),
    db.query("SELECT label, text FROM student_alerts WHERE organization_id = $1 AND student_id = $2 ORDER BY alert_id", [organizationId, studentId]),
    db.query("SELECT archive_id, module, sensitive, jsonb_array_length(content) AS n FROM migration_archives WHERE organization_id = $1 AND student_id = $2 ORDER BY module", [organizationId, studentId]),
    db.query(
      `SELECT school_year, term, grade_level, course_number, course_name, grade, percent, gpa_points, credits_attempted, credits_earned, school_name
         FROM student_course_history WHERE organization_id = $1 AND student_id = $2 ORDER BY school_year, term, course_name`,
      [organizationId, studentId]
    ),
    db.query("SELECT school_year, term, days_present, days_absent, days_excused, days_tardy FROM student_attendance_totals WHERE organization_id = $1 AND student_id = $2 ORDER BY school_year, term", [organizationId, studentId]),
    db.query("SELECT document_id, file_name, kind, restricted, size_bytes, content_type FROM migration_documents WHERE organization_id = $1 AND student_id = $2 ORDER BY kind, file_name", [organizationId, studentId]).catch(() => ({ rows: [] })),
    // Lists the school keeps using: forms of the Custom editor with this student's entries.
    db.query(
      `SELECT s.section_id, s.name, s.icon, s.protected, COUNT(e.entry_id)::int AS n FROM custom_sections s JOIN custom_section_entries e ON e.section_id = s.section_id AND e.student_id = $2
        WHERE s.organization_id = $1 AND s.status <> 'archived' AND s.options->'origin'->>'kind' = 'old_system' GROUP BY s.section_id ORDER BY LOWER(s.name)`,
      [organizationId, studentId]
    ).catch(() => ({ rows: [] })),
  ]);
  const restricted = extras.rows.filter((x) => x.sensitive).length + archives.rows.filter((a) => a.sensitive).length + docs.rows.filter((d) => d.restricted).length;
  const topicOf = require("../utils/migration/forms").topicOf;
  const out = {
    extras: extras.rows.filter((x) => !x.sensitive || unlocked),
    archives: archives.rows.filter((a) => !a.sensitive || unlocked).map((a) => ({ ...a, topic: topicOf(a.module) })),
    // A protected form opens only for the people who build forms; the school's admins see it listed.
    forms: forms.rows.filter((f) => !f.protected || admin).map((f) => ({ ...f, topic: topicOf(f.name) })),
    topicOrder: require("../utils/migration/forms").TOPIC_ORDER,
    documents: docs.rows.filter((d) => !d.restricted || unlocked),
    alerts: alerts.rows,
    history: history.rows,
    attendance: attendance.rows,
    hidden: unlocked ? 0 : restricted,
    canUnlock: admin && !unlocked && restricted > 0,
    credits: history.rows.reduce((sum, r) => sum + Number(r.credits_earned || 0), 0),
    // The old system's GPA as it was exported: never worked out again.
    sourceGpa: await require("../utils/gpa").sourceGpaOf(db, organizationId, studentId).catch(() => null),
  };
  if (!out.extras.length && !out.alerts.length && !out.archives.length && !out.documents.length && !out.forms.length && !out.history.length && !out.attendance.length && !out.hidden && !out.sourceGpa) return null;
  return out;
}
async function archivePage(req, res, db) {
  const organizationId = orgOf(req);
  const { rows: [archive] } = await db.query("SELECT * FROM migration_archives WHERE organization_id = $1 AND archive_id = $2", [organizationId, toId(req.params.archiveId)]);
  // The school's own lists, and anything restricted, are for its admins, after their code.
  if (!archive || ((archive.sensitive || !archive.student_id) && !isOrgAdmin(req.session))) return res.status(404).send("Not found.");
  if (archive.sensitive && !mfa.passed(req)) return res.redirect(verifyUrl(req.originalUrl).replace("embed=workspace&", ""));
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

// Records from the old system that aren't one student's (lists kept for the school, documents
// with no current student), and what's on students' records. The school's managers only.
async function oldRecords(req, res, db) {
  if (!orgOf(req) || !isOrgAdmin(req.session) || !(await m.ready(db))) return res.redirect("/");
  const organizationId = orgOf(req);
  const [schoolLists, studentLists, looseDocs, docCounts] = await Promise.all([
    db.query("SELECT archive_id, module, sensitive, jsonb_array_length(content) AS n FROM migration_archives WHERE organization_id = $1 AND student_id IS NULL ORDER BY module", [organizationId]).then((r) => r.rows),
    db.query("SELECT module, BOOL_OR(sensitive) AS sensitive, COUNT(*)::int AS students, SUM(jsonb_array_length(content))::int AS n FROM migration_archives WHERE organization_id = $1 AND student_id IS NOT NULL GROUP BY module ORDER BY module", [organizationId]).then((r) => r.rows),
    db.query(
      `SELECT d.document_id, d.file_name, d.kind, d.student_source_id, d.restricted, d.size_bytes FROM migration_documents d JOIN migration_jobs j ON j.job_id = d.job_id
        WHERE d.organization_id = $1 AND d.student_id IS NULL AND j.live_at IS NOT NULL ORDER BY d.student_source_id NULLS LAST, d.path LIMIT 1000`,
      [organizationId]
    ).then((r) => r.rows),
    db.query("SELECT COUNT(*) FILTER (WHERE student_id IS NOT NULL)::int AS \"onStudents\" FROM migration_documents WHERE organization_id = $1", [organizationId]).then((r) => r.rows[0]),
  ]);
  // The lists the school keeps using: forms of the Custom editor.
  const forms = await db.query(
    `SELECT s.section_id, s.name, s.protected, COUNT(e.entry_id)::int AS entries, COUNT(DISTINCT e.student_id)::int AS students
       FROM custom_sections s LEFT JOIN custom_section_entries e ON e.section_id = s.section_id
      WHERE s.organization_id = $1 AND s.status <> 'archived' AND s.options->'origin'->>'kind' = 'old_system' GROUP BY s.section_id ORDER BY LOWER(s.name)`,
    [organizationId]
  ).then((r) => r.rows).catch(() => []);
  const topicOf = require("../utils/migration/forms").topicOf;
  for (const list of [...schoolLists, ...studentLists]) list.topic = topicOf(list.module);
  res.render("migration/oldRecords", {
    title: "Records from your old system", isEmbedded: true, hideGlobalHeader: true, hideGlobalFooter: true, hideGlobalChatbot: true,
    schoolLists, studentLists, looseDocs, docCounts, forms, topicOrder: require("../utils/migration/forms").TOPIC_ORDER,
  });
}
// A document from the old system. Before go-live (no student yet) and when restricted: the school's
// admins, after their code. On a student's record and not restricted: staff who may open students.
async function documentFile(req, res, db) {
  const organizationId = orgOf(req);
  const { rows: [doc] } = await db.query("SELECT * FROM migration_documents WHERE organization_id = $1 AND document_id = $2", [organizationId, toId(req.params.documentId)]);
  if (!doc || ((doc.restricted || !doc.student_id) && !isOrgAdmin(req.session))) return res.status(404).send("Not found.");
  if ((doc.restricted || !doc.student_id) && !mfa.passed(req)) return res.redirect(verifyUrl(req.originalUrl).replace("embed=workspace&", ""));
  const content = await require("../utils/migration/documents").read(doc);
  const inline = require("../utils/migration/documents").INLINE.has(doc.content_type) && req.query.download !== "1";
  res.setHeader("Content-Type", inline ? doc.content_type : "application/octet-stream");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${String(doc.file_name).replace(/[^\w .-]+/g, "_")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  await m.event(db, { organizationId, actor: actorOf(req), action: "document_viewed", detail: { documentId: Number(doc.document_id), restricted: doc.restricted }, ip: req.ip });
  return res.send(content);
}

// ── Super Admin ─────────────────────────────────────────────────────────────────────────
const adminActor = (req) => req.shardActor || req.session.userEmail || "Managira";
const adminSafeNext = (value) => (/^\/admin\/(migrations|backups)(\/[\w/-]*)?(\?[\w=&%-]*)?$/.test(String(value || "")) ? String(value) : "/admin/migrations");
// After the fresh password (requireFreshPassword), the authenticator code.
function adminCodeGate(req, res, next) {
  if (mfa.passed(req)) return next();
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
  const [queue, needs, requests] = await Promise.all([m.queue(db), m.needsAcrossSchools(db), m.listRequests(db)]);
  res.render("admin/migrations", { title: "Migration queue", queue, needs, requests, job: null, columns: [], events: [], messages: req.flash() });
}
// A school's request: in touch, approved (its migration opens and its managers are emailed), or declined.
async function adminRequestDecide(req, res, db) {
  const requestId = toId(req.params.requestId);
  if (!requestId || !(await m.ready(db))) return res.redirect("/admin/migrations");
  const what = req.params.what;
  const result = await m.decideRequest(db, requestId, what, req.body && req.body.note, adminActor(req));
  if (result.error) { req.flash("error", result.error); return res.redirect("/admin/migrations"); }
  require("../utils/shards/registry").audit(req, `migration_request_${what}`, `org:${result.request.organization_id}`, { requestId });
  if (what === "approve") {
    req.flash("success", "Approved. Their migration is open, and their managers were emailed how to start.");
    return res.redirect(`/admin/migrations/${result.request.organization_id}`);
  }
  req.flash("success", what === "contacted" ? "Marked as in touch." : "Declined. The school was emailed your note.");
  return res.redirect("/admin/migrations#requests");
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
  const started = await m.startTask(db, job, "import", adminActor(req));
  if (started.busy) req.flash("error", `Wait until "${m.TASK_LABELS[started.busy.kind]}" finishes for this school.`);
  else req.flash("success", "Importing again in the background: the new fields fill in on the sandbox records in a moment.");
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
// Empty a sandbox that isn't live and keep it open (the school uploads again): the school's name typed exactly.
async function adminStartOver(req, res, db) {
  const organizationId = toId(req.params.orgId);
  const { rows: [org] } = organizationId ? await db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [organizationId]) : { rows: [] };
  const typed = String(req.body.confirm || "").trim().toLowerCase();
  if (!org || !typed || typed !== String(org.organization_name || "").trim().toLowerCase()) {
    req.flash("error", "Type the school's name exactly to start over.");
    return res.redirect(`/admin/migrations/${organizationId}#start-over`);
  }
  const result = await m.startOver(db, organizationId, adminActor(req));
  if (result.error) req.flash("error", result.error);
  else {
    require("../utils/shards/registry").audit(req, "migration_started_over", `organization:${organizationId}`, result.removed);
    const r = result.removed;
    req.flash("success", `Started over: ${r.migration_uploads} uploads, ${r.migration_files} lists, ${Number(r.migration_records).toLocaleString("en-US")} records and ${r.migration_documents} documents removed. The sandbox is open and empty.`);
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
  page: wrap(page), optionPost: wrap(optionPost), listUsePost: wrap(listUsePost), matchPost: wrap(matchPost), customFieldsPost: wrap(customFieldsPost), requestPost: wrap(requestPost), withdrawPost: wrap(withdrawPost), uploadHandler, uploadPost: wrap(uploadPost), confirmPost: wrap(confirmPost), notesPost: wrap(notesPost), excludePost: wrap(excludePost),
  legalPost: wrap(legalPost), importPost: wrap(importPost), approvePost: wrap(approvePost), signPost: wrap(signPost), goLivePost: wrap(goLivePost), catchUpPost: wrap(catchUpPost), taskPost: wrap(taskPost), invitePost: wrap(invitePost),
  roleConfirmPost: wrap(roleConfirmPost), roleNotesPost: wrap(roleNotesPost), roleApprovePost: wrap(roleApprovePost), roleReportFile: wrap(roleReportFile),
  archivePage: wrap(archivePage), documentFile: wrap(documentFile), oldRecords: wrap(oldRecords), studentOldSystem,
  adminCodeGate, adminCodePage: wrap(adminCodePage), adminCodePost: wrap(adminCodePost),
  adminQueue: wrap(adminQueue), adminJob: wrap(adminJob), adminToggle: wrap(adminToggle), adminResolve: wrap(adminResolve), adminImport: wrap(adminImport),
  adminRequestDecide: wrap(adminRequestDecide), adminRollback: wrap(adminRollback), adminStartOver: wrap(adminStartOver), adminCodeReset: wrap(adminCodeReset), adminRoleResolve: wrap(adminRoleResolve), adminHubStart: wrap(adminHubStart),
};
