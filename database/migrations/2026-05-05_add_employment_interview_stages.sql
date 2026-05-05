-- Add interview stage tracking to employment applications
ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS interview_stage TEXT NOT NULL DEFAULT 'none';

-- 'none' (no stage / pending), 'first' (initial approval done), 'second', 'final', 'completed'
ALTER TABLE employment_applications
  DROP CONSTRAINT IF EXISTS employment_applications_interview_stage_check;
ALTER TABLE employment_applications
  ADD CONSTRAINT employment_applications_interview_stage_check
  CHECK (interview_stage IN ('none','first','second','final','completed'));

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS second_interview_message TEXT;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS final_interview_message TEXT;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMP;
