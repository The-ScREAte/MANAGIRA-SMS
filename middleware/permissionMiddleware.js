const db = require("../config/db");

const MANAGER_LIKE_ROLES = new Set(["Organization", "Admin", "Mini Admin"]);

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

const MANAGER_DEFAULT_OPTIONAL_PERMISSIONS = PERMISSION_OPTIONS
  .map((option) => option.key)
  .filter(
    (permissionKey) =>
      permissionKey !== PERMISSIONS.MANAGE_BILLING &&
      permissionKey !== PERMISSIONS.MANAGE_SETTINGS
  );

const ROLE_DEFAULT_PERMISSIONS = {
  // Manager gets all permissions except Billing and Settings by default.
  // These same keys are pre-checked in the createEmployee UI via getSuggestedPermissionsForRole.
  // Spreading here so MANAGER_DEFAULT_OPTIONAL_PERMISSIONS changes automatically propagate.
  Manager: [...MANAGER_DEFAULT_OPTIONAL_PERMISSIONS],
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

// Store the singleton on `global` so it is shared even if this module is
// evaluated more than once via different require() paths (e.g. circular deps
// or case-sensitivity differences on Windows). A module-level variable would
// be private to each module instance, causing the DDL to run multiple times.
async function ensurePermissionsSchema(database = db) {
  if (global._permissionsSchemaPromise) return global._permissionsSchemaPromise;

  global._permissionsSchemaPromise = (async () => {
    console.info('[Permissions] ensurePermissionsSchema: running DDL...');
    await database.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        permission_key VARCHAR(100) NOT NULL,
        granted_by INT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, organization_id, permission_key)
      )
    `);

    await database.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'user_permissions_user_id_permission_key_key'
        ) THEN
          ALTER TABLE user_permissions
          DROP CONSTRAINT user_permissions_user_id_permission_key_key;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'user_permissions_user_org_perm_unique'
        ) THEN
          ALTER TABLE user_permissions
          ADD CONSTRAINT user_permissions_user_org_perm_unique
          UNIQUE (user_id, organization_id, permission_key);
        END IF;
      END
      $$;
    `);

    await database.query(
      `CREATE INDEX IF NOT EXISTS idx_user_permissions_user_org ON user_permissions(user_id, organization_id)`
    );
    await database.query(
      `CREATE INDEX IF NOT EXISTS idx_user_permissions_perm_org ON user_permissions(permission_key, organization_id)`
    );
    console.info('[Permissions] ensurePermissionsSchema: DDL complete.');
  })();

  // If DDL fails, clear the global so the next call can retry.
  global._permissionsSchemaPromise.catch(() => {
    global._permissionsSchemaPromise = null;
  });

  return global._permissionsSchemaPromise;
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

function getSuggestedPermissionsForRole(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "Manager") {
    return [...MANAGER_DEFAULT_OPTIONAL_PERMISSIONS];
  }

  return [];
}

async function getPrimaryManagerUserId(database, organizationId) {
  if (!organizationId) return null;

  const orgResult = await database.query(
    `
    SELECT email, first_name, last_name
    FROM organizations
    WHERE organization_id = $1
    LIMIT 1
  `,
    [organizationId]
  );

  const orgIdentity = orgResult.rows[0] || null;

  if (orgIdentity?.email) {
    const byEmail = await database.query(
      `
      SELECT user_id
      FROM users
      WHERE organization_id = $1
        AND account_type = 'Manager'
        AND email::text ILIKE $2
      ORDER BY created_at ASC NULLS LAST, user_id ASC
      LIMIT 1
    `,
      [organizationId, orgIdentity.email]
    );

    if (byEmail.rows.length > 0) {
      return byEmail.rows[0].user_id;
    }
  }

  if (orgIdentity?.first_name && orgIdentity?.last_name) {
    const byName = await database.query(
      `
      SELECT user_id
      FROM users
      WHERE organization_id = $1
        AND account_type = 'Manager'
        AND LOWER(first_name) = LOWER($2)
        AND LOWER(last_name) = LOWER($3)
      ORDER BY created_at ASC NULLS LAST, user_id ASC
      LIMIT 1
    `,
      [organizationId, orgIdentity.first_name, orgIdentity.last_name]
    );

    if (byName.rows.length > 0) {
      return byName.rows[0].user_id;
    }
  }

  const earliestManager = await database.query(
    `
    SELECT user_id
    FROM users
    WHERE organization_id = $1
      AND account_type = 'Manager'
    ORDER BY created_at ASC NULLS LAST, user_id ASC
    LIMIT 1
  `,
    [organizationId]
  );

  return earliestManager.rows[0]?.user_id || null;
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

  if (normalizeRole(userRole) === "Manager") {
    const primaryManagerUserId = await getPrimaryManagerUserId(database, organizationId);
    const isPrimaryManager =
      primaryManagerUserId !== null && String(primaryManagerUserId) === String(userId);

    const managerPermissionsResult = await database.query(
      `SELECT permission_key FROM user_permissions WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );

    if (managerPermissionsResult.rows.length === 0) {
      return isPrimaryManager
        ? true
        : MANAGER_DEFAULT_OPTIONAL_PERMISSIONS.includes(permissionKey);
    }

    const assignedPermissions = new Set(
      managerPermissionsResult.rows.map((row) => row.permission_key)
    );
    return assignedPermissions.has(permissionKey);
  }

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
  getSuggestedPermissionsForRole,
  getPrimaryManagerUserId,
  getUserPermissions,
  userHasPermission,
  requirePermission,
  isManagerLikeRole,
};
