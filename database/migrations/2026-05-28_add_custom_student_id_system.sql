-- Custom Student ID System
-- Allows schools to use their own student ID format (e.g. MGT001, STA-042)
-- All columns are backward-compatible: defaults mean existing rows are unaffected.

-- 1. Per-org settings on the organizations table
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS use_custom_student_id   BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_id_prefix        VARCHAR(10)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS student_id_auto_generate BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_id_counter       INTEGER      DEFAULT 0;

-- 2. Custom ID storage on the students table
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS custom_student_id VARCHAR(100) DEFAULT NULL;

-- 3. Unique constraint: two schools can share the same code, but within one
--    school every custom ID must be unique. Partial index only covers non-NULL
--    values so students without a custom ID are never blocked.
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_student_id_per_org
  ON students (organization_id, custom_student_id)
  WHERE custom_student_id IS NOT NULL;
