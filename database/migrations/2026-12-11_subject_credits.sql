-- Course credits (feature gpa_credits, utils/gpa.js): how many credits a subject is worth. GPA is
-- grade points × credits over credits, and transcripts print credits attempted and earned. Empty
-- means 1 credit, so every school's GPA stays as it was until it sets credits. Safe to run again.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS gpa_credits NUMERIC(5, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subjects_gpa_credits_range') THEN
    ALTER TABLE subjects ADD CONSTRAINT subjects_gpa_credits_range CHECK (gpa_credits IS NULL OR (gpa_credits >= 0 AND gpa_credits <= 20));
  END IF;
END $$;
