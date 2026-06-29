let studentPortalSchemaReady = false;

function normalizeStudentEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

async function ensureStudentPortalSchema(dbClient) {
  if (studentPortalSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS student_portal_activated BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await dbClient.query(`
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
    )
  `);

  await dbClient.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_student_accounts_org_email_unique
    ON student_accounts (organization_id, LOWER(login_email))
  `);

  await dbClient.query(`
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
    )
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_student_attempts_lookup
    ON student_assessment_attempts (organization_id, student_id, assessment_id, status)
  `);

  await dbClient.query(`
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
    )
  `);

  studentPortalSchemaReady = true;
}

function buildStudentPortalIntegrationStatus(row = {}) {
  const activated = Boolean(row.student_portal_activated);
  return {
    activated,
    shouldShowFeatures: activated,
  };
}

async function getStudentPortalIntegrationStatus(dbClient, organizationId) {
  if (!organizationId) return buildStudentPortalIntegrationStatus({});
  await ensureStudentPortalSchema(dbClient);

  const result = await dbClient.query(
    `SELECT student_portal_activated
     FROM organizations
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  return buildStudentPortalIntegrationStatus(result.rows[0] || {});
}

async function setStudentPortalActivation(dbClient, organizationId, activated) {
  await ensureStudentPortalSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
     SET student_portal_activated = $2
     WHERE organization_id = $1`,
    [organizationId, Boolean(activated)]
  );
}

async function upsertStudentAccount(dbClient, options = {}) {
  const organizationId = Number(options.organizationId || 0);
  const studentId = Number(options.studentId || 0);
  const loginEmail = normalizeStudentEmail(options.loginEmail);

  if (!organizationId || !studentId || !loginEmail) {
    throw new Error("organizationId, studentId, and loginEmail are required.");
  }

  await ensureStudentPortalSchema(dbClient);

  const result = await dbClient.query(
    `INSERT INTO student_accounts (
       student_id,
       organization_id,
       login_email,
       password_hash,
       must_reset_password,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, NULL, TRUE, NOW(), NOW())
     ON CONFLICT (student_id, organization_id)
     DO UPDATE SET
       login_email = EXCLUDED.login_email,
       updated_at = NOW()
     RETURNING id, student_id, organization_id, login_email, password_hash, must_reset_password`,
    [studentId, organizationId, loginEmail]
  );

  return result.rows[0] || null;
}

module.exports = {
  ensureStudentPortalSchema,
  normalizeStudentEmail,
  upsertStudentAccount,
  getStudentPortalIntegrationStatus,
  setStudentPortalActivation,
};
