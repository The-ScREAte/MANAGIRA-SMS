-- Emergency & pickup details shared beyond the office (feature "family_sharing").
-- Each section of the parents & guardians fields (Admissions > Admission Settings >
-- Parents & guardians) says who else sees it: parents (who can also update it in
-- their portal), students, teachers (the class pickup list) and drivers (with the
-- driver permission "Pickup & Emergency"). Safe to run more than once.
ALTER TABLE IF EXISTS contact_field_sections
  ADD COLUMN IF NOT EXISTS shared_with TEXT[] NOT NULL DEFAULT '{}';
