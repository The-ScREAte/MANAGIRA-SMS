-- Data migration requests and keeping what a school already has. A school asks Managira to move
-- its data in (Management › Data migration, managers only);
-- Managira gets in touch, then approves (opening the school's sandbox) or declines. Safe to run
-- again.
CREATE TABLE IF NOT EXISTS migration_requests (
  request_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  requested_by INTEGER,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  current_system TEXT NOT NULL,
  students_estimate INTEGER,
  staff_estimate INTEGER,
  timing TEXT,
  preferred_date DATE,
  bring JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'approved', 'declined', 'withdrawn')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  job_id INTEGER REFERENCES migration_jobs(job_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One open request per school.
CREATE UNIQUE INDEX IF NOT EXISTS migration_requests_open_idx ON migration_requests (organization_id) WHERE status IN ('new', 'contacted');
CREATE INDEX IF NOT EXISTS migration_requests_status_idx ON migration_requests (status, created_at DESC);

-- What the migration last wrote to each record, so a later load (the catch-up) never overwrites
-- a change the school made since; and the school's answers to "is this the same student?" for
-- records that look like ones already in Managira, or appear twice in its files.
ALTER TABLE migration_links ADD COLUMN IF NOT EXISTS loaded JSONB;
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS match_decisions JSONB NOT NULL DEFAULT '{}'::jsonb;
