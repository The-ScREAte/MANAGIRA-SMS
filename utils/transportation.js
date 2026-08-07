let transportationSchemaReady = false;

const MAP_PROVIDERS = ["google", "mapbox", "openstreetmap"];

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeMapProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MAP_PROVIDERS.includes(normalized) ? normalized : "openstreetmap";
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deg2rad(value) {
  return (Number(value) * Math.PI) / 180;
}

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const aLat = toNumberOrNull(lat1);
  const aLng = toNumberOrNull(lng1);
  const bLat = toNumberOrNull(lat2);
  const bLng = toNumberOrNull(lng2);
  if ([aLat, aLng, bLat, bLng].some((entry) => entry === null)) return null;

  const earthRadiusKm = 6371;
  const dLat = deg2rad(bLat - aLat);
  const dLng = deg2rad(bLng - aLng);
  const p =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(aLat)) * Math.cos(deg2rad(bLat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));

  return earthRadiusKm * c;
}

async function ensureTransportationSchema(dbClient) {
  if (transportationSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS transportation_activated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS transportation_map_provider TEXT NOT NULL DEFAULT 'openstreetmap',
      ADD COLUMN IF NOT EXISTS transportation_distance_unit TEXT NOT NULL DEFAULT 'km'
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_buses (
      bus_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      bus_number TEXT NOT NULL,
      bus_name TEXT,
      license_plate TEXT,
      capacity INTEGER,
      driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_year INTEGER,
      vehicle_color TEXT,
      vin TEXT,
      fuel_type TEXT,
      odometer NUMERIC(12,1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, bus_number)
    )
  `);

  // Ensure detailed bus fields exist for older databases created before these columns.
  await dbClient.query(`
    ALTER TABLE transport_buses
      ADD COLUMN IF NOT EXISTS bus_name TEXT,
      ADD COLUMN IF NOT EXISTS license_plate TEXT,
      ADD COLUMN IF NOT EXISTS vehicle_make TEXT,
      ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
      ADD COLUMN IF NOT EXISTS vehicle_year INTEGER,
      ADD COLUMN IF NOT EXISTS vehicle_color TEXT,
      ADD COLUMN IF NOT EXISTS vin TEXT,
      ADD COLUMN IF NOT EXISTS fuel_type TEXT,
      ADD COLUMN IF NOT EXISTS odometer NUMERIC(12,1)
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_drivers (
      driver_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      driver_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      license_number TEXT,
      image_url TEXT,
      assigned_bus_id INTEGER REFERENCES transport_buses(bus_id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`
    ALTER TABLE transport_drivers
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS license_number TEXT,
      ADD COLUMN IF NOT EXISTS image_url TEXT
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_routes (
      route_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      route_name TEXT NOT NULL,
      route_code TEXT,
      route_status TEXT NOT NULL DEFAULT 'active',
      map_provider TEXT NOT NULL DEFAULT 'openstreetmap',
      use_school_destination BOOLEAN NOT NULL DEFAULT TRUE,
      destination_address TEXT,
      destination_latitude NUMERIC(10,7),
      destination_longitude NUMERIC(10,7),
      route_path_geojson JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, route_name)
    )
  `);

  await dbClient.query(`
    ALTER TABLE transport_routes
      ADD COLUMN IF NOT EXISTS use_school_destination BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS destination_address TEXT,
      ADD COLUMN IF NOT EXISTS destination_latitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS destination_longitude NUMERIC(10,7)
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_stops (
      stop_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      route_id INTEGER REFERENCES transport_routes(route_id) ON DELETE SET NULL,
      stop_name TEXT NOT NULL,
      stop_address TEXT,
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      pickup_time TIME,
      dropoff_time TIME,
      stop_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Stops now live in an org-wide pool and are attached to routes (not the
  // other way around) — relax any pre-existing NOT NULL/CASCADE from before
  // this table supported unattached stops.
  await dbClient.query(`
    ALTER TABLE transport_stops ALTER COLUMN route_id DROP NOT NULL
  `).catch(() => {});
  await dbClient.query(`
    ALTER TABLE transport_stops DROP CONSTRAINT IF EXISTS transport_stops_route_id_fkey
  `).catch(() => {});
  await dbClient.query(`
    ALTER TABLE transport_stops
      ADD CONSTRAINT transport_stops_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES transport_routes(route_id) ON DELETE SET NULL
  `).catch(() => {});

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_student_assignments (
      assignment_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      bus_id INTEGER REFERENCES transport_buses(bus_id) ON DELETE SET NULL,
      route_id INTEGER REFERENCES transport_routes(route_id) ON DELETE SET NULL,
      stop_id INTEGER REFERENCES transport_stops(stop_id) ON DELETE SET NULL,
      pickup_time TIME,
      dropoff_time TIME,
      home_address TEXT,
      home_latitude NUMERIC(10,7),
      home_longitude NUMERIC(10,7),
      distance_km NUMERIC(10,3),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, student_id)
    )
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_trip_sessions (
      trip_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      route_id INTEGER REFERENCES transport_routes(route_id) ON DELETE SET NULL,
      bus_id INTEGER REFERENCES transport_buses(bus_id) ON DELETE SET NULL,
      driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    )
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_live_locations (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      trip_id INTEGER REFERENCES transport_trip_sessions(trip_id) ON DELETE CASCADE,
      route_id INTEGER REFERENCES transport_routes(route_id) ON DELETE SET NULL,
      bus_id INTEGER REFERENCES transport_buses(bus_id) ON DELETE SET NULL,
      driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      latitude NUMERIC(10,7) NOT NULL,
      longitude NUMERIC(10,7) NOT NULL,
      speed_kmh NUMERIC(8,2),
      heading_deg NUMERIC(8,2),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_bus_schedules (
      schedule_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      bus_id INTEGER NOT NULL REFERENCES transport_buses(bus_id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES transport_drivers(driver_id) ON DELETE SET NULL,
      route_id INTEGER REFERENCES transport_routes(route_id) ON DELETE SET NULL,
      day_of_week TEXT NOT NULL,
      start_time TIME,
      end_time TIME,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_transport_stops_route
      ON transport_stops (organization_id, route_id, stop_order)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_transport_assignments_student
      ON transport_student_assignments (organization_id, student_id)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_transport_live_route_time
      ON transport_live_locations (organization_id, route_id, recorded_at DESC)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_transport_live_bus_time
      ON transport_live_locations (organization_id, bus_id, recorded_at DESC)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_transport_bus_schedules_org_day
      ON transport_bus_schedules (organization_id, day_of_week, start_time)
  `);

  // Now ensure the driver table has route FK if the table existed before route creation.
  await dbClient.query(`
    ALTER TABLE transport_drivers
      ADD COLUMN IF NOT EXISTS assigned_route_id INTEGER REFERENCES transport_routes(route_id) ON DELETE SET NULL
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS transport_notification_events (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      trip_id INTEGER NOT NULL REFERENCES transport_trip_sessions(trip_id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('approaching', 'arrived')),
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trip_id, student_id, event_type)
    )
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_transport_notif_events_trip
      ON transport_notification_events (trip_id)
  `);

  transportationSchemaReady = true;
}

function buildTransportationIntegrationStatus(row = {}) {
  const activated = parseBoolean(row.transportation_activated, false);
  const mapProvider = normalizeMapProvider(row.transportation_map_provider);
  return {
    activated,
    mapProvider,
    shouldShowFeatures: activated,
  };
}

async function getTransportationIntegrationStatus(dbClient, organizationId) {
  if (!organizationId) return buildTransportationIntegrationStatus({});
  await ensureTransportationSchema(dbClient);

  const result = await dbClient.query(
    `SELECT transportation_activated, transportation_map_provider
     FROM organizations
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  return buildTransportationIntegrationStatus(result.rows[0] || {});
}

async function setTransportationIntegrationActivation(dbClient, organizationId, activated) {
  await ensureTransportationSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
       SET transportation_activated = $2
     WHERE organization_id = $1`,
    [organizationId, Boolean(activated)]
  );
}

async function setTransportationMapProvider(dbClient, organizationId, provider) {
  await ensureTransportationSchema(dbClient);
  const normalized = normalizeMapProvider(provider);
  await dbClient.query(
    `UPDATE organizations
       SET transportation_map_provider = $2
     WHERE organization_id = $1`,
    [organizationId, normalized]
  );
  return normalized;
}

async function suggestNearestStop(dbClient, organizationId, homeLat, homeLng) {
  await ensureTransportationSchema(dbClient);
  const stopsResult = await dbClient.query(
    `SELECT stop_id, route_id, stop_name, stop_address, latitude, longitude
       FROM transport_stops
      WHERE organization_id = $1
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL`,
    [organizationId]
  );

  let best = null;
  for (const stop of stopsResult.rows) {
    const distanceKm = calculateDistanceKm(homeLat, homeLng, stop.latitude, stop.longitude);
    if (distanceKm === null) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = {
        stopId: Number(stop.stop_id),
        routeId: Number(stop.route_id),
        stopName: String(stop.stop_name || ""),
        stopAddress: String(stop.stop_address || ""),
        distanceKm,
      };
    }
  }

  return best;
}

module.exports = {
  MAP_PROVIDERS,
  normalizeMapProvider,
  parseBoolean,
  calculateDistanceKm,
  ensureTransportationSchema,
  buildTransportationIntegrationStatus,
  getTransportationIntegrationStatus,
  setTransportationIntegrationActivation,
  setTransportationMapProvider,
  suggestNearestStop,
};
