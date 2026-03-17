ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE employment_applications
  DROP CONSTRAINT IF EXISTS employment_applications_status_check;

ALTER TABLE employment_applications
  ADD CONSTRAINT employment_applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));
