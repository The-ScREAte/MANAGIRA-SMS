ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS cover_letter_url TEXT;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS cover_letter_s3_key TEXT;

ALTER TABLE employment_applications
  ADD COLUMN IF NOT EXISTS cover_letter_filename TEXT;
