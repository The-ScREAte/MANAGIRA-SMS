-- A student's documents (utils/studentDocuments.js, feature student_documents): an insurance card,
-- a birth certificate, an IEP and the like, each with a type, title, note, expiry and who sees it.
-- The files themselves are private in storage (student-documents/<school>/<student>/).
CREATE TABLE IF NOT EXISTS student_documents (
  document_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  note TEXT,
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  expires_on DATE,
  shared_with TEXT NOT NULL DEFAULT 'staff' CHECK (shared_with IN ('staff', 'managers', 'family')),
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_student_documents_student ON student_documents (organization_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_documents_expiry ON student_documents (organization_id, expires_on) WHERE expires_on IS NOT NULL;
