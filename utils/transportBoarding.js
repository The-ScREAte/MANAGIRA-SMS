"use strict";

// Who is riding today and who has boarded. Drivers answer once per stop while any number of
// parents and teachers watch, so viewers of a school share one read every few seconds.
const { BoundedMap } = require("./boundedMap");
const { createNotifications } = require("./notificationService");
const { ReportError } = require("./transportReports");

const SHARED_READ_MS = 8000;
const FAMILY_MS = 5 * 60 * 1000;
const RECENT_HOURS = 12;
const DAY_MS = 86400000;
const TABLE_MISSING = "42P01";

const days = new BoundedMap(5000); // "org:day" -> { at, reading }
const families = new BoundedMap(20000); // "org:guardian" -> { at, studentIds, riders }

// The phone's own date, since a school's morning can be yesterday in UTC.
function dayFrom(value) {
  const text = String(value || "");
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T12:00:00Z`) : NaN;
  if (Number.isFinite(asked) && Math.abs(asked - Date.now()) < 2 * DAY_MS) return text;
  return new Date().toISOString().slice(0, 10);
}

function intList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

async function readDay(db, organizationId, day) {
  const [notRiding, boardings] = await Promise.all([
    db.query("SELECT student_id, set_by FROM transport_not_riding WHERE organization_id = $1 AND ride_date = $2", [organizationId, day]),
    db.query(
      `SELECT b.boarding_id, b.student_id, b.boarded, b.stop_name, b.recorded_at, s.first_name
         FROM transport_boardings b
         JOIN students s ON s.student_id = b.student_id
        WHERE b.organization_id = $1 AND b.recorded_at > NOW() - make_interval(hours => $2)
        ORDER BY b.recorded_at`,
      [organizationId, RECENT_HOURS]
    ),
  ]);
  return {
    notRiding: notRiding.rows.map((row) => ({ studentId: Number(row.student_id), by: row.set_by })),
    events: boardings.rows.map((row) => ({
      id: Number(row.boarding_id),
      studentId: Number(row.student_id),
      name: row.first_name || "",
      boarded: row.boarded,
      stop: row.stop_name || "",
      at: row.recorded_at,
    })),
  };
}

// Before the migration there is simply nothing to show, and every page keeps working.
function schoolDay(db, organizationId, day) {
  const key = `${organizationId}:${day}`;
  const hit = days.get(key);
  if (hit && Date.now() - hit.at < SHARED_READ_MS) return hit.reading;
  const reading = readDay(db, organizationId, day).catch((error) => {
    days.delete(key);
    if (error.code === TABLE_MISSING) return { notRiding: [], events: [] };
    throw error;
  });
  days.set(key, { at: Date.now(), reading });
  return reading;
}

function saving(work) {
  return work().catch((error) => {
    if (error.code === TABLE_MISSING) throw new ReportError("This isn't available yet.", 503);
    throw error;
  });
}

async function setRiding(db, organizationId, studentId, day, coming, who) {
  await saving(() => (coming
    ? db.query("DELETE FROM transport_not_riding WHERE organization_id = $1 AND student_id = $2 AND ride_date = $3", [organizationId, studentId, day])
    : db.query(
        `INSERT INTO transport_not_riding (organization_id, student_id, ride_date, set_by, set_by_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, student_id, ride_date)
         DO UPDATE SET set_by = EXCLUDED.set_by, set_by_name = EXCLUDED.set_by_name, created_at = NOW()`,
        [organizationId, studentId, day, who.by, who.name || null]
      )));
  days.delete(`${organizationId}:${day}`);
}

// Parents hear about each change once: only new or changed rows come back from the save.
async function saveBoarding(db, organizationId, driver, trip, body) {
  const studentIds = intList(body.studentIds);
  if (!studentIds.length) return { saved: 0 };
  const stopId = Number(body.stopId);
  const { rows } = await saving(() => db.query(
    `INSERT INTO transport_boardings (organization_id, trip_id, student_id, stop_id, stop_name, boarded, confirmed_by, driver_user_id)
     SELECT $1, $2, s.student_id, st.stop_id, st.stop_name, NOT (s.student_id = ANY($5::int[])), $6, $7
       FROM students s
       JOIN transport_student_assignments a
         ON a.organization_id = s.organization_id AND a.student_id = s.student_id AND a.active = TRUE
       LEFT JOIN transport_stops st ON st.organization_id = s.organization_id AND st.stop_id = $3
      WHERE s.organization_id = $1 AND s.student_id = ANY($4::int[]) AND (a.bus_id = $8 OR a.route_id = $9)
     ON CONFLICT (trip_id, student_id) DO UPDATE
        SET boarded = EXCLUDED.boarded, stop_id = EXCLUDED.stop_id, stop_name = EXCLUDED.stop_name,
            confirmed_by = EXCLUDED.confirmed_by, recorded_at = NOW()
      WHERE transport_boardings.boarded IS DISTINCT FROM EXCLUDED.boarded
     RETURNING student_id, boarded, stop_name`,
    [
      organizationId, trip.trip_id, Number.isInteger(stopId) && stopId > 0 ? stopId : null, studentIds, intList(body.notBoarded),
      body.auto === true ? "auto" : "driver", driver.userId, trip.bus_id, trip.route_id,
    ]
  ));
  [...days.keys()].filter((key) => key.startsWith(`${organizationId}:`)).forEach((key) => days.delete(key));
  if (rows.length) tellFamilies(db, organizationId, trip, rows).catch((error) => console.error("[Bus boarding]", error.message));
  return { saved: rows.length };
}

async function tellFamilies(db, organizationId, trip, changed) {
  const ids = changed.map((row) => Number(row.student_id));
  const { rows } = await db.query(
    `SELECT DISTINCT x.guardian_id, x.student_id, s.first_name
       FROM (
         SELECT gs.guardian_id, gs.student_id FROM guardian_students gs WHERE gs.student_id = ANY($2::int[])
       ) x
       JOIN students s ON s.student_id = x.student_id AND s.organization_id = $1
      WHERE x.guardian_id IS NOT NULL`,
    [organizationId, ids]
  );
  const byStudent = new Map(changed.map((row) => [Number(row.student_id), row]));
  await createNotifications(db, rows.map((row) => {
    const saved = byStudent.get(Number(row.student_id));
    return {
      orgId: organizationId,
      recipientType: "guardian",
      recipientId: row.guardian_id,
      type: "bus_boarding",
      title: `${row.first_name} ${saved.boarded ? "boarded the bus" : "did not board"}`,
      body: saved.stop_name || null,
      link: "/guardian/dashboard",
      refId: trip.trip_id,
    };
  }));
}

async function tripBoardings(db, organizationId, tripId) {
  try {
    const { rows } = await db.query(
      "SELECT student_id, stop_id, boarded FROM transport_boardings WHERE organization_id = $1 AND trip_id = $2",
      [organizationId, tripId]
    );
    return rows.map((row) => ({ studentId: Number(row.student_id), stopId: row.stop_id === null ? null : Number(row.stop_id), boarded: row.boarded }));
  } catch (error) {
    if (error.code === TABLE_MISSING) return [];
    throw error;
  }
}

// Called every few seconds per parent, so the children are kept for a few minutes.
async function familyOf(db, organizationId, guardianId, loadStudentIds) {
  const key = `${organizationId}:${guardianId}`;
  const hit = families.get(key);
  if (hit && Date.now() - hit.at < FAMILY_MS) return hit;
  const studentIds = await loadStudentIds();
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS riders FROM transport_student_assignments WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND active = TRUE",
    [organizationId, studentIds]
  );
  const family = { at: Date.now(), studentIds, riders: rows[0].riders };
  families.set(key, family);
  return family;
}

function forStudents(reading, studentIds) {
  const wanted = new Set(studentIds);
  return {
    notRiding: reading.notRiding.filter((row) => wanted.has(row.studentId)),
    events: reading.events.filter((row) => wanted.has(row.studentId)),
  };
}

// The request goes to the leads with the other bus reports. Asking twice sends it once.
async function askToStopBus(db, organizationId, studentId, parentName) {
  await db.query(
    `INSERT INTO transport_driver_reports (organization_id, driver_name, bus_id, route_id, student_id, category, issue, priority, details)
     SELECT $1, $2, a.bus_id, a.route_id, a.student_id, 'student', 'Stop using the bus', 'normal', $3
       FROM transport_student_assignments a
      WHERE a.organization_id = $1 AND a.student_id = $4 AND a.active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM transport_driver_reports r
           WHERE r.organization_id = $1 AND r.student_id = $4 AND r.issue = 'Stop using the bus' AND r.status = 'new'
        )`,
    [organizationId, parentName || "Parent", "Asked by a parent.", studentId]
  );
}

module.exports = { dayFrom, schoolDay, setRiding, saveBoarding, tripBoardings, familyOf, forStudents, askToStopBus };
