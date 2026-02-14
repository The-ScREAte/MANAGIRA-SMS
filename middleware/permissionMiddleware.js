const db = require("../config/db");

const MANAGER_LIKE_ROLES = new Set(["Manager", "Organization", "Admin", "Mini Admin"]);

const PERMISSIONS = {
  MANAGE_EMPLOYEES: "manage_employees",
  MANAGE_STUDENTS: "manage_students",
  MANAGE_GUARDIANS: "manage_guardians",
  MANAGE_ASSESSMENTS: "manage_assessments",
  MARK_ATTENDANCE: "mark_attendance",
  MANAGE_REPORTS: "manage_reports",
  MANAGE_RECORDS: "manage_records",
  MANAGE_PROMOTIONS: "manage_promotions",
  APPROVE_PROMOTIONS: "approve_promotions",
  APPROVE_ADMISSIONS: "approve_admissions",
  PUBLISH_EVENTS_ANNOUNCEMENTS: "publish_events_announcements",
  MANAGE_SCHOOL_YEAR_TERMS: "manage_school_year_terms",
  MANAGE_CLASSES_SUBJECTS: "manage_classes_subjects",
  GENERATE_TRANSCRIPTS: "generate_transcripts",
  MANAGE_BILLING: "manage_billing",
  MANAGE_SETTINGS: "manage_settings",
};

const PERMISSION_OPTIONS = [
  { key: PERMISSIONS.MANAGE_EMPLOYEES, label: "Manage Employees" },
  { key: PERMISSIONS.MANAGE_STUDENTS, label: "Manage Students" },
  { key: PERMISSIONS.MANAGE_GUARDIANS, label: "Manage Guardians" },
  { key: PERMISSIONS.MANAGE_ASSESSMENTS, label: "Manage Assessments & Scores" },
  { key: PERMISSIONS.MARK_ATTENDANCE, label: "Mark Attendance" },
  { key: PERMISSIONS.MANAGE_REPORTS, label: "Manage Reports/Printing" },
  { key: PERMISSIONS.MANAGE_RECORDS, label: "Manage School Records" },
  { key: PERMISSIONS.MANAGE_PROMOTIONS, label: "Manage Promotions" },
  { key: PERMISSIONS.APPROVE_PROMOTIONS, label: "Approve Promotions" },
  { key: PERMISSIONS.APPROVE_ADMISSIONS, label: "Approve Admissions" },
  { key: PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, label: "Publish Events & Announcements" },
  { key: PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS, label: "Manage School Years & Terms" },
  { key: PERMISSIONS.MANAGE_CLASSES_SUBJECTS, label: "Manage Classes & Subjects" },
  { key: PERMISSIONS.GENERATE_TRANSCRIPTS, label: "Generate Transcripts" },
  { key: PERMISSIONS.MANAGE_BILLING, label: "Manage Billing" },
  { key: PERMISSIONS.MANAGE_SETTINGS, label: "Manage Organization Settings" },
];

const ROLE_DEFAULT_PERMISSIONS = {
  Teacher: [
    PERMISSIONS.MANAGE_ASSESSMENTS,
    PERMISSIONS.MARK_ATTENDANCE,
  ],
  Supervisor: [
    PERMISSIONS.MANAGE_STUDENTS,
    PERMISSIONS.MANAGE_GUARDIANS,
    PERMISSIONS.MANAGE_ASSESSMENTS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.MANAGE_REPORTS,
    PERMISSIONS.APPROVE_ADMISSIONS,
    PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS,
    PERMISSIONS.MANAGE_CLASSES_SUBJECTS,
    PERMISSIONS.GENERATE_TRANSCRIPTS,
    PERMISSIONS.MANAGE_PROMOTIONS,
  ],
};

let ensuredPermissionsSchema = false;

async function ensurePermissionsSchema(database = db) {
  if (ensuredPermissionsSchema) return;

  await database.query(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      permission_key VARCHAR(100) NOT NULL,
      granted_by INT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, permission_key)
    )
  `);

  await database.query(
    `CREATE INDEX IF NOT EXISTS idx_user_permissions_user_org ON user_permissions(user_id, organization_id)`
  );
  await database.query(
    `CREATE INDEX IF NOT EXISTS idx_user_permissions_perm_org ON user_permissions(permission_key, organization_id)`
  );

  ensuredPermissionsSchema = true;
}

function normalizeRole(role) {
  return String(role || "").trim();
}

function isManagerLikeRole(role) {
  return MANAGER_LIKE_ROLES.has(normalizeRole(role));
}

function normalizePermissionsList(rawPermissions) {
  const incoming = Array.isArray(rawPermissions)
    ? rawPermissions
    : rawPermissions
    ? [rawPermissions]
    : [];

  const validKeys = new Set(PERMISSION_OPTIONS.map((option) => option.key));

  return [...new Set(incoming.map((value) => String(value || "").trim()).filter((value) => validKeys.has(value)))];
}

function getDefaultPermissionsForRole(role) {
  const normalizedRole = normalizeRole(role);
  return ROLE_DEFAULT_PERMISSIONS[normalizedRole]
    ? [...ROLE_DEFAULT_PERMISSIONS[normalizedRole]]
    : [];
}

function mergePermissionsForRole(role, customPermissions = []) {
  const defaults = getDefaultPermissionsForRole(role);
  const custom = normalizePermissionsList(customPermissions);
  return [...new Set([...defaults, ...custom])];
}

async function getUserPermissions(database, userId, organizationId) {
  if (!userId || !organizationId) return [];
  await ensurePermissionsSchema(database);

  const result = await database.query(
    `SELECT permission_key FROM user_permissions WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId]
  );

  return result.rows.map((row) => row.permission_key);
}

async function userHasPermission(database, { userId, userRole, organizationId }, permissionKey) {
  if (!permissionKey) return true;
  if (!organizationId) return false;
  if (isManagerLikeRole(userRole)) return true;
  if (!userId) return false;

  await ensurePermissionsSchema(database);

  const result = await database.query(
    `SELECT 1 FROM user_permissions WHERE user_id = $1 AND organization_id = $2 AND permission_key = $3 LIMIT 1`,
    [userId, organizationId, permissionKey]
  );

  return result.rows.length > 0;
}

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      const database = req.app.get("db") || db;
      const organizationId = req.session.organizationId;
      const userRole = req.session.userRole;
      const userId = req.session.user?.user_id || req.session.userId || null;

      const allowed = await userHasPermission(
        database,
        { userId, userRole, organizationId },
        permissionKey
      );

      if (!allowed) {
        req.flash("error", "You do not have permission to access this page.");
        return res.redirect("/common/orgDashboard");
      }

      next();
    } catch (error) {
      req.flash("error", "Unable to verify your permissions.");
      return res.redirect("/common/orgDashboard");
    }
  };
}

module.exports = {
  PERMISSIONS,
  PERMISSION_OPTIONS,
  ROLE_DEFAULT_PERMISSIONS,
  ensurePermissionsSchema,
  normalizePermissionsList,
  getDefaultPermissionsForRole,
  mergePermissionsForRole,
  getUserPermissions,
  userHasPermission,
  requirePermission,
  isManagerLikeRole,
};
