"use strict";

// Reports from drivers to their leads, and the arrival check at the end of a trip. A
// report stays between the driver and the leads until a lead shares it with the
// student's parents or teachers.
const CATEGORIES = {
  bus: "Bus",
  student: "Student",
  route: "Route or road",
  complaint: "Complaint",
  arrival: "Arrival",
  other: "Other",
};
// The form's two linked dropdowns: choose a type, then an issue of that type.
const REPORT_TYPES = {
  student: { label: "Student", issues: ["Fighting", "Bullying", "Sick or injured", "Bad behavior", "Not at the stop", "Late to the stop", "Left something on the bus", "Other"] },
  bus: { label: "Bus", issues: ["Breakdown", "Accident", "Flat tire", "Low fuel", "Needs service", "Heating or AC", "Door or seat problem", "Other"] },
  route: { label: "Route or road", issues: ["Road closed", "Heavy traffic", "Unsafe stop", "Wrong address", "Bad weather", "Other"] },
  complaint: { label: "Complaint", issues: ["From a parent", "From a student", "From staff", "About another driver", "Other"] },
  other: { label: "Other", issues: ["Other"] },
};
const ARRIVAL_REASONS = {
  absent: "Absent today",
  parent: "Picked up by parent",
  elsewhere: "Got off elsewhere",
  missed: "Missed the bus",
  other: "Other",
};
const MAX_DETAILS = 2000;
const MAX_NOTE = 300;
const PAGE_SIZE = 100;

class ReportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max) => String(value == null ? "" : value).trim().slice(0, max);

function normalizeReport(input = {}) {
  const rows = Array.isArray(input.issues) ? input.issues.slice(0, 10) : [];
  if (!rows.length) throw new ReportError("Choose what this report is about.");
  const seen = new Set();
  const issues = [];
  rows.forEach((row) => {
    const category = String((row && row.category) || "");
    const issue = String((row && row.issue) || "");
    const type = Object.hasOwn(REPORT_TYPES, category) ? REPORT_TYPES[category] : null;
    if (!type || !type.issues.includes(issue)) throw new ReportError("Choose a type and an issue for each line.");
    if (!seen.has(`${category}:${issue}`)) issues.push({ category, issue });
    seen.add(`${category}:${issue}`);
  });
  const aboutStudents = issues.some((row) => row.category === "student");
  const studentIds = [...new Set((Array.isArray(input.studentIds) ? input.studentIds : []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 200);
  if (aboutStudents && !studentIds.length) throw new ReportError("Choose at least one student.");
  const details = clean(input.details, MAX_DETAILS);
  if (!details && issues.some((row) => row.issue === "Other")) throw new ReportError("Please describe what happened.");
  return { issues, studentIds: aboutStudents ? studentIds : [], priority: input.priority === "urgent" ? "urgent" : "normal", details };
}

// Each student gets their own report, so a lead can share it with one family without
// the others' names or issues going along. Everything else is one report per issue.
function expandReport(report) {
  const studentIssues = report.issues.filter((row) => row.category === "student").map((row) => row.issue).join(", ");
  return [
    ...report.studentIds.map((studentId) => ({ category: "student", issue: studentIssues, studentId })),
    ...report.issues.filter((row) => row.category !== "student").map((row) => ({ ...row, studentId: null })),
  ];
}

async function createReports(db, organizationId, driver, input) {
  const report = normalizeReport(input);
  if (report.studentIds.length) {
    const found = await db.query("SELECT student_id FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])", [organizationId, report.studentIds]);
    if (found.rows.length !== report.studentIds.length) throw new ReportError("A chosen student isn't part of this school.");
  }
  const rows = expandReport(report);
  const params = [organizationId, driver.userId, driver.name, driver.tripId || null, driver.busId || null, driver.routeId || null, report.priority, report.details];
  const values = rows.map((row) => {
    params.push(row.studentId, row.category, row.issue);
    const at = params.length;
    return `($1, $2, $3, $4, $5, $6, $${at - 2}, $${at - 1}, $${at}, $7, $8)`;
  });
  await db.query(
    `INSERT INTO transport_driver_reports (
       organization_id, driver_user_id, driver_name, trip_id, bus_id, route_id, student_id, category, issue, priority, details
     ) VALUES ${values.join(", ")}`,
    params
  );
  return rows.length;
}

const REPORT_COLUMNS = `
  r.report_id, r.category, r.issue, r.priority, r.details, r.status, r.driver_name, r.created_at, r.student_id,
  r.share_with_parents, r.share_with_teachers, r.review_note, r.reviewed_by_name, r.reviewed_at,
  s.first_name, s.last_name, c.class_name, b.bus_number, tr.route_name`;
const REPORT_JOINS = `
  LEFT JOIN students s ON s.student_id = r.student_id AND s.organization_id = r.organization_id
  LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = r.organization_id
  LEFT JOIN transport_buses b ON b.bus_id = r.bus_id AND b.organization_id = r.organization_id
  LEFT JOIN transport_routes tr ON tr.route_id = r.route_id AND tr.organization_id = r.organization_id`;

function publicReport(row) {
  return {
    id: Number(row.report_id),
    category: row.category,
    categoryLabel: CATEGORIES[row.category] || "Other",
    issue: row.issue || null,
    priority: row.priority,
    details: row.details,
    status: row.status,
    driverName: row.driver_name || null,
    createdAt: row.created_at,
    studentId: row.student_id === null ? null : Number(row.student_id),
    studentName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null,
    className: row.class_name || null,
    busNumber: row.bus_number || null,
    routeName: row.route_name || null,
    shareWithParents: Boolean(row.share_with_parents),
    shareWithTeachers: Boolean(row.share_with_teachers),
    reviewNote: row.review_note || null,
    reviewedBy: row.reviewed_by_name || null,
    reviewedAt: row.reviewed_at || null,
  };
}

async function listReports(db, organizationId, bucket = "new") {
  const { rows } = await db.query(
    `SELECT ${REPORT_COLUMNS} FROM transport_driver_reports r ${REPORT_JOINS}
      WHERE r.organization_id = $1 AND r.status = $2
      ORDER BY (r.priority = 'urgent' AND r.status = 'new') DESC, COALESCE(r.reviewed_at, r.created_at) DESC
      LIMIT ${PAGE_SIZE}`,
    [organizationId, bucket === "old" ? "reviewed" : "new"]
  );
  return rows.map(publicReport);
}

async function countNewReports(db, organizationId) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM transport_driver_reports WHERE organization_id = $1 AND status = 'new'",
    [organizationId]
  );
  return rows[0].total;
}

// The lead decides who else sees it. Only a report about a student can go further.
async function reviewReport(db, organizationId, reportId, reviewer, input = {}) {
  const { rows } = await db.query(
    `UPDATE transport_driver_reports
        SET status = 'reviewed',
            share_with_parents = student_id IS NOT NULL AND $3,
            share_with_teachers = student_id IS NOT NULL AND $4,
            review_note = $5, reviewed_by_user_id = $6, reviewed_by_name = $7, reviewed_at = NOW()
      WHERE report_id = $1 AND organization_id = $2
      RETURNING report_id`,
    [reportId, organizationId, input.shareWithParents === true || input.shareWithParents === "1", input.shareWithTeachers === true || input.shareWithTeachers === "1", clean(input.note, MAX_NOTE) || null, reviewer.userId || null, clean(reviewer.name, 160) || null]
  );
  if (!rows[0]) throw new ReportError("Report not found.", 404);
}

// What a parent or teacher sees: what happened and the school's note, never who else was told.
function sharedReport(row) {
  const report = publicReport(row);
  return {
    id: report.id,
    categoryLabel: report.categoryLabel,
    issue: report.issue,
    studentName: report.studentName,
    details: report.details,
    note: report.reviewNote,
    busNumber: report.busNumber,
    routeName: report.routeName,
    createdAt: report.createdAt,
  };
}

async function reportsForParent(db, organizationId, studentIds) {
  if (!studentIds.length) return [];
  const { rows } = await db.query(
    `SELECT ${REPORT_COLUMNS} FROM transport_driver_reports r ${REPORT_JOINS}
      WHERE r.organization_id = $1 AND r.share_with_parents = TRUE AND r.student_id = ANY($2::int[])
      ORDER BY r.created_at DESC LIMIT ${PAGE_SIZE}`,
    [organizationId, studentIds]
  );
  return rows.map(sharedReport);
}

async function reportsForClass(db, organizationId, classId) {
  const { rows } = await db.query(
    `SELECT ${REPORT_COLUMNS} FROM transport_driver_reports r ${REPORT_JOINS}
      WHERE r.organization_id = $1 AND r.share_with_teachers = TRUE AND s.class_id = $2
      ORDER BY r.created_at DESC LIMIT ${PAGE_SIZE}`,
    [organizationId, classId]
  );
  return rows.map(sharedReport);
}

function normalizeArrivals(list) {
  if (!Array.isArray(list)) throw new ReportError("Arrival check is missing.");
  const seen = new Set();
  return list.map((row) => {
    const studentId = Number(row && row.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0 || seen.has(studentId)) throw new ReportError("Arrival check has a student problem.");
    seen.add(studentId);
    const arrived = row.arrived === true || row.arrived === "1";
    const reason = String(row.reason || "");
    if (!arrived && !Object.hasOwn(ARRIVAL_REASONS, reason)) throw new ReportError("Choose a reason for each student who didn't arrive.");
    return { studentId, arrived, reason: arrived ? null : reason, note: arrived ? null : clean(row.note, MAX_NOTE) || null };
  });
}

// Saved once per student per trip. Each student who didn't arrive also goes to the leads
// as a report, so they can follow up and decide who else needs to know.
// One statement however many students are on the bus, so ending a trip stays quick.
async function saveArrivals(db, organizationId, driver, trip, list) {
  const arrivals = normalizeArrivals(list);
  if (!arrivals.length) return { saved: 0, notArrived: 0 };
  const ids = arrivals.map((row) => row.studentId);
  const [known, askParents] = await Promise.all([
    db.query("SELECT student_id FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])", [organizationId, ids]),
    db.query("SELECT transportation_parent_confirm_arrival AS ask FROM organizations WHERE organization_id = $1", [organizationId])
      .then((result) => Boolean(result.rows[0] && result.rows[0].ask))
      .catch(() => false),
  ]);
  if (known.rows.length !== ids.length) throw new ReportError("That student isn't part of this school.");

  const issueOf = (row) => (row.arrived ? null : ARRIVAL_REASONS[row.reason]);
  const { rows } = await db.query(
    `WITH input AS (
       SELECT * FROM UNNEST($3::int[], $4::boolean[], $5::text[], $6::text[], $7::text[], $8::text[])
         AS t(student_id, arrived, reason, note, issue, details)
     ), saved AS (
       INSERT INTO transport_trip_arrivals (organization_id, trip_id, student_id, arrived, reason, note, driver_user_id, parent_status)
       SELECT $1, $2, i.student_id, i.arrived, i.reason, i.note, $9, CASE WHEN i.arrived AND $10::boolean THEN 'pending' END
         FROM input i
       ON CONFLICT (trip_id, student_id) DO NOTHING
       RETURNING student_id, arrived
     ), reports AS (
       INSERT INTO transport_driver_reports (
         organization_id, driver_user_id, driver_name, trip_id, bus_id, route_id, student_id, category, issue, priority, details
       )
       SELECT $1, $9, $11, $2, $12, $13, i.student_id, 'arrival', i.issue, 'urgent', i.details
         FROM saved s JOIN input i ON i.student_id = s.student_id
        WHERE NOT s.arrived
       RETURNING 1
     )
     SELECT COUNT(*)::int AS not_arrived FROM reports`,
    [
      organizationId, trip.trip_id, ids,
      arrivals.map((row) => row.arrived),
      arrivals.map((row) => row.reason),
      arrivals.map((row) => row.note),
      arrivals.map(issueOf),
      arrivals.map((row) => (row.arrived ? null : `Did not reach the destination: ${issueOf(row)}${row.note ? `. ${row.note}` : ""}`)),
      driver.userId, askParents, driver.name, trip.bus_id, trip.route_id,
    ]
  );
  return { saved: arrivals.length, notArrived: rows[0].not_arrived };
}

// What a parent is asked to confirm: only their own children, and only recent trips.
async function pendingArrivalsForParent(db, organizationId, studentIds) {
  if (!studentIds.length) return [];
  const { rows } = await db.query(
    `SELECT a.arrival_id, a.created_at, s.first_name, s.last_name, tr.route_name, b.bus_number
       FROM transport_trip_arrivals a
       JOIN students s ON s.student_id = a.student_id
       LEFT JOIN transport_trip_sessions t ON t.trip_id = a.trip_id AND t.organization_id = a.organization_id
       LEFT JOIN transport_routes tr ON tr.route_id = t.route_id AND tr.organization_id = a.organization_id
       LEFT JOIN transport_buses b ON b.bus_id = t.bus_id AND b.organization_id = a.organization_id
      WHERE a.organization_id = $1 AND a.student_id = ANY($2::int[]) AND a.parent_status = 'pending'
        AND a.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY a.created_at DESC`,
    [organizationId, studentIds]
  );
  return rows.map((row) => ({
    id: Number(row.arrival_id),
    studentName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    routeName: row.route_name || null,
    busNumber: row.bus_number || null,
    at: row.created_at,
  }));
}

// A parent saying "not arrived" goes straight to the leads.
async function answerArrival(db, organizationId, arrivalId, guardian, arrived, note) {
  const { rows } = await db.query(
    `UPDATE transport_trip_arrivals
        SET parent_status = $4, parent_guardian_id = $5, parent_answered_at = NOW()
      WHERE arrival_id = $1 AND organization_id = $2 AND student_id = ANY($3::int[]) AND parent_status = 'pending'
      RETURNING trip_id, student_id`,
    [arrivalId, organizationId, guardian.studentIds, arrived ? "confirmed" : "not_arrived", guardian.guardianId]
  );
  if (!rows[0]) throw new ReportError("This has already been answered.", 409);
  if (!arrived) {
    const extra = clean(note, MAX_NOTE);
    await db.query(
      `INSERT INTO transport_driver_reports (organization_id, driver_name, trip_id, bus_id, route_id, student_id, category, issue, priority, details)
       SELECT $1, $2, t.trip_id, t.bus_id, t.route_id, $4, 'arrival', 'Parent says not arrived', 'urgent', $5
         FROM transport_trip_sessions t WHERE t.trip_id = $3 AND t.organization_id = $1`,
      [organizationId, clean(guardian.name, 160) || "Parent", rows[0].trip_id, rows[0].student_id, `The driver marked this student as arrived, but the parent says they did not arrive.${extra ? ` ${extra}` : ""}`]
    );
  }
}

async function arrivalSummaries(db, organizationId) {
  const { rows } = await db.query(
    `SELECT a.trip_id, MIN(a.created_at) AS checked_at, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.arrived)::int AS arrived,
            COUNT(*) FILTER (WHERE a.parent_status = 'confirmed')::int AS parent_confirmed,
            COUNT(*) FILTER (WHERE a.parent_status = 'pending')::int AS parent_pending,
            COUNT(*) FILTER (WHERE a.parent_status = 'not_arrived')::int AS parent_not_arrived,
            MAX(TRIM(CONCAT_WS(' ', u.first_name, u.last_name))) AS driver_name, MAX(tr.route_name) AS route_name, MAX(b.bus_number) AS bus_number,
            COALESCE(json_agg(json_build_object('student', TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), 'reason', a.reason, 'note', a.note)) FILTER (WHERE NOT a.arrived), '[]') AS missing
       FROM transport_trip_arrivals a
       JOIN students s ON s.student_id = a.student_id
       LEFT JOIN users u ON u.user_id = a.driver_user_id
       LEFT JOIN transport_trip_sessions t ON t.trip_id = a.trip_id AND t.organization_id = a.organization_id
       LEFT JOIN transport_routes tr ON tr.route_id = t.route_id AND tr.organization_id = a.organization_id
       LEFT JOIN transport_buses b ON b.bus_id = t.bus_id AND b.organization_id = a.organization_id
      WHERE a.organization_id = $1
      GROUP BY a.trip_id
      ORDER BY checked_at DESC
      LIMIT ${PAGE_SIZE}`,
    [organizationId]
  );
  return rows.map((row) => ({
    tripId: Number(row.trip_id),
    checkedAt: row.checked_at,
    total: row.total,
    arrived: row.arrived,
    parentConfirmed: row.parent_confirmed,
    parentPending: row.parent_pending,
    parentNotArrived: row.parent_not_arrived,
    driverName: row.driver_name || null,
    routeName: row.route_name || null,
    busNumber: row.bus_number || null,
    missing: (row.missing || []).map((m) => ({ student: m.student, reason: ARRIVAL_REASONS[m.reason] || "Other", note: m.note || null })),
  }));
}

module.exports = {
  CATEGORIES,
  REPORT_TYPES,
  ARRIVAL_REASONS,
  ReportError,
  normalizeReport,
  expandReport,
  normalizeArrivals,
  createReports,
  pendingArrivalsForParent,
  answerArrival,
  listReports,
  countNewReports,
  reviewReport,
  reportsForParent,
  reportsForClass,
  saveArrivals,
  arrivalSummaries,
};
