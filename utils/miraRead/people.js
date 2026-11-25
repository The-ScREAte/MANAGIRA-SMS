"use strict";

// Mira's people reads: one search across the school's records, and a profile of a student, a
// member of staff, a class's staff and a family, with who in the families has accepted the
// portal invitation. Each answer is what the person's own pages would show them, by the same
// rules (AGENTS.md):
//  - search: the header search (enrollmentController.searchUsers): drivers get no people or
//    classes, teachers and supervisors only their own classes' students, parents, classes and
//    subjects; every other kind of record follows its own page's permission.
//  - a student: the person card and the student page (Manage Students; teachers and supervisors
//    only their own classes' students, classScope.assignedClasses), each section by its page.
//  - a member of staff: the person card (personCardController.staff): in full with Manage
//    Employees or for yourself, otherwise only a colleague who shares a class.
//  - a family: the guardian page and the contact card (Manage Guardians: the whole school; See
//    Contacts: the Mailroom's contacts; a teacher or supervisor: parents of their classes'
//    students, never the address). Parents are guardian_profiles linked through guardian_students.
const { ReadError, reqFor, roleOf, holds, cap, ROW_MAX } = require("./index");
const classScope = require("../classScope");
const { PERMISSIONS: P, isManagerLikeRole } = require("../../middleware/permissionMiddleware");

const SCOPED_ROLES = new Set(["teacher", "supervisor", "superviser"]);
const MANAGER_ROLES = new Set(["organization", "admin", "mini admin", "manager"]);

const orgOf = (actor) => Number(actor.organizationId);
const nameOf = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
const idOf = (value) => {
  const raw = String(Array.isArray(value) ? value[0] : value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const textOf = (value, max = 120) => String(Array.isArray(value) ? value[0] : value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const likeOf = (text) => `%${String(text).replace(/[\\%_]/g, "\\$&")}%`;
const norm = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const todayKey = () => require("../localDate").todayKeyFor(null);
// A DATE column read by node-pg is local midnight: its own calendar day, never shifted by UTC.
const dayText = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

// Who is asking: their role and, once asked for, the classes they're assigned to (null = every class).
function contextFor(db, actor) {
  const role = roleOf(actor);
  const req = reqFor(actor);
  let mine = null;
  return {
    role,
    req,
    driver: role === "driver",
    scoped: SCOPED_ROLES.has(role),
    manager: MANAGER_ROLES.has(role) || String(actor.accountType || "").trim().toLowerCase() === "organization",
    self: Number(actor.userId) || null,
    // Asked once per call, however many searches run side by side.
    mine() {
      if (!mine) mine = classScope.assignedClasses(db, req);
      return mine;
    },
  };
}

// Without Manage Employees a member of staff sees themselves and colleagues who share one of
// their classes (led, assisted, or a subject of it): the person card's rule, as SQL on users `u`.
function colleaguesSql(selfP, mineP) {
  return `AND (u.user_id = ${selfP}
        OR EXISTS (SELECT 1 FROM user_classes uc WHERE uc.user_id = u.user_id AND uc.class_id = ANY(${mineP}::int[]))
        OR EXISTS (SELECT 1 FROM user_subjects us JOIN subjects sub ON sub.subject_id = us.subject_id AND sub.organization_id = $1
                    WHERE us.user_id = u.user_id AND sub.class_id = ANY(${mineP}::int[])))`;
}

// Which of these students this person may open: all of them, or those of their classes.
async function keepStudents(db, actor, ids, mine) {
  const list = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!mine) return new Set(list);
  return classScope.studentsInClasses(db, orgOf(actor), list, mine);
}

// A person's name in a school's records: every word in the first or last name, or the whole name.
function nameClause(alias, text, params) {
  const whole = textOf(text);
  params.push(likeOf(whole));
  const full = `$${params.length}`;
  const parts = whole.split(/[\s,]+/).filter(Boolean).slice(0, 4).map((word) => {
    params.push(likeOf(word));
    const p = `$${params.length}`;
    return `(${alias}.first_name ILIKE ${p} ESCAPE '\\' OR ${alias}.last_name ILIKE ${p} ESCAPE '\\')`;
  });
  return `(CONCAT(${alias}.first_name, ' ', ${alias}.last_name) ILIKE ${full} ESCAPE '\\'
           OR CONCAT(${alias}.last_name, ', ', ${alias}.first_name) ILIKE ${full} ESCAPE '\\'${parts.length ? `\n           OR (${parts.join(" AND ")})` : ""})`;
}

// The closest names to what was typed, among the records this person can see.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function closest(typed, people, n = 5) {
  const q = norm(typed);
  if (!q) return [];
  const qWords = q.split(" ");
  return people
    .map((person) => {
      const t = norm(person.name);
      const tWords = t.split(" ").filter(Boolean);
      if (!tWords.length) return null;
      const whole = levenshtein(q, t) / Math.max(q.length, t.length);
      const byWord = qWords.reduce((sum, w) => sum + Math.min(...tWords.map((k) => (k.startsWith(w) ? 0 : levenshtein(w, k) / Math.max(w.length, k.length)))), 0) / qWords.length;
      return { ...person, score: Math.min(whole, byWord) };
    })
    .filter((person) => person && person.score <= 0.45)
    .sort((a, b) => a.score - b.score || String(a.name).localeCompare(String(b.name)))
    .slice(0, n);
}
const listNames = (rows, label) => rows.map((r) => `${r.name}${label ? ` (${label(r)})` : ""}`).join("; ");

// One record from a list that matched: the only one, or the only exact name among several.
function pickOne(rows, typed, what, label) {
  if (rows.length === 1) return rows[0];
  const exact = rows.filter((row) => norm(row.name) === norm(typed));
  if (exact.length === 1) return exact[0];
  const shown = rows.slice(0, 15);
  throw new ReadError("AMBIGUOUS", `"${typed}" matches ${rows.length} ${what}: ${listNames(shown, label)}${rows.length > shown.length ? "; ..." : ""}. Say which one, or give the id.`);
}

// ── Students ────────────────────────────────────────────────────────────────────────────
const STUDENT_COLUMNS = `s.student_id, s.first_name, s.last_name, s.class_id, c.class_name, s.custom_student_id, s.gender, s.email,
       s.date_of_birth::text AS date_of_birth, COALESCE(s.date_of_birth_unknown, FALSE) AS date_of_birth_unknown,
       COALESCE(s.graduated, FALSE) AS graduated, s.graduation_year_group_id`;

// The student this person named (or gave the id of), among those they may open.
async function resolveStudent(db, actor, q, mine, { scopeLabel = "you can open" } = {}) {
  const organizationId = orgOf(actor);
  const id = idOf(q.studentId);
  const typed = textOf(q.student);
  if (!id && !typed) throw new ReadError("VALIDATION", "Name the student (student) or give their id (studentId).");
  if (id) {
    const { rows } = await db.query(
      `SELECT ${STUDENT_COLUMNS} FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
        WHERE s.organization_id = $1 AND s.student_id = $2`,
      [organizationId, id]
    );
    if (!rows[0] || !(await keepStudents(db, actor, [id], mine)).has(id)) {
      throw new ReadError("NOT_FOUND", `No student with id ${id} in your school${mine ? " that you can open (your classes only)" : ""}.`);
    }
    return { ...rows[0], name: nameOf(rows[0]) };
  }
  const params = [organizationId];
  const names = nameClause("s", typed, params);
  params.push(typed);
  const exactId = `$${params.length}`;
  const { rows } = await db.query(
    `SELECT ${STUDENT_COLUMNS} FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND (${names} OR s.student_id::text = ${exactId} OR LOWER(COALESCE(s.custom_student_id, '')) = LOWER(${exactId}))
      ORDER BY COALESCE(s.graduated, FALSE), LOWER(s.last_name), LOWER(s.first_name), s.student_id
      LIMIT 2000`,
    params
  );
  const allowed = await keepStudents(db, actor, rows.map((r) => r.student_id), mine);
  const found = rows.filter((r) => allowed.has(Number(r.student_id))).map((r) => ({ ...r, name: nameOf(r) }));
  if (!found.length) {
    const pool = (await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, c.class_name FROM students s
         LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
        WHERE s.organization_id = $1 AND ($2::int[] IS NULL OR s.class_id = ANY($2::int[]))`,
      [organizationId, mine ? [...mine] : null]
    )).rows.map((r) => ({ id: Number(r.student_id), name: nameOf(r), class: r.class_name || "No class" }));
    const near = closest(typed, pool);
    throw new ReadError("NOT_FOUND", `No student matching "${typed}" among the students ${scopeLabel}.${near.length ? ` Closest: ${listNames(near, (r) => `${r.class}, id ${r.id}`)}.` : ""}`);
  }
  return pickOne(found, typed, "students", (r) => `${r.class_name || "No class"}, id ${r.student_id}`);
}

// ── search_records ──────────────────────────────────────────────────────────────────────
const SEARCH_TYPES = ["students", "guardians", "staff", "classes", "subjects", "forms", "events", "announcements", "documents", "buses", "routes", "bills"];
const TYPE_WORDS = {
  student: "students", pupil: "students", pupils: "students", learner: "students", learners: "students",
  guardian: "guardians", parent: "guardians", parents: "guardians", family: "guardians", families: "guardians",
  employee: "staff", employees: "staff", teacher: "staff", teachers: "staff", staffs: "staff", users: "staff",
  class: "classes", subject: "subjects", course: "subjects", courses: "subjects",
  form: "forms", event: "events", announcement: "announcements",
  document: "documents", doc: "documents", docs: "documents", sheet: "documents", sheets: "documents",
  bus: "buses", route: "routes", bill: "bills", fee: "bills", fees: "bills",
};
const typeOf = (word) => {
  const key = String(word || "").trim().toLowerCase();
  return SEARCH_TYPES.includes(key) ? key : TYPE_WORDS[key] || null;
};
const refuse = (needs) => ({ needs });
const DRIVERS = "a staff account other than Driver";
// Transportation's permissions exist only while the school has it switched on.
const TRANSPORT_OFF = "Transportation switched on (Management Tools › Integrations)";
const transportNeeds = async (db, actor) => ((await require("../integrationSwitches").isOn(db, orgOf(actor), "transportation")) ? "Transportation" : TRANSPORT_OFF);

const SEARCHERS = {
  async students(db, actor, ctx, text) {
    if (ctx.driver) return refuse(DRIVERS);
    if (!(await holds(db, actor, P.MANAGE_STUDENTS))) return refuse("Manage Students");
    // Teachers and supervisors: their own classes' students, as the header search shows them.
    const mine = ctx.scoped ? await ctx.mine() : null;
    const params = [orgOf(actor)];
    const names = nameClause("s", text, params);
    params.push(text);
    const exactId = `$${params.length}`;
    const { rows } = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.custom_student_id, COALESCE(s.graduated, FALSE) AS graduated, c.class_name
         FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
        WHERE s.organization_id = $1
          AND (${names} OR s.student_id::text = ${exactId} OR COALESCE(s.custom_student_id, '') ILIKE $2 ESCAPE '\\')
        ORDER BY COALESCE(s.graduated, FALSE), LOWER(s.last_name), LOWER(s.first_name), s.student_id
        LIMIT 5000`,
      params
    );
    const allowed = await keepStudents(db, actor, rows.map((r) => r.student_id), mine);
    const kept = rows.filter((r) => allowed.has(Number(r.student_id)));
    return {
      total: kept.length,
      rows: kept.map((r) => ({
        type: "student", id: Number(r.student_id), name: nameOf(r),
        context: [r.class_name || "No class", r.graduated ? "Graduated / left" : null, r.custom_student_id ? `Student ID ${r.custom_student_id}` : null].filter(Boolean).join(" · "),
      })),
    };
  },

  async guardians(db, actor, ctx, text) {
    if (ctx.driver) return refuse(DRIVERS);
    const manages = await holds(db, actor, P.MANAGE_GUARDIANS);
    if (!ctx.scoped && !manages) return refuse("Manage Guardians");
    const mine = ctx.scoped ? await ctx.mine() : null;
    const params = [orgOf(actor)];
    const names = nameClause("gp", text, params);
    const { rows } = await db.query(
      `SELECT gp.guardian_id, gp.first_name, gp.last_name,
              COALESCE(json_agg(json_build_object('id', s.student_id, 'name', TRIM(CONCAT(s.first_name, ' ', s.last_name))))
                       FILTER (WHERE s.student_id IS NOT NULL), '[]'::json) AS children
         FROM guardian_profiles gp
         LEFT JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
         LEFT JOIN students s ON s.student_id = gs.student_id AND s.organization_id = gp.organization_id
        WHERE gp.organization_id = $1 AND ${names}
        GROUP BY gp.guardian_id
        ORDER BY LOWER(gp.last_name), LOWER(gp.first_name), gp.guardian_id
        LIMIT 3000`,
      params
    );
    const allowed = mine ? await keepStudents(db, actor, rows.flatMap((r) => r.children.map((k) => k.id)), mine) : null;
    const kept = rows
      .map((r) => ({ ...r, children: allowed ? r.children.filter((k) => allowed.has(Number(k.id))) : r.children }))
      .filter((r) => !allowed || r.children.length);
    return {
      total: kept.length,
      rows: kept.map((r) => ({
        type: "guardian", id: Number(r.guardian_id), name: nameOf(r),
        context: r.children.length ? `Parent of ${r.children.map((k) => k.name).slice(0, 4).join(", ")}${r.children.length > 4 ? " ..." : ""}` : "No children linked",
      })),
    };
  },

  async staff(db, actor, ctx, text) {
    if (ctx.driver) return refuse(DRIVERS);
    const manages = await holds(db, actor, P.MANAGE_EMPLOYEES);
    // Without Manage Employees: yourself, and colleagues who share one of your classes (the person card).
    const mine = manages ? null : await ctx.mine();
    const params = [orgOf(actor)];
    const names = nameClause("u", text, params);
    let visible = "";
    if (!manages) {
      params.push(ctx.self || 0, mine ? [...mine] : []);
      visible = colleaguesSql(`$${params.length - 1}`, `$${params.length}`);
    }
    const { rows } = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.account_type::text AS account_type, u.org_role_title, COALESCE(u.on_hold, FALSE) AS on_hold
         FROM users u
        WHERE u.organization_id = $1 AND u.removed_at IS NULL AND ${names} ${visible}
        ORDER BY LOWER(u.last_name), LOWER(u.first_name), u.user_id
        LIMIT 3000`,
      params
    );
    return {
      total: rows.length,
      rows: rows.map((r) => ({
        type: "staff", id: Number(r.user_id), name: nameOf(r),
        context: [r.org_role_title || r.account_type, manages && r.on_hold ? "On hold" : null, Number(r.user_id) === ctx.self ? "You" : !manages ? "Shares a class with you" : null].filter(Boolean).join(" · "),
      })),
    };
  },

  async classes(db, actor, ctx, text) {
    if (ctx.driver) return refuse(DRIVERS);
    const canManage = ctx.scoped || ctx.manager || (await holds(db, actor, P.MANAGE_CLASSES_SUBJECTS));
    if (!canManage) return refuse("Manage Classes & Subjects");
    const mine = ctx.scoped ? await ctx.mine() : null;
    const { rows } = await db.query(
      `SELECT c.class_id, c.class_name, c.obsolete_at IS NOT NULL AS retired,
              (SELECT COUNT(*)::int FROM students s WHERE s.organization_id = c.organization_id AND s.class_id = c.class_id AND COALESCE(s.graduated, FALSE) = FALSE) AS students
         FROM classes c
        WHERE c.organization_id = $1 AND c.class_name ILIKE $2 ESCAPE '\\' AND ($3::int[] IS NULL OR c.class_id = ANY($3::int[]))
        ORDER BY c.obsolete_at IS NOT NULL, COALESCE(c.dashboard_sort_order, 2147483647), c.class_name, c.class_id`,
      [orgOf(actor), likeOf(text), mine ? [...mine] : null]
    );
    return {
      total: rows.length,
      rows: rows.map((r) => ({ type: "class", id: Number(r.class_id), name: r.class_name, context: [`${r.students} ${r.students === 1 ? "student" : "students"}`, r.retired ? "Retired" : null].filter(Boolean).join(" · ") })),
    };
  },

  async subjects(db, actor, ctx, text) {
    if (ctx.driver) return refuse(DRIVERS);
    const canManage = ctx.scoped || ctx.manager || (await holds(db, actor, P.MANAGE_CLASSES_SUBJECTS));
    if (!canManage) return refuse("Manage Classes & Subjects");
    const mine = ctx.scoped ? await ctx.mine() : null;
    // One row per subject per class, from the current term when there is one (the header search's query).
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (LOWER(s.subject_name), s.class_id) s.subject_id, s.subject_name, s.class_id, c.class_name
           FROM subjects s
           LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
           LEFT JOIN terms t ON t.term_id = s.term_id
          WHERE s.organization_id = $1 AND s.subject_name ILIKE $2 ESCAPE '\\'
            AND ($3::int[] IS NULL OR s.class_id = ANY($3::int[]))
            AND (s.term_id IS NULL OR t.current OR NOT EXISTS (SELECT 1 FROM terms t2 WHERE t2.organization_id = $1 AND t2.current))
          ORDER BY LOWER(s.subject_name), s.class_id, t.current DESC NULLS LAST, s.subject_id DESC
       ) x ORDER BY LOWER(subject_name), class_name NULLS LAST`,
      [orgOf(actor), likeOf(text), mine ? [...mine] : null]
    );
    return { total: rows.length, rows: rows.map((r) => ({ type: "subject", id: Number(r.subject_id), name: r.subject_name, context: r.class_name || "No class" })) };
  },

  async forms(db, actor, ctx, text) {
    const cf = require("../customForms");
    const organizationId = orgOf(actor);
    if (!(await cf.ready(db))) return refuse("the Custom editor, which isn't on for this school");
    if (ctx.driver) return refuse(DRIVERS);
    const [builder, students] = await Promise.all([holds(db, actor, P.CUSTOM_FORMS), holds(db, actor, P.MANAGE_STUDENTS)]);
    if (!builder && !students) return refuse("Custom Editor or Manage Students");
    const reach = await cf.staffReach(db, ctx.req, { builder });
    const q = norm(text);
    const sections = cf.sectionsForStaff(await cf.listSections(db, organizationId), reach).filter((s) => norm(s.name).includes(q));
    const WHO = { parent: "Parents fill it in", student: "Students fill it in", staff: "Staff fill it in", driver: "Drivers fill it in" };
    return {
      total: sections.length,
      rows: sections.map((s) => ({ type: "form", id: Number(s.id), name: s.name, context: [WHO[s.filledBy] || s.filledBy, s.status, s.dueDate ? `due ${s.dueDate}` : null].filter(Boolean).join(" · ") })),
    };
  },

  async events(db, actor, ctx, text) {
    if (!(await holds(db, actor, P.EVENTS_EVENTS))) return refuse("Events");
    const { rows } = await db.query(
      `SELECT id, name, event_date::text AS event_date, end_date::text AS end_date, visibility, location
         FROM school_events WHERE organization_id = $1 AND (name ILIKE $2 ESCAPE '\\' OR COALESCE(location, '') ILIKE $2 ESCAPE '\\')
        ORDER BY event_date DESC NULLS LAST, id DESC`,
      [orgOf(actor), likeOf(text)]
    );
    return {
      total: rows.length,
      rows: rows.map((r) => ({ type: "event", id: Number(r.id), name: r.name, context: [r.event_date ? (r.end_date && r.end_date !== r.event_date ? `${r.event_date} to ${r.end_date}` : r.event_date) : "No date", r.visibility || null].filter(Boolean).join(" · ") })),
    };
  },

  async announcements(db, actor, ctx, text) {
    if (!(await holds(db, actor, P.EVENTS_ANNOUNCEMENTS))) return refuse("Announcements");
    const { rows } = await db.query(
      `SELECT announcement_id, LEFT(message, 200) AS snippet, created_at::date::text AS created, visibility
         FROM announcements WHERE organization_id = $1 AND message ILIKE $2 ESCAPE '\\'
        ORDER BY created_at DESC, announcement_id DESC`,
      [orgOf(actor), likeOf(text)]
    );
    return {
      total: rows.length,
      rows: rows.map((r) => ({ type: "announcement", id: Number(r.announcement_id), name: `Announcement of ${r.created}`, context: r.visibility || "" })),
      untrusted: rows.map((r) => ({ type: "announcement", id: Number(r.announcement_id), text: r.snippet })),
    };
  },

  async documents(db, actor, ctx, text) {
    if (ctx.driver) return refuse(DRIVERS);
    // Docs & Sheets: Manage Records sees the school's documents; anyone else their own, those
    // shared with them and those of their classes (documentController.documentsList).
    const all = await holds(db, actor, P.MANAGE_RECORDS);
    const params = [orgOf(actor), likeOf(text)];
    if (!all) params.push(ctx.self || 0);
    const { rows } = await db.query(
      `SELECT DISTINCT d.id, d.title, d.doc_type, d.updated_at, d.updated_at::date::text AS updated, u.first_name, u.last_name
         FROM documents d
         JOIN users u ON d.created_by = u.user_id
         ${all ? "" : `LEFT JOIN document_permissions dp ON d.id = dp.document_id AND dp.user_id = $3
         LEFT JOIN document_class_assignments dca ON d.id = dca.document_id
         LEFT JOIN user_classes ce ON ce.class_id = dca.class_id AND ce.user_id = $3`}
        WHERE d.organization_id = $1 AND d.is_deleted = FALSE AND d.title ILIKE $2 ESCAPE '\\'
          ${all ? "" : "AND (d.created_by = $3 OR dp.user_id IS NOT NULL OR ce.user_id IS NOT NULL)"}
        ORDER BY d.updated_at DESC`,
      params
    );
    return {
      total: rows.length,
      rows: rows.map((r) => ({ type: "document", id: Number(r.id), name: r.title, context: [r.doc_type === "spreadsheet" ? "Sheet" : "Doc", `by ${nameOf(r)}`, `updated ${r.updated}`].join(" · ") })),
    };
  },

  async buses(db, actor, ctx, text) {
    if (!(await holds(db, actor, P.MANAGE_TRANSPORTATION))) return refuse(await transportNeeds(db, actor));
    const { rows } = await db.query(
      `SELECT bus_id, bus_number, bus_name, status, license_plate FROM transport_buses
        WHERE organization_id = $1 AND (bus_number ILIKE $2 ESCAPE '\\' OR COALESCE(bus_name, '') ILIKE $2 ESCAPE '\\' OR COALESCE(license_plate, '') ILIKE $2 ESCAPE '\\')
        ORDER BY bus_number, bus_id`,
      [orgOf(actor), likeOf(text)]
    );
    return { total: rows.length, rows: rows.map((r) => ({ type: "bus", id: Number(r.bus_id), name: `Bus ${r.bus_number}`, context: [r.bus_name, r.status].filter(Boolean).join(" · ") })) };
  },

  async routes(db, actor, ctx, text) {
    if (!(await holds(db, actor, P.MANAGE_TRANSPORTATION))) return refuse(await transportNeeds(db, actor));
    const { rows } = await db.query(
      `SELECT route_id, route_name, route_code, route_status FROM transport_routes
        WHERE organization_id = $1 AND (route_name ILIKE $2 ESCAPE '\\' OR COALESCE(route_code, '') ILIKE $2 ESCAPE '\\')
        ORDER BY route_name, route_id`,
      [orgOf(actor), likeOf(text)]
    );
    return { total: rows.length, rows: rows.map((r) => ({ type: "route", id: Number(r.route_id), name: r.route_name, context: [r.route_code, r.route_status].filter(Boolean).join(" · ") })) };
  },

  async bills(db, actor, ctx, text) {
    // PayGira › Bills: Main PayGira and its Bills page.
    const [workspace, bills] = await Promise.all([holds(db, actor, P.PAYGIRA_WORKSPACE), holds(db, actor, P.PAYGIRA_BILLS)]);
    if (!workspace || !bills) return refuse("Main PayGira › Bills");
    const { rows } = await db.query(
      `SELECT bill_id, title, bill_type, COALESCE(status, 'active') AS status, due_date::text AS due_date, recurrence
         FROM finance_bills WHERE organization_id = $1 AND title ILIKE $2 ESCAPE '\\'
        ORDER BY due_date DESC NULLS LAST, bill_id DESC`,
      [orgOf(actor), likeOf(text)]
    );
    return {
      total: rows.length,
      rows: rows.map((r) => ({ type: "bill", id: Number(r.bill_id), name: r.title, context: [r.status, r.due_date ? `due ${r.due_date}` : null, r.recurrence && r.recurrence !== "none" ? `repeats ${r.recurrence}` : null].filter(Boolean).join(" · ") })),
    };
  },
};

async function searchRecords(db, actor, q) {
  const text = textOf(q.query, 100);
  if (text.length < 2) throw new ReadError("VALIDATION", "Give at least 2 characters to search for (query).");
  const asked = String(q.types || "").split(",").map((t) => t.trim()).filter(Boolean);
  const unknown = asked.filter((t) => !typeOf(t));
  if (unknown.length) throw new ReadError("VALIDATION", `Unknown record type: ${unknown.join(", ")}. Types: ${SEARCH_TYPES.join(", ")}.`);
  const types = asked.length ? [...new Set(asked.map(typeOf))] : SEARCH_TYPES;
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 8, 1), 50);
  const ctx = contextFor(db, actor);

  const results = await Promise.all(types.map(async (type) => ({ type, ...(await SEARCHERS[type](db, actor, ctx, text)) })));
  const searched = results.filter((r) => !r.needs);
  const notSearched = results.filter((r) => r.needs).map((r) => ({ type: r.type, needs: r.needs }));
  if (!searched.length) {
    throw new ReadError("PERMISSION_DENIED", `You can't search ${types.length === 1 ? types[0] : "any of these records"}: ${notSearched.map((r) => `${r.type} (needs ${r.needs})`).join(", ")}.`);
  }
  const rows = [];
  const totals = { all: 0 };
  let truncated = false;
  const untrusted = [];
  searched.forEach((r) => {
    totals[r.type] = r.total;
    totals.all += r.total;
    const shown = r.rows.slice(0, limit);
    if (r.rows.length > shown.length) truncated = true;
    rows.push(...shown);
    if (r.untrusted) untrusted.push(...r.untrusted.filter((u) => shown.some((s) => s.type === u.type && s.id === u.id)));
  });
  const capped = cap(rows);
  return {
    data: { results: capped.rows, not_searched: notSearched },
    totals,
    scope: { query: text, types: searched.map((r) => r.type), per_type_limit: limit, classes_only: ctx.scoped ? "your own classes (students, parents, classes and subjects)" : null },
    truncated: truncated || capped.truncated,
    ...(untrusted.length ? { untrusted: { announcements: untrusted } } : {}),
  };
}

// ── get_student_profile ─────────────────────────────────────────────────────────────────
async function currentTerm(db, organizationId) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.term_name FROM terms t LEFT JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1 AND t.current = TRUE
      ORDER BY COALESCE(sy.current, FALSE) DESC, t.start_date DESC NULLS LAST, t.term_id DESC LIMIT 1`,
    [organizationId]
  ).catch(() => ({ rows: [] }));
  return rows[0] ? { id: Number(rows[0].term_id), name: rows[0].term_name } : null;
}

// The school's grade bands for a class and term (score_remarks), the nearest one for a percentage,
// else the US scale (commonController's loadGradeLabelResolver, which isn't exported).
async function gradeResolver(db, organizationId, classId, termId) {
  const { rows } = await db.query(
    `SELECT from_percentage, to_percentage, TRIM(grade_label) AS grade_label FROM score_remarks
      WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND NULLIF(TRIM(grade_label), '') IS NOT NULL`,
    [organizationId, classId, termId]
  ).catch(() => ({ rows: [] }));
  const bands = rows.map((r) => ({ from: Number(r.from_percentage), to: Number(r.to_percentage), label: r.grade_label }));
  const us = (p) => (p >= 90 ? "A" : p >= 80 ? "B" : p >= 70 ? "C" : p >= 60 ? "D" : "F");
  return (p) => {
    let best = null;
    let bestDistance = Infinity;
    bands.forEach((band) => {
      const distance = !Number.isFinite(band.from) || !Number.isFinite(band.to) ? Infinity
        : p >= band.from && p <= band.to ? 0 : p < band.from ? band.from - p : p - band.to;
      if (best === null || distance < bestDistance || (distance === bestDistance && band.from > best.from)) { best = band; bestDistance = distance; }
    });
    return best && best.label ? best.label : us(p);
  };
}

// The student page's grades: the student's subjects this term (a teacher who isn't the class's
// main or assistant teacher: only the subjects they teach), each subject's marks so far.
async function gradesFor(db, actor, student, term, scope) {
  const organizationId = orgOf(actor);
  const classId = Number(student.class_id) || null;
  const limited = scope && classId && !scope.mainClasses.has(classId);
  const { rows: subjects } = limited
    ? await db.query(
      `SELECT s.subject_id, s.subject_name FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id
        WHERE us.user_id = $1 AND s.class_id = $2 AND s.organization_id = $3 ORDER BY s.subject_name`,
      [actor.userId, classId, organizationId]
    )
    : await db.query(
      `SELECT DISTINCT s.subject_id, s.subject_name FROM student_subjects_in_term($3::int) ss JOIN subjects s ON s.subject_id = ss.subject_id
        WHERE ss.student_id = $1 AND ss.organization_id = $2 AND ($4::int IS NULL OR s.class_id IS NULL OR s.class_id = $4::int)
        ORDER BY s.subject_name`,
      [student.student_id, organizationId, term.id, classId]
    );
  if (!subjects.length || !classId) return { subjects: [], limitedToYourSubjects: Boolean(limited) };
  const { rows: marks } = await db.query(
    `SELECT DISTINCT ON (a.assessment_id) a.assessment_id, a.subject_id, a.max_score, ar.score
       FROM assessments a LEFT JOIN assessment_results ar ON ar.assessment_id = a.assessment_id AND ar.student_id = $1
      WHERE a.subject_id = ANY($2::int[]) AND a.organization_id = $3 AND a.term_id = $4
      ORDER BY a.assessment_id`,
    [student.student_id, subjects.map((s) => s.subject_id), organizationId, term.id]
  );
  const grade = await gradeResolver(db, organizationId, classId, term.id);
  const out = subjects.map((s) => {
    const own = marks.filter((m) => Number(m.subject_id) === Number(s.subject_id));
    const scored = own.filter((m) => m.score !== null && m.score !== undefined && m.score !== "");
    const total = scored.reduce((n, m) => n + Number(m.score || 0), 0);
    const max = scored.reduce((n, m) => n + Number(m.max_score || 0), 0);
    const pct = scored.length && max > 0 ? Math.round((total / max) * 1000) / 10 : null;
    return { subject: s.subject_name, assessments: own.length, marked: scored.length, score: scored.length ? Math.round(total * 100) / 100 : null, out_of: scored.length ? Math.round(max * 100) / 100 : null, percent: pct, grade: pct === null ? null : grade(pct) };
  });
  return { subjects: out, limitedToYourSubjects: Boolean(limited) };
}

// The PayGira student ledger, from its own page handler (financeController.studentDetailGet).
function ledgerFor(actor, studentId) {
  const finance = require("../../controllers/financeController");
  const req = { ...reqFor(actor), params: { id: String(studentId) }, protocol: "https", get: () => "" };
  return new Promise((resolve, reject) => {
    let status = 200;
    const timer = setTimeout(() => reject(new Error("The ledger took too long.")), 20000);
    if (timer.unref) timer.unref();
    const res = {
      locals: { publicImageUrl: () => null, formatDisplayDate: (value) => dayText(value) },
      status(code) { status = code; return res; },
      set() { return res; },
      json(body) { clearTimeout(timer); resolve({ status, body }); return res; },
    };
    Promise.resolve(finance.studentDetailGet(req, res)).catch((error) => { clearTimeout(timer); reject(error); });
  });
}

const LEDGER_KEYS = [P.PAYGIRA_BILLS, P.PAYGIRA_ORG_BILLS, P.PAYGIRA_PAYMENTS, P.PAYGIRA_RECORD_PAYMENTS, P.PAYGIRA_RECOVERY];

async function studentProfile(db, actor, q) {
  const ctx = contextFor(db, actor);
  if (ctx.driver) throw new ReadError("PERMISSION_DENIED", "Drivers can't open student profiles from Mira.");
  if (!(await holds(db, actor, P.MANAGE_STUDENTS))) throw new ReadError("PERMISSION_DENIED", "You need the Manage Students permission to open a student.");
  const organizationId = orgOf(actor);
  const mine = await ctx.mine();
  const student = await resolveStudent(db, actor, q, mine, { scopeLabel: mine ? "of your classes" : "of your school" });
  const sid = Number(student.student_id);
  const term = await currentTerm(db, organizationId);
  const hidden = [];
  const untrusted = {};
  const data = {};
  const totals = {};

  // Basics and class, as the person card shows them.
  const [archive, lead, assistants, group] = await Promise.all([
    require("../studentArchive").getStudentArchiveStatus(db, organizationId, sid).catch(() => null),
    student.class_id ? db.query(
      `SELECT u.first_name, u.last_name FROM user_classes uc JOIN users u ON u.user_id = uc.user_id
        WHERE uc.class_id = $1 AND uc.main = TRUE AND u.organization_id = $2 AND COALESCE(u.on_hold, FALSE) = FALSE AND u.removed_at IS NULL LIMIT 1`,
      [student.class_id, organizationId]
    ).then((r) => r.rows[0] || null).catch(() => null) : null,
    student.class_id && (await require("../mainTeacher").assistantReady(db)) ? db.query(
      `SELECT u.first_name, u.last_name FROM user_classes uc JOIN users u ON u.user_id = uc.user_id
        WHERE uc.class_id = $1 AND uc.assistant = TRUE AND u.organization_id = $2 AND COALESCE(u.on_hold, FALSE) = FALSE AND u.removed_at IS NULL
        ORDER BY u.first_name, u.last_name`,
      [student.class_id, organizationId]
    ).then((r) => r.rows).catch(() => []) : [],
    student.graduation_year_group_id ? db.query("SELECT name FROM graduation_year_groups WHERE id = $1 AND organization_id = $2", [student.graduation_year_group_id, organizationId]).then((r) => r.rows[0] || null).catch(() => null) : null,
  ]);
  data.basics = {
    student_id: sid,
    name: student.name,
    school_student_id: student.custom_student_id || null,
    class: student.class_name || null,
    class_id: Number(student.class_id) || null,
    gender: student.gender || null,
    date_of_birth: student.date_of_birth_unknown ? null : dayText(student.date_of_birth),
    email: student.email || null,
    status: archive ? archive.label : "Current student",
    graduation_year_group: group ? group.name : null,
    main_teacher: lead ? nameOf(lead) : null,
    assistant_teachers: assistants.map(nameOf),
  };

  // Birthday.
  const dob = student.date_of_birth_unknown ? null : dayText(student.date_of_birth);
  if (dob) {
    const today = todayKey();
    const [y, m, d] = dob.split("-").map(Number);
    const thisYear = Number(today.slice(0, 4));
    let next = `${thisYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (next < today) next = `${thisYear + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const days = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    data.birthday = { date_of_birth: dob, next_birthday: next, days_until: days, turns: Number(next.slice(0, 4)) - y };
  } else {
    data.birthday = null;
  }

  // Parents and guardians: their names to anyone who can open the student (the person card); contact
  // details where the guardian page or contact card shows them; the address with Manage Guardians.
  const [manages, seeContacts] = await Promise.all([
    holds(db, actor, P.MANAGE_GUARDIANS).then((ok) => ok || isManagerLikeRole(actor.userRole) || isManagerLikeRole(actor.accountType)),
    holds(db, actor, P.SEE_CONTACTS).then(async (ok) => ok || holds(db, actor, P.EDIT_CONTACTS)),
  ]);
  if (manages || seeContacts || mine) {
    const { rows } = await db.query(
      `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.phone, gp.email, gp.address, gs.relationship
         FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $2
        WHERE gs.student_id = $1 ORDER BY LOWER(gp.first_name), LOWER(gp.last_name), gp.guardian_id`,
      [sid, organizationId]
    );
    data.guardians = rows.map((g) => ({
      guardian_id: Number(g.guardian_id), name: nameOf(g), relationship: g.relationship || null,
      phone: g.phone || null, email: g.email || null, ...(manages ? { address: g.address || null } : {}),
    }));
    totals.guardians = rows.length;
    if (!manages) hidden.push({ section: "guardians.address", needs: "Manage Guardians" });
  } else {
    hidden.push({ section: "guardians", needs: "Manage Guardians or See Contacts" });
  }

  // This term's attendance (and lunch): Mark Attendance or Manage Students as on get_attendance; a
  // teacher only for a class they lead (main or assistant), as the class attendance page.
  const tScope = await classScope.teacherScope(db, ctx.req);
  const svcOn = student.class_id ? await require("../schoolServices").classServices(db, organizationId, Number(student.class_id)) : await require("../schoolServices").services(db, organizationId);
  const attendanceOk = (await holds(db, actor, P.MARK_ATTENDANCE)) || (!tScope && (await holds(db, actor, P.MANAGE_STUDENTS)));
  const leads = !tScope || (student.class_id && tScope.mainClasses.has(Number(student.class_id)));
  if (!svcOn.attendance && !svcOn.lunch) {
    // The school keeps both elsewhere: nothing to show, and nothing to ask permission for.
  } else if (!term) {
    data.attendance = null;
    hidden.push({ section: "attendance", needs: "a current term (none is set)" });
  } else if (attendanceOk && leads) {
    data.attendance = {};
    if (svcOn.attendance) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS days, COUNT(*) FILTER (WHERE present)::int AS present
           FROM (SELECT date, BOOL_OR(status::text = 'Present') AS present FROM attendance_records
                  WHERE organization_id = $1 AND student_id = $2 AND term_id = $3 GROUP BY date) d`,
        [organizationId, sid, term.id]
      );
      const days = Number(rows[0].days) || 0;
      const present = Number(rows[0].present) || 0;
      data.attendance = { term: term.name, days_taken: days, present, absent: days - present, percent_present: days ? Math.round((present / days) * 1000) / 10 : null };
    } else {
      data.attendance = { term: term.name };
    }
    if (svcOn.lunch) {
      const lunch = require("../overallLunch");
      const total = (await lunch.totalsFor(db, organizationId, term.id, [sid]).catch(() => new Map())).get(sid);
      data.attendance.lunch = total ? { days_with_lunch: total.days, days_taken: total.taken, label: lunch.label(total) } : null;
    }
  } else {
    hidden.push({ section: "attendance", needs: attendanceOk ? "leading the student's class (main or assistant teacher)" : "Mark Attendance" });
  }

  // This term's grades, as the student page shows them to this person.
  if (term) {
    data.grades = { term: term.name, ...(await gradesFor(db, actor, student, term, tScope)) };
    totals.subjects = data.grades.subjects.length;
  } else {
    data.grades = null;
  }

  // Fee balance: the PayGira student ledger (Main PayGira and one of its ledger pages).
  const [workspace, ...ledgerKeys] = await Promise.all([holds(db, actor, P.PAYGIRA_WORKSPACE), ...LEDGER_KEYS.map((key) => holds(db, actor, key))]);
  if (workspace && ledgerKeys.some(Boolean)) {
    const [ledger, paid, currency] = await Promise.all([
      ledgerFor(actor, sid).catch(() => null),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE is_refund IS NOT TRUE)::int AS n, COALESCE(SUM(amount) FILTER (WHERE is_refund IS NOT TRUE), 0) AS paid,
                COALESCE(SUM(amount) FILTER (WHERE is_refund IS TRUE), 0) AS refunded
           FROM finance_payments WHERE organization_id = $1 AND student_id = $2`,
        [organizationId, sid]
      ).then((r) => r.rows[0]).catch(() => null),
      db.query("SELECT organization_currency FROM organizations WHERE organization_id = $1", [organizationId]).then((r) => r.rows[0]?.organization_currency || null).catch(() => null),
    ]);
    if (ledger && ledger.status === 200 && ledger.body && Array.isArray(ledger.body.bills)) {
      const today = todayKey();
      const bills = ledger.body.bills.map((b) => ({
        title: b.title, type: b.bill_type || null, due: dayText(b.due_date), status: b.status,
        billed: money(b.amount), balance: money(b.balance), overdue: Boolean(b.due_date && dayText(b.due_date) < today && Number(b.balance) > 0),
      }));
      data.fees = {
        currency,
        bills: bills.slice(0, 50),
        balance: money(bills.reduce((n, b) => n + b.balance, 0)),
        billed: money(bills.reduce((n, b) => n + b.billed, 0)),
        overdue_balance: money(bills.filter((b) => b.overdue).reduce((n, b) => n + b.balance, 0)),
        credit: money(ledger.body.credit),
        payments: paid ? { count: Number(paid.n) || 0, paid: money(paid.paid), refunded: money(paid.refunded) } : null,
      };
      totals.bills = bills.length;
    } else {
      data.fees = null;
      hidden.push({ section: "fees", needs: "the PayGira ledger, which couldn't be read just now" });
    }
  } else {
    hidden.push({ section: "fees", needs: "Main PayGira with Student Ledger (or Bills, Payments, Record Payments or Overdue Balances)" });
  }

  // Transportation: while the school has it switched on (the student page's card).
  if (await require("../integrationSwitches").isOn(db, organizationId, "transportation").catch(() => false)) {
    const { getStudentTransportationSnapshot } = require("../../controllers/transportationController");
    const snap = await getStudentTransportationSnapshot(db, organizationId, sid).catch(() => null);
    data.transport = snap ? {
      bus: snap.bus ? { bus_number: snap.bus.busNumber, status: snap.bus.status } : null,
      route: snap.route ? { name: snap.route.routeName, code: snap.route.routeCode || null } : null,
      stop: snap.stop ? { name: snap.stop.stopName } : null,
      pickup_time: snap.pickupTime || null,
      dropoff_time: snap.dropoffTime || null,
      driver: snap.driverName || null,
    } : { assigned: false };
  } else {
    hidden.push({ section: "transport", needs: TRANSPORT_OFF });
  }

  // Files on the student's record: managers-only files for managers and supervisors.
  const docs = require("../studentDocuments");
  if (await docs.ready(db)) {
    const list = await docs.listFor(db, organizationId, sid, { req: ctx.req }).catch(() => []);
    data.files = list.map((f) => ({ id: f.id, type: f.typeLabel, title: f.title, expires_on: f.expiresOn, expired: f.expired, expires_soon: f.expiresSoon, who_sees: f.sharingLabel, added: dayText(f.uploadedAt) }));
    const notes = list.filter((f) => f.note).map((f) => ({ file_id: f.id, note: f.note }));
    if (notes.length) untrusted.file_notes = notes;
    totals.files = list.length;
  } else {
    hidden.push({ section: "files", needs: "Student files, which aren't on for this school" });
  }

  // Forms still to fill in this period (the Custom editor), among the forms this person can see.
  const cf = require("../customForms");
  if ((await cf.ready(db)) && student.class_id && !archive) {
    const builder = await holds(db, actor, P.CUSTOM_FORMS);
    const reach = await cf.staffReach(db, ctx.req, { builder });
    const outstanding = [];
    for (const audience of ["parent", "student"]) {
      const visible = new Set(cf.sectionsForStaff(await cf.liveFor(db, organizationId, audience), reach)
        .filter((s) => s.filledBy === audience && cf.inSection(s, student.class_id)).map((s) => s.id));
      if (!visible.size) continue;
      const todo = await cf.toDoMany(db, organizationId, [{ id: sid, classId: Number(student.class_id) }], audience);
      (todo.get(sid) || []).filter((f) => visible.has(f.id)).forEach((f) => outstanding.push({
        form_id: f.id, form: f.name, filled_by: audience, due: f.dueDate || null, required: Boolean(f.required), overdue: Boolean(f.dueDate && f.dueDate < todayKey()),
      }));
    }
    data.forms_outstanding = outstanding;
    totals.forms_outstanding = outstanding.length;
  } else {
    data.forms_outstanding = [];
    totals.forms_outstanding = 0;
  }

  return {
    data: { ...data, hidden_sections: hidden },
    totals,
    scope: { student_id: sid, term: term ? term.name : null, classes_only: Boolean(mine), features: { student_documents: true } },
    truncated: Boolean(data.fees && totals.bills > 50),
    ...(Object.keys(untrusted).length ? { untrusted } : {}),
  };
}

// ── get_staff_profile ───────────────────────────────────────────────────────────────────
// The person card's teaching rows: classes led or assisted, and the classes of their subjects.
async function teachingOf(db, organizationId, userId) {
  const { rows } = await db.query(
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
  return rows;
}
function byClass(rows) {
  const out = new Map();
  rows.forEach((t) => {
    const entry = out.get(Number(t.class_id)) || { class_id: Number(t.class_id), class: t.class_name, role: "", subjects: [] };
    if (t.main) entry.role = "Main teacher";
    else if (t.assistant && entry.role !== "Main teacher") entry.role = "Assistant teacher";
    if (t.subject_name && !entry.subjects.includes(t.subject_name)) entry.subjects.push(t.subject_name);
    out.set(Number(t.class_id), entry);
  });
  return [...out.values()].map((e) => ({ ...e, role: e.role || (e.subjects.length ? "Subject teacher" : "Assigned") }))
    .sort((a, b) => String(a.class).localeCompare(String(b.class)));
}

const SELF_WORDS = /^(me|myself|my|mine|i|my profile|my own)$/i;

async function staffProfile(db, actor, q) {
  const ctx = contextFor(db, actor);
  if (ctx.driver) throw new ReadError("PERMISSION_DENIED", "Drivers can't open staff profiles from Mira.");
  const organizationId = orgOf(actor);
  const manages = await holds(db, actor, P.MANAGE_EMPLOYEES);
  const typed = textOf(q.person);
  let id = idOf(q.staffId);
  if (!id && typed && SELF_WORDS.test(typed)) id = ctx.self;
  if (!id && !typed) throw new ReadError("VALIDATION", "Name the member of staff (person) or give their id (staffId).");

  // The school's own account (most owners sign in as it): with Manage Employees, or yourself when
  // you're signed in as it (its session's user id is the school's id).
  const signedInAsSchool = String(actor.accountType || "").trim().toLowerCase() === "organization";
  if (id && id === organizationId && (manages || (signedInAsSchool && id === ctx.self))) {
    const { rows } = await db.query("SELECT organization_name, first_name, last_name, email FROM organizations WHERE organization_id = $1", [organizationId]);
    if (rows[0]) {
      return {
        data: { person: { staff_id: organizationId, name: nameOf(rows[0]) || rows[0].organization_name, role: "Manager", kind: "School account", email: rows[0].email || null }, view: "full", classes: [] },
        totals: { classes: 0 }, scope: { view: "full" }, truncated: false,
      };
    }
  }

  // Who this person may see: everyone with Manage Employees; otherwise yourself and colleagues who
  // share one of your classes. Names are matched only among them.
  const mine = manages ? null : await ctx.mine();
  const params = [organizationId];
  let where = "";
  if (id) { params.push(id); where = `u.user_id = $${params.length}`; }
  else {
    const names = nameClause("u", typed, params);
    params.push(typed.toLowerCase());
    where = `(${names} OR LOWER(u.email) = $${params.length})`;
  }
  let visibleSql = "";
  if (!manages) {
    params.push(ctx.self || 0, mine ? [...mine] : []);
    visibleSql = colleaguesSql(`$${params.length - 1}`, `$${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type::text AS account_type, u.phone_number, u.org_role_title,
            COALESCE(u.on_hold, FALSE) AS on_hold
       FROM users u WHERE u.organization_id = $1 AND u.removed_at IS NULL AND ${where} ${visibleSql}
      ORDER BY LOWER(u.last_name), LOWER(u.first_name), u.user_id LIMIT 500`,
    params
  );
  const people = rows.map((r) => ({ ...r, name: nameOf(r) }));
  if (!people.length) {
    let near = [];
    if (typed) {
      const pool = (await db.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.account_type::text AS account_type FROM users u
          WHERE u.organization_id = $1 AND u.removed_at IS NULL ${manages ? "" : colleaguesSql("$2", "$3")}`,
        manages ? [organizationId] : [organizationId, ctx.self || 0, mine ? [...mine] : []]
      )).rows.map((r) => ({ id: Number(r.user_id), name: nameOf(r), role: r.account_type }));
      near = closest(typed, pool);
    }
    const who = manages ? "in your school" : "who shares a class with you (without Manage Employees you can see only yourself and those colleagues)";
    throw new ReadError("NOT_FOUND", `No member of staff ${id ? `with id ${id}` : `matching "${typed}"`} ${who}.${near.length ? ` Closest: ${listNames(near, (r) => `${r.role}, id ${r.id}`)}.` : ""}`);
  }
  const u = id ? people[0] : pickOne(people, typed, "staff", (r) => `${r.org_role_title || r.account_type}, id ${r.user_id}`);
  const userId = Number(u.user_id);
  const isSelf = userId === ctx.self;
  const full = manages || isSelf;
  const teaching = await teachingOf(db, organizationId, userId);
  const shown = full ? teaching : teaching.filter((t) => mine && mine.has(Number(t.class_id)));
  const classes = byClass(shown);
  const subjects = [...new Set(shown.filter((t) => t.subject_name).map((t) => t.subject_name))].sort();

  let canModify = null;
  if (manages && !isSelf && (await holds(db, actor, P.EMPLOYEES_EDIT))) {
    const refusal = await require("../staffChangeGuard").staffChangeRefusal(db, ctx.req, userId).catch(() => "refused");
    canModify = !refusal;
  }
  const about = require("../staffAbout");
  let untrusted;
  let aboutMe = null;
  if (about.isOn(organizationId) && (await about.ready(db))) {
    const mineAbout = await about.get(db, organizationId, userId).catch(() => null);
    if (mineAbout) {
      aboutMe = { has_fun_fact: Boolean(mineAbout.funFact), photos: mineAbout.photos.length };
      if (mineAbout.funFact) untrusted = { about_me: { fun_fact: mineAbout.funFact } };
    }
  }
  const person = {
    staff_id: userId,
    name: u.name,
    role: u.org_role_title || u.account_type,
    account_type: u.account_type,
    email: u.email || null,
    ...(full ? { phone: u.phone_number || null, on_hold: Boolean(u.on_hold) } : {}),
    is_you: isSelf,
  };
  return {
    data: {
      view: full ? "full" : "colleague",
      person,
      classes,
      subjects_taught: subjects,
      about_me: aboutMe,
      ...(canModify === null ? {} : { can_modify_in_users_employees: canModify }),
      ...(full ? {} : { note: "Without Manage Employees you see a colleague's name, role, email and the classes you share." }),
    },
    totals: { classes: classes.length, subjects: subjects.length, main_teacher_of: classes.filter((c) => c.role === "Main teacher").length, assistant_in: classes.filter((c) => c.role === "Assistant teacher").length },
    scope: { view: full ? "full" : "classes you share" },
    truncated: false,
    ...(untrusted ? { untrusted } : {}),
  };
}

// ── get_class_staff ─────────────────────────────────────────────────────────────────────
async function classStaff(db, actor, q) {
  const ctx = contextFor(db, actor);
  if (ctx.driver) throw new ReadError("PERMISSION_DENIED", "Drivers can't open classes from Mira.");
  const organizationId = orgOf(actor);
  const canClasses = ctx.scoped || ctx.manager || (await holds(db, actor, P.MANAGE_CLASSES_SUBJECTS));
  if (!canClasses) throw new ReadError("PERMISSION_DENIED", "You need the Manage Classes & Subjects permission to open a class's staff.");
  const mine = ctx.scoped ? await ctx.mine() : null;
  const manages = await holds(db, actor, P.MANAGE_EMPLOYEES);
  const { rows: all } = await db.query(
    `SELECT class_id, class_name, obsolete_at IS NOT NULL AS retired FROM classes WHERE organization_id = $1
      ORDER BY obsolete_at IS NOT NULL, COALESCE(dashboard_sort_order, 2147483647), class_name, class_id`,
    [organizationId]
  );
  const classes = all.map((r) => ({ id: Number(r.class_id), name: r.class_name, retired: r.retired }));
  const id = idOf(q.classId);
  const typed = textOf(q.class);
  if (!id && !typed) throw new ReadError("VALIDATION", "Name the class (class), e.g. \"Grade 6\" or \"6A\", or give its id (classId).");
  let picked;
  if (id) picked = classes.filter((c) => c.id === id);
  else {
    const { matchClasses } = require("../formRequests");
    picked = matchClasses(classes.filter((c) => !c.retired), typed);
    if (!picked.length) picked = matchClasses(classes, typed);
  }
  const offered = mine ? classes.filter((c) => mine.has(c.id)) : classes.filter((c) => !c.retired);
  if (!picked.length) {
    throw new ReadError("NOT_FOUND", `No class ${id ? `with id ${id}` : `matches "${typed}"`} in your school. ${mine ? "Your classes" : "Classes"}: ${offered.slice(0, 40).map((c) => c.name).join(", ") || "none"}.`);
  }
  const visible = mine ? picked.filter((c) => mine.has(c.id)) : picked;
  if (!visible.length) {
    throw new ReadError("PERMISSION_DENIED", `You can see only your own classes; ${picked.map((c) => c.name).join(", ")} ${picked.length === 1 ? "isn't" : "aren't"} one of them. Yours: ${offered.map((c) => c.name).join(", ") || "none"}.`);
  }
  const shownClasses = visible.slice(0, 20);
  const ids = shownClasses.map((c) => c.id);
  const assistantCol = await require("../mainTeacher").assistantReady(db);
  // Each class's people: led, assisted, or teaching one of its subjects this term. Never drivers or
  // removed accounts; people on hold only for someone with Manage Employees (marked as such).
  const { rows } = await db.query(
    `SELECT x.class_id, u.user_id, u.first_name, u.last_name, u.email, u.phone_number, u.account_type::text AS account_type, u.org_role_title,
            COALESCE(u.on_hold, FALSE) AS on_hold, BOOL_OR(x.main) AS main, BOOL_OR(x.assistant) AS assistant,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT x.subject_name), NULL) AS subjects
       FROM (
         SELECT uc.class_id, uc.user_id, COALESCE(uc.main, FALSE) AS main, ${assistantCol ? "COALESCE(uc.assistant, FALSE)" : "FALSE"} AS assistant, NULL::text AS subject_name
           FROM user_classes uc WHERE uc.class_id = ANY($2::int[])
         UNION ALL
         SELECT s.class_id, us.user_id, FALSE, FALSE, s.subject_name
           FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id AND s.organization_id = $1
           LEFT JOIN terms t ON t.term_id = s.term_id
          WHERE s.class_id = ANY($2::int[]) AND s.obsolete_at IS NULL
            AND (s.term_id IS NULL OR t.current OR NOT EXISTS (SELECT 1 FROM terms t2 WHERE t2.organization_id = $1 AND t2.current))
       ) x
       JOIN users u ON u.user_id = x.user_id AND u.organization_id = $1
      WHERE u.removed_at IS NULL AND LOWER(u.account_type::text) <> 'driver' ${manages ? "" : "AND COALESCE(u.on_hold, FALSE) = FALSE"}
      GROUP BY x.class_id, u.user_id
      ORDER BY x.class_id, BOOL_OR(x.main) DESC, BOOL_OR(x.assistant) DESC, LOWER(u.first_name), LOWER(u.last_name)`,
    [organizationId, ids]
  );
  // Each person's other classes (teaching load): all of them with Manage Employees, otherwise only
  // the classes you share with them, as their person card shows.
  const people = [...new Set(rows.map((r) => Number(r.user_id)))];
  const { rows: load } = people.length ? await db.query(
    `SELECT x.user_id, c.class_id, c.class_name FROM (
        SELECT uc.user_id, uc.class_id FROM user_classes uc WHERE uc.user_id = ANY($2::int[])
        UNION
        SELECT us.user_id, s.class_id FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id AND s.organization_id = $1
          LEFT JOIN terms t ON t.term_id = s.term_id
         WHERE us.user_id = ANY($2::int[]) AND s.obsolete_at IS NULL
           AND (s.term_id IS NULL OR t.current OR NOT EXISTS (SELECT 1 FROM terms t2 WHERE t2.organization_id = $1 AND t2.current))
      ) x JOIN classes c ON c.class_id = x.class_id AND c.organization_id = $1
      ORDER BY c.class_name`,
    [organizationId, people]
  ) : { rows: [] };
  const loadOf = (userId) => load.filter((l) => Number(l.user_id) === userId && (manages || !mine || mine.has(Number(l.class_id))));
  const out = shownClasses.map((c) => {
    const staff = rows.filter((r) => Number(r.class_id) === c.id).map((r) => {
      const userId = Number(r.user_id);
      const other = loadOf(userId).filter((l) => Number(l.class_id) !== c.id);
      return {
        staff_id: userId,
        name: nameOf(r),
        role_in_class: r.main ? "Main teacher" : r.assistant ? "Assistant teacher" : "Subject teacher",
        subjects: (r.subjects || []).sort(),
        role: r.org_role_title || r.account_type,
        email: r.email || null,
        ...(manages ? { phone: r.phone_number || null, on_hold: Boolean(r.on_hold) } : {}),
        other_classes: other.map((l) => l.class_name),
        ...(manages ? { classes_total: loadOf(userId).length } : {}),
      };
    });
    const main = staff.filter((s) => s.role_in_class === "Main teacher");
    return {
      class_id: c.id,
      class: c.name,
      main_teacher: main[0] ? main[0].name : null,
      nobody_in_charge: !main.length,
      assistants: staff.filter((s) => s.role_in_class === "Assistant teacher").map((s) => s.name),
      staff,
    };
  });
  return {
    data: { classes: out, ...(manages ? {} : { note: "Other classes list only the classes you share with each colleague; people on hold aren't shown." }) },
    totals: { classes: out.length, classes_matched: visible.length, staff: people.length, without_main_teacher: out.filter((c) => c.nobody_in_charge).length },
    scope: { classes: out.map((c) => c.class), asked: typed || id, your_classes_only: Boolean(mine), classes_not_yours: picked.filter((c) => !visible.includes(c)).map((c) => c.name) },
    truncated: visible.length > shownClasses.length,
  };
}

// ── Families: who may see which parents ─────────────────────────────────────────────────
// office: Manage Guardians (the whole school, everything); contacts: See Contacts (the Mailroom's
// contacts, the contact card); class: a teacher or supervisor (parents of their classes' students,
// only those children, never the address).
async function familyAccess(db, actor, ctx) {
  if (ctx.driver) throw new ReadError("PERMISSION_DENIED", "Drivers see families only for their own riders, on the driver's page; Mira can't open them.");
  const manages = (await holds(db, actor, P.MANAGE_GUARDIANS)) || isManagerLikeRole(actor.userRole) || isManagerLikeRole(actor.accountType);
  if (manages) return { tier: "office", mine: null };
  const see = (await holds(db, actor, P.SEE_CONTACTS)) || (await holds(db, actor, P.EDIT_CONTACTS));
  if (see) {
    const mailroom = require("../../controllers/guardianMessagingController");
    const restricted = await mailroom.getMailroomAllowedClassIdsFor({ orgId: orgOf(actor), userId: actor.userId, userRole: actor.userRole, accountType: actor.accountType });
    const map = await mailroom.getMailroomContactsMap(orgOf(actor), restricted);
    const profiles = new Set([...map.keys()].filter((k) => k.startsWith("profile:")).map((k) => Number(k.slice(8))));
    return { tier: "contacts", profiles, restricted };
  }
  const mine = await ctx.mine();
  if (mine) return { tier: "class", mine };
  throw new ReadError("PERMISSION_DENIED", "You need the Manage Guardians or See Contacts permission to see families.");
}

// The Parents & guardians list's portal status: no login, setup pending (never signed in to set
// their password), or active. Map guardianId -> { status, accepted, lastSignIn, loginAdded }.
async function portalStatus(db, organizationId, guardianIds) {
  const ids = [...new Set(guardianIds.map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const [accounts, logins] = await Promise.all([
    db.query(
      `SELECT guardian_id, BOOL_AND(COALESCE(must_reset_password, FALSE)) AS must_reset, MIN(created_at) AS created_at
         FROM guardian_accounts WHERE organization_id = $1 AND guardian_id = ANY($2::int[]) GROUP BY guardian_id`,
      [organizationId, ids]
    ).then((r) => r.rows),
    db.query(
      `SELECT user_id, MAX(created_at) AS last_login FROM organization_activity_logs
        WHERE organization_id = $1 AND action_type = 'Login' AND user_role = 'Guardian' AND user_id = ANY($2::int[])
        GROUP BY user_id`,
      [organizationId, ids]
    ).then((r) => r.rows).catch(() => []),
  ]);
  const account = new Map(accounts.map((r) => [Number(r.guardian_id), r]));
  const last = new Map(logins.map((r) => [Number(r.user_id), r.last_login]));
  ids.forEach((id) => {
    const a = account.get(id);
    const lastLogin = last.get(id) || null;
    const status = !a ? "No login" : a.must_reset && !lastLogin ? "Setup pending" : "Active";
    out.set(id, {
      status,
      accepted: status === "Active",
      last_sign_in: lastLogin ? new Date(lastLogin).toISOString().slice(0, 10) : null,
      login_added: a && a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : null,
    });
  });
  return out;
}

const answerText = (field, value) => (field.type === "yes_no" ? (value === "yes" ? "Yes" : value === "no" ? "No" : "") : String(value || ""));

// ── get_family ──────────────────────────────────────────────────────────────────────────
async function family(db, actor, q) {
  const ctx = contextFor(db, actor);
  const access = await familyAccess(db, actor, ctx);
  const organizationId = orgOf(actor);
  const parentAllowed = (gid) => access.tier !== "contacts" || access.profiles.has(Number(gid));
  let parents;
  let viaStudent = null;

  if (q.student || q.studentId) {
    // The student, among those whose families this person may see.
    const mine = access.tier === "class" ? access.mine : access.tier === "contacts" && access.restricted ? new Set(access.restricted) : null;
    const student = await resolveStudent(db, actor, q, mine, { scopeLabel: mine ? "whose families you can see" : "of your school" });
    viaStudent = { student_id: Number(student.student_id), name: student.name, class: student.class_name || null };
    const { rows } = await db.query(
      `SELECT gp.guardian_id FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $2
        WHERE gs.student_id = $1 ORDER BY gp.guardian_id`,
      [student.student_id, organizationId]
    );
    parents = rows.map((r) => Number(r.guardian_id)).filter(parentAllowed);
    if (!parents.length) {
      return { data: { student: viaStudent, parents: [] }, totals: { parents: 0 }, scope: { tier: access.tier, student: viaStudent.name }, truncated: false };
    }
  } else {
    const id = idOf(q.guardianId);
    const typed = textOf(q.guardian);
    if (!id && !typed) throw new ReadError("VALIDATION", "Name the parent (guardian) or the student (student), or give an id (guardianId or studentId).");
    const params = [organizationId];
    let where;
    if (id) { params.push(id); where = `gp.guardian_id = $2`; }
    else {
      const names = nameClause("gp", typed, params);
      params.push(typed.toLowerCase());
      where = `(${names} OR LOWER(TRIM(COALESCE(gp.email, ''))) = $${params.length})`;
    }
    const { rows } = await db.query(
      `SELECT gp.guardian_id, gp.first_name, gp.last_name,
              COALESCE(json_agg(json_build_object('id', s.student_id, 'name', TRIM(CONCAT(s.first_name, ' ', s.last_name))))
                       FILTER (WHERE s.student_id IS NOT NULL), '[]'::json) AS kids
         FROM guardian_profiles gp
         LEFT JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
         LEFT JOIN students s ON s.student_id = gs.student_id AND s.organization_id = gp.organization_id
        WHERE gp.organization_id = $1 AND ${where}
        GROUP BY gp.guardian_id ORDER BY LOWER(gp.last_name), LOWER(gp.first_name), gp.guardian_id LIMIT 2000`,
      params
    );
    let found = rows.filter((r) => parentAllowed(r.guardian_id));
    if (access.tier === "class") {
      // A teacher or supervisor: parents of their classes' students, and only those children.
      const inScope = await keepStudents(db, actor, found.flatMap((r) => r.kids.map((k) => k.id)), access.mine);
      found = found.map((r) => ({ ...r, kids: r.kids.filter((k) => inScope.has(Number(k.id))) })).filter((r) => r.kids.length);
    }
    found = found.map((r) => ({ ...r, name: nameOf(r) }));
    if (!found.length) {
      let near = [];
      if (typed) {
        const pool = (await db.query(
          `SELECT gp.guardian_id, gp.first_name, gp.last_name, ARRAY_REMOVE(ARRAY_AGG(gs.student_id), NULL) AS kids
             FROM guardian_profiles gp LEFT JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
            WHERE gp.organization_id = $1 GROUP BY gp.guardian_id`,
          [organizationId]
        )).rows.filter((r) => parentAllowed(r.guardian_id));
        let visiblePool = pool;
        if (access.tier === "class") {
          const inScope = await keepStudents(db, actor, pool.flatMap((r) => r.kids || []), access.mine);
          visiblePool = pool.filter((r) => (r.kids || []).some((k) => inScope.has(Number(k))));
        }
        near = closest(typed, visiblePool.map((r) => ({ id: Number(r.guardian_id), name: nameOf(r) })));
      }
      const among = access.tier === "office" ? "in your school" : access.tier === "contacts" ? "in your contact list" : "of your classes' students";
      throw new ReadError("NOT_FOUND", `No parent or guardian ${id ? `with id ${id}` : `matching "${typed}"`} ${among}.${near.length ? ` Closest: ${listNames(near, (r) => `id ${r.id}`)}.` : ""}`);
    }
    const one = id ? found[0] : pickOne(found, typed, "parents", (r) => `id ${r.guardian_id}${r.kids.length ? `, parent of ${r.kids.map((k) => k.name).slice(0, 3).join(", ")}` : ""}`);
    parents = [Number(one.guardian_id)];
  }

  // Each parent: contact details, children, portal status, and their contact sections.
  const { rows: people } = await db.query(
    `SELECT guardian_id, first_name, last_name, phone, email, address FROM guardian_profiles WHERE organization_id = $1 AND guardian_id = ANY($2::int[])`,
    [organizationId, parents]
  );
  const { rows: kids } = await db.query(
    `SELECT gs.guardian_id, gs.relationship, s.student_id, s.first_name, s.last_name, c.class_name, COALESCE(s.graduated, FALSE) AS graduated
       FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $1
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = $1
      WHERE gs.guardian_id = ANY($2::int[]) ORDER BY s.first_name, s.last_name`,
    [organizationId, parents]
  );
  const kidsInScope = access.tier === "class" ? await keepStudents(db, actor, kids.map((k) => k.student_id), access.mine) : null;
  const status = access.tier === "contacts" ? null : await portalStatus(db, organizationId, parents);
  const contacts = require("../contacts");
  const untrusted = { contact_details: [] };
  let pickup = null;
  if (access.tier === "class") {
    pickup = await contacts.familyDetailsForStudents(db, organizationId, [...(kidsInScope || [])], "teachers").catch(() => new Map());
  }
  const order = new Map(parents.map((id, i) => [id, i]));
  const out = [];
  for (const p of people.sort((a, b) => order.get(Number(a.guardian_id)) - order.get(Number(b.guardian_id)))) {
    const gid = Number(p.guardian_id);
    const children = kids.filter((k) => Number(k.guardian_id) === gid && (!kidsInScope || kidsInScope.has(Number(k.student_id))));
    const entry = {
      guardian_id: gid,
      name: nameOf(p),
      phone: p.phone || null,
      email: p.email || null,
      ...(access.tier !== "class" ? { address: p.address || null } : {}),
      children: children.map((k) => ({ student_id: Number(k.student_id), name: nameOf(k), class: k.class_name || null, relationship: k.relationship || null, ...(k.graduated ? { status: "Graduated / left" } : {}) })),
      ...(status ? { portal: status.get(gid) } : {}),
    };
    if (access.tier !== "class") {
      // The contact card: every section and field the school keeps on a parent.
      const card = await contacts.readContact(db, organizationId, [{ key: `profile:${gid}`, source: "profile", id: gid }]).catch(() => null);
      if (card) {
        const sectionName = new Map((card.sections || []).map((s) => [s.id, s.name]));
        const filled = (card.fields || []).filter((f) => f.value).map((f) => ({ section: sectionName.get(f.sectionId) || "More details", field: f.label, value: answerText(f, f.value), ...(f.obsolete ? { obsolete: true } : {}) }));
        if (filled.length) untrusted.contact_details.push({ guardian_id: gid, details: filled });
        entry.details_on_file = filled.length;
      }
    }
    out.push(entry);
  }
  if (pickup) {
    // Emergency & pickup: only the sections the school shares with teachers (the class Pickup list).
    out.forEach((entry) => {
      const items = [];
      entry.children.forEach((child) => {
        (pickup.get(child.student_id) || []).filter((person) => person.name.toLowerCase() === entry.name.toLowerCase())
          .forEach((person) => person.sections.forEach((sec) => sec.items.forEach((item) => items.push({ section: sec.name, field: item.label, value: item.value }))));
      });
      const unique = items.filter((item, i) => items.findIndex((x) => x.section === item.section && x.field === item.field) === i);
      if (unique.length) untrusted.contact_details.push({ guardian_id: entry.guardian_id, details: unique });
      entry.details_on_file = unique.length;
    });
  }
  const hidden = [];
  if (access.tier === "class") hidden.push({ section: "address", needs: "Manage Guardians" }, { section: "contact details beyond what's shared with teachers", needs: "Manage Guardians or See Contacts" });
  if (access.tier === "contacts") hidden.push({ section: "portal status", needs: "Manage Guardians" });
  return {
    data: { ...(viaStudent ? { student: viaStudent } : {}), parents: out, hidden_sections: hidden },
    totals: { parents: out.length, children: out.reduce((n, p) => n + p.children.length, 0), ...(status ? { accepted: out.filter((p) => p.portal && p.portal.accepted).length } : {}) },
    scope: { tier: access.tier, ...(access.tier === "class" ? { children: "your classes only" } : {}) },
    truncated: false,
    ...(untrusted.contact_details.length ? { untrusted } : {}),
  };
}

// ── list_family_invitations ─────────────────────────────────────────────────────────────
async function familyInvitations(db, actor, q) {
  const ctx = contextFor(db, actor);
  if (ctx.driver) throw new ReadError("PERMISSION_DENIED", "Drivers can't see families' portal invitations.");
  const organizationId = orgOf(actor);
  // The Parents & guardians list (Manage Guardians), or a teacher or supervisor for their classes,
  // as the guardian page shows them each parent's portal status.
  const manages = (await holds(db, actor, P.MANAGE_GUARDIANS)) || isManagerLikeRole(actor.userRole) || isManagerLikeRole(actor.accountType);
  const mine = manages ? null : await ctx.mine();
  if (!manages && !mine) throw new ReadError("PERMISSION_DENIED", "You need the Manage Guardians permission to see families' portal invitations.");
  const want = ["accepted", "all"].includes(String(q.status)) ? String(q.status) : "not_accepted";

  const { rows: all } = await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY class_name", [organizationId]);
  const classes = all.map((r) => ({ id: Number(r.class_id), name: r.class_name }));
  const typed = textOf(q.classes);
  const ids = String(q.classIds || "").split(",").map(idOf).filter(Boolean);
  let picked = classes;
  if (ids.length) picked = classes.filter((c) => ids.includes(c.id));
  else if (typed) picked = require("../formRequests").matchClasses(classes, typed);
  if ((ids.length || typed) && !picked.length) {
    throw new ReadError("NOT_FOUND", `No class matches "${typed || ids.join(", ")}". ${mine ? "Your classes" : "Classes"}: ${(mine ? classes.filter((c) => mine.has(c.id)) : classes).slice(0, 40).map((c) => c.name).join(", ")}.`);
  }
  const visible = mine ? picked.filter((c) => mine.has(c.id)) : picked;
  if (!visible.length) {
    throw new ReadError("PERMISSION_DENIED", mine && mine.size ? `You can see only your own classes; ${picked.map((c) => c.name).join(", ")} ${picked.length === 1 ? "isn't" : "aren't"} one of them.` : "You have no classes assigned.");
  }
  const whole = !typed && !ids.length && !mine;
  const { activeStudentSql } = require("../activeStudents");
  // Current students of these classes (the whole school's current students when no class was named).
  const { rows: students } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.class_id FROM students s
      WHERE s.organization_id = $1 AND ${activeStudentSql("s")} ${whole ? "" : "AND s.class_id = ANY($2::int[])"}`,
    whole ? [organizationId] : [organizationId, visible.map((c) => c.id)]
  );
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const studentIds = students.map((s) => Number(s.student_id));
  const { rows: links } = studentIds.length ? await db.query(
    `SELECT gs.guardian_id, gs.student_id, gp.first_name, gp.last_name, gp.email, gp.phone
       FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
      WHERE gs.student_id = ANY($2::int[])`,
    [organizationId, studentIds]
  ) : { rows: [] };
  const studentById = new Map(students.map((s) => [Number(s.student_id), s]));
  const parents = new Map();
  links.forEach((l) => {
    const gid = Number(l.guardian_id);
    const entry = parents.get(gid) || { guardian_id: gid, name: nameOf(l), email: l.email || null, phone: l.phone || null, children: [] };
    const s = studentById.get(Number(l.student_id));
    if (s && !entry.children.some((k) => k.student_id === Number(s.student_id))) entry.children.push({ student_id: Number(s.student_id), name: nameOf(s), class: className.get(Number(s.class_id)) || null });
    parents.set(gid, entry);
  });
  const status = await portalStatus(db, organizationId, [...parents.keys()]);
  const everyone = [...parents.values()].map((p) => ({ ...p, ...status.get(p.guardian_id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const counts = { "No login": 0, "Setup pending": 0, Active: 0 };
  everyone.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
  const acceptedStudents = new Set(everyone.filter((p) => p.accepted).flatMap((p) => p.children.map((k) => k.student_id)));
  const listed = want === "all" ? everyone : everyone.filter((p) => (want === "accepted" ? p.accepted : !p.accepted));
  const { rows, truncated } = cap(listed.map((p) => ({
    guardian_id: p.guardian_id, name: p.name, email: p.email, phone: p.phone, status: p.status, accepted: p.accepted,
    last_sign_in: p.last_sign_in, login_added: p.login_added, children: p.children,
  })), ROW_MAX);
  return {
    data: { parents: rows, listed: want },
    totals: {
      parents: everyone.length,
      accepted: counts.Active,
      not_accepted: counts["No login"] + counts["Setup pending"],
      no_login: counts["No login"],
      setup_pending: counts["Setup pending"],
      listed: listed.length,
      students_in_scope: students.length,
      students_with_no_parent_linked: students.filter((s) => !links.some((l) => Number(l.student_id) === Number(s.student_id))).length,
      students_with_no_parent_accepted: students.filter((s) => !acceptedStudents.has(Number(s.student_id))).length,
    },
    scope: {
      classes: whole ? "every class (current students)" : visible.map((c) => c.name),
      classes_not_yours: (typed || ids.length) && picked.length > visible.length ? picked.filter((c) => !visible.includes(c)).map((c) => c.name) : [],
      status_rule: "Accepted = Active on Parents & guardians (set their password or signed in); not accepted = No login or Setup pending.",
    },
    truncated,
  };
}

module.exports = {
  // GET /internal/api/read/search_records?query=smith&types=students,guardians&limit=8
  search_records: { run: searchRecords },
  // GET /internal/api/read/get_student_profile?student=Ana%20Diaz | studentId=10001
  get_student_profile: { run: studentProfile },
  // GET /internal/api/read/get_staff_profile?person=Dante | staffId=1026
  get_staff_profile: { run: staffProfile },
  // GET /internal/api/read/get_class_staff?class=Grade%206 | classId=1017
  get_class_staff: { run: classStaff },
  // GET /internal/api/read/get_family?guardian=... | guardianId= | student=... | studentId=
  get_family: { run: family },
  // GET /internal/api/read/list_family_invitations?classes=Grade%206&status=not_accepted|accepted|all
  list_family_invitations: { run: familyInvitations },
};
