ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employment_applications_status_check'
  ) THEN
    ALTER TABLE employment_applications
      ADD CONSTRAINT employment_applications_status_check
      CHECK (status IN ('pending', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employment_applications_status
  ON employment_applications(status);
