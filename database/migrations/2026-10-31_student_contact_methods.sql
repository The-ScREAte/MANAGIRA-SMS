CREATE TABLE IF NOT EXISTS student_contact_methods (
  contact_method_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  contact_type VARCHAR(10) NOT NULL CHECK (contact_type IN ('email', 'phone')),
  contact_name VARCHAR(160) NOT NULL DEFAULT 'Student contact',
  value TEXT NOT NULL,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_contact_methods
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(160) NOT NULL DEFAULT 'Student contact';

CREATE UNIQUE INDEX IF NOT EXISTS student_contact_methods_unique_value
  ON student_contact_methods (organization_id, student_id, contact_type, LOWER(value));

CREATE INDEX IF NOT EXISTS student_contact_methods_student_idx
  ON student_contact_methods (organization_id, student_id, contact_type);
