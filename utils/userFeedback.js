const FEEDBACK_TYPE_OPTIONS = Object.freeze([
  {
    value: "feature_request",
    label: "Feature Request",
    description: "Suggest a new tool, workflow, or improvement.",
  },
  {
    value: "bug_report",
    label: "Bug Report",
    description: "Report something broken or unreliable.",
  },
  {
    value: "review",
    label: "Review",
    description: "Rate your experience and tell us why.",
  },
  {
    value: "general",
    label: "General",
    description: "Share anything else on your mind.",
  },
  {
    value: "ux_design",
    label: "UX/Design",
    description: "Comment on clarity, flow, layout, or usability.",
  },
  {
    value: "performance",
    label: "Performance",
    description: "Flag speed, loading, or responsiveness issues.",
  },
]);

const FEEDBACK_AREA_OPTIONS = Object.freeze([
  { value: "students", label: "Students" },
  { value: "attendance", label: "Attendance" },
  { value: "assessments", label: "Assessments" },
  { value: "guardians", label: "Guardians" },
  { value: "payments", label: "Payments" },
  { value: "employees", label: "Employees" },
  { value: "reports", label: "Reports" },
  { value: "settings", label: "Settings" },
  { value: "notifications", label: "Notifications" },
  { value: "mobile", label: "Mobile" },
  { value: "other", label: "Other" },
]);

const FEEDBACK_PRIORITY_OPTIONS = Object.freeze([
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
]);

const FEEDBACK_STATUS_OPTIONS = Object.freeze([
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "done", label: "Done" },
]);

let feedbackSchemaReady = false;

function normalizeFeedbackToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");
}

function normalizeFeedbackType(value) {
  const token = normalizeFeedbackToken(value);
  const aliases = {
    feature: "feature_request",
    feature_request: "feature_request",
    bug: "bug_report",
    bug_report: "bug_report",
    review: "review",
    general: "general",
    ux: "ux_design",
    ux_design: "ux_design",
    design: "ux_design",
    performance: "performance",
  };
  const normalized = aliases[token] || token;
  return FEEDBACK_TYPE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "";
}

function normalizeFeedbackArea(value) {
  const normalized = normalizeFeedbackToken(value);
  return FEEDBACK_AREA_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "";
}

function normalizeFeedbackPriority(value) {
  const normalized = normalizeFeedbackToken(value);
  return FEEDBACK_PRIORITY_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "";
}

function normalizeFeedbackStatus(value) {
  const normalized = normalizeFeedbackToken(value);
  return FEEDBACK_STATUS_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "";
}

async function ensureUserFeedbackSchema(dbClient) {
  if (feedbackSchemaReady) return;

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS user_feedback (
      feedback_id SERIAL PRIMARY KEY,
      organization_id INTEGER,
      user_id INTEGER,
      user_name VARCHAR(255) NOT NULL,
      user_role VARCHAR(100),
      organization_name VARCHAR(255),
      feedback_type VARCHAR(30) NOT NULL,
      area VARCHAR(50) NOT NULL,
      subject VARCHAR(120) NOT NULL,
      message TEXT NOT NULL,
      rating SMALLINT,
      priority VARCHAR(20),
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS organization_id INTEGER`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_id INTEGER`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_role VARCHAR(100)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS organization_name VARCHAR(255)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS feedback_type VARCHAR(30)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS area VARCHAR(50)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS subject VARCHAR(120)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS message TEXT`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS rating SMALLINT`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS priority VARCHAR(20)`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'new'`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`).catch(() => {});
  await dbClient.query(`ALTER TABLE user_feedback ALTER COLUMN status SET DEFAULT 'new'`).catch(() => {});

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_user_feedback_status_created
      ON user_feedback(status, created_at DESC)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_user_feedback_type_created
      ON user_feedback(feedback_type, created_at DESC)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_user_feedback_org_created
      ON user_feedback(organization_id, created_at DESC)
  `);

  feedbackSchemaReady = true;
}

module.exports = {
  FEEDBACK_TYPE_OPTIONS,
  FEEDBACK_AREA_OPTIONS,
  FEEDBACK_PRIORITY_OPTIONS,
  FEEDBACK_STATUS_OPTIONS,
  normalizeFeedbackType,
  normalizeFeedbackArea,
  normalizeFeedbackPriority,
  normalizeFeedbackStatus,
  ensureUserFeedbackSchema,
};