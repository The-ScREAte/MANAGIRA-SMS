const { getMessagingChannelStatus } = require("../utils/guardianMessaging");
const {
  ensureTransportationSchema,
  getTransportationIntegrationStatus,
  setTransportationMapProvider,
  normalizeMapProvider,
  suggestNearestStop,
} = require("../utils/transportation");
const { uploadToS3 } = require("../middleware/s3Upload");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { geocodeAddress } = require("../utils/geocode");
const { checkRateLimit } = require("../utils/rateLimiter");
const liveBus = require("../utils/liveBus");
const busRequests = require("../utils/transportationRequests");
const transportBoarding = require("../utils/transportBoarding");
const features = require("../utils/shards/features");
const transportReports = require("../utils/transportReports");
const { isDatabaseUnavailable } = require("../middleware/errorMiddleware");
const { locateAddress } = require("../utils/transportationRequests");
const { BoundedMap } = require("../utils/boundedMap");

function normalizeStatus(value, fallback = "active") {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = new Set(["active", "inactive", "maintenance", "on_trip", "off_trip"]);
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeBusStatus(value, fallback = "active") {
  const normalized = String(value || "").trim().toLowerCase();
  const alias = {
    "in service": "in_service",
    "out of service": "out_of_service",
    inactive: "out_of_service",
    on_trip: "in_service",
    off_trip: "out_of_service",
  };
  const mapped = alias[normalized] || normalized;
  const allowed = new Set(["active", "in_service", "maintenance", "out_of_service"]);
  return allowed.has(mapped) ? mapped : fallback;
}

function normalizeScheduleStatus(value, fallback = "active") {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = new Set(["active", "inactive"]);
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeDayOfWeek(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = new Set([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]);
  return allowed.has(normalized) ? normalized : "monday";
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function toFloat(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  const requestedWith = String(req.headers["x-requested-with"] || "").toLowerCase();
  return accept.includes("application/json") || requestedWith === "xmlhttprequest";
}

async function getOrganizationDestination(db, organizationId) {
  const result = await db.query(
    `SELECT organization_address, geo_lat, geo_lng, transportation_distance_unit
       FROM organizations
      WHERE organization_id = $1
      LIMIT 1`,
    [organizationId]
  );
  const row = result.rows[0] || {};
  return {
    address: String(row.organization_address || "").trim() || null,
    latitude: toFloat(row.geo_lat),
    longitude: toFloat(row.geo_lng),
    distanceUnit: row.transportation_distance_unit === "mi" ? "mi" : "km",
  };
}

function scheduleProblem(days, busId, routeId) {
  const selectedDays = Array.isArray(days) ? days : (days ? [days] : []);
  if (!selectedDays.length) return null;
  if (!busId) return "Pick a bus for this driver's weekly schedule.";
  if (!routeId) return "Pick a route for this driver's weekly schedule.";
  return null;
}

async function verifyOrgIds(db, organizationId, busId, routeId) {
  if (busId) {
    const result = await db.query(
      `SELECT 1 FROM transport_buses WHERE organization_id = $1 AND bus_id = $2`,
      [organizationId, busId]
    );
    if (!result.rows.length) return { valid: false, message: "Selected bus was not found for this school." };
  }
  if (routeId) {
    const result = await db.query(
      `SELECT 1 FROM transport_routes WHERE organization_id = $1 AND route_id = $2`,
      [organizationId, routeId]
    );
    if (!result.rows.length) return { valid: false, message: "Selected route was not found for this school." };
  }
  return { valid: true };
}

function safeFileName(name) {
  return String(name || "photo").replace(/[^\w.-]+/g, "_").slice(-80) || "photo";
}

// A bus position counts as live only if the driver's phone reported it
// recently - trips that were never ended don't show an old position as live.
const LIVE_WINDOW_MINUTES = 30;

/* Answers every bus request and side panel call as JSON, with a message people can read. */
async function answer(res, work) {
  try {
    return res.json(await work());
  } catch (error) {
    if (error instanceof busRequests.RequestError || error instanceof transportReports.ReportError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("[Transportation requests]", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

async function requireTransportationOn(db, organizationId) {
  const integration = await getTransportationIntegrationStatus(db, organizationId);
  if (!integration.activated) throw new busRequests.RequestError("Transportation is not turned on for this school.", 403);
}

function limitRequests(req, action, max) {
  const who = req.session.guardianId ? `g${req.session.guardianId}` : `u${req.session.userId || req.sessionID}`;
  if (!checkRateLimit(`busreq:${action}:${who}`, { max, windowMs: 60000 }).allowed) {
    throw new busRequests.RequestError("Too many tries. Please wait a minute and try again.", 429);
  }
}

function requireBoarding(req) {
  if (!features.isOn("bus_boarding", { organizationId: req.session.organizationId })) throw new transportReports.ReportError("Not available.", 404);
}

// A teacher's own class, or any class for those who manage students.
async function classStudentIds(db, req, res) {
  const session = req.session;
  const organizationId = session.organizationId;
  const classId = toInt(req.params.classId);
  const mine = await db.query(
    "SELECT 1 FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = $1 AND uc.class_id = $2 AND c.organization_id = $3 LIMIT 1",
    [session.userId || session.user?.user_id || 0, classId, organizationId]
  );
  const role = String(session.userRole || "").toLowerCase();
  if (!mine.rows[0] && role !== "manager" && !(res.locals.userPermissions || []).includes("manage_students")) {
    throw new transportReports.ReportError("You can only see your own classes.", 403);
  }
  const { rows } = await db.query("SELECT student_id FROM students WHERE organization_id = $1 AND class_id = $2", [organizationId, classId]);
  return rows.map((row) => Number(row.student_id));
}

function staffIdentity(session) {
  const user = session.user || {};
  return {
    type: "staff",
    userId: session.userId || user.user_id || null,
    name: [session.firstName || user.first_name, session.lastName || user.last_name].filter(Boolean).join(" ").trim(),
  };
}

async function guardianStudentIds(db, session) {
  const { rows } = await db.query(
    `SELECT s.student_id FROM students s
      WHERE s.organization_id = $1
        AND (
          EXISTS (SELECT 1 FROM guardians g WHERE g.student_id = s.student_id AND g.guardian_id = $2 AND g.organization_id = $1)
          OR EXISTS (SELECT 1 FROM guardian_students gs WHERE gs.student_id = s.student_id AND gs.guardian_id = $2)
        )`,
    [session.organizationId, session.guardianId]
  );
  return rows.map((row) => Number(row.student_id));
}

// Turns a student's pickup address into a stop the bus passes through. A stop shared
// with other riders (siblings) is left as it is; the student moves only if the address did.
async function useAddressAsStop(db, organizationId, student, geocoded, routeId = null) {
  const studentName = [student.first_name, student.last_name].filter(Boolean).join(" ").trim();
  const existingStop = await db.query(
    `SELECT tsa.stop_id FROM transport_student_assignments tsa
      WHERE tsa.organization_id = $1 AND tsa.student_id = $2 AND tsa.stop_id IS NOT NULL`,
    [organizationId, student.student_id]
  );

  let stopId = existingStop.rows[0]?.stop_id || null;
  // A stop shared with other riders (siblings) is left as it is; this
  // student moves to another stop only if their address moved.
  if (stopId) {
    const shared = await db.query(
      `SELECT st.stop_name, st.stop_address, st.latitude, st.longitude,
              (SELECT COUNT(*)::int FROM transport_student_assignments o
                WHERE o.organization_id = $2 AND o.stop_id = st.stop_id AND o.student_id <> $3 AND o.active) AS others
         FROM transport_stops st WHERE st.stop_id = $1 AND st.organization_id = $2`,
      [stopId, organizationId, student.student_id]
    );
    const current = shared.rows[0];
    if (!current) {
      stopId = null;
    } else if (current.others === 0 && busRequests.isPrivateStop(current)) {
      await db.query(
        `UPDATE transport_stops
            SET stop_name = $3, stop_address = $4, latitude = $5, longitude = $6, updated_at = NOW()
          WHERE stop_id = $1 AND organization_id = $2`,
        [stopId, organizationId, `${studentName}'s Stop`, student.address, geocoded.lat, geocoded.lng]
      );
    } else {
      const samePlace = current.latitude !== null && current.longitude !== null
        && Math.abs(Number(current.latitude) - geocoded.lat) < 0.0003
        && Math.abs(Number(current.longitude) - geocoded.lng) < 0.0003;
      if (!samePlace) stopId = null;
    }
  }
  if (!stopId) {
    // Same address or the same spot (about 30 m): use that stop, don't add another.
    const nearby = await db.query(
      `SELECT stop_id FROM transport_stops
        WHERE organization_id = $1
          AND (LOWER(TRIM(COALESCE(stop_address, ''))) = LOWER(TRIM($2))
               OR (latitude IS NOT NULL AND longitude IS NOT NULL
                   AND ABS(latitude - $3) < 0.0003 AND ABS(longitude - $4) < 0.0003))
        ORDER BY route_id IS NULL, stop_id
        LIMIT 1`,
      [organizationId, student.address, geocoded.lat, geocoded.lng]
    );
    stopId = nearby.rows[0]?.stop_id || null;
  }
  if (!stopId) {
    const insertedStop = await db.query(
      `INSERT INTO transport_stops (organization_id, route_id, stop_name, stop_address, latitude, longitude, stop_order)
       VALUES ($1, $6::int, $2, $3, $4, $5,
               COALESCE((SELECT MAX(stop_order) + 1 FROM transport_stops WHERE route_id = $6::int AND organization_id = $1), 0))
       RETURNING stop_id`,
      [organizationId, `${studentName}'s Stop`, student.address, geocoded.lat, geocoded.lng, routeId]
    );
    stopId = insertedStop.rows[0].stop_id;
  }

  await db.query(
    `UPDATE transport_student_assignments
        SET stop_id = $3,
            route_id = COALESCE((SELECT route_id FROM transport_stops WHERE stop_id = $3), route_id),
            home_address = $4, home_latitude = $5, home_longitude = $6, updated_at = NOW()
      WHERE organization_id = $1 AND student_id = $2`,
    [organizationId, student.student_id, stopId, student.address, geocoded.lat, geocoded.lng]
  );
}

// A student's bus, route and stops change rarely, while the map asks every few seconds.
// So this part is kept for a short while; saving anything under /manage starts it afresh.
const STUDENT_BUS_TTL_MS = 30000;
const studentBusCache = new BoundedMap(5000);
const studentBusGeneration = new BoundedMap(5000);

function forgetStudentBuses(organizationId) {
  studentBusGeneration.set(organizationId, (studentBusGeneration.get(organizationId) || 0) + 1);
}

function studentBusDetails(db, organizationId, studentId) {
  const key = `${organizationId}:${studentId}:${studentBusGeneration.get(organizationId) || 0}`;
  const hit = studentBusCache.get(key);
  if (hit && (hit.pending || hit.expires > Date.now())) return hit.pending || Promise.resolve(hit.value);
  const pending = readStudentBusDetails(db, organizationId, studentId)
    .then((value) => {
      studentBusCache.set(key, { value, expires: Date.now() + STUDENT_BUS_TTL_MS });
      return value;
    })
    .catch((error) => {
      studentBusCache.delete(key);
      throw error;
    });
  studentBusCache.set(key, { pending });
  return pending;
}

async function readStudentBusDetails(db, organizationId, studentId) {
  await ensureTransportationSchema(db);
  const school = await getOrganizationDestination(db, organizationId).catch(() => ({
    address: null,
    latitude: null,
    longitude: null,
    distanceUnit: "km",
  }));
  const result = await db.query(
    `SELECT
       tsa.assignment_id,
       tsa.home_address,
       tsa.home_latitude,
       tsa.home_longitude,
       tsa.pickup_time,
       tsa.dropoff_time,
       tsa.distance_km,
       b.bus_id,
       b.bus_number,
       b.capacity,
       b.status AS bus_status,
       tr.route_id,
       tr.route_name,
       tr.route_code,
       tr.use_school_destination,
       tr.destination_address,
       tr.destination_latitude,
       tr.destination_longitude,
       ts.stop_id,
       ts.stop_name,
       ts.stop_address,
       ts.latitude AS stop_latitude,
       ts.longitude AS stop_longitude,
       ts.pickup_time AS stop_pickup_time,
       ts.dropoff_time AS stop_dropoff_time,
       schedule_info.day_of_week AS schedule_day_of_week,
       schedule_info.start_time AS schedule_start_time,
       schedule_info.end_time AS schedule_end_time,
       schedule_info.driver_name
     FROM transport_student_assignments tsa
     LEFT JOIN transport_buses b
       ON b.bus_id = tsa.bus_id
      AND b.organization_id = tsa.organization_id
     LEFT JOIN transport_routes tr
       ON tr.route_id = tsa.route_id
      AND tr.organization_id = tsa.organization_id
     LEFT JOIN transport_stops ts
       ON ts.stop_id = tsa.stop_id
      AND ts.organization_id = tsa.organization_id
     LEFT JOIN LATERAL (
       SELECT sch.day_of_week, sch.start_time, sch.end_time, d.driver_name
       FROM transport_bus_schedules sch
       LEFT JOIN transport_drivers d
         ON d.organization_id = sch.organization_id
        AND d.driver_id = sch.driver_id
       WHERE sch.organization_id = tsa.organization_id
         AND sch.status = 'active'
         AND (
           (tsa.bus_id IS NOT NULL AND sch.bus_id = tsa.bus_id)
           OR
           (tsa.route_id IS NOT NULL AND sch.route_id = tsa.route_id)
         )
       ORDER BY
         CASE
           WHEN tsa.bus_id IS NOT NULL AND tsa.route_id IS NOT NULL AND sch.bus_id = tsa.bus_id AND sch.route_id = tsa.route_id THEN 0
           WHEN tsa.bus_id IS NOT NULL AND sch.bus_id = tsa.bus_id THEN 1
           WHEN tsa.route_id IS NOT NULL AND sch.route_id = tsa.route_id THEN 2
           ELSE 3
         END,
         sch.start_time ASC NULLS LAST,
         sch.schedule_id ASC
       LIMIT 1
     ) schedule_info ON TRUE
     WHERE tsa.organization_id = $1
       AND tsa.student_id = $2
       AND tsa.active = TRUE
     LIMIT 1`,
    [organizationId, studentId]
  );

  const row = result.rows[0] || null;
  if (!row) return null;

  const routeStopsResult = row.route_id
    ? await db.query(
        `SELECT stop_id, stop_name, stop_address, latitude, longitude, stop_order
           FROM transport_stops
          WHERE organization_id = $1
            AND route_id = $2
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
          ORDER BY stop_order ASC, stop_name ASC`,
        [organizationId, row.route_id]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };

  return { school, row, routeStopsResult };
}

// The driver's phone sends the trip's last answers with End, so one request does it all.
// A busy database fails the request and the phone sends it again. Anything else that stops
// an answer being saved is logged, and the trip still ends: the bus must not stay live.
async function saveLastAnswers(req, db, organizationId, userId, tripId) {
  const arrivals = Array.isArray(req.body?.arrivals) ? req.body.arrivals : [];
  const boardings = Array.isArray(req.body?.boardings) ? req.body.boardings : [];
  if (!arrivals.length && !boardings.length) return;
  const trip = await liveBus.tripForDriver(db, organizationId, tripId, userId);
  if (!trip) return; // Already ended: this is a repeat after a lost answer.
  const driver = staffIdentity(req.session);
  const ignoringBadAnswers = (work) => work.catch((error) => {
    if (isDatabaseUnavailable(error)) throw error;
    console.error("[Transport] End trip answers not saved:", tripId, error.message);
  });
  const allowed = features.isOn("bus_boarding", { organizationId }) ? boardings.slice(0, 200) : [];
  await Promise.all([
    ...allowed.map((item) => ignoringBadAnswers(transportBoarding.saveBoarding(db, organizationId, driver, trip, item || {}))),
    ignoringBadAnswers(transportReports.saveArrivals(db, organizationId, driver, trip, arrivals)),
  ]);
}

async function getStudentTransportationSnapshot(db, organizationId, studentId) {
  const details = await studentBusDetails(db, organizationId, studentId);
  if (!details) return null;
  const { school, row, routeStopsResult } = details;
  const live = await liveBus.liveForStudent(db, organizationId, row.bus_id || null, row.route_id || null);

  return {
    assignmentId: row.assignment_id,
    distanceUnit: school.distanceUnit,
    homeAddress: row.home_address || "",
    homeLatitude: row.home_latitude,
    homeLongitude: row.home_longitude,
    pickupTime: row.pickup_time || row.stop_pickup_time || null,
    dropoffTime: row.dropoff_time || row.stop_dropoff_time || null,
    distanceKm: row.distance_km,
    driverName: row.driver_name || null,
    scheduleDayOfWeek: row.schedule_day_of_week || null,
    scheduleStartTime: row.schedule_start_time || null,
    scheduleEndTime: row.schedule_end_time || null,
    bus: row.bus_id
      ? {
          busId: row.bus_id,
          busNumber: row.bus_number,
          capacity: row.capacity,
          status: row.bus_status,
        }
      : null,
    route: row.route_id
      ? {
          routeId: row.route_id,
          routeName: row.route_name,
          routeCode: row.route_code,
          useSchoolDestination: row.use_school_destination !== false,
          destinationAddress: row.destination_address || null,
          destinationLatitude: row.destination_latitude !== null ? Number(row.destination_latitude) : null,
          destinationLongitude: row.destination_longitude !== null ? Number(row.destination_longitude) : null,
          stops: (routeStopsResult.rows || []).map((stopRow) => ({
            stopId: stopRow.stop_id,
            stopName: stopRow.stop_name,
            stopAddress: stopRow.stop_address,
            latitude: stopRow.latitude !== null ? Number(stopRow.latitude) : null,
            longitude: stopRow.longitude !== null ? Number(stopRow.longitude) : null,
            stopOrder: stopRow.stop_order !== null ? Number(stopRow.stop_order) : 0,
          })),
        }
      : null,
    stop: row.stop_id
      ? {
          stopId: row.stop_id,
          stopName: row.stop_name,
          stopAddress: row.stop_address,
          latitude: row.stop_latitude !== null ? Number(row.stop_latitude) : null,
          longitude: row.stop_longitude !== null ? Number(row.stop_longitude) : null,
        }
      : null,
    school: {
      address: school.address || null,
      latitude: school.latitude !== null ? Number(school.latitude) : null,
      longitude: school.longitude !== null ? Number(school.longitude) : null,
    },
    live: live
      ? {
          tripId: live.trip_id,
          status: live.status,
          latitude: Number(live.latitude),
          longitude: Number(live.longitude),
          speedKmh: live.speed_kmh !== null ? Number(live.speed_kmh) : null,
          headingDeg: live.heading_deg !== null ? Number(live.heading_deg) : null,
          busNumber: row.bus_number || null,
          recordedAt: live.recorded_at,
          startedAt: live.started_at,
          driverName: live.driver_name || null,
          driverPhoto: live.driver_photo || null,
          licensePlate: live.license_plate || null,
          estimated: Boolean(live.estimated),
          lastGpsAt: live.last_gps_at || null,
        }
      : null,
  };
}

async function getClassTransportationSnapshot(db, organizationId, classId, termId, schoolYearId) {
  await ensureTransportationSchema(db);

  if (!classId || !termId || !schoolYearId) return [];

  const rows = await db.query(
    `SELECT
       s.student_id,
       s.first_name,
       s.last_name,
       tsa.assignment_id,
       tsa.pickup_time,
       tsa.dropoff_time,
       tsa.distance_km,
       tsa.route_id,
       b.bus_number,
       b.status AS bus_status,
       tr.route_name,
       ts.stop_name,
      ts.latitude AS stop_latitude,
      ts.longitude AS stop_longitude,
       ts.pickup_time AS stop_pickup_time,
       ts.dropoff_time AS stop_dropoff_time,
      schedule_info.day_of_week AS schedule_day_of_week,
      schedule_info.start_time AS schedule_start_time,
      schedule_info.end_time AS schedule_end_time,
      schedule_info.driver_name,
       live.latitude,
       live.longitude,
       live.recorded_at
     FROM enrolled_students es
     JOIN enrollments e ON e.enrollment_id = es.enrollment_id
     JOIN students s ON s.student_id = es.student_id
     LEFT JOIN transport_student_assignments tsa
       ON tsa.organization_id = e.organization_id
      AND tsa.student_id = s.student_id
      AND tsa.active = TRUE
     LEFT JOIN transport_buses b
       ON b.organization_id = e.organization_id
      AND b.bus_id = tsa.bus_id
     LEFT JOIN transport_routes tr
       ON tr.organization_id = e.organization_id
      AND tr.route_id = tsa.route_id
     LEFT JOIN transport_stops ts
       ON ts.organization_id = e.organization_id
      AND ts.stop_id = tsa.stop_id
     LEFT JOIN LATERAL (
       SELECT sch.day_of_week, sch.start_time, sch.end_time, d.driver_name
       FROM transport_bus_schedules sch
       LEFT JOIN transport_drivers d
         ON d.organization_id = sch.organization_id
        AND d.driver_id = sch.driver_id
       WHERE sch.organization_id = e.organization_id
         AND sch.status = 'active'
         AND (
           (tsa.bus_id IS NOT NULL AND sch.bus_id = tsa.bus_id)
           OR
           (tsa.route_id IS NOT NULL AND sch.route_id = tsa.route_id)
         )
       ORDER BY
         CASE
           WHEN tsa.bus_id IS NOT NULL AND tsa.route_id IS NOT NULL AND sch.bus_id = tsa.bus_id AND sch.route_id = tsa.route_id THEN 0
           WHEN tsa.bus_id IS NOT NULL AND sch.bus_id = tsa.bus_id THEN 1
           WHEN tsa.route_id IS NOT NULL AND sch.route_id = tsa.route_id THEN 2
           ELSE 3
         END,
         sch.start_time ASC NULLS LAST,
         sch.schedule_id ASC
       LIMIT 1
     ) schedule_info ON TRUE
     LEFT JOIN LATERAL (
       SELECT l.latitude, l.longitude, l.recorded_at
       FROM transport_trip_sessions t
       JOIN transport_live_locations l
         ON l.trip_id = t.trip_id
        AND l.organization_id = t.organization_id
       WHERE t.organization_id = e.organization_id
         AND t.status = 'active'
         AND (
           (t.bus_id IS NOT NULL AND t.bus_id = tsa.bus_id)
           OR
           (t.route_id IS NOT NULL AND t.route_id = tsa.route_id)
         )
       ORDER BY l.recorded_at DESC
       LIMIT 1
     ) live ON TRUE
     WHERE e.organization_id = $1
       AND e.term_id = $2
       AND e.school_year_id = $3
       AND es.class_id = $4
       AND COALESCE(s.graduated, FALSE) = FALSE
     ORDER BY s.last_name ASC, s.first_name ASC`,
    [organizationId, termId, schoolYearId, classId]
  );

  const routeIds = Array.from(
    new Set(
      rows.rows
        .map((row) => Number(row.route_id || 0))
        .filter((routeId) => Number.isInteger(routeId) && routeId > 0)
    )
  );

  const routeStopsByRouteId = {};
  if (routeIds.length) {
    const routeStopsResult = await db.query(
      `SELECT route_id, stop_id, stop_name, stop_address, latitude, longitude, stop_order
         FROM transport_stops
        WHERE organization_id = $1
          AND route_id = ANY($2::int[])
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        ORDER BY route_id ASC, stop_order ASC, stop_name ASC`,
      [organizationId, routeIds]
    ).catch(() => ({ rows: [] }));

    routeStopsResult.rows.forEach((stopRow) => {
      const routeId = Number(stopRow.route_id || 0);
      if (!Number.isInteger(routeId) || routeId <= 0) return;
      if (!Array.isArray(routeStopsByRouteId[routeId])) routeStopsByRouteId[routeId] = [];
      routeStopsByRouteId[routeId].push({
        stopId: stopRow.stop_id,
        stopName: stopRow.stop_name,
        stopAddress: stopRow.stop_address,
        latitude: stopRow.latitude !== null ? Number(stopRow.latitude) : null,
        longitude: stopRow.longitude !== null ? Number(stopRow.longitude) : null,
        stopOrder: stopRow.stop_order !== null ? Number(stopRow.stop_order) : 0,
      });
    });
  }

  return rows.rows.map((row) => ({
    studentId: Number(row.student_id),
    studentName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    hasBusAccess: row.assignment_id !== null && row.assignment_id !== undefined,
    routeId: row.route_id !== null ? Number(row.route_id) : null,
    busNumber: row.bus_number || null,
    routeName: row.route_name || null,
    routeStops: row.route_id !== null && routeStopsByRouteId[Number(row.route_id)]
      ? routeStopsByRouteId[Number(row.route_id)]
      : [],
    stopName: row.stop_name || null,
    stopLatitude: row.stop_latitude !== null ? Number(row.stop_latitude) : null,
    stopLongitude: row.stop_longitude !== null ? Number(row.stop_longitude) : null,
    pickupTime: row.pickup_time || row.stop_pickup_time || null,
    dropoffTime: row.dropoff_time || row.stop_dropoff_time || null,
    busStatus: row.bus_status || null,
    driverName: row.driver_name || null,
    scheduleDayOfWeek: row.schedule_day_of_week || null,
    scheduleStartTime: row.schedule_start_time || null,
    scheduleEndTime: row.schedule_end_time || null,
    distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
    liveLatitude: row.latitude !== null ? Number(row.latitude) : null,
    liveLongitude: row.longitude !== null ? Number(row.longitude) : null,
    liveRecordedAt: row.recorded_at || null,
  }));
}

const transportationController = {
  manageGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");
    const isEmbedded = isEmbeddedRequest(req, "transportationManage");

    try {
      await ensureTransportationSchema(db);
      const integration = await getTransportationIntegrationStatus(db, organizationId);

      // Keep the transportation profile table in sync with Manage Employees:
      // any Driver-role employee created there (with no profile row yet)
      // gets one auto-provisioned here, so they immediately show up below
      // and can be picked for schedules/buses without a separate step.
      await db.query(
        `INSERT INTO transport_drivers (organization_id, user_id, driver_name, email, status)
         SELECT u.organization_id, u.user_id, TRIM(u.first_name || ' ' || u.last_name), u.email, 'active'
           FROM users u
          WHERE u.organization_id = $1
            AND u.account_type = 'Driver'
            AND NOT EXISTS (
              SELECT 1 FROM transport_drivers d
               WHERE d.user_id = u.user_id AND d.organization_id = u.organization_id
            )`,
        [organizationId]
      );

      const [buses, drivers, routes, stops, assignments, schedules, organizationMeta] = await Promise.all([
        db.query(
          `SELECT b.bus_id, b.bus_number, b.bus_name, b.license_plate,
            b.capacity, b.status, b.driver_user_id,
            b.vehicle_make, b.vehicle_model, b.vehicle_year,
            b.vehicle_color, b.vin, b.fuel_type, b.odometer,
                  u.first_name, u.last_name
             FROM transport_buses b
             LEFT JOIN users u ON u.user_id = b.driver_user_id
            WHERE b.organization_id = $1
            ORDER BY b.bus_number ASC`,
          [organizationId]
        ),
        db.query(
          // Drivers are sourced from the `users` table (account_type='Driver')
          // — the same identity created/edited via Manage Employees — with
          // transport_drivers as an optional profile extension (phone/license/
          // photo) and transport_buses.driver_user_id as the assigned-bus link.
          `SELECT u.user_id, u.first_name, u.last_name, u.email,
                  d.driver_id, d.phone, d.license_number, d.image_url,
                  COALESCE(d.status, 'active') AS status,
                  d.assigned_route_id,
                  bus.bus_id AS assigned_bus_id, bus.bus_number,
                  tr.route_name,
                  COALESCE(ds.schedule_count, 0) AS schedule_count
             FROM users u
             LEFT JOIN transport_drivers d
               ON d.user_id = u.user_id
              AND d.organization_id = u.organization_id
             LEFT JOIN LATERAL (
               SELECT bus_id, bus_number
                 FROM transport_buses
                WHERE driver_user_id = u.user_id
                  AND organization_id = u.organization_id
                LIMIT 1
             ) bus ON TRUE
             LEFT JOIN transport_routes tr
               ON tr.route_id = d.assigned_route_id
              AND tr.organization_id = u.organization_id
             LEFT JOIN (
               SELECT organization_id, driver_id, COUNT(*)::INT AS schedule_count
                 FROM transport_bus_schedules
                GROUP BY organization_id, driver_id
             ) ds
               ON ds.organization_id = u.organization_id
              AND ds.driver_id = d.driver_id
            WHERE u.organization_id = $1
              AND u.account_type = 'Driver'
            ORDER BY u.first_name ASC, u.last_name ASC`,
          [organizationId]
        ),
        db.query(
          `SELECT route_id, route_name, route_code, route_status, map_provider,
                  use_school_destination,
                  destination_address, destination_latitude, destination_longitude
             FROM transport_routes
            WHERE organization_id = $1
            ORDER BY route_name ASC`,
          [organizationId]
        ),
        db.query(
          `SELECT stop_id, route_id, stop_name, stop_address, latitude, longitude,
                  pickup_time, dropoff_time, stop_order
             FROM transport_stops
            WHERE organization_id = $1
            ORDER BY route_id ASC, stop_order ASC, stop_name ASC`,
          [organizationId]
        ),
        db.query(
          `SELECT tsa.assignment_id, tsa.student_id, tsa.bus_id, tsa.route_id, tsa.stop_id,
                  tsa.pickup_time, tsa.dropoff_time, tsa.distance_km,
                  s.first_name, s.last_name,
                  b.bus_number,
                  tr.route_name,
                  ts.stop_name
             FROM transport_student_assignments tsa
             JOIN students s
               ON s.student_id = tsa.student_id
              AND s.organization_id = tsa.organization_id
             LEFT JOIN transport_buses b
               ON b.bus_id = tsa.bus_id
              AND b.organization_id = tsa.organization_id
             LEFT JOIN transport_routes tr
               ON tr.route_id = tsa.route_id
              AND tr.organization_id = tsa.organization_id
             LEFT JOIN transport_stops ts
               ON ts.stop_id = tsa.stop_id
              AND ts.organization_id = tsa.organization_id
            WHERE tsa.organization_id = $1
              AND tsa.active = TRUE
              AND COALESCE(s.graduated, FALSE) = FALSE
            ORDER BY s.last_name ASC, s.first_name ASC`,
          [organizationId]
        ),
        db.query(
          `SELECT s.schedule_id, s.bus_id, s.driver_id, s.route_id,
                  s.day_of_week, s.start_time, s.end_time, s.status, s.notes,
                  b.bus_number,
                  d.driver_name,
                  tr.route_name
             FROM transport_bus_schedules s
             JOIN transport_buses b
               ON b.bus_id = s.bus_id
              AND b.organization_id = s.organization_id
             LEFT JOIN transport_drivers d
               ON d.driver_id = s.driver_id
              AND d.organization_id = s.organization_id
             LEFT JOIN transport_routes tr
               ON tr.route_id = s.route_id
              AND tr.organization_id = s.organization_id
            WHERE s.organization_id = $1
            ORDER BY s.day_of_week ASC, s.start_time ASC, s.schedule_id DESC`,
          [organizationId]
        ),
        db.query(
          `SELECT organization_address, geo_lat, geo_lng, transportation_distance_unit
             FROM organizations
            WHERE organization_id = $1
            LIMIT 1`,
          [organizationId]
        ),
      ]);

      let students;
      try {
        students = await db.query(
          `SELECT s.student_id, s.first_name, s.last_name, s.address,
                  s.class_id, c.class_name
             FROM students s
             LEFT JOIN classes c
               ON c.class_id = s.class_id
              AND c.organization_id = s.organization_id
            WHERE s.organization_id = $1
              AND COALESCE(s.graduated, FALSE) = FALSE
              AND NOT EXISTS (
                SELECT 1
                FROM archived_student_info a
                WHERE a.organization_id = s.organization_id
                  AND a.student_id = s.student_id
              )
            ORDER BY COALESCE(c.class_name, 'Unassigned') ASC,
                     s.last_name ASC,
                     s.first_name ASC`,
          [organizationId]
        );
      } catch (_) {
        students = await db.query(
          `SELECT s.student_id, s.first_name, s.last_name, s.address,
                  s.class_id, c.class_name
             FROM students s
             LEFT JOIN classes c
               ON c.class_id = s.class_id
              AND c.organization_id = s.organization_id
            WHERE s.organization_id = $1
              AND COALESCE(s.graduated, FALSE) = FALSE
            ORDER BY COALESCE(c.class_name, 'Unassigned') ASC,
                     s.last_name ASC,
                     s.first_name ASC`,
          [organizationId]
        );
      }

      const parentConfirmArrival = await db.query(
        "SELECT transportation_parent_confirm_arrival AS ask FROM organizations WHERE organization_id = $1",
        [organizationId]
      ).then((result) => Boolean(result.rows[0] && result.rows[0].ask)).catch(() => false);

      const transportMessagingStatus = await getMessagingChannelStatus(db, organizationId).catch(() => ({
        sms: { ready: false },
        whatsapp: { ready: false },
      }));

      return res.render("transportation/manage", {
        title: "Transportation Management",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        canBroadcastToGuardians: Boolean(transportMessagingStatus.sms?.ready || transportMessagingStatus.whatsapp?.ready),
        parentConfirmArrival,
        integration,
        buses: buses.rows,
        drivers: drivers.rows,
        routes: routes.rows,
        stops: stops.rows,
        assignments: assignments.rows,
        students: students.rows,
        schedules: schedules.rows,
        schoolAddress: String(organizationMeta.rows[0]?.organization_address || "").trim() || null,
        schoolLatitude: toFloat(organizationMeta.rows[0]?.geo_lat),
        schoolLongitude: toFloat(organizationMeta.rows[0]?.geo_lng),
        distanceUnit: organizationMeta.rows[0]?.transportation_distance_unit === "mi" ? "mi" : "km",
        mapProviders: ["google", "mapbox", "openstreetmap"],
        messages: req.flash(),
      });
    } catch (error) {
      req.flash("error", "Unable to load transportation management.");
      return res.redirect("/common/management");
    }
  },

  updateMapProviderPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    try {
      const provider = normalizeMapProvider(req.body.mapProvider);
      await setTransportationMapProvider(db, organizationId, provider);
      req.flash("success", "Transportation map provider updated.");
    } catch (error) {
      req.flash("error", "Unable to update map provider.");
    }
    return res.redirect("/transportation/manage");
  },

  updateDistanceUnitPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    const unit = String(req.body.distanceUnit || "").trim() === "mi" ? "mi" : "km";
    try {
      await ensureTransportationSchema(db);
      await db.query(
        `UPDATE organizations SET transportation_distance_unit = $1 WHERE organization_id = $2`,
        [unit, organizationId]
      );
      req.flash("success", "Units updated.");
    } catch (error) {
      req.flash("error", "Unable to update units.");
    }
    return res.redirect("/transportation/manage");
  },

  updateSchoolDestinationPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const schoolAddress = String(req.body.schoolAddress || "").trim();
    const applyToRoutes = String(req.body.applyToSchoolRoutes || "").trim() === "1";

    if (!schoolAddress) {
      const message = "School destination address is required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const currentDestination = await getOrganizationDestination(db, organizationId);

      // Drivers/admins just type an address — coordinates are resolved
      // automatically so non-technical users never have to touch lat/lng.
      let schoolLatitude = currentDestination.latitude;
      let schoolLongitude = currentDestination.longitude;
      if (schoolAddress !== currentDestination.address || schoolLatitude === null || schoolLongitude === null) {
        const orgMeta = await db.query(
          `SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1`,
          [organizationId]
        );
        const geocoded = await geocodeAddress(
          schoolAddress,
          orgMeta.rows[0]?.organization_province,
          orgMeta.rows[0]?.organization_country
        ).catch(() => null);
        if (geocoded) {
          schoolLatitude = geocoded.lat;
          schoolLongitude = geocoded.lng;
        }
      }

      await db.query(
        `UPDATE organizations
            SET organization_address = $2,
                geo_lat = $3,
                geo_lng = $4
          WHERE organization_id = $1`,
        [organizationId, schoolAddress, schoolLatitude, schoolLongitude]
      );

      if (applyToRoutes) {
        await db.query(
          `UPDATE transport_routes
              SET destination_address = $2,
                  destination_latitude = $3,
                  destination_longitude = $4,
                  use_school_destination = TRUE,
                  updated_at = NOW()
            WHERE organization_id = $1`,
          [organizationId, schoolAddress, schoolLatitude, schoolLongitude]
        );
      } else {
        await db.query(
          `UPDATE transport_routes
              SET destination_address = $2,
                  destination_latitude = $3,
                  destination_longitude = $4,
                  updated_at = NOW()
            WHERE organization_id = $1
              AND use_school_destination = TRUE`,
          [organizationId, schoolAddress, schoolLatitude, schoolLongitude]
        );
      }

      if (wantsJson(req)) {
        return res.json({ ok: true, message: "School destination updated." });
      }
      req.flash("success", "School destination updated.");
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "Unable to update school destination." });
      }
      req.flash("error", "Unable to update school destination.");
    }

    return res.redirect("/transportation/manage");
  },

  createBusPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    const busNumber = String(req.body.busNumber || "").trim();
    const busName = String(req.body.busName || "").trim() || null;
    const licensePlate = String(req.body.licensePlate || "").trim() || null;
    const capacity = toInt(req.body.capacity);
    let driverUserId = toInt(req.body.driverUserId);
    const status = normalizeBusStatus(req.body.status, "active");
    const vehicleMake = String(req.body.vehicleMake || "").trim() || null;
    const vehicleModel = String(req.body.vehicleModel || "").trim() || null;
    const vehicleYear = toInt(req.body.vehicleYear);
    const vehicleColor = String(req.body.vehicleColor || "").trim() || null;
    const vin = String(req.body.vin || "").trim() || null;
    const fuelType = String(req.body.fuelType || "").trim() || null;
    const odometer = toFloat(req.body.odometer);

    if (!busNumber) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message: "Bus number is required." });
      }
      req.flash("error", "Bus number is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      if (driverUserId) {
        const driverCheck = await db.query(
          `SELECT user_id FROM users WHERE user_id = $1 AND organization_id = $2 AND account_type = 'Driver'`,
          [driverUserId, organizationId]
        );
        if (driverCheck.rows.length === 0) driverUserId = null;
      }
      const saveResult = await db.query(
        `INSERT INTO transport_buses (
           organization_id, bus_number, bus_name, license_plate,
           capacity, driver_user_id, status,
           vehicle_make, vehicle_model, vehicle_year, vehicle_color,
           vin, fuel_type, odometer
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (organization_id, bus_number)
         DO UPDATE SET
           bus_name = EXCLUDED.bus_name,
           license_plate = EXCLUDED.license_plate,
           capacity = EXCLUDED.capacity,
           driver_user_id = EXCLUDED.driver_user_id,
           status = EXCLUDED.status,
           vehicle_make = EXCLUDED.vehicle_make,
           vehicle_model = EXCLUDED.vehicle_model,
           vehicle_year = EXCLUDED.vehicle_year,
           vehicle_color = EXCLUDED.vehicle_color,
           vin = EXCLUDED.vin,
           fuel_type = EXCLUDED.fuel_type,
           odometer = EXCLUDED.odometer,
           updated_at = NOW()`,
        [
          organizationId,
          busNumber,
          busName,
          licensePlate,
          capacity,
          driverUserId,
          status,
          vehicleMake,
          vehicleModel,
          vehicleYear,
          vehicleColor,
          vin,
          fuelType,
          odometer,
        ]
      );

      if (wantsJson(req)) {
        return res.json({ ok: true, message: "Bus saved.", bus: saveResult.rows[0] || null });
      }
      req.flash("success", "Bus saved.");
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "Unable to save bus." });
      }
      req.flash("error", "Unable to save bus.");
    }

    return res.redirect("/transportation/manage");
  },

  updateBusPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const busId = toInt(req.params.busId || req.body.busId);
    const busNumber = String(req.body.busNumber || "").trim();
    const busName = String(req.body.busName || "").trim() || null;
    const licensePlate = String(req.body.licensePlate || "").trim() || null;
    const capacity = toInt(req.body.capacity);
    let driverUserId = toInt(req.body.driverUserId);
    const status = normalizeBusStatus(req.body.status, "active");
    const vehicleMake = String(req.body.vehicleMake || "").trim() || null;
    const vehicleModel = String(req.body.vehicleModel || "").trim() || null;
    const vehicleYear = toInt(req.body.vehicleYear);
    const vehicleColor = String(req.body.vehicleColor || "").trim() || null;
    const vin = String(req.body.vin || "").trim() || null;
    const fuelType = String(req.body.fuelType || "").trim() || null;
    const odometer = toFloat(req.body.odometer);

    if (!busId || !busNumber) {
      const message = !busId ? "Bus id is required." : "Bus number is required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      if (driverUserId) {
        const driverCheck = await db.query(
          `SELECT user_id FROM users WHERE user_id = $1 AND organization_id = $2 AND account_type = 'Driver'`,
          [driverUserId, organizationId]
        );
        if (driverCheck.rows.length === 0) driverUserId = null;
      }
      const result = await db.query(
        `UPDATE transport_buses
            SET bus_number = $3,
                bus_name = $4,
                license_plate = $5,
                capacity = $6,
                driver_user_id = $7,
                status = $8,
                vehicle_make = $9,
                vehicle_model = $10,
                vehicle_year = $11,
                vehicle_color = $12,
                vin = $13,
                fuel_type = $14,
                odometer = $15,
                updated_at = NOW()
          WHERE organization_id = $1
            AND bus_id = $2
          RETURNING bus_id`,
        [
          organizationId,
          busId,
          busNumber,
          busName,
          licensePlate,
          capacity,
          driverUserId,
          status,
          vehicleMake,
          vehicleModel,
          vehicleYear,
          vehicleColor,
          vin,
          fuelType,
          odometer,
        ]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Bus not found." });
        req.flash("error", "Bus not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Bus updated." });
      req.flash("success", "Bus updated.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to update bus." });
      req.flash("error", "Unable to update bus.");
    }

    return res.redirect("/transportation/manage");
  },

  deleteBusPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const busId = toInt(req.params.busId || req.body.busId);
    if (!busId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Bus id is required." });
      req.flash("error", "Bus id is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `DELETE FROM transport_buses
          WHERE organization_id = $1
            AND bus_id = $2
          RETURNING bus_id`,
        [organizationId, busId]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Bus not found." });
        req.flash("error", "Bus not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Bus deleted." });
      req.flash("success", "Bus deleted.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to delete bus." });
      req.flash("error", "Unable to delete bus.");
    }

    return res.redirect("/transportation/manage");
  },

  // Shared by createDriverPost/updateDriverPost: upserts the transport_drivers
  // profile row (phone/license/photo) and syncs transport_buses.driver_user_id
  // — the single field the trip/GPS flow trusts — for a Driver-role user.
  async _syncDriverProfileAndBus(db, {
    organizationId, userId, firstName, lastName, phone, email,
    licenseNumber, assignedBusId, assignedRouteId, status, imageUrl,
  }) {
    const driverName = `${firstName} ${lastName}`.trim();
    const existingProfile = await db.query(
      `SELECT driver_id FROM transport_drivers WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );

    let driverId;
    if (existingProfile.rows.length) {
      driverId = existingProfile.rows[0].driver_id;
      await db.query(
        `UPDATE transport_drivers
            SET driver_name = $3, phone = $4, email = $5, license_number = $6,
                assigned_bus_id = $7, assigned_route_id = $8, status = $9,
                image_url = COALESCE($10, image_url), updated_at = NOW()
          WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId, driverName, phone, email, licenseNumber, assignedBusId, assignedRouteId, status, imageUrl]
      );
    } else {
      const inserted = await db.query(
        `INSERT INTO transport_drivers (
           organization_id, user_id, driver_name, phone, email, license_number,
           image_url, assigned_bus_id, assigned_route_id, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING driver_id`,
        [organizationId, userId, driverName, phone, email, licenseNumber, imageUrl, assignedBusId, assignedRouteId, status]
      );
      driverId = inserted.rows[0].driver_id;
    }

    // Clear this driver from any bus they were previously linked to (other
    // than the one just chosen), then assign the newly selected bus, if any.
    await db.query(
      `UPDATE transport_buses
          SET driver_user_id = NULL, updated_at = NOW()
        WHERE organization_id = $1
          AND driver_user_id = $2
          AND bus_id IS DISTINCT FROM $3`,
      [organizationId, userId, assignedBusId]
    );
    if (assignedBusId) {
      await db.query(
        `UPDATE transport_buses
            SET driver_user_id = $2, updated_at = NOW()
          WHERE organization_id = $1 AND bus_id = $3`,
        [organizationId, userId, assignedBusId]
      );
    }

    return driverId;
  },

  // Replaces this driver's weekly schedule with exactly the selected days —
  // lets an admin set up the recurring run right from the driver edit form
  // instead of needing a separate trip to the Schedule tab.
  async _syncDriverSchedule(db, { organizationId, driverId, busId, routeId, days, startTime, endTime }) {
    await db.query(
      `DELETE FROM transport_bus_schedules WHERE organization_id = $1 AND driver_id = $2`,
      [organizationId, driverId]
    );

    const selectedDays = Array.isArray(days) ? days : (days ? [days] : []);
    const validDays = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
    const normalizedDays = selectedDays.map((d) => String(d || "").toLowerCase()).filter((d) => validDays.has(d));

    if (!normalizedDays.length || !busId) return;

    for (const day of normalizedDays) {
      await db.query(
        `INSERT INTO transport_bus_schedules (organization_id, bus_id, driver_id, route_id, day_of_week, start_time, end_time, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
        [organizationId, busId, driverId, routeId, day, startTime || null, endTime || null]
      );
    }
  },

  createDriverPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const email = String(req.body.email || "").trim();
    const phone = String(req.body.phone || "").trim() || null;
    const licenseNumber = String(req.body.licenseNumber || "").trim() || null;
    let assignedBusId = toInt(req.body.assignedBusId);
    let assignedRouteId = toInt(req.body.assignedRouteId);
    const status = normalizeScheduleStatus(req.body.status, "active");
    const scheduleDays = req.body.scheduleDays;
    const scheduleStartTime = String(req.body.scheduleStartTime || "").trim() || null;
    const scheduleEndTime = String(req.body.scheduleEndTime || "").trim() || null;

    if (!firstName || !lastName || !email) {
      const message = "First name, last name, and email are required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    const problem = scheduleProblem(scheduleDays, assignedBusId, assignedRouteId);
    if (problem) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: problem });
      req.flash("error", problem);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const verified = await verifyOrgIds(db, organizationId, assignedBusId, assignedRouteId);
      if (!verified.valid) {
        if (wantsJson(req)) return res.status(400).json({ ok: false, message: verified.message });
        req.flash("error", verified.message);
        return res.redirect("/transportation/manage");
      }

      // Driver identity is created through the exact same pipeline as
      // Manage Employees (users table, account_type='Driver', invite email) —
      // this form is just a convenient shortcut, never a second data source.
      const existingUser = await db.query(
        `SELECT user_id, account_type FROM users WHERE organization_id = $1 AND LOWER(email) = LOWER($2)`,
        [organizationId, email]
      );

      let userId;
      let isNewUser = false;

      if (existingUser.rows.length) {
        const existing = existingUser.rows[0];
        if (String(existing.account_type || "") !== "Driver") {
          const message = `${email} already belongs to an employee with the "${existing.account_type}" role. Change their role in Manage Employees first.`;
          if (wantsJson(req)) return res.status(409).json({ ok: false, message });
          req.flash("error", message);
          return res.redirect("/transportation/manage");
        }
        userId = existing.user_id;
        await db.query(
          `UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW() WHERE user_id = $3`,
          [firstName, lastName, userId]
        );
      } else {
        const crypto = require("crypto");
        const token = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
        const tokenExpiration = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

        const inserted = await db.query(
          `INSERT INTO users (
             first_name, last_name, email, account_type, organization_id,
             created_at, updated_at, reset_password_token, reset_password_expires
           ) VALUES ($1, $2, $3, 'Driver', $4, NOW(), NOW(), $5, $6)
           RETURNING user_id`,
          [firstName, lastName, email, organizationId, hashedToken, tokenExpiration]
        );
        userId = inserted.rows[0].user_id;
        isNewUser = true;

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const setPasswordUrl = `${baseUrl}/common/set-password?token=${token}`;
        const organizationName = req.session.organizationName;
        setImmediate(async () => {
          try {
            const { sendInviteEmail } = require("./commonController");
            await sendInviteEmail(email, firstName, lastName, setPasswordUrl, organizationName, organizationId, [], []);
          } catch (_) {
            // Best-effort — the driver account still exists even if the email fails.
          }
        });
      }

      let imageUrl = null;
      if (req.file) {
        const key = `images/transportation/drivers/${organizationId}/${Date.now()}_${safeFileName(req.file.originalname)}`;
        imageUrl = await uploadToS3(req.file, key);
      }

      const driverId = await transportationController._syncDriverProfileAndBus(db, {
        organizationId, userId, firstName, lastName, phone, email,
        licenseNumber, assignedBusId, assignedRouteId, status, imageUrl,
      });
      await transportationController._syncDriverSchedule(db, {
        organizationId, driverId, busId: assignedBusId, routeId: assignedRouteId,
        days: scheduleDays, startTime: scheduleStartTime, endTime: scheduleEndTime,
      });

      const message = isNewUser
        ? "Driver created — an invite email has been sent so they can set up their login."
        : "Driver saved.";
      if (wantsJson(req)) return res.json({ ok: true, message });
      req.flash("success", message);
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to save driver." });
      req.flash("error", "Unable to save driver.");
    }

    return res.redirect("/transportation/manage");
  },

  updateDriverPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const userId = toInt(req.params.userId || req.body.userId);
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const email = String(req.body.email || "").trim();
    const phone = String(req.body.phone || "").trim() || null;
    const licenseNumber = String(req.body.licenseNumber || "").trim() || null;
    let assignedBusId = toInt(req.body.assignedBusId);
    let assignedRouteId = toInt(req.body.assignedRouteId);
    const status = normalizeScheduleStatus(req.body.status, "active");
    const scheduleDays = req.body.scheduleDays;
    const scheduleStartTime = String(req.body.scheduleStartTime || "").trim() || null;
    const scheduleEndTime = String(req.body.scheduleEndTime || "").trim() || null;

    if (!userId || !firstName || !lastName || !email) {
      const message = !userId ? "Driver is required." : "First name, last name, and email are required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    const problem = scheduleProblem(scheduleDays, assignedBusId, assignedRouteId);
    if (problem) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: problem });
      req.flash("error", problem);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const verified = await verifyOrgIds(db, organizationId, assignedBusId, assignedRouteId);
      if (!verified.valid) {
        if (wantsJson(req)) return res.status(400).json({ ok: false, message: verified.message });
        req.flash("error", verified.message);
        return res.redirect("/transportation/manage");
      }

      const userCheck = await db.query(
        `SELECT user_id FROM users WHERE user_id = $1 AND organization_id = $2 AND account_type = 'Driver'`,
        [userId, organizationId]
      );
      if (!userCheck.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Driver not found." });
        req.flash("error", "Driver not found.");
        return res.redirect("/transportation/manage");
      }

      const emailOwner = await db.query(
        `SELECT user_id FROM users WHERE organization_id = $1 AND LOWER(email) = LOWER($2) AND user_id != $3`,
        [organizationId, email, userId]
      );
      if (emailOwner.rows.length) {
        const message = "Another employee already uses this email address.";
        if (wantsJson(req)) return res.status(409).json({ ok: false, message });
        req.flash("error", message);
        return res.redirect("/transportation/manage");
      }

      await db.query(
        `UPDATE users SET first_name = $1, last_name = $2, email = $3, updated_at = NOW() WHERE user_id = $4`,
        [firstName, lastName, email, userId]
      );

      let imageUrl = null;
      if (req.file) {
        const key = `images/transportation/drivers/${organizationId}/${Date.now()}_${safeFileName(req.file.originalname)}`;
        imageUrl = await uploadToS3(req.file, key);
      }

      const driverId = await transportationController._syncDriverProfileAndBus(db, {
        organizationId, userId, firstName, lastName, phone, email,
        licenseNumber, assignedBusId, assignedRouteId, status, imageUrl,
      });
      await transportationController._syncDriverSchedule(db, {
        organizationId, driverId, busId: assignedBusId, routeId: assignedRouteId,
        days: scheduleDays, startTime: scheduleStartTime, endTime: scheduleEndTime,
      });

      if (wantsJson(req)) return res.json({ ok: true, message: "Driver updated." });
      req.flash("success", "Driver updated.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to update driver." });
      req.flash("error", "Unable to update driver.");
    }

    return res.redirect("/transportation/manage");
  },

  deleteDriverPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const userId = toInt(req.params.userId || req.body.userId);
    if (!userId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Driver is required." });
      req.flash("error", "Driver is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);

      // This removes the driver from transportation (profile + bus link)
      // only. The employee account itself is managed from Manage Employees,
      // so login access isn't silently revoked from this screen.
      const profile = await db.query(
        `SELECT driver_id
           FROM transport_drivers
          WHERE organization_id = $1 AND user_id = $2
          LIMIT 1`,
        [organizationId, userId]
      );
      if (profile.rows[0]) {
        await db.query(
          `DELETE FROM transport_bus_schedules
            WHERE organization_id = $1 AND driver_id = $2`,
          [organizationId, profile.rows[0].driver_id]
        );
      }
      await db.query(
        `UPDATE transport_buses SET driver_user_id = NULL, updated_at = NOW()
          WHERE organization_id = $1 AND driver_user_id = $2`,
        [organizationId, userId]
      );
      const result = await db.query(
        `DELETE FROM transport_drivers
          WHERE organization_id = $1 AND user_id = $2
          RETURNING driver_id`,
        [organizationId, userId]
      );

      if (!result.rows.length) {
        // No profile row existed yet, but the bus link was still cleared —
        // treat as a successful removal either way.
        if (wantsJson(req)) return res.json({ ok: true, message: "Driver removed from transportation." });
        req.flash("success", "Driver removed from transportation.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Driver removed from transportation." });
      req.flash("success", "Driver removed from transportation. To fully delete their account, use Manage Employees.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to remove driver." });
      req.flash("error", "Unable to remove driver.");
    }

    return res.redirect("/transportation/manage");
  },

  createSchedulePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) {
        return res.status(401).json({ ok: false, message: "Unauthorized." });
      }
      return res.redirect("/account/login");
    }

    const busId = toInt(req.body.busId);
    const driverId = toInt(req.body.driverId);
    const routeId = toInt(req.body.routeId);
    const dayOfWeek = normalizeDayOfWeek(req.body.dayOfWeek);
    const startTime = String(req.body.startTime || "").trim() || null;
    const endTime = String(req.body.endTime || "").trim() || null;
    const status = normalizeScheduleStatus(req.body.status, "active");
    const notes = String(req.body.notes || "").trim() || null;

    if (!busId) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message: "Bus is required for schedule assignment." });
      }
      req.flash("error", "Bus is required for schedule assignment.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      await db.query(
        `INSERT INTO transport_bus_schedules (
           organization_id, bus_id, driver_id, route_id,
           day_of_week, start_time, end_time, status, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [organizationId, busId, driverId, routeId, dayOfWeek, startTime, endTime, status, notes]
      );

      if (driverId) {
        await db.query(
          `UPDATE transport_drivers
              SET assigned_bus_id = $3,
                  assigned_route_id = $4,
                  updated_at = NOW()
            WHERE organization_id = $1
              AND driver_id = $2`,
          [organizationId, driverId, busId, routeId]
        );
      }

      if (wantsJson(req)) {
        return res.json({ ok: true, message: "Schedule saved." });
      }
      req.flash("success", "Schedule saved.");
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "Unable to save schedule." });
      }
      req.flash("error", "Unable to save schedule.");
    }

    return res.redirect("/transportation/manage");
  },

  updateSchedulePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) {
        return res.status(401).json({ ok: false, message: "Unauthorized." });
      }
      return res.redirect("/account/login");
    }

    const scheduleId = toInt(req.params.scheduleId || req.body.scheduleId);
    const busId = toInt(req.body.busId);
    const driverId = toInt(req.body.driverId);
    const routeId = toInt(req.body.routeId);
    const dayOfWeek = normalizeDayOfWeek(req.body.dayOfWeek);
    const startTime = String(req.body.startTime || "").trim() || null;
    const endTime = String(req.body.endTime || "").trim() || null;
    const status = normalizeScheduleStatus(req.body.status, "active");
    const notes = String(req.body.notes || "").trim() || null;

    if (!scheduleId || !busId) {
      const message = !scheduleId ? "Schedule id is required." : "Bus is required for schedule assignment.";
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message });
      }
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `UPDATE transport_bus_schedules
            SET bus_id = $3,
                driver_id = $4,
                route_id = $5,
                day_of_week = $6,
                start_time = $7,
                end_time = $8,
                status = $9,
                notes = $10,
                updated_at = NOW()
          WHERE organization_id = $1
            AND schedule_id = $2
          RETURNING schedule_id`,
        [organizationId, scheduleId, busId, driverId, routeId, dayOfWeek, startTime, endTime, status, notes]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Schedule not found." });
        req.flash("error", "Schedule not found.");
        return res.redirect("/transportation/manage");
      }

      if (driverId) {
        await db.query(
          `UPDATE transport_drivers
              SET assigned_bus_id = $3,
                  assigned_route_id = $4,
                  updated_at = NOW()
            WHERE organization_id = $1
              AND driver_id = $2`,
          [organizationId, driverId, busId, routeId]
        );
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Schedule updated." });
      req.flash("success", "Schedule updated.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to update schedule." });
      req.flash("error", "Unable to update schedule.");
    }

    return res.redirect("/transportation/manage");
  },

  deleteSchedulePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const scheduleId = toInt(req.params.scheduleId || req.body.scheduleId);
    if (!scheduleId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Schedule id is required." });
      req.flash("error", "Schedule id is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `DELETE FROM transport_bus_schedules
          WHERE organization_id = $1
            AND schedule_id = $2
          RETURNING schedule_id`,
        [organizationId, scheduleId]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Schedule not found." });
        req.flash("error", "Schedule not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Schedule deleted." });
      req.flash("success", "Schedule deleted.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to delete schedule." });
      req.flash("error", "Unable to delete schedule.");
    }

    return res.redirect("/transportation/manage");
  },

  // Stops belong to routes, not the other way around: this attaches exactly
  // the submitted stop ids to the route and detaches any stop that used to
  // belong to it but was unchecked, so a stop can freely move between
  // routes (or sit unattached in the pool) as the admin edits the route.
  async _syncRouteStops(db, organizationId, routeId, rawStopIds) {
    const stopIds = (Array.isArray(rawStopIds) ? rawStopIds : rawStopIds ? [rawStopIds] : [])
      .map((v) => toInt(v))
      .filter((v) => Number.isInteger(v) && v > 0);

    await db.query(
      `UPDATE transport_stops
          SET route_id = NULL, updated_at = NOW()
        WHERE organization_id = $1 AND route_id = $2 AND NOT (stop_id = ANY($3::int[]))`,
      [organizationId, routeId, stopIds]
    );
    if (stopIds.length) {
      await db.query(
        `UPDATE transport_stops
            SET route_id = $2, updated_at = NOW()
          WHERE organization_id = $1 AND stop_id = ANY($3::int[])`,
        [organizationId, routeId, stopIds]
      );
    }
  },

  createRoutePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const routeName = String(req.body.routeName || "").trim();
    const routeCode = String(req.body.routeCode || "").trim();
    const routeStatus = normalizeStatus(req.body.routeStatus, "active");
    const mapProvider = normalizeMapProvider(req.body.mapProvider);
    const useSchoolDestination = String(req.body.useSchoolDestination || "").trim() === "1";
    const requestedDestinationAddress = String(req.body.destinationAddress || "").trim() || null;
    const requestedDestinationLatitude = toFloat(req.body.destinationLatitude);
    const requestedDestinationLongitude = toFloat(req.body.destinationLongitude);

    if (!routeName) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Route name is required." });
      req.flash("error", "Route name is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const orgDestination = await getOrganizationDestination(db, organizationId);
      const destinationAddress = useSchoolDestination
        ? orgDestination.address
        : (requestedDestinationAddress || orgDestination.address);
      let destinationLatitude = useSchoolDestination
        ? orgDestination.latitude
        : (requestedDestinationLatitude !== null ? requestedDestinationLatitude : orgDestination.latitude);
      let destinationLongitude = useSchoolDestination
        ? orgDestination.longitude
        : (requestedDestinationLongitude !== null ? requestedDestinationLongitude : orgDestination.longitude);

      // A custom destination address with no coordinates yet gets geocoded
      // automatically — admins just type an address, no lat/lng needed.
      if (!useSchoolDestination && requestedDestinationAddress && requestedDestinationLatitude === null && requestedDestinationLongitude === null) {
        const orgMeta = await db.query(
          `SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1`,
          [organizationId]
        );
        const geocoded = await geocodeAddress(
          requestedDestinationAddress,
          orgMeta.rows[0]?.organization_province,
          orgMeta.rows[0]?.organization_country
        ).catch(() => null);
        if (geocoded) {
          destinationLatitude = geocoded.lat;
          destinationLongitude = geocoded.lng;
        }
      }
      const saveResult = await db.query(
        `INSERT INTO transport_routes (
           organization_id, route_name, route_code, route_status, map_provider,
           use_school_destination, destination_address, destination_latitude, destination_longitude
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, route_name)
         DO UPDATE SET
           route_code = EXCLUDED.route_code,
           route_status = EXCLUDED.route_status,
           map_provider = EXCLUDED.map_provider,
           use_school_destination = EXCLUDED.use_school_destination,
           destination_address = EXCLUDED.destination_address,
           destination_latitude = EXCLUDED.destination_latitude,
           destination_longitude = EXCLUDED.destination_longitude,
           updated_at = NOW()
         RETURNING route_id`,
        [
          organizationId,
          routeName,
          routeCode || null,
          routeStatus,
          mapProvider,
          useSchoolDestination,
          destinationAddress,
          destinationLatitude,
          destinationLongitude,
        ]
      );
      const savedRouteId = saveResult.rows[0]?.route_id;
      if (savedRouteId) {
        await transportationController._syncRouteStops(db, organizationId, savedRouteId, req.body.stopIds);
      }
      if (wantsJson(req)) return res.json({ ok: true, message: "Route saved." });
      req.flash("success", "Route saved.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to save route." });
      req.flash("error", "Unable to save route.");
    }

    return res.redirect("/transportation/manage");
  },

  updateRoutePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const routeId = toInt(req.params.routeId || req.body.routeId);
    const routeName = String(req.body.routeName || "").trim();
    const routeCode = String(req.body.routeCode || "").trim() || null;
    const routeStatus = normalizeStatus(req.body.routeStatus, "active");
    const mapProvider = normalizeMapProvider(req.body.mapProvider);
    const useSchoolDestination = String(req.body.useSchoolDestination || "").trim() === "1";
    const requestedDestinationAddress = String(req.body.destinationAddress || "").trim() || null;
    const requestedDestinationLatitude = toFloat(req.body.destinationLatitude);
    const requestedDestinationLongitude = toFloat(req.body.destinationLongitude);

    if (!routeId || !routeName) {
      const message = !routeId ? "Route id is required." : "Route name is required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const orgDestination = await getOrganizationDestination(db, organizationId);
      const destinationAddress = useSchoolDestination
        ? orgDestination.address
        : (requestedDestinationAddress || orgDestination.address);
      let destinationLatitude = useSchoolDestination
        ? orgDestination.latitude
        : (requestedDestinationLatitude !== null ? requestedDestinationLatitude : orgDestination.latitude);
      let destinationLongitude = useSchoolDestination
        ? orgDestination.longitude
        : (requestedDestinationLongitude !== null ? requestedDestinationLongitude : orgDestination.longitude);

      if (!useSchoolDestination && requestedDestinationAddress && requestedDestinationLatitude === null && requestedDestinationLongitude === null) {
        const orgMeta = await db.query(
          `SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1`,
          [organizationId]
        );
        const geocoded = await geocodeAddress(
          requestedDestinationAddress,
          orgMeta.rows[0]?.organization_province,
          orgMeta.rows[0]?.organization_country
        ).catch(() => null);
        if (geocoded) {
          destinationLatitude = geocoded.lat;
          destinationLongitude = geocoded.lng;
        }
      }
      const result = await db.query(
        `UPDATE transport_routes
            SET route_name = $3,
                route_code = $4,
                route_status = $5,
                map_provider = $6,
                use_school_destination = $7,
                destination_address = $8,
                destination_latitude = $9,
                destination_longitude = $10,
                updated_at = NOW()
          WHERE organization_id = $1
            AND route_id = $2
          RETURNING route_id`,
        [
          organizationId,
          routeId,
          routeName,
          routeCode,
          routeStatus,
          mapProvider,
          useSchoolDestination,
          destinationAddress,
          destinationLatitude,
          destinationLongitude,
        ]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Route not found." });
        req.flash("error", "Route not found.");
        return res.redirect("/transportation/manage");
      }

      await transportationController._syncRouteStops(db, organizationId, routeId, req.body.stopIds);

      if (wantsJson(req)) return res.json({ ok: true, message: "Route updated." });
      req.flash("success", "Route updated.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to update route." });
      req.flash("error", "Unable to update route.");
    }

    return res.redirect("/transportation/manage");
  },

  deleteRoutePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const routeId = toInt(req.params.routeId || req.body.routeId);
    if (!routeId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Route id is required." });
      req.flash("error", "Route id is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `DELETE FROM transport_routes
          WHERE organization_id = $1
            AND route_id = $2
          RETURNING route_id`,
        [organizationId, routeId]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Route not found." });
        req.flash("error", "Route not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Route deleted." });
      req.flash("success", "Route deleted.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to delete route." });
      req.flash("error", "Unable to delete route.");
    }

    return res.redirect("/transportation/manage");
  },

  createStopPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const routeId = toInt(req.body.routeId);
    const stopName = String(req.body.stopName || "").trim();
    const stopAddress = String(req.body.stopAddress || "").trim();
    const latitude = toFloat(req.body.latitude);
    const longitude = toFloat(req.body.longitude);
    const pickupTime = String(req.body.pickupTime || "").trim() || null;
    const dropoffTime = String(req.body.dropoffTime || "").trim() || null;
    const stopOrder = toInt(req.body.stopOrder) || 0;

    if (!stopName) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Stop name is required." });
      req.flash("error", "Stop name is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      await db.query(
        `INSERT INTO transport_stops (
           organization_id, route_id, stop_name, stop_address,
           latitude, longitude, pickup_time, dropoff_time, stop_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          organizationId,
          routeId,
          stopName,
          stopAddress || null,
          latitude,
          longitude,
          pickupTime,
          dropoffTime,
          stopOrder,
        ]
      );
      if (wantsJson(req)) return res.json({ ok: true, message: "Stop saved." });
      req.flash("success", "Stop saved.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to save stop." });
      req.flash("error", "Unable to save stop.");
    }

    return res.redirect("/transportation/manage");
  },

  importCityStopsPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const routeId = toInt(req.body.routeId);
    const city = String(req.body.city || "").trim();
    const requestedMax = toInt(req.body.maxStops);
    const maxStops = Math.min(Math.max(requestedMax || 40, 1), 120);

    if (!routeId || !city) {
      const message = !routeId ? "Route is required." : "City is required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);

      const routeCheck = await db.query(
        `SELECT route_id
           FROM transport_routes
          WHERE organization_id = $1
            AND route_id = $2
          LIMIT 1`,
        [organizationId, routeId]
      );
      if (!routeCheck.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Route not found." });
        req.flash("error", "Route not found.");
        return res.redirect("/transportation/manage");
      }

      const existingStops = await db.query(
        `SELECT stop_name, latitude, longitude
           FROM transport_stops
          WHERE organization_id = $1
            AND route_id = $2`,
        [organizationId, routeId]
      );

      const seen = new Set(
        existingStops.rows.map((row) => {
          const lat = row.latitude !== null ? Number(row.latitude).toFixed(5) : "";
          const lng = row.longitude !== null ? Number(row.longitude).toFixed(5) : "";
          return `${String(row.stop_name || "").trim().toLowerCase()}|${lat}|${lng}`;
        })
      );

      const stopOrderResult = await db.query(
        `SELECT COALESCE(MAX(stop_order), -1) AS max_order
           FROM transport_stops
          WHERE organization_id = $1
            AND route_id = $2`,
        [organizationId, routeId]
      );
      let nextOrder = Number(stopOrderResult.rows[0]?.max_order || 0) + 1;

      const overpassQuery = `[out:json][timeout:30];\narea[\"name\"=\"${city.replace(/\"/g, "") }\"]->.searchArea;\n(\n  node[\"highway\"=\"bus_stop\"](area.searchArea);\n  node[\"public_transport\"=\"platform\"](area.searchArea);\n  node[\"public_transport\"=\"stop_position\"](area.searchArea);\n);\nout body ${maxStops};`;

      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), 25000);

      let payload;
      try {
        const response = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
            "Accept": "application/json",
          },
          body: overpassQuery,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("Map data service failed.");
        }

        payload = await response.json();
      } finally {
        clearTimeout(timeoutHandle);
      }

      const elements = Array.isArray(payload?.elements) ? payload.elements : [];
      let inserted = 0;
      let skipped = 0;

      for (const entry of elements) {
        if (inserted >= maxStops) break;
        const lat = Number(entry?.lat);
        const lng = Number(entry?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          skipped += 1;
          continue;
        }

        const tags = entry?.tags || {};
        const name = String(tags.name || tags["name:en"] || `Stop ${lat.toFixed(4)}, ${lng.toFixed(4)}`).trim();
        const addressParts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean);
        const address = addressParts.join(" ") || city;

        const key = `${name.toLowerCase()}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }

        await db.query(
          `INSERT INTO transport_stops (
             organization_id, route_id, stop_name, stop_address,
             latitude, longitude, stop_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [organizationId, routeId, name, address, lat, lng, nextOrder]
        );

        seen.add(key);
        inserted += 1;
        nextOrder += 1;
      }

      const message = inserted > 0
        ? `Imported ${inserted} stop${inserted === 1 ? "" : "s"} from ${city}.`
        : `No new stops imported from ${city}.`;

      if (wantsJson(req)) {
        return res.json({ ok: true, message, inserted, skipped });
      }
      req.flash("success", message);
    } catch (error) {
      const message = "Unable to import city stops right now.";
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message });
      }
      req.flash("error", message);
    }

    return res.redirect("/transportation/manage");
  },

  updateStopPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const stopId = toInt(req.params.stopId || req.body.stopId);
    const routeId = toInt(req.body.routeId);
    const stopName = String(req.body.stopName || "").trim();
    const stopAddress = String(req.body.stopAddress || "").trim() || null;
    const latitude = toFloat(req.body.latitude);
    const longitude = toFloat(req.body.longitude);
    const pickupTime = String(req.body.pickupTime || "").trim() || null;
    const dropoffTime = String(req.body.dropoffTime || "").trim() || null;
    const stopOrder = toInt(req.body.stopOrder) || 0;

    if (!stopId || !stopName) {
      const message = !stopId ? "Stop id is required." : "Stop name is required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `UPDATE transport_stops
            SET route_id = $3,
                stop_name = $4,
                stop_address = $5,
                latitude = $6,
                longitude = $7,
                pickup_time = $8,
                dropoff_time = $9,
                stop_order = $10,
                updated_at = NOW()
          WHERE organization_id = $1
            AND stop_id = $2
          RETURNING stop_id`,
        [
          organizationId,
          stopId,
          routeId,
          stopName,
          stopAddress,
          latitude,
          longitude,
          pickupTime,
          dropoffTime,
          stopOrder,
        ]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Stop not found." });
        req.flash("error", "Stop not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Stop updated." });
      req.flash("success", "Stop updated.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to update stop." });
      req.flash("error", "Unable to update stop.");
    }

    return res.redirect("/transportation/manage");
  },

  deleteStopPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const stopId = toInt(req.params.stopId || req.body.stopId);
    if (!stopId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Stop id is required." });
      req.flash("error", "Stop id is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `DELETE FROM transport_stops
          WHERE organization_id = $1
            AND stop_id = $2
          RETURNING stop_id`,
        [organizationId, stopId]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Stop not found." });
        req.flash("error", "Stop not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Stop deleted." });
      req.flash("success", "Stop deleted.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to delete stop." });
      req.flash("error", "Unable to delete stop.");
    }

    return res.redirect("/transportation/manage");
  },

  assignStudentPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    const studentId = toInt(req.body.studentId);
    const busId = toInt(req.body.busId);
    const routeId = toInt(req.body.routeId);
    const stopId = toInt(req.body.stopId);
    const pickupTime = String(req.body.pickupTime || "").trim() || null;
    const dropoffTime = String(req.body.dropoffTime || "").trim() || null;
    const homeAddress = String(req.body.homeAddress || "").trim() || null;
    const homeLatitude = toFloat(req.body.homeLatitude);
    const homeLongitude = toFloat(req.body.homeLongitude);

    if (!studentId) {
      req.flash("error", "Student is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);

      let resolvedStopId = stopId;
      let resolvedRouteId = routeId;
      let distanceKm = null;

      if (!resolvedStopId && homeLatitude !== null && homeLongitude !== null) {
        const nearest = await suggestNearestStop(db, organizationId, homeLatitude, homeLongitude);
        if (nearest) {
          resolvedStopId = nearest.stopId;
          resolvedRouteId = resolvedRouteId || nearest.routeId;
          distanceKm = Number(nearest.distanceKm.toFixed(3));
        }
      }

      await db.query(
        `INSERT INTO transport_student_assignments (
           organization_id, student_id, bus_id, route_id, stop_id,
           pickup_time, dropoff_time, home_address, home_latitude, home_longitude, distance_km, active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
         ON CONFLICT (organization_id, student_id)
         DO UPDATE SET
           bus_id = EXCLUDED.bus_id,
           route_id = EXCLUDED.route_id,
           stop_id = EXCLUDED.stop_id,
           pickup_time = EXCLUDED.pickup_time,
           dropoff_time = EXCLUDED.dropoff_time,
           home_address = EXCLUDED.home_address,
           home_latitude = EXCLUDED.home_latitude,
           home_longitude = EXCLUDED.home_longitude,
           distance_km = EXCLUDED.distance_km,
           active = TRUE,
           updated_at = NOW()`,
        [
          organizationId,
          studentId,
          busId,
          resolvedRouteId,
          resolvedStopId,
          pickupTime,
          dropoffTime,
          homeAddress,
          homeLatitude,
          homeLongitude,
          distanceKm,
        ]
      );

      req.flash("success", "Student transportation assignment saved.");
    } catch (error) {
      req.flash("error", "Unable to save student transportation assignment.");
    }

    return res.redirect("/transportation/manage");
  },

  /* ---------- bus requests ---------- */
  requestStartGet: (req, res, db) => answer(res, async () => {
    await requireTransportationOn(db, req.session.organizationId);
    const data = await busRequests.requestStart(db, req.session.organizationId, req.busRequester.studentId);
    return { success: true, ...data };
  }),

  requestOptionsPost: (req, res, db) => answer(res, async () => {
    limitRequests(req, "options", 30);
    await requireTransportationOn(db, req.session.organizationId);
    const data = await busRequests.findOptions(db, req.session.organizationId, req.body || {});
    return { success: true, ...data };
  }),

  requestCreatePost: (req, res, db) => answer(res, async () => {
    limitRequests(req, "create", 10);
    await requireTransportationOn(db, req.session.organizationId);
    const requestId = await busRequests.createRequest(db, req.session.organizationId, req.busRequester, {
      ...(req.body || {}),
      studentId: req.busRequester.studentId,
    });
    return { success: true, requestId, message: "Request sent to the school." };
  }),

  requestsMineGet: (req, res, db) => answer(res, async () => {
    const studentIds = await guardianStudentIds(db, req.session);
    const requests = studentIds.length
      ? await busRequests.listRequests(db, req.session.organizationId, {
          bucket: req.query.bucket === "old" ? "old" : "new",
          guardianStudentIds: studentIds,
        })
      : [];
    return { success: true, requests };
  }),

  requestCancelPost: (req, res, db) => answer(res, async () => {
    const studentIds = await guardianStudentIds(db, req.session);
    await busRequests.cancelRequest(db, req.session.organizationId, toInt(req.params.requestId), studentIds);
    return { success: true, message: "Request cancelled." };
  }),

  manageRequestsGet: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const [requests, newCount] = await Promise.all([
      busRequests.listRequests(db, organizationId, { bucket: req.query.bucket === "old" ? "old" : "new" }),
      busRequests.countNewRequests(db, organizationId),
    ]);
    return { success: true, requests, newCount };
  }),

  manageRequestApprovePost: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    await busRequests.approveRequest(db, organizationId, toInt(req.params.requestId), staffIdentity(req.session), req.body || {});
    return { success: true, message: "Approved. The student now has bus access.", newCount: await busRequests.countNewRequests(db, organizationId) };
  }),

  manageRequestDeclinePost: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    await busRequests.declineRequest(db, organizationId, toInt(req.params.requestId), staffIdentity(req.session), req.body?.note);
    return { success: true, message: "Request declined.", newCount: await busRequests.countNewRequests(db, organizationId) };
  }),

  /* ---------- from the driver ---------- */
  driverReportPost: (req, res, db) => answer(res, async () => {
    if (req.session.userRole !== "Driver") throw new transportReports.ReportError("Only drivers send these reports.", 403);
    limitRequests(req, "report", 10);
    const organizationId = req.session.organizationId;
    const driver = staffIdentity(req.session);
    const trip = await db.query(
      `SELECT trip_id, bus_id, route_id FROM transport_trip_sessions
        WHERE organization_id = $1 AND driver_user_id = $2 AND status = 'active'
        ORDER BY started_at DESC LIMIT 1`,
      [organizationId, driver.userId]
    );
    const bus = trip.rows[0] ? null : await db.query("SELECT bus_id FROM transport_buses WHERE organization_id = $1 AND driver_user_id = $2 LIMIT 1", [organizationId, driver.userId]);
    const saved = await transportReports.createReports(db, organizationId, {
      ...driver,
      tripId: trip.rows[0]?.trip_id,
      busId: trip.rows[0]?.bus_id || bus?.rows[0]?.bus_id,
      routeId: trip.rows[0]?.route_id,
    }, req.body || {});
    return { success: true, saved, message: "Sent to your lead." };
  }),

  driverArrivalsPost: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const driver = staffIdentity(req.session);
    const trip = await liveBus.tripForDriver(db, organizationId, toInt(req.body?.tripId), driver.userId);
    if (!trip) throw new transportReports.ReportError("Active trip not found.", 404);
    const result = await transportReports.saveArrivals(db, organizationId, driver, trip, req.body?.arrivals);
    return { success: true, ...result };
  }),

  /* ---------- boarding, and who is riding today ---------- */
  driverBoardingPost: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const organizationId = req.session.organizationId;
    const driver = staffIdentity(req.session);
    const trip = await liveBus.tripForDriver(db, organizationId, toInt(req.body?.tripId), driver.userId);
    if (!trip) throw new transportReports.ReportError("Active trip not found.", 404);
    return { success: true, ...(await transportBoarding.saveBoarding(db, organizationId, driver, trip, req.body || {})) };
  }),

  driverNotRidingGet: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const reading = await transportBoarding.schoolDay(db, req.session.organizationId, transportBoarding.dayFrom(req.query.date));
    return { success: true, studentIds: reading.notRiding.map((row) => row.studentId) };
  }),

  parentRidingGet: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const session = req.session;
    const family = await transportBoarding.familyOf(db, session.organizationId, session.guardianId, () => guardianStudentIds(db, session));
    const reading = await transportBoarding.schoolDay(db, session.organizationId, transportBoarding.dayFrom(req.query.date));
    return { success: true, riders: family.riders, ...transportBoarding.forStudents(reading, family.studentIds) };
  }),

  parentRidingPost: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const session = req.session;
    const studentId = toInt(req.body?.studentId);
    if (!(await guardianStudentIds(db, session)).includes(studentId)) throw new transportReports.ReportError("That student isn't yours.", 403);
    const name = [session.firstName, session.lastName].filter(Boolean).join(" ");
    await transportBoarding.setRiding(db, session.organizationId, studentId, transportBoarding.dayFrom(req.body?.date), req.body?.coming === true, { by: "parent", name });
    return { success: true };
  }),

  parentStopBusPost: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const session = req.session;
    const studentId = toInt(req.body?.studentId);
    if (!(await guardianStudentIds(db, session)).includes(studentId)) throw new transportReports.ReportError("That student isn't yours.", 403);
    await transportBoarding.askToStopBus(db, session.organizationId, studentId, [session.firstName, session.lastName].filter(Boolean).join(" "));
    return { success: true };
  }),

  classRidingGet: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const organizationId = req.session.organizationId;
    const studentIds = await classStudentIds(db, req, res);
    const reading = await transportBoarding.schoolDay(db, organizationId, transportBoarding.dayFrom(req.query.date));
    return { success: true, ...transportBoarding.forStudents(reading, studentIds) };
  }),

  classRidingPost: (req, res, db) => answer(res, async () => {
    requireBoarding(req);
    const studentId = toInt(req.body?.studentId);
    if (!(await classStudentIds(db, req, res)).includes(studentId)) throw new transportReports.ReportError("That student isn't in this class.", 403);
    const who = staffIdentity(req.session);
    await transportBoarding.setRiding(db, req.session.organizationId, studentId, transportBoarding.dayFrom(req.body?.date), req.body?.coming === true, { by: "staff", name: who.name });
    return { success: true };
  }),

  driverLocatePost: (req, res, db) => answer(res, async () => {
    limitRequests(req, "locate", 15);
    const address = String(req.body?.address || "").trim().slice(0, 300);
    if (!address) throw new transportReports.ReportError("Enter the stop's address.");
    const school = await db.query("SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1", [req.session.organizationId]);
    const place = await locateAddress(address, school.rows[0]?.organization_province, school.rows[0]?.organization_country);
    if (!place) throw new transportReports.ReportError("We couldn't find that address. Check the spelling.", 404);
    return { success: true, lat: place.lat, lng: place.lng };
  }),

  /* ---------- for the leads ---------- */
  manageReportsGet: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const bucket = req.query.bucket;
    const [newCount, reports, arrivals] = await Promise.all([
      transportReports.countNewReports(db, organizationId),
      bucket === "arrivals" ? [] : transportReports.listReports(db, organizationId, bucket === "old" ? "old" : "new"),
      bucket === "arrivals" ? transportReports.arrivalSummaries(db, organizationId) : [],
    ]);
    return { success: true, newCount, reports, arrivals };
  }),

  manageReportReviewPost: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    await transportReports.reviewReport(db, organizationId, toInt(req.params.reportId), staffIdentity(req.session), req.body || {});
    return { success: true, message: "Saved.", newCount: await transportReports.countNewReports(db, organizationId) };
  }),

  arrivalSettingPost: (req, res, db) => answer(res, async () => {
    const on = String(req.body?.parentConfirm) === "1";
    await db.query("UPDATE organizations SET transportation_parent_confirm_arrival = $1 WHERE organization_id = $2", [on, req.session.organizationId]);
    return { success: true, parentConfirm: on };
  }),

  arrivalsMineGet: (req, res, db) => answer(res, async () => {
    const studentIds = await guardianStudentIds(db, req.session);
    return { success: true, arrivals: await transportReports.pendingArrivalsForParent(db, req.session.organizationId, studentIds) };
  }),

  arrivalAnswerPost: (req, res, db) => answer(res, async () => {
    const studentIds = await guardianStudentIds(db, req.session);
    await transportReports.answerArrival(db, req.session.organizationId, toInt(req.params.arrivalId), {
      guardianId: req.session.guardianId,
      studentIds,
      name: [req.session.firstName, req.session.lastName].filter(Boolean).join(" "),
    }, req.body?.arrived === true || req.body?.arrived === "1", req.body?.note);
    return { success: true };
  }),

  reportsMineGet: (req, res, db) => answer(res, async () => {
    const studentIds = await guardianStudentIds(db, req.session);
    return { success: true, reports: await transportReports.reportsForParent(db, req.session.organizationId, studentIds) };
  }),

  reportsForClassGet: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const classId = toInt(req.params.classId);
    const session = req.session;
    const role = String(session.userRole || "").toLowerCase();
    const mine = await db.query(
      "SELECT 1 FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = $1 AND uc.class_id = $2 AND c.organization_id = $3 LIMIT 1",
      [session.userId || session.user?.user_id || 0, classId, organizationId]
    );
    if (!mine.rows[0] && role !== "manager" && !(res.locals.userPermissions || []).includes("manage_students")) {
      throw new transportReports.ReportError("You can only see your own classes.", 403);
    }
    return { success: true, reports: await transportReports.reportsForClass(db, organizationId, classId) };
  }),

  /* ---------- the student side panel ---------- */
  studentPanelGet: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const studentId = toInt(req.params.studentId);
    const [student, assignment] = await Promise.all([
      db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.address, c.class_name
           FROM students s
           LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
          WHERE s.student_id = $1 AND s.organization_id = $2 AND COALESCE(s.graduated, FALSE) = FALSE`,
        [studentId, organizationId]
      ),
      db.query(
        `SELECT tsa.active, tsa.bus_id, tsa.route_id, tsa.stop_id, tsa.pickup_time, tsa.dropoff_time, tsa.home_address, st.stop_name
           FROM transport_student_assignments tsa
           LEFT JOIN transport_stops st ON st.stop_id = tsa.stop_id AND st.organization_id = tsa.organization_id
          WHERE tsa.student_id = $1 AND tsa.organization_id = $2`,
        [studentId, organizationId]
      ),
    ]);
    const row = student.rows[0];
    if (!row) throw new busRequests.RequestError("Student not found.", 404);
    const bus = assignment.rows[0] || null;
    return {
      success: true,
      student: {
        id: Number(row.student_id),
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        address: row.address || "",
        className: row.class_name || "",
      },
      assignment: {
        active: Boolean(bus && bus.active),
        busId: bus ? bus.bus_id : null,
        routeId: bus ? bus.route_id : null,
        stopId: bus ? bus.stop_id : null,
        pickupTime: bus && bus.pickup_time ? String(bus.pickup_time).slice(0, 5) : "",
        dropoffTime: bus && bus.dropoff_time ? String(bus.dropoff_time).slice(0, 5) : "",
        homeAddress: (bus && bus.home_address) || "",
        addressAsStop: Boolean(bus && busRequests.isPrivateStop({ stop_name: bus.stop_name })),
      },
    };
  }),

  studentPanelSavePost: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const studentId = toInt(req.params.studentId);
    const body = req.body || {};
    const found = await db.query(
      `SELECT student_id, first_name, last_name, address FROM students
        WHERE student_id = $1 AND organization_id = $2 AND COALESCE(graduated, FALSE) = FALSE`,
      [studentId, organizationId]
    );
    const student = found.rows[0];
    if (!student) throw new busRequests.RequestError("Student not found.", 404);

    const held = res.locals.userPermissions || [];
    const canChangeList = held.includes("transport_students");
    // Staff with Rider List keep what they always had; for a driver the two are separate.
    const canChangeStops = held.includes("transport_student_routes") || (canChangeList && req.session.userRole !== "Driver");
    const current = await db.query("SELECT active FROM transport_student_assignments WHERE organization_id = $1 AND student_id = $2", [organizationId, studentId]);
    const wasOn = Boolean(current.rows[0] && current.rows[0].active);
    const hasAccess = canChangeList ? String(body.busAccess) === "1" : wasOn;
    if (!canChangeStops && hasAccess && wasOn) {
      throw new busRequests.RequestError("You can't change this student's bus, route or stop.", 403);
    }
    if (!canChangeList && !wasOn) throw new busRequests.RequestError("This student isn't on the rider list.", 403);
    if (!hasAccess) {
      await db.query(
        `UPDATE transport_student_assignments SET active = FALSE, updated_at = NOW() WHERE organization_id = $1 AND student_id = $2`,
        [organizationId, studentId]
      );
      return { success: true, hasAccess: false, message: "Saved." };
    }

    const busId = toInt(body.busId);
    const routeId = toInt(body.routeId);
    const stopId = toInt(body.stopId);
    if (!(await verifyOrgIds(db, organizationId, busId, routeId))) {
      throw new busRequests.RequestError("That bus or route is not part of this school.");
    }
    if (stopId) {
      const stop = await db.query(`SELECT 1 FROM transport_stops WHERE stop_id = $1 AND organization_id = $2`, [stopId, organizationId]);
      if (!stop.rows[0]) throw new busRequests.RequestError("That stop is not part of this school.");
    }
    const clock = (value) => (/^\d{2}:\d{2}/.test(String(value || "")) ? String(value).slice(0, 5) : null);
    const pickupAddress = String(body.homeAddress || "").trim().slice(0, 300) || null;
    const asStop = String(body.addressAsStop) === "1";
    let place = null;
    if (pickupAddress || asStop) {
      const school = await db.query(
        `SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      place = await busRequests.locateAddress(
        pickupAddress || student.address || "",
        school.rows[0]?.organization_province,
        school.rows[0]?.organization_country
      );
    }

    await db.query(
      `INSERT INTO transport_student_assignments (
         organization_id, student_id, bus_id, route_id, stop_id, pickup_time, dropoff_time,
         home_address, home_latitude, home_longitude, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
       ON CONFLICT (organization_id, student_id) DO UPDATE SET
         bus_id = EXCLUDED.bus_id, route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id,
         pickup_time = EXCLUDED.pickup_time, dropoff_time = EXCLUDED.dropoff_time,
         home_address = EXCLUDED.home_address, home_latitude = EXCLUDED.home_latitude,
         home_longitude = EXCLUDED.home_longitude, active = TRUE, updated_at = NOW()`,
      [
        organizationId, studentId, busId, routeId, stopId, clock(body.pickupTime), clock(body.dropoffTime),
        pickupAddress, place ? place.lat : null, place ? place.lng : null,
      ]
    );

    let warning = null;
    if (asStop) {
      const address = pickupAddress || student.address;
      if (!address) warning = "Add a pickup address to use it as a stop.";
      else if (!place) warning = "Saved, but that address could not be found on the map, so no stop was added.";
      else await useAddressAsStop(db, organizationId, { ...student, address }, place, routeId);
    } else if (pickupAddress && !place) {
      warning = "Saved, but that address could not be found on the map.";
    }
    return { success: true, hasAccess: true, warning, message: "Saved." };
  }),

  bulkUpdateStudentAccessPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const classIdRaw = String(req.body.classId || "").trim();
    const isUnassignedClass = classIdRaw === "__unassigned__";
    const classId = isUnassignedClass ? null : toInt(classIdRaw);

    const toUniqueIntArray = (value) => {
      const list = Array.isArray(value) ? value : (value ? [value] : []);
      const unique = new Set();
      for (const item of list) {
        const parsed = toInt(item);
        if (parsed) unique.add(parsed);
      }
      return Array.from(unique);
    };

    const allStudentIds = toUniqueIntArray(req.body.allStudentIds);
    const selectedStudentIdsRaw = toUniqueIntArray(req.body.selectedStudentIds);
    const makeStopStudentIds = toUniqueIntArray(req.body.makeStopStudentIds);

    if (!isUnassignedClass && !classId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Class is required." });
      req.flash("error", "Class is required.");
      return res.redirect("/transportation/manage");
    }

    if (!allStudentIds.length) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "No students supplied." });
      req.flash("error", "No students supplied.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);

      const classStudentsResult = await db.query(
        `SELECT student_id
           FROM students
          WHERE organization_id = $1
            AND COALESCE(graduated, FALSE) = FALSE
            AND (
              ($2::boolean = TRUE AND class_id IS NULL)
              OR
              ($2::boolean = FALSE AND class_id = $3)
            )
            AND student_id = ANY($4::int[])`,
        [organizationId, isUnassignedClass, classId, allStudentIds]
      );

      const classStudentIds = classStudentsResult.rows.map((row) => Number(row.student_id));
      const classStudentSet = new Set(classStudentIds);
      const selectedStudentIds = selectedStudentIdsRaw.filter((id) => classStudentSet.has(id));
      const selectedSet = new Set(selectedStudentIds);
      const uncheckedStudentIds = classStudentIds.filter((id) => !selectedSet.has(id));

      // Dedicated connection: BEGIN/COMMIT on the pool can run on different
      // connections and strand writes in an open transaction.
      const txClient = await db.connect();
      try {
        await txClient.query("BEGIN");
        if (uncheckedStudentIds.length) {
          await txClient.query(
            `UPDATE transport_student_assignments
                SET active = FALSE,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND student_id = ANY($2::int[])`,
            [organizationId, uncheckedStudentIds]
          );
        }

        if (selectedStudentIds.length) {
          await txClient.query(
            `INSERT INTO transport_student_assignments (
               organization_id, student_id, active
             )
             SELECT $1, selected.student_id, TRUE
               FROM unnest($2::int[]) AS selected(student_id)
             ON CONFLICT (organization_id, student_id)
             DO UPDATE SET
               active = TRUE,
               updated_at = NOW()`,
            [organizationId, selectedStudentIds]
          );
        }

        await txClient.query("COMMIT");
      } catch (error) {
        await txClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        txClient.release();
      }

      // Best-effort, outside the main transaction: turn each checked
      // student's home address into an (unattached) stop the driver can be
      // routed through, geocoding it automatically so no one has to type
      // coordinates by hand.
      const stopTargets = makeStopStudentIds.filter((id) => selectedSet.has(id));
      let stopsCreated = 0;
      let stopsFailed = 0;
      if (stopTargets.length) {
        const orgMeta = await db.query(
          `SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1`,
          [organizationId]
        );
        const province = orgMeta.rows[0]?.organization_province;
        const country = orgMeta.rows[0]?.organization_country;

        const studentsResult = await db.query(
          `SELECT student_id, first_name, last_name, address
             FROM students
            WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND address IS NOT NULL AND TRIM(address) <> ''`,
          [organizationId, stopTargets]
        );

        const foundStudentIds = new Set(studentsResult.rows.map((row) => row.student_id));
        stopsFailed += stopTargets.filter((id) => !foundStudentIds.has(id)).length;

        for (const student of studentsResult.rows) {
          try {
            const geocoded = await geocodeAddress(student.address, province, country);
            if (!geocoded) {
              stopsFailed += 1;
              console.warn(`[Transportation] Could not geocode address for student ${student.student_id}: "${student.address}"`);
              continue;
            }

            await useAddressAsStop(db, organizationId, student, geocoded);
            stopsCreated += 1;
          } catch (error) {
            // Best-effort per student — one failed geocode shouldn't block the rest.
            stopsFailed += 1;
            console.error(`[Transportation] Failed to create stop for student ${student.student_id}:`, error.message);
          }
        }
      }

      const stopSummary = stopTargets.length
        ? ` ${stopsCreated} stop${stopsCreated === 1 ? "" : "s"} created from address${stopTargets.length === 1 ? "" : "es"}.` +
          (stopsFailed ? ` ${stopsFailed} address${stopsFailed === 1 ? "" : "es"} could not be located — check they're spelled correctly.` : "")
        : "";

      if (wantsJson(req)) {
        return res.json({
          ok: true,
          message: "Student bus access updated." + stopSummary,
          activeCount: selectedStudentIds.length,
          inactiveCount: uncheckedStudentIds.length,
          stopsCreated,
          stopsFailed,
        });
      }
      req.flash("success", "Student bus access updated." + stopSummary);
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "Unable to update student bus access." });
      }
      req.flash("error", "Unable to update student bus access.");
    }

    return res.redirect("/transportation/manage");
  },

  startTripPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;

    if (!organizationId || !userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const routeId = toInt(req.body.routeId);
    const busId = toInt(req.body.busId);

    if (!routeId || !busId) {
      return res.status(400).json({ success: false, message: "Route and bus are required." });
    }

    try {
      await ensureTransportationSchema(db);

      // Only the bus's assigned driver may start a trip on it — closes the
      // gap where any authenticated staff member could drive any bus.
      const busCheck = await db.query(
        `SELECT bus_id FROM transport_buses
          WHERE bus_id = $1 AND organization_id = $2 AND driver_user_id = $3`,
        [busId, organizationId, userId]
      );
      if (!busCheck.rows.length) {
        return res.status(403).json({ success: false, message: "You are not the assigned driver for this bus." });
      }

      const routeCheck = await db.query(
        `SELECT route_id FROM transport_routes WHERE route_id = $1 AND organization_id = $2`,
        [routeId, organizationId]
      );
      if (!routeCheck.rows.length) {
        return res.status(400).json({ success: false, message: "Route not found." });
      }

      // A driver may only start a trip on a route actually assigned to them
      // (their profile's assigned route, or any route in their weekly
      // schedule) — not just any active route in the organization.
      const assignedRouteCheck = await db.query(
        `SELECT 1 FROM transport_drivers
          WHERE organization_id = $1 AND user_id = $2 AND assigned_route_id = $3
         UNION
         SELECT 1 FROM transport_bus_schedules s
           JOIN transport_drivers d ON d.driver_id = s.driver_id AND d.organization_id = s.organization_id
          WHERE s.organization_id = $1 AND d.user_id = $2 AND s.route_id = $3`,
        [organizationId, userId, routeId]
      );
      if (!assignedRouteCheck.rows.length && !(res.locals.userPermissions || []).includes("driver_any_route")) {
        return res.status(403).json({ success: false, message: "This route is not assigned to you." });
      }

      // Close any trip this driver left running (e.g. phone died before "End trip").
      await db.query(
        `UPDATE transport_trip_sessions SET status = 'completed', ended_at = NOW()
          WHERE organization_id = $1 AND driver_user_id = $2 AND status = 'active'`,
        [organizationId, userId]
      );

      const result = await db.query(
        `INSERT INTO transport_trip_sessions (organization_id, route_id, bus_id, driver_user_id, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING trip_id, route_id, bus_id, started_at`,
        [organizationId, routeId, busId, userId]
      );

      await db.query(
        `UPDATE transport_buses
           SET status = 'on_trip', updated_at = NOW()
         WHERE organization_id = $1
           AND bus_id = $2`,
        [organizationId, busId]
      );

      liveBus.tripStarted(organizationId);
      return res.json({ success: true, trip: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to start trip." });
    }
  },

  endTripPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;

    if (!organizationId || !userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const tripId = toInt(req.body.tripId);
    if (!tripId) {
      return res.status(400).json({ success: false, message: "Trip ID is required." });
    }

    try {
      await ensureTransportationSchema(db);
      await saveLastAnswers(req, db, organizationId, userId, tripId);
      const tripResult = await db.query(
        `WITH ended AS (
           UPDATE transport_trip_sessions
              SET status = 'completed', ended_at = NOW()
            WHERE organization_id = $1
              AND trip_id = $2
              AND driver_user_id = $3
              AND status = 'active'
            RETURNING bus_id
         ), bus AS (
           UPDATE transport_buses b
              SET status = 'active', updated_at = NOW()
             FROM ended
            WHERE b.organization_id = $1 AND b.bus_id = ended.bus_id
         )
         SELECT bus_id FROM ended`,
        [organizationId, tripId, userId]
      );

      if (!tripResult.rows.length) {
        return res.status(404).json({ success: false, message: "Active trip not found." });
      }

      liveBus.tripEnded(db, organizationId, tripId).catch(() => {});
      return res.json({ success: true });
    } catch (error) {
      console.error("[Transport] End trip:", error.message);
      return res.status(500).json({ success: false, message: "Unable to end trip." });
    }
  },

  postLiveLocation: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;

    if (!organizationId || !userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const tripId = toInt(req.body.tripId);
    const latitude = toFloat(req.body.latitude);
    const longitude = toFloat(req.body.longitude);
    let speedKmh = toFloat(req.body.speedKmh);
    const rawHeading = toFloat(req.body.headingDeg);
    const headingDeg = rawHeading !== null && rawHeading >= 0 && rawHeading < 360 ? rawHeading : null;

    if (!tripId || latitude === null || longitude === null) {
      return res.status(400).json({ success: false, message: "Trip and coordinates are required." });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ success: false, message: "Coordinates out of range." });
    }
    // A school bus won't realistically exceed ~180km/h — treat anything
    // above that as a bad GPS reading rather than feed it into ETA math.
    if (speedKmh !== null && (speedKmh < 0 || speedKmh > 180)) {
      speedKmh = null;
    }

    try {
      const trip = await liveBus.tripForDriver(db, organizationId, tripId, userId);
      if (!trip) {
        return res.status(404).json({ success: false, message: "Active trip not found." });
      }
      // Not awaited: the driver's phone never waits on the database.
      liveBus.recordFix(db, organizationId, userId, trip, { latitude, longitude, speedKmh, headingDeg });

      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update live location." });
    }
  },

  getLiveByStudent: async (req, res, db) => {
    res.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const studentId = toInt(req.params.studentId || req.query.studentId);
    if (!studentId) return res.status(400).json({ success: false, message: "Student is required." });

    try {
      const snapshot = await getStudentTransportationSnapshot(db, organizationId, studentId);
      if (snapshot && snapshot.live) {
        snapshot.live.driverPhotoUrl = snapshot.live.driverPhoto ? res.locals.publicImageUrl(snapshot.live.driverPhoto) : null;
        delete snapshot.live.driverPhoto;
      }
      // While the map is open it only needs the position, not the whole route again.
      if (req.query.liveOnly === "1") return res.json({ success: true, data: { live: snapshot ? snapshot.live : null } });
      return res.json({ success: true, data: snapshot });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load live tracking." });
    }
  },

  // Every route at once, so a map with many routes asks once instead of once per route.
  getLiveRoutes: async (req, res, db) => {
    res.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ success: false, message: "Unauthorized." });
    try {
      const live = await liveBus.liveByRoute(db, organizationId);
      Object.values(live).forEach((row) => {
        row.driver_photo_url = row.driver_photo ? res.locals.publicImageUrl(row.driver_photo) : null;
        delete row.driver_photo;
      });
      return res.json({ success: true, data: live });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load live data." });
    }
  },

  getLiveByRoute: async (req, res, db) => {
    res.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const routeId = toInt(req.params.routeId || req.query.routeId);
    if (!routeId) return res.status(400).json({ success: false, message: "Route is required." });

    try {
      const live = await liveBus.liveByRoute(db, organizationId);
      const row = live[routeId] || null;
      if (row) {
        row.driver_photo_url = row.driver_photo ? res.locals.publicImageUrl(row.driver_photo) : null;
        delete row.driver_photo;
      }
      return res.json({ success: true, data: row });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load route live data." });
    }
  },
};

module.exports = {
  transportationController,
  forgetStudentBuses,
  guardianStudentIds,
  staffIdentity,
  getStudentTransportationSnapshot,
  getClassTransportationSnapshot,
};
