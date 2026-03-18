ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS has_institution_experience BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS institution_experience_name TEXT;
