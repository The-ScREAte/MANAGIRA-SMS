"use strict";

// Forms & requests status for staff and Mira (GET /internal/api/forms/status, POST /internal/api/forms/remind):
// for a class (or classes, or the whole school), every live Custom editor form the school asked
// parents or students to fill in, who still has it to do this period and who has done it. The
// same rules as the parents' and students' Requests tab (customForms.toDoMany: a repeating form
// counts this period's answer only) and the same reach as the staff Forms page (customForms.staffReach:
// Custom Editor holders, managers, supervisors and the school's own account see every class; a
// teacher sees the classes they're assigned to; drivers see none of these). Totals are worked out
// here over the whole scope, never from a shortened list.

const cf = require("./customForms");

const STUDENT_LIST_MAX = 500;

class FormsError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

// ── Which classes a phrase like "Grade 6", "6A", "JHS 1", "Primary 6" or "Kindergarten" means ──
// "Grade 6" means every Grade 6 class (6A, 6B, "6th Grade"); "6A" means that section only; a
// level word that names a kind of class (JHS, SHS, Form, KG...) must be in the class's name.
const LEVEL_WORDS = ["jhs", "shs", "form", "kg", "kindergarten", "nursery", "prek", "pre k", "reception", "creche", "middle", "high", "elementary"];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/-/g, " ")
  .replace(/\b([a-z]{2,})(\d)/g, "$1 $2").replace(/\s+/g, " ").trim();
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
function numberIn(text) {
  const t = norm(text);
  const digit = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s?([a-f])?\b/);
  if (digit) return { n: Number(digit[1]), section: digit[2] || "" };
  const word = Object.keys(ORDINALS).find((w) => new RegExp(`\\b${w}\\b`).test(t));
  return word ? { n: ORDINALS[word], section: "" } : null;
}
// A class's own grade: the number its name opens with ("6A", "6th Grade"), or the one after a
// grade word at the start ("Grade 6 - Room 1", "Primary 6", "JHS 1", "Year 3", "Class 2B").
// "Birch Class 1" or "Room 6 Art" aren't a grade.
const GRADE_START = /^(?:(?:grade|gr|primary|basic|year|yr|class|std|standard|level|form|jhs|shs|kg|p|g)\s*)?(\d{1,2})(?:st|nd|rd|th)?\s?([a-f])?\b/;
function gradeOf(name) {
  const m = norm(name).match(GRADE_START);
  return m ? { n: Number(m[1]), section: m[2] || "" } : null;
}

const levelsIn = (text) => {
  const t = ` ${norm(text)} `;
  return LEVEL_WORDS.filter((w) => t.includes(` ${w} `) || (w === "kg" && /\bkg\d?\b/.test(t))).map((w) => (w === "pre k" ? "prek" : w === "kindergarten" ? "kg" : w));
};

function matchClasses(classes, query) {
  const q = norm(query);
  if (!q || /^(all|every class|all classes|whole school|the whole school|school)$/.test(q)) return classes;
  const exact = classes.filter((c) => norm(c.name) === q);
  if (exact.length) return exact;
  const wanted = numberIn(q);
  const levels = levelsIn(q);
  const hits = classes.filter((c) => {
    const name = c.name;
    const classLevels = levelsIn(name);
    // The person named a kind of class (JHS 1): the class must be that kind.
    if (levels.length && !levels.every((l) => classLevels.includes(l))) return false;
    // They didn't (Grade 1): a JHS or SHS class isn't a "Grade 1".
    if (!levels.length && wanted && classLevels.some((l) => ["jhs", "shs", "form", "kg", "nursery", "prek", "reception", "creche"].includes(l))) return false;
    if (!wanted) return levels.length > 0;
    const has = gradeOf(name);
    if (!has || has.n !== wanted.n) return false;
    if (wanted.section && has.section && wanted.section !== has.section) return false;
    if (wanted.section && !has.section) return false;
    return true;
  });
  if (hits.length) return hits;
  return classes.filter((c) => norm(c.name).includes(q));
}

// ── The person and their reach ─────────────────────────────────────────────────────────────
async function reachOf(db, actor) {
  const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
  const role = String(actor.userRole || actor.accountType || "").trim().toLowerCase();
  if (role === "driver") throw new FormsError("PERMISSION_DENIED", "Drivers can't see parents' and students' forms.", 403);
  const [builder, students] = await Promise.all([
    userHasPermission(db, actor, PERMISSIONS.CUSTOM_FORMS).catch(() => false),
    userHasPermission(db, actor, PERMISSIONS.MANAGE_STUDENTS).catch(() => false),
  ]);
  if (!builder && !students) throw new FormsError("PERMISSION_DENIED", "You need the Custom Editor or Manage Students permission to see form completion.", 403);
  const req = { session: { userId: actor.userId, userRole: actor.userRole, accountType: actor.accountType, organizationId: actor.organizationId } };
  return cf.staffReach(db, req, { builder });
}

// ── Status ───────────────────────────────────────────────────────────────────────────────
// options: { classQuery, classIds, formId, formQuery, audience: parent|student|all, status: outstanding|completed|all, day }
async function status(db, actor, options = {}) {
  const organizationId = Number(actor.organizationId);
  if (!(await cf.ready(db))) throw new FormsError("PLAN_FEATURE_OFF", "Forms (the Custom editor) aren't on for this school.", 404);
  const reach = await reachOf(db, actor);
  const { rows: allClasses } = await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name", [organizationId]);
  const classes = allClasses.map((r) => ({ id: Number(r.class_id), name: r.class_name }));
  let picked = classes;
  const ids = (Array.isArray(options.classIds) ? options.classIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length) picked = classes.filter((c) => ids.includes(c.id));
  else if (options.classQuery) picked = matchClasses(classes, options.classQuery);
  if ((ids.length || options.classQuery) && !picked.length) {
    throw new FormsError("NOT_FOUND", `No class matches "${options.classQuery || ids.join(", ")}". Classes: ${classes.slice(0, 40).map((c) => c.name).join(", ")}.`, 404);
  }
  const visible = reach.all ? picked : picked.filter((c) => reach.classes.has(c.id));
  if (!visible.length) {
    throw new FormsError("PERMISSION_DENIED", picked.length ? `You can see forms only for your own classes; ${picked.map((c) => c.name).join(", ")} ${picked.length === 1 ? "isn't" : "aren't"} one of them.` : "You have no classes assigned.", 403);
  }
  const classIds = visible.map((c) => c.id);
  const className = new Map(visible.map((c) => [c.id, c.name]));
  const audiences = options.audience === "student" ? ["student"] : options.audience === "all" ? ["parent", "student"] : ["parent"];
  const want = ["completed", "all"].includes(options.status) ? options.status : "outstanding";

  const { rows: studentRows } = await db.query(
    `SELECT student_id, first_name, last_name, class_id FROM students
      WHERE organization_id = $1 AND class_id = ANY($2::int[]) AND COALESCE(graduated, FALSE) = FALSE
      ORDER BY LOWER(last_name), LOWER(first_name), student_id`,
    [organizationId, classIds]
  );
  const students = studentRows.map((r) => ({ id: Number(r.student_id), classId: Number(r.class_id), name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() }));
  const today = options.day || new Date().toISOString().slice(0, 10);

  const byForm = [];
  const outstandingByStudent = new Map();
  // Every live form for these classes, per audience; a form named that matches none is NOT_FOUND
  // (never "every form": a reminder must never go out for a form nobody named).
  const live = [];
  for (const audience of audiences) {
    const sections = cf.sectionsForStaff(await cf.liveFor(db, organizationId, audience), reach)
      .filter((s) => s.filledBy === audience && (!s.classIds.length || s.classIds.some((id) => classIds.includes(id))));
    live.push({ audience, sections });
  }
  if (options.formId || options.formQuery) {
    const fq = norm(options.formQuery);
    const words = fq.split(" ").filter((w) => w.length > 2 && !["form", "forms", "the", "and", "for", "slip"].includes(w));
    const named = (s) => (options.formId ? s.id === Number(options.formId)
      : norm(s.name).includes(fq) || fq.includes(norm(s.name)) || (words.length > 0 && words.every((w) => norm(s.name).includes(w))));
    live.forEach((entry) => { entry.sections = entry.sections.filter(named); });
    if (!live.some((entry) => entry.sections.length)) {
      const titles = [];
      for (const audience of audiences) {
        cf.sectionsForStaff(await cf.liveFor(db, organizationId, audience), reach)
          .filter((s) => s.filledBy === audience && (!s.classIds.length || s.classIds.some((id) => classIds.includes(id))))
          .forEach((s) => titles.push(s.name));
      }
      throw new FormsError("NOT_FOUND", `No live form matching "${options.formQuery || options.formId}" was asked in ${visible.map((c) => c.name).join(", ")}.${titles.length ? ` Forms there: ${titles.slice(0, 30).join(", ")}.` : " No forms are live there."}`, 404);
    }
  }
  for (const { audience, sections } of live) {
    if (!sections.length) continue;
    const todo = await cf.toDoMany(db, organizationId, students, audience, { day: today });
    for (const section of sections) {
      const eligible = students.filter((st) => cf.inSection(section, st.classId));
      const outstanding = eligible.filter((st) => (todo.get(st.id) || []).some((t) => t.id === section.id));
      const overdue = Boolean(section.dueDate && section.dueDate < today);
      byForm.push({
        formId: section.id, title: section.name, audience, dueDate: section.dueDate || null, required: Boolean(section.required),
        repeats: section.repeat || "once", overdue, studentsAsked: eligible.length, outstanding: outstanding.length, completed: eligible.length - outstanding.length,
      });
      outstanding.forEach((st) => {
        const list = outstandingByStudent.get(st.id) || [];
        list.push({ formId: section.id, title: section.name, audience, dueDate: section.dueDate || null, overdue });
        outstandingByStudent.set(st.id, list);
      });
    }
  }

  const withOutstanding = students.filter((st) => outstandingByStudent.has(st.id));
  const listed = want === "outstanding" ? withOutstanding : want === "completed" ? students.filter((st) => !outstandingByStudent.has(st.id)) : students;
  const shown = listed.slice(0, STUDENT_LIST_MAX).map((st) => ({
    studentId: st.id, name: st.name, class: className.get(st.classId) || "",
    outstanding: outstandingByStudent.get(st.id) || [],
  }));
  return {
    asOf: new Date().toISOString(),
    scope: {
      classes: visible.map((c) => c.name),
      classesNotYours: picked.length > visible.length ? picked.filter((c) => !visible.includes(c)).map((c) => c.name) : [],
      audience: audiences.join(" and "),
      whole: !options.classQuery && !ids.length,
    },
    totals: {
      studentsInScope: students.length,
      formsAsked: byForm.length,
      studentsWithOutstanding: withOutstanding.length,
      studentsAllDone: students.length - withOutstanding.length,
      formsOutstanding: byForm.reduce((n, f) => n + f.outstanding, 0),
      overdueOutstanding: byForm.filter((f) => f.overdue).reduce((n, f) => n + f.outstanding, 0),
    },
    byForm,
    students: shown,
    listed: want,
    truncated: listed.length > shown.length,
  };
}

// ── Reminders: only the families still outstanding for one parent form, in the classes in reach ─
async function remind(db, actor, { formId, classQuery = null, classIds = null, siteUrl = "" }) {
  const organizationId = Number(actor.organizationId);
  if (!(await cf.ready(db))) throw new FormsError("PLAN_FEATURE_OFF", "Forms (the Custom editor) aren't on for this school.", 404);
  const reach = await reachOf(db, actor);
  const section = await cf.getSection(db, organizationId, Number(formId));
  if (!section || section.status !== "live") throw new FormsError("NOT_FOUND", "That form isn't live.", 404);
  if (section.filledBy !== "parent") throw new FormsError("VALIDATION", "Reminders go to families, for forms parents fill in.", 400);
  if (!cf.sectionsForStaff([section], reach).length) throw new FormsError("PERMISSION_DENIED", "That form isn't one you can see.", 403);
  let target = null;
  if (classQuery || (classIds && classIds.length)) {
    const { rows } = await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1", [organizationId]);
    const all = rows.map((r) => ({ id: Number(r.class_id), name: r.class_name }));
    const picked = classIds && classIds.length ? all.filter((c) => classIds.map(Number).includes(c.id)) : matchClasses(all, classQuery);
    if (!picked.length) throw new FormsError("NOT_FOUND", `No class matches "${classQuery || classIds.join(", ")}".`, 404);
    target = new Set(picked.map((c) => c.id));
  }
  let reachClasses = reach.all ? target : new Set([...reach.classes].filter((id) => !target || target.has(id)));
  if (reachClasses && !reachClasses.size) throw new FormsError("PERMISSION_DENIED", "None of those classes are yours.", 403);
  const period = { ...(await cf.currentPeriod(db, organizationId)) };
  const sent = await cf.remindMissing(db, { organizationId, section, reachClasses, siteUrl, email: true, period });
  return { sent, form: section.name };
}

module.exports = { FormsError, status, remind, matchClasses, STUDENT_LIST_MAX };
