-- Documents System Migration
-- Created: 2026-02-15
-- Description: Create tables for the collaborative document and spreadsheet system

-- Main documents table
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled Document',
  doc_type VARCHAR(20) NOT NULL DEFAULT 'document' CHECK (doc_type IN ('document', 'spreadsheet')),
  content TEXT DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_deleted BOOLEAN DEFAULT FALSE
);

-- Document permissions (who can access and at what level)
CREATE TABLE IF NOT EXISTS document_permissions (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  permission_level VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission_level IN ('view', 'edit', 'comment')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, user_id)
);

-- Document class assignments (link documents to classes)
CREATE TABLE IF NOT EXISTS document_class_assignments (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  include_students BOOLEAN DEFAULT FALSE,
  include_subjects BOOLEAN DEFAULT FALSE,
  permission_level VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission_level IN ('view', 'edit', 'comment')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, class_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_org_id ON documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(is_deleted);
CREATE INDEX IF NOT EXISTS idx_doc_permissions_doc_id ON document_permissions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_permissions_user_id ON document_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_doc_class_assignments_doc_id ON document_class_assignments(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_class_assignments_class_id ON document_class_assignments(class_id);
