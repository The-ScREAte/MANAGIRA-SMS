const db = require("../config/db");
const cacheManager = require("../utils/cacheManager");

const PERMISSION_CACHE_TTL_SEC = Number(process.env.PERMISSION_CACHE_TTL_SEC || 90);
const PERMISSIONS_DDL_LOGS_ENABLED = String(process.env.LOG_PERMISSION_DDL || "").trim().toLowerCase() === "true";

const MANAGER_LIKE_ROLES = new Set(["organization", "admin", "mini admin"]);

const PERMISSIONS = {
  MANAGE_EMPLOYEES: "manage_employees",
  MANAGE_STUDENTS: "manage_students",
  MANAGE_GUARDIANS: "manage_guardians",
  MANAGE_ASSESSMENTS: "manage_assessments",
  SET_ASSESSMENT_QUESTIONS: "set_assessment_questions",
  MARK_ATTENDANCE: "mark_attendance",
  MANAGE_REPORTS: "manage_reports",
  MANAGE_RECORDS: "manage_records",
  MANAGE_PROMOTIONS: "manage_promotions",
  APPROVE_PROMOTIONS: "approve_promotions",
  APPROVE_ADMISSIONS: "approve_admissions",
  PUBLISH_EVENTS_ANNOUNCEMENTS: "publish_events_announcements",
  MANAGE_SCHOOL_YEAR_TERMS: "manage_school_year_terms",
  ASSESS_OTHER_SCHOOL_YEARS: "assess_other_school_years",
  MANAGE_CLASSES_SUBJECTS: "manage_classes_subjects",
  GENERATE_TRANSCRIPTS: "generate_transcripts",
  MANAGE_BILLING: "manage_billing",
  MANAGE_SETTINGS: "manage_settings",
  MANAGE_PAYGIRA: "manage_paygira",
  MAILROOM: "mailroom",
  USE_MIRA: "use_mira",
};

// Not a PERMISSION_OPTIONS entry (so it never renders as its own checkbox) —
// it's an internal marker stored alongside "mailroom" in user_permissions to
// record that an employee's mailroom access is unrestricted (every guardian
// contact org-wide), vs. scoped to just the classes in user_mailroom_classes.
const MAILROOM_ALL_ACCESS_KEY = "mailroom_all_access";

const PERMISSION_OPTIONS = [
  { key: PERMISSIONS.MANAGE_EMPLOYEES, label: "Manage Employees" },
  { key: PERMISSIONS.MANAGE_STUDENTS, label: "Manage Students" },
  { key: PERMISSIONS.MANAGE_GUARDIANS, label: "Manage Guardians" },
  { key: PERMISSIONS.MANAGE_ASSESSMENTS, label: "Manage Assessments & Scores" },
  { key: PERMISSIONS.SET_ASSESSMENT_QUESTIONS, label: "Set Assessment Questions" },
  { key: PERMISSIONS.MARK_ATTENDANCE, label: "Mark Attendance" },
  { key: PERMISSIONS.MANAGE_REPORTS, label: "Manage Reports/Printing" },
  { key: PERMISSIONS.MANAGE_RECORDS, label: "Manage School Records" },
  { key: PERMISSIONS.MANAGE_PROMOTIONS, label: "Manage Promotions" },
  { key: PERMISSIONS.APPROVE_PROMOTIONS, label: "Approve Promotions" },
  { key: PERMISSIONS.APPROVE_ADMISSIONS, label: "Approve Admissions" },
  { key: PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, label: "Publish Events & Announcements" },
  { key: PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS, label: "Manage School Years & Terms" },
  { key: PERMISSIONS.ASSESS_OTHER_SCHOOL_YEARS, label: "Assess Other School Years (Classroom)" },
  { key: PERMISSIONS.MANAGE_CLASSES_SUBJECTS, label: "Manage Classes & Subjects" },
  { key: PERMISSIONS.GENERATE_TRANSCRIPTS, label: "Generate Transcripts" },
  { key: PERMISSIONS.MANAGE_BILLING, label: "Manage Billing" },
  { key: PERMISSIONS.MANAGE_SETTINGS, label: "Manage Organization Settings" },
  { key: PERMISSIONS.MANAGE_PAYGIRA, label: "PayGira (Finance & Billing)" },
  { key: PERMISSIONS.MAILROOM, label: "Mailroom (Send SMS/WhatsApp/Email)" },
  { key: PERMISSIONS.USE_MIRA, label: "Use Mira (AI Assistant)" },
];

// Permissions that only make sense when the school's plan includes the feature
// (names as in the features table / session.allowedFeatures, any one is enough).
// Mira depends on its integration being switched on instead.
const PERMISSION_FEATURES = {
  [PERMISSIONS.MANAGE_ASSESSMENTS]: ["Assessment Tracking"],
  [PERMISSIONS.SET_ASSESSMENT_QUESTIONS]: ["Set Assessment Questions", "Assessment Questions"],
  [PERMISSIONS.MARK_ATTENDANCE]: ["Attendance Tracking"],
  [PERMISSIONS.MANAGE_REPORTS]: ["Terminal Report", "Progressive Student Report"],
  [PERMISSIONS.GENERATE_TRANSCRIPTS]: ["Official School Transcript"],
  [PERMISSIONS.MANAGE_PAYGIRA]: ["PayGira", "Pay Gira", "PayGira & Payments", "PayGira and Payments"],
};

// The permission choices for this school: plan-tied ones only when the plan has
// them, Mira only when it is switched on. With no feature list known (it is set
// for every signed-in school), nothing is hidden.
function permissionOptionsFor({ allowedFeatures, miraActivated } = {}) {
  const features = Array.isArray(allowedFeatures) ? allowedFeatures : null;
  const have = new Set((features || []).map((name) => String(name || "").trim().toLowerCase()));
  return PERMISSION_OPTIONS.filter((option) => {
    if (option.key === PERMISSIONS.USE_MIRA && miraActivated === false) return false;
    const needs = PERMISSION_FEATURES[option.key];
    if (!needs || !features || !features.length) return true;
    return needs.some((name) => have.has(name.toLowerCase()));
  });
}

// Permissions only the main manager has until someone is given them by hand.
const GRANT_ONLY_PERMISSIONS = new Set([PERMISSIONS.ASSESS_OTHER_SCHOOL_YEARS]);

const MANAGER_DEFAULT_OPTIONAL_PERMISSIONS = PERMISSION_OPTIONS
  .map((option) => option.key)
  .filter((key) => !GRANT_ONLY_PERMISSIONS.has(key));

const ROLE_DEFAULT_PERMISSIONS = {
  // Manager gets all available permissions by default.
  // These same keys are pre-checked in the create/modify employee UI.
  // Spreading here so MANAGER_DEFAULT_OPTIONAL_PERMISSIONS changes automatically propagate.
  Manager: [...MANAGER_DEFAULT_OPTIONAL_PERMISSIONS],
  Teacher: [
    PERMISSIONS.MANAGE_STUDENTS,
    PERMISSIONS.MANAGE_ASSESSMENTS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.MANAGE_CLASSES_SUBJECTS,
    PERMISSIONS.MANAGE_REPORTS,
  ],
  Supervisor: [
    PERMISSIONS.MANAGE_STUDENTS,
    PERMISSIONS.MANAGE_GUARDIANS,
    PERMISSIONS.MANAGE_ASSESSMENTS,
    PERMISSIONS.SET_ASSESSMENT_QUESTIONS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.MANAGE_REPORTS,
    PERMISSIONS.APPROVE_ADMISSIONS,
    PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS,
    PERMISSIONS.MANAGE_CLASSES_SUBJECTS,
    PERMISSIONS.GENERATE_TRANSCRIPTS,
    PERMISSIONS.MANAGE_PROMOTIONS,
  ],
  // Drivers work only from the Driver dashboard (their routes and riders),
  // so they get no school-management permissions.
  Driver: [],
};

// Store the singleton on `global` so it is shared even if this module is
// evaluated more than once via different require() paths (e.g. circular deps
// or case-sensitivity differences on Windows). A module-level variable would
// be private to each module instance, causing the DDL to run multiple times.
async function ensurePermissionsSchema(database = db) {
  if (global._permissionsSchemaPromise) return global._permissionsSchemaPromise;

  global._permissionsSchemaPromise = (async () => {
    if (PERMISSIONS_DDL_LOGS_ENABLED) {
      console.info('[Permissions] ensurePermissionsSchema: running DDL...');
    }
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
    if (PERMISSIONS_DDL_LOGS_ENABLED) {
      console.info('[Permissions] ensurePermissionsSchema: DDL complete.');
    }
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

function normalizeRoleLower(role) {
  return normalizeRole(role).toLowerCase();
}

function isManagerRole(role) {
  return normalizeRoleLower(role) === "manager";
}

function isManagerLikeRole(role) {
  return MANAGER_LIKE_ROLES.has(normalizeRoleLower(role));
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

function isTransientPermissionDbError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('connection reset by peer')
  );
}

async function safePermissionCacheFetch(fetchFn, fallbackValue) {
  try {
    return await fetchFn();
  } catch (error) {
    if (isTransientPermissionDbError(error)) {
      console.warn('[Permissions] transient DB/cache fetch failure, using fallback value.');
      return fallbackValue;
    }
    throw error;
  }
}

async function getPrimaryManagerUserId(database, organizationId) {
  if (!organizationId) return null;

  const cacheKey = `perm:primary-manager:${organizationId}`;
  return safePermissionCacheFetch(
    () => cacheManager.getOrFetch(
      "organization",
      cacheKey,
      async () => {
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
      },
      { ttl: PERMISSION_CACHE_TTL_SEC }
    ),
    null
  );
}

async function getUserPermissions(database, userId, organizationId) {
  if (!userId || !organizationId) return [];
  await ensurePermissionsSchema(database);

  const cacheKey = `perm:user:${organizationId}:${userId}`;
  return safePermissionCacheFetch(
    () => cacheManager.getOrFetch(
      "organization",
      cacheKey,
      async () => {
      const result = await database.query(
        `SELECT permission_key FROM user_permissions WHERE user_id = $1 AND organization_id = $2`,
        [userId, organizationId]
      );
      return result.rows.map((row) => row.permission_key);
      },
      { ttl: PERMISSION_CACHE_TTL_SEC }
    ),
    []
  );
}

function invalidateUserPermissionCache(organizationId, userId) {
  if (!organizationId) {
    return;
  }

  cacheManager.invalidatePattern("organization", `perm:primary-manager:${organizationId}`);

  if (userId) {
    cacheManager.invalidatePattern("organization", `perm:user:${organizationId}:${userId}`);
    cacheManager.invalidatePattern("organization", `perm:user-role:${organizationId}:${userId}`);
  } else {
    cacheManager.invalidatePattern("organization", `perm:user:${organizationId}:`);
    cacheManager.invalidatePattern("organization", `perm:user-role:${organizationId}:`);
  }

  cacheManager.invalidatePattern("organization", `perm:owner-email:${organizationId}:`);
}

async function userHasPermission(database, { userId, userRole, organizationId, accountType, userEmail }, permissionKey) {
  if (!permissionKey) return true;
  if (!organizationId) return false;

  const normalizedUserRole = normalizeRole(userRole);
  const normalizedAccountType = normalizeRole(accountType);
  const normalizedAccountTypeLower = normalizeRoleLower(accountType);

  // Organization owner session (logs in via organizations table) should always
  // have full access within its own organization/plan.
  if (isManagerRole(normalizedUserRole) && normalizedAccountTypeLower === "organization") {
    return true;
  }

  // Any user record that matches the organization's signup email is the
  // organization owner and should always have full access.
  if (userEmail) {
    const ownerEmailResult = await safePermissionCacheFetch(
      () => cacheManager.getOrFetch(
        "organization",
        `perm:owner-email:${organizationId}:${String(userEmail).toLowerCase()}`,
        async () => {
        const ownerEmailQuery = await database.query(
          `SELECT 1
           FROM organizations
           WHERE organization_id = $1
             AND LOWER(email) = LOWER($2)
           LIMIT 1`,
          [organizationId, userEmail]
        );
        return ownerEmailQuery.rows.length > 0;
        },
        { ttl: PERMISSION_CACHE_TTL_SEC }
      ),
      false
    );

    if (ownerEmailResult) {
      if (userId && !isManagerRole(normalizedUserRole)) {
        await database.query(
          `UPDATE users
           SET account_type = 'Manager', updated_at = NOW()
           WHERE user_id = $1
             AND organization_id = $2`,
          [userId, organizationId]
        );
      }
      return true;
    }
  }

  if (isManagerLikeRole(userRole)) return true;
  if (!userId) return false;
  // Older driver records may still carry saved permission rows; drivers never
  // get school-management access (see ROLE_DEFAULT_PERMISSIONS.Driver).
  if (normalizedUserRole === "Driver") return false;

  await ensurePermissionsSchema(database);

  if (isManagerRole(normalizedUserRole)) {
    const managerPermissions = await getUserPermissions(database, userId, organizationId);
    const assignedPermissions = new Set(managerPermissions);
    return assignedPermissions.has(permissionKey);
  }

  const userPermissions = await getUserPermissions(database, userId, organizationId);
  const assignedPermissions = new Set(userPermissions);
  if (assignedPermissions.has(permissionKey)) return true;

  // Treat role defaults as baseline access for non-manager roles too. This keeps
  // older employee records working when new standard permissions are added to a
  // role after their original permission rows were saved.
  const roleDefaults = ROLE_DEFAULT_PERMISSIONS[normalizedUserRole];
  if (Array.isArray(roleDefaults) && roleDefaults.includes(permissionKey)) {
    return true;
  }

  return false;
}

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      const database = req.app.get("db") || db;
      const organizationId = req.session.organizationId;
      const userRole = req.session.userRole || req.session.user?.account_type || null;
      const accountType = req.session.accountType || req.session.user?.account_type || null;
      const userId = req.session.user?.user_id || req.session.userId || null;
      const userEmail = req.session.user?.email || null;

      const allowed = await userHasPermission(
        database,
        { userId, userRole, organizationId, accountType, userEmail },
        permissionKey
      );

      if (!allowed) {
        req.flash("error", "You do not have permission to access this page.");
        return res.redirect("/common/orgDashboard");
      }

      next();
    } catch (error) {
      console.error("[PermissionCheckError]", {
        route: req.originalUrl,
        permissionKey,
        organizationId: req.session?.organizationId,
        userId: req.session?.user?.user_id || req.session?.userId || null,
        userRole: req.session?.userRole || req.session?.user?.account_type || null,
        accountType: req.session?.accountType || req.session?.user?.account_type || null,
        sessionId: req.sessionID,
        error: error?.message,
      });
      req.flash("error", "Unable to verify your permissions.");
      return res.redirect("/common/orgDashboard");
    }
  };
}

module.exports = {
  PERMISSIONS,
  MAILROOM_ALL_ACCESS_KEY,
  PERMISSION_OPTIONS,
  permissionOptionsFor,
  ROLE_DEFAULT_PERMISSIONS,
  ensurePermissionsSchema,
  normalizePermissionsList,
  getDefaultPermissionsForRole,
  mergePermissionsForRole,
  getSuggestedPermissionsForRole,
  getPrimaryManagerUserId,
  getUserPermissions,
  userHasPermission,
  invalidateUserPermissionCache,
  requirePermission,
  isManagerLikeRole,
};
