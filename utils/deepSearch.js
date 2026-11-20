"use strict";

// Search deeper: one search over what the header search doesn't reach (notes on files and report
// cards, messages, events, announcements, activities, assessments, and more fields of people).
// Strictly one school's: the school comes from the session, every query carries it, and each kind
// of result is searched only for people who can open its page (the header search's own rules:
// Manage Students, Manage Employees, Manage Guardians, Manage Classes & Subjects, Terminal
// Reports, Mailroom, Manage Assessments), teachers and supervisors only for their own classes.
// Past records (graduated, archived and removed people) are left out unless asked for.
// Results come back best first: an exact match, then starts-with, then a word's start, then the rest.

const { BoundedMap } = require("./boundedMap");

const PER_TYPE = 8;
const MAX_TOTAL = 60;
const SLOW_MS = 4500;

const TYPES = [
  { key: "students", label: "Students", group: "People" },
  { key: "parents", label: "Parents & guardians", group: "People" },
  { key: "staff", label: "Staff", group: "People" },
  { key: "applicants", label: "Applicants", group: "People" },
  { key: "details", label: "Profile details", group: "Profiles & files" },
  { key: "files", label: "Student files", group: "Profiles & files" },
  { key: "forms", label: "Custom forms", group: "Profiles & files" },
  { key: "notes", label: "Notes & alerts", group: "Notes & communication" },
  { key: "messages", label: "Messages", group: "Notes & communication" },
  { key: "announcements", label: "Announcements", group: "Notes & communication" },
  { key: "classes", label: "Classes & subjects", group: "Academics" },
  { key: "assessments", label: "Assessments", group: "Academics" },
  { key: "remarks", label: "Report card remarks", group: "Academics" },
  { key: "buses", label: "Buses & drivers", group: "Transport" },
  { key: "bills", label: "Bills", group: "Finance" },
  { key: "activities", label: "Class activities", group: "Calendar & tasks" },
  { key: "events", label: "Events", group: "Calendar & tasks" },
  { key: "tasks", label: "My tasks", group: "Calendar & tasks" },
  { key: "other", label: "Other details", group: "Other details" },
];
const TYPE_KEYS = new Set(TYPES.map((t) => t.key));

// Who is searching and how often: 40 searches a minute each.
const recent = new BoundedMap(2000);
function tooFast(key) {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < 60000);
  if (hits.length >= 40) { recent.set(key, hits); return true; }
  hits.push(now);
  recent.set(key, hits);
  return false;
}

const escapeLike = (text) => String(text).replace(/[\\%_]/g, "\\$&");
const clean = (text, max = 220) => String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, max);

// A few words around the match, for the result's second line.
function snippet(text, query, width = 110) {
  const flat = clean(text, 2000);
  if (!flat) return "";
  const at = flat.toLowerCase().indexOf(String(query).toLowerCase());
  if (at < 0) return flat.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  const piece = flat.slice(start, start + width);
  return `${start > 0 ? "…" : ""}${piece}${start + width < flat.length ? "…" : ""}`;
}

// 0 exact, 1 starts with, 2 a word starts with it, 3 contains.
function rankOf(title, query, ...others) {
  const q = String(query).trim().toLowerCase();
  const fields = [title, ...others].map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
  let best = 4;
  for (const field of fields) {
    if (field === q) return 0;
    if (field.startsWith(q)) best = Math.min(best, 1);
    else if (new RegExp(`(^|[\\s,.;:/()-])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(field)) best = Math.min(best, 2);
    else if (field.includes(q)) best = Math.min(best, 3);
  }
  return best;
}

async function context(db, req) {
  const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
  const s = req.session || {};
  const organizationId = Number(s.organizationId);
  const userId = Number((s.user && s.user.user_id) || s.userId) || null;
  const role = String(s.userRole || (s.user && s.user.account_type) || s.accountType || "").trim().toLowerCase();
  const who = { userId, userRole: s.userRole || (s.user && s.user.account_type) || null, organizationId, accountType: s.accountType || (s.user && s.user.account_type) || null, userEmail: (s.user && s.user.email) || null };
  const features = require("./shards/features");
  const classScoped = Boolean(userId) && ["teacher", "supervisor", "superviser"].includes(role);
  const manager = ["organization", "admin", "mini admin", "manager"].includes(role);
  const integrationSwitches = require("./integrationSwitches");
  const [students, employees, guardians, classesPerm, terminal, mailroom, assessments, admissions, customForms, transport, paygira, transportOn] = await Promise.all([
    userHasPermission(db, who, PERMISSIONS.MANAGE_STUDENTS), userHasPermission(db, who, PERMISSIONS.MANAGE_EMPLOYEES),
    userHasPermission(db, who, PERMISSIONS.MANAGE_GUARDIANS), userHasPermission(db, who, PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    userHasPermission(db, who, PERMISSIONS.REPORTS_TERMINAL), userHasPermission(db, who, PERMISSIONS.MAILROOM),
    userHasPermission(db, who, PERMISSIONS.MANAGE_ASSESSMENTS), userHasPermission(db, who, PERMISSIONS.APPROVE_ADMISSIONS),
    userHasPermission(db, who, PERMISSIONS.CUSTOM_FORMS), userHasPermission(db, who, PERMISSIONS.MANAGE_TRANSPORTATION),
    userHasPermission(db, who, PERMISSIONS.MANAGE_PAYGIRA), integrationSwitches.isOn(db, organizationId, "transportation").catch(() => false),
  ]);
  let classIds = null;
  if (classScoped) classIds = (await db.query("SELECT class_id FROM user_classes WHERE user_id = $1", [userId])).rows.map((r) => Number(r.class_id));
  return {
    organizationId, role, classIds, manager, driver: role === "driver",
    allowed: {
      students, parents: classScoped || guardians, staff: employees, classes: classScoped || manager || classesPerm,
      files: students && features.isOn("student_documents", { organizationId }), remarks: terminal, messages: mailroom,
      assessments, activities: true, events: true, announcements: true,
      applicants: admissions, details: students, notes: students,
      forms: features.isOn("custom_forms", { organizationId }) && (customForms || classScoped),
      buses: transport && transportOn, bills: paygira, tasks: Boolean(userId),
      other: students || admissions || paygira || (transport && transportOn),
    },
    userId,
    can: { students, admissions, paygira, transport: transport && transportOn },
    seesProtectedForms: manager || customForms || ["supervisor", "superviser"].includes(role),
    seesManagersFiles: manager || ["supervisor", "superviser"].includes(role),
  };
}

const activeSql = (alias) => require("./activeStudents").activeStudentSql(alias);
const pastSql = (alias) => `(COALESCE(${alias}.graduated, FALSE) OR EXISTS (SELECT 1 FROM archived_student_info ar WHERE ar.student_id = ${alias}.student_id AND ar.organization_id = ${alias}.organization_id))`;
const nameMatch = (a, p) => `(${a}.first_name ILIKE ${p} ESCAPE '\\' OR ${a}.last_name ILIKE ${p} ESCAPE '\\' OR CONCAT(${a}.first_name, ' ', ${a}.last_name) ILIKE ${p} ESCAPE '\\' OR CONCAT(${a}.last_name, ', ', ${a}.first_name) ILIKE ${p} ESCAPE '\\')`;
const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim();

// Each provider: (db, c, like, q, past) -> rows of { type, id, title, text, meta, href|person, rank, past }.
const PROVIDERS = {
  students: async (db, c, like, q, past) => {
    const { rows } = await db.query(
      `SELECT s.student_id AS id, s.first_name, s.last_name, s.class_id, cl.class_name, s.custom_student_id, s.email, s.address, s.hometown, ${pastSql("s")} AS past
         FROM students s LEFT JOIN classes cl ON cl.class_id = s.class_id AND cl.organization_id = $1
        WHERE s.organization_id = $1 AND ($3::boolean OR ${activeSql("s")}) AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[]))
          AND (${nameMatch("s", "$2")} OR s.student_id::text = $5 OR COALESCE(s.custom_student_id, '') ILIKE $2 ESCAPE '\\'
               OR COALESCE(s.email, '') ILIKE $2 ESCAPE '\\' OR COALESCE(s.address, '') ILIKE $2 ESCAPE '\\' OR COALESCE(s.hometown, '') ILIKE $2 ESCAPE '\\')
        ORDER BY s.last_name, s.first_name LIMIT ${PER_TYPE}`,
      [c.organizationId, like, past, c.classIds, q]
    );
    return rows.map((r) => {
      const hit = [["ID", r.custom_student_id], ["Email", r.email], ["Address", r.address], ["Hometown", r.hometown]].find(([, v]) => v && String(v).toLowerCase().includes(q.toLowerCase()));
      return {
        type: "students", id: r.id, title: fullName(r), person: `student:${r.id}`, past: r.past,
        text: hit && !fullName(r).toLowerCase().includes(q.toLowerCase()) ? `${hit[0]}: ${hit[1]}` : "", meta: [r.class_name, r.past ? "Past student" : ""].filter(Boolean).join(" · ") || "Student",
        rank: rankOf(fullName(r), q, `${r.last_name}, ${r.first_name}`, r.custom_student_id, String(r.id)),
      };
    });
  },
  parents: async (db, c, like, q, past) => {
    const { rows } = await db.query(
      `SELECT gp.guardian_id AS id, gp.first_name, gp.last_name, gp.email, gp.phone, gp.address, gp.hometown
         FROM guardian_profiles gp
        WHERE gp.organization_id = $1
          AND (${nameMatch("gp", "$2")} OR COALESCE(gp.email, '') ILIKE $2 ESCAPE '\\' OR COALESCE(gp.phone, '') ILIKE $2 ESCAPE '\\' OR COALESCE(gp.address, '') ILIKE $2 ESCAPE '\\' OR COALESCE(gp.hometown, '') ILIKE $2 ESCAPE '\\')
          AND ($4::int[] IS NULL OR EXISTS (SELECT 1 FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $1 WHERE gs.guardian_id = gp.guardian_id AND s.class_id = ANY($4::int[])))
          AND ($3::boolean OR NOT EXISTS (SELECT 1 FROM guardian_students gs WHERE gs.guardian_id = gp.guardian_id)
               OR EXISTS (SELECT 1 FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $1 WHERE gs.guardian_id = gp.guardian_id AND ${activeSql("s")}))
        ORDER BY gp.last_name, gp.first_name LIMIT ${PER_TYPE}`,
      [c.organizationId, like, past, c.classIds]
    );
    return rows.map((r) => {
      const hit = [["Email", r.email], ["Phone", r.phone], ["Address", r.address], ["Hometown", r.hometown]].find(([, v]) => v && String(v).toLowerCase().includes(q.toLowerCase()));
      return { type: "parents", id: r.id, title: fullName(r), person: `guardian:${r.id}`, text: hit && !fullName(r).toLowerCase().includes(q.toLowerCase()) ? `${hit[0]}: ${hit[1]}` : "", meta: "Parent / guardian", rank: rankOf(fullName(r), q, r.email, r.phone) };
    });
  },
  staff: async (db, c, like, q, past) => {
    const { rows } = await db.query(
      `SELECT u.user_id AS id, u.first_name, u.last_name, u.email, u.phone_number, u.org_role_title, u.org_role_description, sa.fun_fact, u.account_type::text AS role, (u.removed_at IS NOT NULL) AS past
         FROM users u LEFT JOIN staff_about sa ON sa.user_id = u.user_id AND sa.organization_id = u.organization_id
        WHERE u.organization_id = $1 AND ($3::boolean OR u.removed_at IS NULL) AND LOWER(u.account_type::text) NOT IN ('admin', 'mini admin', 'internal worker')
          AND (${nameMatch("u", "$2")} OR COALESCE(u.email, '') ILIKE $2 ESCAPE '\\' OR COALESCE(u.phone_number, '') ILIKE $2 ESCAPE '\\' OR COALESCE(u.org_role_title, '') ILIKE $2 ESCAPE '\\'
               OR COALESCE(u.org_role_description, '') ILIKE $2 ESCAPE '\\' OR COALESCE(sa.fun_fact, '') ILIKE $2 ESCAPE '\\')
        ORDER BY u.last_name, u.first_name LIMIT ${PER_TYPE}`,
      [c.organizationId, like, past]
    );
    return rows.map((r) => {
      const hit = [["Email", r.email], ["Phone", r.phone_number], ["Title", r.org_role_title], ["About", r.fun_fact], ["Role", r.org_role_description]].find(([, v]) => v && String(v).toLowerCase().includes(q.toLowerCase()));
      return { type: "staff", id: r.id, title: fullName(r), person: `staff:${r.id}`, past: r.past, text: hit && !fullName(r).toLowerCase().includes(q.toLowerCase()) ? `${hit[0]}: ${hit[1]}` : "", meta: [r.org_role_title || r.role, r.past ? "Removed" : ""].filter(Boolean).join(" · "), rank: rankOf(fullName(r), q, r.email, r.org_role_title) };
    });
  },
  classes: async (db, c, like, q) => {
    const [classes, subjects] = await Promise.all([
      db.query(`SELECT class_id AS id, class_name FROM classes WHERE organization_id = $1 AND class_name ILIKE $2 ESCAPE '\\' AND ($3::int[] IS NULL OR class_id = ANY($3::int[])) ORDER BY class_name LIMIT ${PER_TYPE}`, [c.organizationId, like, c.classIds]),
      db.query(
        `SELECT DISTINCT ON (LOWER(s.subject_name), s.class_id) s.subject_id AS id, s.subject_name, s.class_id, cl.class_name
           FROM subjects s LEFT JOIN classes cl ON cl.class_id = s.class_id AND cl.organization_id = s.organization_id
          WHERE s.organization_id = $1 AND s.subject_name ILIKE $2 ESCAPE '\\' AND ($3::int[] IS NULL OR s.class_id = ANY($3::int[]))
          ORDER BY LOWER(s.subject_name), s.class_id, s.subject_id DESC LIMIT ${PER_TYPE}`,
        [c.organizationId, like, c.classIds]
      ),
    ]);
    return [
      ...classes.rows.map((r) => ({ type: "classes", id: r.id, title: r.class_name, href: `/common/classDashboard?classId=${r.id}`, text: "", meta: "Class", rank: rankOf(r.class_name, q) })),
      ...subjects.rows.map((r) => ({ type: "classes", id: `s${r.id}`, title: r.subject_name, href: r.class_id ? `/common/classDashboard?classId=${r.class_id}` : "/common/manageClassSubjects", text: "", meta: `Subject${r.class_name ? ` · ${r.class_name}` : ""}`, rank: rankOf(r.subject_name, q) })),
    ];
  },
  files: async (db, c, like, q, past) => {
    const { rows } = await db.query(
      `SELECT d.document_id AS id, d.title, d.note, d.file_name, d.doc_type, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past
         FROM student_documents d JOIN students s ON s.student_id = d.student_id AND s.organization_id = d.organization_id
        WHERE d.organization_id = $1 AND ($3::boolean OR ${activeSql("s")}) AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[]))
          AND ($5::boolean OR d.shared_with <> 'managers')
          AND (COALESCE(d.title, '') ILIKE $2 ESCAPE '\\' OR COALESCE(d.note, '') ILIKE $2 ESCAPE '\\' OR COALESCE(d.file_name, '') ILIKE $2 ESCAPE '\\' OR COALESCE(d.doc_type, '') ILIKE $2 ESCAPE '\\')
        ORDER BY d.created_at DESC LIMIT ${PER_TYPE}`,
      [c.organizationId, like, past, c.classIds, c.seesManagersFiles]
    );
    return rows.map((r) => ({ type: "files", id: r.id, title: r.title || r.file_name, person: `student:${r.student_id}`, past: r.past, text: snippet(r.note, q) , meta: `${fullName(r)} · ${r.doc_type || "File"}`, rank: rankOf(r.title || r.file_name, q, r.file_name, r.note) }));
  },
  remarks: async (db, c, like, q, past) => {
    const { rows } = await db.query(
      `SELECT sr.id, sr.class_id, sr.term_id, sr.teacher_remarks, sr.conduct_remarks, sr.attitude_remarks, sr.interest_remarks, s.student_id, s.first_name, s.last_name, t.term_name, ${pastSql("s")} AS past
         FROM student_reports sr JOIN students s ON s.student_id = sr.student_id AND s.organization_id = sr.organization_id LEFT JOIN terms t ON t.term_id = sr.term_id
        WHERE sr.organization_id = $1 AND ($3::boolean OR ${activeSql("s")}) AND ($4::int[] IS NULL OR sr.class_id = ANY($4::int[]))
          AND (COALESCE(sr.teacher_remarks, '') ILIKE $2 ESCAPE '\\' OR COALESCE(sr.conduct_remarks, '') ILIKE $2 ESCAPE '\\' OR COALESCE(sr.attitude_remarks, '') ILIKE $2 ESCAPE '\\' OR COALESCE(sr.interest_remarks, '') ILIKE $2 ESCAPE '\\')
        ORDER BY sr.updated_at DESC NULLS LAST LIMIT ${PER_TYPE}`,
      [c.organizationId, like, past, c.classIds]
    );
    return rows.map((r) => {
      const field = [["Teacher's remark", r.teacher_remarks], ["Conduct", r.conduct_remarks], ["Attitude", r.attitude_remarks], ["Interest", r.interest_remarks]].find(([, v]) => v && String(v).toLowerCase().includes(q.toLowerCase())) || ["Remark", ""];
      return { type: "remarks", id: r.id, title: `${fullName(r)} · ${field[0]}`, href: `/print/printStudentReport?classId=${r.class_id}&termId=${r.term_id}`, past: r.past, text: snippet(field[1], q), meta: r.term_name || "Report card", rank: rankOf("", q, field[1]) };
    });
  },
  messages: async (db, c, like, q, past) => {
    const base = `FROM guardian_reports gr LEFT JOIN students s ON s.student_id = gr.student_id AND s.organization_id = gr.organization_id
        WHERE gr.organization_id = $1 AND gr.deleted_at IS NULL AND ($3::boolean OR s.student_id IS NULL OR ${activeSql("s")}) AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[]))`;
    const [reports, replies] = await Promise.all([
      db.query(`SELECT gr.report_id AS id, gr.subject, gr.message, gr.created_at, s.first_name, s.last_name, ${pastSql("s")} AS past ${base}
          AND (COALESCE(gr.subject, '') ILIKE $2 ESCAPE '\\' OR COALESCE(gr.message, '') ILIKE $2 ESCAPE '\\') ORDER BY gr.created_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds]),
      db.query(`SELECT gr.report_id AS id, gr.subject, rp.message, rp.created_at, rp.sender_name, s.first_name, s.last_name, ${pastSql("s")} AS past ${base}
          AND rp.message ILIKE $2 ESCAPE '\\' ORDER BY rp.created_at DESC LIMIT ${PER_TYPE}`.replace("FROM guardian_reports gr", "FROM guardian_report_replies rp JOIN guardian_reports gr ON gr.report_id = rp.report_id"), [c.organizationId, like, past, c.classIds]),
    ]);
    return [
      ...reports.rows.map((r) => ({ type: "messages", id: r.id, title: r.subject || "Message", href: `/common/mailroom/inbox`, past: r.past, text: snippet(r.message, q), meta: [fullName(r), r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ""].filter(Boolean).join(" · "), rank: rankOf(r.subject, q, r.message) })),
      ...replies.rows.map((r) => ({ type: "messages", id: `r${r.id}`, title: `Reply · ${r.subject || "Message"}`, href: `/common/mailroom/inbox`, past: r.past, text: snippet(r.message, q), meta: [r.sender_name, fullName(r)].filter(Boolean).join(" · "), rank: rankOf("", q, r.message) })),
    ];
  },
  // What the other kinds don't hold: application answers, fields kept from an old system, other contacts
  // on a student, fee and payment notes, and driver reports; each only for people who can open that page.
  other: async (db, c, like, q, past) => {
    const L = `ILIKE $2 ESCAPE '\\'`;
    const gate = `($3::boolean OR ${activeSql("s")}) AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[]))`;
    const none = Promise.resolve({ rows: [] });
    const [answers, extras, contacts, feeNotes, payNotes, driverReports] = await Promise.all([
      c.can.admissions ? db.query(`SELECT v.field_id AS id, v.value, f.label, p.first_name, p.last_name FROM application_field_values v JOIN pending_students p ON p.pending_id = v.pending_id AND p.organization_id = v.organization_id LEFT JOIN student_form_fields f ON f.field_id = v.field_id AND f.organization_id = v.organization_id WHERE v.organization_id = $1 AND v.value ${L} LIMIT ${PER_TYPE}`, [c.organizationId, like]) : none,
      c.can.students ? db.query(`SELECT x.extra_id AS id, x.label, x.value, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past FROM record_extra_fields x JOIN students s ON s.student_id = x.record_id AND s.organization_id = x.organization_id WHERE x.organization_id = $1 AND x.entity = 'student' AND ($5::boolean OR NOT COALESCE(x.sensitive, FALSE)) AND ${gate} AND (x.value ${L} OR COALESCE(x.label, '') ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds, c.seesManagersFiles]) : none,
      c.can.students ? db.query(`SELECT m.contact_method_id AS id, m.contact_name, m.contact_type, m.value, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past FROM student_contact_methods m JOIN students s ON s.student_id = m.student_id AND s.organization_id = m.organization_id WHERE m.organization_id = $1 AND ${gate} AND (COALESCE(m.contact_name, '') ${L} OR m.value ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds]) : none,
      c.can.paygira ? db.query(`SELECT n.note_id AS id, n.note, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past FROM finance_arrears_notes n JOIN students s ON s.student_id = n.student_id AND s.organization_id = n.organization_id WHERE n.organization_id = $1 AND ${gate} AND n.note ${L} LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds]) : none,
      c.can.paygira ? db.query(`SELECT fp.payment_id AS id, fp.notes, fp.reference, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past FROM finance_payments fp JOIN students s ON s.student_id = fp.student_id AND s.organization_id = fp.organization_id WHERE fp.organization_id = $1 AND ${gate} AND (COALESCE(fp.notes, '') ${L} OR COALESCE(fp.reference, '') ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds]) : none,
      c.can.transport && c.classIds === null ? db.query(`SELECT r.report_id AS id, r.details, r.issue, r.category, r.driver_name, s.first_name, s.last_name FROM transport_driver_reports r LEFT JOIN students s ON s.student_id = r.student_id AND s.organization_id = r.organization_id WHERE r.organization_id = $1 AND (COALESCE(r.details, '') ${L} OR COALESCE(r.issue, '') ${L}) ORDER BY r.created_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like]) : none,
    ]);
    return [
      ...answers.rows.map((r) => ({ type: "other", id: `ap${r.id}-${r.value.length}`, title: `${fullName(r)} · ${r.label || "Application answer"}`, href: "/common/admissionPending", text: snippet(r.value, q), meta: "Application answer", rank: rankOf("", q, r.value) })),
      ...extras.rows.map((r) => ({ type: "other", id: `ex${r.id}`, title: `${fullName(r)} · ${r.label}`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.value, q), meta: "From the old system", rank: rankOf(r.label, q, r.value) })),
      ...contacts.rows.map((r) => ({ type: "other", id: `ct${r.id}`, title: `${fullName(r)} · ${r.contact_name || r.contact_type || "Contact"}`, person: `student:${r.student_id}`, past: r.past, text: r.value, meta: "Other contact", rank: rankOf(r.contact_name, q, r.value) })),
      ...feeNotes.rows.map((r) => ({ type: "other", id: `fn${r.id}`, title: `${fullName(r)} · Fee note`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.note, q), meta: "PayGira", rank: rankOf("", q, r.note) })),
      ...payNotes.rows.map((r) => ({ type: "other", id: `pn${r.id}`, title: `${fullName(r)} · Payment`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.notes || r.reference, q), meta: "PayGira payment note", rank: rankOf("", q, r.notes, r.reference) })),
      ...driverReports.rows.map((r) => ({ type: "other", id: `dr${r.id}`, title: `Driver report${r.category ? ` · ${r.category}` : ""}`, href: "/transportation/manage", text: snippet(r.details || r.issue, q), meta: [r.driver_name, fullName(r)].filter(Boolean).join(" · "), rank: rankOf("", q, r.details, r.issue) })),
    ];
  },
  applicants: async (db, c, like, q) => {
    const { rows } = await db.query(
      `SELECT pending_id AS id, first_name, last_name, email, hometown, status FROM pending_students
        WHERE organization_id = $1 AND (${nameMatch("pending_students", "$2")} OR COALESCE(email, '') ILIKE $2 ESCAPE '\\' OR COALESCE(hometown, '') ILIKE $2 ESCAPE '\\')
        ORDER BY submitted_at DESC NULLS LAST LIMIT ${PER_TYPE}`,
      [c.organizationId, like]
    );
    return rows.map((r) => ({ type: "applicants", id: r.id, title: fullName(r), href: "/common/admissionPending", text: r.email && r.email.toLowerCase().includes(q.toLowerCase()) ? `Email: ${r.email}` : "", meta: `Application${r.status ? ` · ${r.status}` : ""}`, rank: rankOf(fullName(r), q, r.email) }));
  },
  details: async (db, c, like, q, past) => {
    const { rows } = await db.query(
      `SELECT v.field_id, v.value, f.label, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past
         FROM student_field_values v
         JOIN student_form_fields f ON f.field_id = v.field_id AND f.organization_id = v.organization_id AND COALESCE(f.status, 'active') <> 'archived'
         JOIN students s ON s.student_id = v.student_id AND s.organization_id = v.organization_id
        WHERE v.organization_id = $1 AND ($3::boolean OR ${activeSql("s")}) AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[])) AND v.value ILIKE $2 ESCAPE '\\'
        ORDER BY v.updated_at DESC NULLS LAST LIMIT ${PER_TYPE}`,
      [c.organizationId, like, past, c.classIds]
    );
    return rows.map((r) => ({ type: "details", id: `${r.student_id}-${r.field_id}`, title: `${fullName(r)} · ${r.label}`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.value, q), meta: "Profile detail", rank: rankOf("", q, r.value) }));
  },
  notes: async (db, c, like, q, past) => {
    const scope = "AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[]))";
    const gate = `($3::boolean OR ${activeSql("s")})`;
    const [alerts, portfolio, archive] = await Promise.all([
      db.query(`SELECT a.alert_id AS id, a.kind, a.label, a.text, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past FROM student_alerts a JOIN students s ON s.student_id = a.student_id AND s.organization_id = a.organization_id
          WHERE a.organization_id = $1 AND ${gate} ${scope} AND (COALESCE(a.text, '') ILIKE $2 ESCAPE '\\' OR COALESCE(a.label, '') ILIKE $2 ESCAPE '\\') ORDER BY a.created_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds]),
      db.query(`SELECT i.item_id AS id, i.title, i.note, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past FROM student_portfolio_items i JOIN students s ON s.student_id = i.student_id AND s.organization_id = i.organization_id
          WHERE i.organization_id = $1 AND ${gate} ${scope} AND (COALESCE(i.title, '') ILIKE $2 ESCAPE '\\' OR COALESCE(i.note, '') ILIKE $2 ESCAPE '\\') ORDER BY i.created_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like, past, c.classIds]),
      // Why someone left: for those who may see it (managers and supervisors), and only for past students.
      c.seesManagersFiles && past
        ? db.query(`SELECT a.id, a.reason, a.reason_note, s.student_id, s.first_name, s.last_name FROM archived_student_info a JOIN students s ON s.student_id = a.student_id AND s.organization_id = a.organization_id
            WHERE a.organization_id = $1 AND (COALESCE(a.reason, '') ILIKE $2 ESCAPE '\\' OR COALESCE(a.reason_note, '') ILIKE $2 ESCAPE '\\') ORDER BY a.archived_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like])
        : Promise.resolve({ rows: [] }),
    ]);
    return [
      ...alerts.rows.map((r) => ({ type: "notes", id: `a${r.id}`, title: `${fullName(r)} · ${r.label || r.kind || "Alert"}`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.text, q), meta: "Student alert", rank: rankOf(r.label, q, r.text) })),
      ...portfolio.rows.map((r) => ({ type: "notes", id: `p${r.id}`, title: `${fullName(r)} · ${r.title || "Portfolio"}`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.note, q), meta: "Portfolio note", rank: rankOf(r.title, q, r.note) })),
      ...archive.rows.map((r) => ({ type: "notes", id: `x${r.id}`, title: `${fullName(r)} · Why they left`, person: `student:${r.student_id}`, past: true, text: snippet([r.reason, r.reason_note].filter(Boolean).join(" · "), q), meta: "Past student", rank: rankOf("", q, r.reason, r.reason_note) })),
    ];
  },
  forms: async (db, c, like, q, past) => {
    const [sections, entries] = await Promise.all([
      db.query(`SELECT section_id AS id, name, notes, protected FROM custom_sections WHERE organization_id = $1 AND COALESCE(status, 'live') <> 'archived' AND (name ILIKE $2 ESCAPE '\\' OR COALESCE(notes, '') ILIKE $2 ESCAPE '\\') ORDER BY name LIMIT ${PER_TYPE}`, [c.organizationId, like]).catch(() => ({ rows: [] })),
      db.query(
        `SELECT e.entry_id AS id, cs.name, s.student_id, s.first_name, s.last_name, ${pastSql("s")} AS past,
                (SELECT kv.value FROM jsonb_each_text(e.data::jsonb) kv WHERE kv.value ILIKE $2 ESCAPE '\\' LIMIT 1) AS hit
           FROM custom_section_entries e JOIN custom_sections cs ON cs.section_id = e.section_id AND cs.organization_id = e.organization_id
           JOIN students s ON s.student_id = e.student_id AND s.organization_id = e.organization_id
          WHERE e.organization_id = $1 AND ($3::boolean OR ${activeSql("s")}) AND ($4::int[] IS NULL OR s.class_id = ANY($4::int[])) AND (cs.protected IS NOT TRUE OR $5::boolean)
            AND EXISTS (SELECT 1 FROM jsonb_each_text(e.data::jsonb) kv WHERE kv.value ILIKE $2 ESCAPE '\\')
          ORDER BY e.updated_at DESC NULLS LAST LIMIT ${PER_TYPE}`,
        [c.organizationId, like, past, c.classIds, c.seesProtectedForms]
      ).catch(() => ({ rows: [] })),
    ]);
    return [
      ...(c.classIds === null ? sections.rows.map((r) => ({ type: "forms", id: `s${r.id}`, title: r.name, href: "/common/custom-forms", text: snippet(r.notes, q), meta: "Custom editor section", rank: rankOf(r.name, q, r.notes) })) : []),
      ...entries.rows.map((r) => ({ type: "forms", id: `e${r.id}`, title: `${fullName(r)} · ${r.name}`, person: `student:${r.student_id}`, past: r.past, text: snippet(r.hit, q), meta: "Form answer", rank: rankOf("", q, r.hit) })),
    ];
  },
  buses: async (db, c, like, q) => {
    const L = `ILIKE $2 ESCAPE '\\'`;
    const [buses, drivers, routes, stops] = await Promise.all([
      db.query(`SELECT bus_id AS id, bus_name, bus_number, license_plate, vehicle_make, vehicle_model FROM transport_buses WHERE organization_id = $1 AND (COALESCE(bus_name, '') ${L} OR COALESCE(bus_number, '') ${L} OR COALESCE(license_plate, '') ${L} OR COALESCE(vehicle_make, '') ${L} OR COALESCE(vehicle_model, '') ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like]),
      db.query(`SELECT driver_id AS id, driver_name, phone, email, license_number, user_id FROM transport_drivers WHERE organization_id = $1 AND (COALESCE(driver_name, '') ${L} OR COALESCE(phone, '') ${L} OR COALESCE(email, '') ${L} OR COALESCE(license_number, '') ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like]),
      db.query(`SELECT route_id AS id, route_name, route_code, destination_address FROM transport_routes WHERE organization_id = $1 AND (COALESCE(route_name, '') ${L} OR COALESCE(route_code, '') ${L} OR COALESCE(destination_address, '') ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like]),
      db.query(`SELECT stop_id AS id, stop_name, stop_address FROM transport_stops WHERE organization_id = $1 AND (COALESCE(stop_name, '') ${L} OR COALESCE(stop_address, '') ${L}) LIMIT ${PER_TYPE}`, [c.organizationId, like]),
    ]).catch(() => [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const href = "/transportation/manage";
    return [
      ...buses.rows.map((r) => ({ type: "buses", id: `b${r.id}`, title: r.bus_name || `Bus ${r.bus_number || ""}`.trim(), href, text: [r.bus_number && `Bus ${r.bus_number}`, r.license_plate, [r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ")].filter(Boolean).join(" · "), meta: "Bus", rank: rankOf(r.bus_name, q, r.bus_number, r.license_plate) })),
      ...drivers.rows.map((r) => ({ type: "buses", id: `d${r.id}`, title: r.driver_name || "Driver", ...(r.user_id ? { person: `staff:${r.user_id}` } : { href }), text: [r.phone, r.email].filter(Boolean).join(" · "), meta: "Driver", rank: rankOf(r.driver_name, q, r.phone, r.email, r.license_number) })),
      ...routes.rows.map((r) => ({ type: "buses", id: `r${r.id}`, title: r.route_name || r.route_code, href, text: r.destination_address || "", meta: "Route", rank: rankOf(r.route_name, q, r.route_code) })),
      ...stops.rows.map((r) => ({ type: "buses", id: `s${r.id}`, title: r.stop_name, href, text: r.stop_address || "", meta: "Bus stop", rank: rankOf(r.stop_name, q, r.stop_address) })),
    ];
  },
  bills: async (db, c, like, q) => {
    const { rows } = await db.query(
      `SELECT bill_id AS id, title, description, amount, status, to_char(due_date, 'YYYY-MM-DD') AS due FROM finance_bills
        WHERE organization_id = $1 AND (COALESCE(title, '') ILIKE $2 ESCAPE '\\' OR COALESCE(description, '') ILIKE $2 ESCAPE '\\') ORDER BY created_at DESC LIMIT ${PER_TYPE}`,
      [c.organizationId, like]
    );
    return rows.map((r) => ({ type: "bills", id: r.id, title: r.title, href: "/finance", text: snippet(r.description, q), meta: ["Bill", r.status, r.due && `due ${r.due}`].filter(Boolean).join(" · "), rank: rankOf(r.title, q, r.description) }));
  },
  // Only what the person made or owns: their own tasks and events.
  tasks: async (db, c, like, q) => {
    const [tasks, comments, mine] = await Promise.all([
      db.query(`SELECT task_id AS id, title, details FROM org_tasks WHERE organization_id = $1 AND created_by = $3 AND (title ILIKE $2 ESCAPE '\\' OR COALESCE(details, '') ILIKE $2 ESCAPE '\\') ORDER BY created_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like, c.userId]),
      db.query(`SELECT t.task_id AS id, t.title, k.body FROM org_task_comments k JOIN org_tasks t ON t.task_id = k.task_id WHERE t.organization_id = $1 AND t.created_by = $3 AND k.body ILIKE $2 ESCAPE '\\' ORDER BY k.created_at DESC LIMIT ${PER_TYPE}`, [c.organizationId, like, c.userId]),
      db.query(`SELECT id, title, details, location, to_char(event_date, 'YYYY-MM-DD') AS day FROM personal_events WHERE organization_id = $1 AND owner_id = $3 AND (title ILIKE $2 ESCAPE '\\' OR COALESCE(details, '') ILIKE $2 ESCAPE '\\' OR COALESCE(location, '') ILIKE $2 ESCAPE '\\') ORDER BY event_date DESC LIMIT ${PER_TYPE}`, [c.organizationId, like, c.userId]),
    ]).catch(() => [{ rows: [] }, { rows: [] }, { rows: [] }]);
    return [
      ...tasks.rows.map((r) => ({ type: "tasks", id: `t${r.id}`, title: r.title, href: "/common/orgDashboard", text: snippet(r.details, q), meta: "Task", rank: rankOf(r.title, q, r.details) })),
      ...comments.rows.map((r) => ({ type: "tasks", id: `c${r.id}-${r.body.length}`, title: `Comment · ${r.title}`, href: "/common/orgDashboard", text: snippet(r.body, q), meta: "Task comment", rank: rankOf("", q, r.body) })),
      ...mine.rows.map((r) => ({ type: "tasks", id: `e${r.id}`, title: r.title, href: `/common/calendar?date=${r.day}`, text: snippet(r.details || r.location, q), meta: ["My event", r.day].filter(Boolean).join(" · "), rank: rankOf(r.title, q, r.details, r.location) })),
    ];
  },
  assessments: async (db, c, like, q) => {
    const { rows } = await db.query(
      `SELECT a.assessment_id AS id, a.title, a.description, a.class_id, cl.class_name, sub.subject_name
         FROM assessments a LEFT JOIN classes cl ON cl.class_id = a.class_id AND cl.organization_id = a.organization_id LEFT JOIN subjects sub ON sub.subject_id = a.subject_id
        WHERE a.organization_id = $1 AND a.obsolete_at IS NULL AND ($3::int[] IS NULL OR a.class_id = ANY($3::int[]))
          AND (COALESCE(a.title, '') ILIKE $2 ESCAPE '\\' OR COALESCE(a.description, '') ILIKE $2 ESCAPE '\\')
        ORDER BY a.assessment_id DESC LIMIT ${PER_TYPE}`,
      [c.organizationId, like, c.classIds]
    );
    return rows.map((r) => ({ type: "assessments", id: r.id, title: r.title, href: r.class_id ? `/common/classDashboard?classId=${r.class_id}` : "/common/management", text: snippet(r.description, q), meta: [r.subject_name, r.class_name].filter(Boolean).join(" · ") || "Assessment", rank: rankOf(r.title, q, r.description) }));
  },
  activities: async (db, c, like, q) => {
    const { rows } = await db.query(
      `SELECT a.activity_id AS id, a.title, a.details, a.location, to_char(a.activity_date, 'YYYY-MM-DD') AS day, cl.class_name
         FROM class_activities a LEFT JOIN classes cl ON cl.class_id = a.class_id AND cl.organization_id = a.organization_id
        WHERE a.organization_id = $1 AND ($3::int[] IS NULL OR a.class_id IS NULL OR a.class_id = ANY($3::int[]))
          AND (COALESCE(a.title, '') ILIKE $2 ESCAPE '\\' OR COALESCE(a.details, '') ILIKE $2 ESCAPE '\\' OR COALESCE(a.location, '') ILIKE $2 ESCAPE '\\')
        ORDER BY a.activity_date DESC LIMIT ${PER_TYPE}`,
      [c.organizationId, like, c.classIds]
    );
    return rows.map((r) => ({ type: "activities", id: r.id, title: r.title, href: `/common/calendar?date=${r.day}`, text: snippet(r.details || r.location, q), meta: [r.class_name || "School", r.day].filter(Boolean).join(" · "), rank: rankOf(r.title, q, r.details, r.location) }));
  },
  events: async (db, c, like, q) => {
    const { rows } = await db.query(
      `SELECT id, name, details, location, to_char(event_date, 'YYYY-MM-DD') AS day FROM school_events
        WHERE organization_id = $1 AND visibility IN ('org', 'both') AND (name ILIKE $2 ESCAPE '\\' OR COALESCE(details, '') ILIKE $2 ESCAPE '\\' OR COALESCE(location, '') ILIKE $2 ESCAPE '\\')
        ORDER BY event_date DESC NULLS LAST LIMIT ${PER_TYPE}`,
      [c.organizationId, like]
    );
    return rows.map((r) => ({ type: "events", id: r.id, title: r.name, href: r.day ? `/common/calendar?date=${r.day}` : "/common/calendar", text: snippet(r.details || r.location, q), meta: ["Event", r.day].filter(Boolean).join(" · "), rank: rankOf(r.name, q, r.details, r.location) }));
  },
  announcements: async (db, c, like, q) => {
    const { rows } = await db.query(
      `SELECT announcement_id AS id, message, to_char(created_at, 'YYYY-MM-DD') AS day FROM announcements
        WHERE organization_id = $1 AND visibility IN ('org', 'both') AND message ILIKE $2 ESCAPE '\\' ORDER BY created_at DESC LIMIT ${PER_TYPE}`,
      [c.organizationId, like]
    );
    return rows.map((r) => ({ type: "announcements", id: r.id, title: clean(r.message, 90), href: "/common/orgDashboard", text: snippet(r.message, q), meta: ["Announcement", r.day].filter(Boolean).join(" · "), rank: rankOf(clean(r.message, 90), q, r.message) }));
  },
};

// The people allowed to search at all: staff of a school (not parents, students or drivers).
async function search(db, req, { query, types, includePast, meta }) {
  const q = clean(query, 100);
  if (q.length < 2 && !meta) return { status: 400, error: "Type at least 2 characters." };
  const c = await context(db, req);
  if (!c.organizationId) return { status: 401, error: "Sign in again." };
  if (c.driver || ["student", "guardian", "parent"].includes(c.role)) return { status: 403, error: "Search deeper isn't available for your account." };
  // Which kinds of result this person can search, so the pop-up can show them before any search.
  if (meta) return { status: 200, body: { success: true, types: TYPES.filter((t) => c.allowed[t.key]) } };
  if (tooFast(`${c.organizationId}:${(req.session.user && req.session.user.user_id) || req.session.userId}`)) return { status: 429, error: "Slow down a moment, then search again." };

  const wanted = (Array.isArray(types) && types.length ? types : TYPES.map((t) => t.key)).filter((k) => TYPE_KEYS.has(k) && c.allowed[k]);
  const like = `%${escapeLike(q)}%`;
  let partial = false;
  const settled = await Promise.all(wanted.map((key) => Promise.race([
    PROVIDERS[key](db, c, like, q, Boolean(includePast)).then((rows) => ({ key, rows })).catch((error) => { console.warn(`[Deep search] ${key}:`, error.message); return { key, rows: [], failed: true }; }),
    new Promise((resolve) => setTimeout(() => { partial = true; resolve({ key, rows: [], slow: true }); }, SLOW_MS)),
  ])));
  const results = [];
  const counts = {};
  settled.forEach(({ key, rows }) => { counts[key] = rows.length; results.push(...rows); });
  const order = new Map(TYPES.map((t, i) => [t.key, i]));
  results.sort((a, b) => a.rank - b.rank || (a.past ? 1 : 0) - (b.past ? 1 : 0) || order.get(a.type) - order.get(b.type));
  return {
    status: 200,
    body: {
      success: true, query: q, partial,
      types: TYPES.filter((t) => c.allowed[t.key]),
      counts,
      results: results.slice(0, MAX_TOTAL).map((r) => ({ ...r, label: (TYPES.find((t) => t.key === r.type) || {}).label || r.type, exact: r.rank === 0 })),
    },
  };
}

module.exports = { TYPES, PROVIDERS, search, rankOf, snippet };
