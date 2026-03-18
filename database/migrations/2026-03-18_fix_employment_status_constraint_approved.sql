ALTER TABLE employment_applications
  DROP CONSTRAINT IF EXISTS employment_applications_status_check;

ALTER TABLE employment_applications
  ADD CONSTRAINT employment_applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));
