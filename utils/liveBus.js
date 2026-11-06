"use strict";

// Where every bus is right now. Drivers report every few seconds and any number of
// parents, teachers and students watch, so neither side should touch the database
// each time: the latest position lives in memory, a saved copy is written every
// WRITE_EVERY_MS, and viewers of a school share one read per few seconds.
const { BoundedMap } = require("./boundedMap");
const { roadRoute } = require("./roadRouting");

const WRITE_EVERY_MS = 15000;
const DRIVER_TRIP_TTL_MS = 60000;
const BOARD_TTL_MS = 5000;
const IDLE_BOARD_TTL_MS = 15000;
const LIVE_WINDOW_MINUTES = 30;
// A browser page can't send GPS while the phone is showing another app (Google or Apple
// Maps). While a driver's phone is silent, viewers see the bus move along its route at
// the route's usual pace, marked as estimated, until a real position arrives again.
const ESTIMATE_AFTER_MS = 25000;
const RAD = Math.PI / 180;

const fixes = new BoundedMap(5000); // tripId -> newest position
const driverTrips = new BoundedMap(5000); // "org:trip:driver" -> trip
const boards = new BoundedMap(5000); // org -> active trips, shared by all its viewers
const routeLines = new BoundedMap(1000); // tripId -> its road line
const estimates = new BoundedMap(1000); // tripId -> the current estimate, shared by all viewers
const ESTIMATE_REUSE_MS = 2000;

async function tripForDriver(db, organizationId, tripId, driverUserId) {
  const key = `${organizationId}:${tripId}:${driverUserId}`;
  const hit = driverTrips.get(key);
  if (hit && hit.expires > Date.now()) return hit.trip;
  const { rows } = await db.query(
    `SELECT trip_id, route_id, bus_id FROM transport_trip_sessions
      WHERE organization_id = $1 AND trip_id = $2 AND driver_user_id = $3 AND status = 'active'
      LIMIT 1`,
    [organizationId, tripId, driverUserId]
  );
  if (!rows[0]) {
    driverTrips.delete(key);
    return null;
  }
  driverTrips.set(key, { trip: rows[0], expires: Date.now() + DRIVER_TRIP_TTL_MS });
  return rows[0];
}

function saveFix(db, organizationId, driverUserId, trip, fix) {
  return db.query(
    `INSERT INTO transport_live_locations (
       organization_id, trip_id, route_id, bus_id, driver_user_id, latitude, longitude, speed_kmh, heading_deg
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [organizationId, trip.trip_id, trip.route_id, trip.bus_id, driverUserId, fix.latitude, fix.longitude, fix.speed_kmh, fix.heading_deg]
  );
}

// Viewers see this at once; the database gets a copy every WRITE_EVERY_MS.
function recordFix(db, organizationId, driverUserId, trip, position) {
  const previous = fixes.get(trip.trip_id);
  const fix = {
    latitude: position.latitude,
    longitude: position.longitude,
    speed_kmh: position.speedKmh,
    heading_deg: position.headingDeg,
    recorded_at: new Date(),
    savedAt: previous ? previous.savedAt : 0,
    organizationId,
    driverUserId,
    trip,
  };
  fixes.set(trip.trip_id, fix);
  const now = Date.now();
  if (now - fix.savedAt < WRITE_EVERY_MS) return Promise.resolve(false);
  fix.savedAt = now;
  fix.saved = true;
  return saveFix(db, organizationId, driverUserId, trip, fix)
    .then(() => true)
    .catch((error) => {
      fix.savedAt = 0; // try again with the next position
      fix.saved = false;
      console.error("[Live bus] Could not save a position:", error.message);
      return false;
    });
}

function tripStarted(organizationId) {
  boards.delete(organizationId);
}

// The last position is kept, and the trip stops showing as live straight away.
async function tripEnded(db, organizationId, tripId) {
  const fix = fixes.get(tripId);
  fixes.delete(tripId);
  routeLines.delete(tripId);
  estimates.delete(tripId);
  boards.delete(organizationId);
  for (const key of driverTrips.keys()) {
    if (key.startsWith(`${organizationId}:${tripId}:`)) driverTrips.delete(key);
  }
  if (fix && !fix.saved) {
    await saveFix(db, organizationId, fix.driverUserId, fix.trip, fix).catch(() => {});
  }
}

async function readBoard(db, organizationId) {
  const { rows } = await db.query(
    `SELECT t.trip_id, t.status, t.started_at, t.bus_id, t.route_id, b.bus_number, b.license_plate,
            COALESCE(NULLIF(TRIM(d.driver_name), ''), TRIM(CONCAT_WS(' ', u.first_name, u.last_name))) AS driver_name,
            COALESCE(d.image_url, u.profile_image_url) AS driver_photo,
            live.latitude, live.longitude, live.speed_kmh, live.heading_deg, live.recorded_at
       FROM transport_trip_sessions t
       LEFT JOIN transport_buses b ON b.bus_id = t.bus_id AND b.organization_id = t.organization_id
       LEFT JOIN users u ON u.user_id = t.driver_user_id
       LEFT JOIN transport_drivers d ON d.user_id = t.driver_user_id AND d.organization_id = t.organization_id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, speed_kmh, heading_deg, recorded_at
           FROM transport_live_locations
          WHERE organization_id = t.organization_id AND trip_id = t.trip_id
          ORDER BY recorded_at DESC
          LIMIT 1
       ) live ON TRUE
      WHERE t.organization_id = $1
        AND t.status = 'active'
        -- A trip whose phone stopped reporting long ago (never ended) isn't live.
        AND COALESCE(live.recorded_at, t.started_at) > NOW() - INTERVAL '${LIVE_WINDOW_MINUTES} minutes'
      ORDER BY t.started_at DESC`,
    [organizationId]
  );
  return rows;
}

// However many people ask at once, one read per school runs at a time.
function board(db, organizationId) {
  const entry = boards.get(organizationId);
  const now = Date.now();
  if (entry && entry.expires > now) return Promise.resolve(entry.trips);
  if (entry && entry.pending) return entry.pending;
  const stale = entry ? entry.trips : [];
  const pending = readBoard(db, organizationId)
    .then((trips) => {
      boards.set(organizationId, { trips, expires: Date.now() + (trips.length ? BOARD_TTL_MS : IDLE_BOARD_TTL_MS) });
      return trips;
    })
    .catch((error) => {
      console.error("[Live bus] Could not read active trips:", error.message);
      boards.set(organizationId, { trips: stale, expires: Date.now() + BOARD_TTL_MS });
      return stale;
    });
  boards.set(organizationId, { trips: stale, expires: 0, pending });
  return pending;
}

function withNewestFix(db, organizationId, trip) {
  const fix = fixes.get(trip.trip_id);
  const newest = !fix || (trip.recorded_at && new Date(trip.recorded_at) > fix.recorded_at) ? trip : {
    ...trip,
    latitude: fix.latitude,
    longitude: fix.longitude,
    speed_kmh: fix.speed_kmh,
    heading_deg: fix.heading_deg,
    recorded_at: fix.recorded_at,
  };
  return estimateIfSilent(db, organizationId, newest);
}

function distanceM(a, b) {
  const x = (b.lng - a.lng) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function buildLine(coordinates, durationS) {
  const pts = coordinates.map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }));
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + distanceM(pts[i - 1], pts[i]));
  const length = cum[cum.length - 1];
  // Usual pace on this route, kept to what a school bus really does.
  const pace = durationS > 0 ? length / durationS : 7;
  return { pts, cum, length, metresPerSecond: Math.max(4, Math.min(17, pace)) };
}

// Where a bus would be after going `metres` further along the line from a point.
function advanceAlong(line, lat, lng, metres) {
  const kx = Math.cos(lat * RAD) * 111320;
  const ky = 110540;
  let best = { along: 0, offset: Infinity };
  for (let i = 1; i < line.pts.length; i += 1) {
    const a = line.pts[i - 1];
    const b = line.pts[i];
    const ax = (a.lng - lng) * kx;
    const ay = (a.lat - lat) * ky;
    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const offset = Math.hypot(ax + t * dx, ay + t * dy);
    if (offset < best.offset) best = { along: line.cum[i - 1] + t * (line.cum[i] - line.cum[i - 1]), offset };
  }
  const target = Math.min(line.length, best.along + metres);
  let i = 1;
  while (i < line.pts.length - 1 && line.cum[i] < target) i += 1;
  const a = line.pts[i - 1];
  const b = line.pts[i];
  const part = line.cum[i] > line.cum[i - 1] ? (target - line.cum[i - 1]) / (line.cum[i] - line.cum[i - 1]) : 0;
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return {
    lat: a.lat + (b.lat - a.lat) * part,
    lng: a.lng + (b.lng - a.lng) * part,
    heading: (Math.atan2(y, x) / RAD + 360) % 360,
    atEnd: target >= line.length,
  };
}

async function loadRouteLine(db, organizationId, trip) {
  const [stops, destination] = await Promise.all([
    db.query(
      `SELECT latitude, longitude FROM transport_stops
        WHERE organization_id = $1 AND route_id = $2 AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY stop_order ASC, stop_id ASC`,
      [organizationId, trip.route_id]
    ),
    db.query(
      `SELECT tr.use_school_destination, tr.destination_latitude, tr.destination_longitude, o.geo_lat, o.geo_lng
         FROM transport_routes tr JOIN organizations o ON o.organization_id = tr.organization_id
        WHERE tr.route_id = $2 AND tr.organization_id = $1`,
      [organizationId, trip.route_id]
    ),
  ]);
  const points = stops.rows.map((row) => [Number(row.latitude), Number(row.longitude)]);
  const end = destination.rows[0];
  if (end) {
    const lat = end.use_school_destination !== false ? end.geo_lat : end.destination_latitude;
    const lng = end.use_school_destination !== false ? end.geo_lng : end.destination_longitude;
    if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) points.push([Number(lat), Number(lng)]);
  }
  const route = await roadRoute(points);
  return route ? buildLine(route.coordinates, route.durationS) : null;
}

function lineForTrip(db, organizationId, trip) {
  const entry = routeLines.get(trip.trip_id);
  if (entry && (entry.line || entry.retryAt > Date.now())) return entry.line || null;
  routeLines.set(trip.trip_id, { line: null, retryAt: Date.now() + 60000 });
  loadRouteLine(db, organizationId, trip)
    .then((line) => { if (line) routeLines.set(trip.trip_id, { line }); })
    .catch(() => {});
  return null;
}

function estimateIfSilent(db, organizationId, trip) {
  if (!trip.recorded_at || trip.latitude === null || trip.latitude === undefined || !trip.route_id) return trip;
  const silentFor = Date.now() - new Date(trip.recorded_at).getTime();
  if (silentFor < ESTIMATE_AFTER_MS || silentFor > LIVE_WINDOW_MINUTES * 60000) return trip;
  const kept = estimates.get(trip.trip_id);
  if (kept && kept.lastGps === String(trip.recorded_at) && Date.now() - kept.at < ESTIMATE_REUSE_MS) return kept.value;
  const line = lineForTrip(db, organizationId, trip);
  if (!line) return trip;
  const spot = advanceAlong(line, Number(trip.latitude), Number(trip.longitude), (silentFor / 1000) * line.metresPerSecond);
  const value = {
    ...trip,
    latitude: spot.lat,
    longitude: spot.lng,
    heading_deg: spot.heading,
    speed_kmh: spot.atEnd ? 0 : Math.round(line.metresPerSecond * 3.6),
    recorded_at: new Date(),
    estimated: true,
    last_gps_at: trip.recorded_at,
  };
  estimates.set(trip.trip_id, { value, at: Date.now(), lastGps: String(trip.recorded_at) });
  return value;
}

// A student's bus: their own bus first, otherwise a bus on their route.
async function liveForStudent(db, organizationId, busId, routeId) {
  const trips = await board(db, organizationId);
  const match = (bus) => trips.find((trip) => (bus ? trip.bus_id === busId : routeId && trip.route_id === routeId));
  const trip = (busId && match(true)) || match(false) || null;
  return trip ? withNewestFix(db, organizationId, trip) : null;
}

// Every route with a moving bus: { routeId: position }.
async function liveByRoute(db, organizationId) {
  const trips = await board(db, organizationId);
  const out = {};
  // Newest trip first, so the first one seen on a route is the one kept.
  trips.forEach((trip) => {
    const live = withNewestFix(db, organizationId, trip);
    if (trip.route_id && live.latitude !== null && live.latitude !== undefined && !out[trip.route_id]) {
      out[trip.route_id] = live;
    }
  });
  return out;
}

module.exports = {
  WRITE_EVERY_MS,
  LIVE_WINDOW_MINUTES,
  tripForDriver,
  recordFix,
  tripStarted,
  tripEnded,
  liveForStudent,
  liveByRoute,
  advanceAlong,
  buildLine,
  ESTIMATE_AFTER_MS,
  _setRouteLine: (tripId, line) => routeLines.set(tripId, { line }),
};
