-- A parent's note about their child's lunch (a special request, an allergy): one per parent and
-- child, shown to the class's staff on the attendance sheet. Safe to run again.
CREATE TABLE IF NOT EXISTS lunch_notes (
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  guardian_id INTEGER NOT NULL,
  note VARCHAR(500) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, guardian_id)
);
CREATE INDEX IF NOT EXISTS idx_lunch_notes_org ON lunch_notes (organization_id, student_id);
