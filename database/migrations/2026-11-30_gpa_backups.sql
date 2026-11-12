-- GPA kept as the old system gave it, honors/AP weights, and the database's own backups.
-- Safe to run again.

-- A student's GPA as the school's old system worked it out (weighted, unweighted, or one whose
-- method the export doesn't say), kept as the exported text ("3.8571" stays 3.8571): printed on
-- the transcript as it is, never worked out again.
CREATE TABLE IF NOT EXISTS student_source_gpas (
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  gpa_weighted TEXT,
  gpa_unweighted TEXT,
  gpa TEXT,
  as_of TEXT,
  job_id INTEGER REFERENCES migration_jobs(job_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, student_id, source)
);
CREATE INDEX IF NOT EXISTS student_source_gpas_job_idx ON student_source_gpas (job_id);

-- The honors/AP points a course added in the old system (PowerSchool's GPA_AddedValue).
ALTER TABLE student_course_history ADD COLUMN IF NOT EXISTS gpa_added_value NUMERIC(5, 2);

-- Weighted GPA (feature gpa): a subject's level, and what each level adds to a passing grade.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS gpa_level TEXT;
CREATE TABLE IF NOT EXISTS gpa_settings (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
  honors_bonus NUMERIC(3, 2) NOT NULL DEFAULT 0.5,
  ap_bonus NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each nightly backup (utils/backups.js): where it went, how big, and whether it worked.
CREATE TABLE IF NOT EXISTS backup_runs (
  run_id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  storage_key TEXT,
  bytes BIGINT,
  tables INTEGER,
  row_count BIGINT,
  sha256 TEXT,
  key_id TEXT,
  removed_old INTEGER,
  error TEXT,
  triggered_by TEXT
);
CREATE INDEX IF NOT EXISTS backup_runs_started_idx ON backup_runs (started_at DESC);
