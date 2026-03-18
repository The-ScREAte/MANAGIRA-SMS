ALTER TABLE employment
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE employment
SET is_active = TRUE
WHERE is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_employment_is_active
  ON employment(is_active);
