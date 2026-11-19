"use strict";

// find_students: the students who match ALL of several conditions at once, worked out here on the
// server (never by Mira comparing lists): in these classes, riding the bus, owing fees, absent at
// least N days in a date range, with a parent form outstanding. Each condition reuses its own
// area's tool and permission (transportation rules, PayGira's Overdue page, the attendance
// summary, Forms & requests); a condition the person can't check refuses the whole question, so
// a part is never silently left out. Every class a grade means is included and named.
const { ReadError, classesInReach, cap, isDriver } = require("./index");

const yes = (v) => /^(1|true|yes|y|on)$/i.test(String(v == null ? "" : v).trim());
const no = (v) => /^(0|false|no|n|off)$/i.test(String(v == null ? "" : v).trim());
const nameOf = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim();

async function classesFor(db, actor, words) {
  const { matchClasses } = require("../formRequests");
  const { rows } = await db.query(
    "SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY class_name",
    [actor.organizationId]
  );
  const all = rows.map((r) => ({ id: Number(r.class_id), name: r.class_name }));
  const reach = await classesInReach(db, actor);
  const text = String(words || "").trim();
  let picked = all;
  if (text && !/^(all|all classes|every class|whole school|the whole school|school|my classes)$/i.test(text)) {
    const seen = new Map();
    text.split(/\s*(?:,|;|\band\b|\+)\s*/i).filter(Boolean).forEach((phrase) => matchClasses(all, phrase).forEach((c) => seen.set(c.id, c)));
    picked = [...seen.values()];
    if (!picked.length) throw new ReadError("NOT_FOUND", `No class matches "${text}". Classes: ${all.slice(0, 40).map((c) => c.name).join(", ")}.`);
  }
  const visible = reach ? picked.filter((c) => reach.has(c.id)) : picked;
  if (!visible.length) throw new ReadError("PERMISSION_DENIED", reach ? `You can see only your own classes; ${picked.map((c) => c.name).join(", ")} ${picked.length === 1 ? "isn't" : "aren't"} one of them.` : "No classes to check.");
  return { classes: visible, notYours: picked.filter((c) => !visible.includes(c)).map((c) => c.name) };
}

// Who rides the bus: the transportation reads' own helper (its switch and who-may-see rules).
async function riders(db, actor, classIds) {
  try {
    return await require("./transportFees").ridersIn(db, actor, classIds);
  } catch (error) {
    if (error instanceof ReadError) throw new ReadError(error.code, `Couldn't check who rides the bus: ${error.message}`, error.status);
    throw error;
  }
}

// Runs another read tool of this folder as the same person; a refusal names the condition.
async function viaTool(db, actor, name, query, what) {
  const tool = require("./index").tools()[name];
  try {
    return await tool.run(db, actor, query);
  } catch (error) {
    if (error instanceof ReadError) throw new ReadError(error.code, `Couldn't check ${what}: ${error.message}`, error.status);
    throw error;
  }
}

// A few at a time, in order (each class's reads are a handful of queries).
async function eachLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  }));
  return out;
}

module.exports = {
  // GET /internal/api/read/get_class_readiness?classes=&term=&status=ready_to_post|missing_scores|not_posted|all
  // Per class, worked out here: students, report cards posted and sent (get_report_card_status),
  // scores still missing (get_scores), and the class's teachers (get_class_staff). "Ready to post"
  // = some report cards not posted yet and no score missing.
  get_class_readiness: {
    async run(db, actor, q) {
      if (isDriver(actor)) throw new ReadError("PERMISSION_DENIED", "Drivers don't see report cards or the gradebook.");
      const status = ["ready_to_post", "missing_scores", "not_posted", "all"].includes(String(q.status)) ? String(q.status) : "all";
      const { classes, notYours } = await classesFor(db, actor, q.classes);
      const rows = await eachLimited(classes, 5, async (cls) => {
        const cards = await viaTool(db, actor, "get_report_card_status", { classes: String(cls.id), term: q.term, status: "all" }, `report cards for ${cls.name}`);
        let scores;
        try {
          scores = await viaTool(db, actor, "get_scores", { class: String(cls.id), term: q.term, status: "missing" }, `scores for ${cls.name}`);
        } catch (error) {
          // A class with no subjects yet has nothing to enter.
          if (error.code === "NOT_FOUND" && /no subjects/i.test(error.message)) scores = { totals: { missing: 0, assessments: 0 }, scope: {} };
          else throw error;
        }
        const ct = cards.totals || {};
        const st = scores.totals || {};
        return {
          class_id: cls.id,
          class: cls.name,
          students: ct.students || 0,
          report_cards_posted: ct.posted || 0,
          report_cards_not_posted: ct.not_posted || 0,
          report_cards_sent: ct.sent || 0,
          assessments: st.assessments || 0,
          scores_missing: st.missing || 0,
          students_missing_a_score: st.students_missing_a_score || 0,
          ready_to_post: (ct.not_posted || 0) > 0 && (st.missing || 0) === 0 && (st.assessments || 0) > 0,
          term: (cards.scope && cards.scope.term) || (scores.scope && scores.scope.term) || null,
          limited_to: scores.scope && scores.scope.limited_to,
        };
      });
      const listed = rows.filter((r) => (status === "ready_to_post" ? r.ready_to_post : status === "missing_scores" ? r.scores_missing > 0 : status === "not_posted" ? r.report_cards_not_posted > 0 : true));
      // Most missing first, so "the top 3" is the first three rows (ties by class name).
      if (status === "missing_scores") listed.sort((a, b) => b.scores_missing - a.scores_missing || a.class.localeCompare(b.class));
      // Each listed class's teachers (main, assistants, subject teachers), at most 40 classes.
      const staffOf = await eachLimited(listed.slice(0, 40), 5, async (r) => {
        try {
          const staff = await require("./index").tools().get_class_staff.run(db, actor, { classId: String(r.class_id) });
          const c = ((staff.data && staff.data.classes) || [])[0] || {};
          return { main_teacher: c.main_teacher || null, teachers: (c.staff || []).map((p) => ({ name: p.name, role: p.role_in_class, subjects: p.subjects || [] })) };
        } catch (_) {
          return { main_teacher: null, teachers: [] };
        }
      });
      const { rows: shown, truncated } = cap(listed.map((r, i) => ({ ...r, ...(staffOf[i] || {}) })));
      return {
        data: shown,
        totals: {
          classes: rows.length,
          ready_to_post: rows.filter((r) => r.ready_to_post).length,
          with_missing_scores: rows.filter((r) => r.scores_missing > 0).length,
          with_report_cards_not_posted: rows.filter((r) => r.report_cards_not_posted > 0).length,
          all_posted: rows.filter((r) => r.students > 0 && r.report_cards_not_posted === 0).length,
          listed: listed.length,
        },
        scope: {
          classes: classes.map((c) => c.name),
          classes_not_yours: notYours,
          term: rows[0] ? rows[0].term : null,
          status,
          ready_to_post_means: "Some report cards aren't posted yet, the class has assessments, and no score is missing.",
        },
        truncated,
      };
    },
  },

  // GET /internal/api/read/find_students?classes=Grade 4&rides_bus=yes&owes_fees=yes&min_absences=3&from=2026-11-01&to=2026-11-30&forms_outstanding=yes
  find_students: {
    async run(db, actor, q) {
      if (isDriver(actor)) throw new ReadError("PERMISSION_DENIED", "Drivers can see their own riders on the driver's page.");
      const { classes, notYours } = await classesFor(db, actor, q.classes);
      const ids = classes.map((c) => c.id);
      const className = new Map(classes.map((c) => [c.id, c.name]));
      const { rows: base } = await db.query(
        `SELECT student_id, first_name, last_name, class_id FROM students
          WHERE organization_id = $1 AND class_id = ANY($2::int[]) AND COALESCE(graduated, FALSE) = FALSE
          ORDER BY LOWER(last_name), LOWER(first_name), student_id`,
        [actor.organizationId, ids]
      );
      let keep = new Set(base.map((r) => Number(r.student_id)));
      const studentIds = [...keep];
      const extra = new Map(studentIds.map((id) => [id, {}]));
      const applied = [];
      const conditions = [];

      if (yes(q.rides_bus) || no(q.rides_bus)) {
        const map = await riders(db, actor, ids);
        const want = yes(q.rides_bus);
        conditions.push(want ? "rides the bus" : "doesn't ride the bus");
        keep = new Set([...keep].filter((id) => map.has(id) === want));
        map.forEach((value, id) => { if (extra.has(id)) extra.get(id).bus = value; });
        const ridingHere = [...map.keys()].filter((id) => extra.has(id)).length;
        applied.push({ condition: want ? "rides the bus (an active bus assignment)" : "no active bus assignment", students: want ? ridingHere : studentIds.length - ridingHere });
      }

      if (yes(q.owes_fees) || q.min_owed) {
        const result = await viaTool(db, actor, "get_overdue_balances", { classes: classes.map((c) => c.name).join(", "), min_amount: q.min_owed || undefined, period: q.fees_period || undefined }, "fees");
        if (result.truncated) throw new ReadError("VALIDATION", "Too many students owe fees in these classes to combine; name fewer classes.");
        const byKey = new Map(base.map((r) => [`${nameOf(r).toLowerCase()}|${String(className.get(Number(r.class_id)) || "").toLowerCase()}`, Number(r.student_id)]));
        const owing = new Map();
        (result.data || []).forEach((row) => {
          const id = Number(row.student_id) || byKey.get(`${String(row.student || "").toLowerCase()}|${String(row.class || "").toLowerCase()}`);
          if (id) owing.set(id, { owed: row.owedText || row.owed, status: row.status });
        });
        conditions.push(q.min_owed ? `owes at least ${q.min_owed}` : "owes fees");
        keep = new Set([...keep].filter((id) => owing.has(id)));
        owing.forEach((value, id) => { if (extra.has(id)) extra.get(id).fees = value; });
        applied.push({ condition: "owes fees (PayGira > Student ledger > Overdue)", students: owing.size, period: result.scope && result.scope.period });
      }

      const minAbsences = parseInt(q.min_absences, 10);
      if (Number.isInteger(minAbsences) && minAbsences > 0) {
        const result = await viaTool(db, actor, "get_attendance_summary", { classes: ids.join(","), from: q.from, to: q.to, term: q.term, min_absences: String(minAbsences), status: "all" }, "attendance");
        if (result.truncated) throw new ReadError("VALIDATION", "Too many students to combine attendance for; name fewer classes.");
        // A class whose attendance this person can't see would drop its students silently: refuse.
        const leftOut = result.scope && result.scope.left_out;
        if (leftOut) throw new ReadError("PERMISSION_DENIED", `Couldn't check attendance for every class: ${leftOut}. Ask about the classes you lead.`);
        const absent = new Map((result.data || []).filter((r) => Number(r.absent) >= minAbsences).map((r) => [Number(r.student_id), Number(r.absent)]));
        conditions.push(`absent at least ${minAbsences} day${minAbsences === 1 ? "" : "s"}`);
        keep = new Set([...keep].filter((id) => absent.has(id)));
        absent.forEach((n, id) => { if (extra.has(id)) extra.get(id).absences = n; });
        const sc = result.scope || {};
        applied.push({ condition: `absent at least ${minAbsences} school day${minAbsences === 1 ? "" : "s"}`, students: absent.size, from: sc.from || q.from || null, to: sc.to || q.to || null, term: sc.term || null, school_days: result.totals && result.totals.school_days });
      }

      if (yes(q.forms_outstanding)) {
        const formRequests = require("../formRequests");
        let status;
        try {
          status = await formRequests.status(db, actor, { classIds: ids, audience: "parent", status: "outstanding" });
        } catch (error) {
          if (error instanceof formRequests.FormsError) throw new ReadError(error.code, `Couldn't check forms: ${error.message}`, error.status);
          throw error;
        }
        if (status.truncated) throw new ReadError("VALIDATION", "Too many students with forms outstanding to combine; name fewer classes.");
        const owe = new Map(status.students.map((s) => [Number(s.studentId), s.outstanding.map((o) => o.title)]));
        conditions.push("a parent form outstanding");
        keep = new Set([...keep].filter((id) => owe.has(id)));
        owe.forEach((titles, id) => { if (extra.has(id)) extra.get(id).forms_outstanding = titles; });
        applied.push({ condition: "a form parents haven't completed", students: owe.size });
      }

      if (!conditions.length) throw new ReadError("VALIDATION", "Which conditions? rides_bus, owes_fees (or min_owed), min_absences (with from/to), forms_outstanding.");
      const matched = base.filter((r) => keep.has(Number(r.student_id)));
      const { rows, truncated } = cap(matched);
      return {
        data: rows.map((r) => ({ student_id: Number(r.student_id), student: nameOf(r), class: className.get(Number(r.class_id)) || "", ...extra.get(Number(r.student_id)) })),
        totals: { students_in_scope: base.length, matched: matched.length },
        scope: { classes: classes.map((c) => c.name), classes_not_yours: notYours, all_of: conditions, each_condition: applied },
        truncated,
      };
    },
  },
};
