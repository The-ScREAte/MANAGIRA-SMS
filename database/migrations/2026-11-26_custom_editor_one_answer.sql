-- Custom editor: one answer per student for each period (once, a day, a week, a term, a year),
-- even when two saves land in the same instant. Lists that grow ("any time") carry no key.
-- Safe to run again.
ALTER TABLE custom_section_entries ADD COLUMN IF NOT EXISTS period_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS custom_section_entries_one_idx ON custom_section_entries (section_id, student_id, period_key) WHERE period_key IS NOT NULL;
