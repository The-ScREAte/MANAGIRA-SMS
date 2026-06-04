-- Saved Student ID Start Number
-- Keeps a dedicated lower bound for student ID auto-generation so schools can
-- deliberately start a new numbering range without losing gap-filling inside
-- that chosen range.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS student_id_start_number INTEGER DEFAULT NULL;
