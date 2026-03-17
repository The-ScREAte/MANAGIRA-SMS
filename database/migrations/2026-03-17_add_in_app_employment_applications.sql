-- Add in-app application support for employment postings
ALTER TABLE employment
  ADD COLUMN IF NOT EXISTS application_mode TEXT NOT NULL DEFAULT 'external';

ALTER TABLE employment
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE employment
  ALTER COLUMN external_link DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employment_application_mode_check'
  ) THEN
    ALTER TABLE employment
      ADD CONSTRAINT employment_application_mode_check
      CHECK (application_mode IN ('external', 'in_app'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS employment_applications (
  id SERIAL PRIMARY KEY,
  employment_id INTEGER NOT NULL REFERENCES employment(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp_number TEXT,
  contact_via_text BOOLEAN NOT NULL DEFAULT FALSE,
  contact_via_email BOOLEAN NOT NULL DEFAULT TRUE,
  cover_letter TEXT NOT NULL,
  resume_url TEXT NOT NULL,
  resume_s3_key TEXT,
  resume_filename TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employment_applications_employment_id
  ON employment_applications(employment_id);

CREATE INDEX IF NOT EXISTS idx_employment_applications_created_at
  ON employment_applications(created_at DESC);
