-- Custom editor: a section can be collected every day or every week (a lunch count, a weekly
-- check-in), so each answer remembers the day it is for. Safe to run again.
ALTER TABLE custom_section_entries ADD COLUMN IF NOT EXISTS entry_date DATE;
UPDATE custom_section_entries SET entry_date = created_at::date WHERE entry_date IS NULL;
CREATE INDEX IF NOT EXISTS custom_section_entries_day_idx ON custom_section_entries (organization_id, section_id, entry_date);
