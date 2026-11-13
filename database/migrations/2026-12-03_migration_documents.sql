-- Documents a school brings from its old system (birth certificates, IEPs, report cards, photos,
-- any file that isn't a list): kept privately (S3 under migrations/, never public; or here when
-- no S3 is set up), matched to each student by the school's document index, folder or file name,
-- and restricted where the school marked them confidential. Safe to run again.
CREATE TABLE IF NOT EXISTS migration_documents (
  document_id BIGSERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  upload_id BIGINT,
  file_name TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  store TEXT NOT NULL CHECK (store IN ('s3', 'db')),
  storage_key TEXT,
  content BYTEA,
  kind TEXT,
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  student_source_id TEXT,
  student_id INTEGER REFERENCES students(student_id) ON DELETE SET NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_documents_one_idx ON migration_documents (job_id, path, sha256);
CREATE INDEX IF NOT EXISTS migration_documents_job_idx ON migration_documents (job_id);
CREATE INDEX IF NOT EXISTS migration_documents_student_idx ON migration_documents (organization_id, student_id) WHERE student_id IS NOT NULL;
