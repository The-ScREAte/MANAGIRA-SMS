-- A school's choices for student files (utils/studentDocuments.js, feature student_documents):
-- whether Add student asks for at least one file for each new student (off unless the school
-- turns it on in Admissions › Admission Settings › Student fields).
CREATE TABLE IF NOT EXISTS student_document_settings (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
  required_on_add BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
