-- Data migration sandbox (feature data_migration, utils/migration/): a school moving from
-- another system (PowerSchool first) uploads its export files, checks and fixes them in a
-- sandbox, signs off, and goes live. Safe to run again.

-- One migration per school at a time.
CREATE TABLE IF NOT EXISTS migration_jobs (
  job_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'powerschool',
  status TEXT NOT NULL DEFAULT 'sandbox' CHECK (status IN ('sandbox', 'review', 'live', 'closed', 'cancelled')),
  locked BOOLEAN NOT NULL DEFAULT TRUE,
  approvals JSONB NOT NULL DEFAULT '{}'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_name TEXT,
  signed_by INTEGER,
  signed_at TIMESTAMPTZ,
  live_at TIMESTAMPTZ,
  catch_up_at TIMESTAMPTZ,
  purge_after DATE,
  purged_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_jobs_open_idx ON migration_jobs (organization_id) WHERE status IN ('sandbox', 'review', 'live');

-- The files exactly as uploaded (never edited), so an import can always run again from them.
CREATE TABLE IF NOT EXISTS migration_files (
  file_id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,
  entity TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  header JSONB NOT NULL DEFAULT '[]'::jsonb,
  content BYTEA,
  replaced_at TIMESTAMPTZ,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS migration_files_job_idx ON migration_files (job_id);

-- Every column of every file: where it goes, how sure the match is, and what the school said.
CREATE TABLE IF NOT EXISTS migration_columns (
  column_id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,
  entity TEXT NOT NULL,
  source_column TEXT NOT NULL,
  target TEXT,
  confidence TEXT NOT NULL DEFAULT 'none',
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  samples JSONB NOT NULL DEFAULT '[]'::jsonb,
  sensitive TEXT,
  action TEXT,
  label TEXT,
  notes JSONB,
  notes_at TIMESTAMPTZ,
  legal_need_by INTEGER,
  exclude_approved_by INTEGER,
  exclude_approved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  UNIQUE (job_id, entity, source_column)
);

-- The sandbox: each record as it will be loaded, with its old system's ID.
CREATE TABLE IF NOT EXISTS migration_records (
  record_id BIGSERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,
  entity TEXT NOT NULL,
  source_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  archive JSONB NOT NULL DEFAULT '{}'::jsonb,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, entity, source_id)
);

-- Old system ID to Managira ID, kept after go-live: loading again updates, never duplicates.
CREATE TABLE IF NOT EXISTS migration_links (
  organization_id INTEGER NOT NULL,
  entity TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  managira_id INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, entity, source_system, source_id)
);

-- Who did what, and when.
CREATE TABLE IF NOT EXISTS migration_events (
  event_id BIGSERIAL PRIMARY KEY,
  job_id INTEGER,
  organization_id INTEGER NOT NULL,
  actor TEXT,
  actor_kind TEXT,
  action TEXT NOT NULL,
  detail JSONB,
  ip TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS migration_events_org_idx ON migration_events (organization_id, at DESC);

-- The sandbox as it was just before go-live.
CREATE TABLE IF NOT EXISTS migration_snapshots (
  snapshot_id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  content JSONB,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A value with no field of its own, kept on the record as a label and value (searchable).
CREATE TABLE IF NOT EXISTS record_extra_fields (
  extra_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  entity TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  value TEXT,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, entity, record_id, label)
);
CREATE INDEX IF NOT EXISTS record_extra_fields_value_idx ON record_extra_fields (organization_id, entity, lower(value));

-- Data for something Managira doesn't do yet, kept read-only per student (or for the school).
CREATE TABLE IF NOT EXISTS migration_archives (
  archive_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  job_id INTEGER,
  student_id INTEGER,
  module TEXT NOT NULL,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  content JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, student_id, module)
);

-- A notice everyone who opens the student must see (custody and pickup restrictions).
CREATE TABLE IF NOT EXISTS student_alerts (
  alert_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custody',
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, student_id, kind, label)
);
