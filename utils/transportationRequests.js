// Bus requests: a teacher or parent asks for a bus for a student without one, picks
// from the closest routes and stops, and the school approves or declines on the
// Transportation page. Approving is what actually puts the student on a bus.
const { BoundedMap } = require("./boundedMap");
const { geocodeAddress } = require("./geocode");
const { calculateDistanceKm } = require("./transportation");

const OPEN_STATUSES = ["pending"];
const CLOSED_STATUSES = ["approved", "declined", "cancelled"];
const MAX_ADDRESS_LENGTH = 300;
const MAX_NOTE_LENGTH = 300;
const PAGE_SIZE = 100;

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function statusesFor(bucket) {
  return bucket === "old" ? CLOSED_STATUSES : OPEN_STATUSES;
}

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function validCoordinate(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (lat === null || lat === undefined || lat === "" || lng === null || lng === undefined || lng === "") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

// One address lookup at a time, about one a second (the free geocoder's rule), and
// each address looked up only once however many people search for it.
const located = new BoundedMap(2000);
const LOCATE_TTL_MS = 24 * 60 * 60 * 1000;
const LOCATE_MISS_TTL_MS = 5 * 60 * 1000;
const LOCATE_GAP_MS = 1100;
let locateQueue = Promise.resolve();
const locating = new Map();

function locateAddress(address, province, country, lookup = geocodeAddress) {
  const key = [address, province, country].map((part) => String(part || "").trim().toLowerCase()).join("|");
  const hit = located.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (locating.has(key)) return locating.get(key);
  const job = locateQueue.then(async () => {
    const value = await lookup(address, province, country).catch(() => null);
    located.set(key, { value, expires: Date.now() + (value ? LOCATE_TTL_MS : LOCATE_MISS_TTL_MS) });
    await new Promise((resolve) => setTimeout(resolve, lookup === geocodeAddress ? LOCATE_GAP_MS : 0));
    return value;
  });
  locateQueue = job.catch(() => null);
  locating.set(key, job);
  job.finally(() => locating.delete(key)).catch(() => {});
  return job;
}

// A stop made from one student's home ("Ama's Stop") is that family's address: it
// is never offered to anyone else.
function isPrivateStop(stop) {
  return /'s stop$/i.test(String(stop.stop_name || "").trim());
}

// The closest stops, at most `perRoute` from any one route, nearest first.
function rankOptions(stops, lat, lng, { perRoute = 2, limit = 4 } = {}) {
  const usedByRoute = new Map();
  const ranked = [];
  stops
    .filter((stop) => !isPrivateStop(stop))
    .map((stop) => ({ stop, distanceKm: calculateDistanceKm(lat, lng, stop.latitude, stop.longitude) }))
    .filter((row) => row.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .forEach(({ stop, distanceKm }) => {
      const used = usedByRoute.get(stop.route_id) || 0;
      if (used >= perRoute || ranked.length >= limit) return;
      usedByRoute.set(stop.route_id, used + 1);
      ranked.push({
        routeId: Number(stop.route_id),
        routeName: String(stop.route_name || "Route"),
        stopId: Number(stop.stop_id),
        stopName: String(stop.stop_name || "Stop"),
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        pickupTime: stop.pickup_time || null,
        busNumber: stop.bus_number || null,
        distanceKm: Number(distanceKm.toFixed(3)),
      });
    });
  return ranked;
}

async function closestOptions(db, organizationId, lat, lng, options) {
  const { rows } = await db.query(
    `SELECT st.stop_id, st.route_id, st.stop_name, st.latitude, st.longitude, st.pickup_time,
            tr.route_name, bus.bus_number
       FROM transport_stops st
       JOIN transport_routes tr
         ON tr.route_id = st.route_id AND tr.organization_id = st.organization_id
       LEFT JOIN LATERAL (
         SELECT b.bus_number
           FROM transport_bus_schedules sc
           JOIN transport_buses b ON b.bus_id = sc.bus_id AND b.organization_id = sc.organization_id
          WHERE sc.organization_id = st.organization_id AND sc.route_id = st.route_id AND sc.status = 'active'
          LIMIT 1
       ) bus ON TRUE
      WHERE st.organization_id = $1
        AND st.latitude IS NOT NULL AND st.longitude IS NOT NULL
        AND COALESCE(tr.route_status, 'active') = 'active'`,
    [organizationId]
  );
  return rankOptions(rows, lat, lng, options);
}

async function schoolPlace(db, organizationId) {
  const { rows } = await db.query(
    `SELECT organization_province, organization_country, geo_lat, geo_lng, transportation_distance_unit
       FROM organizations WHERE organization_id = $1`,
    [organizationId]
  );
  const row = rows[0] || {};
  return {
    province: row.organization_province || null,
    country: row.organization_country || null,
    center: validCoordinate(row.geo_lat, row.geo_lng),
    unit: row.transportation_distance_unit === "mi" ? "mi" : "km",
  };
}

// Where the request form starts: the student, the map's center, and any request already waiting.
async function requestStart(db, organizationId, studentId) {
  const [student, school, pending, access] = await Promise.all([
    db.query(
      `SELECT student_id, first_name, last_name, address FROM students
        WHERE student_id = $1 AND organization_id = $2 AND COALESCE(graduated, FALSE) = FALSE`,
      [studentId, organizationId]
    ),
    schoolPlace(db, organizationId),
    listRequests(db, organizationId, { bucket: "new", studentId }),
    db.query(
      `SELECT 1 FROM transport_student_assignments WHERE organization_id = $1 AND student_id = $2 AND active = TRUE`,
      [organizationId, studentId]
    ),
  ]);
  if (!student.rows[0]) throw new RequestError("Student not found.", 404);
  const row = student.rows[0];
  return {
    student: {
      id: Number(row.student_id),
      firstName: row.first_name || "",
      name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
      address: row.address || "",
    },
    center: school.center,
    unit: school.unit,
    hasAccess: access.rows.length > 0,
    pending: pending[0] || null,
  };
}

async function findOptions(db, organizationId, { address, lat, lng }) {
  const school = await schoolPlace(db, organizationId);
  const cleanAddress = cleanText(address, MAX_ADDRESS_LENGTH);
  const place = validCoordinate(lat, lng)
    || (cleanAddress ? await locateAddress(cleanAddress, school.province, school.country) : null);
  if (!place) return { located: false, unit: school.unit, options: [] };
  return {
    located: true,
    unit: school.unit,
    lat: place.lat,
    lng: place.lng,
    options: await closestOptions(db, organizationId, place.lat, place.lng),
  };
}

const REQUEST_COLUMNS = `
  r.request_id, r.student_id, r.status, r.requester_type, r.requester_name, r.guardian_id,
  r.address, r.latitude, r.longitude, r.route_id, r.stop_id, r.distance_km,
  r.decided_by_name, r.decided_at, r.decision_note, r.created_at,
  s.first_name, s.last_name, c.class_name, tr.route_name, ts.stop_name`;

function publicRequest(row) {
  return {
    id: Number(row.request_id),
    studentId: Number(row.student_id),
    studentName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    className: row.class_name || null,
    status: row.status,
    requesterType: row.requester_type,
    requesterName: row.requester_name || null,
    address: row.address || "",
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    routeId: row.route_id === null ? null : Number(row.route_id),
    routeName: row.route_name || null,
    stopId: row.stop_id === null ? null : Number(row.stop_id),
    stopName: row.stop_name || null,
    distanceKm: row.distance_km === null ? null : Number(row.distance_km),
    decidedBy: row.decided_by_name || null,
    decidedAt: row.decided_at || null,
    decisionNote: row.decision_note || null,
    createdAt: row.created_at,
  };
}

async function listRequests(db, organizationId, { bucket = "new", guardianStudentIds = null, studentId = null } = {}) {
  const params = [organizationId, statusesFor(bucket)];
  let scope = "";
  if (studentId) {
    params.push(studentId);
    scope += ` AND r.student_id = $${params.length}`;
  }
  if (guardianStudentIds) {
    params.push(guardianStudentIds);
    scope += ` AND r.student_id = ANY($${params.length}::int[])`;
  }
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}
       FROM transport_student_requests r
       JOIN students s ON s.student_id = r.student_id AND s.organization_id = r.organization_id
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
       LEFT JOIN transport_routes tr ON tr.route_id = r.route_id AND tr.organization_id = r.organization_id
       LEFT JOIN transport_stops ts ON ts.stop_id = r.stop_id AND ts.organization_id = r.organization_id
      WHERE r.organization_id = $1 AND r.status = ANY($2::text[])${scope}
      ORDER BY COALESCE(r.decided_at, r.created_at) DESC
      LIMIT ${PAGE_SIZE}`,
    params
  );
  return rows.map(publicRequest);
}

async function countNewRequests(db, organizationId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM transport_student_requests WHERE organization_id = $1 AND status = 'pending'`,
    [organizationId]
  );
  return rows[0].total;
}

async function createRequest(db, organizationId, requester, input) {
  const studentId = Number(input.studentId);
  if (!Number.isInteger(studentId) || studentId <= 0) throw new RequestError("Student is required.");
  const address = cleanText(input.address, MAX_ADDRESS_LENGTH);
  const place = validCoordinate(input.lat, input.lng);
  if (!address && !place) throw new RequestError("Please enter the student's address.");

  const student = await db.query(
    `SELECT s.student_id,
            EXISTS (SELECT 1 FROM transport_student_assignments a
                     WHERE a.organization_id = s.organization_id AND a.student_id = s.student_id AND a.active = TRUE) AS has_access
       FROM students s
      WHERE s.student_id = $1 AND s.organization_id = $2 AND COALESCE(s.graduated, FALSE) = FALSE`,
    [studentId, organizationId]
  );
  if (!student.rows[0]) throw new RequestError("Student not found.", 404);
  if (student.rows[0].has_access) throw new RequestError("This student already has bus access.", 409);

  // Only a stop on a route of this school, and never another family's home stop.
  let routeId = null;
  let stopId = null;
  let distanceKm = null;
  const wantedStop = Number(input.stopId);
  if (Number.isInteger(wantedStop) && wantedStop > 0) {
    const stop = await db.query(
      `SELECT stop_id, route_id, stop_name, latitude, longitude FROM transport_stops
        WHERE stop_id = $1 AND organization_id = $2 AND route_id IS NOT NULL`,
      [wantedStop, organizationId]
    );
    if (!stop.rows[0] || isPrivateStop(stop.rows[0])) throw new RequestError("That stop is no longer available. Please pick another.");
    stopId = Number(stop.rows[0].stop_id);
    routeId = Number(stop.rows[0].route_id);
    if (place) {
      const distance = calculateDistanceKm(place.lat, place.lng, stop.rows[0].latitude, stop.rows[0].longitude);
      distanceKm = distance === null ? null : Number(distance.toFixed(3));
    }
  }

  const inserted = await db.query(
    `INSERT INTO transport_student_requests (
       organization_id, student_id, guardian_id, requested_by_user_id, requester_type, requester_name,
       address, latitude, longitude, route_id, stop_id, distance_km
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (organization_id, student_id) WHERE status = 'pending' DO NOTHING
     RETURNING request_id`,
    [
      organizationId, studentId, requester.guardianId || null, requester.userId || null, requester.type,
      cleanText(requester.name, 160) || null, address || null, place ? place.lat : null, place ? place.lng : null,
      routeId, stopId, distanceKm,
    ]
  );
  if (!inserted.rows[0]) throw new RequestError("A bus request for this student is already waiting for the school.", 409);
  return Number(inserted.rows[0].request_id);
}

// Approving puts the student on the bus in the same transaction, and only the
// first person to answer a request wins.
async function approveRequest(db, organizationId, requestId, decider, input = {}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT * FROM transport_student_requests
        WHERE request_id = $1 AND organization_id = $2 AND status = 'pending' FOR UPDATE`,
      [requestId, organizationId]
    );
    const request = found.rows[0];
    if (!request) throw new RequestError("This request has already been answered.", 409);

    const wantedStop = Number(input.stopId) > 0 ? Number(input.stopId) : request.stop_id;
    const wantedRoute = Number(input.routeId) > 0 ? Number(input.routeId) : request.route_id;
    const wantedBus = Number(input.busId) > 0 ? Number(input.busId) : null;
    const checked = await client.query(
      `SELECT
         (SELECT route_id FROM transport_routes WHERE route_id = $2 AND organization_id = $1) AS route_id,
         (SELECT stop_id FROM transport_stops WHERE stop_id = $3 AND organization_id = $1) AS stop_id,
         (SELECT bus_id FROM transport_buses WHERE bus_id = $4 AND organization_id = $1) AS bus_id,
         (SELECT sc.bus_id FROM transport_bus_schedules sc
           WHERE sc.organization_id = $1 AND sc.route_id = $2 AND sc.status = 'active' LIMIT 1) AS route_bus_id`,
      [organizationId, wantedRoute, wantedStop, wantedBus]
    );
    const ids = checked.rows[0];
    if (!ids.route_id || !ids.stop_id) throw new RequestError("Choose a route and stop before approving.");

    await client.query(
      `INSERT INTO transport_student_assignments (
         organization_id, student_id, bus_id, route_id, stop_id, home_address, home_latitude, home_longitude, distance_km, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
       ON CONFLICT (organization_id, student_id) DO UPDATE SET
         bus_id = EXCLUDED.bus_id, route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id,
         home_address = EXCLUDED.home_address, home_latitude = EXCLUDED.home_latitude,
         home_longitude = EXCLUDED.home_longitude, distance_km = EXCLUDED.distance_km,
         active = TRUE, updated_at = NOW()`,
      [
        organizationId, request.student_id, ids.bus_id || ids.route_bus_id || null, ids.route_id, ids.stop_id,
        request.address, request.latitude, request.longitude, request.distance_km,
      ]
    );
    await client.query(
      `UPDATE transport_student_requests
          SET status = 'approved', route_id = $2, stop_id = $3, decided_by_user_id = $4, decided_by_name = $5,
              decided_at = NOW(), decision_note = $6, updated_at = NOW()
        WHERE request_id = $1`,
      [requestId, ids.route_id, ids.stop_id, decider.userId || null, cleanText(decider.name, 160) || null, cleanText(input.note, MAX_NOTE_LENGTH) || null]
    );
    await client.query("COMMIT");
    return { studentId: Number(request.student_id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function declineRequest(db, organizationId, requestId, decider, note) {
  const { rowCount } = await db.query(
    `UPDATE transport_student_requests
        SET status = 'declined', decided_by_user_id = $3, decided_by_name = $4, decided_at = NOW(),
            decision_note = $5, updated_at = NOW()
      WHERE request_id = $1 AND organization_id = $2 AND status = 'pending'`,
    [requestId, organizationId, decider.userId || null, cleanText(decider.name, 160) || null, cleanText(note, MAX_NOTE_LENGTH) || null]
  );
  if (!rowCount) throw new RequestError("This request has already been answered.", 409);
}

async function cancelRequest(db, organizationId, requestId, guardianStudentIds) {
  const { rowCount } = await db.query(
    `UPDATE transport_student_requests
        SET status = 'cancelled', decided_at = NOW(), updated_at = NOW()
      WHERE request_id = $1 AND organization_id = $2 AND status = 'pending' AND student_id = ANY($3::int[])`,
    [requestId, organizationId, guardianStudentIds]
  );
  if (!rowCount) throw new RequestError("This request can no longer be cancelled.", 409);
}

module.exports = {
  RequestError,
  statusesFor,
  validCoordinate,
  locateAddress,
  isPrivateStop,
  rankOptions,
  requestStart,
  findOptions,
  listRequests,
  countNewRequests,
  createRequest,
  approveRequest,
  declineRequest,
  cancelRequest,
};
