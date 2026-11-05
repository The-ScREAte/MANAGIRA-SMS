CREATE TABLE IF NOT EXISTS transport_requests (
  request_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  pickup_address VARCHAR(500) NOT NULL,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  stop_id INTEGER REFERENCES transport_stops(stop_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS transport_requests_one_pending
  ON transport_requests (organization_id, student_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS transport_requests_review
  ON transport_requests (organization_id, status, created_at DESC);