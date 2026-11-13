-- Data migration work runs in the background (utils/migration/tasks.js): reading uploaded files,
-- importing into the sandbox, going live and the catch-up. One open task per school at a time;
-- any server can claim a queued one (FOR UPDATE SKIP LOCKED), and one whose server stopped goes
-- back in the queue. Uploads wait here, compressed, until they're read. Files and snapshots are
-- kept compressed. Safe to run again.
CREATE TABLE IF NOT EXISTS migration_tasks (
  task_id BIGSERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('read_files', 'import', 'go_live', 'catch_up')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  actor TEXT,
  runner TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  env TEXT NOT NULL DEFAULT 'production', -- only a server of the same kind runs it (a development server on the hosted database never runs a school's task)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_tasks_one_open_idx ON migration_tasks (job_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS migration_tasks_queue_idx ON migration_tasks (task_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS migration_tasks_job_idx ON migration_tasks (job_id, task_id DESC);

CREATE TABLE IF NOT EXISTS migration_uploads (
  upload_id BIGSERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  entity TEXT,
  content BYTEA,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'read', 'failed')),
  error TEXT,
  result JSONB,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS migration_uploads_waiting_idx ON migration_uploads (job_id, upload_id) WHERE status = 'waiting';

ALTER TABLE migration_files ADD COLUMN IF NOT EXISTS compressed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE migration_files ADD COLUMN IF NOT EXISTS source_name TEXT;
-- Lists of one kind sent together (a long list in parts, in one .zip) stay together; a later upload replaces them.
ALTER TABLE migration_files ADD COLUMN IF NOT EXISTS upload_id BIGINT;
ALTER TABLE migration_snapshots ADD COLUMN IF NOT EXISTS content_gz BYTEA;
ALTER TABLE migration_tasks ADD COLUMN IF NOT EXISTS env TEXT NOT NULL DEFAULT 'production';
