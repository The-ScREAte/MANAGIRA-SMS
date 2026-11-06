-- Who boarded at each stop, and who isn't riding on a given day.
CREATE TABLE IF NOT EXISTS transport_boardings (
  boarding_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  trip_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  stop_id INTEGER,
  stop_name TEXT,
  boarded BOOLEAN NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT 'driver' CHECK (confirmed_by IN ('driver', 'auto')),
  driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_transport_boardings_school_time
  ON transport_boardings (organization_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS transport_not_riding (
  not_riding_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  ride_date DATE NOT NULL,
  set_by TEXT NOT NULL CHECK (set_by IN ('parent', 'staff')),
  set_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, student_id, ride_date)
);

CREATE INDEX IF NOT EXISTS idx_transport_not_riding_day
  ON transport_not_riding (organization_id, ride_date);
