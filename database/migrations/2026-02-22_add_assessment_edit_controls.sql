-- Add lock/activation/time-window controls for assessments
-- Safe to run multiple times.

BEGIN;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS edit_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_window_end TIMESTAMPTZ;

-- Ensure existing rows are not null for predictable behavior
UPDATE assessments
SET is_locked = COALESCE(is_locked, FALSE),
    is_active = COALESCE(is_active, TRUE)
WHERE is_locked IS NULL OR is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_group_control
  ON assessments (group_id, organization_id, term_id, is_locked, is_active);

COMMIT;
