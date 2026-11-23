"use strict";
// Mira's academic reads: gradebook scores, report card status, transcripts, GPA, class schedules,
// lunch and attendance summaries (GET /internal/api/read/<tool>). Each reads what the person's own
// page shows them, behind the same permission as that page's route, and keeps a teacher to the
// classes (and, in the gradebook, the subjects) their pages open:
//   get_scores              /common/assessment         Manage Assessments, requireClassScope
//   get_report_card_status  /print/postReportCards,    Terminal Reports (canOpenReportCards); a
//                           /print/emailHistory        teacher's history only for their classes
//   get_transcript          /transcript/transcript/:id Generate Transcripts
//   get_gpa                 report cards / transcripts Terminal Reports or Generate Transcripts
//   get_class_schedule      /common/classSchedule      every member of staff (not drivers)
//   get_lunch               /common/attendanceCollection  Mark Attendance, requireLeadsClass
//   get_attendance_summary  /common/attendanceCollection  Mark Attendance, requireLeadsClass
// The school is always the caller's own (actor.organizationId); nothing here takes a school from
// its arguments. Totals are worked out over the whole scope, rows are capped (ROW_MAX).

const { ReadError, needAny, reqFor, cap, isDriver, ROW_MAX } = require("./index");
const features = require("../shards/features");
const classScope = require("../classScope");

const on = (key, actor) => features.isOn(key, { organizationId: actor.organizationId });
const text = (value, max = 160) => String(value === undefined || value === null ? "" : Array.isArray(value) ? value.join(",") : value).trim().slice(0, max);
const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const round2 = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
const nameOf = (row) => [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || `Student ${row.student_id}`;
const listOf = (names, max = 12) => (names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", "));

function oneOf(value, allowed, fallback) {
  const v = text(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return fallback;
  if (!allowed.includes(v)) throw new ReadError("VALIDATION", `status must be one of: ${allowed.join(", ")}.`);
  return v;
}

function noDrivers(actor, what) {
  if (isDriver(actor)) throw new ReadError("PERMISSION_DENIED", `Drivers can't see ${what}.`);
}

// A teacher's classes and subjects (utils/classScope.js), or null for everyone else (their
// permissions decide).
async function teacherScope(db, actor) {
  return classScope.teacherScope(db, reqFor(actor));
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────
const todayKey = (actor) => require("../localDate").todayKeyFor(reqFor(actor));
const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// "2026-10-05", or a month ("2026-10": its first day for `from`, its last for `to`).
function parseDay(value, label, end = false) {
  const raw = text(value, 20);
  if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw) return raw;
  }
  m = raw.match(/^(\d{4})-(\d{2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    if (!end) return `${raw}-01`;
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
    return last.toISOString().slice(0, 10);
  }
  throw new ReadError("VALIDATION", `${label} must be a date like 2026-10-05 (or a month like 2026-10).`);
}

// ── Terms: by name (optionally with its school year), id, or the current term ─────────────
const TERM_SQL = `
  SELECT t.term_id, t.term_name, t.start_date::text AS start_key, t.end_date::text AS end_key, t.school_year_id,
         sy.year_label, (COALESCE(t.current, FALSE) AND COALESCE(sy.current, FALSE)) AS is_current,
         COALESCE(sy.current, FALSE) AS year_current
    FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
   WHERE t.organization_id = $1`;
const termLabel = (t) => (t.year_label ? `${t.term_name} (${t.year_label})` : t.term_name);
const termOut = (t) => ({ id: Number(t.term_id), name: t.term_name, school_year: t.year_label, start: t.start_key, end: t.end_key, current: Boolean(t.is_current) });

async function resolveTerm(db, organizationId, value) {
  const raw = text(value, 80);
  if (!raw || /^(current|current term|this term|now)$/i.test(raw)) {
    // The gradebook's current term: the current term of the current school year, else today's.
    const { rows } = await db.query(
      `${TERM_SQL} AND ((t.current AND sy.current) OR (t.start_date <= CURRENT_DATE AND t.end_date >= CURRENT_DATE))
       ORDER BY (COALESCE(t.current, FALSE) AND COALESCE(sy.current, FALSE)) DESC, t.start_date DESC LIMIT 1`,
      [organizationId]
    );
    if (!rows[0]) throw new ReadError("NOT_FOUND", "Your school has no current term. Name a term, or set one as current in Management › School years & terms.");
    return rows[0];
  }
  const { rows: all } = await db.query(`${TERM_SQL} ORDER BY t.start_date DESC NULLS LAST, t.term_id DESC LIMIT 300`, [organizationId]);
  if (/^\d+$/.test(raw)) {
    const hit = all.find((t) => Number(t.term_id) === Number(raw));
    if (hit) return hit;
  }
  const q = norm(raw);
  const withYear = all.filter((t) => norm(`${t.term_name} ${t.year_label}`) === q || norm(`${t.year_label} ${t.term_name}`) === q);
  if (withYear.length === 1) return withYear[0];
  // The same term name in several school years: the current year's, else the latest.
  const prefer = (list) => list.find((t) => t.year_current) || list[0];
  const exact = all.filter((t) => norm(t.term_name) === q);
  if (exact.length) return prefer(exact);
  const partial = all.filter((t) => norm(`${t.term_name} ${t.year_label}`).includes(q));
  if (partial.length && new Set(partial.map((t) => norm(t.term_name))).size === 1) return prefer(partial);
  if (partial.length > 1) throw new ReadError("AMBIGUOUS", `"${raw}" could be: ${listOf(partial.map(termLabel), 10)}. Which term?`);
  throw new ReadError("NOT_FOUND", `No term named "${raw}". Your school's terms: ${listOf(all.map(termLabel), 10) || "none yet"}.`);
}

// Terms that overlap a date range, oldest first.
async function termsOverlapping(db, organizationId, from, to) {
  const { rows } = await db.query(`${TERM_SQL} AND t.start_date <= $2::date AND t.end_date >= $3::date ORDER BY t.start_date`, [organizationId, to, from]);
  return rows;
}

// ── Classes, subjects, students ──────────────────────────────────────────────────────────
async function schoolClasses(db, organizationId) {
  const { rows } = await db.query(
    `SELECT class_id, class_name, obsolete_at IS NOT NULL AS obsolete FROM classes WHERE organization_id = $1
      ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name`,
    [organizationId]
  );
  return rows.map((r) => ({ id: Number(r.class_id), name: r.class_name, obsolete: Boolean(r.obsolete) }));
}

// People's words for classes ("Grade 6", "6A, 7B", an id, "all") through matchClasses, kept to
// `reach` (a Set of class ids, null = every class). A class named outside reach is refused.
async function pickClasses(db, actor, value, reach, why = "") {
  const { matchClasses } = require("../formRequests");
  const all = await schoolClasses(db, actor.organizationId);
  const open = all.filter((c) => !c.obsolete);
  const inReach = (c) => !reach || reach.has(c.id);
  const yours = open.filter(inReach).map((c) => c.name);
  const raw = text(value, 400);
  if (!raw || /^(all|all classes|every class|whole school|the whole school|school|my classes|all my classes|all of them)$/i.test(raw)) {
    const list = open.filter(inReach);
    if (!list.length) {
      if (reach) throw new ReadError("PERMISSION_DENIED", `You don't have a class you can open here${why}.`);
      throw new ReadError("NOT_FOUND", "Your school has no classes yet.");
    }
    return { classes: list, leftOut: [], unknown: [] };
  }
  const picked = new Map();
  const unknown = [];
  const whole = open.filter((c) => norm(c.name) === norm(raw));
  if (whole.length) whole.forEach((c) => picked.set(c.id, c));
  else {
    raw.split(/\s*[,;]\s*/).filter(Boolean).forEach((piece) => {
      if (/^\d+$/.test(piece)) {
        const c = all.find((x) => x.id === Number(piece));
        if (c) picked.set(c.id, c); else unknown.push(piece);
        return;
      }
      const hits = matchClasses(open, piece);
      if (hits.length) hits.forEach((c) => picked.set(c.id, c)); else unknown.push(piece);
    });
  }
  if (!picked.size) {
    throw new ReadError("NOT_FOUND", `No class matches "${raw}". ${reach ? "Classes you can open" : "Your school's classes"}: ${listOf(yours) || "none"}.`);
  }
  const list = [...picked.values()];
  const allowed = list.filter(inReach);
  if (!allowed.length) {
    if (!yours.length) throw new ReadError("PERMISSION_DENIED", `You don't have a class you can open here${why}.`);
    throw new ReadError("PERMISSION_DENIED", `You can see only your own classes${why}: ${listOf(yours)}.`);
  }
  return { classes: allowed, leftOut: list.filter((c) => !inReach(c)).map((c) => c.name), unknown };
}

// A student by id, the school's own student id, or name (within reach: a teacher finds only the
// students of their classes, classScope.studentsInClasses). Several matches ask which one.
async function findStudent(db, actor, value, reach) {
  const raw = text(value, 120);
  if (!raw) throw new ReadError("VALIDATION", "Name the student.");
  const org = actor.organizationId;
  const phrase = raw.includes(",") ? raw.split(",").map((s) => s.trim()).filter(Boolean).reverse().join(" ") : raw;
  const like = `%${phrase.replace(/[%_\\]/g, "\\$&").replace(/\s+/g, "%")}%`;
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.custom_student_id, s.class_id, c.class_name,
            COALESCE(s.graduated, FALSE) AS graduated,
            ($3::int IS NOT NULL AND s.student_id = $3::int) OR LOWER(COALESCE(s.custom_student_id, '')) = LOWER($2) AS by_id,
            LOWER(CONCAT_WS(' ', s.first_name, s.last_name)) = LOWER($2) OR LOWER(CONCAT_WS(' ', s.last_name, s.first_name)) = LOWER($2) AS exact
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1
        AND (($3::int IS NOT NULL AND s.student_id = $3::int) OR LOWER(COALESCE(s.custom_student_id, '')) = LOWER($2)
             OR CONCAT_WS(' ', s.first_name, s.last_name) ILIKE $4 OR CONCAT_WS(' ', s.last_name, s.first_name) ILIKE $4)
      ORDER BY 8 DESC, 9 DESC, COALESCE(s.graduated, FALSE), s.last_name, s.first_name
      LIMIT 80`,
    [org, phrase, id, like]
  );
  let found = rows;
  if (reach) {
    const ok = await classScope.studentsInClasses(db, org, rows.map((r) => r.student_id), [...reach]);
    found = rows.filter((r) => ok.has(Number(r.student_id)));
  }
  const describe = (r) => `${nameOf(r)} (${r.class_name || (r.graduated ? "graduated" : "no class")}, id ${r.student_id})`;
  const byId = found.filter((r) => r.by_id);
  if (byId.length === 1) return byId[0];
  const exact = found.filter((r) => r.exact);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new ReadError("AMBIGUOUS", `${exact.length} students are named ${phrase}: ${listOf(exact.map(describe), 10)}. Which one?`);
  if (found.length === 1) return found[0];
  if (found.length > 1) throw new ReadError("AMBIGUOUS", `"${raw}" matches ${found.length}${found.length === 80 ? "+" : ""} students: ${listOf(found.map(describe), 10)}. Which one?`);
  // Nothing: the closest names (any word of it at the start of a first or last name).
  const words = phrase.split(/\s+/).filter((w) => w.length >= 2).slice(0, 4).map((w) => `${w.replace(/[%_\\]/g, "\\$&")}%`);
  let close = [];
  if (words.length) {
    const near = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.class_id, c.class_name, COALESCE(s.graduated, FALSE) AS graduated
         FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
        WHERE s.organization_id = $1 AND (s.first_name ILIKE ANY($2::text[]) OR s.last_name ILIKE ANY($2::text[]))
        ORDER BY COALESCE(s.graduated, FALSE), s.last_name, s.first_name LIMIT 40`,
      [org, words]
    );
    close = near.rows;
    if (reach) {
      const ok = await classScope.studentsInClasses(db, org, close.map((r) => r.student_id), [...reach]);
      close = close.filter((r) => ok.has(Number(r.student_id)));
    }
  }
  throw new ReadError("NOT_FOUND", `No student matching "${raw}"${reach ? " in your classes" : ""}.${close.length ? ` Closest: ${listOf(close.slice(0, 5).map(describe), 5)}.` : ""}`);
}

// The classes a student was enrolled in for a term.
async function studentClassesInTerm(db, organizationId, studentId, termId) {
  const { rows } = await db.query(
    `SELECT DISTINCT es.class_id FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
      WHERE es.student_id = $1 AND e.term_id = $2 AND e.organization_id = $3`,
    [studentId, termId, organizationId]
  );
  return rows.map((r) => Number(r.class_id));
}

// ── The gradebook (commonController.assessment) ─────────────────────────────────────────
// Every student enrolled in the class that term (graduates only for a term that isn't current)
// against every assessment of the class, subject and term, with the result the gradebook shows:
// the actual score staff see (a score waiting for approval is marked, never hidden). Params:
// $1 org, $2 term, $3 class ids, $4 subject ids, $5 term is current, $6 one student or null.
const GRADEBOOK_STUDENTS_CTE = `
    st AS (
      SELECT DISTINCT es.student_id, es.class_id
        FROM enrolled_students es
        JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        JOIN students s ON s.student_id = es.student_id AND s.organization_id = $1
       WHERE e.organization_id = $1 AND e.term_id = $2 AND es.class_id = ANY($3::int[])
         AND (s.graduated = FALSE OR NOT $5::boolean)
         AND ($6::int IS NULL OR es.student_id = $6::int)
    )`;
function gradebookCtes(flow) {
  return `${GRADEBOOK_STUDENTS_CTE},
    a AS (
      SELECT assessment_id, class_id, subject_id, COALESCE(max_score, 0)::numeric AS max_score, obsolete_at, title, category,
             COALESCE(entry_mode, 'score') AS entry_mode
        FROM assessments
       WHERE organization_id = $1 AND term_id = $2 AND class_id = ANY($3::int[]) AND subject_id = ANY($4::int[])
    ),
    cells AS (
      SELECT st.student_id, st.class_id, a.subject_id, a.assessment_id, a.max_score, a.obsolete_at, a.title, a.category, a.entry_mode,
             ar.score, ar.choice_label,
             ${flow ? "ar.pending_since, ar.pending_source" : "NULL::timestamptz AS pending_since, NULL::text AS pending_source"},
             (ar.score IS NOT NULL OR NULLIF(TRIM(COALESCE(ar.choice_label, '')), '') IS NOT NULL) AS entered
        FROM st JOIN a ON a.class_id = st.class_id
        LEFT JOIN assessment_results ar ON ar.assessment_id = a.assessment_id AND ar.student_id = st.student_id
    )`;
}

// A subject's total as the gradebook adds it (entered scores over their maximums) and its grade
// from the class's grade bands for the term (Report Settings), else the US scale. The band order
// is getGradeLabelFromScoreRemark's (controllers/commonController.js), which isn't exported.
const SUBJECT_TOTALS_SQL = `
    totals AS (
      SELECT student_id, class_id, subject_id,
             COUNT(*)::int AS assessments,
             COUNT(*) FILTER (WHERE entered)::int AS entered,
             COUNT(*) FILTER (WHERE NOT entered AND obsolete_at IS NULL)::int AS missing,
             COUNT(*) FILTER (WHERE entered AND pending_since IS NOT NULL)::int AS waiting,
             SUM(score) FILTER (WHERE score IS NOT NULL) AS total,
             SUM(max_score) FILTER (WHERE score IS NOT NULL) AS max_total
        FROM cells GROUP BY student_id, class_id, subject_id
    ),
    graded AS (
      SELECT t.*, CASE WHEN t.max_total > 0 THEN t.total * 100 / t.max_total END AS pct
        FROM totals t
    ),
    banded AS (
      SELECT g.*,
             CASE WHEN g.pct IS NULL THEN NULL ELSE COALESCE(NULLIF(band.label, ''),
               CASE WHEN g.pct >= 90 THEN 'A' WHEN g.pct >= 80 THEN 'B' WHEN g.pct >= 70 THEN 'C' WHEN g.pct >= 60 THEN 'D' ELSE 'F' END) END AS grade
        FROM graded g
        LEFT JOIN LATERAL (
          SELECT TRIM(sr.grade_label) AS label
            FROM score_remarks sr
           WHERE sr.organization_id = $1 AND sr.class_id = g.class_id AND sr.term_id = $2
             AND NULLIF(TRIM(sr.grade_label), '') IS NOT NULL
           ORDER BY CASE WHEN g.pct BETWEEN sr.from_percentage AND sr.to_percentage THEN 0
                         WHEN g.pct < sr.from_percentage THEN sr.from_percentage - g.pct
                         ELSE g.pct - sr.to_percentage END ASC,
                    sr.from_percentage DESC
           LIMIT 1
        ) band ON g.pct IS NOT NULL
    )`;

async function flowState(organizationId) {
  const approval = require("../assessmentApproval");
  return await approval.whenColumnsChecked();
}

// The subjects of these classes a person may open in the gradebook: a teacher's own subjects,
// and every subject of a class they lead (classScope.withinScope).
async function gradebookSubjects(db, organizationId, classIds, scope) {
  const { rows } = await db.query(
    "SELECT subject_id, subject_name, class_id FROM subjects WHERE organization_id = $1 AND class_id = ANY($2::int[]) ORDER BY subject_name, subject_id",
    [organizationId, classIds]
  );
  const all = rows.map((r) => ({ id: Number(r.subject_id), name: r.subject_name, classId: Number(r.class_id) }));
  const open = scope ? all.filter((s) => scope.subjects.has(s.id) || scope.mainClasses.has(s.classId)) : all;
  return { all, open };
}

function pickSubjects(value, { all, open }, isTeacher) {
  const raw = text(value, 120);
  if (!raw) return open;
  const want = raw.split(/\s*[,;]\s*/).filter(Boolean);
  const match = (list) => list.filter((s) => want.some((w) => (/^\d+$/.test(w) ? s.id === Number(w) : norm(s.name) === norm(w))));
  const loose = (list) => list.filter((s) => want.some((w) => !/^\d+$/.test(w) && norm(s.name).includes(norm(w))));
  let hits = match(open);
  if (!hits.length) hits = loose(open);
  if (hits.length) return hits;
  const names = [...new Set(open.map((s) => s.name))];
  if (isTeacher && (match(all).length || loose(all).length)) {
    throw new ReadError("PERMISSION_DENIED", `You can open only the subjects you teach here: ${listOf(names) || "none"}.`);
  }
  throw new ReadError("NOT_FOUND", `No subject "${raw}" in ${names.length ? "these classes" : "this class"}. Subjects: ${listOf(names) || "none"}.`);
}

const gradebookLink = (classId, subjectId, termId) => `/common/assessment?classId=${classId}&subjectId=${subjectId}&termId=${termId}`;

async function eachLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

module.exports = {
  // GET /internal/api/read/get_scores?class=Grade 6&subject=Math&term=&student=&status=all|missing
  get_scores: {
    async run(db, actor, q) {
      noDrivers(actor, "gradebook scores");
      await needAny(db, actor, ["manage_assessments"], "Manage Assessments");
      const org = actor.organizationId;
      const status = oneOf(q.status, ["all", "missing"], "all");
      const scope = await teacherScope(db, actor);
      const reach = scope ? scope.classes : null;
      const term = await resolveTerm(db, org, q.term);
      if (!text(q.student) && !text(q.class)) throw new ReadError("VALIDATION", "Name a class or a student.");

      const student = text(q.student) ? await findStudent(db, actor, q.student, reach) : null;
      let classes;
      let leftOut = [];
      if (text(q.class)) {
        const picked = await pickClasses(db, actor, q.class, reach, " in the gradebook");
        classes = picked.classes;
        leftOut = picked.leftOut;
      } else {
        const ids = (await studentClassesInTerm(db, org, student.student_id, term.term_id)).filter((id) => !reach || reach.has(id));
        const all = await schoolClasses(db, org);
        classes = all.filter((c) => ids.includes(c.id));
        if (!classes.length) throw new ReadError("NOT_FOUND", `${nameOf(student)} isn't enrolled in ${reach ? "one of your classes" : "a class"} for ${termLabel(term)}.`);
      }
      const classIds = classes.map((c) => c.id);
      const subjectLists = await gradebookSubjects(db, org, classIds, scope);
      if (!subjectLists.open.length) {
        if (scope) throw new ReadError("PERMISSION_DENIED", `You don't teach a subject in ${listOf(classes.map((c) => c.name))}.`);
        throw new ReadError("NOT_FOUND", `${listOf(classes.map((c) => c.name))} ${classes.length === 1 ? "has" : "have"} no subjects yet.`);
      }
      const subjects = pickSubjects(q.subject, subjectLists, Boolean(scope));
      const subjectIds = [...new Set(subjects.map((s) => s.id))];
      const flow = await flowState(org);
      const params = [org, term.term_id, classIds, subjectIds, Boolean(term.is_current), student ? Number(student.student_id) : null];

      // Totals over the whole scope.
      const { rows: [sum] } = await db.query(
        `WITH ${gradebookCtes(flow)}
         SELECT (SELECT COUNT(DISTINCT student_id) FROM st)::int AS students,
                (SELECT COUNT(*) FROM a)::int AS assessments,
                (SELECT COUNT(*) FROM a WHERE obsolete_at IS NOT NULL)::int AS obsolete,
                COUNT(*) FILTER (WHERE entered)::int AS entered,
                COUNT(*) FILTER (WHERE NOT entered AND obsolete_at IS NULL)::int AS missing,
                COUNT(*) FILTER (WHERE entered AND pending_since IS NOT NULL)::int AS waiting,
                COUNT(DISTINCT student_id) FILTER (WHERE NOT entered AND obsolete_at IS NULL)::int AS students_missing
           FROM cells`,
        params
      );
      if (student && !sum.students) {
        throw new ReadError("NOT_FOUND", `${nameOf(student)} isn't enrolled in ${listOf(classes.map((c) => c.name))} for ${termLabel(term)}.`);
      }
      const totals = {
        students: sum.students,
        subjects: subjectIds.length,
        assessments: sum.assessments,
        scores_entered: sum.entered,
        missing: sum.missing,
        students_missing_a_score: sum.students_missing,
        ...(flow ? { waiting_for_approval: sum.waiting } : {}),
      };
      const scopeOut = {
        term: termOut(term),
        classes: classes.map((c) => c.name),
        subjects: [...new Set(subjects.map((s) => s.name))],
        ...(student ? { student: { id: Number(student.student_id), name: nameOf(student) } } : {}),
        ...(leftOut.length ? { left_out: `Not your classes: ${listOf(leftOut)}` } : {}),
        ...(scope ? { limited_to: "the classes and subjects you teach" } : {}),
        status,
        notes: [
          "Scores are the actual scores staff see in the gradebook.",
          flow ? "A score marked waiting isn't approved yet: parents and the student don't see it until it's approved." : null,
          sum.obsolete ? "Obsolete assessments are closed to new scores, so they never count as missing." : null,
        ].filter(Boolean),
        links: subjects.length <= 12 ? subjects.map((s) => ({ class: (classes.find((c) => c.id === s.classId) || {}).name, subject: s.name, gradebook: gradebookLink(s.classId, s.id, term.term_id) })) : undefined,
      };

      const order = "c.class_name, s.last_name, s.first_name, s.student_id";
      if (status === "missing") {
        const { rows } = await db.query(
          `WITH ${gradebookCtes(flow)}
           SELECT x.student_id, s.first_name, s.last_name, c.class_name, sub.subject_name, x.title, x.category, x.max_score, x.assessment_id
             FROM cells x
             JOIN students s ON s.student_id = x.student_id AND s.organization_id = $1
             JOIN classes c ON c.class_id = x.class_id AND c.organization_id = $1
             JOIN subjects sub ON sub.subject_id = x.subject_id AND sub.organization_id = $1
            WHERE NOT x.entered AND x.obsolete_at IS NULL
            ORDER BY ${order}, sub.subject_name, x.assessment_id
            LIMIT ${ROW_MAX + 1}`,
          params
        );
        const { rows: shown, truncated } = cap(rows);
        return {
          data: shown.map((r) => ({
            student_id: Number(r.student_id), student: nameOf(r), class: r.class_name, subject: r.subject_name,
            assessment: r.title, category: r.category || null, max_score: round2(r.max_score),
          })),
          totals, scope: scopeOut, truncated,
        };
      }

      const { rows } = await db.query(
        `WITH ${gradebookCtes(flow)}, ${SUBJECT_TOTALS_SQL}
         SELECT b.student_id, b.class_id, b.subject_id, s.first_name, s.last_name, c.class_name, sub.subject_name,
                b.assessments, b.entered, b.missing, b.waiting, b.total, b.max_total, b.pct, b.grade
           FROM banded b
           JOIN students s ON s.student_id = b.student_id AND s.organization_id = $1
           JOIN classes c ON c.class_id = b.class_id AND c.organization_id = $1
           JOIN subjects sub ON sub.subject_id = b.subject_id AND sub.organization_id = $1
          ORDER BY ${order}, sub.subject_name
          LIMIT ${ROW_MAX + 1}`,
        params
      );
      const { rows: shown, truncated } = cap(rows);
      // Each assessment's score too, where the answer is one student's or one subject's.
      const detailed = Boolean(student) || subjectIds.length === 1;
      const cellsBy = new Map();
      if (detailed && shown.length) {
        const { rows: cells } = await db.query(
          `WITH ${gradebookCtes(flow)}
           SELECT student_id, subject_id, assessment_id, title, category, max_score, score, choice_label, pending_since, pending_source, entered, obsolete_at IS NOT NULL AS obsolete
             FROM cells ORDER BY student_id, subject_id, assessment_id`,
          params
        );
        const { cellState } = require("../assessmentApproval");
        cells.forEach((cell) => {
          const key = `${cell.student_id}:${cell.subject_id}`;
          if (!cellsBy.has(key)) cellsBy.set(key, []);
          cellsBy.get(key).push({
            assessment: cell.title,
            ...(cell.category ? { category: cell.category } : {}),
            max_score: round2(cell.max_score),
            score: cell.score === null ? null : round2(cell.score),
            ...(cell.choice_label ? { choice: cell.choice_label } : {}),
            ...(flow && cell.entered ? { state: cellState(cell) } : {}),
            ...(cell.obsolete ? { obsolete: true } : {}),
          });
        });
      }
      return {
        data: shown.map((r) => ({
          student_id: Number(r.student_id),
          student: nameOf(r),
          class: r.class_name,
          subject: r.subject_name,
          total: r.max_total > 0 ? { score: round2(r.total), out_of: round2(r.max_total), percent: round2(r.pct), grade: r.grade } : null,
          entered: r.entered,
          missing: r.missing,
          ...(flow ? { waiting_for_approval: r.waiting } : {}),
          ...(detailed ? { scores: cellsBy.get(`${r.student_id}:${r.subject_id}`) || [] } : {}),
        })),
        totals, scope: scopeOut, truncated,
      };
    },
  },

  // GET /internal/api/read/get_report_card_status?classes=Grade 6&term=&status=all|not_posted|not_sent
  get_report_card_status: {
    async run(db, actor, q) {
      noDrivers(actor, "report cards");
      await needAny(db, actor, ["reports_terminal"], "Terminal Reports");
      const org = actor.organizationId;
      const status = oneOf(q.status, ["all", "not_posted", "not_sent"], "all");
      const scope = await teacherScope(db, actor);
      const term = await resolveTerm(db, org, q.term);
      const { classes, leftOut } = await pickClasses(db, actor, q.classes || q.class, scope ? scope.classes : null, " for report cards");
      const classIds = classes.map((c) => c.id);
      // The students postReportCards posts (enrolled in the class for the term and its school
      // year), each with its posted report card (posted_report_cards) and what was sent:
      // emails (email_history), WhatsApp and text messages (delivery_audit_history).
      const { rows } = await db.query(
        `WITH st AS (
           SELECT DISTINCT es.student_id, es.class_id
             FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
            WHERE es.class_id = ANY($3::int[]) AND e.term_id = $2 AND e.organization_id = $1
              AND ($4::int IS NULL OR e.school_year_id = $4::int)
         ),
         em AS (
           SELECT student_id, class_id,
                  MAX(COALESCE(sent_at, updated_at, created_at)) FILTER (WHERE LOWER(status) = 'sent') AS sent_at,
                  COUNT(*) FILTER (WHERE LOWER(status) IN ('pending', 'sending'))::int AS queued,
                  COUNT(*) FILTER (WHERE LOWER(status) = 'failed')::int AS failed
             FROM email_history
            WHERE organization_id = $1 AND term_id = $2 AND class_id = ANY($3::int[])
            GROUP BY student_id, class_id
         ),
         msg AS (
           SELECT student_id, class_id,
                  MAX(created_at) FILTER (WHERE event_name = 'report_whatsapp_sent' AND LOWER(status) = 'sent') AS whatsapp_at,
                  MAX(created_at) FILTER (WHERE event_name = 'report_sms_sent' AND LOWER(status) = 'sent') AS sms_at
             FROM delivery_audit_history
            WHERE organization_id = $1 AND term_id = $2 AND class_id = ANY($3::int[])
              AND event_name IN ('report_whatsapp_sent', 'report_sms_sent')
            GROUP BY student_id, class_id
         )
         SELECT st.student_id, st.class_id, s.first_name, s.last_name, c.class_name,
                to_char(prc.posted_at, 'YYYY-MM-DD HH24:MI') AS posted_at,
                NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS posted_by,
                to_char(em.sent_at, 'YYYY-MM-DD HH24:MI') AS email_sent_at, COALESCE(em.queued, 0) AS email_queued, COALESCE(em.failed, 0) AS email_failed,
                to_char(msg.whatsapp_at, 'YYYY-MM-DD HH24:MI') AS whatsapp_sent_at, to_char(msg.sms_at, 'YYYY-MM-DD HH24:MI') AS sms_sent_at,
                prc.student_id IS NOT NULL AS posted,
                (em.sent_at IS NOT NULL OR msg.whatsapp_at IS NOT NULL OR msg.sms_at IS NOT NULL) AS sent
           FROM st
           JOIN students s ON s.student_id = st.student_id AND s.organization_id = $1
           JOIN classes c ON c.class_id = st.class_id AND c.organization_id = $1
           LEFT JOIN posted_report_cards prc ON prc.organization_id = $1 AND prc.class_id = st.class_id AND prc.term_id = $2 AND prc.student_id = st.student_id
           LEFT JOIN users u ON u.user_id = prc.posted_by AND u.organization_id = $1
           LEFT JOIN em ON em.student_id = st.student_id AND em.class_id = st.class_id
           LEFT JOIN msg ON msg.student_id = st.student_id AND msg.class_id = st.class_id
          ORDER BY c.class_name, s.last_name, s.first_name, st.student_id`,
        [org, term.term_id, classIds, Number(term.school_year_id) || null]
      );
      const count = (fn) => rows.filter(fn).length;
      const totals = {
        students: rows.length,
        posted: count((r) => r.posted),
        not_posted: count((r) => !r.posted),
        sent: count((r) => r.sent),
        not_sent: count((r) => !r.sent),
        sent_by_email: count((r) => r.email_sent_at),
        sent_by_whatsapp: count((r) => r.whatsapp_sent_at),
        sent_by_text: count((r) => r.sms_sent_at),
        emails_waiting_to_go: count((r) => !r.email_sent_at && r.email_queued > 0),
        emails_failed: count((r) => !r.email_sent_at && r.email_failed > 0),
      };
      const listed = rows.filter((r) => (status === "not_posted" ? !r.posted : status === "not_sent" ? !r.sent : true));
      const { rows: shown, truncated } = cap(listed);
      return {
        data: shown.map((r) => ({
          student_id: Number(r.student_id),
          student: nameOf(r),
          class: r.class_name,
          posted: r.posted,
          ...(r.posted ? { posted_at: r.posted_at, posted_by: r.posted_by || null } : {}),
          sent: r.sent,
          email: r.email_sent_at ? `sent ${r.email_sent_at}` : r.email_queued ? "waiting to go" : r.email_failed ? "failed" : "not sent",
          whatsapp: r.whatsapp_sent_at ? `sent ${r.whatsapp_sent_at}` : "not sent",
          text_message: r.sms_sent_at ? `sent ${r.sms_sent_at}` : "not sent",
          report_card: `/print/printStudentReport?classId=${r.class_id}&termId=${term.term_id}&studentId=${r.student_id}`,
        })),
        totals: { ...totals, listed: listed.length },
        scope: {
          term: termOut(term),
          classes: classes.map((c) => c.name),
          status,
          ...(leftOut.length ? { left_out: `Not your classes: ${listOf(leftOut)}` } : {}),
          notes: [
            "Posted = on the parent portal. Sent = emailed, sent by WhatsApp or by text message.",
            "Send history is kept for 3 months, so a report card sent longer ago shows as not sent.",
          ],
        },
        truncated,
      };
    },
  },

  // GET /internal/api/read/get_transcript?student=Ama Mensah
  // Only what shows without the transcript page's password step (requireTranscriptUnlock): which
  // finished terms it covers, each term's and the cumulative GPA, total credits and whether the old
  // system's GPA is on it. Course grades and old-system records stay on the page, behind it.
  get_transcript: {
    async run(db, actor, q) {
      noDrivers(actor, "transcripts");
      await needAny(db, actor, ["generate_transcripts"], "Generate Transcripts");
      const org = actor.organizationId;
      const scope = await teacherScope(db, actor);
      const student = await findStudent(db, actor, q.student, scope ? scope.classes : null);
      const studentId = Number(student.student_id);
      const gpa = require("../gpa");
      // The transcript page's own reading (transcriptController.generateTranscript).
      const scores = await gpa.endedTermGrades(db, org, studentId);
      const sourceGpa = await gpa.sourceGpaOf(db, org, studentId).catch(() => null);
      const designsOn = on("transcript_designs", actor);
      let summary = null;
      if (designsOn) {
        summary = await gpa.transcriptGpa(db, org, scores);
      } else if (await gpa.schoolShowsGpa(db, org)) {
        const [settings, levels] = await Promise.all([
          gpa.settingsFor(db, org),
          gpa.levelsFor(db, org, { subjectIds: [...new Set(scores.map((r) => Number(r.subject_id)).filter(Boolean))] }),
        ]);
        const item = (r) => ({ grade: r.grade, level: levels.get(Number(r.subject_id)) || null });
        const byTerm = new Map();
        scores.forEach((r) => { const key = gpa.termKeyOf(r); if (!byTerm.has(key)) byTerm.set(key, []); byTerm.get(key).push(item(r)); });
        summary = {
          terms: Object.fromEntries([...byTerm].map(([key, items]) => [key, gpa.gpaOf(items, settings)])),
          all: gpa.gpaOf(scores.map(item), settings),
        };
      }
      const gpaShown = Boolean(summary);
      const fmt = (value) => (value === null || value === undefined ? null : gpa.formatGpa(value));
      const usesCredits = Boolean(summary && summary.usesCredits && gpa.creditsOn(org));
      const terms = [];
      const seen = new Set();
      scores.forEach((r) => {
        const key = gpa.termKeyOf(r);
        if (seen.has(key)) return;
        seen.add(key);
        const t = summary && summary.terms ? summary.terms[key] : null;
        terms.push({
          school_year: r.year_label,
          term: r.term_name,
          ...(gpaShown ? {
            gpa: fmt(t && t.unweighted),
            ...(t && t.weighted !== null && t.weighted !== undefined ? { gpa_weighted: fmt(t.weighted) } : {}),
            ...(t && t.cumulative ? { cumulative_gpa: fmt(t.cumulative.unweighted), ...(t.cumulative.weighted !== null ? { cumulative_gpa_weighted: fmt(t.cumulative.weighted) } : {}) } : {}),
          } : {}),
        });
      });
      const all = summary && summary.all;
      const { rows: shownTerms, truncated } = cap(terms);
      const link = `/transcript/transcript/${studentId}`;
      return {
        data: {
          student: {
            id: studentId, name: nameOf(student), class: student.class_name || null,
            student_id: student.custom_student_id || String(studentId), status: student.graduated ? "graduated" : "current",
          },
          terms: shownTerms,
          ...(gpaShown ? { gpa: { cumulative: fmt(all && all.unweighted), ...(all && all.weighted !== null && all.weighted !== undefined ? { cumulative_weighted: fmt(all.weighted) } : {}) } } : {}),
          // Whether the old system's GPA is printed on it, never its value.
          has_previous_system_gpa: Boolean(sourceGpa),
          link,
        },
        totals: {
          finished_terms: terms.length,
          ...(usesCredits && all ? { credits_attempted: all.attempted, credits_earned: all.earned } : {}),
        },
        scope: {
          student: nameOf(student),
          notes: [
            "The full transcript opens on its page, which asks for your password.",
            "Only finished terms are on a transcript (a term counts once it isn't current or its end date has passed).",
            gpaShown ? "GPA as the transcript prints it: grade points × credits over credits, from letter grades only." : "This school's transcript doesn't print GPA.",
          ],
          link,
          ...(terms.length ? {} : { empty: `${nameOf(student)} has no finished terms with grades yet.` }),
        },
        truncated,
      };
    },
  },

  // GET /internal/api/read/get_gpa?classes=Grade 6&term=
  get_gpa: {
    async run(db, actor, q) {
      noDrivers(actor, "GPA");
      await needAny(db, actor, ["reports_terminal", "generate_transcripts"], "Terminal Reports or Generate Transcripts");
      const org = actor.organizationId;
      const gpa = require("../gpa");
      const scope = await teacherScope(db, actor);
      // A GPA covers every subject, so a teacher sees it only for a class they lead.
      const term = await resolveTerm(db, org, q.term);
      const { classes, leftOut } = await pickClasses(db, actor, q.classes || q.class, scope ? scope.mainClasses : null, scope ? " (GPA covers every subject, so only classes you lead)" : "");
      const classIds = classes.map((c) => c.id);
      const { rows: subjectRows } = await db.query("SELECT subject_id FROM subjects WHERE organization_id = $1 AND class_id = ANY($2::int[])", [org, classIds]);
      const subjectIds = subjectRows.map((r) => Number(r.subject_id));
      const flow = await flowState(org);
      const params = [org, term.term_id, classIds, subjectIds, Boolean(term.is_current), null];
      const { rows: students } = await db.query(
        `WITH ${GRADEBOOK_STUDENTS_CTE}
         SELECT st.student_id, st.class_id, s.first_name, s.last_name, c.class_name
           FROM st JOIN students s ON s.student_id = st.student_id AND s.organization_id = $1
           JOIN classes c ON c.class_id = st.class_id AND c.organization_id = $1
          WHERE cardinality($4::int[]) >= 0 -- (the subjects aren't needed here)
          ORDER BY c.class_name, s.last_name, s.first_name, st.student_id`,
        params
      );
      const MAX_STUDENTS = 1500;
      if (students.length > MAX_STUDENTS) {
        throw new ReadError("VALIDATION", `That's ${students.length} students; name up to ${MAX_STUDENTS} at a time (a few classes or a grade).`);
      }
      // This term's subject grades, as the gradebook works them out.
      const { rows: grades } = subjectIds.length ? await db.query(
        `WITH ${gradebookCtes(flow)}, ${SUBJECT_TOTALS_SQL}
         SELECT student_id, class_id, subject_id, grade FROM banded WHERE grade IS NOT NULL`,
        params
      ) : { rows: [] };
      // Finished terms for the cumulative GPA, exactly as the transcript reads them.
      const ended = await eachLimited(students, 6, (s) => gpa.endedTermGrades(db, org, Number(s.student_id)));
      const allSubjects = [...new Set([...grades.map((g) => Number(g.subject_id)), ...ended.flat().map((r) => Number(r.subject_id))])];
      const [settings, { info }] = await Promise.all([gpa.settingsFor(db, org), gpa.subjectsGpaInfo(db, org, allSubjects)]);
      const item = (r) => ({ grade: r.grade, ...(info.get(Number(r.subject_id)) || {}) });
      const gradesBy = new Map();
      grades.forEach((g) => { const k = `${g.student_id}:${g.class_id}`; if (!gradesBy.has(k)) gradesBy.set(k, []); gradesBy.get(k).push(g); });
      const rows = students.map((s, i) => {
        const own = gradesBy.get(`${s.student_id}:${s.class_id}`) || [];
        const termGpa = gpa.gpaOf(own.map(item), settings);
        const finished = gpa.transcriptFromRows(ended[i], { info, settings }).all;
        const finishedTerms = new Set(ended[i].filter((r) => gpa.pointsFor(r.grade) !== null).map(gpa.termKeyOf)).size;
        return {
          student_id: Number(s.student_id),
          student: nameOf(s),
          class: s.class_name,
          term_gpa: termGpa.unweighted,
          term_gpa_weighted: termGpa.weighted,
          cumulative_gpa: finished.unweighted,
          cumulative_gpa_weighted: finished.weighted,
          letter_grades_this_term: own.filter((g) => gpa.pointsFor(g.grade) !== null).length,
          finished_terms: finishedTerms,
        };
      });
      const stats = (key) => {
        const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
        if (!values.length) return { students: 0, average: null, highest: null, lowest: null };
        const hundredths = values.map((v) => Math.round(v * 100));
        const total = hundredths.reduce((a, b) => a + b, 0);
        return {
          students: values.length,
          average: gpa.formatGpa(Math.floor((2 * total + values.length) / (2 * values.length)) / 100),
          highest: gpa.formatGpa(Math.max(...values)),
          lowest: gpa.formatGpa(Math.min(...values)),
        };
      };
      const band = (lo, hi) => rows.filter((r) => r.term_gpa !== null && r.term_gpa >= lo && r.term_gpa < hi).length;
      const fmt = (v) => (v === null || v === undefined ? null : gpa.formatGpa(v));
      const { rows: shown, truncated } = cap(rows);
      return {
        data: shown.map((r) => ({
          ...r,
          term_gpa: fmt(r.term_gpa),
          term_gpa_weighted: fmt(r.term_gpa_weighted),
          cumulative_gpa: fmt(r.cumulative_gpa),
          cumulative_gpa_weighted: fmt(r.cumulative_gpa_weighted),
        })),
        totals: {
          students: rows.length,
          term_gpa: stats("term_gpa"),
          cumulative_gpa: stats("cumulative_gpa"),
          term_gpa_bands: { "3.50 and above": band(3.5, 99), "3.00 to 3.49": band(3, 3.5), "2.00 to 2.99": band(2, 3), "below 2.00": band(-1, 2) },
          no_term_gpa: rows.filter((r) => r.term_gpa === null).length,
        },
        scope: {
          term: termOut(term),
          classes: classes.map((c) => c.name),
          ...(leftOut.length ? { left_out: `Not classes you lead: ${listOf(leftOut)}` } : {}),
          notes: [
            "Term GPA: this term's subject grades as the gradebook shows them to staff (scores waiting for approval included), 4.0 scale, letter grades only (utils/gpa.js). The printed report card can differ where Report Settings leaves some assessments out.",
            "Cumulative GPA: every finished term, as the transcript prints it (quality points over credits, never an average of term GPAs).",
            "Class averages are the mean of the students' GPAs shown.",
          ],
          scale: gpa.SCALE_TEXT,
        },
        truncated,
      };
    },
  },

  // GET /internal/api/read/get_class_schedule?class=Grade 6 - Room 2&teacher=&term=
  get_class_schedule: {
    async run(db, actor, q) {
      noDrivers(actor, "class schedules");
      const org = actor.organizationId;
      const service = require("../classScheduleService");
      const scope = await teacherScope(db, actor);
      const reach = scope ? scope.classes : null;
      const term = await resolveTerm(db, org, q.term);
      let teacher = null;
      let teacherText = text(q.teacher, 120);
      if (!teacherText && !text(q.class)) {
        if (scope) teacherText = "me";
        else throw new ReadError("VALIDATION", "Name a class or a teacher.");
      }
      if (teacherText) {
        const me = /^(me|my|mine|myself|i)$/i.test(teacherText);
        // The school's own account has no staff record of its own (its id is the school's).
        if (me && String(actor.accountType).toLowerCase() === "organization") throw new ReadError("VALIDATION", "Name the teacher or the class whose schedule you want.");
        const { rows } = await db.query(
          `SELECT user_id, first_name, last_name, account_type::text AS account_type
             FROM users
            WHERE organization_id = $1 AND removed_at IS NULL AND account_type::text <> 'Driver'
              AND (${me ? "user_id = $2::int" : "CONCAT_WS(' ', first_name, last_name) ILIKE $2 OR CONCAT_WS(' ', last_name, first_name) ILIKE $2"})
            ORDER BY last_name, first_name LIMIT 20`,
          [org, me ? actor.userId : `%${teacherText.replace(/[%_\\]/g, "\\$&").replace(/\s+/g, "%")}%`]
        );
        if (!rows.length) {
          if (me) throw new ReadError("VALIDATION", "Name the teacher or the class whose schedule you want.");
          throw new ReadError("NOT_FOUND", `No member of staff named "${teacherText}".`);
        }
        const exact = rows.filter((r) => norm(`${r.first_name} ${r.last_name}`) === norm(teacherText));
        const list = exact.length ? exact : rows;
        if (list.length > 1) throw new ReadError("AMBIGUOUS", `"${teacherText}" could be: ${listOf(list.map((r) => `${r.first_name} ${r.last_name} (${r.account_type})`), 10)}. Which one?`);
        teacher = list[0];
      }
      // The teacher's own subjects, and every subject of a class they lead (as the gradebook).
      let teacherSubjects = null;
      let teacherClasses = null;
      if (teacher) {
        const whole = await require("../mainTeacher").wholeClassSql(db, "uc");
        const [subjects, led] = await Promise.all([
          db.query("SELECT us.subject_id, s.class_id FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id WHERE us.user_id = $1 AND s.organization_id = $2", [teacher.user_id, org]),
          db.query(`SELECT uc.class_id FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = $1 AND c.organization_id = $2 AND ${whole}`, [teacher.user_id, org]),
        ]);
        teacherSubjects = new Set(subjects.rows.map((r) => Number(r.subject_id)));
        const ledClasses = new Set(led.rows.map((r) => Number(r.class_id)));
        teacherClasses = { led: ledClasses, all: new Set([...ledClasses, ...subjects.rows.map((r) => Number(r.class_id))]) };
      }
      let classes;
      let leftOut = [];
      if (text(q.class)) {
        const picked = await pickClasses(db, actor, q.class, reach);
        classes = picked.classes;
        leftOut = picked.leftOut;
        if (teacherClasses) classes = classes.filter((c) => teacherClasses.all.has(c.id));
        if (!classes.length) throw new ReadError("NOT_FOUND", `${teacher.first_name} ${teacher.last_name} doesn't teach in ${text(q.class)}.`);
      } else {
        const all = await schoolClasses(db, org);
        classes = all.filter((c) => !c.obsolete && teacherClasses.all.has(c.id));
        const hidden = classes.filter((c) => reach && !reach.has(c.id));
        leftOut = hidden.map((c) => c.name);
        classes = classes.filter((c) => !reach || reach.has(c.id));
        if (!classes.length) {
          throw new ReadError(hidden.length ? "PERMISSION_DENIED" : "NOT_FOUND", hidden.length
            ? "You can see only the schedules of your own classes."
            : `${teacher.first_name} ${teacher.last_name} isn't assigned to a class or subject.`);
        }
      }
      if (classes.length > 60) throw new ReadError("VALIDATION", `That's ${classes.length} classes; name up to 60 at a time.`);
      const bundles = await eachLimited(classes, 4, (c) => service.getClassScheduleBundle(db, { organizationId: org, classId: c.id, termId: term.term_id }));
      const entries = [];
      const without = [];
      const reusable = [];
      classes.forEach((c, i) => {
        const bundle = bundles[i];
        const schedule = bundle && bundle.currentSchedule;
        if (!schedule) {
          without.push(c.name);
          if (bundle && bundle.previousSchedule) reusable.push(`${c.name} (from ${bundle.previousSchedule.termName})`);
          return;
        }
        schedule.entries
          .filter((e) => !teacher || teacherClasses.led.has(c.id) || (e.subjectId && teacherSubjects.has(e.subjectId)))
          .forEach((e) => entries.push({
            class: c.name, day: e.dayLabel, day_of_week: e.dayOfWeek, start: e.startTime, end: e.endTime,
            subject: e.subjectName || null, ...(e.customLabel ? { label: e.customLabel } : {}),
          }));
      });
      entries.sort((a, b) => a.day_of_week - b.day_of_week || String(a.start).localeCompare(String(b.start)) || a.class.localeCompare(b.class));
      const { rows: shown, truncated } = cap(entries);
      return {
        data: shown,
        totals: { classes: classes.length, classes_with_schedule: classes.length - without.length, periods: entries.length },
        scope: {
          term: termOut(term),
          classes: classes.map((c) => c.name),
          ...(teacher ? { teacher: `${teacher.first_name} ${teacher.last_name}`, teacher_note: "Their own subjects, and every period of a class they lead." } : {}),
          ...(without.length ? { no_schedule_this_term: without } : {}),
          ...(reusable.length ? { earlier_schedule_to_reuse: reusable } : {}),
          ...(leftOut.length ? { left_out: `Not your classes: ${listOf(leftOut)}` } : {}),
        },
        truncated,
      };
    },
  },

  // GET /internal/api/read/get_lunch?classes=Grade 6&student=&from=&to=&term=
  get_lunch: {
    async run(db, actor, q) {
      noDrivers(actor, "lunch");
      const org = actor.organizationId;
      const overallLunch = require("../overallLunch");
      await needAny(db, actor, ["mark_attendance"], "Mark Attendance");
      const scope = await teacherScope(db, actor);
      const reach = scope ? scope.mainClasses : null; // lunch is taken on the attendance page: classes they lead
      const range = await rangeFor(db, actor, q);
      const term = range.term;
      const classSettings = require("../classSettings");

      if (text(q.student)) {
        const student = await findStudent(db, actor, q.student, reach);
        const studentId = Number(student.student_id);
        const [{ rows: days }, overall] = await Promise.all([
          db.query(
            `SELECT lunch_date::text AS day, had_lunch FROM class_lunch
              WHERE organization_id = $1 AND student_id = $2 AND lunch_date BETWEEN $3::date AND $4::date ORDER BY lunch_date`,
            [org, studentId, range.from, range.to]
          ).catch((e) => { if (e.code === "42P01") return { rows: [] }; throw e; }),
          overallLunch.totalsFor(db, org, term.term_id, [studentId]),
        ]);
        const total = overall.get(studentId) || null;
        const { rows: shown, truncated } = cap(days);
        return {
          data: shown.map((d) => ({ date: d.day, lunch: d.had_lunch ? "had lunch" : "no lunch" })),
          totals: {
            days_taken: days.length,
            had_lunch: days.filter((d) => d.had_lunch).length,
            no_lunch: days.filter((d) => !d.had_lunch).length,
            overall_lunch_term: overallLunch.label(total),
          },
          scope: {
            student: { id: studentId, name: nameOf(student), class: student.class_name || null },
            from: range.from, to: range.to, term: termOut(term),
            notes: ["A day with no entry means lunch wasn't taken for them that day.", "Overall lunch is the term's days with lunch out of the days lunch was taken."],
          },
          truncated,
        };
      }

      const { classes, leftOut } = await pickClasses(db, actor, q.classes || q.class, reach, scope ? " (lunch is taken with attendance, for the classes you lead)" : "");
      const settings = await classSettings.settingsForClasses(db, org, classes.map((c) => c.id));
      const taking = classes.filter((c) => (settings.get(c.id) || {}).lunch !== false);
      const notTaking = classes.filter((c) => (settings.get(c.id) || {}).lunch === false).map((c) => c.name);
      if (!taking.length) throw new ReadError("NOT_FOUND", `${listOf(notTaking)} ${notTaking.length === 1 ? "doesn't" : "don't"} take lunch (Class settings › Take lunch is off).`);
      const classIds = taking.map((c) => c.id);
      const { rows: students } = await db.query(
        `SELECT DISTINCT es.student_id, es.class_id, s.first_name, s.last_name, c.class_name
           FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
           JOIN students s ON s.student_id = es.student_id AND s.organization_id = $1
           JOIN classes c ON c.class_id = es.class_id AND c.organization_id = $1
          WHERE e.organization_id = $1 AND e.term_id = $2 AND es.class_id = ANY($3::int[]) AND s.graduated = FALSE
          ORDER BY c.class_name, s.last_name, s.first_name`,
        [org, term.term_id, classIds]
      );
      const ids = [...new Set(students.map((s) => Number(s.student_id)))];
      const safe = (p) => p.catch((e) => { if (e.code === "42P01") return { rows: [] }; throw e; });
      const [{ rows: perStudent }, { rows: perDay }, overall] = await Promise.all([
        safe(db.query(
          `SELECT student_id, COUNT(*) FILTER (WHERE had_lunch)::int AS had, COUNT(*)::int AS taken FROM class_lunch
            WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND lunch_date BETWEEN $3::date AND $4::date GROUP BY student_id`,
          [org, ids, range.from, range.to]
        )),
        safe(db.query(
          `SELECT l.lunch_date::text AS day, c.class_name, COUNT(*) FILTER (WHERE l.had_lunch)::int AS had, COUNT(*)::int AS taken
             FROM class_lunch l JOIN classes c ON c.class_id = l.class_id AND c.organization_id = $1
            WHERE l.organization_id = $1 AND l.class_id = ANY($2::int[]) AND l.lunch_date BETWEEN $3::date AND $4::date
            GROUP BY l.lunch_date, c.class_name ORDER BY l.lunch_date, c.class_name`,
          [org, classIds, range.from, range.to]
        )),
        overallLunch.totalsFor(db, org, term.term_id, ids),
      ]);
      const inRange = new Map(perStudent.map((r) => [Number(r.student_id), r]));
      const rows = students.map((s) => {
        const r = inRange.get(Number(s.student_id));
        const total = overall.get(Number(s.student_id)) || null;
        return {
          student_id: Number(s.student_id), student: nameOf(s), class: s.class_name,
          had_lunch: r ? r.had : 0, days_taken: r ? r.taken : 0,
          overall_lunch_term: overallLunch.label(total),
        };
      });
      const { rows: shown, truncated } = cap(rows);
      return {
        data: shown,
        totals: {
          students: rows.length,
          days_lunch_was_taken: new Set(perDay.map((d) => d.day)).size,
          lunches: perDay.reduce((n, d) => n + d.had, 0),
          no_lunch: perDay.reduce((n, d) => n + d.taken - d.had, 0),
          students_never_taken: rows.filter((r) => !r.days_taken).length,
          by_day: perDay.slice(0, 120).map((d) => ({ date: d.day, class: d.class_name, had_lunch: d.had, taken: d.taken })),
        },
        scope: {
          classes: taking.map((c) => c.name), from: range.from, to: range.to, term: termOut(term),
          ...(notTaking.length ? { not_taking_lunch: notTaking } : {}),
          ...(leftOut.length ? { left_out: `Not classes you lead: ${listOf(leftOut)}` } : {}),
          ...(perDay.length > 120 ? { days_shown: "the first 120 class days" } : {}),
          notes: ["Lunch is taken beside attendance; a day with no entry means lunch wasn't taken.", "Overall lunch is the term's days with lunch out of the days lunch was taken."],
        },
        truncated,
      };
    },
  },

  // GET /internal/api/read/get_attendance_summary?classes=Grade 6&from=2026-10-01&to=2026-10-31&min_absences=4&status=all|absent|late|not_marked
  get_attendance_summary: {
    async run(db, actor, q) {
      noDrivers(actor, "attendance");
      await needAny(db, actor, ["mark_attendance"], "Mark Attendance");
      const org = actor.organizationId;
      const status = oneOf(q.status, ["all", "absent", "late", "not_marked"], "all");
      const minRaw = text(q.min_absences, 10);
      const minAbsences = minRaw ? Number(minRaw) : null;
      if (minRaw && (!Number.isInteger(minAbsences) || minAbsences < 0 || minAbsences > 400)) throw new ReadError("VALIDATION", "min_absences must be a whole number.");
      const scope = await teacherScope(db, actor);
      const reach = scope ? scope.mainClasses : null; // requireLeadsClass: a teacher only for classes they lead
      const range = await rangeFor(db, actor, q);
      const { classes, leftOut } = await pickClasses(db, actor, q.classes || q.class, reach, scope ? " (attendance is for the classes you lead)" : "");
      const classIds = classes.map((c) => c.id);
      const terms = await termsOverlapping(db, org, range.from, range.to);
      if (!terms.length) throw new ReadError("NOT_FOUND", `No term of your school covers ${range.from} to ${range.to}.`);
      const schoolDays = await schoolDaysIn(db, org, terms, range);
      const common = {
        from: range.from, to: range.to,
        terms: terms.map(termOut),
        classes: classes.map((c) => c.name),
        ...(leftOut.length ? { left_out: `Not classes you lead: ${listOf(leftOut)}` } : {}),
      };

      if (status === "not_marked") {
        const { rows: marked } = await db.query(
          `SELECT DISTINCT class_id, date::text AS day FROM attendance_records
            WHERE organization_id = $1 AND class_id = ANY($2::int[]) AND date BETWEEN $3::date AND $4::date`,
          [org, classIds, range.from, range.to]
        );
        const done = new Set(marked.map((r) => `${r.class_id}:${r.day}`));
        const rows = [];
        classes.forEach((c) => schoolDays.forEach((day) => { if (!done.has(`${c.id}:${day}`)) rows.push({ class: c.name, date: day }); }));
        rows.sort((a, b) => a.date.localeCompare(b.date) || a.class.localeCompare(b.class));
        const { rows: shown, truncated } = cap(rows);
        return {
          data: shown,
          totals: { classes: classes.length, school_days: schoolDays.length, class_days: classes.length * schoolDays.length, not_marked: rows.length, classes_with_a_day_not_marked: new Set(rows.map((r) => r.class)).size },
          scope: { ...common, status, notes: [calendarNote(schoolDays)] },
          truncated,
        };
      }

      const termIds = terms.map((t) => Number(t.term_id));
      const { rows } = await db.query(
        `WITH st AS (
           SELECT DISTINCT es.student_id, es.class_id
             FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
             JOIN students s ON s.student_id = es.student_id AND s.organization_id = $1
            WHERE e.organization_id = $1 AND e.term_id = ANY($5::int[]) AND es.class_id = ANY($2::int[]) AND s.graduated = FALSE
         ),
         marks AS (
           SELECT student_id, class_id,
                  COUNT(*) FILTER (WHERE status::text = 'Present')::int AS present,
                  COUNT(*) FILTER (WHERE status::text = 'Absent')::int AS absent,
                  COUNT(*) FILTER (WHERE status::text = 'Late')::int AS late,
                  COUNT(DISTINCT date) FILTER (WHERE date = ANY($6::date[]))::int AS school_days_marked
             FROM attendance_records
            WHERE organization_id = $1 AND class_id = ANY($2::int[]) AND date BETWEEN $3::date AND $4::date
            GROUP BY student_id, class_id
         )
         SELECT st.student_id, st.class_id, s.first_name, s.last_name, c.class_name,
                COALESCE(m.present, 0) AS present, COALESCE(m.absent, 0) AS absent, COALESCE(m.late, 0) AS late,
                COALESCE(m.school_days_marked, 0) AS school_days_marked
           FROM st
           JOIN students s ON s.student_id = st.student_id AND s.organization_id = $1
           JOIN classes c ON c.class_id = st.class_id AND c.organization_id = $1
           LEFT JOIN marks m ON m.student_id = st.student_id AND m.class_id = st.class_id`,
        [org, classIds, range.from, range.to, termIds, schoolDays]
      );
      const enriched = rows.map((r) => ({ ...r, not_marked: Math.max(schoolDays.length - r.school_days_marked, 0) }));
      const threshold = status === "absent" ? Math.max(1, minAbsences || 0) : minAbsences;
      const listed = enriched.filter((r) => (status === "late" ? r.late > 0 : true) && (threshold ? r.absent >= threshold : true));
      if (status === "absent" || threshold) listed.sort((a, b) => b.absent - a.absent || a.class_name.localeCompare(b.class_name) || String(a.last_name).localeCompare(String(b.last_name)));
      else if (status === "late") listed.sort((a, b) => b.late - a.late);
      else listed.sort((a, b) => a.class_name.localeCompare(b.class_name) || String(a.last_name).localeCompare(String(b.last_name)) || String(a.first_name).localeCompare(String(b.first_name)));
      const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
      const lateRecorded = await lateIsRecorded(db);
      const { rows: shown, truncated } = cap(listed);
      return {
        data: shown.map((r) => ({
          student_id: Number(r.student_id), student: nameOf(r), class: r.class_name,
          present: r.present, absent: r.absent, ...(lateRecorded ? { late: r.late } : {}), not_marked: r.not_marked,
        })),
        totals: {
          students: enriched.length,
          listed: listed.length,
          school_days: schoolDays.length,
          present: sum(enriched, "present"),
          absent: sum(enriched, "absent"),
          ...(lateRecorded ? { late: sum(enriched, "late") } : {}),
          students_absent_at_least_once: enriched.filter((r) => r.absent > 0).length,
          ...(threshold ? { students_with_at_least: { absences: threshold, students: listed.length } } : {}),
        },
        scope: {
          ...common,
          status,
          ...(threshold ? { min_absences: threshold } : {}),
          notes: [
            "Present and absent count the days marked in the range; not_marked is school days in the range with no mark for that student.",
            calendarNote(schoolDays),
            lateRecorded ? null : "Managira's attendance records Present or Absent only, so there are no late marks.",
          ].filter(Boolean),
        },
        truncated,
      };
    },
  },
};

// ── Attendance helpers ───────────────────────────────────────────────────────────────────
// The range asked for (from / to, or a term), else the current term up to today.
async function rangeFor(db, actor, q) {
  const org = actor.organizationId;
  let from = parseDay(q.from, "from");
  let to = parseDay(q.to, "to", true);
  const today = todayKey(actor);
  let term;
  if (text(q.term) || (!from && !to)) {
    term = await resolveTerm(db, org, q.term);
    from = from || term.start_key;
    to = to || (term.end_key && term.end_key < today ? term.end_key : today);
  } else {
    from = from || to;
    to = to || (from > today ? from : today);
    const overlapping = await termsOverlapping(db, org, from, to);
    term = overlapping.find((t) => t.start_key <= from && t.end_key >= from) || overlapping[0] || await resolveTerm(db, org, null);
  }
  if (from > to) throw new ReadError("VALIDATION", "from must be on or before to.");
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  if (days > 400) throw new ReadError("VALIDATION", "Ask for at most about a year at a time.");
  return { from, to, term, today };
}

// The school days in a range, up to today, by each term's attendance calendar (Settings ›
// School rules): days the attendance page counts (isAttendanceCountableForDate), the official
// term end always included.
async function schoolDaysIn(db, organizationId, terms, range) {
  const cal = require("../attendanceCalendar");
  await cal.ensureAttendanceCalendarSchema(db);
  const out = new Set();
  let withoutCalendar = false;
  for (const term of terms) {
    const start = term.start_key > range.from ? term.start_key : range.from;
    let end = term.end_key < range.to ? term.end_key : range.to;
    if (end > range.today) end = range.today;
    if (start > end) continue;
    const profile = await cal.getAttendanceCalendarProfile(db, organizationId, term.term_id);
    if (!profile) withoutCalendar = true;
    const days = profile ? await cal.getAttendanceCalendarDays(db, profile.calendar_id, new Date(`${start}T00:00:00.000Z`), new Date(`${end}T23:59:59.999Z`)) : [];
    const map = cal.buildCalendarDayMap(days);
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (day === term.end_key || cal.isAttendanceCountableForDate(day, profile, map)) out.add(day);
    }
  }
  const list = [...out].sort();
  list.withoutCalendar = withoutCalendar;
  return list;
}
const calendarNote = (days) => (days.withoutCalendar
  ? "Your school hasn't set an attendance calendar (Settings › School rules), so every day counts as a school day, weekends included, as on the attendance page."
  : "School days follow the school's attendance calendar (weekends, holidays and days off left out), up to today.");

// Whether the attendance status list has a Late mark at all (it holds Present and Absent).
let lateKnown = null;
async function lateIsRecorded(db) {
  if (lateKnown !== null) return lateKnown;
  const { rows } = await db.query(
    "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'attendance_status' AND e.enumlabel = 'Late'"
  ).catch(() => ({ rows: [] }));
  lateKnown = rows.length > 0;
  return lateKnown;
}
