const {
  ensureTransportationSchema,
  getTransportationIntegrationStatus,
} = require("../utils/transportation");
const { uploadToS3 } = require("../middleware/s3Upload");
const transportBoarding = require("../utils/transportBoarding");
const features = require("../utils/shards/features");

function toFloat(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveAssignedRoutes(db, organizationId, driverProfile, anyRoute = false) {
  const routeIdCandidates = new Set();
  if (anyRoute) {
    const all = await db.query("SELECT route_id FROM transport_routes WHERE organization_id = $1", [organizationId]);
    all.rows.forEach((row) => routeIdCandidates.add(Number(row.route_id)));
  }
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

// Everyone this driver might come across, split into who has bus access on this driver's
// bus or routes (pick up) and who doesn't (don't pick up).
async function resolveMyStudents(db, organizationId, userId, driverBus, routeIds, withDetails) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.student_id)
            s.student_id, s.first_name, s.last_name, s.address, c.class_name,
            tsa.assignment_id, tsa.bus_id, tsa.route_id, tsa.stop_id, tsa.home_address, st.stop_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
       LEFT JOIN transport_student_assignments tsa
         ON tsa.student_id = s.student_id AND tsa.organization_id = s.organization_id AND tsa.active = TRUE
       LEFT JOIN transport_stops st ON st.stop_id = tsa.stop_id AND st.organization_id = s.organization_id
      WHERE s.organization_id = $1
        AND COALESCE(s.graduated, FALSE) = FALSE
        AND (
          ($2::int IS NOT NULL AND tsa.bus_id = $2)
          OR tsa.route_id = ANY($3::int[])
          OR s.class_id IN (SELECT class_id FROM user_classes WHERE user_id = $4)
        )
      ORDER BY s.student_id`,
    [organizationId, driverBus ? driverBus.bus_id : null, routeIds, userId]
  );
  const busId = driverBus ? Number(driverBus.bus_id) : null;
  const routes = new Set(routeIds.map(Number));
  const students = rows.map((row) => ({
    id: Number(row.student_id),
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    lastName: row.last_name || "",
    className: row.class_name || "",
    hasAccess: Boolean(row.assignment_id) && ((busId !== null && Number(row.bus_id) === busId) || routes.has(Number(row.route_id))),
    otherBus: Boolean(row.assignment_id),
    routeId: row.route_id === null ? null : Number(row.route_id),
    stopId: row.stop_id === null ? null : Number(row.stop_id),
    stopName: row.stop_name || "",
    address: withDetails ? row.home_address || row.address || "" : "",
    parentPhone: "",
  })).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.name.localeCompare(b.name));
  if (withDetails && students.length) {
    const phones = await db.query(
      `SELECT DISTINCT ON (gs.student_id) gs.student_id, gp.phone
         FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
        WHERE gs.student_id = ANY($1::int[]) AND gp.organization_id = $2 AND COALESCE(gp.phone, '') <> ''
        ORDER BY gs.student_id, gp.guardian_id`,
      [students.map((student) => student.id), organizationId]
    ).catch(() => ({ rows: [] }));
    const byStudent = new Map(phones.rows.map((row) => [Number(row.student_id), row.phone]));
    students.forEach((student) => { student.parentPhone = byStudent.get(student.id) || ""; });
  }
  return students;
}

const { REPORT_TYPES } = require("../utils/transportReports");

const driverController = {
  dashboardGet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const userId = req.session.userId || (req.session.user && req.session.user.user_id);
    const driverProfile = req.driverProfile || null;

    try {
      await ensureTransportationSchema(db);
      // With transportation switched off there are no trips: the page says so and shows no bus,
      // route or riders, instead of a trip the school would never see.
      const transportationOff = !(await getTransportationIntegrationStatus(db, organizationId)).activated;
      const driverBus = transportationOff ? null : (req.driverBus || null);

      const held = res.locals.userPermissions || [];
      const assignedRoutes = transportationOff ? [] : await resolveAssignedRoutes(db, organizationId, driverProfile, held.includes("driver_any_route"));
      const [schoolResult, students, integration] = await Promise.all([
        db.query(
          `SELECT organization_address, geo_lat, geo_lng, transportation_distance_unit
             FROM organizations WHERE organization_id = $1 LIMIT 1`,
          [organizationId]
        ),
        transportationOff ? [] : resolveMyStudents(db, organizationId, userId, driverBus, assignedRoutes.map((route) => route.route_id), held.includes("driver_student_details")),
        getTransportationIntegrationStatus(db, organizationId),
      ]);

      // Pickup & emergency details the school shares with drivers (feature "family_sharing"),
      // for this driver's own riders only, with the driver permission "Pickup & Emergency".
      if (held.includes("driver_family_details") && require("../utils/shards/features").isOn("family_sharing", { organizationId: Number(organizationId) })) {
        const riders = students.filter((student) => student.hasAccess).map((student) => student.id);
        const family = await require("../utils/contacts").familyDetailsForStudents(db, Number(organizationId), riders, "drivers").catch(() => new Map());
        students.forEach((student) => {
          const people = (family.get(student.id) || [])
            .map((p) => ({ name: p.name, relationship: p.relationship, items: [].concat(...p.sections.map((sec) => sec.items)) }))
            .filter((p) => p.items.length);
          if (people.length) student.family = people;
        });
      }

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
        disableMainZoom: true,
        driverBus,
        driverProfile,
        driverPhotoUrl: (driverProfile && driverProfile.image_url) || req.session.profileImageUrl || null,
        activeTrip,
        boardingOn: features.isOn("bus_boarding", { organizationId }),
        tripBoardings: activeTrip && features.isOn("bus_boarding", { organizationId }) ? await transportBoarding.tripBoardings(db, organizationId, activeTrip.trip_id) : [],
        lastLocation,
        assignedRoutes,
        students,
        reportTypes: REPORT_TYPES,
        schoolAddress: schoolResult.rows[0]?.organization_address || null,
        schoolLatitude: toFloat(schoolResult.rows[0]?.geo_lat),
        schoolLongitude: toFloat(schoolResult.rows[0]?.geo_lng),
        distanceUnit: schoolResult.rows[0]?.transportation_distance_unit === "mi" ? "mi" : "km",
        integration,
        transportationOff,
        messages: req.flash(),
      });
    } catch (error) {
      req.flash("error", "Unable to load your dashboard right now.");
      return res.render("driver/dashboard", {
        title: "Driver Dashboard",
        disableMainZoom: true,
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
        integration: {
          activated: false,
          mapProvider: "openstreetmap",
          googleMapsNavActivated: false,
          appleMapsNavActivated: false,
          shouldShowFeatures: false,
        },
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
