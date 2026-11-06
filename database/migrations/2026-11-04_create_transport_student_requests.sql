-- Bus requests from the classroom and the parent portal, reviewed on the Transportation page.
CREATE TABLE IF NOT EXISTS transport_student_requests (
  request_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  guardian_id INTEGER REFERENCES guardians(guardian_id) ON DELETE SET NULL,
  requested_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  requester_type TEXT NOT NULL CHECK (requester_type IN ('guardian', 'staff')),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transport_student_requests
  ADD COLUMN IF NOT EXISTS requester_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS route_id INTEGER,
  ADD COLUMN IF NOT EXISTS stop_id INTEGER,
  ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_by_name TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE transport_student_requests DROP CONSTRAINT IF EXISTS transport_student_requests_status_check;

ALTER TABLE transport_student_requests
  ADD CONSTRAINT transport_student_requests_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_student_requests_pending
  ON transport_student_requests (organization_id, student_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_transport_student_requests_org_status
  ON transport_student_requests (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transport_student_requests_guardian
  ON transport_student_requests (guardian_id, created_at DESC) WHERE guardian_id IS NOT NULL;
