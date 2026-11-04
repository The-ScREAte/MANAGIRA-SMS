-- Parents' tracking and arrival alerts read the newest position for a trip.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_live_locations_trip_recorded ON transport_live_locations (trip_id, recorded_at DESC);
