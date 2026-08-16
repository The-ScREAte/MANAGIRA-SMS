const {
  ensureTransportationSchema,
  getTransportationIntegrationStatus,
} = require("../utils/transportation");
const { uploadToS3 } = require("../middleware/s3Upload");

function toFloat(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveAssignedRoutes(db, organizationId, driverProfile) {
  const routeIdCandidates = new Set();
  if (driverProfile && driverProfile.assigned_route_id) {
    routeIdCandidates.add(Number(driverProfile.assigned_route_id));
  }

  if (driverProfile && driverProfile.driver_id) {
    const scheduledRoutes = await db.query(
      `SELECT DISTINCT route_id FROM transport_bus_schedules
        WHERE organization_id = $1 AND driver_id = $2 AND route_id IS NOT NULL`,
      [organizationId, driverProfile.driver_id]
    );
    scheduledRoutes.rows.forEach((row) => routeIdCandidates.add(Number(row.route_id)));
  }

  if (!routeIdCandidates.size) return [];

  const routeIds = Array.from(routeIdCandidates);
  const [routesResult, stopsResult] = await Promise.all([
    db.query(
      `SELECT route_id, route_name, route_code, destination_address,
              destination_latitude, destination_longitude, use_school_destination
         FROM transport_routes
        WHERE organization_id = $1 AND route_id = ANY($2::int[])
        ORDER BY route_name ASC`,
      [organizationId, routeIds]
    ),
    db.query(
      `SELECT stop_id, route_id, stop_name, stop_address, latitude, longitude, stop_order
         FROM transport_stops
        WHERE organization_id = $1 AND route_id = ANY($2::int[])
        ORDER BY route_id ASC, stop_order ASC`,
      [organizationId, routeIds]
    ),
  ]);

  const stopsByRoute = new Map();
  stopsResult.rows.forEach((stop) => {
    const list = stopsByRoute.get(stop.route_id) || [];
    list.push(stop);
    stopsByRoute.set(stop.route_id, list);
  });

  return routesResult.rows.map((route) => ({
    ...route,
    stops: stopsByRoute.get(route.route_id) || [],
  }));
}

async function resolveMyStudents(db, organizationId, userId, driverBus) {
  // "My Students": every student riding the driver's assigned bus, plus
  // every student in any class explicitly assigned to this driver.
  const busStudentsResult = driverBus
    ? await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, c.class_name,
                tsa.home_latitude, tsa.home_longitude, tsa.home_address,
                st.stop_name, st.latitude AS stop_latitude, st.longitude AS stop_longitude
           FROM transport_student_assignments tsa
           JOIN students s
             ON s.student_id = tsa.student_id AND s.organization_id = tsa.organization_id
           LEFT JOIN classes c
             ON c.class_id = s.class_id AND c.organization_id = s.organization_id
           LEFT JOIN transport_stops st
             ON st.stop_id = tsa.stop_id AND st.organization_id = tsa.organization_id
          WHERE tsa.organization_id = $1
            AND tsa.bus_id = $2
            AND tsa.active = TRUE
            AND COALESCE(s.graduated, FALSE) = FALSE
          ORDER BY s.last_name ASC, s.first_name ASC`,
        [organizationId, driverBus.bus_id]
      )
    : { rows: [] };

  const classStudentsResult = await db.query(
    `SELECT DISTINCT s.student_id, s.first_name, s.last_name, c.class_name,
            NULL::numeric AS home_latitude, NULL::numeric AS home_longitude, NULL::text AS home_address,
            NULL::text AS stop_name, NULL::numeric AS stop_latitude, NULL::numeric AS stop_longitude
       FROM user_classes uc
       JOIN students s
         ON s.class_id = uc.class_id AND s.organization_id = $2
       LEFT JOIN classes c
         ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE uc.user_id = $1
        AND COALESCE(s.graduated, FALSE) = FALSE`,
    [userId, organizationId]
  );

  const studentMap = new Map();
  [...busStudentsResult.rows, ...classStudentsResult.rows].forEach((student) => {
    if (!studentMap.has(student.student_id)) studentMap.set(student.student_id, student);
  });
  return Array.from(studentMap.values()).sort((a, b) =>
    String(a.last_name || "").localeCompare(String(b.last_name || ""))
  );
}

const driverController = {
  dashboardGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.userId || (req.session.user && req.session.user.user_id);
    const driverBus = req.driverBus || null;
    const driverProfile = req.driverProfile || null;

    try {
      await ensureTransportationSchema(db);

      const [assignedRoutes, schoolResult, students] = await Promise.all([
        resolveAssignedRoutes(db, organizationId, driverProfile),
        db.query(
          `SELECT organization_address, geo_lat, geo_lng, transportation_distance_unit
             FROM organizations WHERE organization_id = $1 LIMIT 1`,
          [organizationId]
        ),
        resolveMyStudents(db, organizationId, userId, driverBus),
      ]);

      let activeTrip = null;
      let lastLocation = null;

      if (driverBus) {
        const tripResult = await db.query(
          `SELECT trip_id, route_id, bus_id, status, started_at
             FROM transport_trip_sessions
            WHERE organization_id = $1 AND bus_id = $2 AND driver_user_id = $3 AND status = 'active'
            ORDER BY started_at DESC
            LIMIT 1`,
          [organizationId, driverBus.bus_id, userId]
        );
        activeTrip = tripResult.rows[0] || null;

        if (activeTrip) {
          const locationResult = await db.query(
            `SELECT latitude, longitude, speed_kmh, heading_deg, recorded_at
               FROM transport_live_locations
              WHERE organization_id = $1 AND trip_id = $2
              ORDER BY recorded_at DESC
              LIMIT 1`,
            [organizationId, activeTrip.trip_id]
          );
          lastLocation = locationResult.rows[0] || null;
        }
      }

      return res.render("driver/dashboard", {
        title: "Driver Dashboard",
        driverBus,
        driverProfile,
        driverPhotoUrl: (driverProfile && driverProfile.image_url) || req.session.profileImageUrl || null,
        activeTrip,
        lastLocation,
        assignedRoutes,
        students,
        schoolAddress: schoolResult.rows[0]?.organization_address || null,
        schoolLatitude: toFloat(schoolResult.rows[0]?.geo_lat),
        schoolLongitude: toFloat(schoolResult.rows[0]?.geo_lng),
        distanceUnit: schoolResult.rows[0]?.transportation_distance_unit === "mi" ? "mi" : "km",
        messages: req.flash(),
      });
    } catch (error) {
      req.flash("error", "Unable to load your dashboard right now.");
      return res.render("driver/dashboard", {
        title: "Driver Dashboard",
        driverBus: null,
        driverProfile: null,
        driverPhotoUrl: null,
        activeTrip: null,
        lastLocation: null,
        assignedRoutes: [],
        students: [],
        schoolAddress: null,
        schoolLatitude: null,
        schoolLongitude: null,
        distanceUnit: "km",
        messages: req.flash(),
      });
    }
  },

  settingsGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.userId || (req.session.user && req.session.user.user_id);

    try {
      const userResult = await db.query(
        `SELECT first_name, last_name, email, profile_image_url FROM users
          WHERE user_id = $1 AND organization_id = $2`,
        [userId, organizationId]
      );

      return res.render("driver/settings", {
        title: "Driver Settings",
        user: userResult.rows[0] || {},
        driverProfile: req.driverProfile || null,
        messages: req.flash(),
      });
    } catch (error) {
      req.flash("error", "Unable to load settings right now.");
      return res.redirect("/driver/dashboard");
    }
  },

  settingsPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.userId || (req.session.user && req.session.user.user_id);
    const phone = String(req.body.phone || "").trim() || null;

    try {
      await ensureTransportationSchema(db);

      let imageUrl = null;
      if (req.file) {
        const key = `images/transportation/drivers/${organizationId}/${Date.now()}_${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, key);
      }

      if (imageUrl) {
        await db.query(
          `UPDATE users SET profile_image_url = $1, updated_at = NOW() WHERE user_id = $2 AND organization_id = $3`,
          [imageUrl, userId, organizationId]
        );
        req.session.profileImageUrl = imageUrl;
      }

      const existingProfile = await db.query(
        `SELECT driver_id FROM transport_drivers WHERE user_id = $1 AND organization_id = $2`,
        [userId, organizationId]
      );
      if (existingProfile.rows.length) {
        await db.query(
          `UPDATE transport_drivers
              SET phone = $1, image_url = COALESCE($2, image_url), updated_at = NOW()
            WHERE user_id = $3 AND organization_id = $4`,
          [phone, imageUrl, userId, organizationId]
        );
      }

      req.flash("success", "Settings updated.");
    } catch (error) {
      req.flash("error", "Unable to update settings right now.");
    }

    return res.redirect("/driver/settings");
  },
};

module.exports = { driverController };
