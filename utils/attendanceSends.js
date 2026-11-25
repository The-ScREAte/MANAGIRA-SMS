"use strict";

// Families hear about a day's attendance after the teacher is done, not the moment they press Save.
// Saving a class's day only records a pending send (table attendance_sends, one row per class and day):
//   - saved, nobody says anything: families are told 2 hours after the last save;
//   - the teacher answers "Yes, I'm done": families are told 30 minutes later;
//   - saved again before then (a correction): the marks are updated and the wait is kept, never restarted
//     for a confirmed day, restarted from the new save for an unconfirmed one.
// A small job (jobs/scheduler.js, every 5 minutes) tells the families whose time has come, from the marks as
// they stand at that moment, so a child corrected to Present is not mentioned. Each alert is one event per
// parent, child and day (alertRules.deliver), so nobody is told twice.
// Until the migration (2027-01-14_attendance_sends.sql) has run, families are told straight away, as before.

const CONFIRMED_WAIT_MS = 30 * 60 * 1000;
const UNCONFIRMED_WAIT_MS = 2 * 60 * 60 * 1000;

const dayKey = (date) => (/^\d{4}-\d{2}-\d{2}/.test(String(date || "")) ? String(date).slice(0, 10) : null);

const ready = async (db) => require("./schemaHas").alreadyThere(db, { tables: ["attendance_sends"] });

// Whether this school would tell families about an absence at all (so a teacher is only asked when it matters).
async function mayTellFamilies(db, organizationId) {
  const features = require("./shards/features");
  const org = { organizationId: Number(organizationId) };
  if (features.isOn("attendance_notices", org) || features.isOn("alert_rules", org)) return true;
  try {
    const { rows } = await db.query("SELECT enable_parent_absence_alerts AS on FROM notification_policies WHERE organization_id = $1", [organizationId]);
    return !rows[0] || rows[0].on !== false;
  } catch (_) {
    return true;
  }
}

// The three ways a family hears about an absence, as they were when a save sent them at once.
async function tellFamilies(db, organizationId, studentIds, date) {
  if (!studentIds || !studentIds.length) return;
  // A school that keeps attendance elsewhere tells nobody about it.
  if (!(await require("./schoolServices").attendanceOn(db, organizationId))) return;
  const { triggerAbsenceAlertsForStudents } = require("./notificationDigestService");
  await Promise.all([
    triggerAbsenceAlertsForStudents(db, organizationId, studentIds).catch((error) => console.error("[Attendance] Absence-threshold notification failed:", error.message)),
    require("./alertRules").onAbsent(db, organizationId, studentIds, date),
    require("./attendanceNotices").run(db, organizationId, { studentIds, date }),
  ]);
}

// A class's day was saved. Returns { held, confirmed } (held false: the migration hasn't run and families were told now).
async function onSaved(db, organizationId, { classId, date, studentIds, now = new Date() }) {
  const day = dayKey(date);
  if (!day || !studentIds || !studentIds.length) return { held: false, confirmed: false };
  if (!(await require("./schoolServices").attendanceOn(db, organizationId))) return { held: false, confirmed: false };
  try {
    if (!(await ready(db)) || !classId) throw new Error("not ready");
    const { rows } = await db.query(
      `INSERT INTO attendance_sends (organization_id, class_id, attendance_date, saved_at, send_after)
       VALUES ($1, $2, $3::date, $4::timestamptz, $4::timestamptz + $5 * INTERVAL '1 millisecond')
       ON CONFLICT (organization_id, class_id, attendance_date) DO UPDATE SET
         saved_at = EXCLUDED.saved_at,
         send_after = CASE
           WHEN attendance_sends.sent_at IS NOT NULL AND attendance_sends.confirmed_at IS NOT NULL THEN EXCLUDED.saved_at + $6 * INTERVAL '1 millisecond'
           WHEN attendance_sends.sent_at IS NOT NULL OR attendance_sends.confirmed_at IS NULL THEN EXCLUDED.saved_at + $5 * INTERVAL '1 millisecond'
           ELSE attendance_sends.send_after END,
         sent_at = NULL
       RETURNING confirmed_at`,
      [organizationId, classId, day, now, UNCONFIRMED_WAIT_MS, CONFIRMED_WAIT_MS]
    );
    return { held: true, confirmed: Boolean(rows[0] && rows[0].confirmed_at) };
  } catch (_) {
    tellFamilies(db, organizationId, studentIds, day).catch((error) => console.error("[Attendance] Notifying families failed:", error.message));
    return { held: false, confirmed: false };
  }
}

// "Yes, I'm done": families hear 30 minutes from now. False when that class and day has nothing waiting.
async function confirm(db, organizationId, { classId, date, now = new Date() }) {
  const day = dayKey(date);
  if (!day || !(await ready(db))) return false;
  const { rowCount } = await db.query(
    `UPDATE attendance_sends
        SET confirmed_at = COALESCE(confirmed_at, $4::timestamptz),
            send_after = CASE WHEN sent_at IS NULL AND confirmed_at IS NULL THEN $4::timestamptz + $5 * INTERVAL '1 millisecond' ELSE send_after END
      WHERE organization_id = $1 AND class_id = $2 AND attendance_date = $3::date`,
    [organizationId, classId, day, now, CONFIRMED_WAIT_MS]
  );
  return rowCount > 0;
}

// Tells the families whose time has come. Safe to run twice (nobody is told twice); returns how many class days were done.
async function sendDue(db, { now = new Date(), limit = 100 } = {}) {
  if (!(await ready(db))) return 0;
  const due = await db.query(
    `SELECT id, organization_id, class_id, attendance_date::text AS day, saved_at
       FROM attendance_sends WHERE sent_at IS NULL AND send_after <= $1::timestamptz ORDER BY send_after LIMIT $2`,
    [now, limit]
  );
  let done = 0;
  for (const row of due.rows) {
    try {
      const marks = await db.query(
        "SELECT DISTINCT student_id FROM attendance_records WHERE organization_id = $1 AND class_id = $2 AND date = $3::date",
        [row.organization_id, row.class_id, row.day]
      );
      await module.exports.tellFamilies(db, row.organization_id, marks.rows.map((r) => Number(r.student_id)), row.day);
      // A save that came in meanwhile has its own wait: leave that one pending.
      await db.query("UPDATE attendance_sends SET sent_at = $2::timestamptz WHERE id = $1 AND sent_at IS NULL AND saved_at = $3::timestamptz", [row.id, now, row.saved_at]);
      done += 1;
    } catch (error) {
      console.error("[Attendance] Telling families failed:", error.message);
    }
  }
  return done;
}

module.exports = { CONFIRMED_WAIT_MS, UNCONFIRMED_WAIT_MS, mayTellFamilies, tellFamilies, onSaved, confirm, sendDue };
