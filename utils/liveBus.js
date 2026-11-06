"use strict";

// Where every bus is right now. Drivers report every few seconds and any number of
// parents, teachers and students watch, so neither side should touch the database
// each time: the latest position lives in memory, a saved copy is written every
// WRITE_EVERY_MS, and viewers of a school share one read per few seconds.
const { BoundedMap } = require("./boundedMap");

const WRITE_EVERY_MS = 15000;
const DRIVER_TRIP_TTL_MS = 60000;
const BOARD_TTL_MS = 5000;
const IDLE_BOARD_TTL_MS = 15000;
const LIVE_WINDOW_MINUTES = 30;

const fixes = new BoundedMap(5000); // tripId -> newest position
const driverTrips = new BoundedMap(5000); // "org:trip:driver" -> trip
const boards = new BoundedMap(5000); // org -> active trips, shared by all its viewers

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
    `SELECT t.trip_id, t.status, t.started_at, t.bus_id, t.route_id, b.bus_number,
            live.latitude, live.longitude, live.speed_kmh, live.heading_deg, live.recorded_at
       FROM transport_trip_sessions t
       LEFT JOIN transport_buses b ON b.bus_id = t.bus_id AND b.organization_id = t.organization_id
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

function withNewestFix(trip) {
  const fix = fixes.get(trip.trip_id);
  if (!fix || (trip.recorded_at && new Date(trip.recorded_at) > fix.recorded_at)) return trip;
  return {
    ...trip,
    latitude: fix.latitude,
    longitude: fix.longitude,
    speed_kmh: fix.speed_kmh,
    heading_deg: fix.heading_deg,
    recorded_at: fix.recorded_at,
  };
}

// A student's bus: their own bus first, otherwise a bus on their route.
async function liveForStudent(db, organizationId, busId, routeId) {
  const trips = await board(db, organizationId);
  const match = (bus) => trips.find((trip) => (bus ? trip.bus_id === busId : routeId && trip.route_id === routeId));
  const trip = (busId && match(true)) || match(false) || null;
  return trip ? withNewestFix(trip) : null;
}

// Every route with a moving bus: { routeId: position }.
async function liveByRoute(db, organizationId) {
  const trips = await board(db, organizationId);
  const out = {};
  // Newest trip first, so the first one seen on a route is the one kept.
  trips.forEach((trip) => {
    const live = withNewestFix(trip);
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
};
