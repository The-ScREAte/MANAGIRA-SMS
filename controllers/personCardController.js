"use strict";

// A person's card in the right-side drawer (views/common/personCard.ejs), opened from the header
// search, the dashboard's teachers and the class's teacher chips (public/js/headerMenu.js).
// Each card shows only what the person looking may see, worked out here, never in the page. Its
// buttons lead into the workspace where the work is done (the class, Users / Employees, Parents &
// guardians), and only for someone who can do it there:
//  - a student: anyone who can open the student page (Manage Students; teachers and supervisors
//    only for their own classes' students). Edit only with Edit Students, as on the page.
//  - a member of staff: with Manage Employees, their role, contact, classes and Modify (when the
//    staff-change rules allow); without it, only a colleague who shares a class (name, role, email
//    and the classes they share) or yourself.
//  - a parent: with Manage Guardians, everything and their children; a teacher or supervisor only
//    for parents of their classes' students, and only those children, without the address.
//  - a student looking at a teacher: only a teacher of a subject they take or their class's main
//    teacher: name, the subjects they teach them, and their email.
const { userHasPermission, sessionActor, PERMISSIONS } = require("../middleware/permissionMiddleware");
const classScope = require("../utils/classScope");

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const nameOf = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
const roleOf = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "").trim().toLowerCase();
const can = (db, req, key) => userHasPermission(db, sessionActor(req), key).catch(() => false);
const day = (value) => {
  if (!value) return "";
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
};
const imageOf = (res, url) => (url && url !== "profilePlaceholder.png" && res.locals.publicImageUrl ? res.locals.publicImageUrl(url) : null);

function render(req, res, card) {
  res.set("Cache-Control", "private, no-store");
  return res.render("common/personCard", {
    title: card ? card.name : "Not available",
    hideGlobalHeader: true,
    hideGlobalFooter: true,
    hideGlobalChatbot: true,
    card,
    drawerId: String(req.query.drawerId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40),
  });
}
const guardiansPanel = (key, edit) => `/common/management?panel=guardians&page=${encodeURIComponent(`/common/guardians?open=${key}${edit ? "&edit=1" : ""}`)}&label=${encodeURIComponent("Guardians")}`;
const notAvailable = (req, res) => res.status(404) && render(req, res, null);

// ── A student ───────────────────────────────────────────────────────────────────────────
async function student(req, res, db) {
  const organizationId = Number(req.session.organizationId);
  const studentId = toId(req.params.id);
  if (!studentId || !(await can(db, req, PERMISSIONS.MANAGE_STUDENTS))) return notAvailable(req, res);
  const mine = await classScope.assignedClasses(db, req);
  if (mine && !(await classScope.studentsInClasses(db, organizationId, [studentId], mine)).has(studentId)) return notAvailable(req, res);
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.gender, s.date_of_birth, s.email, s.custom_student_id,
            s.class_id, c.class_name, COALESCE(s.graduated, FALSE) AS graduated
       FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.student_id = $2`,
    [organizationId, studentId]
  );
  const s = rows[0];
  if (!s) return notAvailable(req, res);
  const [parents, lead, canEdit] = await Promise.all([
    db.query(
      `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.phone, gp.email, gp.image_url, gs.relationship
         FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $2
        WHERE gs.student_id = $1 ORDER BY gp.first_name, gp.last_name LIMIT 6`,
      [studentId, organizationId]
    ).then((r) => r.rows).catch(() => []),
    s.class_id ? db.query(
      `SELECT u.first_name, u.last_name, u.email FROM user_classes uc JOIN users u ON u.user_id = uc.user_id
        WHERE uc.class_id = $1 AND uc.main = TRUE AND u.organization_id = $2 AND COALESCE(u.on_hold, FALSE) = FALSE LIMIT 1`,
      [s.class_id, organizationId]
    ).then((r) => r.rows[0] || null).catch(() => null) : null,
    // As on the student page: Edit Students, and not for teachers and supervisors.
    can(db, req, PERMISSIONS.STUDENTS_EDIT).then((ok) => ok && !["teacher", "supervisor", "superviser"].includes(roleOf(req))),
  ]);
  const canSeeParents = parents.length > 0;
  const termId = req.session.currentTermId || "";
  // The full page opens inside the student's class workspace (or Admissions › All Students).
  const home = await require("../utils/studentHome").studentHome(db, req, s.student_id, { termId: termId || null }).catch(() => null);
  const inClass = Boolean(home && home.startsWith("/common/classDashboard/"));
  const isTeacher = ["teacher", "supervisor", "superviser"].includes(roleOf(req));
  return render(req, res, {
    kind: "student",
    name: nameOf(s),
    image: imageOf(res, s.image_url),
    tags: [s.class_name || "No class", s.graduated ? "Graduated / left" : null].filter(Boolean),
    facts: [
      s.custom_student_id ? ["Student ID", s.custom_student_id] : null,
      s.gender ? ["Gender", s.gender] : null,
      s.date_of_birth ? ["Date of birth", day(s.date_of_birth)] : null,
      s.email ? ["Email", s.email, `mailto:${s.email}`] : null,
      lead ? ["Main teacher", nameOf(lead)] : null,
    ].filter(Boolean),
    people: canSeeParents ? {
      title: "Parents & guardians",
      rows: parents.map((p) => ({ name: nameOf(p), sub: p.relationship || "", phone: p.phone || "", email: p.email || "", open: { person: `guardian:${p.guardian_id}:profile` } })),
    } : null,
    actions: [
      // Into the student's class workspace, where they're edited too (Edit opens their tab with the form up).
      // A teacher gets these only for a class they can open; nothing sends them elsewhere.
      inClass ? { label: "Open in class", href: home, top: true, primary: !canEdit } : null,
      !inClass && home && !isTeacher ? { label: "Open student page", href: home, top: true, primary: !canEdit } : null,
      canEdit ? {
        label: "Edit student",
        href: inClass
          ? home + (home.includes("?") ? "&" : "?") + "edit=1"
          : `/common/admissions?panel=all-students&page=${encodeURIComponent(`/common/editStudent?studentId=${s.student_id}`)}&label=${encodeURIComponent("All Students")}`,
        top: true,
        primary: true,
      } : null,
    ].filter(Boolean),
  });
}

// ── A member of staff ───────────────────────────────────────────────────────────────────
async function staff(req, res, db) {
  const organizationId = Number(req.session.organizationId);
  const userId = toId(req.params.id);
  if (!userId || roleOf(req) === "driver") return notAvailable(req, res);
  const viewerId = Number(req.session.userId || req.session.user?.user_id || 0);
  const manages = await can(db, req, PERMISSIONS.MANAGE_EMPLOYEES);

  // The school's own account.
  if (userId === organizationId && manages) {
    const { rows } = await db.query("SELECT organization_name, first_name, last_name, email FROM organizations WHERE organization_id = $1", [organizationId]);
    if (!rows[0]) return notAvailable(req, res);
    return render(req, res, {
      kind: "staff", name: nameOf(rows[0]) || rows[0].organization_name, image: null, tags: ["Manager", "School account"],
      facts: [rows[0].email ? ["Email", rows[0].email, `mailto:${rows[0].email}`] : null].filter(Boolean), actions: [],
    });
  }
  const { rows } = await db.query(
    `SELECT user_id, first_name, last_name, email, account_type::text AS account_type, image_url, profile_image_url, phone_number,
            org_role_title, COALESCE(on_hold, FALSE) AS on_hold
       FROM users WHERE user_id = $1 AND organization_id = $2 AND removed_at IS NULL`,
    [userId, organizationId]
  ).catch(() => db.query(
    `SELECT user_id, first_name, last_name, email, account_type::text AS account_type, image_url, NULL AS profile_image_url, NULL AS phone_number,
            NULL AS org_role_title, COALESCE(on_hold, FALSE) AS on_hold
       FROM users WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId]
  ));
  const u = rows[0];
  if (!u) return notAvailable(req, res);

  // Their classes (led, assisted, or through the subjects they teach) and subjects.
  const { rows: teaching } = await db.query(
    `SELECT c.class_id, c.class_name, uc.main, COALESCE((to_jsonb(uc) ->> 'assistant')::boolean, FALSE) AS assistant, NULL::text AS subject_name
       FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2
      WHERE uc.user_id = $1
     UNION ALL
     SELECT c.class_id, c.class_name, FALSE, FALSE, sub.subject_name
       FROM user_subjects us JOIN subjects sub ON sub.subject_id = us.subject_id AND sub.organization_id = $2
       JOIN classes c ON c.class_id = sub.class_id
      WHERE us.user_id = $1`,
    [userId, organizationId]
  ).catch(() => ({ rows: [] }));
  const isSelf = viewerId === userId;
  let shown = teaching;
  if (!manages && !isSelf) {
    // Without Manage Employees: only a colleague who shares one of your classes.
    const mine = await classScope.assignedClasses(db, req);
    if (!mine) return notAvailable(req, res);
    shown = teaching.filter((t) => mine.has(Number(t.class_id)));
    if (!shown.length) return notAvailable(req, res);
  }
  const byClass = new Map();
  shown.forEach((t) => {
    const entry = byClass.get(t.class_id) || { name: t.class_name, role: "", subjects: [] };
    if (t.main) entry.role = "Main teacher";
    else if (t.assistant && !entry.role) entry.role = "Assistant teacher";
    if (t.subject_name && !entry.subjects.includes(t.subject_name)) entry.subjects.push(t.subject_name);
    byClass.set(t.class_id, entry);
  });
  const full = manages || isSelf;
  let canModify = false;
  if (manages && !isSelf && (await can(db, req, PERMISSIONS.EMPLOYEES_EDIT || "employees_edit"))) {
    const refusal = await require("../utils/staffChangeGuard").staffChangeRefusal(db, req, userId).catch(() => "refused");
    canModify = !refusal;
  }
  return render(req, res, {
    kind: "staff",
    name: nameOf(u),
    image: imageOf(res, u.profile_image_url || u.image_url),
    tags: [u.org_role_title || u.account_type, u.on_hold && full ? "On hold" : null].filter(Boolean),
    facts: [
      u.email ? ["Email", u.email, `mailto:${u.email}`] : null,
      full && u.phone_number ? ["Phone", u.phone_number, `tel:${u.phone_number}`] : null,
    ].filter(Boolean),
    classes: [...byClass.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    classesTitle: full ? "Classes & subjects" : "Classes you share",
    actions: [
      // Into Management › Users / Employees, at this person's edit form.
      canModify ? { label: "Modify", href: `/common/management?panel=employees&page=${encodeURIComponent(`/common/manageEmployees?user=${u.user_id}&edit=1`)}&label=${encodeURIComponent("Users / Employees")}`, top: true, primary: true } : null,
      isSelf ? { label: "My profile", href: "/account/update", top: true } : null,
    ].filter(Boolean),
  });
}

// An older per-student parent record, as Parents & guardians lists it: the parent profile on the same
// child with the same name, else the profile with the same email, else the older record that heads
// its group (same name and phone; the list keys a group by its highest id). Same rules as the list.
async function listedParent(db, organizationId, legacyId) {
  const { rows } = await db.query("SELECT guardian_id, student_id, first_name, last_name, email, phone FROM guardians WHERE guardian_id = $1 AND organization_id = $2", [legacyId, organizationId]);
  const g = rows[0];
  if (!g) return null;
  const sameChild = await db.query(
    `SELECT gp.guardian_id FROM guardian_students gs
       JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
      WHERE gs.student_id = $2
        AND LOWER(REGEXP_REPLACE(TRIM(gp.first_name), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM($3), '\\s+', ' ', 'g'))
        AND LOWER(REGEXP_REPLACE(TRIM(COALESCE(gp.last_name, '')), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM(COALESCE($4, '')), '\\s+', ' ', 'g'))
      LIMIT 1`,
    [organizationId, g.student_id, g.first_name || "", g.last_name || ""]
  );
  if (sameChild.rows[0]) return { source: "profile", id: Number(sameChild.rows[0].guardian_id) };
  const email = String(g.email || "").trim();
  if (email) {
    const sameEmail = await db.query("SELECT guardian_id FROM guardian_profiles WHERE organization_id = $1 AND LOWER(TRIM(email)) = LOWER($2) LIMIT 1", [organizationId, email]);
    if (sameEmail.rows[0]) return { source: "profile", id: Number(sameEmail.rows[0].guardian_id) };
  }
  const head = await db.query(
    `SELECT MAX(guardian_id) AS id FROM guardians
      WHERE organization_id = $1 AND LOWER(TRIM(first_name)) = LOWER(TRIM($2)) AND LOWER(TRIM(COALESCE(last_name, ''))) = LOWER(TRIM(COALESCE($3, '')))
        AND COALESCE(NULLIF(TRIM(COALESCE(phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE($4, '')), ''), '__NO_PHONE__')`,
    [organizationId, g.first_name || "", g.last_name || "", g.phone || ""]
  );
  return { source: "legacy", id: Number(head.rows[0] && head.rows[0].id) || Number(legacyId) };
}

// ── A parent or guardian ────────────────────────────────────────────────────────────────
async function guardian(req, res, db) {
  const organizationId = Number(req.session.organizationId);
  let guardianId = toId(req.params.id);
  let source = req.query.source === "legacy" ? "legacy" : "profile";
  if (!guardianId || roleOf(req) === "driver") return notAvailable(req, res);
  // The header search finds parents by their older per-student record; the card (and Parents &
  // guardians) shows the person, so use the record the list shows for them.
  if (source === "legacy") {
    const resolved = await listedParent(db, organizationId, guardianId).catch(() => null);
    if (resolved) { source = resolved.source; guardianId = resolved.id; }
  }
  const manages = await can(db, req, PERMISSIONS.MANAGE_GUARDIANS);
  const mine = manages ? null : await classScope.assignedClasses(db, req);
  if (!manages && !mine) return notAvailable(req, res);

  const person = source === "profile"
    ? (await db.query("SELECT guardian_id, first_name, last_name, phone, email, address, image_url FROM guardian_profiles WHERE guardian_id = $1 AND organization_id = $2", [guardianId, organizationId])).rows[0]
    : (await db.query("SELECT guardian_id, first_name, last_name, phone, email, address, image_url, student_id FROM guardians WHERE guardian_id = $1 AND organization_id = $2", [guardianId, organizationId])).rows[0];
  if (!person) return notAvailable(req, res);
  // Their children (a parent's are their guardian_students rows; an older per-student row has one).
  const { rows: kids } = source === "profile"
    ? await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.class_id, c.class_name, gs.relationship
         FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $2
         LEFT JOIN classes c ON c.class_id = s.class_id
        WHERE gs.guardian_id = $1 AND COALESCE(s.graduated, FALSE) = FALSE ORDER BY s.first_name`,
      [guardianId, organizationId]
    )
    : await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.class_id, c.class_name, NULL AS relationship
         FROM students s LEFT JOIN classes c ON c.class_id = s.class_id WHERE s.student_id = $1 AND s.organization_id = $2`,
      [person.student_id, organizationId]
    );
  let children = kids;
  if (!manages) {
    // A teacher or supervisor: only parents of their classes' students, and only those children.
    const inScope = await classScope.studentsInClasses(db, organizationId, kids.map((k) => k.student_id), mine);
    children = kids.filter((k) => inScope.has(Number(k.student_id)));
    if (!children.length) return notAvailable(req, res);
  }
  const canStudents = await can(db, req, PERMISSIONS.MANAGE_STUDENTS);
  return render(req, res, {
    kind: "guardian",
    name: nameOf(person),
    image: imageOf(res, person.image_url),
    tags: [],
    facts: [
      person.phone ? ["Phone", person.phone, `tel:${person.phone}`] : null,
      person.email ? ["Email", person.email, `mailto:${person.email}`] : null,
      manages && person.address ? ["Address", person.address] : null,
    ].filter(Boolean),
    people: {
      title: children.length === 1 ? "Child" : "Children",
      rows: children.map((k) => ({ name: nameOf(k), sub: [k.class_name, k.relationship].filter(Boolean).join(" · "), open: canStudents ? { person: `student:${k.student_id}` } : null })),
    },
    actions: [
      // Into Management › Parents & guardians, at this parent (and their edit form). Only with Manage
      // Guardians: a teacher sees the card's contact details and nothing to change.
      manages ? { label: "Open", href: guardiansPanel(`${source}:${person.guardian_id}`, false), top: true } : null,
      manages ? { label: "Edit", href: guardiansPanel(`${source}:${person.guardian_id}`, true), top: true, primary: true } : null,
    ].filter(Boolean),
  });
}

// ── A student looking at one of their teachers ──────────────────────────────────────────
async function teacherForStudent(req, res, db) {
  const organizationId = Number(req.session.organizationId);
  const studentId = Number(req.session.studentId || 0);
  const userId = toId(req.params.id);
  if (!userId || !studentId) return notAvailable(req, res);
  const { rows } = await db.query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.image_url, u.profile_image_url,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT sub.subject_name), NULL) AS subjects,
            BOOL_OR(uc.main) AS main
       FROM users u
       JOIN students s ON s.student_id = $2 AND s.organization_id = $3
       LEFT JOIN user_subjects us ON us.user_id = u.user_id
       LEFT JOIN subjects sub ON sub.subject_id = us.subject_id AND sub.organization_id = $3
            AND EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = $2 AND ss.subject_id = sub.subject_id)
       LEFT JOIN user_classes uc ON uc.user_id = u.user_id AND uc.class_id = s.class_id AND uc.main = TRUE
      WHERE u.user_id = $1 AND u.organization_id = $3 AND COALESCE(u.on_hold, FALSE) = FALSE
      GROUP BY u.user_id`,
    [userId, studentId, organizationId]
  ).catch(() => ({ rows: [] }));
  const t = rows[0];
  if (!t || (!t.subjects.length && !t.main)) return notAvailable(req, res);
  return render(req, res, {
    kind: "teacher",
    name: nameOf(t),
    image: imageOf(res, t.profile_image_url || t.image_url),
    tags: [t.main ? "Your class teacher" : "Your teacher"],
    facts: [t.email ? ["Email", t.email, `mailto:${t.email}`] : null].filter(Boolean),
    classes: t.subjects.length ? [{ name: "Teaches you", role: "", subjects: t.subjects }] : [],
    classesTitle: "Subjects",
    actions: t.email ? [{ label: "Email", href: `mailto:${t.email}`, primary: true }] : [],
  });
}

const wrap = (handler) => async (req, res, db) => {
  try {
    return await handler(req, res, db);
  } catch (error) {
    console.error("[Person card]", error.message);
    return notAvailable(req, res);
  }
};

module.exports = { student: wrap(student), staff: wrap(staff), guardian: wrap(guardian), teacherForStudent: wrap(teacherForStudent), listedParent };
