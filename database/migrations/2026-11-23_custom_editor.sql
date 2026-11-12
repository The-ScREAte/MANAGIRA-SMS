-- Custom editor: a section can live in the driver portal, and can take one submission only
-- (it disappears once sent). Safe to run again.
ALTER TABLE custom_sections DROP CONSTRAINT IF EXISTS custom_sections_filled_by_check;
ALTER TABLE custom_sections ADD CONSTRAINT custom_sections_filled_by_check CHECK (filled_by IN ('staff', 'parent', 'student', 'driver'));
ALTER TABLE custom_sections ADD COLUMN IF NOT EXISTS once BOOLEAN NOT NULL DEFAULT FALSE;
