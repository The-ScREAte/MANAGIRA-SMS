const {
  ensureTransportationSchema,
  getTransportationIntegrationStatus,
  setTransportationMapProvider,
  normalizeMapProvider,
  suggestNearestStop,
} = require("../utils/transportation");
const { uploadToS3 } = require("../middleware/s3Upload");

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
    `SELECT organization_address, geo_lat, geo_lng
       FROM organizations
      WHERE organization_id = $1
      LIMIT 1`,
    [organizationId]
  );
  const row = result.rows[0] || {};
  const address = String(row.organization_address || "").trim() || null;
  return {
    address,
    latitude: toFloat(row.geo_lat),
    longitude: toFloat(row.geo_lng),
  };
}

async function getStudentTransportationSnapshot(db, organizationId, studentId) {
  await ensureTransportationSchema(db);
  const school = await getOrganizationDestination(db, organizationId).catch(() => ({
    address: null,
    latitude: null,
    longitude: null,
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

  const tripResult = await db.query(
    `SELECT
       trip.trip_id,
       trip.status,
       trip.started_at,
       live.latitude,
       live.longitude,
       live.speed_kmh,
       live.heading_deg,
       live.recorded_at
     FROM transport_trip_sessions trip
     LEFT JOIN LATERAL (
       SELECT latitude, longitude, speed_kmh, heading_deg, recorded_at
       FROM transport_live_locations
       WHERE organization_id = trip.organization_id
         AND trip_id = trip.trip_id
       ORDER BY recorded_at DESC
       LIMIT 1
     ) live ON TRUE
     WHERE trip.organization_id = $1
       AND trip.status = 'active'
       AND (
         (trip.bus_id IS NOT NULL AND trip.bus_id = $2)
         OR
         (trip.route_id IS NOT NULL AND trip.route_id = $3)
       )
     ORDER BY trip.started_at DESC
     LIMIT 1`,
    [organizationId, row.bus_id || null, row.route_id || null]
  );

  const live = tripResult.rows[0] || null;
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

  return {
    assignmentId: row.assignment_id,
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
          recordedAt: live.recorded_at,
          startedAt: live.started_at,
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

    try {
      await ensureTransportationSchema(db);
      const integration = await getTransportationIntegrationStatus(db, organizationId);

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
          `SELECT d.driver_id, d.driver_name, d.phone, d.email, d.license_number, d.image_url,
            d.status, d.user_id,
                  d.assigned_bus_id, d.assigned_route_id,
                  b.bus_number,
                  tr.route_name,
                  COALESCE(ds.schedule_count, 0) AS schedule_count
             FROM transport_drivers d
             LEFT JOIN transport_buses b
               ON b.bus_id = d.assigned_bus_id
              AND b.organization_id = d.organization_id
             LEFT JOIN transport_routes tr
               ON tr.route_id = d.assigned_route_id
              AND tr.organization_id = d.organization_id
             LEFT JOIN (
               SELECT organization_id, driver_id, COUNT(*)::INT AS schedule_count
                 FROM transport_bus_schedules
                GROUP BY organization_id, driver_id
             ) ds
               ON ds.organization_id = d.organization_id
              AND ds.driver_id = d.driver_id
            WHERE d.organization_id = $1
            ORDER BY d.driver_name ASC`,
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
          `SELECT organization_address, geo_lat, geo_lng
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

      return res.render("transportation/manage", {
        title: "Transportation Management",
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

  updateSchoolDestinationPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, message: "Unauthorized." });
      return res.redirect("/account/login");
    }

    const schoolAddress = String(req.body.schoolAddress || "").trim();
    const requestedLatitudeRaw = String(req.body.schoolLatitude || "").trim();
    const requestedLongitudeRaw = String(req.body.schoolLongitude || "").trim();
    const requestedLatitude = toFloat(requestedLatitudeRaw);
    const requestedLongitude = toFloat(requestedLongitudeRaw);
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
      const schoolLatitude = requestedLatitudeRaw ? requestedLatitude : currentDestination.latitude;
      const schoolLongitude = requestedLongitudeRaw ? requestedLongitude : currentDestination.longitude;

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
    const driverUserId = toInt(req.body.driverUserId);
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
    const driverUserId = toInt(req.body.driverUserId);
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

  createDriverPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    const driverName = String(req.body.driverName || "").trim();
    const phone = String(req.body.phone || "").trim();
    const email = String(req.body.email || "").trim() || null;
    const licenseNumber = String(req.body.licenseNumber || "").trim() || null;
    const userId = toInt(req.body.userId);
    const assignedBusId = toInt(req.body.assignedBusId);
    const assignedRouteId = toInt(req.body.assignedRouteId);
    const status = normalizeScheduleStatus(req.body.status, "active");

    if (!driverName) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message: "Driver name is required." });
      }
      req.flash("error", "Driver name is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      let imageUrl = null;
      if (req.file) {
        const key = `images/transportation/drivers/${organizationId}/${Date.now()}_${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, key);
      }

      await db.query(
        `INSERT INTO transport_drivers (
           organization_id, user_id, driver_name, phone, email, license_number, image_url,
           assigned_bus_id, assigned_route_id, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          organizationId,
          userId,
          driverName,
          phone || null,
          email,
          licenseNumber,
          imageUrl,
          assignedBusId,
          assignedRouteId,
          status,
        ]
      );
      if (wantsJson(req)) {
        return res.json({ ok: true, message: "Driver saved." });
      }
      req.flash("success", "Driver saved.");
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "Unable to save driver." });
      }
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

    const driverId = toInt(req.params.driverId || req.body.driverId);
    const driverName = String(req.body.driverName || "").trim();
    const phone = String(req.body.phone || "").trim() || null;
    const email = String(req.body.email || "").trim() || null;
    const licenseNumber = String(req.body.licenseNumber || "").trim() || null;
    const userId = toInt(req.body.userId);
    const assignedBusId = toInt(req.body.assignedBusId);
    const assignedRouteId = toInt(req.body.assignedRouteId);
    const status = normalizeScheduleStatus(req.body.status, "active");

    if (!driverId || !driverName) {
      const message = !driverId ? "Driver id is required." : "Driver name is required.";
      if (wantsJson(req)) return res.status(400).json({ ok: false, message });
      req.flash("error", message);
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);

      let imageSql = "";
      const params = [
        organizationId,
        driverId,
        driverName,
        phone,
        email,
        licenseNumber,
        userId,
        assignedBusId,
        assignedRouteId,
        status,
      ];

      if (req.file) {
        const key = `images/transportation/drivers/${organizationId}/${Date.now()}_${req.file.originalname}`;
        const imageUrl = await uploadToS3(req.file, key);
        params.push(imageUrl);
        imageSql = ", image_url = $11";
      }

      const result = await db.query(
        `UPDATE transport_drivers
            SET driver_name = $3,
                phone = $4,
                email = $5,
                license_number = $6,
                user_id = $7,
                assigned_bus_id = $8,
                assigned_route_id = $9,
                status = $10,
                updated_at = NOW()
                ${imageSql}
          WHERE organization_id = $1
            AND driver_id = $2
          RETURNING driver_id`,
        params
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Driver not found." });
        req.flash("error", "Driver not found.");
        return res.redirect("/transportation/manage");
      }

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

    const driverId = toInt(req.params.driverId || req.body.driverId);
    if (!driverId) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Driver id is required." });
      req.flash("error", "Driver id is required.");
      return res.redirect("/transportation/manage");
    }

    try {
      await ensureTransportationSchema(db);
      const result = await db.query(
        `DELETE FROM transport_drivers
          WHERE organization_id = $1
            AND driver_id = $2
          RETURNING driver_id`,
        [organizationId, driverId]
      );

      if (!result.rows.length) {
        if (wantsJson(req)) return res.status(404).json({ ok: false, message: "Driver not found." });
        req.flash("error", "Driver not found.");
        return res.redirect("/transportation/manage");
      }

      if (wantsJson(req)) return res.json({ ok: true, message: "Driver deleted." });
      req.flash("success", "Driver deleted.");
    } catch (error) {
      if (wantsJson(req)) return res.status(500).json({ ok: false, message: "Unable to delete driver." });
      req.flash("error", "Unable to delete driver.");
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
      const destinationLatitude = useSchoolDestination
        ? orgDestination.latitude
        : (requestedDestinationLatitude !== null ? requestedDestinationLatitude : orgDestination.latitude);
      const destinationLongitude = useSchoolDestination
        ? orgDestination.longitude
        : (requestedDestinationLongitude !== null ? requestedDestinationLongitude : orgDestination.longitude);
      await db.query(
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
           updated_at = NOW()`,
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
      const destinationLatitude = useSchoolDestination
        ? orgDestination.latitude
        : (requestedDestinationLatitude !== null ? requestedDestinationLatitude : orgDestination.latitude);
      const destinationLongitude = useSchoolDestination
        ? orgDestination.longitude
        : (requestedDestinationLongitude !== null ? requestedDestinationLongitude : orgDestination.longitude);
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

    if (!routeId || !stopName) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: "Route and stop name are required." });
      req.flash("error", "Route and stop name are required.");
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

    if (!stopId || !routeId || !stopName) {
      const message = !stopId
        ? "Stop id is required."
        : !routeId
          ? "Route is required."
          : "Stop name is required.";
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

      await db.query("BEGIN");
      try {
        if (uncheckedStudentIds.length) {
          await db.query(
            `UPDATE transport_student_assignments
                SET active = FALSE,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND student_id = ANY($2::int[])`,
            [organizationId, uncheckedStudentIds]
          );
        }

        if (selectedStudentIds.length) {
          await db.query(
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

        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }

      if (wantsJson(req)) {
        return res.json({
          ok: true,
          message: "Student bus access updated.",
          activeCount: selectedStudentIds.length,
          inactiveCount: uncheckedStudentIds.length,
        });
      }
      req.flash("success", "Student bus access updated.");
    } catch (error) {
      if (wantsJson(req)) {
        return res.status(500).json({ ok: false, message: "Unable to update student bus access." });
      }
      req.flash("error", "Unable to update student bus access.");
    }

    return res.redirect("/transportation/manage");
  },

  driverMobileGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.redirect("/account/login");

    const userId = req.session.user?.user_id || req.session.userId || null;

    try {
      await ensureTransportationSchema(db);

      const [routes, buses, activeTrip] = await Promise.all([
        db.query(
          `SELECT route_id, route_name
             FROM transport_routes
            WHERE organization_id = $1
              AND route_status = 'active'
            ORDER BY route_name ASC`,
          [organizationId]
        ),
        db.query(
          `SELECT bus_id, bus_number
             FROM transport_buses
            WHERE organization_id = $1
              AND status IN ('active', 'on_trip')
            ORDER BY bus_number ASC`,
          [organizationId]
        ),
        db.query(
          `SELECT trip_id, route_id, bus_id, status, started_at
             FROM transport_trip_sessions
            WHERE organization_id = $1
              AND driver_user_id = $2
              AND status = 'active'
            ORDER BY started_at DESC
            LIMIT 1`,
          [organizationId, userId]
        ),
      ]);

      return res.render("transportation/driverMobile", {
        title: "Driver Transportation",
        routes: routes.rows,
        buses: buses.rows,
        activeTrip: activeTrip.rows[0] || null,
        messages: req.flash(),
      });
    } catch (error) {
      req.flash("error", "Unable to load driver transportation page.");
      return res.redirect("/common/orgDashboard");
    }
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
      const tripResult = await db.query(
        `UPDATE transport_trip_sessions
            SET status = 'completed', ended_at = NOW()
          WHERE organization_id = $1
            AND trip_id = $2
            AND driver_user_id = $3
            AND status = 'active'
          RETURNING bus_id`,
        [organizationId, tripId, userId]
      );

      if (!tripResult.rows.length) {
        return res.status(404).json({ success: false, message: "Active trip not found." });
      }

      const busId = tripResult.rows[0].bus_id;
      if (busId) {
        await db.query(
          `UPDATE transport_buses
              SET status = 'active', updated_at = NOW()
            WHERE organization_id = $1
              AND bus_id = $2`,
          [organizationId, busId]
        );
      }

      return res.json({ success: true });
    } catch (error) {
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
    const speedKmh = toFloat(req.body.speedKmh);
    const headingDeg = toFloat(req.body.headingDeg);

    if (!tripId || latitude === null || longitude === null) {
      return res.status(400).json({ success: false, message: "Trip and coordinates are required." });
    }

    try {
      await ensureTransportationSchema(db);
      const trip = await db.query(
        `SELECT trip_id, route_id, bus_id
           FROM transport_trip_sessions
          WHERE organization_id = $1
            AND trip_id = $2
            AND driver_user_id = $3
            AND status = 'active'
          LIMIT 1`,
        [organizationId, tripId, userId]
      );

      if (!trip.rows.length) {
        return res.status(404).json({ success: false, message: "Active trip not found." });
      }

      const record = trip.rows[0];
      await db.query(
        `INSERT INTO transport_live_locations (
           organization_id, trip_id, route_id, bus_id, driver_user_id,
           latitude, longitude, speed_kmh, heading_deg
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          organizationId,
          record.trip_id,
          record.route_id,
          record.bus_id,
          userId,
          latitude,
          longitude,
          speedKmh,
          headingDeg,
        ]
      );

      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update live location." });
    }
  },

  getLiveByStudent: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const studentId = toInt(req.params.studentId || req.query.studentId);
    if (!studentId) return res.status(400).json({ success: false, message: "Student is required." });

    try {
      const snapshot = await getStudentTransportationSnapshot(db, organizationId, studentId);
      return res.json({ success: true, data: snapshot });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load live tracking." });
    }
  },

  getLiveByRoute: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    if (!organizationId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const routeId = toInt(req.params.routeId || req.query.routeId);
    if (!routeId) return res.status(400).json({ success: false, message: "Route is required." });

    try {
      await ensureTransportationSchema(db);
      const rows = await db.query(
        `SELECT
           l.latitude,
           l.longitude,
           l.speed_kmh,
           l.heading_deg,
           l.recorded_at,
           t.trip_id,
           t.bus_id,
           b.bus_number,
           t.started_at
         FROM transport_trip_sessions t
         JOIN transport_live_locations l
           ON l.trip_id = t.trip_id
          AND l.organization_id = t.organization_id
         LEFT JOIN transport_buses b
           ON b.bus_id = t.bus_id
          AND b.organization_id = t.organization_id
         WHERE t.organization_id = $1
           AND t.route_id = $2
           AND t.status = 'active'
         ORDER BY l.recorded_at DESC
         LIMIT 1`,
        [organizationId, routeId]
      );

      return res.json({ success: true, data: rows.rows[0] || null });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load route live data." });
    }
  },
};

module.exports = {
  transportationController,
  getStudentTransportationSnapshot,
  getClassTransportationSnapshot,
};
