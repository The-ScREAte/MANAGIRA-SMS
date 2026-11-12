-- Custom editor: a section can be collected again each term or each school year, and can print
-- on report cards. Each answer remembers the term and school year it was given in.
-- Safe to run again.
ALTER TABLE custom_sections ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE custom_section_entries ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE custom_section_entries ADD COLUMN IF NOT EXISTS school_year_id INTEGER;
