"use strict";

// Attendance notices to parents (feature attendance_notices): when a student has been absent, or marked late, as many
// times in a week as their class's settings say (Class settings › Attendance notices: 3 to start), their parents are told
// once for that week, in Managira and by email (`alertRules.deliver`: one event per parent, child and week, so a later
// absence the same week never repeats it). A class that turned a notice off, or keeps attendance from parents, says nothing.
// Called after a day's attendance is saved, in the background.

const features = require("./shards/features");
const classSettings = require("./classSettings");

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// The Monday to Sunday week a date (YYYY-MM-DD) falls in.
function weekOf(dateKey) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - back * 86400000);
  return { start: keyOf(start), end: keyOf(new Date(start.getTime() + 6 * 86400000)) };
}

const when = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function run(db, organizationId, { studentIds = [], date = null } = {}) {
  try {
    if (!features.isOn("attendance_notices", { organizationId: Number(organizationId) }) || !classSettings.isOn(organizationId)) return 0;
    const ids = [...new Set((studentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const dateKey = /^\d{4}-\d{2}-\d{2}/.test(String(date || "")) ? String(date).slice(0, 10) : keyOf(new Date());
    if (!ids.length) return 0;
    const { alreadyThere } = require("./schemaHas");
    const lateReady = await alreadyThere(db, { columns: [["attendance_records", "late"]] });
    const week = weekOf(dateKey);

    const { rows } = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.class_id,
              COUNT(*) FILTER (WHERE ar.status::text = 'Absent')::int AS absent,
              ${lateReady ? "COUNT(*) FILTER (WHERE ar.status::text = 'Present' AND ar.late)" : "0"}::int AS late
         FROM students s
         JOIN attendance_records ar ON ar.student_id = s.student_id AND ar.organization_id = s.organization_id AND ar.date BETWEEN $3::date AND $4::date
        WHERE s.organization_id = $1 AND s.student_id = ANY($2::int[])
        GROUP BY s.student_id, s.first_name, s.last_name, s.class_id`,
      [organizationId, ids, week.start, week.end]
    );
    if (!rows.length) return 0;

    const byClass = await classSettings.settingsForClasses(db, organizationId, [...new Set(rows.map((r) => Number(r.class_id)).filter(Boolean))]);
    const parentsSee = await classSettings.parentsSeeFor(db, organizationId, rows.map((r) => Number(r.student_id))).catch(() => new Map());
    const due = [];
    rows.forEach((r) => {
      const settings = byClass.get(Number(r.class_id)) || classSettings.withDefaults(null);
      if (parentsSee.has(Number(r.student_id)) && parentsSee.get(Number(r.student_id)).attendance === false) return;
      [["absent", r.absent], ["late", r.late]].forEach(([kind, count]) => {
        const rule = settings.notices[kind];
        if (rule.on && count >= rule.count) due.push({ kind, count, student: r });
      });
    });
    if (!due.length) return 0;

    const guardians = await db.query(
      `SELECT gs.student_id, gp.guardian_id, gp.first_name, TRIM(COALESCE(gp.email, '')) AS email, TRIM(COALESCE(gp.phone, '')) AS phone
         FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
        WHERE gs.student_id = ANY($2::int[])`,
      [organizationId, due.map((d) => Number(d.student.student_id))]
    );
    const alertRules = require("./alertRules");
    const school = await alertRules.schoolOf(db, organizationId);
    let told = 0;
    for (const item of due) {
      const child = `${item.student.first_name || ""} ${item.student.last_name || ""}`.trim();
      const first = item.student.first_name || "Your child";
      const times = item.count === 1 ? "once" : `${item.count} times`;
      const event = {
        kind: `attendance_${item.kind}`,
        refKey: `${item.kind}:${week.start}:s${item.student.student_id}`,
        studentId: Number(item.student.student_id),
        title: item.kind === "absent" ? `${child} has been absent ${times} this week` : `${child} has been late ${times} this week`,
        body: `${item.kind === "absent" ? "Marked absent" : "Marked late"} ${times} in the week of ${when(week.start)}. If something is making it hard for ${first} to get to school on time, please let the school know.`,
        link: `/guardian/academic-details?studentId=${item.student.student_id}`,
      };
      for (const g of guardians.rows.filter((row) => Number(row.student_id) === Number(item.student.student_id))) {
        const person = { type: "guardian", audience: "guardian", id: Number(g.guardian_id), email: g.email, phone: g.phone, firstName: g.first_name };
        // eslint-disable-next-line no-await-in-loop
        if (await alertRules.deliver(db, organizationId, person, { channels: ["bell", "email"] }, event, school)) told += 1;
      }
    }
    return told;
  } catch (error) {
    console.error("[Attendance notices]", error.message);
    return 0;
  }
}

module.exports = { run, weekOf };
