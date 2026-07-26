const crypto = require("crypto");

let schemaReady = false;

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  }
  return fallback;
}

function normalizeQuestionType(value) {
  const raw = String(value || "").trim().toLowerCase();
  const allowed = new Set(["multiple_choice", "single_choice", "true_false", "short_text", "essay"]);
  return allowed.has(raw) ? raw : "short_text";
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function createOauthState(payload = {}) {
  const statePayload = {
    ...payload,
    nonce: crypto.randomBytes(8).toString("hex"),
    ts: Date.now(),
  };
  return Buffer.from(JSON.stringify(statePayload), "utf8").toString("base64url");
}

function parseOauthState(rawState) {
  if (!rawState) return null;
  try {
    const decoded = Buffer.from(String(rawState), "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch (_) {
    return null;
  }
}

async function ensureGoogleIntegrationSchema(dbClient) {
  if (schemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS google_classroom_activated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS google_classroom_configured BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS google_classroom_client_email TEXT,
      ADD COLUMN IF NOT EXISTS google_classroom_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN IF NOT EXISTS google_classroom_access_token TEXT,
      ADD COLUMN IF NOT EXISTS google_classroom_refresh_token TEXT,
      ADD COLUMN IF NOT EXISTS google_classroom_token_expiry TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS google_classroom_last_sync_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS google_classroom_last_sync_status TEXT,
      ADD COLUMN IF NOT EXISTS google_classroom_last_sync_note TEXT,
      ADD COLUMN IF NOT EXISTS google_classroom_connected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS google_classroom_disconnected_at TIMESTAMPTZ
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS google_classroom_course_mappings (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      term_id INTEGER,
      class_id INTEGER NOT NULL,
      subject_id INTEGER,
      google_course_id TEXT NOT NULL,
      google_course_name TEXT,
      sync_status TEXT NOT NULL DEFAULT 'linked',
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, term_id, class_id, subject_id)
    )
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS assessment_question_sets (
      question_set_id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      term_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      assessment_id INTEGER,
      group_id BIGINT,
      set_title TEXT NOT NULL,
      set_description TEXT,
      total_points NUMERIC(10,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_assessment_question_sets_scope
      ON assessment_question_sets (organization_id, term_id, class_id, subject_id)
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS assessment_questions (
      question_id SERIAL PRIMARY KEY,
      question_set_id INTEGER NOT NULL REFERENCES assessment_question_sets(question_set_id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      question_text TEXT NOT NULL,
      options_json JSONB,
      answer_key TEXT,
      marks NUMERIC(10,2) NOT NULL DEFAULT 1,
      position_index INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_assessment_questions_set
      ON assessment_questions (question_set_id, position_index)
  `);

  schemaReady = true;
}

function buildIntegrationStatus(row = {}) {
  const activated = parseBoolean(row.google_classroom_activated, false);
  const configured = parseBoolean(row.google_classroom_configured, false);
  const connected = Boolean(
    row.google_classroom_refresh_token || row.google_classroom_access_token
  );

  return {
    activated,
    configured,
    connected,
    shouldShowFeatures: activated && configured && connected,
    clientEmail: row.google_classroom_client_email || "",
    scopes: Array.isArray(row.google_classroom_scopes) ? row.google_classroom_scopes : [],
    lastSyncAt: row.google_classroom_last_sync_at || null,
    lastSyncStatus: row.google_classroom_last_sync_status || "idle",
    lastSyncNote: row.google_classroom_last_sync_note || "",
    connectedAt: row.google_classroom_connected_at || null,
    disconnectedAt: row.google_classroom_disconnected_at || null,
  };
}

async function getGoogleIntegrationStatus(dbClient, organizationId) {
  if (!organizationId) return buildIntegrationStatus({});
  await ensureGoogleIntegrationSchema(dbClient);

  const result = await dbClient.query(
    `SELECT
       google_classroom_activated,
       google_classroom_configured,
       google_classroom_client_email,
       google_classroom_scopes,
       google_classroom_access_token,
       google_classroom_refresh_token,
       google_classroom_token_expiry,
       google_classroom_last_sync_at,
       google_classroom_last_sync_status,
       google_classroom_last_sync_note,
       google_classroom_connected_at,
       google_classroom_disconnected_at
     FROM organizations
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  return buildIntegrationStatus(result.rows[0] || {});
}

async function setGoogleIntegrationActivation(dbClient, organizationId, activated) {
  await ensureGoogleIntegrationSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
     SET google_classroom_activated = $2,
         google_classroom_configured = CASE WHEN $2 = FALSE THEN FALSE ELSE google_classroom_configured END,
         google_classroom_last_sync_status = CASE WHEN $2 = FALSE THEN 'disabled' ELSE google_classroom_last_sync_status END,
         google_classroom_last_sync_note = CASE WHEN $2 = FALSE THEN 'Integration disabled by administrator.' ELSE google_classroom_last_sync_note END
     WHERE organization_id = $1`,
    [organizationId, Boolean(activated)]
  );
}

async function storeGoogleOauthTokens(dbClient, organizationId, tokenPayload = {}) {
  await ensureGoogleIntegrationSchema(dbClient);
  const scopes = Array.isArray(tokenPayload.scopes) ? tokenPayload.scopes : [];

  await dbClient.query(
    `UPDATE organizations
     SET google_classroom_configured = TRUE,
         google_classroom_client_email = COALESCE($2, google_classroom_client_email),
         google_classroom_scopes = CASE WHEN cardinality($3::text[]) > 0 THEN $3::text[] ELSE COALESCE(google_classroom_scopes, ARRAY[]::text[]) END,
         google_classroom_access_token = COALESCE($4, google_classroom_access_token),
         google_classroom_refresh_token = COALESCE($5, google_classroom_refresh_token),
         google_classroom_token_expiry = $6,
         google_classroom_connected_at = NOW(),
         google_classroom_disconnected_at = NULL,
         google_classroom_last_sync_status = 'connected',
         google_classroom_last_sync_note = 'Google Classroom connected successfully.'
     WHERE organization_id = $1`,
    [
      organizationId,
      tokenPayload.clientEmail || null,
      scopes,
      tokenPayload.accessToken || null,
      tokenPayload.refreshToken || null,
      tokenPayload.expiryDate || null,
    ]
  );
}

async function markGoogleSync(dbClient, organizationId, status, note) {
  await ensureGoogleIntegrationSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
     SET google_classroom_last_sync_at = NOW(),
         google_classroom_last_sync_status = $2,
         google_classroom_last_sync_note = $3
     WHERE organization_id = $1`,
    [organizationId, String(status || "idle"), String(note || "")]
  );
}

async function disconnectGoogleIntegration(dbClient, organizationId) {
  await ensureGoogleIntegrationSchema(dbClient);
  await dbClient.query(
    `UPDATE organizations
     SET google_classroom_configured = FALSE,
         google_classroom_access_token = NULL,
         google_classroom_refresh_token = NULL,
         google_classroom_token_expiry = NULL,
         google_classroom_client_email = NULL,
         google_classroom_scopes = ARRAY[]::text[],
         google_classroom_disconnected_at = NOW(),
         google_classroom_last_sync_status = 'disconnected',
         google_classroom_last_sync_note = 'Google Classroom disconnected.'
     WHERE organization_id = $1`,
    [organizationId]
  );
}

function normalizeQuestionPayload(rawQuestions = []) {
  const input = Array.isArray(rawQuestions) ? rawQuestions : [];
  return input
    .map((question, index) => {
      const options = Array.isArray(question.options)
        ? question.options.map((opt) => String(opt || "").trim()).filter(Boolean)
        : safeJsonParse(question.options, []);
      const questionText = String(question.questionText || question.question_text || "").trim();
      const answerKey = String(question.answerKey || question.answer_key || "").trim();
      const marks = Number(question.marks || 1);
      const optionLayoutRaw = String(question.optionLayout || question.optionsLayout || "").trim().toLowerCase();
      const optionLayout = optionLayoutRaw === "side_by_side" ? "side_by_side" : "stacked";

      if (!questionText) return null;

      return {
        id: Number.isInteger(Number(question.id)) ? Number(question.id) : null,
        questionType: normalizeQuestionType(question.questionType || question.question_type),
        questionText,
        options: Array.isArray(options) ? options : [],
        optionLayout,
        answerKey,
        marks: Number.isFinite(marks) && marks > 0 ? marks : 1,
        positionIndex: Number.isInteger(Number(question.positionIndex))
          ? Number(question.positionIndex)
          : index,
      };
    })
    .filter(Boolean);
}

module.exports = {
  ensureGoogleIntegrationSchema,
  getGoogleIntegrationStatus,
  setGoogleIntegrationActivation,
  storeGoogleOauthTokens,
  markGoogleSync,
  disconnectGoogleIntegration,
  normalizeQuestionPayload,
  createOauthState,
  parseOauthState,
};
