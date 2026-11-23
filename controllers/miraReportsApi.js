// Report-card remarks for each student, and which uploaded signature each class's report cards
// carry - for Mira (routes/internalApiRoute.js). The same rules as the pages:
//   remarks     the report card's Teacher / Conduct / Attitude / Interest remarks for a student in
//               a class and term (commonController.saveStudentTeacherRemark): managers and other
//               elevated roles for any class, everyone else only for classes assigned to them;
//               up to 500 characters each.
//   signatures  Report Settings › signatures (printController.addClassesToSignature): needs
//               Report Settings; only a signature already uploaded to the school, never an
//               obsolete one; it replaces the signature those classes had.
// Changes come back as a preview first (status confirmation_required) and run only with confirm.
const db = require("../config/db");
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { REPORT_SIGNATURE_TERM_ID, ensurePersistentReportSignatures } = require("../utils/reportSignature");
const { obsoleteSignaturePaths } = require("../utils/obsolete");

const ELEVATED = new Set(["manager", "supervisor", "admin", "organization", "mini admin"]);
const MAX_STUDENTS = 60;
const MAX_REMARK = 500;
const FIELDS = { teacher: "teacher_remarks", conduct: "conduct_remarks", attitude: "attitude_remarks", interest: "interest_remarks" };

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function actorFrom(src) {
  const organizationId = parseInt(src.organizationId, 10);
  if (!Number.isInteger(organizationId)) throw new ApiError(400, "organizationId is required.");
  if (src.viewerType && src.viewerType !== "staff") throw new ApiError(403, "Staff only.", "PERMISSION_DENIED");
  const role = String(src.userRole || "").trim().toLowerCase();
  const type = String(src.accountType || "").trim().toLowerCase();
  if (role === "driver" || type === "driver") throw new ApiError(403, "Drivers don't work with report cards.", "PERMISSION_DENIED");
  const userId = parseInt(src.userId, 10) || null;
  return { organizationId, userId, userRole: src.userRole, accountType: src.accountType, userEmail: src.userEmail, elevated: ELEVATED.has(role) || ELEVATED.has(type) };
}

const norm = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

async function termFor(organizationId, termName) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.term_name, sy.year_label, t.current, t.current_term
       FROM terms t LEFT JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1
      ORDER BY (t.current OR t.current_term) DESC, t.start_date DESC`,
    [organizationId]
  ).catch(() => db.query(
    `SELECT term_id, term_name, NULL AS year_label, current, current_term FROM terms WHERE organization_id = $1 ORDER BY (current OR current_term) DESC, start_date DESC`,
    [organizationId]
  ));
  if (!rows.length) throw new ApiError(404, "There are no terms set up for this school.");
  if (!termName) {
    const current = rows.find((t) => t.current || t.current_term);
    if (!current) throw new ApiError(400, "There's no current term. Which term?");
    return current;
  }
  const match = rows.filter((t) => norm(t.term_name) === norm(termName));
  if (!match.length) throw new ApiError(404, `There's no term called "${termName}". Terms: ${rows.map((t) => t.term_name).join(", ")}.`);
  return match[0];
}

async function classFor(organizationId, className) {
  const { rows } = await db.query(
    "SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL AND lower(btrim(class_name)) = $2",
    [organizationId, norm(className)]
  );
  if (!rows.length) throw new ApiError(404, `There's no class called "${className}".`);
  return rows[0];
}

// The class's students this term, if this person may write their remarks.
async function studentsFor(actor, classRow, term) {
  if (!actor.elevated) {
    const mine = await db.query("SELECT 1 FROM user_classes WHERE user_id = $1 AND class_id = $2", [actor.userId, classRow.class_id]);
    if (!mine.rows.length) throw new ApiError(403, `You can only manage remarks for classes assigned to you, and ${classRow.class_name} isn't one of them.`, "PERMISSION_DENIED");
  }
  const { rows } = await db.query(
    `SELECT DISTINCT s.student_id, s.first_name, s.last_name,
            sr.teacher_remarks, sr.conduct_remarks, sr.attitude_remarks, sr.interest_remarks
       FROM enrolled_students es
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id AND e.organization_id = $1 AND e.term_id = $3
       JOIN students s ON s.student_id = es.student_id AND s.organization_id = $1
       LEFT JOIN student_reports sr ON sr.organization_id = $1 AND sr.class_id = $2 AND sr.term_id = $3 AND sr.student_id = s.student_id
      WHERE es.class_id = $2
      ORDER BY s.last_name, s.first_name`,
    [actor.organizationId, classRow.class_id, term.term_id]
  );
  return rows;
}

const nameOf = (s) => `${s.first_name} ${s.last_name}`.replace(/\s+/g, " ").trim();
const remarksOf = (s) => ({ teacher: s.teacher_remarks || "", conduct: s.conduct_remarks || "", attitude: s.attitude_remarks || "", interest: s.interest_remarks || "" });

function send(res, fn) {
  return fn().catch((error) => {
    if (error instanceof ApiError || error.status) return res.status(error.status || 500).json({ error: error.message, code: error.code || null });
    console.error("[internalApi/miraReports]", error);
    return res.status(500).json({ error: "Unable to do that with report cards right now." });
  });
}

// GET /internal/api/reports/student-remarks?className=&termName=
const listRemarks = (req, res) => send(res, async () => {
  const actor = actorFrom(req.query || {});
  const term = await termFor(actor.organizationId, req.query.termName);
  const classRow = await classFor(actor.organizationId, req.query.className);
  const students = await studentsFor(actor, classRow, term);
  const list = students.map((s) => ({ student: nameOf(s), ...remarksOf(s) }));
  return res.json({
    class: classRow.class_name, term: term.term_name, schoolYear: term.year_label || null,
    totals: { students: list.length, withATeacherRemark: list.filter((s) => s.teacher).length, withNoRemarks: list.filter((s) => !s.teacher && !s.conduct && !s.attitude && !s.interest).length },
    students: list,
  });
});

// POST /internal/api/reports/student-remarks { className, termName?, remarks: [{ studentName, teacher?, conduct?, attitude?, interest? }], confirm? }
const saveRemarks = (req, res) => send(res, async () => {
  const body = req.body || {};
  const actor = actorFrom(body);
  const wanted = Array.isArray(body.remarks) ? body.remarks : [];
  if (!wanted.length) throw new ApiError(400, "Which students' remarks, and what should they say?");
  if (wanted.length > MAX_STUDENTS) throw new ApiError(400, `That's ${wanted.length} students; Mira writes remarks for up to ${MAX_STUDENTS} at a time.`);
  const term = await termFor(actor.organizationId, body.termName);
  const classRow = await classFor(actor.organizationId, body.className);
  const students = await studentsFor(actor, classRow, term);
  const byName = new Map();
  students.forEach((s) => byName.set(norm(nameOf(s)), [...(byName.get(norm(nameOf(s))) || []), s]));

  const problems = [];
  const changes = [];
  for (const entry of wanted) {
    const found = byName.get(norm(entry && entry.studentName)) || [];
    if (!found.length) { problems.push(`${entry && entry.studentName} isn't in ${classRow.class_name} this term`); continue; }
    if (found.length > 1) { problems.push(`${entry.studentName} is the name of ${found.length} students in ${classRow.class_name}`); continue; }
    const fields = Object.keys(FIELDS).filter((key) => typeof entry[key] === "string" && entry[key].trim());
    if (!fields.length) { problems.push(`no remark given for ${entry.studentName}`); continue; }
    const long = fields.find((key) => entry[key].trim().length > MAX_REMARK);
    if (long) { problems.push(`${entry.studentName}'s ${long} remark is over ${MAX_REMARK} characters`); continue; }
    const now = remarksOf(found[0]);
    changes.push({ student: found[0], name: nameOf(found[0]), set: Object.fromEntries(fields.map((key) => [key, entry[key].trim()])), now });
  }
  if (problems.length) throw new ApiError(400, `Nothing was saved: ${problems.join("; ")}.`);

  if (body.confirm !== true) {
    return res.json({
      status: "confirmation_required",
      preview: {
        class: classRow.class_name, term: `${term.term_name}${term.year_label ? ` ${term.year_label}` : ""}`, students: changes.length,
        changes: changes.map((c) => ({ student: c.name, ...Object.fromEntries(Object.entries(c.set).map(([key, value]) => [key, { now: c.now[key] || "(none)", new: value }])) })),
        replaces: changes.filter((c) => Object.keys(c.set).some((key) => c.now[key])).length,
        undo: "Remarks can be changed again at any time, on the report card or by asking Mira.",
      },
      message: "Show this preview and ask for a clear yes. Then call again with the same details and confirm=true.",
    });
  }

  for (const c of changes) {
    const v = (key) => (key in c.set ? c.set[key] : null);
    await db.query(
      `INSERT INTO student_reports (organization_id, class_id, term_id, student_id, teacher_remarks, conduct_remarks, interest_remarks, attitude_remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, class_id, term_id, student_id) DO UPDATE SET
         teacher_remarks = COALESCE(EXCLUDED.teacher_remarks, student_reports.teacher_remarks),
         conduct_remarks = COALESCE(EXCLUDED.conduct_remarks, student_reports.conduct_remarks),
         interest_remarks = COALESCE(EXCLUDED.interest_remarks, student_reports.interest_remarks),
         attitude_remarks = COALESCE(EXCLUDED.attitude_remarks, student_reports.attitude_remarks),
         updated_at = CURRENT_TIMESTAMP`,
      [actor.organizationId, classRow.class_id, term.term_id, c.student.student_id, v("teacher"), v("conduct"), v("interest"), v("attitude")]
    );
  }
  return res.json({ status: "done", saved: changes.length, class: classRow.class_name, term: term.term_name, students: changes.map((c) => c.name) });
});

async function needReportSettings(actor) {
  const ok = await userHasPermission(db, { userId: actor.userId, userRole: actor.userRole, organizationId: actor.organizationId, accountType: actor.accountType, userEmail: actor.userEmail }, PERMISSIONS.REPORTS_SETTINGS);
  if (!ok) throw new ApiError(403, "You don't have the **Report Settings** permission, which choosing report-card signatures needs.", "PERMISSION_DENIED");
}

async function signaturesOf(organizationId) {
  await ensurePersistentReportSignatures(db, organizationId);
  const { rows } = await db.query(
    `SELECT rs.signature_image_path AS path, max(rs.signature_name) AS name, max(rs.signature_title) AS title,
            array_remove(array_agg(DISTINCT c.class_name) FILTER (WHERE rs.term_id = $2), NULL) AS classes
       FROM report_settings rs LEFT JOIN classes c ON c.class_id = rs.class_id AND c.organization_id = rs.organization_id
      WHERE rs.organization_id = $1 AND rs.term_id <> -1 AND rs.signature_image_path IS NOT NULL
      GROUP BY rs.signature_image_path ORDER BY max(rs.signature_name) NULLS LAST, rs.signature_image_path`,
    [organizationId, REPORT_SIGNATURE_TERM_ID]
  );
  const obsolete = await obsoleteSignaturePaths(db, organizationId, "report");
  return rows.map((r) => ({ path: r.path, name: r.name || "", title: r.title || "", classes: (r.classes || []).sort(), obsolete: obsolete.has(String(r.path)) }));
}

const label = (s) => [s.name, s.title].filter(Boolean).join(", ") || "an unnamed signature";

// GET /internal/api/reports/signatures
const listSignatures = (req, res) => send(res, async () => {
  const actor = actorFrom(req.query || {});
  await needReportSettings(actor);
  const signatures = await signaturesOf(actor.organizationId);
  return res.json({ signatures: signatures.map(({ path, ...s }) => ({ ...s, label: label(s) })), totals: { signatures: signatures.length } });
});

// POST /internal/api/reports/signatures/apply { signature: name or title, classNames: [], confirm? }
const applySignature = (req, res) => send(res, async () => {
  const body = req.body || {};
  const actor = actorFrom(body);
  await needReportSettings(actor);
  const all = await signaturesOf(actor.organizationId);
  if (!all.length) throw new ApiError(404, "This school hasn't uploaded a report-card signature yet. Upload one in Report Settings first.");
  const said = norm(body.signature);
  const matches = all.filter((s) => said && (norm(s.name) === said || norm(s.title) === said || norm(label(s)) === said));
  if (!matches.length) throw new ApiError(404, `No uploaded signature is called "${body.signature}". Signatures: ${all.map(label).join("; ")}.`);
  if (matches.length > 1) throw new ApiError(400, `More than one signature matches "${body.signature}": ${matches.map(label).join("; ")}. Which one?`);
  const signature = matches[0];
  if (signature.obsolete) throw new ApiError(409, `${label(signature)} is obsolete. Restore it in Report Settings first.`);
  const names = Array.isArray(body.classNames) ? body.classNames : [];
  if (!names.length) throw new ApiError(400, "Which classes should use it?");
  const classes = [];
  for (const name of names) classes.push(await classFor(actor.organizationId, name));
  const current = new Map();
  all.forEach((s) => s.classes.forEach((c) => current.set(norm(c), s)));

  if (body.confirm !== true) {
    return res.json({
      status: "confirmation_required",
      preview: {
        signature: label(signature),
        classes: classes.map((c) => ({ class: c.class_name, now: current.has(norm(c.class_name)) ? label(current.get(norm(c.class_name))) : "(no signature)" })),
        replaces: classes.filter((c) => current.has(norm(c.class_name)) && current.get(norm(c.class_name)).path !== signature.path).length,
        undo: "Choose another signature for those classes at any time (Report Settings, or ask Mira). Report cards already printed or sent keep the signature they had.",
      },
      message: "Show this preview and ask for a clear yes. Then call again with the same details and confirm=true.",
    });
  }
  for (const c of classes) {
    await db.query(
      `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, class_id, term_id) DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path`,
      [actor.organizationId, c.class_id, REPORT_SIGNATURE_TERM_ID, signature.path]
    );
  }
  return res.json({ status: "done", signature: label(signature), classes: classes.map((c) => c.class_name) });
});

module.exports = { listRemarks, saveRemarks, listSignatures, applySignature };
