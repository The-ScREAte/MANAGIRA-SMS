-- Data migration, second round (utils/dataMigration.js): staff, teachers' classes, final grades
-- and attendance totals load into real features; every row a go-live writes is recorded so it
-- can be rolled back; authenticator codes guard the migration pages. Safe to run again.

-- A student's final grades from before Managira (or another school), with credits and GPA
-- points. The transcript prints them before Managira's own terms.
CREATE TABLE IF NOT EXISTS student_course_history (
  history_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  school_year TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  grade_level TEXT,
  course_number TEXT,
  course_name TEXT NOT NULL,
  grade TEXT,
  percent NUMERIC(6, 2),
  gpa_points NUMERIC(5, 2),
  credits_attempted NUMERIC(6, 2),
  credits_earned NUMERIC(6, 2),
  school_name TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  job_id INTEGER REFERENCES migration_jobs(job_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS student_course_history_student_idx ON student_course_history (organization_id, student_id);
CREATE INDEX IF NOT EXISTS student_course_history_job_idx ON student_course_history (job_id);

-- Days present, absent, excused and tardy per student per term from another system. A term
-- that is one of the school's own (term_id) counts on that term's report cards.
CREATE TABLE IF NOT EXISTS student_attendance_totals (
  total_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  term_id INTEGER REFERENCES terms(term_id) ON DELETE SET NULL,
  school_year TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  days_present NUMERIC(6, 1) NOT NULL DEFAULT 0,
  days_absent NUMERIC(6, 1) NOT NULL DEFAULT 0,
  days_excused NUMERIC(6, 1) NOT NULL DEFAULT 0,
  days_tardy NUMERIC(6, 1) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  job_id INTEGER REFERENCES migration_jobs(job_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, student_id, source, school_year, term)
);
CREATE INDEX IF NOT EXISTS student_attendance_totals_term_idx ON student_attendance_totals (organization_id, term_id) WHERE term_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS student_attendance_totals_job_idx ON student_attendance_totals (job_id);

-- Every row a go-live or catch-up wrote into the school's live tables: made (created) or
-- changed (before = its values until then). Rolling back reads it. Deleted with the sandbox.
CREATE TABLE IF NOT EXISTS migration_loaded (
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_key JSONB NOT NULL,
  created BOOLEAN NOT NULL,
  before JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, table_name, row_key)
);

-- Which migration wrote these rows, so a rollback removes exactly them.
ALTER TABLE migration_links ADD COLUMN IF NOT EXISTS job_id INTEGER;
ALTER TABLE migration_links ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE record_extra_fields ADD COLUMN IF NOT EXISTS job_id INTEGER;
ALTER TABLE student_alerts ADD COLUMN IF NOT EXISTS job_id INTEGER;
CREATE INDEX IF NOT EXISTS migration_links_job_idx ON migration_links (job_id) WHERE job_id IS NOT NULL;
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ;
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS rolled_back_by TEXT;

-- Authenticator-app codes (TOTP) for the people who open a school's migration or its
-- restricted data, and for Managira's super admins. The secret is stored locked; a code
-- works once (last_step); recovery codes are kept only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS account_mfa (
  account_kind TEXT NOT NULL CHECK (account_kind IN ('user', 'organization')),
  account_id INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ,
  last_step BIGINT,
  recovery JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_kind, account_id)
);
CREATE INDEX IF NOT EXISTS account_mfa_org_idx ON account_mfa (organization_id) WHERE organization_id IS NOT NULL;
