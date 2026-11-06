-- Reports drivers send to their leads, and each student's arrival check at the end of a trip.
CREATE TABLE IF NOT EXISTS transport_driver_reports (
  report_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  driver_name TEXT,
  trip_id INTEGER,
  bus_id INTEGER,
  route_id INTEGER,
  student_id INTEGER REFERENCES students(student_id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('bus', 'student', 'route', 'complaint', 'arrival', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
  share_with_parents BOOLEAN NOT NULL DEFAULT FALSE,
  share_with_teachers BOOLEAN NOT NULL DEFAULT FALSE,
  review_note TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_driver_reports_org_status
  ON transport_driver_reports (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transport_driver_reports_student
  ON transport_driver_reports (student_id, created_at DESC) WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transport_trip_arrivals (
  arrival_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  trip_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  arrived BOOLEAN NOT NULL,
  reason TEXT,
  note TEXT,
  driver_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_transport_trip_arrivals_org
  ON transport_trip_arrivals (organization_id, created_at DESC);

-- The specific issue chosen from the form's second dropdown.
ALTER TABLE transport_driver_reports ADD COLUMN IF NOT EXISTS issue TEXT;

-- A school can ask parents to confirm the driver's arrival check in the parent portal.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS transportation_parent_confirm_arrival BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE transport_trip_arrivals
  ADD COLUMN IF NOT EXISTS parent_status TEXT,
  ADD COLUMN IF NOT EXISTS parent_guardian_id INTEGER,
  ADD COLUMN IF NOT EXISTS parent_answered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transport_trip_arrivals_parent_pending
  ON transport_trip_arrivals (student_id, created_at DESC) WHERE parent_status = 'pending';
