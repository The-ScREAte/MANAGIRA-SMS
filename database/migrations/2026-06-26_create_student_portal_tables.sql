-- Migration: Student portal auth and testing room tables

CREATE TABLE IF NOT EXISTS student_accounts (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  login_email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  must_reset_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_accounts_org_email_unique
ON student_accounts (organization_id, LOWER(login_email));

CREATE TABLE IF NOT EXISTS student_assessment_attempts (
  attempt_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  assessment_id INTEGER NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
  question_set_id INTEGER REFERENCES assessment_question_sets(question_set_id) ON DELETE SET NULL,
  term_id INTEGER,
  class_id INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  score NUMERIC(10,2),
  max_score NUMERIC(10,2),
  auto_graded_score NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_attempts_lookup
ON student_assessment_attempts (organization_id, student_id, assessment_id, status);

CREATE TABLE IF NOT EXISTS student_assessment_responses (
  response_id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES student_assessment_attempts(attempt_id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES assessment_questions(question_id) ON DELETE CASCADE,
  response_text TEXT,
  response_json JSONB,
  is_correct BOOLEAN,
  awarded_marks NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);
