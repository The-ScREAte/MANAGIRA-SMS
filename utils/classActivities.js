"use strict";

// Activities for a class or the whole school. They appear on the staff calendar and on the
// parents' calendar and student tiles.
const { createNotifications } = require("./notificationService");

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
});

const SELECT = `
  SELECT a.activity_id, a.class_id, c.class_name, a.title, a.details, a.start_time, a.end_time, a.location, a.created_by_name,
         to_char(a.activity_date, 'YYYY-MM-DD') AS day, to_char(a.end_date, 'YYYY-MM-DD') AS end_day
    FROM class_activities a
    LEFT JOIN classes c ON c.class_id = a.class_id AND c.organization_id = a.organization_id`;

// classIds null: everything in the school. Otherwise those classes and the whole-school ones.
async function listActivities(db, organizationId, { classIds = null, from = null, to = null } = {}) {
  try {
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
  const { rows } = await db.query("SELECT activity_id, class_id FROM class_activities WHERE organization_id = $1 AND activity_id = $2", [organizationId, id]);
  return rows[0] || null;
}

async function saveActivity(db, organizationId, actor, id, classId, activity) {
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

// A bell for each family concerned. Nothing is emailed.
async function tellFamilies(db, organizationId, classId, activity) {
  const { rows } = await db.query(
    `SELECT DISTINCT x.guardian_id FROM (
       SELECT g.guardian_id, g.student_id FROM guardians g WHERE g.organization_id = $1
       UNION
       SELECT gs.guardian_id, gs.student_id FROM guardian_students gs
     ) x
     JOIN students s ON s.student_id = x.student_id AND s.organization_id = $1
     WHERE x.guardian_id IS NOT NULL AND COALESCE(s.graduated, FALSE) = FALSE AND ($2::int IS NULL OR s.class_id = $2)`,
    [organizationId, classId]
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

module.exports = { ActivityError, readActivity, listActivities, findActivity, saveActivity, deleteActivity };
