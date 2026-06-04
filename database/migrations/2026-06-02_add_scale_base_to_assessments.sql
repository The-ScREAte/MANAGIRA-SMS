-- Add scale_base column to assessments table.
-- Defaults to 100 so all existing assessments are unaffected.
-- scale_base is the target number the raw score is scaled to for display (e.g. 100 means scale to /100).
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS scale_base INTEGER NOT NULL DEFAULT 100;
