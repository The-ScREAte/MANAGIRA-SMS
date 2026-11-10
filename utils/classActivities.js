"use strict";

// Activities for the whole school, a class or one student. They appear on the staff calendar,
// on the parents' and students' calendars and tiles, and on their Activities pages. An
// activity can also email families a reminder the day before (sendActivityReminders).
const { createNotifications } = require("./notificationService");

// Activities for one student and reminders come from database/migrations/
// 2026-11-09_activity_students_reminders.sql; until it has run, everything works as before.
let extrasKnown = { value: null, at: 0 };
async function hasExtras(db) {
  if (extrasKnown.value === true || (extrasKnown.value === false && Date.now() - extrasKnown.at < 60000)) return extrasKnown.value;
  try {
    await db.query("SELECT student_id, remind_families, reminded_at FROM class_activities LIMIT 0");
    extrasKnown = { value: true, at: Date.now() };
  } catch (error) {
    extrasKnown = { value: false, at: Date.now() };
  }
  return extrasKnown.value;
}

const TABLE_MISSING = "42P01";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

class ActivityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (value, max) => String(value === null || value === undefined ? "" : value).trim().slice(0, max);
const dayOf = (value) => (DAY.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ? String(value) : null);
const timeOf = (value) => (TIME.test(String(value || "")) ? String(value).slice(0, 5) : null);

function readActivity(body = {}) {
  const title = text(body.title, 200);
  const date = dayOf(body.date);
  if (!title) throw new ActivityError("Give the activity a title.");
  if (!date) throw new ActivityError("Pick a date.");
  const endDate = dayOf(body.endDate);
  const startTime = timeOf(body.startTime);
  const endTime = timeOf(body.endTime);
  if (endDate && endDate < date) throw new ActivityError("The end date is before the start date.");
  if (startTime && endTime && (!endDate || endDate === date) && endTime < startTime) throw new ActivityError("The end time is before the start time.");
  return {
    title,
    date,
    endDate: endDate && endDate !== date ? endDate : null,
    startTime,
    endTime: startTime ? endTime : null,
    location: text(body.location, 200) || null,
    details: text(body.details, 4000) || null,
    remind: body.remind === true || body.remind === "true",
  };
}

const present = (row) => ({
  id: Number(row.activity_id),
  classId: row.class_id === null ? null : Number(row.class_id),
  className: row.class_name || "",
  title: row.title,
  details: row.details || "",
  date: row.day,
  endDate: row.end_day || null,
  startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
  endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
  location: row.location || "",
  createdBy: row.created_by_name || "",
  studentId: row.student_id ? Number(row.student_id) : null,
  studentName: row.student_name ? String(row.student_name).trim() : "",
  remind: row.remind_families === true,
});

const SELECT = `
  SELECT a.activity_id, a.class_id, c.class_name, a.title, a.details, a.start_time, a.end_time, a.location, a.created_by_name,
         to_char(a.activity_date, 'YYYY-MM-DD') AS day, to_char(a.end_date, 'YYYY-MM-DD') AS end_day
    FROM class_activities a
    LEFT JOIN classes c ON c.class_id = a.class_id AND c.organization_id = a.organization_id`;
const SELECT_EXTRAS = `
  SELECT a.activity_id, a.class_id, COALESCE(c.class_name, sc.class_name) AS class_name, a.title, a.details, a.start_time, a.end_time,
         a.location, a.created_by_name, a.student_id, a.remind_families,
         NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), '') AS student_name,
         to_char(a.activity_date, 'YYYY-MM-DD') AS day, to_char(a.end_date, 'YYYY-MM-DD') AS end_day
    FROM class_activities a
    LEFT JOIN classes c ON c.class_id = a.class_id AND c.organization_id = a.organization_id
    LEFT JOIN students st ON st.student_id = a.student_id AND st.organization_id = a.organization_id
    LEFT JOIN classes sc ON sc.class_id = st.class_id AND sc.organization_id = a.organization_id`;

// classIds null: everything in the school. Otherwise the whole-school activities, those
// classes', and activities for one student: for the students given (a family), or, with no
// students given (a teacher), for the students in those classes.
async function listActivities(db, organizationId, { classIds = null, studentIds = null, from = null, to = null } = {}) {
  try {
    if (await hasExtras(db)) {
      const { rows } = await db.query(
        `${SELECT_EXTRAS}
          WHERE a.organization_id = $1
            AND (
              $2::int[] IS NULL
              OR (a.student_id IS NULL AND (a.class_id IS NULL OR a.class_id = ANY($2::int[])))
              OR (a.student_id IS NOT NULL AND (a.student_id = ANY($5::int[]) OR ($5::int[] IS NULL AND st.class_id = ANY($2::int[]))))
            )
            AND ($3::date IS NULL OR COALESCE(a.end_date, a.activity_date) >= $3::date)
            AND ($4::date IS NULL OR a.activity_date < $4::date)
          ORDER BY a.activity_date, a.start_time NULLS FIRST, a.activity_id`,
        [organizationId, classIds, dayOf(from), dayOf(to), Array.isArray(studentIds) ? studentIds.map(Number) : null]
      );
      return rows.map(present);
    }
    const { rows } = await db.query(
      `${SELECT}
        WHERE a.organization_id = $1
          AND ($2::int[] IS NULL OR a.class_id IS NULL OR a.class_id = ANY($2::int[]))
          AND ($3::date IS NULL OR COALESCE(a.end_date, a.activity_date) >= $3::date)
          AND ($4::date IS NULL OR a.activity_date < $4::date)
        ORDER BY a.activity_date, a.start_time NULLS FIRST, a.activity_id`,
      [organizationId, classIds, dayOf(from), dayOf(to)]
    );
    return rows.map(present);
  } catch (error) {
    if (error.code === TABLE_MISSING) return [];
    throw error;
  }
}

async function findActivity(db, organizationId, id) {
  const extras = await hasExtras(db);
  const { rows } = await db.query(
    `SELECT a.activity_id, a.class_id${extras ? ", a.student_id, st.class_id AS student_class_id" : ""}
       FROM class_activities a
       ${extras ? "LEFT JOIN students st ON st.student_id = a.student_id AND st.organization_id = a.organization_id" : ""}
      WHERE a.organization_id = $1 AND a.activity_id = $2`,
    [organizationId, id]
  );
  return rows[0] || null;
}

async function saveActivity(db, organizationId, actor, id, classId, activity, studentId = null) {
  if (await hasExtras(db)) {
    // A new date means a new reminder for the new day.
    if (id) {
      const { rows } = await db.query(
        `UPDATE class_activities
            SET class_id = $3, title = $4, details = $5, end_date = $7, start_time = $8, end_time = $9, location = $10,
                student_id = $11, remind_families = $12,
                reminded_at = CASE WHEN activity_date IS DISTINCT FROM $6::date THEN NULL ELSE reminded_at END,
                activity_date = $6, updated_at = NOW()
          WHERE organization_id = $1 AND activity_id = $2
          RETURNING activity_id`,
        [organizationId, id, classId, activity.title, activity.details, activity.date, activity.endDate, activity.startTime, activity.endTime, activity.location, studentId, activity.remind]
      );
      if (!rows[0]) throw new ActivityError("That activity no longer exists.", 404);
      return Number(rows[0].activity_id);
    }
    const { rows } = await db.query(
      `INSERT INTO class_activities (organization_id, class_id, title, details, activity_date, end_date, start_time, end_time, location, created_by, created_by_name, student_id, remind_families)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING activity_id`,
      [organizationId, classId, activity.title, activity.details, activity.date, activity.endDate, activity.startTime, activity.endTime, activity.location, actor.userId, actor.name, studentId, activity.remind]
    );
    tellFamilies(db, organizationId, classId, activity, studentId).catch((error) => console.error("[Activities]", error.message));
    return Number(rows[0].activity_id);
  }
  if (studentId) throw new ActivityError("Activities for one student aren't ready yet. Try again shortly.", 503);
  if (id) {
    const { rows } = await db.query(
      `UPDATE class_activities
          SET class_id = $3, title = $4, details = $5, activity_date = $6, end_date = $7, start_time = $8, end_time = $9, location = $10, updated_at = NOW()
        WHERE organization_id = $1 AND activity_id = $2
        RETURNING activity_id`,
      [organizationId, id, classId, activity.title, activity.details, activity.date, activity.endDate, activity.startTime, activity.endTime, activity.location]
    );
    if (!rows[0]) throw new ActivityError("That activity no longer exists.", 404);
    return Number(rows[0].activity_id);
  }
  const { rows } = await db.query(
    `INSERT INTO class_activities (organization_id, class_id, title, details, activity_date, end_date, start_time, end_time, location, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING activity_id`,
    [organizationId, classId, activity.title, activity.details, activity.date, activity.endDate, activity.startTime, activity.endTime, activity.location, actor.userId, actor.name]
  );
  tellFamilies(db, organizationId, classId, activity).catch((error) => console.error("[Activities]", error.message));
  return Number(rows[0].activity_id);
}

async function deleteActivity(db, organizationId, id) {
  await db.query("DELETE FROM class_activities WHERE organization_id = $1 AND activity_id = $2", [organizationId, id]);
}

// A bell for each family concerned (one student's, a class's or the whole school's).
// The reminder email, when asked for, goes the day before (sendActivityReminders).
async function tellFamilies(db, organizationId, classId, activity, studentId = null) {
  const { rows } = await db.query(
    `SELECT DISTINCT x.guardian_id FROM (
       SELECT gs.guardian_id, gs.student_id FROM guardian_students gs
     ) x
     JOIN students s ON s.student_id = x.student_id AND s.organization_id = $1
     WHERE x.guardian_id IS NOT NULL AND COALESCE(s.graduated, FALSE) = FALSE
       AND ($3::int IS NOT NULL AND s.student_id = $3 OR $3::int IS NULL AND ($2::int IS NULL OR s.class_id = $2))`,
    [organizationId, classId, studentId]
  );
  await createNotifications(db, rows.map((row) => ({
    orgId: organizationId,
    recipientType: "guardian",
    recipientId: row.guardian_id,
    type: "class_activity",
    title: `New activity: ${activity.title}`,
    body: new Date(`${activity.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    link: `/guardian/calendar?date=${activity.date}`,
  })));
}

// The day before: one reminder email per family for each activity that asked for it, from
// reminders@managira.com. Each activity is claimed first, so it's sent once even when several
// servers run the job. Run daily (jobs/scheduler.js).
async function sendActivityReminders(db, { today = new Date() } = {}) {
  if (!(await hasExtras(db))) return { activities: 0, emails: 0 };
  const tomorrow = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)).toISOString().slice(0, 10);
  const due = (await db.query(
    `SELECT a.activity_id FROM class_activities a
      WHERE a.remind_families AND a.reminded_at IS NULL AND a.activity_date = $1::date`,
    [tomorrow]
  ).catch((error) => { if (error.code === TABLE_MISSING) return { rows: [] }; throw error; })).rows;
  const { sendEmailInBackground, renderCleanEmail } = require("./emailHelper");
  const base = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/$/, "");
  let activitiesSent = 0;
  let emails = 0;
  for (const { activity_id: activityId } of due) {
    const claimed = await db.query(
      `UPDATE class_activities SET reminded_at = NOW() WHERE activity_id = $1 AND reminded_at IS NULL
       RETURNING activity_id, organization_id, class_id, student_id, title, details, location,
                 to_char(activity_date, 'YYYY-MM-DD') AS day, start_time, end_time`,
      [activityId]
    );
    const a = claimed.rows[0];
    if (!a) continue;
    activitiesSent += 1;
    const [school, families] = await Promise.all([
      db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [a.organization_id]),
      db.query(
        `SELECT DISTINCT ON (LOWER(x.email)) x.email, x.first_name, s.first_name AS child
           FROM (
             SELECT gp.email, gp.first_name, gs.student_id FROM guardian_students gs
               JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
             UNION ALL
             SELECT g.email, g.first_name, g.student_id FROM guardians g WHERE g.organization_id = $1
           ) x
           JOIN students s ON s.student_id = x.student_id AND s.organization_id = $1
          WHERE COALESCE(TRIM(x.email), '') <> '' AND COALESCE(s.graduated, FALSE) = FALSE
            AND ($3::int IS NOT NULL AND s.student_id = $3 OR $3::int IS NULL AND ($2::int IS NULL OR s.class_id = $2))
          ORDER BY LOWER(x.email)`,
        [a.organization_id, a.class_id, a.student_id]
      ),
    ]);
    const schoolName = (school.rows[0] && school.rows[0].organization_name) || "Your school";
    const day = new Date(`${a.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    const clock = (t) => (t ? new Date(`2000-01-01T${String(t).slice(0, 5)}:00Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "");
    const time = a.start_time ? `${clock(a.start_time)}${a.end_time ? ` – ${clock(a.end_time)}` : ""}` : "All day";
    families.rows.forEach((family) => {
      emails += 1;
      sendEmailInBackground({
        sender: "reminders",
        to: family.email,
        subject: `Tomorrow: ${a.title}`,
        html: renderCleanEmail({
          title: `Tomorrow: ${a.title}`,
          greeting: `Hello${family.first_name ? ` ${family.first_name}` : ""},`,
          paragraphs: [
            `A reminder from ${schoolName}${family.child ? ` about ${family.child}` : ""}.`,
            ...(a.details ? String(a.details).split(/\n+/) : []),
          ],
          details: [
            { label: "When", value: `${day}, ${time}` },
            ...(a.location ? [{ label: "Where", value: a.location }] : []),
          ],
          note: `See it on your calendar: ${base}/guardian/calendar?date=${a.day}`,
        }),
      }, "Activity reminder");
    });
  }
  return { activities: activitiesSent, emails };
}

module.exports = { ActivityError, readActivity, listActivities, findActivity, saveActivity, deleteActivity, sendActivityReminders, hasExtras };
