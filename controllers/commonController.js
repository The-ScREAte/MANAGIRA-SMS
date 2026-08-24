const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getMessagingChannelStatus } = require("./../utils/guardianMessaging");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config(); // Load environment variables from .env file
const { uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");
const axios = require("axios");
const he = require("he");
const { buildFailureNotification, sendEmailSafely, sendEmailInBackground, renderCleanEmail, recordEmailDeliveryFailure } = require("../utils/emailHelper");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { isEmailEnabledForRecipient, isOrgEmailEnabled } = require("../utils/emailPreferences");
const { getPaystackSettings } = require("../utils/paystackConfig");
const {
  PERMISSIONS,
  MAILROOM_ALL_ACCESS_KEY,
  PERMISSION_OPTIONS,
  ensurePermissionsSchema,
  normalizePermissionsList,
  mergePermissionsForRole,
  getSuggestedPermissionsForRole,
  getPrimaryManagerUserId,
  getUserPermissions,
  userHasPermission,
  isManagerLikeRole,
  invalidateUserPermissionCache,
} = require("../middleware/permissionMiddleware");
const { getOrgSwitchFeatureRestriction } = require("../utils/orgSwitchAccess");
const {
  toDateKey,
  ensureAttendanceCalendarSchema,
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  buildCalendarDayMap,
  isAttendanceCountableForDate,
  WEEKDAY_OPTIONS,
  getTermRecord,
} = require("../utils/attendanceCalendar");
const {
  WEEKDAY_OPTIONS: CLASS_SCHEDULE_WEEKDAYS,
  canManageClassSchedule,
  getClassScheduleBundle,
  getClassScheduleForTerm,
  getClassScheduleSubjects,
  getTermContext,
  saveClassSchedule: persistClassSchedule,
  deleteClassSchedule: removeClassSchedule,
  clonePreviousClassSchedule,
} = require("../utils/classScheduleService");
const { hasGuardianPortalFeature } = require("../utils/guardianPortalAccess");
const { getStripeClient, getStripePlatformClient, getStripePlatformCredentials, getStripeChargeCurrency, getStripeSettings, getActiveStripePublicKey, getStripeConnectAccountId, ensureStripeConnectAccountSchema } = require("../utils/stripeConfig");
const { getUsdRate, normalizeCurrencyCode } = require("../utils/currencyLocalization");
const {
  getPlatformFeeSettings,
  getOrgPlatformFeeBearer,
  buildPlatformChargeBreakdown,
} = require("../utils/platformFee");
const { ensurePaymentProviderSchema } = require("../utils/paymentProviderSchema");
const { resolveSchoolPayoutDestination } = require("../utils/payoutDestination");
const { settleFromPaystackTransaction } = require("../utils/paystackPayout");
const { triggerAbsenceAlertsForStudents, broadcastEventAnnouncement, notifyGuardiansOnClassChange, notifyTeacherOnReassignment, notifyTeachersOnAssessmentControl, resolveAssignmentNames, notifyEmployeeOnHoldChange, notifyGuardianAdmissionReceived, notifyGuardianOnStaffReply } = require("../utils/notificationDigestService");
const notifSvc = require("../utils/notificationService");
const {
  ensureOrganizationActivityLogSchema,
  getActivityLogFilterOptions,
  getOrganizationActivityLogs,
} = require("../utils/activityLog");
const {
  FEEDBACK_TYPE_OPTIONS,
  FEEDBACK_AREA_OPTIONS,
  FEEDBACK_PRIORITY_OPTIONS,
  ensureUserFeedbackSchema,
  normalizeFeedbackType,
  normalizeFeedbackArea,
  normalizeFeedbackPriority,
} = require("../utils/userFeedback");
const { buildStudentDisplayId } = require("../utils/studentIdDisplay");
const {
  buildNameSortExpression,
  formatDisplayName,
} = require("../utils/organizationDisplayPreferences");
const { COUNTRY_NAME_LOOKUP } = require("../utils/countries");
const {
  ensureGoogleIntegrationSchema,
  getGoogleIntegrationStatus,
  markGoogleSync,
  normalizeQuestionPayload,
} = require("../utils/googleClassroomIntegration");
const {
  pushPendingAssessmentsForOrganization,
} = require("../utils/googleClassroomSync");
const {
  ensureStudentPortalSchema,
  upsertStudentAccount,
  normalizeStudentEmail,
  getStudentPortalIntegrationStatus,
} = require("../utils/studentPortal");
const {
  ensureTransportationSchema,
  getTransportationIntegrationStatus,
  suggestNearestStop,
} = require("../utils/transportation");
const { getMiraIntegrationStatus } = require("../utils/miraIntegration");
const {
  getStudentTransportationSnapshot,
  getClassTransportationSnapshot,
} = require("./transportationController");

const SET_ASSESSMENT_QUESTION_FEATURE_NAMES = [
  "Set Assessment Questions",
  "Assessment Questions",
];

function hasOrgFeature(req, featureNames = []) {
  const allowed = Array.isArray(req?.session?.allowedFeatures)
    ? req.session.allowedFeatures
    : [];
  if (!allowed.length || !Array.isArray(featureNames) || !featureNames.length) {
    return false;
  }

  const allowedSet = new Set(allowed.map((value) => String(value || "").trim().toLowerCase()));
  return featureNames.some((name) => allowedSet.has(String(name || "").trim().toLowerCase()));
}

function hasSetAssessmentQuestionsFeature(req) {
  return hasOrgFeature(req, SET_ASSESSMENT_QUESTION_FEATURE_NAMES);
}

async function notifyManagersAndSupervisors(dbClient, { orgId, type, title, body = null, link = null, refId = null }) {
  const normalizedOrgId = Number(orgId || 0);
  if (!normalizedOrgId || !type || !title) return;

  const recipientsResult = await dbClient.query(
    `SELECT DISTINCT user_id
     FROM users
     WHERE organization_id = $1
       AND COALESCE(on_hold, FALSE) = FALSE
        AND LOWER(TRIM(account_type::text)) IN ('manager', 'supervisor')`,
    [normalizedOrgId]
  );

  const recipientIds = new Set(
    recipientsResult.rows
      .map((row) => Number(row.user_id))
      .filter((value) => Number.isFinite(value) && value > 0)
  );

  // Keep the organization owner/manager context informed as well.
  recipientIds.add(0);

  const notifications = Array.from(recipientIds).map((recipientId) => ({
    orgId: normalizedOrgId,
    recipientType: 'staff',
    recipientId,
    type,
    title,
    body,
    link,
    refId,
  }));

  await notifSvc.createNotifications(dbClient, notifications);
}

async function getActivePaystackConfig(dbClient) {
  const settings = await getPaystackSettings(dbClient);
  return {
    secretKey: settings.activeSecretKey || process.env.PAYSTACK_SECRET_KEY || "",
    publicKey: settings.activePublicKey || process.env.PAYSTACK_PUBLIC_KEY || "",
    mode: settings.mode,
  };
}

function parseNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function upsertStudentTransportationAssignment(dbClient, {
  organizationId,
  studentId,
  homeAddress,
  homeLatitude,
  homeLongitude,
}) {
  if (!organizationId || !studentId) return;

  await ensureTransportationSchema(dbClient);

  const normalizedAddress = String(homeAddress || "").trim() || null;
  const latitude = parseNumberOrNull(homeLatitude);
  const longitude = parseNumberOrNull(homeLongitude);

  let nearest = null;
  if (latitude !== null && longitude !== null) {
    nearest = await suggestNearestStop(dbClient, organizationId, latitude, longitude);
  }

  const routeId = nearest ? nearest.routeId : null;
  const stopId = nearest ? nearest.stopId : null;
  const distanceKm = nearest ? Number(nearest.distanceKm.toFixed(3)) : null;

  await dbClient.query(
    `INSERT INTO transport_student_assignments (
       organization_id, student_id, route_id, stop_id,
       home_address, home_latitude, home_longitude, distance_km, active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
     ON CONFLICT (organization_id, student_id)
     DO UPDATE SET
       route_id = COALESCE(EXCLUDED.route_id, transport_student_assignments.route_id),
       stop_id = COALESCE(EXCLUDED.stop_id, transport_student_assignments.stop_id),
       home_address = COALESCE(EXCLUDED.home_address, transport_student_assignments.home_address),
       home_latitude = COALESCE(EXCLUDED.home_latitude, transport_student_assignments.home_latitude),
       home_longitude = COALESCE(EXCLUDED.home_longitude, transport_student_assignments.home_longitude),
       distance_km = COALESCE(EXCLUDED.distance_km, transport_student_assignments.distance_km),
       active = TRUE,
       updated_at = NOW()`,
    [
      organizationId,
      studentId,
      routeId,
      stopId,
      normalizedAddress,
      latitude,
      longitude,
      distanceKm,
    ]
  );
}

let publicRegistrationSchemaReady = false;
let userMailroomClassesSchemaReady = false;
let guardianPaymentMethodSchemaReady = false;
let studentIdSettingsSchemaReady = false;
let studentEmailSchemaReady = false;
let studentAddressSchemaReady = false;
let studentDobUnknownSchemaReady = false;
let classDashboardLayoutSchemaReady = false;
let studentReportCustomRemarksColumnReady = false;
const TEACHER_REMARK_OPTIONS_CACHE_TTL_MS = 2 * 60 * 1000;
const teacherRemarkOptionsCache = new Map();
let ensuredOrganizationCustomRemarkTypesTable = false;

async function ensureOrganizationCustomRemarkTypesTable(dbClient) {
  if (ensuredOrganizationCustomRemarkTypesTable) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS organization_custom_remark_types (
      id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL,
      type_key TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, type_key)
    )
  `);
  ensuredOrganizationCustomRemarkTypesTable = true;
}

function buildCustomRemarkTypeDisplayLabel(entry) {
  var rawLabel = String(entry && entry.label ? entry.label : '').trim().replace(/\s+/g, ' ');
  if (rawLabel) return rawLabel;
  var fallbackKey = String(entry && entry.type_key ? entry.type_key : '').replace(/^custom:/, '');
  if (!fallbackKey) return 'Custom Remarks';
  return fallbackKey
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(function(part) { return part.charAt(0).toUpperCase() + part.slice(1); })
    .join(' ');
}

async function getOrganizationCustomRemarkTypes(dbClient, organizationId) {
  await ensureOrganizationCustomRemarkTypesTable(dbClient);
  var result = await dbClient.query(
    `SELECT type_key, label
     FROM organization_custom_remark_types
     WHERE organization_id = $1
     ORDER BY LOWER(label) ASC, id ASC`,
    [organizationId]
  );

  return (result.rows || [])
    .map(function(row) {
      return {
        type_key: String(row.type_key || '').trim().toLowerCase(),
        label: buildCustomRemarkTypeDisplayLabel(row),
      };
    })
    .filter(function(row) {
      return row.type_key.indexOf('custom:') === 0 && row.label;
    });
}

async function ensureStudentReportCustomRemarksColumn(dbClient) {
  if (studentReportCustomRemarksColumnReady) return;
  try {
    await dbClient.query(
      "ALTER TABLE student_reports ADD COLUMN IF NOT EXISTS custom_remarks_json JSONB"
    );
    studentReportCustomRemarksColumnReady = true;
  } catch (err) {
    console.error('[ensureStudentReportCustomRemarksColumn] Failed to add custom_remarks_json column', err);
  }
}

function normalizeClassroomRemarkTypes(value) {
  const allowedTypes = ["teacher", "conduct", "interest", "attitude"];
  const incoming = Array.isArray(value)
    ? value
    : (value === undefined || value === null ? [] : [value]);

  const normalized = incoming
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => allowedTypes.includes(entry) || entry.startsWith('custom:'));

  const unique = [...new Set(normalized)];
  return unique.length ? unique : ["teacher"];
}

function readClassroomRemarkTypesFromDisplaySettings(displaySettings) {
  const sections = displaySettings && typeof displaySettings.sections === "object"
    ? displaySettings.sections
    : {};

  if (!Object.prototype.hasOwnProperty.call(sections, "classroomRemarkTypes")) {
    return null;
  }

  return normalizeClassroomRemarkTypes(sections.classroomRemarkTypes);
}

function isTeacherOnlyRemarkTypeSet(types) {
  return Array.isArray(types) && types.length === 1 && types[0] === "teacher";
}

function pickPreferredClassroomRemarkTypes(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;

  var normalizedSets = rows
    .map(function(row) {
      return readClassroomRemarkTypesFromDisplaySettings(row?.display_settings || {});
    })
    .filter(function(types) {
      return Array.isArray(types) && types.length > 0;
    });

  if (!normalizedSets.length) return null;

  var firstNonDefault = normalizedSets.find(function(types) {
    return !isTeacherOnlyRemarkTypeSet(types);
  });

  return firstNonDefault || normalizedSets[0];
}

async function getConfiguredClassroomRemarkTypes(dbClient, organizationId, classId, termId) {
  const orgAnyTermResult = await dbClient.query(
    `SELECT display_settings
     FROM report_settings
     WHERE organization_id = $1
       AND jsonb_typeof(display_settings->'sections') = 'object'
       AND (display_settings->'sections' ? 'classroomRemarkTypes')
     ORDER BY setting_id DESC`,
    [organizationId]
  );

  const orgAnyTermTypes = pickPreferredClassroomRemarkTypes(orgAnyTermResult.rows);
  if (Array.isArray(orgAnyTermTypes) && orgAnyTermTypes.length) {
    return orgAnyTermTypes;
  }

  const classScopedResult = await dbClient.query(
    `SELECT display_settings
     FROM report_settings
     WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
     LIMIT 1`,
    [organizationId, classId, termId]
  );

  const classScopedTypes = readClassroomRemarkTypesFromDisplaySettings(
    classScopedResult.rows[0]?.display_settings || {}
  );
  if (Array.isArray(classScopedTypes) && classScopedTypes.length && !isTeacherOnlyRemarkTypeSet(classScopedTypes)) {
    return classScopedTypes;
  }

  const classAnyTermResult = await dbClient.query(
    `SELECT display_settings
     FROM report_settings
     WHERE organization_id = $1
       AND class_id = $2
       AND jsonb_typeof(display_settings->'sections') = 'object'
       AND (display_settings->'sections' ? 'classroomRemarkTypes')
     ORDER BY term_id DESC`,
    [organizationId, classId]
  );

  const classAnyTermTypes = pickPreferredClassroomRemarkTypes(classAnyTermResult.rows);
  if (Array.isArray(classAnyTermTypes) && classAnyTermTypes.length) {
    return classAnyTermTypes;
  }

  const termScopedResult = await dbClient.query(
    `SELECT display_settings
     FROM report_settings
     WHERE organization_id = $1
       AND term_id = $2
       AND jsonb_typeof(display_settings->'sections') = 'object'
       AND (display_settings->'sections' ? 'classroomRemarkTypes')
     ORDER BY class_id ASC`,
    [organizationId, termId]
  );

  const termScopedTypes = pickPreferredClassroomRemarkTypes(termScopedResult.rows);
  if (Array.isArray(termScopedTypes) && termScopedTypes.length) {
    return termScopedTypes;
  }

  if (Array.isArray(classScopedTypes) && classScopedTypes.length) {
    return classScopedTypes;
  }

  return ["teacher"];
}

function getTeacherRemarkOptionsCacheKey(organizationId, classId, termId, remarkTypes) {
  const normalizedTypes = normalizeClassroomRemarkTypes(remarkTypes).join(",");
  return `${String(organizationId || "")}:${String(classId || "")}:${String(termId || "")}:${normalizedTypes}`;
}

async function getTeacherRemarkOptionsCached(dbClient, organizationId, classId, termId, options = {}) {
  const forceRefresh = options && options.forceRefresh === true;
  const selectedRemarkTypes = normalizeClassroomRemarkTypes(options?.remarkTypes);
  const cacheKey = getTeacherRemarkOptionsCacheKey(organizationId, classId, termId, selectedRemarkTypes);
  const now = Date.now();
  const cacheEntry = teacherRemarkOptionsCache.get(cacheKey);

  if (!forceRefresh && cacheEntry && (now - cacheEntry.ts) < TEACHER_REMARK_OPTIONS_CACHE_TTL_MS) {
    return cacheEntry.options;
  }

  const teacherOptionsResult = await dbClient.query(
    `SELECT id, remark, remark_type
     FROM remarks
     WHERE organization_id = $1 AND remark_type = ANY($2::text[])
     ORDER BY LOWER(remark) ASC`,
    [organizationId, selectedRemarkTypes]
  );

  const nextOptions = Array.isArray(teacherOptionsResult.rows) ? teacherOptionsResult.rows : [];
  teacherRemarkOptionsCache.set(cacheKey, { ts: now, options: nextOptions });
  return nextOptions;
}

function roundCurrencyAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function quoteSqlIdentifier(identifier) {
  return `"${String(identifier || "").replace(/"/g, '""')}"`;
}

function requestExpectsJson(req) {
  const accept = String(req?.headers?.accept || "").toLowerCase();
  const contentType = String(req?.headers?.["content-type"] || "").toLowerCase();
  const requestedWith = String(req?.headers?.["x-requested-with"] || "").toLowerCase();
  return (
    Boolean(req?.xhr) ||
    requestedWith === "xmlhttprequest" ||
    accept.includes("application/json") ||
    contentType.includes("application/json")
  );
}

function formatDependencyTableName(tableName) {
  return String(tableName || "").replace(/_/g, " ").trim();
}

function buildSchoolYearDependencyErrorMessage(blockers = [], recordNoun = "school year") {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return `Cannot delete this ${recordNoun} because related records still exist.`;
  }

  const ordered = blockers
    .slice()
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const preview = ordered.slice(0, 6);
  const summary = preview
    .map((entry) => `${formatDependencyTableName(entry.tableName)} (${entry.count})`)
    .join(", ");
  const extraCount = ordered.length - preview.length;
  const extraSuffix = extraCount > 0 ? ` and ${extraCount} more area${extraCount === 1 ? "" : "s"}` : "";

  return `Cannot delete this ${recordNoun} because related records still exist in the system: ${summary}${extraSuffix}. Remove those records first, then try again.`;
}

async function collectSchoolYearDeletionBlockers(dbClient, { organizationId, schoolYearId, termIds = [] }) {
  const blockers = [];

  const getReferences = async (referencedTable, referencedColumn) => {
    const result = await dbClient.query(
      `SELECT
         tc.table_schema,
         tc.table_name,
         kcu.column_name,
         EXISTS (
           SELECT 1
           FROM information_schema.columns c
           WHERE c.table_schema = tc.table_schema
             AND c.table_name = tc.table_name
             AND c.column_name = 'organization_id'
         ) AS has_organization_id
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND ccu.table_schema = 'public'
         AND ccu.table_name = $1
         AND ccu.column_name = $2`,
      [referencedTable, referencedColumn]
    );
    return result.rows || [];
  };

  const schoolYearReferences = await getReferences("school_years", "id");
  const schoolYearSkipTables = new Set(["terms"]);

  for (const reference of schoolYearReferences) {
    const tableName = String(reference.table_name || "");
    if (!tableName || schoolYearSkipTables.has(tableName)) continue;

    const hasOrganizationId =
      reference.has_organization_id === true ||
      reference.has_organization_id === "t" ||
      reference.has_organization_id === 1;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM ${quoteSqlIdentifier(reference.table_schema)}.${quoteSqlIdentifier(tableName)}
      WHERE ${quoteSqlIdentifier(reference.column_name)} = $1
      ${hasOrganizationId ? "AND organization_id = $2" : ""}
    `;
    const params = hasOrganizationId
      ? [schoolYearId, organizationId]
      : [schoolYearId];
    const countResult = await dbClient.query(countQuery, params);
    const count = Number(countResult.rows[0]?.count || 0);
    if (count > 0) {
      blockers.push({
        tableName,
        count,
      });
    }
  }

  const termBlockers = await collectTermDeletionBlockers(dbClient, { organizationId, termIds, getReferences });
  blockers.push(...termBlockers);

  const dedupedByTable = new Map();
  for (const blocker of blockers) {
    const tableName = String(blocker.tableName || "").trim();
    if (!tableName) continue;
    const count = Number(blocker.count || 0);
    const prev = dedupedByTable.get(tableName) || 0;
    dedupedByTable.set(tableName, Math.max(prev, count));
  }

  return Array.from(dedupedByTable.entries()).map(([tableName, count]) => ({
    tableName,
    count,
  }));
}

// Same FK-scan approach as the school-year half above, split out so a
// single term can be checked for dependents on its own (deleteTerm below) -
// previously that endpoint deleted a term with zero safety check, unlike
// deleteSchoolYear which already ran this same scan.
async function collectTermDeletionBlockers(dbClient, { organizationId, termIds = [], getReferences: getReferencesOverride } = {}) {
  const safeTermIds = Array.isArray(termIds)
    ? termIds.map((termId) => Number(termId)).filter((termId) => Number.isInteger(termId))
    : [];
  if (!safeTermIds.length) return [];

  const getReferences =
    getReferencesOverride ||
    (async (referencedTable, referencedColumn) => {
      const result = await dbClient.query(
        `SELECT
           tc.table_schema,
           tc.table_name,
           kcu.column_name,
           EXISTS (
             SELECT 1
             FROM information_schema.columns c
             WHERE c.table_schema = tc.table_schema
               AND c.table_name = tc.table_name
               AND c.column_name = 'organization_id'
           ) AS has_organization_id
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'
           AND ccu.table_schema = 'public'
           AND ccu.table_name = $1
           AND ccu.column_name = $2`,
        [referencedTable, referencedColumn]
      );
      return result.rows || [];
    });

  const blockers = [];
  const termReferences = await getReferences("terms", "term_id");
  const termSkipTables = new Set(["term_classes"]);

  for (const reference of termReferences) {
    const tableName = String(reference.table_name || "");
    if (!tableName || termSkipTables.has(tableName)) continue;

    const hasOrganizationId =
      reference.has_organization_id === true ||
      reference.has_organization_id === "t" ||
      reference.has_organization_id === 1;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM ${quoteSqlIdentifier(reference.table_schema)}.${quoteSqlIdentifier(tableName)}
      WHERE ${quoteSqlIdentifier(reference.column_name)} = ANY($1::int[])
      ${hasOrganizationId ? "AND organization_id = $2" : ""}
    `;
    const params = hasOrganizationId ? [safeTermIds, organizationId] : [safeTermIds];
    const countResult = await dbClient.query(countQuery, params);
    const count = Number(countResult.rows[0]?.count || 0);
    if (count > 0) {
      blockers.push({ tableName, count });
    }
  }

  // Multiple FK constraints can reference terms.term_id from the same
  // table (e.g. separate columns for different attendance kinds), which
  // would otherwise show the same table name more than once in the
  // dependency message - collapse to one entry per table, keeping the
  // largest count seen.
  const dedupedByTable = new Map();
  for (const blocker of blockers) {
    const tableName = String(blocker.tableName || "").trim();
    if (!tableName) continue;
    const count = Number(blocker.count || 0);
    const prev = dedupedByTable.get(tableName) || 0;
    dedupedByTable.set(tableName, Math.max(prev, count));
  }

  return Array.from(dedupedByTable.entries()).map(([tableName, count]) => ({ tableName, count }));
}

// Same FK-scan approach as school years/terms above, for a class. This did
// NOT exist before - deleteClass only ever manually cleaned up `subjects`
// (its one legitimately-owned child, skipped below same as `terms` was for
// school years) and then hard-deleted the class row, relying entirely on
// the database's own ON DELETE CASCADE on students.class_id (and a dozen
// other tables: attendance_records, assessments, enrolled_students, etc.)
// to silently wipe every real student and their records with zero warning
// or way to stop it. This scan makes that impossible - any real dependent
// data blocks the delete instead of vanishing.
async function collectClassDeletionBlockers(dbClient, { organizationId, classId }) {
  const getReferences = async (referencedTable, referencedColumn) => {
    const result = await dbClient.query(
      `SELECT
         tc.table_schema,
         tc.table_name,
         kcu.column_name,
         EXISTS (
           SELECT 1
           FROM information_schema.columns c
           WHERE c.table_schema = tc.table_schema
             AND c.table_name = tc.table_name
             AND c.column_name = 'organization_id'
         ) AS has_organization_id
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND ccu.table_schema = 'public'
         AND ccu.table_name = $1
         AND ccu.column_name = $2`,
      [referencedTable, referencedColumn]
    );
    return result.rows || [];
  };

  const blockers = [];
  const references = await getReferences("classes", "class_id");
  const skipTables = new Set(["subjects"]);

  for (const reference of references) {
    const tableName = String(reference.table_name || "");
    if (!tableName || skipTables.has(tableName)) continue;

    const hasOrganizationId =
      reference.has_organization_id === true || reference.has_organization_id === "t" || reference.has_organization_id === 1;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM ${quoteSqlIdentifier(reference.table_schema)}.${quoteSqlIdentifier(tableName)}
      WHERE ${quoteSqlIdentifier(reference.column_name)} = $1
      ${hasOrganizationId ? "AND organization_id = $2" : ""}
    `;
    const params = hasOrganizationId ? [classId, organizationId] : [classId];
    const countResult = await dbClient.query(countQuery, params);
    const count = Number(countResult.rows[0]?.count || 0);
    if (count > 0) {
      blockers.push({ tableName, count });
    }
  }

  const dedupedByTable = new Map();
  for (const blocker of blockers) {
    const tableName = String(blocker.tableName || "").trim();
    if (!tableName) continue;
    const count = Number(blocker.count || 0);
    const prev = dedupedByTable.get(tableName) || 0;
    dedupedByTable.set(tableName, Math.max(prev, count));
  }
  return Array.from(dedupedByTable.entries()).map(([tableName, count]) => ({ tableName, count }));
}

async function convertAmountBetweenCurrencies(amount, fromCurrency, toCurrency) {
  const normalizedFrom = normalizeCurrencyCode(fromCurrency);
  const normalizedTo = normalizeCurrencyCode(toCurrency);
  const numericAmount = Number(amount || 0);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Invalid amount for currency conversion.");
  }

  if (!normalizedFrom || !normalizedTo) {
    throw new Error("Invalid currency for conversion.");
  }

  if (normalizedFrom === normalizedTo) {
    return roundCurrencyAmount(numericAmount);
  }

  const usdToFromRate = await getUsdRate(normalizedFrom);
  const usdToToRate = await getUsdRate(normalizedTo);

  if (!(usdToFromRate > 0) || !(usdToToRate > 0)) {
    throw new Error(`Unable to convert ${normalizedFrom} to ${normalizedTo}.`);
  }

  const amountInUsd = numericAmount / usdToFromRate;
  return roundCurrencyAmount(amountInUsd * usdToToRate);
}

async function ensureStudentIdSettingsSchema(dbClient) {
  if (studentIdSettingsSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS student_id_start_number INTEGER DEFAULT NULL
  `);

  studentIdSettingsSchemaReady = true;
}

async function ensureStudentEmailSchema(dbClient) {
  if (studentEmailSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS email VARCHAR(255)
  `);
  await dbClient.query(`
    ALTER TABLE pending_students
      ADD COLUMN IF NOT EXISTS email VARCHAR(255)
  `);

  studentEmailSchemaReady = true;
}

async function ensureStudentAddressSchema(dbClient) {
  if (studentAddressSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS address TEXT
  `);

  studentAddressSchemaReady = true;
}

async function ensureStudentDobUnknownSchema(dbClient) {
  if (studentDobUnknownSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS date_of_birth_unknown BOOLEAN NOT NULL DEFAULT FALSE
  `);

  studentDobUnknownSchemaReady = true;
}

async function ensureClassDashboardLayoutSchema(dbClient) {
  if (classDashboardLayoutSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE classes
      ADD COLUMN IF NOT EXISTS dashboard_sort_order INTEGER,
      ADD COLUMN IF NOT EXISTS dashboard_break_after BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await dbClient.query(`
    WITH ranked AS (
      SELECT
        class_id,
        ROW_NUMBER() OVER (
          PARTITION BY organization_id
          ORDER BY class_name ASC, class_id ASC
        ) AS sort_order
      FROM classes
    )
    UPDATE classes c
    SET dashboard_sort_order = ranked.sort_order
    FROM ranked
    WHERE c.class_id = ranked.class_id
      AND c.dashboard_sort_order IS NULL
  `);

  classDashboardLayoutSchemaReady = true;
}

const CLASS_DASHBOARD_ORDER_SQL = `
  COALESCE(dashboard_sort_order, 2147483647),
  class_name ASC,
  class_id ASC
`;

async function ensurePublicRegistrationSchema(dbClient) {
  if (publicRegistrationSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE public_registration_payments
      ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) NOT NULL DEFAULT 'paystack',
      ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
      ADD COLUMN IF NOT EXISTS pending_student_id INTEGER,
      ADD COLUMN IF NOT EXISTS guardian_id INTEGER,
      ADD COLUMN IF NOT EXISTS payment_method_snapshot JSONB
  `);
  await dbClient.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_public_registration_payments_stripe_session_id
      ON public_registration_payments (stripe_session_id)
      WHERE stripe_session_id IS NOT NULL
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_public_registration_payments_pending_student
      ON public_registration_payments (pending_student_id, organization_id)
  `);
  await ensureStripeConnectAccountSchema(dbClient).catch(() => {});
  // Make paystack_reference nullable so Stripe-only rows don't need it
  await dbClient.query(`
    ALTER TABLE public_registration_payments
      ALTER COLUMN paystack_reference DROP NOT NULL
  `).catch(() => {});

  publicRegistrationSchemaReady = true;
}

async function ensureUserBirthdaySchema(dbClient) {
  await dbClient.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
}

// Which classes' guardians a "mailroom"-scoped (not mailroom_all_access)
// employee can see/message — mirrors user_classes but kept separate so
// restricting mailroom visibility never touches an employee's actual
// teaching/homeroom class assignments.
async function ensureUserMailroomClassesSchema(dbClient) {
  if (userMailroomClassesSchemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS user_mailroom_classes (
      user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
      class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, class_id)
    )
  `);
  userMailroomClassesSchemaReady = true;
}

async function ensureGuardianBirthdaySchema(dbClient) {
  await dbClient.query(`ALTER TABLE guardians ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
  await dbClient.query(`ALTER TABLE guardian_profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE`).catch(() => {});
}

async function ensureGuardianPaymentMethodsSchema(dbClient) {
  if (!guardianPaymentMethodSchemaReady) {
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS guardian_payment_methods (
        card_id SERIAL PRIMARY KEY,
        guardian_id INTEGER NOT NULL,
        organization_id INTEGER NOT NULL,
        brand VARCHAR(50),
        last4 VARCHAR(4),
        holder_name VARCHAR(255),
        exp_month VARCHAR(2),
        exp_year VARCHAR(4),
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        student_id INTEGER NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await dbClient.query(`CREATE INDEX IF NOT EXISTS idx_gpm_guardian ON guardian_payment_methods(guardian_id, organization_id)`);
    guardianPaymentMethodSchemaReady = true;
  }

  await dbClient.query(`ALTER TABLE guardian_payment_methods ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'stripe'`).catch(() => {});
  await dbClient.query(`ALTER TABLE guardian_payment_methods ADD COLUMN IF NOT EXISTS external_payment_method_id VARCHAR(255)`).catch(() => {});
}

function normalizeGuardianPhoneForLookup(value) {
  return String(value || '').trim().replace(/[^\d+]/g, '');
}

async function getOccupiedStudentIdNumbers(dbClient, organizationId, excludeStudentId = null) {
  const params = [organizationId];
  let exclusionClause = '';

  if (Number.isInteger(Number(excludeStudentId)) && Number(excludeStudentId) > 0) {
    params.push(Number(excludeStudentId));
    exclusionClause = ' AND student_id <> $2';
  }

  const result = await dbClient.query(
    `SELECT DISTINCT occupied_number::int AS occupied_number
       FROM (
         SELECT student_id AS occupied_number
           FROM students
          WHERE organization_id = $1
            AND student_id IS NOT NULL
            AND student_id > 0
            ${exclusionClause}
         UNION
         SELECT NULLIF(REGEXP_REPLACE(COALESCE(custom_student_id, ''), '\\D', '', 'g'), '')::int AS occupied_number
           FROM students
          WHERE organization_id = $1
            AND NULLIF(REGEXP_REPLACE(COALESCE(custom_student_id, ''), '\\D', '', 'g'), '') IS NOT NULL
            ${exclusionClause}
       ) occupied_numbers
      WHERE occupied_number IS NOT NULL
        AND occupied_number > 0
      ORDER BY occupied_number ASC`,
    params
  );

  return result.rows
    .map((row) => Number(row.occupied_number) || 0)
    .filter((number) => Number.isInteger(number) && number > 0);
}

function getFirstAvailableStudentIdNumber(occupiedNumbers = [], startingNumber = 1, reservedNumbers = []) {
  const usedNumbers = new Set();

  [...occupiedNumbers, ...reservedNumbers].forEach((number) => {
    const parsed = Number(number);
    if (Number.isInteger(parsed) && parsed > 0) {
      usedNumbers.add(parsed);
    }
  });

  let candidate = Math.max(1, Number(startingNumber) || 1);
  while (usedNumbers.has(candidate)) {
    candidate += 1;
  }

  return candidate;
}

function getStudentIdSearchStart(occupiedNumbers = [], currentCounter = 0, configuredStartNumber = null) {
  const validOccupiedNumbers = occupiedNumbers.filter((number) => Number.isInteger(number) && number > 0);
  const explicitStartNumber = Number(configuredStartNumber);

  if (Number.isInteger(explicitStartNumber) && explicitStartNumber > 0) {
    return explicitStartNumber;
  }

  const configuredNextNumber = Math.max(1, Number(currentCounter) || 0) + 1;

  if (validOccupiedNumbers.length === 0) {
    return configuredNextNumber;
  }

  const minOccupiedNumber = Math.min(...validOccupiedNumbers);
  if (
    configuredNextNumber < minOccupiedNumber &&
    configuredNextNumber >= Math.max(1, minOccupiedNumber - 1)
  ) {
    return configuredNextNumber;
  }

  return minOccupiedNumber;
}

async function getNextSuggestedStudentIdNumber(dbClient, organizationId, currentCounter = 0, reservedNumbers = [], excludeStudentId = null, configuredStartNumber = null) {
  const occupiedNumbers = await getOccupiedStudentIdNumbers(dbClient, organizationId, excludeStudentId);
  const searchStart = getStudentIdSearchStart(occupiedNumbers, currentCounter, configuredStartNumber);
  return getFirstAvailableStudentIdNumber(occupiedNumbers, searchStart, reservedNumbers);
}

function getStudentIdEditorValue(student = {}, studentIdSettings = {}) {
  const prefix = studentIdSettings && studentIdSettings.use_custom_student_id
    ? String(studentIdSettings.student_id_prefix || '')
    : '';
  const customStudentId = String(student.custom_student_id || '').trim();

  if (customStudentId) {
    const withoutPrefix = prefix && customStudentId.toUpperCase().startsWith(prefix.toUpperCase())
      ? customStudentId.slice(prefix.length)
      : customStudentId;
    const digitsOnly = withoutPrefix.replace(/\D/g, '').trim();
    if (digitsOnly) {
      return digitsOnly;
    }
  }

  const systemStudentId = Number(student.student_id);
  if (!Number.isInteger(systemStudentId) || systemStudentId <= 0) {
    return '';
  }

  const systemIdText = String(systemStudentId);
  return systemIdText.padStart(Math.max(3, systemIdText.length), '0');
}

function normalizeSubjectCarryoverKey(subjectName = '') {
  return String(subjectName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getStudentAssignedSubjects(dbClient, organizationId, studentId) {
  const result = await dbClient.query(
    `SELECT ss.subject_id, s.subject_name
       FROM student_subjects ss
       INNER JOIN subjects s ON s.subject_id = ss.subject_id
      WHERE ss.student_id = $1 AND ss.organization_id = $2
      ORDER BY s.subject_name ASC`,
    [studentId, organizationId]
  );

  return result.rows;
}

async function getClassSubjectsForCarryover(dbClient, organizationId, classId) {
  const result = await dbClient.query(
    `SELECT subject_id, subject_name
       FROM subjects
      WHERE class_id = $1 AND organization_id = $2
      ORDER BY subject_name ASC`,
    [classId, organizationId]
  );

  return result.rows;
}

function mapSubjectsForNewClass(previousSubjects = [], targetClassSubjects = []) {
  const targetSubjectsByKey = new Map();
  targetClassSubjects.forEach((subject) => {
    const key = normalizeSubjectCarryoverKey(subject.subject_name);
    if (key && !targetSubjectsByKey.has(key)) {
      targetSubjectsByKey.set(key, subject);
    }
  });

  const matchedSubjects = [];
  const unmatchedSubjectNames = [];
  const usedSubjectIds = new Set();

  previousSubjects.forEach((subject) => {
    const key = normalizeSubjectCarryoverKey(subject.subject_name);
    const matched = key ? targetSubjectsByKey.get(key) : null;

    if (matched && !usedSubjectIds.has(matched.subject_id)) {
      usedSubjectIds.add(matched.subject_id);
      matchedSubjects.push(matched);
      return;
    }

    if (subject && subject.subject_name) {
      unmatchedSubjectNames.push(subject.subject_name);
    }
  });

  return {
    matchedSubjects,
    unmatchedSubjectNames,
  };
}

async function replaceStudentSubjects(dbClient, organizationId, studentId, subjectIds = []) {
  await dbClient.query(
    `DELETE FROM student_subjects WHERE student_id = $1 AND organization_id = $2`,
    [studentId, organizationId]
  );

  for (const subjectId of subjectIds) {
    await dbClient.query(
      `INSERT INTO student_subjects (student_id, subject_id, organization_id)
       VALUES ($1, $2, $3)`,
      [studentId, subjectId, organizationId]
    );
  }
}

async function carryStudentSubjectsToClass(dbClient, {
  organizationId,
  studentId,
  newClassId,
  keepExistingSubjects = false,
}) {
  if (!Number.isInteger(Number(studentId)) || !Number.isInteger(Number(newClassId))) {
    return {
      keptSubjects: false,
      assignedSubjectIds: [],
      matchedSubjectNames: [],
      unmatchedSubjectNames: [],
    };
  }

  const previousSubjects = await getStudentAssignedSubjects(dbClient, organizationId, Number(studentId));

  if (!keepExistingSubjects) {
    await replaceStudentSubjects(dbClient, organizationId, Number(studentId), []);
    return {
      keptSubjects: false,
      assignedSubjectIds: [],
      matchedSubjectNames: [],
      unmatchedSubjectNames: previousSubjects.map((subject) => subject.subject_name).filter(Boolean),
    };
  }

  const targetClassSubjects = await getClassSubjectsForCarryover(dbClient, organizationId, Number(newClassId));
  const { matchedSubjects, unmatchedSubjectNames } = mapSubjectsForNewClass(previousSubjects, targetClassSubjects);
  const assignedSubjectIds = matchedSubjects.map((subject) => subject.subject_id);

  await replaceStudentSubjects(dbClient, organizationId, Number(studentId), assignedSubjectIds);

  return {
    keptSubjects: true,
    assignedSubjectIds,
    matchedSubjectNames: matchedSubjects.map((subject) => subject.subject_name),
    unmatchedSubjectNames,
  };
}

function buildSubjectCarryoverNotice(carryoverResult = {}, clearMessage = 'Previous subjects were not carried into the new class.') {
  const matchedSubjectNames = Array.isArray(carryoverResult.matchedSubjectNames)
    ? carryoverResult.matchedSubjectNames.filter(Boolean)
    : [];
  const unmatchedSubjectNames = Array.isArray(carryoverResult.unmatchedSubjectNames)
    ? carryoverResult.unmatchedSubjectNames.filter(Boolean)
    : [];

  if (!carryoverResult.keptSubjects) {
    return {
      message: clearMessage,
      skippedMessage: unmatchedSubjectNames.length
        ? `Subjects not added to this class: ${unmatchedSubjectNames.join(', ')}.`
        : '',
    };
  }

  if (!matchedSubjectNames.length && !unmatchedSubjectNames.length) {
    return { message: '', skippedMessage: '' };
  }

  return {
    message: matchedSubjectNames.length
      ? `Moved matching subjects into the new class: ${matchedSubjectNames.join(', ')}.`
      : 'No previous subjects matched the new class.',
    skippedMessage: unmatchedSubjectNames.length
      ? `Subjects not added to this class: ${unmatchedSubjectNames.join(', ')}.`
      : '',
  };
}

function parseKeepExistingSubjectsPreference(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'keep', 'carry'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'clear', 'reset'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function summarizeSubjectNames(subjectNames = [], maxNames = 8) {
  const uniqueNames = [...new Set((subjectNames || []).filter(Boolean))];
  if (!uniqueNames.length) {
    return '';
  }
  if (uniqueNames.length <= maxNames) {
    return uniqueNames.join(', ');
  }

  const visibleNames = uniqueNames.slice(0, maxNames).join(', ');
  return `${visibleNames}, and ${uniqueNames.length - maxNames} more`;
}

function buildBulkSubjectCarryoverNotice(results = [], keepExistingSubjects = false) {
  const matchedSubjectNames = [];
  const unmatchedSubjectNames = [];

  results.forEach((result) => {
    if (Array.isArray(result && result.matchedSubjectNames)) {
      matchedSubjectNames.push(...result.matchedSubjectNames);
    }
    if (Array.isArray(result && result.unmatchedSubjectNames)) {
      unmatchedSubjectNames.push(...result.unmatchedSubjectNames);
    }
  });

  const matchedSummary = summarizeSubjectNames(matchedSubjectNames);
  const unmatchedSummary = summarizeSubjectNames(unmatchedSubjectNames);

  if (!keepExistingSubjects) {
    return {
      message: 'Previous subjects were not carried into the new class for the selected students.',
      skippedMessage: unmatchedSummary ? `Subjects not added to this class: ${unmatchedSummary}.` : '',
    };
  }

  return {
    message: matchedSummary
      ? `Moved matching subjects into the new class where available: ${matchedSummary}.`
      : 'No previous subjects matched the new class for the selected students.',
    skippedMessage: unmatchedSummary ? `Subjects not added to this class: ${unmatchedSummary}.` : '',
  };
}

async function isStudentIdTaken(dbClient, organizationId, customId, numericStudentId = null, excludeStudentId = null) {
  const params = [organizationId];
  let query = `SELECT 1 FROM students WHERE organization_id = $1`;

  if (Number.isInteger(Number(excludeStudentId)) && Number(excludeStudentId) > 0) {
    params.push(Number(excludeStudentId));
    query += ` AND student_id <> $2`;
  }

  const conditions = [];
  if (customId) {
    params.push(customId);
    conditions.push(`custom_student_id = $${params.length}`);
  }
  if (Number.isInteger(Number(numericStudentId)) && Number(numericStudentId) > 0) {
    params.push(Number(numericStudentId));
    conditions.push(`student_id = $${params.length}`);
  }

  if (!conditions.length) {
    return false;
  }

  query += ` AND (${conditions.join(' OR ')}) LIMIT 1`;
  const result = await dbClient.query(query, params);
  return result.rows.length > 0;
}

async function ensureGuardianPortalProfileAndAccount(dbClient, options = {}) {
  const organizationId = Number(options.organizationId || 0);
  if (!organizationId) return null;

  const firstName = String(options.firstName || '').trim();
  const lastName = String(options.lastName || '').trim();
  const hometown = String(options.hometown || '').trim() || null;
  const imageUrl = String(options.imageUrl || '').trim() || null;
  const email = String(options.email || '').trim().toLowerCase() || null;
  const phone = normalizeGuardianPhoneForLookup(options.phone);
  let guardianId = null;

  if (email) {
    const emailMatch = await dbClient.query(
      `SELECT guardian_id FROM guardian_profiles WHERE organization_id = $1 AND LOWER(COALESCE(email, '')) = $2 LIMIT 1`,
      [organizationId, email]
    );
    guardianId = emailMatch.rows[0]?.guardian_id || null;
  }

  if (!guardianId && phone) {
    const phoneMatch = await dbClient.query(
      `SELECT guardian_id
         FROM guardian_profiles
        WHERE organization_id = $1
          AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $2
        LIMIT 1`,
      [organizationId, phone]
    );
    guardianId = phoneMatch.rows[0]?.guardian_id || null;
  }

  if (guardianId) {
    await dbClient.query(
      `UPDATE guardian_profiles
          SET first_name = COALESCE(NULLIF($1, ''), first_name),
              last_name = COALESCE(NULLIF($2, ''), last_name),
              phone = COALESCE(NULLIF($3, ''), phone),
              email = COALESCE(NULLIF($4, ''), email),
              hometown = COALESCE($5, hometown),
              image_url = COALESCE($6, image_url),
              updated_at = NOW()
        WHERE guardian_id = $7 AND organization_id = $8`,
      [firstName, lastName, phone, email, hometown, imageUrl, guardianId, organizationId]
    );
  } else {
    const inserted = await dbClient.query(
      `INSERT INTO guardian_profiles
        (organization_id, first_name, last_name, phone, email, hometown, image_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING guardian_id`,
      [organizationId, firstName || 'Guardian', lastName || null, phone || null, email, hometown, imageUrl]
    );
    guardianId = inserted.rows[0]?.guardian_id || null;
  }

  if (!guardianId || (!email && !phone)) {
    return guardianId;
  }

  const tempHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

  if (email) {
    const existingByEmail = await dbClient.query(
      `SELECT id FROM guardian_accounts WHERE organization_id = $1 AND LOWER(COALESCE(login_email, '')) = $2 LIMIT 1`,
      [organizationId, email]
    );

    if (existingByEmail.rows.length) {
      await dbClient.query(
        `UPDATE guardian_accounts
            SET guardian_id = $1,
                login_phone = COALESCE($2, login_phone),
                updated_at = NOW()
          WHERE id = $3`,
        [guardianId, phone || null, existingByEmail.rows[0].id]
      );
    } else {
      await dbClient.query(
        `INSERT INTO guardian_accounts
          (organization_id, guardian_id, login_email, login_phone, password_hash, must_reset_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())`,
        [organizationId, guardianId, email, phone || null, tempHash]
      );
    }
  } else if (phone) {
    const existingByPhone = await dbClient.query(
      `SELECT id FROM guardian_accounts WHERE organization_id = $1 AND login_phone = $2 LIMIT 1`,
      [organizationId, phone]
    );

    if (existingByPhone.rows.length) {
      await dbClient.query(
        `UPDATE guardian_accounts
            SET guardian_id = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [guardianId, existingByPhone.rows[0].id]
      );
    } else {
      await dbClient.query(
        `INSERT INTO guardian_accounts
          (organization_id, guardian_id, login_phone, password_hash, must_reset_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
        [organizationId, guardianId, phone, tempHash]
      );
    }
  }

  return guardianId;
}

async function saveGuardianPortalPaymentMethod(dbClient, options = {}) {
  const guardianId = Number(options.guardianId || 0);
  const organizationId = Number(options.organizationId || 0);
  if (!guardianId || !organizationId || !options.last4) return null;

  await ensureGuardianPaymentMethodsSchema(dbClient);

  const brand = String(options.brand || 'card').trim() || 'card';
  const last4 = String(options.last4 || '').trim();
  const holderName = String(options.holderName || '').trim() || null;
  const expMonth = options.expMonth == null ? null : String(options.expMonth).trim();
  const expYear = options.expYear == null ? null : String(options.expYear).trim();
  const provider = String(options.provider || 'stripe').trim() || 'stripe';
  const externalPaymentMethodId = String(options.externalPaymentMethodId || '').trim() || null;
  const studentId = options.studentId ? Number(options.studentId) : null;

  const existing = await dbClient.query(
    `SELECT card_id
       FROM guardian_payment_methods
      WHERE guardian_id = $1
        AND organization_id = $2
        AND LOWER(COALESCE(brand, '')) = LOWER($3)
        AND COALESCE(last4, '') = $4
        AND COALESCE(exp_month, '') = COALESCE($5, '')
        AND COALESCE(exp_year, '') = COALESCE($6, '')
      LIMIT 1`,
    [guardianId, organizationId, brand, last4, expMonth, expYear]
  );

  if (existing.rows.length) {
    await dbClient.query(
      `UPDATE guardian_payment_methods
          SET holder_name = COALESCE($1, holder_name),
              student_id = COALESCE($2, student_id),
              provider = COALESCE($3, provider),
              external_payment_method_id = COALESCE($4, external_payment_method_id)
        WHERE card_id = $5`,
      [holderName, studentId, provider, externalPaymentMethodId, existing.rows[0].card_id]
    );
    return existing.rows[0].card_id;
  }

  const countResult = await dbClient.query(
    `SELECT COUNT(*)::int AS n FROM guardian_payment_methods WHERE guardian_id = $1 AND organization_id = $2`,
    [guardianId, organizationId]
  );
  const makeDefault = countResult.rows[0]?.n === 0;

  if (makeDefault) {
    await dbClient.query(
      `UPDATE guardian_payment_methods SET is_default = false WHERE guardian_id = $1 AND organization_id = $2`,
      [guardianId, organizationId]
    );
  }

  const inserted = await dbClient.query(
    `INSERT INTO guardian_payment_methods
      (guardian_id, organization_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id, provider, external_payment_method_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING card_id`,
    [guardianId, organizationId, brand, last4, holderName, expMonth, expYear, makeDefault, studentId, provider, externalPaymentMethodId]
  );

  return inserted.rows[0]?.card_id || null;
}

// Helper function for ordinal suffixes (1st, 2nd, 3rd, etc.)
function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Header aliases for robust bulk import across many source formats
const FIELD_ALIASES = {
  firstName: [
    'First Name', 'Given Name', 'Student First Name', 'Forename', 'Christian Name', 'Personal Name',
    'Legal First Name', 'Child First Name', 'Pupil First Name', 'Learner First Name', 'Applicant First Name',
    'Student Given Name', 'Primary Name', 'Name (First)', 'FName', 'First_Name', 'Stu_First',
    'Child Given Name', 'Registered First Name', 'Preferred First Name', 'FirstName', 'firstname'
  ],
  lastName: [
    'Last Name', 'Surname', 'Family Name', 'Student Last Name', 'Legal Last Name', 'Child Surname',
    'Pupil Surname', 'Learner Last Name', 'Applicant Surname', 'Name (Last)', 'LName', 'Last_Name',
    'Stu_Last', 'Registered Surname', 'Birth Surname', 'Family Surname', 'Parent Surname',
    'Household Name', 'Clan Name', 'Maiden Name', 'LastName', 'lastname'
  ],
  dateOfBirth: [
    'Date of Birth', 'DOB', 'D.O.B', 'Birth Date', 'Birthdate', 'Date Born', 'Student DOB', 'Child DOB',
    'Pupil Birth Date', 'Learner DOB', 'Applicant DOB', 'Date_Of_Birth', 'Birth_Date', 'BDate', 'D/B', 'D-O-B',
    'Registered Birth Date', 'Legal Date of Birth', 'Date of Delivery', 'Birth Information', 'DateOfBirth'
  ],
  gender: [
    'Gender', 'Sex', 'Student Gender', 'Biological Sex', 'Gender Identity', 'Child Gender', 'Pupil Gender',
    'Learner Gender', 'Applicant Gender', 'M/F', 'Male/Female', 'Gender Type', 'Sex Type', 'Gender Category',
    'Gender Option', 'Student Sex', 'Gender Status', 'Biological Gender', 'Registered Gender', 'Identity (Gender)'
  ],
  hometown: [
    'Hometown', 'City', 'Town', 'City of Residence', 'Place of Residence', 'Residential City', 'Home City',
    'Current City', 'Origin', 'Place of Origin', 'District', 'Municipality', 'County', 'State', 'Province',
    'Local Area', 'Address City', 'Location', 'Area', 'Community', 'Student Hometown'
  ],
  studentAddress: [
    'Student Address', 'Student Residential Address', 'Student Home Address', 'Residential Address',
    'Home Address', 'House Address', 'Street Address', 'Address', 'Address Line 1', 'Residence Address',
    'Student Addr', 'Student Add', 'Stud Address', 'Stu Address'
  ],
  studentEmail: [
    'Student Email', 'Student E-mail', 'Student Email Address', 'Student Contact Email', 'Learner Email',
    'Pupil Email', 'Applicant Email', 'Child Email'
  ],
  class: [
    'Class', 'Grade', 'Grade Level', 'Class Level', 'Academic Level', 'Year Level', 'Form', 'Standard',
    'Class Group', 'Section', 'Division', 'Batch', 'Stream', 'Cohort', 'Level', 'Academic Year Level',
    'School Level', 'Learning Level', 'Stage', 'Study Level'
  ],
  graduationYear: [
    'Graduation Year', 'Graduation Group', 'Graduation Class', 'Grad Year', 'Class Year', 'Year of Graduation',
    'Grad Cohort', 'Graduation Batch', 'Alumni Group', 'Passing Out Year', 'Completion Year', 'Final Year Group',
    'Exit Year', 'Senior Year', 'Graduation Cycle', 'Year Group', 'Finishing Year', 'School Leaving Year',
    'Degree Year', 'Graduation Year Group'
  ],
  subjects: [
    'Subjects', 'Subject List', 'Courses', 'Enrolled Subjects', 'Registered Subjects', 'Study Subjects',
    'Academic Subjects', 'Course Selection', 'Selected Courses', 'Learning Subjects', 'Modules', 'Units',
    'Study Units', 'Subject Choices', 'Curriculum', 'Subjects Offered', 'Class Subjects', 'Program Subjects',
    'Study Program', 'Academic Courses', 'Subject'
  ],
  guardianFirstName: [
    'Guardian 1 First Name', 'Guardian First Name', 'Parent First Name', 'Legal Guardian First Name',
    'Primary Guardian First Name', 'Father First Name', 'Mother First Name', 'Caregiver First Name'
  ],
  guardianLastName: [
    'Guardian 1 Last Name', 'Guardian Last Name', 'Parent Last Name', 'Legal Guardian Last Name',
    'Primary Guardian Last Name', 'Father Last Name', 'Mother Last Name', 'Caregiver Last Name'
  ],
  guardianPhone: [
    'Guardian 1 Phone', 'Guardian Phone', 'Parent Phone', 'Emergency Contact Phone', 'Responsible Adult Phone',
    'Authorized Contact Phone', 'Next of Kin Phone', 'Guardian Contact'
  ],
  guardianEmail: [
    'Guardian 1 Email', 'Guardian Email', 'Parent Email', 'Emergency Contact Email', 'Authorized Contact Email',
    'Legal Guardian Email', 'Guardian E-mail'
  ],
  guardianAddress: ['Guardian 1 Address', 'Guardian Address', 'Parent Address', 'Guardian Residential Address'],
  guardianHometown: ['Guardian 1 Hometown', 'Guardian Hometown', 'Parent Hometown', 'Guardian City'],
  guardianName: [
    'Guardian', 'Parent', 'Parent/Guardian', 'Legal Guardian', 'Primary Guardian', 'Secondary Guardian',
    'Father', 'Mother', 'Parent 1', 'Parent 2', 'Caregiver', 'Sponsor', 'Emergency Contact', 'Responsible Adult',
    'Custodian', 'Next of Kin', 'Family Contact', 'Household Head', 'Authorized Contact', 'Legal Representative'
  ]
};

function normalizeHeader(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCSVLine(line = '') {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function extractYear(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : raw;
}

function splitGuardianName(name = '') {
  const cleaned = String(name).trim();
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function buildHeaderIndexMap(headers = []) {
  const normalizedHeaders = headers.map((h) => normalizeHeader(h));
  const aliasToIndex = (aliases = []) => {
    for (const alias of aliases) {
      const aliasNorm = normalizeHeader(alias);
      const index = normalizedHeaders.findIndex((h) => h === aliasNorm);
      if (index !== -1) return index;
      const partialIndex = normalizedHeaders.findIndex((h) => h.includes(aliasNorm) || aliasNorm.includes(h));
      if (partialIndex !== -1) return partialIndex;
    }
    return -1;
  };

  return {
    firstName: aliasToIndex(FIELD_ALIASES.firstName),
    lastName: aliasToIndex(FIELD_ALIASES.lastName),
    dateOfBirth: aliasToIndex(FIELD_ALIASES.dateOfBirth),
    gender: aliasToIndex(FIELD_ALIASES.gender),
    hometown: aliasToIndex(FIELD_ALIASES.hometown),
    studentAddress: aliasToIndex(FIELD_ALIASES.studentAddress),
    studentEmail: aliasToIndex(FIELD_ALIASES.studentEmail),
    class: aliasToIndex(FIELD_ALIASES.class),
    graduationYear: aliasToIndex(FIELD_ALIASES.graduationYear),
    subjects: aliasToIndex(FIELD_ALIASES.subjects),
    guardianFirstName: aliasToIndex(FIELD_ALIASES.guardianFirstName),
    guardianLastName: aliasToIndex(FIELD_ALIASES.guardianLastName),
    guardianPhone: aliasToIndex(FIELD_ALIASES.guardianPhone),
    guardianEmail: aliasToIndex(FIELD_ALIASES.guardianEmail),
    guardianAddress: aliasToIndex(FIELD_ALIASES.guardianAddress),
    guardianHometown: aliasToIndex(FIELD_ALIASES.guardianHometown),
    guardianName: aliasToIndex(FIELD_ALIASES.guardianName)
  };
}

function valueAt(row = [], index = -1) {
  if (index < 0 || index >= row.length) return '';
  return String(row[index] ?? '').trim();
}

function normalizeGenderValue(raw) {
  if (!raw) return '';
  const g = String(raw).trim().toLowerCase();
  if (g === 'm' || g === 'male' || g === 'boy' || g === 'b') return 'Male';
  if (g === 'f' || g === 'female' || g === 'girl' || g === 'g') return 'Female';
  // Capitalize first letter for anything else
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
}

function sanitizePhoneNumber(raw) {
  if (!raw) return '';
  const value = String(raw);
  const hasPlus = value.trim().startsWith('+');
  // Strip spaces, dashes, parens, dots — keep only digits, but preserve a
  // leading "+" if the sheet already had one (a stripped "+" is otherwise
  // indistinguishable from a number that never had a country code).
  const digits = value.replace(/[\s\-\(\)\.\+]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

// Best-effort: if an imported phone has no "+", assume it's a local number
// in the school's own country and prefix that country's dial code — bulk
// import sheets are almost always all-one-country and rarely include a "+".
function applyDefaultDialCode(phone, defaultDial) {
  const value = String(phone || '').trim();
  if (!value || value.startsWith('+') || !defaultDial) return value;
  return `+${defaultDial}${value}`;
}

function normalizeOptionalEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value || null;
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
}

function isUnknownDobToken(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  return ['n/k', 'nk', 'unknown', 'notknown', 'dontknow', "don'tknow", 'na', 'n/a'].includes(normalized);
}

function mapRowToStudent(rowValues = [], indexMap) {
  const guardianNameRaw = valueAt(rowValues, indexMap.guardianName);
  const splitGuardian = splitGuardianName(guardianNameRaw);
  const mappedHometown = valueAt(rowValues, indexMap.hometown);
  const rawStudentAddress = valueAt(rowValues, indexMap.studentAddress);
  const mappedStudentAddress = rawStudentAddress;
  const rawDateOfBirth = valueAt(rowValues, indexMap.dateOfBirth);
  const mappedDateOfBirth = formatDate(rawDateOfBirth);
  const dateOfBirthUnknown = !mappedDateOfBirth || isUnknownDobToken(rawDateOfBirth);

  const student = {
    firstName: valueAt(rowValues, indexMap.firstName),
    lastName: valueAt(rowValues, indexMap.lastName),
    dateOfBirth: dateOfBirthUnknown ? '' : mappedDateOfBirth,
    dateOfBirthUnknown,
    gender: normalizeGenderValue(valueAt(rowValues, indexMap.gender)),
    class: valueAt(rowValues, indexMap.class),
    hometown: mappedHometown,
    studentAddress: mappedStudentAddress,
    studentEmail: normalizeOptionalEmail(valueAt(rowValues, indexMap.studentEmail)) || '',
    subjects: valueAt(rowValues, indexMap.subjects),
    graduationYear: extractYear(valueAt(rowValues, indexMap.graduationYear)),
    guardian: {
      firstName: valueAt(rowValues, indexMap.guardianFirstName) || splitGuardian.firstName,
      lastName: valueAt(rowValues, indexMap.guardianLastName) || splitGuardian.lastName,
      phone: sanitizePhoneNumber(valueAt(rowValues, indexMap.guardianPhone)),
      email: valueAt(rowValues, indexMap.guardianEmail).toLowerCase(),
      address: valueAt(rowValues, indexMap.guardianAddress),
      hometown: valueAt(rowValues, indexMap.guardianHometown)
    }
  };

  const firstName = (student.firstName || '').toLowerCase();
  const invalidName =
    !student.firstName ||
    student.firstName.length > 80 ||
    firstName.includes('subject') ||
    firstName.includes('physics') ||
    firstName.includes('chemistry') ||
    firstName.includes('mathematics') ||
    firstName.includes('english') ||
    firstName.includes('biology');

  return invalidName ? null : student;
}

function parseRowsToStudents(headers = [], rows = []) {
  const indexMap = buildHeaderIndexMap(headers);
  return rows.map((row) => mapRowToStudent(row, indexMap)).filter(Boolean);
}

function detectHeaderAndDataRows(matrixRows = []) {
  if (!Array.isArray(matrixRows) || !matrixRows.length) {
    return { headers: [], rows: [] };
  }

  let bestHeaderIndex = -1;
  let bestScore = -1;

  const scanLimit = Math.min(matrixRows.length, 50);
  for (let i = 0; i < scanLimit; i++) {
    const candidate = (matrixRows[i] || []).map((value) => String(value || '').trim());
    const indexMap = buildHeaderIndexMap(candidate);
    const score = [
      indexMap.firstName,
      indexMap.lastName,
      indexMap.dateOfBirth,
      indexMap.class,
      indexMap.guardianFirstName,
      indexMap.guardianName,
    ].filter((idx) => idx >= 0).length;

    if (score > bestScore) {
      bestScore = score;
      bestHeaderIndex = i;
    }
  }

  if (bestHeaderIndex < 0 || bestScore < 2) {
    return { headers: [], rows: [] };
  }

  const headers = (matrixRows[bestHeaderIndex] || []).map((value) => String(value || '').trim());
  const rows = matrixRows
    .slice(bestHeaderIndex + 1)
    .map((row) => (Array.isArray(row) ? row : []))
    .filter((row) => row.some((cell) => String(cell || '').trim()));

  return { headers, rows };
}

function parseSpreadsheetXmlWorkbook(fileContent = '') {
  const xml = String(fileContent || '');
  if (!xml) return [];

  const worksheetRegex = /<Worksheet\b[\s\S]*?<Table\b[\s\S]*?<\/Table>[\s\S]*?<\/Worksheet>/gi;
  const rowRegex = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;
  const cellRegex = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>|<Cell\b([^>]*)\/>/gi;

  const parseCellValue = (rawCell = '') => {
    const dataMatch = String(rawCell).match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
    const rawValue = dataMatch ? dataMatch[1] : '';
    return he.decode(String(rawValue || '').replace(/<[^>]+>/g, '').trim());
  };

  const worksheets = [];
  const worksheetMatches = xml.match(worksheetRegex) || [];

  worksheetMatches.forEach((worksheetXml) => {
    const rows = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(worksheetXml)) !== null) {
      const rowInner = rowMatch[1] || '';
      const rowValues = [];
      let cellMatch;
      let colIndex = 1;

      while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
        const attrs = String(cellMatch[1] || cellMatch[3] || '');
        const explicitIndex = attrs.match(/(?:ss:)?Index="(\d+)"/i);
        if (explicitIndex) {
          colIndex = Math.max(1, Number(explicitIndex[1]) || 1);
        }

        const cellContent = cellMatch[2] || '';
        const value = parseCellValue(cellContent);
        rowValues[colIndex - 1] = value;
        colIndex += 1;
      }

      if (rowValues.some((value) => String(value || '').trim())) {
        rows.push(rowValues.map((value) => String(value || '').trim()));
      }
    }

    if (rows.length) {
      worksheets.push(rows);
    }
  });

  return worksheets;
}

// Helper function to format dates from various formats to YYYY-MM-DD
function formatDate(dateString) {
  if (!dateString) return '';

  // Handle Excel serial numbers (as number or numeric string like "43510")
  let numVal = typeof dateString === 'number' ? dateString : null;
  if (numVal === null && /^\d{4,5}(\.\d+)?$/.test(String(dateString).trim())) {
    const parsed = parseFloat(dateString);
    if (parsed > 1000 && parsed < 100000) numVal = parsed; // Likely an Excel serial
  }
  if (numVal !== null) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + numVal * 86400000);
    return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
  }

  // Try direct Date parse (handles ISO, US formats etc.)
  const direct = new Date(dateString);
  if (!isNaN(direct.getTime()) && String(dateString).length > 4) {
    return direct.toISOString().split('T')[0];
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const parts = String(dateString).split(/[/\-\.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(p => p.trim());
    // If third part is 4 digits → DD/MM/YYYY
    if (c && c.length === 4) {
      return `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    // If first part is 4 digits → YYYY/MM/DD (already handled by Date parse above but just in case)
    if (a && a.length === 4) {
      return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
    }
  }

  return String(dateString).trim();
}

// Parse free text (from Word/PDF/OCR) into student records using alias-aware headers when present
function parseTextToStudents(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  let headerIndex = -1;
  let parsedHeaders = [];

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const candidate = parseCSVLine(lines[i]);
    const map = buildHeaderIndexMap(candidate);
    const hits = [map.firstName, map.lastName, map.class, map.dateOfBirth].filter((idx) => idx >= 0).length;
    if (hits >= 2) {
      headerIndex = i;
      parsedHeaders = candidate;
      break;
    }
  }

  if (headerIndex >= 0) {
    const rows = lines.slice(headerIndex + 1).map((line) => parseCSVLine(line));
    return parseRowsToStudents(parsedHeaders, rows);
  }

  const fallbackStudents = [];
  for (const line of lines) {
    const parts = line.split(/[\t,|]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const hasStudentEmail = Boolean(parts[6] && String(parts[6]).includes('@'));
      const rawFallbackDob = parts[2] || '';
      const fallbackDateOfBirth = rawFallbackDob ? formatDate(rawFallbackDob) : '';
      const fallbackDateUnknown = !fallbackDateOfBirth || isUnknownDobToken(rawFallbackDob);
      const student = {
        firstName: parts[0] || '',
        lastName: parts[1] || '',
        dateOfBirth: fallbackDateUnknown ? '' : fallbackDateOfBirth,
        dateOfBirthUnknown: fallbackDateUnknown,
        gender: normalizeGenderValue(parts[3] || ''),
        class: parts[4] || '',
        hometown: parts[5] || '',
        studentEmail: hasStudentEmail ? String(parts[6] || '').toLowerCase() : '',
        subjects: hasStudentEmail ? (parts[7] || '') : (parts[6] || ''),
        graduationYear: extractYear(hasStudentEmail ? (parts[8] || '') : (parts[7] || '')),
        guardian: {
          firstName: hasStudentEmail ? (parts[9] || '') : (parts[8] || ''),
          lastName: hasStudentEmail ? (parts[10] || '') : (parts[9] || ''),
          phone: sanitizePhoneNumber(hasStudentEmail ? (parts[11] || '') : (parts[10] || '')),
          email: String(hasStudentEmail ? (parts[12] || '') : (parts[11] || '')).toLowerCase(),
          address: hasStudentEmail ? (parts[13] || '') : (parts[12] || ''),
          hometown: hasStudentEmail ? (parts[14] || '') : (parts[13] || '')
        }
      };
      if (student.firstName && student.lastName) fallbackStudents.push(student);
    }
  }
  return fallbackStudents;
}

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.organizationId || req.session.userId) {
    return next();
  } else {
    res.redirect("/account/login");
  }
}

// Helper to extract guardians
function extractGuardians(body) {
  const guardians = [];
  const guardianKeys = Object.keys(body).filter((k) =>
    k.startsWith("guardianFirstName")
  );
  for (let i = 0; i < guardianKeys.length; i++) {
    const firstName = body[`guardianFirstName${i}`];
    if (firstName) {
      guardians.push({
        firstName,
        lastName: body[`guardianLastName${i}`],
        phone: body[`guardianPhone${i}`],
        email: body[`guardianEmail${i}`],
        hometown: body[`guardianHometown${i}`],
      });
    }
  }
  return guardians;
}

// Ensure this function is defined to fetch class names
async function getClassEmployeesWithMain(db, classId) {
  const employeesQuery = `
        SELECT u.user_id, u.first_name || ' ' || u.last_name as name, uc.main
        FROM users u
        JOIN user_classes uc ON u.user_id = uc.user_id
        WHERE uc.class_id = $1;
    `;
  const result = await db.query(employeesQuery, [classId]);
  return result.rows;
}

function getSessionUserId(req) {
  return req?.session?.userId || req?.session?.user?.user_id || null;
}

function wantsJsonResponse(req) {
  return req.xhr || String(req.get("accept") || "").includes("application/json");
}

function joinNonEmptySegments(parts = []) {
  return parts
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeRoleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function startOfUtcDay(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getUpcomingBirthdayInfo(dateValue, referenceDate = new Date(), options = {}) {
  const { includeWeekendCarryover = false } = options;
  if (!dateValue) return null;
  const birthDate = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = startOfUtcDay(referenceDate);

  if (includeWeekendCarryover && today.getUTCDay() === 1) {
    const sunday = new Date(today);
    sunday.setUTCDate(today.getUTCDate() - 1);
    const saturday = new Date(today);
    saturday.setUTCDate(today.getUTCDate() - 2);

    const isSundayBirthday = birthDate.getUTCMonth() === sunday.getUTCMonth()
      && birthDate.getUTCDate() === sunday.getUTCDate();
    const isSaturdayBirthday = birthDate.getUTCMonth() === saturday.getUTCMonth()
      && birthDate.getUTCDate() === saturday.getUTCDate();

    if (isSundayBirthday || isSaturdayBirthday) {
      const carryoverDate = isSundayBirthday ? sunday : saturday;
      const turningAge = today.getUTCFullYear() - birthDate.getUTCFullYear();
      return {
        daysUntil: 0,
        nextBirthday: carryoverDate,
        turningAge: Number.isFinite(turningAge) ? turningAge : null,
        label: new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(carryoverDate),
      };
    }
  }

  let nextBirthday = new Date(Date.UTC(
    today.getUTCFullYear(),
    birthDate.getUTCMonth(),
    birthDate.getUTCDate()
  ));
  if (nextBirthday < today) {
    nextBirthday = new Date(Date.UTC(
      today.getUTCFullYear() + 1,
      birthDate.getUTCMonth(),
      birthDate.getUTCDate()
    ));
  }

  const daysUntil = Math.round((nextBirthday.getTime() - today.getTime()) / 86400000);
  const turningAge = nextBirthday.getUTCFullYear() - birthDate.getUTCFullYear();
  return {
    daysUntil,
    nextBirthday,
    turningAge: Number.isFinite(turningAge) ? turningAge : null,
    label: new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(nextBirthday),
  };
}

function getStudentBirthdayWish(seedValue) {
  const wishes = [
    'May today bring bright smiles, calm confidence, and sweet moments worth remembering.',
    'Wishing you a joyful birthday filled with laughter, kindness, and beautiful surprises.',
    'May this birthday open a fresh chapter of confidence, growth, and happy memories.',
    'Sending warm wishes for a day full of joy, celebration, and shining hope for the year ahead.',
  ];
  const seed = Number(seedValue || 0);
  return wishes[Math.abs(seed) % wishes.length];
}

function getStaffBirthdayWish(seedValue) {
  const wishes = [
    'Wishing you a joyful birthday filled with peace, laughter, and beautiful moments.',
    'May this new year bring you strength, favor, and meaningful progress.',
    'Happy birthday. We appreciate your contribution and wish you a bright year ahead.',
    'Sending warm birthday wishes for joy today and success in the months to come.',
  ];
  const seed = Number(seedValue || 0);
  return wishes[Math.abs(seed) % wishes.length];
}

function buildUpcomingBirthdayCards(students = [], windowDays = 0, options = {}) {
  const { includeWeekendCarryover = false } = options;
  return students
    .map((student) => {
      const info = getUpcomingBirthdayInfo(student.date_of_birth, new Date(), { includeWeekendCarryover });
      if (!info || info.daysUntil > windowDays) return null;
      const name = typeof formatDisplayName === 'function'
        ? formatDisplayName(student)
        : [student.first_name, student.last_name].filter(Boolean).join(' ').trim();
      return {
        studentId: student.student_id,
        name,
        className: student.class_name || '',
        daysUntil: info.daysUntil,
        isToday: info.daysUntil === 0,
        nextBirthdayLabel: info.label,
        turningAge: info.turningAge,
        timingLabel: info.daysUntil === 0 ? 'Today' : (info.daysUntil === 1 ? 'Tomorrow' : `In ${info.daysUntil} days`),
        wishMessage: info.daysUntil === 0 ? getStudentBirthdayWish(student.student_id) : 'Upcoming this week',
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.daysUntil - right.daysUntil || left.name.localeCompare(right.name));
}

async function resolveFeedbackSessionContext(dbClient, req) {
  let organizationId = Number.parseInt(req?.session?.organizationId, 10);
  organizationId = Number.isInteger(organizationId) && organizationId > 0 ? organizationId : null;

  let userId = getSessionUserId(req);
  userId = Number.parseInt(userId, 10);
  userId = Number.isInteger(userId) && userId > 0 ? userId : null;

  let userRole = String(
    req?.session?.userRole || req?.session?.user?.account_type || req?.session?.accountType || ""
  ).trim();
  let userName =
    joinNonEmptySegments([req?.session?.user?.first_name, req?.session?.user?.last_name]) ||
    joinNonEmptySegments([req?.session?.firstName, req?.session?.lastName]) ||
    String(req?.session?.user?.email || "").trim();
  let organizationName = String(req?.session?.organizationName || "").trim();

  if ((!organizationId || !userName || !userRole) && userId) {
    const userResult = await dbClient.query(
      `SELECT user_id, organization_id, first_name, last_name, email, account_type
       FROM users
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    const userRow = userResult.rows[0] || null;
    if (userRow) {
      if (!organizationId) {
        const resolvedOrganizationId = Number.parseInt(userRow.organization_id, 10);
        organizationId =
          Number.isInteger(resolvedOrganizationId) && resolvedOrganizationId > 0
            ? resolvedOrganizationId
            : null;
      }
      if (!userName) {
        userName =
          joinNonEmptySegments([userRow.first_name, userRow.last_name]) ||
          String(userRow.email || "").trim();
      }
      if (!userRole) {
        userRole = String(userRow.account_type || "").trim();
      }
    }
  }

  if (organizationId && !organizationName) {
    const organizationResult = await dbClient.query(
      `SELECT organization_name
       FROM organizations
       WHERE organization_id = $1
       LIMIT 1`,
      [organizationId]
    );
    organizationName = String(organizationResult.rows[0]?.organization_name || "").trim();
  }

  if (!userName && req?.session?.accountType === "organization") {
    userName = organizationName || "Organization Owner";
  }

  return {
    organizationId,
    userId,
    userName: userName || "Unknown User",
    userRole: userRole || "Staff",
    organizationName: organizationName || "Organization",
  };
}

function validateFeedbackPayload(body = {}) {
  const feedbackType = normalizeFeedbackType(body.feedbackType || body.feedback_type);
  const area = normalizeFeedbackArea(body.area);
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  const ratingInput = body.rating;
  const parsedRating =
    ratingInput === "" || ratingInput === null || ratingInput === undefined
      ? null
      : Number.parseInt(ratingInput, 10);
  let priority = normalizeFeedbackPriority(body.priority);

  const errors = [];
  if (!feedbackType) errors.push("Please choose a feedback type.");
  if (!area) errors.push("Please choose an area.");
  if (!subject) errors.push("Please enter a subject.");
  if (subject.length > 120) errors.push("Subject must be 120 characters or fewer.");
  if (!message) errors.push("Please enter your message.");
  if (message.length > 2000) errors.push("Message must be 2000 characters or fewer.");

  if (
    parsedRating !== null &&
    (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5)
  ) {
    errors.push("Rating must be between 1 and 5.");
  }

  if (feedbackType === "review") {
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      errors.push("Please select a star rating for your review.");
    }
  }

  const requiresPriority = feedbackType === "feature_request" || feedbackType === "bug_report";
  if (requiresPriority && !priority) {
    errors.push("Please choose a priority level.");
  }
  if (!requiresPriority) {
    priority = null;
  }

  return {
    errors,
    payload: {
      feedbackType,
      area,
      subject,
      message,
      rating: feedbackType === "review" ? parsedRating : null,
      priority,
    },
  };
}

function buildClassSchedulePermissions(req, isMainTeacher) {
  return canManageClassSchedule(req?.session?.userRole, isMainTeacher);
}

function buildClassSchedulePayload(options) {
  const {
    canEdit,
    subjects,
    term,
    schedule,
    previousSchedule,
  } = options;

  return {
    success: true,
    canEdit: Boolean(canEdit),
    weekdays: CLASS_SCHEDULE_WEEKDAYS,
    subjects: subjects || [],
    currentTerm: {
      termId: term?.term_id || null,
      termName: term?.term_name || "Current Term",
      schoolYearId: term?.school_year_id || null,
      schoolYearLabel: term?.year_label || "",
    },
    schedule: schedule || null,
    previousSchedule: previousSchedule || null,
  };
}

async function fetchStudentsByClass(db, classId) {
  try {
    const studentsResult = await db.query(
      `
            SELECT student_id, first_name, last_name
            FROM students
            WHERE class_id = $1
            ORDER BY first_name, last_name
        `,
      [classId]
    );
    return studentsResult.rows;
  } catch (error) {
    // ...removed error log for clean background operation...
    throw error;
  }
}

// Function to update or insert category_scores
async function updateCategoryScores(
  student_id,
  class_id,
  subject_id,
  category,
  total_score,
  organization_id,
  db
) {
  // Insert or update category score in a single query
  await db.query(
    `INSERT INTO category_scores (student_id, class_id, subject_id, category, total_score, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, class_id, subject_id, category, organization_id)
         DO UPDATE SET total_score = EXCLUDED.total_score`,
    [student_id, class_id, subject_id, category, total_score, organization_id]
  );
}

function generateLastFiveDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const date = new Date();
    date.setDate(today.getDate() - i);
    dates.push(date.toISOString().split("T")[0]);
  }
  return dates.reverse();
}

function generateAllDatesFromStart(termStartDate) {
  const dates = [];
  const currentDate = new Date(termStartDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to midnight to avoid any time discrepancies

  while (currentDate <= today) {
    dates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return dates;
}

async function ensureAssessmentControlSchema(database = require("../config/db")) {
  if (global._assessmentControlSchemaPromise) {
    return global._assessmentControlSchemaPromise;
  }

  global._assessmentControlSchemaPromise = (async () => {
    try {
      await database.query(`
        ALTER TABLE assessments
        ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS show_question_set_on_dashboard BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS open_book BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER,
        ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS edit_window_start TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS edit_window_end TIMESTAMPTZ
      `);
    } catch (ddlErr) {
      // Columns likely already exist or there was a transient connection issue.
      // Log but do NOT reject — callers should not crash because the schema
      // was already applied in a previous deployment or by our migration SQL.
      console.warn('[AssessmentSchema] DDL warning (non-fatal):', ddlErr.message);
    }
  })();

  // Do NOT clear the global on error — a resolved-but-warned promise is far
  // better than clearing the singleton and retrying on every single request.
  return global._assessmentControlSchemaPromise;
}

let assessmentQuestionSetReviewSchemaReady = false;
let assessmentQuestionSetRetakeSchemaReady = false;

async function ensureAssessmentQuestionSetReviewSchema(dbClient) {
  if (assessmentQuestionSetReviewSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE assessment_question_sets
      ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS review_note TEXT,
      ADD COLUMN IF NOT EXISTS reviewed_by INTEGER,
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS question_card_layout VARCHAR(24) NOT NULL DEFAULT 'stacked'
  `);

  await dbClient.query(`
    ALTER TABLE assessment_questions
      ADD COLUMN IF NOT EXISTS options_layout VARCHAR(24) NOT NULL DEFAULT 'stacked'
  `);

  await dbClient.query(`
    UPDATE assessment_question_sets
    SET review_status = COALESCE(NULLIF(TRIM(review_status), ''), 'pending')
    WHERE review_status IS NULL OR NULLIF(TRIM(review_status), '') IS NULL
  `);

  assessmentQuestionSetReviewSchemaReady = true;
}

async function ensureAssessmentQuestionSetRetakeSchema(dbClient) {
  if (assessmentQuestionSetRetakeSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE assessment_question_sets
      ADD COLUMN IF NOT EXISTS retake_student_id INTEGER REFERENCES students(student_id) ON DELETE SET NULL
  `);

  assessmentQuestionSetRetakeSchemaReady = true;
}

let studentAssessmentLockSchemaReady = false;

async function ensureStudentAssessmentLockSchema(dbClient) {
  if (studentAssessmentLockSchemaReady) return;

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS student_assessment_lock_overrides (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      assessment_id INTEGER NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
      question_set_id INTEGER REFERENCES assessment_question_sets(question_set_id) ON DELETE SET NULL,
      is_locked BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, student_id, assessment_id)
    )
  `);

  await dbClient.query(`
    CREATE OR REPLACE FUNCTION validate_student_assessment_lock_override_set()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.question_set_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM assessment_question_sets qs
        WHERE qs.question_set_id = NEW.question_set_id
          AND qs.organization_id = NEW.organization_id
          AND qs.assessment_id = NEW.assessment_id
      ) THEN
        RAISE EXCEPTION 'Invalid question_set_id % for assessment_id % in organization %',
          NEW.question_set_id, NEW.assessment_id, NEW.organization_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await dbClient.query(`
    DROP TRIGGER IF EXISTS trg_validate_student_assessment_lock_override_set
      ON student_assessment_lock_overrides;
  `);

  await dbClient.query(`
    CREATE TRIGGER trg_validate_student_assessment_lock_override_set
    BEFORE INSERT OR UPDATE OF question_set_id, assessment_id, organization_id
    ON student_assessment_lock_overrides
    FOR EACH ROW
    EXECUTE FUNCTION validate_student_assessment_lock_override_set();
  `);

  studentAssessmentLockSchemaReady = true;
}

function normalizeImportedQuestionType(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (!raw) return "short_text";
  if (["multiple_choice", "multiple choice", "mcq"].includes(raw)) return "multiple_choice";
  if (["single_choice", "single choice", "one_choice", "one choice"].includes(raw)) return "single_choice";
  if (["true_false", "true false", "true/false"].includes(raw)) return "true_false";
  if (["short_answer", "short answer", "short_text", "short_ans"].includes(raw)) return "short_text";
  if (["fill_blank", "fill_in_the_blank", "fill blank", "fill_in_blank"].includes(raw)) return "fill_blank";
  if (["matching"].includes(raw)) return "matching";
  if (raw === "essay") return "essay";
  return "short_text";
}

function isLikelySectionHeader(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (/^[A-G]\s+(MULTIPLE|TRUE|FILL|MATCHING|SHORT|ESSAY)/i.test(value)) return true;
  if (/^GENERAL\s+INSTRUCTIONS/i.test(value)) return true;
  if (/^(Subject|Term|Time|Total)\s*:/i.test(value)) return true;
  if (/^(Response:|Answer:|Column\s+[AB])/i.test(value)) return true;
  if (/End of Paper/i.test(value)) return true;
  return false;
}

function stripTrailingMarksLabel(text) {
  return String(text || "")
    .replace(/\s*[\[(]?\d+(?:\.\d+)?\s*(?:mk|mks|marks?|pts?|points?)\s*[\])]?(?=\s*$)/i, "")
    .trim();
}

async function cloneQuestionSetForRetakeShuffle(client, options) {
  const organizationId = Number(options.organizationId || 0);
  const sourceQuestionSetId = Number(options.sourceQuestionSetId || 0);
  const actorUserId = Number(options.actorUserId || 0) || null;
  const retakeStudentId = Number(options.retakeStudentId || 0) || null;
  const shuffleMode = String(options.shuffleMode || "random").trim().toLowerCase();

  if (!organizationId || !sourceQuestionSetId) {
    throw new Error("A source question set is required for reshuffle.");
  }

  const sourceSetResult = await client.query(
    `SELECT
       question_set_id,
       term_id,
       class_id,
       subject_id,
       assessment_id,
       group_id,
       set_title,
       set_description,
       total_points
     FROM assessment_question_sets
     WHERE organization_id = $1
       AND question_set_id = $2
     LIMIT 1`,
    [organizationId, sourceQuestionSetId]
  );

  if (!sourceSetResult.rows.length) {
    throw new Error("Question set not found for reshuffle.");
  }

  const sourceSet = sourceSetResult.rows[0];
  const sourceQuestionsResult = await client.query(
    `SELECT
       question_type,
       question_text,
       options_json,
       answer_key,
       marks,
       position_index
     FROM assessment_questions
     WHERE question_set_id = $1
     ORDER BY position_index ASC, question_id ASC`,
    [sourceQuestionSetId]
  );

  if (!sourceQuestionsResult.rows.length) {
    throw new Error("Question set has no questions to reshuffle.");
  }

  const questions = sourceQuestionsResult.rows.map((row) => ({
    questionType: row.question_type,
    questionText: row.question_text,
    options: Array.isArray(row.options_json) ? [...row.options_json] : [],
    answerKey: row.answer_key || null,
    marks: Number(row.marks || 0),
    positionIndex: Number(row.position_index || 0),
  }));

  if (shuffleMode === "reverse") {
    questions.reverse();
  } else {
    for (let index = questions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [questions[index], questions[swapIndex]] = [questions[swapIndex], questions[index]];
    }
  }

  await ensureAssessmentQuestionSetReviewSchema(client);
  await ensureAssessmentQuestionSetRetakeSchema(client);

  const cloneSetTitle = sourceSet.set_title || "Question Set";
  const insertQuestionSetResult = await client.query(
    `INSERT INTO assessment_question_sets (
       organization_id,
       term_id,
       class_id,
       subject_id,
       assessment_id,
       group_id,
       set_title,
       set_description,
       total_points,
       retake_student_id,
       review_status,
       submitted_at,
       created_by,
       updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'approved', NOW(), $11, $11)
     RETURNING question_set_id`,
    [
      organizationId,
      Number(sourceSet.term_id || 0),
      Number(sourceSet.class_id || 0),
      Number(sourceSet.subject_id || 0),
      Number(sourceSet.assessment_id || 0),
      sourceSet.group_id || null,
      cloneSetTitle,
      sourceSet.set_description || null,
      Number(sourceSet.total_points || 0),
      retakeStudentId,
      actorUserId,
    ]
  );

  const clonedQuestionSetId = Number(insertQuestionSetResult.rows[0].question_set_id);

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    await client.query(
      `INSERT INTO assessment_questions (
         question_set_id,
         organization_id,
         question_type,
         question_text,
         options_json,
         answer_key,
         marks,
         position_index
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        clonedQuestionSetId,
        organizationId,
        question.questionType,
        question.questionText,
        JSON.stringify(question.options || []),
        question.answerKey,
        Number(question.marks || 0),
        index + 1,
      ]
    );
  }

  return clonedQuestionSetId;
}

function looksLikeMergedQuestions(text) {
  const value = String(text || "");
  if (!value) return false;
  const inlineQuestionMarkers = value.match(/(?:^|\s)(?:q(?:uestion)?\s*)?\d{1,3}\s*[\)\].:-]\s+/gi) || [];
  return inlineQuestionMarkers.length > 1;
}

function shouldAcceptLocalExtraction(questions = []) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) return false;
  for (const q of list) {
    const text = String(q && q.questionText ? q.questionText : "").trim();
    if (!text) return false;
    if (isLikelySectionHeader(text)) return false;
    if (looksLikeMergedQuestions(text)) return false;
  }
  return true;
}

function stripCodeFences(text) {
  return String(text || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function extractJsonArrayFromText(rawText) {
  const text = stripCodeFences(rawText);
  const startIdx = text.indexOf("[");
  const endIdx = text.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return null;
  }

  const candidate = text.slice(startIdx, endIdx + 1);
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeExtractedQuestions(rawQuestions = []) {
  const input = Array.isArray(rawQuestions) ? rawQuestions : [];

  const normalized = input
    .map((question, index) => {
      const questionType = normalizeImportedQuestionType(question.questionType);
      const questionText = String(question.questionText || question.question || "").trim();
      const marks = Number(question.marks || question.mark || question.points || 1);
      const questionNumber = Number(question.questionNumber || index + 1);

      let options = Array.isArray(question.options)
        ? question.options.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];

      if (questionType === "true_false" && options.length === 0) {
        options = ["True", "False"];
      }

      let answerKey = "";
      if (Array.isArray(question.answerKeys)) {
        answerKey = question.answerKeys
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
          .join("||");
      } else {
        answerKey = String(question.answerKey || question.answer || "").trim();
      }

      if (!questionText || isLikelySectionHeader(questionText)) return null;

      return {
        questionNumber: Number.isInteger(questionNumber) && questionNumber > 0 ? questionNumber : (index + 1),
        questionType,
        questionText,
        options,
        answerKey,
        marks: Number.isFinite(marks) && marks > 0 ? marks : 1,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.questionNumber - b.questionNumber);

  return normalized;
}

function postProcessQuestions(rawQuestions = []) {
  const input = Array.isArray(rawQuestions) ? rawQuestions : [];
  const result = [];

  input.forEach((question, index) => {
    const questionNumber = Number(question.questionNumber || index + 1);
    const rawText = String(question.questionText || question.question || "").trim();
    if (!rawText) return;

    // Matching-row salvage: "25. Photosynthesis | A. ... | D" -> questionText=Photosynthesis, answerKey=D
    let questionText = rawText;
    let extractedMatchingAnswer = "";
    if (rawText.includes("|")) {
      const parts = rawText.split("|").map((part) => String(part || "").trim()).filter(Boolean);
      if (parts.length >= 2) {
        const firstPart = parts[0].replace(/^\d+\s*[\)\].:-]\s*/, "").trim();
        const trailingAnswer = parts[parts.length - 1].match(/^\(?([A-H])\)?$/i);
        if (firstPart) questionText = firstPart;
        if (trailingAnswer) extractedMatchingAnswer = String(trailingAnswer[1] || "").toUpperCase();
      }
    }

    questionText = stripTrailingMarksLabel(questionText);
    if (!questionText) return;
    if (isLikelySectionHeader(questionText)) return;
    if (questionText.length < 3) return;

    let questionType = normalizeImportedQuestionType(question.questionType);
    if (["fill_blank", "matching"].includes(questionType)) {
      questionType = "short_text";
    }
    if (!["multiple_choice", "single_choice", "true_false", "short_text", "essay"].includes(questionType)) {
      questionType = "short_text";
    }

    let options = Array.isArray(question.options)
      ? question.options.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];

    if (questionType === "true_false") {
      options = ["True", "False"];
    }

    const rawAnswer = Array.isArray(question.answerKeys)
      ? question.answerKeys.map((entry) => String(entry || "").trim()).filter(Boolean).join(",")
      : String(question.answerKey || question.answer || "").trim();
    const answerKey = /answer not provided|student to respond/i.test(rawAnswer)
      ? ""
      : (extractedMatchingAnswer || rawAnswer);

    const marks = Number(question.marks || question.mark || question.points || 1);

    result.push({
      questionNumber: Number.isInteger(questionNumber) && questionNumber > 0 ? questionNumber : (index + 1),
      questionType,
      questionText,
      options,
      answerKey,
      marks: Number.isFinite(marks) && marks > 0 ? marks : 1,
    });
  });

  result.sort((a, b) => a.questionNumber - b.questionNumber);
  return result;
}

function inferQuestionTypeFromText(questionText, options) {
  const normalizedText = String(questionText || "").toLowerCase();
  const normalizedOptions = Array.isArray(options)
    ? options.map((opt) => String(opt || "").toLowerCase())
    : [];

  if (
    normalizedOptions.length === 2 &&
    normalizedOptions.includes("true") &&
    normalizedOptions.includes("false")
  ) {
    return "true_false";
  }

  if (normalizedOptions.length > 0) {
    if (/select\s+all|all\s+that\s+apply|more\s+than\s+one|multiple\s+answers?/i.test(normalizedText)) {
      return "multiple_choice";
    }
    if (/choose\s+one|select\s+one|best\s+answer|one\s+correct\s+answer/i.test(normalizedText)) {
      return "single_choice";
    }
    return "single_choice";
  }

  if (/essay|explain|discuss|describe in detail|long answer/i.test(normalizedText)) {
    return "essay";
  }

  return "short_text";
}

function preprocessPlainQuestionText(rawText = "") {
  let text = String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ");

  text = text.replace(/[ ]{2,}/g, " ");
  text = text.replace(/([^.\n])\s+(?=(?:Q(?:uestion)?\s*)?\d{1,3}\s*[\)\].:-]\s+)/gi, "$1\n");
  text = text.replace(/([^.\n])\s+(?=(?:Answer|Ans(?:wer)?\s*Key|Correct\s*Answer|Key)\s*[:\-])/gi, "$1\n");

  return text;
}

function extractMarksFromText(rawText = "") {
  let text = String(rawText || "").trim();
  let marks = null;

  const patterns = [
    /(?:\(|\[)?\s*(\d+(?:\.\d+)?)\s*marks?\s*(?:\)|\])?$/i,
    /(?:\(|\[)?\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?|mks?|mk|m)\s*(?:\)|\])?$/i,
    /^\s*\[(\d+(?:\.\d+)?)\]\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      marks = Number(match[1]);
      text = text.replace(pattern, "").trim();
      break;
    }
  }

  return {
    text,
    marks: Number.isFinite(marks) && marks > 0 ? marks : null,
  };
}

function splitInlineOptions(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const optionToken = /\(?([A-Ha-h])\)?[\).:-]\s*/g;
  const hits = [];
  let match = optionToken.exec(text);
  while (match) {
    hits.push({
      label: String(match[1] || "").toUpperCase(),
      start: match.index,
      valueStart: optionToken.lastIndex,
    });
    match = optionToken.exec(text);
  }

  if (hits.length < 2) return null;

  const leadText = text.slice(0, hits[0].start).trim();
  if (!leadText || leadText.length < 4) return null;

  const options = hits
    .map((hit, index) => {
      const end = index + 1 < hits.length ? hits[index + 1].start : text.length;
      const value = text.slice(hit.valueStart, end).trim().replace(/\s+/g, " ");
      return value;
    })
    .filter(Boolean);

  if (options.length < 2) return null;

  return {
    stem: leadText,
    options,
    optionLabels: hits.map((hit) => hit.label),
  };
}

function normalizeParsedAnswer(rawAnswer = "", optionLabels = []) {
  const raw = String(rawAnswer || "").trim();
  if (!raw) return "";

  const labels = Array.isArray(optionLabels)
    ? optionLabels.map((label) => String(label || "").toUpperCase()).filter(Boolean)
    : [];

  const compact = raw.replace(/\s+/g, " ").trim();
  const singleLabelMatch = compact.match(/^\(?([A-Ha-h])\)?$/);
  if (singleLabelMatch && labels.length && labels.includes(singleLabelMatch[1].toUpperCase())) {
    return singleLabelMatch[1].toUpperCase();
  }

  const multiLabelPattern = /^(?:\(?[A-Ha-h]\)?\s*(?:,|\/|\||&|\band\b)\s*)+\(?[A-Ha-h]\)?$/i;
  if (multiLabelPattern.test(compact)) {
    const parts = compact
      .split(/,|\/|\||&|\band\b/i)
      .map((part) => part.replace(/[()\s]/g, "").toUpperCase())
      .filter(Boolean);
    if (parts.length) {
      return parts.join("||");
    }
  }

  return compact;
}

function parseQuestionsFromPlainText(rawText = "") {
  const text = preprocessPlainQuestionText(rawText);
  const lines = text
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const questions = [];
  let current = null;

  const startQuestionRegex = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\)\].:-]\s*(.+)$/i;
  const altQuestionRegex = /^\((\d{1,3})\)\s*(.+)$/;
  const optionRegex = /^\(?([A-Ha-h])\)?\s*[\)\].:-]\s*(.+)$/;
  const answerRegex = /^(?:answer|ans(?:wer)?\s*key|correct\s*answer|key)\s*[:\-]\s*(.+)$/i;
  const marksOnlyRegex = /^(?:marks?|score|points?)\s*[:\-]\s*(\d+(?:\.\d+)?)$/i;

  const finalizeCurrent = () => {
    if (!current) return;

    current.questionText = String(current.questionText || "").trim();
    current.options = Array.isArray(current.options)
      ? current.options.map((opt) => String(opt || "").trim()).filter(Boolean)
      : [];

    current.questionType = inferQuestionTypeFromText(current.questionText, current.options);

    if (current.questionType === "true_false" && current.options.length === 0) {
      current.options = ["True", "False"];
    }

    if (!current.questionText) {
      current = null;
      return;
    }

    questions.push({
      questionNumber: current.questionNumber,
      questionType: current.questionType,
      questionText: current.questionText,
      options: current.options,
      answerKey: normalizeParsedAnswer(current.answerKey, current.optionLabels),
      marks: Number.isFinite(Number(current.marks)) && Number(current.marks) > 0 ? Number(current.marks) : 1,
    });
    current = null;
  };

  lines.forEach((line, index) => {
    const questionMatch = line.match(startQuestionRegex) || line.match(altQuestionRegex);
    if (questionMatch) {
      finalizeCurrent();

      const qNum = Number(questionMatch[1]);
      const initialText = String(questionMatch[2] || "").trim();
      const extractedMarks = extractMarksFromText(initialText);
      const inlineOptions = splitInlineOptions(extractedMarks.text);
      const cleanedText = inlineOptions ? inlineOptions.stem : extractedMarks.text;

      current = {
        questionNumber: Number.isInteger(qNum) ? qNum : (index + 1),
        questionType: "short_text",
        questionText: cleanedText,
        options: inlineOptions ? inlineOptions.options : [],
        optionLabels: inlineOptions ? inlineOptions.optionLabels : [],
        answerKey: "",
        marks: extractedMarks.marks || 1,
      };
      return;
    }

    if (!current) {
      return;
    }

    const marksOnlyMatch = line.match(marksOnlyRegex);
    if (marksOnlyMatch) {
      current.marks = Number(marksOnlyMatch[1]);
      return;
    }

    const optionMatch = line.match(optionRegex);
    if (optionMatch) {
      current.optionLabels = Array.isArray(current.optionLabels) ? current.optionLabels : [];
      current.optionLabels.push(String(optionMatch[1] || "").toUpperCase());
      current.options.push(String(optionMatch[2] || "").trim());
      return;
    }

    const answerMatch = line.match(answerRegex);
    if (answerMatch) {
      current.answerKey = String(answerMatch[1] || "").trim();
      return;
    }

    if (!current.options.length) {
      const inlineOptions = splitInlineOptions(line);
      if (inlineOptions) {
        current.options = inlineOptions.options;
        current.optionLabels = inlineOptions.optionLabels;
        current.questionText = (String(current.questionText || "") + " " + inlineOptions.stem).trim();
        return;
      }
    }

    if (current.options.length > 0) {
      // Multi-line option continuation appends to last option.
      const lastIndex = current.options.length - 1;
      current.options[lastIndex] = String(current.options[lastIndex] || "") + " " + line;
      current.options[lastIndex] = current.options[lastIndex].trim();
      return;
    }

    current.questionText = (String(current.questionText || "") + " " + line).trim();
  });

  finalizeCurrent();

  return normalizeExtractedQuestions(questions);
}

async function extractTextFromExamFile(file) {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  const fileName = String(file?.originalname || "").toLowerCase();
  const fileBuffer = file?.buffer;
  if (!fileBuffer || !fileBuffer.length) return "";

  const isPdf = mimeType === "application/pdf" || fileName.endsWith(".pdf");
  const isDocx = mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx");
  const isXlsx = mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || fileName.endsWith(".xlsx");
  const isImage = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mimeType)
    || [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((ext) => fileName.endsWith(ext));

  if (isPdf) {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(fileBuffer);
    return String(parsed?.text || "").trim();
  }

  if (isDocx) {
    const mammoth = require("mammoth");
    const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
    return String(textResult?.value || "").trim();
  }

  if (isXlsx) {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const rows = [];
    workbook.eachSheet((sheet) => {
      rows.push("Sheet: " + sheet.name);
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = Array.isArray(row.values)
          ? row.values.slice(1).map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        if (values.length) {
          rows.push("Row " + rowNumber + ": " + values.join(" | "));
        }
      });
    });

    return rows.join("\n").trim();
  }

  if (isImage) {
    const Tesseract = require("tesseract.js");
    const ocrResult = await Tesseract.recognize(fileBuffer, "eng");
    return String(ocrResult?.data?.text || "").trim();
  }

  return "";
}

function parseBooleanValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalizedValue = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalizedValue);
}

function parseDateTimeValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeAssessmentEditability(control, now = new Date()) {
  const locked = Boolean(control?.is_locked);
  const active = control?.is_active === undefined || control?.is_active === null
    ? true
    : Boolean(control.is_active);

  const windowStart = control?.edit_window_start ? new Date(control.edit_window_start) : null;
  const windowEnd = control?.edit_window_end ? new Date(control.edit_window_end) : null;

  const withinStart = !windowStart || now >= windowStart;
  const withinEnd = !windowEnd || now <= windowEnd;
  const withinWindow = withinStart && withinEnd;

  if (locked) {
    return { canEdit: false, reason: "Locked" };
  }
  if (!active) {
    return { canEdit: false, reason: "Inactive" };
  }
  if (!withinWindow) {
    return { canEdit: false, reason: "Outside time window" };
  }

  return { canEdit: true, reason: "Editable" };
}

async function recomputeSubjectTotalsForStudent(db, { studentId, subjectId, classId, termId, organizationId }) {
  const resultsRes = await db.query(
    `SELECT ar.score, ar.category, a.max_score
     FROM assessment_results ar
     JOIN assessments a ON a.assessment_id = ar.assessment_id
     WHERE ar.student_id = $1 AND ar.subject_id = $2 AND ar.term_id = $3 AND ar.class_id = $4
       AND ar.score IS NOT NULL`,
    [studentId, subjectId, termId, classId]
  );

  let totalScore = 0;
  let maxTotalScore = 0;
  const categoryScoresMap = {};
  resultsRes.rows.forEach((row) => {
    const score = parseFloat(row.score) || 0;
    totalScore += score;
    maxTotalScore += parseFloat(row.max_score) || 0;
    const category = row.category || "Uncategorized";
    categoryScoresMap[category] = (categoryScoresMap[category] || 0) + score;
  });

  const totalPercentage = maxTotalScore > 0 ? (totalScore / maxTotalScore) * 100 : null;
  const grade =
    totalPercentage !== null
      ? await getGradeLabelFromScoreRemark(db, organizationId, classId, termId, totalPercentage)
      : "-";

  await db.query(
    `UPDATE assessment_results
     SET total_subject_score = $1, total_percentage = $2, grade = $3
     WHERE student_id = $4 AND subject_id = $5 AND term_id = $6 AND class_id = $7`,
    [totalScore, totalPercentage, grade, studentId, subjectId, termId, classId]
  );

  for (const category in categoryScoresMap) {
    await db.query(
      `INSERT INTO category_scores (student_id, class_id, subject_id, organization_id, category, total_score, term_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (student_id, class_id, subject_id, organization_id, category, term_id)
       DO UPDATE SET total_score = EXCLUDED.total_score`,
      [studentId, classId, subjectId, organizationId, category, categoryScoresMap[category], termId]
    );
  }
}

async function notifyTeachersForAssessmentControl({
  database,
  organizationId,
  classIds,
  testTitle,
  termName,
  lockState,
  activeState,
  editWindowStart,
  editWindowEnd,
}) {
  if (!database || !organizationId || !Array.isArray(classIds) || classIds.length === 0) {
    return;
  }

  const teacherResult = await database.query(
    `
      SELECT DISTINCT u.email, u.first_name, u.last_name
      FROM user_classes uc
      JOIN users u ON u.user_id = uc.user_id
      WHERE uc.class_id = ANY($1::int[])
        AND u.organization_id = $2
        AND u.account_type = 'Teacher'
        AND u.email IS NOT NULL
        AND u.email <> ''
    `,
    [classIds, organizationId]
  );

  if (teacherResult.rows.length === 0) return;

  const classResult = await database.query(
    `SELECT class_name
       FROM classes
      WHERE class_id = ANY($1::int[])
        AND organization_id = $2
      ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
    [classIds, organizationId]
  );

  const classNames = classResult.rows.map((row) => row.class_name).join(", ");
  const lockText = lockState ? "Locked" : "Unlocked";
  const activeText = activeState ? "Activated" : "Not activated";
  const startText = editWindowStart ? new Date(editWindowStart).toLocaleString() : "Not set";
  const endText = editWindowEnd ? new Date(editWindowEnd).toLocaleString() : "Not set";

  await Promise.all(
    teacherResult.rows.map(async (teacher) => {
      // Respect each teacher's per-recipient assessment_access_update preference.
      if (!(await isEmailEnabledForRecipient(database, teacher.email, 'assessment_access_update'))) return;
      const fullName = [teacher.first_name, teacher.last_name].filter(Boolean).join(" ") || "Teacher";
      const html = renderCleanEmail({
        title: "Assessment Access Update",
        greeting: `Hello ${fullName},`,
        paragraphs: [
          `An assessment access setting has been updated for: <strong>${he.encode(String(testTitle || "Assessment"))}</strong>.`,
          `This affects class(es): <strong>${he.encode(String(classNames || "N/A"))}</strong>.`,
        ],
        details: [
          { label: "Term", value: he.encode(String(termName || "Current Term")) },
          { label: "Lock status", value: lockText },
          { label: "Activation", value: activeText },
          { label: "Edit window start", value: he.encode(startText) },
          { label: "Edit window end", value: he.encode(endText) },
        ],
      });

      sendEmailInBackground(
        {
          to: teacher.email,
          subject: `Assessment Access Update: ${testTitle || "Assessment"}`,
          html,
          failureNotification: buildFailureNotification(organizationId, {
            title: "Assessment access email failed",
            body: `The assessment access email for ${testTitle || "Assessment"} could not be delivered to ${teacher.email}.`,
          }),
        },
        "Assessment Access Notification"
      );
    })
  );
}

let scoreRemarkGradeSchemaReady = false;

async function ensureScoreRemarkGradeSchema(dbClient) {
  if (scoreRemarkGradeSchemaReady) return;
  await dbClient.query(
    "ALTER TABLE score_remarks ADD COLUMN IF NOT EXISTS grade_label TEXT"
  );
  scoreRemarkGradeSchemaReady = true;
}

function getDefaultGradeLabel(percentage) {
  const value = Number(percentage);
  if (!Number.isFinite(value)) return "-";
  if (value >= 90) return "A";
  if (value >= 80) return "B";
  if (value >= 70) return "C";
  return "D";
}

async function getGradeLabelFromScoreRemark(
  dbClient,
  organizationId,
  classId,
  termId,
  percentage
) {
  if (percentage === null || percentage === undefined || Number.isNaN(percentage)) {
    return "-";
  }

  await ensureScoreRemarkGradeSchema(dbClient);

  const remarkResult = await dbClient.query(
    `SELECT grade_label
     FROM score_remarks
     WHERE organization_id = $1
       AND class_id = $2
       AND term_id = $3
       AND NULLIF(TRIM(grade_label), '') IS NOT NULL
     ORDER BY
       CASE
         WHEN $4::numeric BETWEEN from_percentage AND to_percentage THEN 0
         WHEN $4::numeric < from_percentage THEN from_percentage - $4::numeric
         ELSE $4::numeric - to_percentage
       END ASC,
       from_percentage DESC
     LIMIT 1`,
    [organizationId, classId, termId, percentage]
  );

  const configuredLabel = String(remarkResult.rows[0]?.grade_label || "").trim();
  return configuredLabel || getDefaultGradeLabel(percentage);
}

const commonController = {
  orgDashboard: async (req, res, db) => {
    // ...removed log for clean background operation...
    try {
      // Allow super admin org switch even if not an org user
      const organizationId = req.session.organizationId;
      const orgNameDisplayFormat = req.session?.nameDisplayFormat;
      const currentUserRole = req.session.userRole;
      const url = req.url;
      const isSuperAdminSwitch = req.session.superAdminOrgSwitch;

      const orgCountryResult = await db.query(
        "SELECT organization_country FROM organizations WHERE organization_id = $1",
        [organizationId]
      );
      const dashboardCountryCode = String(orgCountryResult.rows[0]?.organization_country || "")
        .trim()
        .toUpperCase();
      const dashboardCountryName = COUNTRY_NAME_LOOKUP[dashboardCountryCode] || dashboardCountryCode || "";

      // Fetch the current school year and term
      const schoolYearResult = await db.query(
        `
          SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
          FROM school_years sy
          LEFT JOIN terms t ON sy.id = t.school_year_id
          WHERE sy.organization_id = $1 AND sy.current = TRUE
          ORDER BY t.start_date
        `,
        [organizationId]
      );

      let schoolYear = null;
      let currentTerm = null;

      if (schoolYearResult.rows.length > 0) {
        schoolYear = {
          id: schoolYearResult.rows[0].school_year_id,
          year_label: schoolYearResult.rows[0].year_label,
          terms: schoolYearResult.rows.map((row) => ({
            term_id: row.term_id,
            term_name: row.term_name,
            start_date: row.start_date,
            end_date: row.end_date,
            current: row.current,
          })),
        };
        currentTerm = schoolYearResult.rows.find((row) => row.current);
      }

      if (schoolYear && currentTerm) {
        return res.redirect(
          `/common/orgDashboard/schoolYearId/${schoolYear.id}/termId/${currentTerm.term_id}`
        );
      }

      // Fetch both global and org-specific admin announcements.
      // Exclude entries flagged show_for_admins = TRUE — those are
      // intended only for the admin dashboard / internal staff.
      const adminAnnouncementResult = await db.query(
        `
          SELECT * FROM admin_announcements
          WHERE is_active = true
            AND COALESCE(show_for_admins, false) = false
            AND (organization_id IS NULL OR organization_id = $1)
            AND (expiry_date IS NULL OR expiry_date > NOW())
          ORDER BY id DESC
        `,
        [organizationId]
      );

      // If super admin org switch, skip org user checks
      let userSession = null;
      let currentUserId = null;
      let isOrgAccount = false;
      if (isSuperAdminSwitch) {
        // For super admin org switch, use userId from session and treat as user, not org
        currentUserId = req.session.userId || req.session.user_id || null;
        isOrgAccount = false;
      } else {
        userSession = req.session.user || req.session.orgUser;
        currentUserId = userSession
          ? userSession.user_id || userSession.organization_id
          : null;
        isOrgAccount = !!req.session.orgUser;
      }

      const adminAnnouncements = [];
      for (const announcement of adminAnnouncementResult.rows) {
        let viewResult;
        if (isOrgAccount) {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE organization_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        } else {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE user_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        }

        const shouldShow =
          viewResult.rows.length === 0 ||
          new Date() - new Date(viewResult.rows[0].last_viewed) >
            14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

        if (shouldShow) {
          adminAnnouncements.push(announcement);
          try {
            if (isOrgAccount) {
              if (viewResult.rows.length === 0) {
                // For super admin org switch, use the admin's userId for announcement_views
                let insertUserId = currentUserId;
                if (isSuperAdminSwitch) {
                  insertUserId = req.session.userId;
                }
                if (insertUserId) {
                  await db.query(
                    `INSERT INTO announcement_views (organization_id, announcement_id) VALUES ($1, $2)`,
                    [insertUserId, announcement.id]
                  );
                }
              } else {
                await db.query(
                  `UPDATE announcement_views SET last_viewed = CURRENT_TIMESTAMP WHERE view_id = $1`,
                  [viewResult.rows[0].view_id]
                );
              }
            } else {
              // Idempotent write to avoid unique-conflict races when SPA preloads
              // and user navigation hit this endpoint at nearly the same time.
              const insertUserId = isSuperAdminSwitch
                ? (req.session.userId || null)
                : currentUserId;
              if (insertUserId) {
                await db.query(
                  `INSERT INTO announcement_views (user_id, announcement_id, last_viewed)
                   VALUES ($1, $2, CURRENT_TIMESTAMP)
                   ON CONFLICT (user_id, announcement_id)
                   DO UPDATE SET last_viewed = EXCLUDED.last_viewed`,
                  [insertUserId, announcement.id]
                );
              }
            }
          } catch (viewWriteError) {
            console.warn("[orgDashboard] Unable to persist announcement view", {
              announcementId: announcement.id,
              userId: currentUserId,
              orgMode: isOrgAccount,
              message: viewWriteError?.message || viewWriteError,
            });
          }
        }
      }

      let orgHeaderName = null;
      let orgHeaderLogo = null;
      let orgHeaderNickname = null;
      let orgHeaderNicknameDisplay = null;
      let nextTermSuggestion = null;

      if (currentTerm && currentTerm.end_date) {
        const nextTermResult = await db.query(
          `
            SELECT
              t.term_id,
              t.term_name,
              t.school_year_id,
              sy.year_label,
              t.start_date,
              t.end_date
            FROM terms t
            JOIN school_years sy ON sy.id = t.school_year_id
            WHERE t.organization_id = $1
              AND t.start_date > $2::date
            ORDER BY t.start_date ASC
            LIMIT 1
          `,
          [organizationId, currentTerm.end_date]
        );

        if (nextTermResult.rows.length > 0) {
          nextTermSuggestion = nextTermResult.rows[0];
        }
      }

      if (req.session.superAdminOrgSwitch) {
        const orgResult = await db.query(
          "SELECT organization_name, logo, nickname, nickname_display FROM organizations WHERE organization_id = $1",
          [organizationId]
        );
        if (orgResult.rows.length > 0) {
          orgHeaderName = orgResult.rows[0].organization_name;
          orgHeaderLogo = orgResult.rows[0].logo;
          orgHeaderNickname = orgResult.rows[0].nickname;
          orgHeaderNicknameDisplay = (orgResult.rows[0].nickname_display && String(orgResult.rows[0].nickname_display).trim()) || orgResult.rows[0].nickname;
        }
      }
      res.render("common/orgDashboard", {
        title: "Organization Dashboard",
        url,
        schoolYear,
        currentTerm,
        classes: [], // No classes found for this scenario
        events: currentUserRole !== "teacher" ? null : [],
        announcements:
          currentUserRole !== "manager" && currentUserRole !== "supervisor"
            ? null
            : [],
        organizationId,
        messages: req.flash(),
        adminAnnouncements,
        showOrgHeader: req.session.superAdminOrgSwitch || false,
        orgHeaderName,
        orgHeaderLogo,
        orgHeaderNickname,
        orgHeaderNicknameDisplay: typeof orgHeaderNicknameDisplay !== 'undefined' ? orgHeaderNicknameDisplay : null,
        dashboardCountryCode,
        dashboardCountryName,
        todayAttendanceStatus: null,
        nextTermSuggestion,
      });
      // ...removed log for clean background operation...
    } catch (error) {
      console.error("[orgDashboard] Failed to load dashboard", {
        organizationId: req.session?.organizationId || null,
        userId: req.session?.user?.user_id || req.session?.userId || null,
        userRole: req.session?.userRole || null,
        message: error?.message || error,
      });
      req.flash(
        "error",
        "Failed to load dashboard data. Please refresh or contact support if needed."
      );
      return res.render("common/orgDashboard", {
        title: "Organization Dashboard",
        url: req.url,
        schoolYear: null,
        currentTerm: null,
        classes: [],
        events: [],
        announcements: [],
        organizationId: req.session?.organizationId || null,
        messages: req.flash(),
        adminAnnouncements: [],
        showOrgHeader: Boolean(req.session?.superAdminOrgSwitch),
        orgHeaderName: null,
        orgHeaderLogo: null,
        orgHeaderNickname: null,
        orgHeaderNicknameDisplay: null,
        dashboardCountryCode: "",
        dashboardCountryName: "",
        todayAttendanceStatus: null,
        nextTermSuggestion: null,
      });
    }
  },

  orgDashboardRestricted: async (req, res, db) => {
    // ...removed log for clean background operation...
    try {
      const isSuperAdminSwitch = req.session.superAdminOrgSwitch;
      const isProduction = process.env.NODE_ENV === "production";
      const school = isProduction ? req.schoolDetails : null;
      // Prefer the subdomain-resolved org, but fall back to the logged-in
      // session's organizationId when req.schoolDetails hasn't been attached
      // for this request (e.g. a subdomain-cache miss/race right after an
      // org is set up) — otherwise a valid logged-in user gets bounced to
      // the public landing page instead of their dashboard.
      const organizationId =
        school?.organization_id || req.session.organizationId || null;
      const orgNameDisplayFormat = req.session?.nameDisplayFormat;

      if (!organizationId) {
        req.flash("error", "School not found.");
        return res.redirect("/");
      }

      const orgCountryResult = await db.query(
        "SELECT organization_country FROM organizations WHERE organization_id = $1",
        [organizationId]
      );
      const dashboardCountryCode = String(orgCountryResult.rows[0]?.organization_country || "")
        .trim()
        .toUpperCase();
      const dashboardCountryName = COUNTRY_NAME_LOOKUP[dashboardCountryCode] || dashboardCountryCode || "";

      const url = req.url;
      const { schoolYearId, termId } = req.params;
      const userSession = req.session.user || req.session.orgUser;
      const currentUserId =
        (req.session.user && req.session.user.user_id) ||
        req.session.userId ||
        (userSession ? userSession.user_id || userSession.organization_id : null);
      const isOrgAccount = !!req.session.orgUser;

      let effectiveDashboardRole = String(req.session.userRole || "").trim().toLowerCase();
      if (currentUserId && !isOrgAccount) {
        const roleResult = await db.query(
          "SELECT account_type FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1",
          [currentUserId, organizationId]
        );
        if (roleResult.rows.length > 0 && roleResult.rows[0].account_type) {
          effectiveDashboardRole = String(roleResult.rows[0].account_type).trim().toLowerCase();
        }
      }

      const shouldRestrictToAssignedClasses =
        effectiveDashboardRole === "teacher" ||
        effectiveDashboardRole === "supervisor" ||
        effectiveDashboardRole === "superviser";

      // Fetch current school year and term
      const schoolYearResult = await db.query(
        `
          SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
          FROM school_years sy
          LEFT JOIN terms t ON sy.id = t.school_year_id
          WHERE sy.id = $1 AND t.term_id = $2 AND sy.organization_id = $3
        `,
        [schoolYearId, termId, organizationId]
      );

      let schoolYear = null;
      let currentTerm = null;

      if (schoolYearResult.rows.length > 0) {
        schoolYear = {
          id: schoolYearResult.rows[0].school_year_id,
          year_label: schoolYearResult.rows[0].year_label,
          terms: schoolYearResult.rows.map((row) => ({
            term_id: row.term_id,
            term_name: row.term_name,
            start_date: row.start_date,
            end_date: row.end_date,
            current: row.current,
          })),
        };
        currentTerm = schoolYearResult.rows.find(
          (row) => row.term_id == termId
        );
      }

      if (!schoolYear || !currentTerm) {
        req.flash("error", "Invalid school year or term.");
        return res.redirect("/common/orgDashboard");
      }

      let todayAttendanceStatus = null;

      // Build today's attendance status label (weekend/holiday/manual/school day)
      // using the same source data as attendance collection.
      try {
        await ensureAttendanceCalendarSchema(db);
        const attendanceCalendarProfile = await getAttendanceCalendarProfile(
          db,
          organizationId,
          currentTerm.term_id
        );

        if (attendanceCalendarProfile) {
          const attendanceCalendarDays = await getAttendanceCalendarDays(
            db,
            attendanceCalendarProfile.calendar_id,
            currentTerm.start_date,
            currentTerm.end_date
          );
          const dayMap = buildCalendarDayMap(attendanceCalendarDays);
          const todayKey = toDateKey(new Date());
          const matchedDay = dayMap.get(todayKey);

          let label = "School Day";

          if (matchedDay && String(matchedDay.source || "").toLowerCase() === "manual") {
            label = matchedDay.label || (Boolean(matchedDay.counts_for_attendance) ? "School Day" : "Excluded");
          } else if (
            matchedDay &&
            String(matchedDay.source || "").toLowerCase() === "public_holiday" &&
            Boolean(attendanceCalendarProfile.include_public_holidays)
          ) {
            label = matchedDay.label || "Public Holiday";
          } else {
            const weekendDays = new Set(
              ((attendanceCalendarProfile && attendanceCalendarProfile.weekend_days) || [])
                .map((day) => Number(day))
                .filter((day) => Number.isInteger(day))
            );
            const todayDow = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay();

            if (weekendDays.has(todayDow)) {
              label = "Weekend";
            }
          }

          todayAttendanceStatus = {
            label,
          };
        }
      } catch (_calendarError) {
        todayAttendanceStatus = null;
      }

      let classes = [];

      await ensureClassDashboardLayoutSchema(db);

      req.session.currentTermId = currentTerm.term_id;
      // ...removed log for clean background operation...
      // ...removed log for clean background operation...

      if (!currentUserId) {
        // ...removed error log for clean background operation...
      }

      const activeEnrollmentResult = await db.query(
        `
          SELECT enrollment_id
          FROM enrollments
          WHERE term_id = $1
            AND school_year_id = $2
            AND organization_id = $3
          ORDER BY enrollment_id ASC
          LIMIT 1
        `,
        [termId, schoolYearId, organizationId]
      );
      const activeEnrollmentId = Number(activeEnrollmentResult.rows[0]?.enrollment_id) || null;

      const enrolledClassesResult = activeEnrollmentId
        ? await db.query(
            `
              SELECT DISTINCT ec.class_id
              FROM enrolled_classes ec
              WHERE ec.enrollment_id = $1
            `,
            [activeEnrollmentId]
          )
        : { rows: [] };
      const enrolledClassIdSet = new Set(
        enrolledClassesResult.rows
          .map((row) => Number(row.class_id))
          .filter((classId) => Number.isInteger(classId))
      );

      if (shouldRestrictToAssignedClasses) {
        const teacherClassesResult = await db.query(
          `
            SELECT uc.class_id, c.class_name, c.dashboard_sort_order, c.dashboard_break_after,
                json_agg(
                    json_build_object(
                        'user_id', u.user_id,
                        'first_name', u.first_name,
                        'last_name', u.last_name,
                        'name', u.first_name || ' ' || u.last_name,
                        'main', uc.main,
                        'on_hold', u.on_hold,
                        'reset_password_token', u.reset_password_token
                    ) ORDER BY u.user_id
                ) AS employees
            FROM user_classes uc
            INNER JOIN classes c ON uc.class_id = c.class_id
            INNER JOIN users u ON u.user_id = uc.user_id
            WHERE uc.class_id IN (
                SELECT class_id FROM user_classes WHERE user_id = $1
            )
            AND u.organization_id = $2
            GROUP BY uc.class_id, c.class_name, c.dashboard_sort_order, c.dashboard_break_after
            ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, uc.class_id ASC
          `,
          [currentUserId, organizationId]
        );

        const assignedClasses = teacherClassesResult.rows;

        // Match assigned classes with enrolled classes for this selected term.
        classes = assignedClasses.filter((cls) =>
          enrolledClassIdSet.has(Number(cls.class_id))
        );
      } else {
        // Fetch all enrolled classes for manager-like roles
        const termEnrolledClassesResult = activeEnrollmentId
          ? await db.query(
          `
                    SELECT c.class_id, c.class_name, c.dashboard_sort_order, c.dashboard_break_after,
                    json_agg(
                        json_build_object(
                            'user_id', u.user_id,
                            'first_name', u.first_name,
                            'last_name', u.last_name,
                            'name', u.first_name || ' ' || u.last_name,
                            'main', uc.main,
                            'on_hold', u.on_hold,
                            'reset_password_token', u.reset_password_token
                        ) ORDER BY u.user_id
                    ) AS employees
                FROM enrolled_classes ec
                INNER JOIN classes c ON ec.class_id = c.class_id
                LEFT JOIN user_classes uc ON c.class_id = uc.class_id
                LEFT JOIN users u ON u.user_id = uc.user_id
                WHERE ec.enrollment_id = $1
                GROUP BY c.class_id, c.class_name, c.dashboard_sort_order, c.dashboard_break_after
                ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC

                `,
          [activeEnrollmentId]
        )
          : { rows: [] };
        classes = termEnrolledClassesResult.rows;
      }

      // Hard gate: dashboard must only include classes enrolled for selected term/year.
      classes = (classes || []).filter((cls) =>
        enrolledClassIdSet.has(Number(cls.class_id))
      );

      classes = (classes || []).map((cls) => ({
        ...cls,
        employees: Array.isArray(cls.employees)
          ? cls.employees
              .filter(Boolean)
              .map((employee) => ({
                ...employee,
                name:
                  formatDisplayName(employee, orgNameDisplayFormat) ||
                  employee.name ||
                  [employee.first_name, employee.last_name].filter(Boolean).join(" ").trim(),
              }))
          : [],
      }));

      // Events and announcements
      const eventsResult = await db.query(
        `
          SELECT * FROM school_events 
          WHERE organization_id = $1 
          AND (visibility = 'org' OR visibility = 'both')
          ORDER BY event_date DESC
        `,
        [organizationId]
      );
      const events = eventsResult.rows;

      const announcementsResult = await db.query(
        `
          SELECT * FROM announcements 
          WHERE organization_id = $1 
          AND (visibility = 'org' OR visibility = 'both')
          ORDER BY announcement_id DESC
        `,
        [organizationId]
      );
      const announcements = announcementsResult.rows;

      // ✅ Fetch BOTH global and org-specific admin announcements.
      // Skip entries flagged show_for_admins = TRUE so org users
      // (manager / teacher / supervisor) never see admin-only notices.
      const adminAnnouncementResult = await db.query(
        `
          SELECT * FROM admin_announcements
          WHERE is_active = true
            AND COALESCE(show_for_admins, false) = false
            AND (organization_id IS NULL OR organization_id = $1)
            AND (expiry_date IS NULL OR expiry_date > NOW())
          ORDER BY id DESC
        `,
        [organizationId]
      );

      const adminAnnouncements = [];
      for (const announcement of adminAnnouncementResult.rows) {
        let viewResult;
        if (isOrgAccount) {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE organization_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        } else {
          viewResult = await db.query(
            `SELECT * FROM announcement_views WHERE user_id = $1 AND announcement_id = $2`,
            [currentUserId, announcement.id]
          );
        }

        const shouldShow =
          viewResult.rows.length === 0 ||
          new Date() - new Date(viewResult.rows[0].last_viewed) >
            14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

        if (shouldShow) {
          adminAnnouncements.push(announcement);
          try {
            if (isOrgAccount) {
              if (viewResult.rows.length === 0) {
                let insertUserId = currentUserId;
                if (isSuperAdminSwitch) {
                  insertUserId = req.session.userId;
                }
                if (insertUserId) {
                  await db.query(
                    `INSERT INTO announcement_views (organization_id, announcement_id) VALUES ($1, $2)`,
                    [insertUserId, announcement.id]
                  );
                }
              } else {
                await db.query(
                  `UPDATE announcement_views SET last_viewed = CURRENT_TIMESTAMP WHERE view_id = $1`,
                  [viewResult.rows[0].view_id]
                );
              }
            } else {
              const insertUserId = isSuperAdminSwitch
                ? (req.session.userId || null)
                : currentUserId;
              if (insertUserId) {
                await db.query(
                  `INSERT INTO announcement_views (user_id, announcement_id, last_viewed)
                   VALUES ($1, $2, CURRENT_TIMESTAMP)
                   ON CONFLICT (user_id, announcement_id)
                   DO UPDATE SET last_viewed = EXCLUDED.last_viewed`,
                  [insertUserId, announcement.id]
                );
              }
            }
          } catch (viewWriteError) {
            console.warn("[orgDashboardRestricted] Unable to persist announcement view", {
              announcementId: announcement.id,
              userId: currentUserId,
              orgMode: isOrgAccount,
              message: viewWriteError?.message || viewWriteError,
            });
          }
        }
      }

      let orgHeaderName = null;
      let orgHeaderLogo = null;
      let orgHeaderNickname = null;
      let orgHeaderNicknameDisplay = null;
      let nextTermSuggestion = null;

      if (currentTerm && currentTerm.end_date) {
        const nextTermResult = await db.query(
          `
            SELECT
              t.term_id,
              t.term_name,
              t.school_year_id,
              sy.year_label,
              t.start_date,
              t.end_date
            FROM terms t
            JOIN school_years sy ON sy.id = t.school_year_id
            WHERE t.organization_id = $1
              AND t.start_date > $2::date
            ORDER BY t.start_date ASC
            LIMIT 1
          `,
          [organizationId, currentTerm.end_date]
        );

        if (nextTermResult.rows.length > 0) {
          nextTermSuggestion = nextTermResult.rows[0];
        }
      }

      if (req.session.superAdminOrgSwitch) {
        const orgResult = await db.query(
          "SELECT organization_name, logo, nickname, nickname_display FROM organizations WHERE organization_id = $1",
          [organizationId]
        );
        if (orgResult.rows.length > 0) {
          orgHeaderName = orgResult.rows[0].organization_name;
          orgHeaderLogo = orgResult.rows[0].logo;
          orgHeaderNickname = orgResult.rows[0].nickname;
          orgHeaderNicknameDisplay = (orgResult.rows[0].nickname_display && String(orgResult.rows[0].nickname_display).trim()) || orgResult.rows[0].nickname;
        }
      }
      res.render("common/orgDashboard", {
        title: "Organization Dashboard",
        url,
        schoolYear,
        currentTerm,
        classes,
        events,
        announcements,
        organizationId,
        messages: req.flash(), // ✅ pass flash messages to the view
        adminAnnouncements, // ✅ admin announcements to display
        showOrgHeader: req.session.superAdminOrgSwitch || false,
        orgHeaderName,
        orgHeaderLogo,
        orgHeaderNickname,
        orgHeaderNicknameDisplay: typeof orgHeaderNicknameDisplay !== 'undefined' ? orgHeaderNicknameDisplay : null,
        dashboardCountryCode,
        dashboardCountryName,
        todayAttendanceStatus,
        nextTermSuggestion,
        // Include any additional data as needed
      });
    } catch (error) {
      console.error("[orgDashboardRestricted] Failed to load dashboard", {
        organizationId: req.session?.organizationId || null,
        userId: req.session?.user?.user_id || req.session?.userId || null,
        userRole: req.session?.userRole || null,
        params: req.params,
        message: error?.message || error,
      });
      req.flash(
        "error",
        "Failed to load dashboard data. Please try again or contact support if this issue persists."
      ); // ✅ more user-friendly flash
      return res.render("common/orgDashboard", {
        title: "Organization Dashboard",
        url: req.url,
        schoolYear: null,
        currentTerm: null,
        classes: [],
        events: [],
        announcements: [],
        organizationId: req.session?.organizationId || null,
        messages: req.flash(),
        adminAnnouncements: [],
        showOrgHeader: Boolean(req.session?.superAdminOrgSwitch),
        orgHeaderName: null,
        orgHeaderLogo: null,
        orgHeaderNickname: null,
        orgHeaderNicknameDisplay: null,
        dashboardCountryCode: "",
        dashboardCountryName: "",
        todayAttendanceStatus: null,
        nextTermSuggestion: null,
      });
    }
  },

  publicDashboardContent: async (req, res, db) => {
    try {
      // Check if the user is logged in by checking the session
      const organizationId = req.query.organizationId || req.organizationId;
      const url = req.url;

      if (!organizationId) {
        throw new Error("Invalid organization ID.");
      }

      // Fetch the saved order of the items
      const orderResult = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      const orgDetailsResult = await db.query(
        `SELECT 
          organization_id, 
          logo, 
          aboutus, 
          motto, 
          email,
          organization_phone,
          organization_name,
          organization_address,
          organization_country,
          organization_province,
          geo_lat,
          geo_lng,
          nickname,
          nickname_display,
          font_style,
          theme_color,
          is_hub_member,
          hub_id,
          public_registration_enabled,
          registration_start_date,
          registration_end_date
        FROM organizations 
        WHERE organization_id = $1`,
        [organizationId]
      );

      const orgDetails = orgDetailsResult.rows[0];

      const baseSiteUrl = "https://www.managira.com";
      const toAbsoluteUrl = (value) => {
        if (!value) return null;
        if (/^https?:\/\//i.test(value)) return value;
        const normalizedPath = value.startsWith("/") ? value : `/${value}`;
        return `${baseSiteUrl}${normalizedPath}`;
      };

      let publicHubInfo = null;
      if (orgDetails && orgDetails.is_hub_member && orgDetails.hub_id) {
        try {
          const hubInfoResult = await db.query(
            `SELECT hub_id, hub_name, logo_path, hub_branding_enabled, hub_footer_text
             FROM managira_hubs
             WHERE hub_id = $1 AND deleted = false
             LIMIT 1`,
            [orgDetails.hub_id]
          );

          if (hubInfoResult.rows.length > 0) {
            publicHubInfo = hubInfoResult.rows[0];
          }
        } catch (hubInfoError) {
          console.warn('[PublicDashboard] Unable to fetch hub footer branding info', {
            organizationId,
            hubId: orgDetails.hub_id,
            message: hubInfoError.message
          });
        }
      }

      // order_data supports both legacy array format and object format:
      // - legacy: ["image-gallery", "text-articles", ...]
      // - new: { order: [...], theme: "classic"|"modern"|"minimal"|"bold" }
      let savedOrder = [];
      let publicDashboardTheme = "classic";
      let publicDashboardLayout = "wireframe1";
      let aboutDetails = {
        mottos: orgDetails?.motto ? [orgDetails.motto] : [],
        emails: orgDetails?.email ? [orgDetails.email] : [],
        phones: orgDetails?.organization_phone ? [orgDetails.organization_phone] : [],
      };
      if (orderResult.rows.length > 0) {
        try {
          let rawData = orderResult.rows[0].order_data;
          if (typeof rawData === "string") {
            rawData = JSON.parse(rawData);
          }

          if (Array.isArray(rawData)) {
            savedOrder = rawData;
          } else if (rawData && typeof rawData === "object") {
            if (Array.isArray(rawData.order)) {
              savedOrder = rawData.order;
            }
            if (typeof rawData.theme === "string" && rawData.theme.trim()) {
              publicDashboardTheme = rawData.theme.trim();
            }
            if (typeof rawData.layout === "string" && rawData.layout.trim()) {
              publicDashboardLayout = rawData.layout.trim();
            }
            if (rawData.aboutDetails && typeof rawData.aboutDetails === "object") {
              const toList = (value) => {
                const values = Array.isArray(value) ? value : [value];
                return values
                  .map((item) => String(item || "").trim())
                  .filter(Boolean);
              };

              aboutDetails = {
                mottos: toList(rawData.aboutDetails.mottos),
                emails: toList(rawData.aboutDetails.emails),
                phones: toList(rawData.aboutDetails.phones),
              };

              if (!aboutDetails.mottos.length && orgDetails?.motto) {
                aboutDetails.mottos = [orgDetails.motto];
              }
              if (!aboutDetails.emails.length && orgDetails?.email) {
                aboutDetails.emails = [orgDetails.email];
              }
              if (!aboutDetails.phones.length && orgDetails?.organization_phone) {
                aboutDetails.phones = [orgDetails.organization_phone];
              }
            }
          }
        } catch (parseError) {
          savedOrder = [];
          publicDashboardTheme = "classic";
          publicDashboardLayout = "wireframe1";
        }
      }

      // Fetch images for the organization
      const imagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 ORDER BY image_id",
        [organizationId]
      );
      const images = imagesResult.rows;

      // Separate images for the slideshow vs. normal images
      const slideshowImages = images.filter(
        (img) => String(img.allocation || "").toLowerCase() === "slideshow"
      );

      const normalImages = images.filter(
        (img) => String(img.allocation || "").toLowerCase() !== "slideshow"
      );

      // Fetch texts for the organization
      const textsResult = await db.query(
        "SELECT * FROM organization_texts WHERE organization_id = $1 ORDER BY text_id",
        [organizationId]
      );
      const texts = textsResult.rows;

      // Fetch events visible to the public
      const eventsResult = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1 AND (visibility = 'public' OR visibility = 'both') ORDER BY event_date DESC",
        [organizationId]
      );
      const events = eventsResult.rows;

      // Fetch announcements visible to the public
      const announcementsResult = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1 AND (visibility = 'public' OR visibility = 'both') ORDER BY announcement_id DESC",
        [organizationId]
      );
      const announcements = announcementsResult.rows;

      // Build the "items" array for all other content
      let items = [];

      // ✅ Wrap all normal images under "image-gallery"
      items.push({
        type: "image-gallery",
        data: normalImages, // All images grouped together
        id: "image-gallery",
      });

      // ✅ Wrap all text articles under "text-articles"
      items.push({
        type: "text-articles",
        data: texts, // All texts grouped together
        id: "text-articles",
      });

      // Add events and announcements
      items.push({ type: "events", data: events, id: "events" });
      items.push({
        type: "announcements",
        data: announcements,
        id: "announcements",
      });

      // Sort items according to saved order or keep original order if there's no saved order
      const orderedItems =
        savedOrder.length > 0
          ? savedOrder
              .map((orderId) => items.find((item) => item.id === orderId))
              .filter(Boolean)
          : items;

      // Render the school website page
      const canonicalUrl = req.schoolDetails?.nickname
        ? `https://${req.schoolDetails.nickname}.managira.com/`
        : `${baseSiteUrl}/common/publicDashboard?organizationId=${organizationId}`;

      const flashMessages = req.flash();
      const publicErrorMessages = (flashMessages.error || []).filter(
        (msg) => String(msg).trim().toLowerCase() !== "invalid school year or term."
      );

      // Build a clean plain-text aboutus snippet for description
      const aboutusPlain = orgDetails?.aboutus
        ? String(orgDetails.aboutus).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().substring(0, 160)
        : null;

      const _publicAlias = orgDetails?.nickname_display || orgDetails?.nickname || "";
      const _countryCode = String(orgDetails?.organization_country || "").trim().toUpperCase();
      const _countryLabel = COUNTRY_NAME_LOOKUP[_countryCode] || _countryCode || "";
      const _nicknameLabel = orgDetails?.nickname ? String(orgDetails.nickname).trim() : "";
      const _nicknameDisplayLabel = orgDetails?.nickname_display ? String(orgDetails.nickname_display).trim() : "";
      const _schoolSiteName = _nicknameDisplayLabel || _nicknameLabel || String(orgDetails?.organization_name || "").trim() || "School";
      const _seoTitleParts = [orgDetails?.organization_name, _publicAlias, 'Official School Website']
        .map((value) => String(value || '').trim())
        .filter((value, index, list) => value && list.indexOf(value) === index);
      const seoTitle = orgDetails?.organization_name
        ? _seoTitleParts.join(' | ')
        : "Official School Website";

      const seoDescription = aboutusPlain
        ? `${aboutusPlain}${_publicAlias ? ` Also known as ${_publicAlias}.` : ""}${_nicknameLabel && _nicknameLabel !== _publicAlias ? ` Searchers may also know this school as ${_nicknameLabel}.` : ""}${_countryLabel ? ` Located in ${_countryLabel}.` : ''}`
        : `${orgDetails?.organization_name || "School"}${_publicAlias ? ` (${_publicAlias})` : ""}${_nicknameLabel && _nicknameLabel !== _publicAlias ? `, also known as ${_nicknameLabel},` : ''} official school website${_countryLabel ? ` in ${_countryLabel}` : ''}. View admissions, announcements, class information, and school updates.`;

      // Build rich keyword list: full name, every word, every partial combination,
      // nickname variations, and common school search terms — maximises chances of
      // appearing for partial name searches and minor spelling differences.
      const _orgName  = orgDetails?.organization_name || "";
      const _nickname = orgDetails?.nickname || "";
      const _nicknameDisplay = orgDetails?.nickname_display || "";
      const _words    = _orgName.split(/\s+/).filter(Boolean);

      const _acronym = _words
        .map((w) => String(w || "").trim())
        .filter(Boolean)
        .map((w) => w[0])
        .join("")
        .toUpperCase();

      const _nicknameVariants = new Set([
        _nickname,
        _nicknameDisplay,
      ].filter(Boolean));
      if (_nickname) {
        _nicknameVariants.add(_nickname.replace(/i/g, "e"));
        _nicknameVariants.add(_nickname.replace(/e/g, "i"));
      }

      const addPhraseVariants = (targetSet, phrase) => {
        const normalizedPhrase = String(phrase || '').trim();
        if (!normalizedPhrase) return;
        targetSet.add(normalizedPhrase);
        targetSet.add(normalizedPhrase.toLowerCase());
        const phraseWords = normalizedPhrase.split(/\s+/).filter(Boolean);
        for (let i = 0; i < phraseWords.length; i++) {
          for (let j = i + 1; j <= phraseWords.length; j++) {
            const segment = phraseWords.slice(i, j).join(' ');
            if (!segment) continue;
            targetSet.add(segment);
            targetSet.add(segment.toLowerCase());
          }
        }
      };

      // All consecutive word subsequences (e.g. "SAM KORANCHIE", "KORANCHIE SOLID", etc.)
      const _nameVariants = new Set();
      addPhraseVariants(_nameVariants, _orgName);
      addPhraseVariants(_nameVariants, _nickname);
      addPhraseVariants(_nameVariants, _nicknameDisplay);
      addPhraseVariants(_nameVariants, _acronym);
      addPhraseVariants(_nameVariants, `${_nickname}.managira.com`);
      _nicknameVariants.forEach((variant) => {
        addPhraseVariants(_nameVariants, variant);
      });
      for (let i = 0; i < _words.length; i++) {
        for (let j = i + 1; j <= _words.length; j++) {
          _nameVariants.add(_words.slice(i, j).join(" "));
          _nameVariants.add(_words.slice(i, j).join(" ").toLowerCase());
        }
      }
      // Drop empties
      _nameVariants.delete("");
      _nameVariants.delete(" ");

      const seoKeywords = [
        ..._nameVariants,
        `${_orgName} school`,
        `${_orgName} official school`,
        `${_orgName} admissions`,
        `${_orgName} enrollment`,
        `${_orgName} website`,
        `${_orgName} school website`,
        `${_acronym} school`,
        `${_acronym} website`,
        `${_nickname} school`,
        `${_nickname} managira`,
        `${_nickname} website`,
        `${_nicknameDisplay} school`,
        `${_nicknameDisplay} website`,
        _countryLabel ? `${_orgName} ${_countryLabel}` : '',
        _countryLabel ? `${_nicknameDisplay} ${_countryLabel}` : '',
        _countryLabel ? `${_nicknameLabel} ${_countryLabel}` : '',
        _countryLabel ? `school portal ${_countryLabel}` : '',
        _countryLabel ? `school website ${_countryLabel}` : '',
        "school management system",
        "managira school",
        _countryLabel ? `school admissions ${_countryLabel}` : 'school admissions',
      ].filter(Boolean).join(", ");

      const searchIdentityTerms = [...new Set([
        orgDetails?.organization_name,
        _nicknameDisplayLabel,
        _nicknameLabel,
        _acronym,
        `${_nicknameLabel}.managira.com`,
      ].map((value) => String(value || '').trim()).filter(Boolean))];

      // Build rich Schema.org School structured data
      const _logoAbs = toAbsoluteUrl(
        orgDetails?.logo ||
        orgDetails?.logo_path ||
        req.schoolDetails?.logo ||
        req.schoolDetails?.logo_path
      );
      const _schemaAliases = [..._nameVariants]
        .map((v) => String(v || "").trim())
        .filter(Boolean)
        .slice(0, 40);

      const structuredData = orgDetails
        ? {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": ["School", "EducationalOrganization"],
                "@id": `${canonicalUrl}#school`,
                name: orgDetails.organization_name,
                ...(orgDetails.nickname ? { alternateName: [
                  orgDetails.nickname,
                  ...(orgDetails.nickname_display ? [orgDetails.nickname_display] : []),
                  ...(_acronym ? [_acronym] : []),
                  `${orgDetails.nickname}.managira.com`,
                  ...(orgDetails.organization_name || "").split(/\s+/).filter(w => w.length > 3)
                ]} : {}),
                ...( _schemaAliases.length ? { keywords: _schemaAliases.join(", ") } : {}),
                url: canonicalUrl,
                ...( _logoAbs ? {
                  logo: {
                    "@type": "ImageObject",
                    url: _logoAbs
                  },
                  image: _logoAbs
                } : {}),
                ...(aboutusPlain ? { description: aboutusPlain } : {}),
                ...(orgDetails.motto ? { slogan: orgDetails.motto } : {}),
                ...(orgDetails.organization_address ? { address: {
                  "@type": "PostalAddress",
                  streetAddress: orgDetails.organization_address,
                  ...(orgDetails.organization_province ? { addressLocality: orgDetails.organization_province, addressRegion: orgDetails.organization_province } : {}),
                  ...(orgDetails.organization_country ? { addressCountry: orgDetails.organization_country } : {}),
                }} : {}),
                ...(orgDetails.geo_lat != null && orgDetails.geo_lng != null ? {
                  geo: {
                    "@type": "GeoCoordinates",
                    latitude: parseFloat(orgDetails.geo_lat),
                    longitude: parseFloat(orgDetails.geo_lng),
                  },
                  hasMap: `https://www.google.com/maps?q=${orgDetails.geo_lat},${orgDetails.geo_lng}`,
                } : {}),
                ...(orgDetails.organization_phone ? { telephone: orgDetails.organization_phone } : {}),
                ...(orgDetails.email ? { email: orgDetails.email } : {}),
                sameAs: [canonicalUrl]
              },
              {
                "@type": "WebSite",
                "@id": `${canonicalUrl}#website`,
                url: canonicalUrl,
                name: _schoolSiteName,
                ...( _publicAlias ? { alternateName: _publicAlias } : {}),
                inLanguage: "en",
                potentialAction: {
                  "@type": "SearchAction",
                  target: `${canonicalUrl}?q={search_term_string}`,
                  "query-input": "required name=search_term_string"
                }
              },
              {
                "@type": "WebPage",
                "@id": `${canonicalUrl}#webpage`,
                url: canonicalUrl,
                name: seoTitle,
                isPartOf: { "@id": `${canonicalUrl}#website` },
                about: { "@id": `${canonicalUrl}#school` },
                primaryImageOfPage: _logoAbs || undefined,
                description: seoDescription
              }
            ]
          }
        : null;

      const shouldBypassCache = Boolean(
        req.session?.userId || req.query?.organizationId || req.query?.themeApplied
      );
      if (shouldBypassCache) {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
      }

      res.render("common/publicDashboard", {
        layout: false,
        title: seoTitle,
        siteName: _schoolSiteName,
        description: seoDescription,
        keywords: seoKeywords,
        canonicalUrl,
        slideshowImages, // Pass slideshow images separately
        orderedItems,
        orgDetails,
        hubInfo: publicHubInfo,
        publicDashboardTheme,
        publicDashboardLayout,
        aboutDetails,
        searchIdentityTerms,
        url,
        isLoggedIn: req.session && req.session.userId,
        accountType: req.session.accountType || null, // ✅ Pass accountType explicitly
        messages: {
          ...flashMessages,
          error: publicErrorMessages,
        },
        structuredData,
        showFooterTopSection: false,
      });
    } catch (error) {
      console.error("[PublicDashboard] Failed to render public dashboard", {
        organizationId: req.query.organizationId || req.organizationId,
        message: error.message,
        stack: error.stack,
      });
      req.flash("error", "Failed to load School website data.");
      res.status(500).send("Failed to load school website data.");
    }
  },

  saveOrder: async (req, res, db) => {
    try {
      const organizationId =
        req.session?.organizationId || req.query?.organizationId || req.organizationId;

      if (!organizationId) {
        return res.status(400).json({ success: false, error: "Missing organizationId" });
      }

      const order = req.body?.order;
      if (!Array.isArray(order) || order.some((x) => typeof x !== "string")) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid order payload" });
      }

      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let theme = "classic";
      let layout = "wireframe1";
      let aboutDetails = {};
      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            if (typeof raw.theme === "string" && raw.theme.trim()) {
              theme = raw.theme.trim();
            }
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              layout = raw.layout.trim();
            }
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          }
        } catch (e) {
          theme = "classic";
          layout = "wireframe1";
          aboutDetails = {};
        }
      }

      const payload = { order, theme, layout, aboutDetails };

      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organizationId, payload]
      );

      return res.json({ success: true });
    } catch (error) {
            return res.status(500).json({ success: false });
    }
  },

  addStudentGet: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const isEmbedded = isEmbeddedRequest(req, "addStudent");

      // Fetch classes
      const classQuery = `
            SELECT c.class_id, c.class_name
            FROM classes c
            WHERE c.organization_id = $1
        ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC;
        `;
      const classResult = await db.query(classQuery, [organizationId]);

      // Fetch graduation year groups
      const graduationYearGroupQuery = `
            SELECT id, name
            FROM graduation_year_groups
            WHERE organization_id = $1
            ORDER BY name ASC;
        `;
      const graduationYearGroupResult = await db.query(
        graduationYearGroupQuery,
        [organizationId]
      );

      // Fetch subjects
      const subjectQuery = `
            SELECT s.subject_id, s.subject_name
            FROM subjects s
            WHERE s.organization_id = $1
            ORDER BY s.subject_name ASC;
        `;
      const subjectResult = await db.query(subjectQuery, [organizationId]);

      // Fetch school years and their terms
      const schoolYearResults = await db.query(
        `
            SELECT id AS school_year_id, year_label
            FROM school_years
            WHERE organization_id = $1
            ORDER BY created_at DESC
        `,
        [organizationId]
      );
      const schoolYears = schoolYearResults.rows;

      const termResults = await db.query(
        `
            SELECT term_id, school_year_id, term_name
            FROM terms
            WHERE organization_id = $1
            ORDER BY start_date
        `,
        [organizationId]
      );
      const terms = termResults.rows;

      schoolYears.forEach((year) => {
        year.terms = terms.filter(
          (term) => term.school_year_id === year.school_year_id
        );
      });

      // Fetch the current school year and term
      const currentTermResult = await db.query(
        `
            SELECT t.term_id, t.term_name, sy.year_label, sy.id AS school_year_id
            FROM terms t
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE t.current = true AND sy.organization_id = $1
            LIMIT 1
        `,
        [organizationId]
      );
      const currentTerm = currentTermResult.rows[0];

      // Fetch org student ID settings
      await ensureStudentIdSettingsSchema(db);
      const orgIdSettingsResult = await db.query(
        `SELECT use_custom_student_id, student_id_prefix, student_id_auto_generate, student_id_counter, student_id_start_number
         FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const studentIdSettings = orgIdSettingsResult.rows[0] || {};
      const nextAvailableStudentIdNumber = await getNextSuggestedStudentIdNumber(
        db,
        organizationId,
        studentIdSettings.student_id_counter || 0,
        [],
        null,
        studentIdSettings.student_id_start_number || null
      );

      res.render("common/addStudent", {
        title: "Add New Student",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        classes: classResult.rows,
        graduationYearGroups: graduationYearGroupResult.rows,
        subjects: subjectResult.rows,
        schoolYears,
        currentTerm,
        studentIdSettings,
        nextAvailableStudentIdNumber,
        messages: req.flash(),
        organizationId: req.session.organizationId,
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Error fetching data for add student");
    }
  },

  addStudentPost: async (req, res, db) => {
    const addStudentVerboseLogs = String(process.env.LOG_ADD_STUDENT_VERBOSE || '').trim().toLowerCase() === 'true';
    const organizationId = req.session.organizationId;
    const createdBy = req.session.userId || null;
    const body = req.body;
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const allowDuplicateSave = String(body.allowDuplicateSave || 'false') === 'true';

    // Fetch org student ID settings once before processing students
    await ensureStudentIdSettingsSchema(db);
    await ensureStudentEmailSchema(db);
    await ensureStudentAddressSchema(db);
    await ensureStudentDobUnknownSchema(db);
    const orgIdSettingsResult = await db.query(
      `SELECT use_custom_student_id, student_id_prefix, student_id_auto_generate, student_id_counter, student_id_start_number
       FROM organizations WHERE organization_id = $1`,
      [organizationId]
    );
    const idSettings = orgIdSettingsResult.rows[0] || {};

    const indexes = [];
    const studentFieldPattern = /^(?:firstName|lastName|dateOfBirth|dateOfBirthUnknown|gender|classId|graduationYearGroupId|hometown|studentAddress|studentEmail|height|enrollmentType|schoolYearId|termId)_+(\d+)$/;

    // Detect whether this is single or multiple students
    const isMultiple = Object.keys(body).some((key) => key.match(/_+\d+$/));

    if (isMultiple) {
      Object.keys(body).forEach((key) => {
        const match = key.match(studentFieldPattern);
        if (match && !indexes.includes(match[1])) indexes.push(match[1]);
      });
    } else {
      indexes.push("single");
    }

    if (addStudentVerboseLogs) {
      console.log('[AddStudent] Detected indexes for processing', {
        indexes,
        sampleKeys: Object.keys(body).slice(0, 40)
      });
    }

    const client = await db.connect();
    const uploadedFileByField = new Map((uploadedFiles || []).map((file) => [String(file.fieldname || ''), file]));
    const guardianCache = new Map();
    const enrollmentCache = new Map();
    let cachedCurrentTerm = null;
    let organizationNameCache = null;
    let currentIndexForLog = null;
    let currentPhaseForLog = 'begin';
    let studentsSavedCount = 0;
    let emptyFormsSkippedCount = 0;
    let guardiansCreatedCount = 0;
    let guardiansReusedCount = 0;
    let guardianLinksCreatedCount = 0;
    let lockedIdSettings = null;
    let allocatedStudentIdNumbers = new Set();
    let allocatedCustomIdsLower = new Set();
    let nextAutoStudentIdCandidate = 1;
    let maxAllocatedStudentIdCounter = Math.max(0, Number(idSettings.student_id_counter) || 0);
    const knownDuplicateKeys = new Set();
    const unknownDuplicateKeys = new Set();
    const seenBatchDuplicateKeys = new Set();
    let sharedGuardianTempHash = null;

    try {
      await client.query("BEGIN");

      if (!allowDuplicateSave) {
        const classIdsForDuplicateCheck = [...new Set(
          indexes
            .map((index) => {
              const prefix = index === "single" ? "" : `_${index}`;
              const rawClassId = index === 'single'
                ? body.classId
                : (body[`classId${prefix}`] !== undefined ? body[`classId${prefix}`] : body[`classId___${index}`]);
              const parsedClassId = Number(rawClassId);
              return Number.isInteger(parsedClassId) && parsedClassId > 0 ? parsedClassId : null;
            })
            .filter((value) => Number.isInteger(value) && value > 0)
        )];

        if (classIdsForDuplicateCheck.length) {
          const existingStudentsForDuplicateCheck = await client.query(
            `SELECT
               s.class_id,
               LOWER(TRIM(COALESCE(s.first_name, ''))) AS first_name_key,
               LOWER(TRIM(COALESCE(s.last_name, ''))) AS last_name_key,
               COALESCE(s.date_of_birth::text, '') AS date_of_birth_key,
               COALESCE(s.date_of_birth_unknown, FALSE) AS date_of_birth_unknown,
               LOWER(TRIM(COALESCE(s.gender, ''))) AS gender_key,
               LOWER(TRIM(COALESCE(s.hometown, ''))) AS hometown_key
             FROM students s
             WHERE s.organization_id = $1
               AND s.class_id = ANY($2::int[])`,
            [organizationId, classIdsForDuplicateCheck]
          );

          existingStudentsForDuplicateCheck.rows.forEach((row) => {
            const classKey = String(row.class_id || '');
            const firstNameKey = String(row.first_name_key || '');
            const lastNameKey = String(row.last_name_key || '');
            const genderKey = String(row.gender_key || '');
            const hometownKey = String(row.hometown_key || '');

            if (row.date_of_birth_unknown) {
              unknownDuplicateKeys.add([
                classKey,
                firstNameKey,
                lastNameKey,
                genderKey,
                hometownKey
              ].join('|'));
              return;
            }

            knownDuplicateKeys.add([
              classKey,
              firstNameKey,
              lastNameKey,
              String(row.date_of_birth_key || ''),
              genderKey,
              hometownKey
            ].join('|'));
          });
        }
      }

      if (idSettings.use_custom_student_id) {
        const lockedIdSettingsResult = await client.query(
          `SELECT student_id_counter, student_id_start_number
             FROM organizations
            WHERE organization_id = $1
            FOR UPDATE`,
          [organizationId]
        );
        lockedIdSettings = lockedIdSettingsResult.rows[0] || {};

        const occupiedNumbers = await getOccupiedStudentIdNumbers(client, organizationId);
        allocatedStudentIdNumbers = new Set(occupiedNumbers);

        const occupiedCustomIdsResult = await client.query(
          `SELECT LOWER(TRIM(custom_student_id)) AS custom_student_id
             FROM students
            WHERE organization_id = $1
              AND custom_student_id IS NOT NULL
              AND TRIM(custom_student_id) <> ''`,
          [organizationId]
        );
        allocatedCustomIdsLower = new Set(
          occupiedCustomIdsResult.rows
            .map((row) => String(row.custom_student_id || '').trim())
            .filter(Boolean)
        );

        nextAutoStudentIdCandidate = getStudentIdSearchStart(
          occupiedNumbers,
          lockedIdSettings.student_id_counter || idSettings.student_id_counter || 0,
          lockedIdSettings.student_id_start_number || idSettings.student_id_start_number || null
        );
      }

      for (const index of indexes) {
        currentIndexForLog = index;
        const prefix = index === "single" ? "" : `_${index}`;
        const getStudentField = (fieldName) => {
          if (index === 'single') {
            return body[fieldName];
          }
          if (body[`${fieldName}${prefix}`] !== undefined) {
            return body[`${fieldName}${prefix}`];
          }
          return body[`${fieldName}___${index}`];
        };

        const student = {
          firstName: getStudentField('firstName'),
          lastName: getStudentField('lastName'),
          dateOfBirth: getStudentField('dateOfBirth'),
          dateOfBirthUnknown: parseBooleanLike(getStudentField('dateOfBirthUnknown')),
          height: getStudentField('height'),
          hometown: getStudentField('hometown'),
          studentAddress: getStudentField('studentAddress'),
          homeLatitude: getStudentField('homeLatitude') || getStudentField('studentHomeLatitude') || getStudentField('transportHomeLatitude'),
          homeLongitude: getStudentField('homeLongitude') || getStudentField('studentHomeLongitude') || getStudentField('transportHomeLongitude'),
          studentEmail: normalizeOptionalEmail(getStudentField('studentEmail')),
          classId: getStudentField('classId'),
          graduationYearGroupId: getStudentField('graduationYearGroupId'),
          gender: getStudentField('gender'),
          enrollmentType: getStudentField('enrollmentType'),
          schoolYearId: getStudentField('schoolYearId'),
          termId: getStudentField('termId'),
          customStudentId: getStudentField('customStudentId'),
          customStudentIdMode: getStudentField('customStudentIdMode'),
          subjects: body[`subjects_${index}`] || [],
          guardians: [],
        };

        const isEmptyStudentForm = !student.firstName && !student.lastName && !student.dateOfBirth && !student.gender && !student.classId;
        if (isEmptyStudentForm) {
          emptyFormsSkippedCount += 1;
          if (addStudentVerboseLogs) {
            console.log('[AddStudent] Skipping empty student form', { index });
          }
          continue;
        }

        if (addStudentVerboseLogs) {
          console.log('[AddStudent] Parsed student payload', {
            index,
            firstName: student.firstName,
            lastName: student.lastName,
            dateOfBirth: student.dateOfBirth,
            gender: student.gender,
            classId: student.classId,
            graduationYearGroupId: student.graduationYearGroupId
          });
        }

        currentPhaseForLog = 'duplicateCheck';

        if (!allowDuplicateSave) {
          const duplicateClassKey = String(student.classId || '');
          const duplicateFirstNameKey = String(student.firstName || '').trim().toLowerCase();
          const duplicateLastNameKey = String(student.lastName || '').trim().toLowerCase();
          const duplicateGenderKey = String(student.gender || '').trim().toLowerCase();
          const duplicateHometownKey = String(student.hometown || '').trim().toLowerCase();

          const duplicateKey = student.dateOfBirthUnknown
            ? [
                duplicateClassKey,
                duplicateFirstNameKey,
                duplicateLastNameKey,
                duplicateGenderKey,
                duplicateHometownKey
              ].join('|')
            : [
                duplicateClassKey,
                duplicateFirstNameKey,
                duplicateLastNameKey,
                String(student.dateOfBirth || ''),
                duplicateGenderKey,
                duplicateHometownKey
              ].join('|');

          const existsInDb = student.dateOfBirthUnknown
            ? unknownDuplicateKeys.has(duplicateKey)
            : knownDuplicateKeys.has(duplicateKey);
          const existsInBatch = seenBatchDuplicateKeys.has(duplicateKey);

          if (existsInDb || existsInBatch) {
            throw new Error(
              `Duplicate student detected in class: ${student.firstName || ''} ${student.lastName || ''}. Please confirm duplicate save and try again.`
            );
          }

          seenBatchDuplicateKeys.add(duplicateKey);
        }

        // Collect guardians
        const guardianKeys = Object.keys(body).filter((k) =>
          k.startsWith(`guardianFirstName${prefix === "" ? "_" : prefix}_`)
        );
        for (const gk of guardianKeys) {
          const gIdx = gk.split("_")[2];
          student.guardians.push({
            profileId: body[`guardianProfileId${prefix}_${gIdx}`],
            firstName: body[`guardianFirstName${prefix}_${gIdx}`],
            lastName: body[`guardianLastName${prefix}_${gIdx}`],
            address: body[`guardianAddress${prefix}_${gIdx}`],
            phone: body[`guardianPhone${prefix}_${gIdx}`],
            email: body[`guardianEmail${prefix}_${gIdx}`],
            hometown: body[`guardianHometown${prefix}_${gIdx}`],
          });
        }

        // Insert student
        currentPhaseForLog = 'studentImage';
        const imageFile = uploadedFileByField.get(`studentImage${prefix}`);
        let imageUrl = "profilePlaceholder.png";
        if (imageFile) {
          const s3Key = `images/studentimages/${organizationId}/${imageFile.originalname}`;
          imageUrl = await uploadToS3(imageFile, s3Key);
        }

        // Use imageUrl as usual in your INSERT query:
        currentPhaseForLog = 'insertStudent';

        // Resolve custom student ID for this student
        let resolvedCustomId = null;
        if (idSettings.use_custom_student_id) {
          const prefix = idSettings.student_id_prefix || '';
          const rawManual = student.customStudentId ? String(student.customStudentId).trim() : '';
          const customIdMode = String(student.customStudentIdMode || '').trim().toLowerCase();
          // Strip prefix from manual input to avoid doubling (e.g. user types "MGI042" when prefix is "MGI")
          const manualOverride = rawManual
            ? (prefix && rawManual.toUpperCase().startsWith(prefix.toUpperCase())
                ? rawManual.slice(prefix.length)
                : rawManual)
            : '';
          const manualNumericRaw = manualOverride.replace(/\D/g, '');
          const manualNumericValue = manualNumericRaw ? parseInt(manualNumericRaw, 10) : null;
          const useAutoGeneratedId = idSettings.student_id_auto_generate && (
            customIdMode === 'auto' || (!customIdMode && !manualOverride)
          );

          if (useAutoGeneratedId) {
            while (allocatedStudentIdNumbers.has(nextAutoStudentIdCandidate)) {
              nextAutoStudentIdCandidate += 1;
            }

            const nextStudentIdNumber = nextAutoStudentIdCandidate;
            allocatedStudentIdNumbers.add(nextStudentIdNumber);
            nextAutoStudentIdCandidate = nextStudentIdNumber + 1;
            resolvedCustomId = prefix + String(nextStudentIdNumber).padStart(3, '0');
            allocatedCustomIdsLower.add(String(resolvedCustomId).trim().toLowerCase());
            maxAllocatedStudentIdCounter = Math.max(maxAllocatedStudentIdCounter, nextStudentIdNumber);
          } else if (manualOverride) {
            resolvedCustomId = prefix + manualOverride;
            const normalizedResolvedId = String(resolvedCustomId).trim().toLowerCase();
            const hasManualConflict =
              allocatedCustomIdsLower.has(normalizedResolvedId) ||
              (Number.isInteger(manualNumericValue) && manualNumericValue > 0 && allocatedStudentIdNumbers.has(manualNumericValue));

            if (hasManualConflict) {
              // Find next available ID starting from +1 and suggest it
              const numPart = manualNumericValue || 0;
              const padLen = manualNumericRaw.length || 3;
              let suggestion = null;
              for (let n = numPart + 1; n < numPart + 1000; n++) {
                const candidate = prefix + String(n).padStart(padLen, '0');
                const candidateLower = String(candidate).trim().toLowerCase();
                if (!allocatedCustomIdsLower.has(candidateLower) && !allocatedStudentIdNumbers.has(n)) {
                  suggestion = candidate;
                  break;
                }
              }
              throw new Error(
                `ID "${resolvedCustomId}" is already taken.${suggestion ? ` Next available: "${suggestion}".` : ''}`
              );
            }

            allocatedCustomIdsLower.add(normalizedResolvedId);
            if (Number.isInteger(manualNumericValue) && manualNumericValue > 0) {
              allocatedStudentIdNumbers.add(manualNumericValue);
              maxAllocatedStudentIdCounter = Math.max(maxAllocatedStudentIdCounter, manualNumericValue);
            }
          }
        }

        const studentInsert = await client.query(
          `INSERT INTO students 
          (first_name, last_name, date_of_birth, date_of_birth_unknown, height, hometown, address, email, class_id, image_url, graduation_year_group_id, gender, created_by, organization_id, custom_student_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          RETURNING student_id`,
          [
            student.firstName,
            student.lastName,
            student.dateOfBirthUnknown ? null : student.dateOfBirth,
            Boolean(student.dateOfBirthUnknown),
            student.height,
            student.hometown,
            student.studentAddress,
            student.studentEmail,
            student.classId,
            imageUrl,
            student.graduationYearGroupId || null,
            student.gender,
            createdBy,
            organizationId,
            resolvedCustomId,
          ]
        );

        if (!studentInsert.rows.length)
          throw new Error("Student insert failed.");
        const studentId = studentInsert.rows[0].student_id;
        studentsSavedCount += 1;

        await upsertStudentTransportationAssignment(client, {
          organizationId,
          studentId,
          homeAddress: student.studentAddress,
          homeLatitude: student.homeLatitude,
          homeLongitude: student.homeLongitude,
        });

        // Insert guardians (NEW MASTER + LINK) + ALSO keep existing guardians table insert (compat)
        for (let i = 0; i < student.guardians.length; i++) {
          currentPhaseForLog = `guardian_${i}_start`;
          const g = student.guardians[i];
          if (!g.firstName && !g.profileId) continue;

          const normalizedFirstName = (g.firstName || '').trim().toLowerCase();
          const normalizedLastName = (g.lastName || '').trim().toLowerCase();
          const normalizedEmail = (g.email || '').trim().toLowerCase() || null;
          const normalizedPhoneDigits = (g.phone || '').replace(/\D/g, '') || null;
          const normalizedHometown = (g.hometown || '').trim().toLowerCase();
          const guardianSignature = [
            normalizedFirstName,
            normalizedLastName,
            normalizedEmail || '',
            normalizedPhoneDigits || '',
            normalizedHometown
          ].join('|');

          // 1) Upload guardian photo if provided
          const guardianImageFile = uploadedFileByField.get(`guardianImage${prefix}_${i}`);

          let guardianImageUrl = null;
          if (guardianImageFile) {
            const s3Key = `images/guardianimages/${organizationId}/${Date.now()}_${guardianImageFile.originalname}`;
            guardianImageUrl = await uploadToS3(guardianImageFile, s3Key);
          }

          // 2) Upsert/Select guardian_profile
          let guardianId = null;
          let usedExistingGuardianProfile = false;

          if (g.profileId) {
            currentPhaseForLog = `guardian_${i}_updateExisting`;
            guardianId = parseInt(g.profileId, 10);
            usedExistingGuardianProfile = true;

            // Optional: update profile details + image if new image uploaded
            await client.query(
              `
              UPDATE guardian_profiles
              SET first_name = COALESCE(NULLIF($1,''), first_name),
                  last_name  = COALESCE(NULLIF($2,''), last_name),
                  phone      = COALESCE(NULLIF($3,''), phone),
                  email      = COALESCE(NULLIF($4,''), email),
                  address    = COALESCE(NULLIF($5,''), address),
                  hometown   = COALESCE(NULLIF($6,''), hometown),
                  image_url  = COALESCE($7, image_url),
                  updated_at = NOW()
              WHERE guardian_id = $8 AND organization_id = $9
              `,
              [
                g.firstName, g.lastName, g.phone, g.email, g.address, g.hometown,
                guardianImageUrl,
                guardianId, organizationId
              ]
            );
          } else {
            if (guardianCache.has(guardianSignature)) {
              currentPhaseForLog = `guardian_${i}_cacheLookup`;
              guardianId = guardianCache.get(guardianSignature);
              usedExistingGuardianProfile = true;
            }

            if (!guardianId && normalizedEmail) {
              currentPhaseForLog = `guardian_${i}_lookupByEmail`;
              const existingByEmail = await client.query(
                `SELECT guardian_id
                 FROM guardian_profiles
                 WHERE organization_id = $1
                   AND LOWER(TRIM(COALESCE(email, ''))) = $2
                 LIMIT 1`,
                [organizationId, normalizedEmail]
              );
              if (existingByEmail.rows.length) {
                guardianId = existingByEmail.rows[0].guardian_id;
                usedExistingGuardianProfile = true;
              }
            }

            if (!guardianId && normalizedPhoneDigits && normalizedFirstName && normalizedLastName) {
              currentPhaseForLog = `guardian_${i}_lookupByPhoneAndName`;
              const existingByPhoneAndName = await client.query(
                `SELECT guardian_id
                 FROM guardian_profiles
                 WHERE organization_id = $1
                   AND LOWER(TRIM(COALESCE(first_name, ''))) = $2
                   AND LOWER(TRIM(COALESCE(last_name, ''))) = $3
                   AND REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g') = $4
                 LIMIT 1`,
                [organizationId, normalizedFirstName, normalizedLastName, normalizedPhoneDigits]
              );
              if (existingByPhoneAndName.rows.length) {
                guardianId = existingByPhoneAndName.rows[0].guardian_id;
                usedExistingGuardianProfile = true;
              }
            }

            if (!guardianId && normalizedFirstName && normalizedLastName && normalizedHometown) {
              currentPhaseForLog = `guardian_${i}_lookupByNameAndHometown`;
              const existingByNameAndHometown = await client.query(
                `SELECT guardian_id
                 FROM guardian_profiles
                 WHERE organization_id = $1
                   AND LOWER(TRIM(COALESCE(first_name, ''))) = $2
                   AND LOWER(TRIM(COALESCE(last_name, ''))) = $3
                   AND LOWER(TRIM(COALESCE(hometown, ''))) = $4
                 LIMIT 1`,
                [organizationId, normalizedFirstName, normalizedLastName, normalizedHometown]
              );
              if (existingByNameAndHometown.rows.length) {
                guardianId = existingByNameAndHometown.rows[0].guardian_id;
                usedExistingGuardianProfile = true;
              }
            }

            if (guardianId) {
              guardiansReusedCount += 1;
              currentPhaseForLog = `guardian_${i}_updateMatched`;
              await client.query(
                `
                UPDATE guardian_profiles
                SET first_name = COALESCE(NULLIF($1,''), first_name),
                    last_name  = COALESCE(NULLIF($2,''), last_name),
                    phone      = COALESCE(NULLIF($3,''), phone),
                    email      = COALESCE(NULLIF($4,''), email),
                    address    = COALESCE(NULLIF($5,''), address),
                    hometown   = COALESCE(NULLIF($6,''), hometown),
                    image_url  = COALESCE($7, image_url),
                    updated_at = NOW()
                WHERE guardian_id = $8 AND organization_id = $9
                `,
                [
                  g.firstName, g.lastName, g.phone, normalizedEmail, g.address, g.hometown,
                  guardianImageUrl,
                  guardianId, organizationId
                ]
              );
            } else {
              currentPhaseForLog = `guardian_${i}_insertProfile`;
              const inserted = await client.query(
                `
                INSERT INTO guardian_profiles
                  (organization_id, first_name, last_name, phone, email, address, hometown, image_url)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                RETURNING guardian_id
                `,
                [
                  organizationId,
                  g.firstName,
                  g.lastName,
                  g.phone,
                  normalizedEmail,
                  g.address,
                  g.hometown,
                  guardianImageUrl
                ]
              );
              guardianId = inserted.rows[0].guardian_id;
              guardiansCreatedCount += 1;
            }
          }

          guardianCache.set(guardianSignature, guardianId);

          // 3) Link guardian -> student
          currentPhaseForLog = `guardian_${i}_linkStudent`;
          const linkResult = await client.query(
            `
            INSERT INTO guardian_students (guardian_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT (guardian_id, student_id) DO NOTHING
            RETURNING *
            `,
            [guardianId, studentId]
          );

          const isNewLink = linkResult.rowCount > 0;
          if (isNewLink) {
            guardianLinksCreatedCount += 1;
          }

          // 4) Ensure guardian login account exists when contact exists.
          // Password is set by guardian via invitation link (no manual password entry here).
          const loginEmail = (g.email || "").trim().toLowerCase() || null;
          const loginPhone = (g.phone || "").trim() || null;

          let isNewAccount = false;

          if (loginEmail || loginPhone) {
            // Seed temporary hash; guardian will set their own password via token link.
            if (!sharedGuardianTempHash) {
              sharedGuardianTempHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
            }
            const tempHash = sharedGuardianTempHash;

            // Prefer email matching; fallback to phone matching.
            // Avoid ON CONFLICT with expression targets that may not be backed by DB constraints.
            if (loginEmail) {
              currentPhaseForLog = `guardian_${i}_findAccountByEmail`;
              const existingByEmail = await client.query(
                `
                SELECT id
                FROM guardian_accounts
                WHERE organization_id = $1
                  AND LOWER(COALESCE(login_email, '')) = $2
                LIMIT 1
                `,
                [organizationId, loginEmail]
              );

              if (existingByEmail.rows.length > 0) {
                currentPhaseForLog = `guardian_${i}_updateAccountByEmail`;
                await client.query(
                  `
                  UPDATE guardian_accounts
                  SET guardian_id = $1,
                      login_phone = COALESCE($2, login_phone),
                      updated_at = NOW()
                  WHERE id = $3
                  `,
                  [guardianId, loginPhone, existingByEmail.rows[0].id]
                );
                isNewAccount = false;
              } else {
                currentPhaseForLog = `guardian_${i}_insertAccountByEmail`;
                await client.query(
                  `
                  INSERT INTO guardian_accounts
                    (organization_id, guardian_id, login_email, login_phone, password_hash, must_reset_password)
                  VALUES ($1,$2,$3,$4,$5,true)
                  `,
                  [organizationId, guardianId, loginEmail, loginPhone, tempHash]
                );
                isNewAccount = true;
              }
            } else {
              currentPhaseForLog = `guardian_${i}_findAccountByPhone`;
              const existingByPhone = await client.query(
                `
                SELECT id
                FROM guardian_accounts
                WHERE organization_id = $1
                  AND login_phone = $2
                LIMIT 1
                `,
                [organizationId, loginPhone]
              );

              if (existingByPhone.rows.length > 0) {
                currentPhaseForLog = `guardian_${i}_updateAccountByPhone`;
                await client.query(
                  `
                  UPDATE guardian_accounts
                  SET guardian_id = $1,
                      updated_at = NOW()
                  WHERE id = $2
                  `,
                  [guardianId, existingByPhone.rows[0].id]
                );
                isNewAccount = false;
              } else {
                currentPhaseForLog = `guardian_${i}_insertAccountByPhone`;
                await client.query(
                  `
                  INSERT INTO guardian_accounts
                    (organization_id, guardian_id, login_phone, password_hash, must_reset_password)
                  VALUES ($1,$2,$3,$4,true)
                  `,
                  [organizationId, guardianId, loginPhone, tempHash]
                );
                isNewAccount = true;
              }
            }
          }

          // 5) Send email notifications after transaction commits
          if (loginEmail) {
            // Get organization name once per request and reuse.
            if (!organizationNameCache) {
              const orgResult = await client.query(
                `SELECT organization_name FROM organizations WHERE organization_id = $1`,
                [organizationId]
              );
              organizationNameCache = orgResult.rows[0]?.organization_name || 'School';
            }
            const organizationName = organizationNameCache;
            const studentName = `${student.firstName} ${student.lastName}`;

            // Send welcome email only for new guardian profiles (first-time guardians)
            if (!usedExistingGuardianProfile && isNewAccount && loginEmail) {
              // New guardian - send welcome email with password setup
              setImmediate(() => {
                sendGuardianWelcomeEmail(
                  loginEmail,
                  g.firstName,
                  g.lastName,
                  studentName,
                  organizationName,
                  organizationId,
                  guardianId
                ).catch(err => {});
              });
            } else if (usedExistingGuardianProfile && isNewLink && loginEmail) {
              // Existing guardian - send student added notification
              setImmediate(() => {
                sendGuardianStudentAddedEmail(
                  loginEmail,
                  g.firstName,
                  g.lastName,
                  studentName,
                  organizationName,
                  organizationId
                ).catch(err => {});
              });
            }
          }

          // 6) KEEP your old guardians insert so existing pages don't break
          if (g.firstName) {
            currentPhaseForLog = `guardian_${i}_legacyInsert`;
            await client.query(
              `INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, image_url, student_id, organization_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                g.firstName,
                g.lastName,
                g.address,
                g.phone,
                (g.email || "").toLowerCase() || null,
                g.hometown,
                guardianImageUrl,
                studentId,
                organizationId,
              ]
            );
          }
        }

        // Insert subjects
        currentPhaseForLog = 'insertSubjects';
        const subjectsArray = Array.isArray(student.subjects)
          ? student.subjects
          : student.subjects
          ? [student.subjects]
          : [];

        const normalizedSubjectIds = subjectsArray
          .map((subjectId) => Number(subjectId))
          .filter((subjectId) => Number.isInteger(subjectId) && subjectId > 0);
        if (normalizedSubjectIds.length) {
          await client.query(
            `INSERT INTO student_subjects (student_id, subject_id, organization_id)
             SELECT $1, UNNEST($2::int[]), $3`,
            [studentId, normalizedSubjectIds, organizationId]
          );
        }

        // Determine enrollment term & year
        currentPhaseForLog = 'resolveEnrollment';
        let schoolYear = student.schoolYearId;
        let term = student.termId;

        if (student.enrollmentType === "current") {
          if (!cachedCurrentTerm) {
            const current = await client.query(
              `SELECT term_id, school_year_id FROM terms WHERE organization_id = $1 AND current = true LIMIT 1`,
              [organizationId]
            );
            if (!current.rows.length) throw new Error("No current term found.");
            cachedCurrentTerm = current.rows[0];
          }
          term = cachedCurrentTerm.term_id;
          schoolYear = cachedCurrentTerm.school_year_id;
        }

        if (!schoolYear || !term)
          throw new Error("Missing school year or term.");

        // Check/insert enrollment once per (schoolYear, term) and reuse in-request.
        const enrollmentCacheKey = `${schoolYear}:${term}`;
        let enrollmentId = enrollmentCache.get(enrollmentCacheKey);
        if (!enrollmentId) {
          const existing = await client.query(
            `SELECT enrollment_id FROM enrollments WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3`,
            [schoolYear, term, organizationId]
          );

          if (existing.rows.length) {
            enrollmentId = existing.rows[0].enrollment_id;
          } else {
            const insertEnrollment = await client.query(
              `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
               VALUES ($1, $2, $3, NOW())
               RETURNING enrollment_id`,
              [schoolYear, term, organizationId]
            );
            enrollmentId = insertEnrollment.rows[0].enrollment_id;
          }
          enrollmentCache.set(enrollmentCacheKey, enrollmentId);
        }

        // Enroll student
        currentPhaseForLog = 'insertEnrolledStudent';
        await client.query(
          `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
           VALUES ($1, $2, $3)`,
          [enrollmentId, studentId, student.classId]
        );
      }

      if (idSettings.use_custom_student_id) {
        const lockedCounter = Number(lockedIdSettings && lockedIdSettings.student_id_counter) || 0;
        if (maxAllocatedStudentIdCounter > lockedCounter) {
          await client.query(
            `UPDATE organizations
                SET student_id_counter = GREATEST(COALESCE(student_id_counter, 0), $1)
              WHERE organization_id = $2`,
            [maxAllocatedStudentIdCounter, organizationId]
          );
        }
      }

      currentPhaseForLog = 'commit';
      await client.query("COMMIT");
      if (addStudentVerboseLogs) {
        console.log('[AddStudent] Save completed', {
          studentsSaved: studentsSavedCount,
          guardiansCreated: guardiansCreatedCount,
          guardiansReused: guardiansReusedCount,
          guardianLinksCreated: guardianLinksCreatedCount
        });
      }
      const processedFormsCount = indexes.length;
      const saveSummaryMessage = `Saved ${studentsSavedCount} student(s) from ${processedFormsCount} submitted form(s).`;
      const skipSummaryMessage = emptyFormsSkippedCount > 0
        ? ` ${emptyFormsSkippedCount} empty form(s) were skipped.`
        : '';
      req.flash("success", `${saveSummaryMessage}${skipSummaryMessage}`);
      res.redirect("/common/addStudent");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error('[AddStudent] Save failed', {
        index: currentIndexForLog,
        phase: currentPhaseForLog,
        message: err.message,
        code: err.code,
        detail: err.detail,
        hint: err.hint,
        where: err.where,
        stack: err.stack
      });
      const safeErrorMessage = err && err.message ? String(err.message) : "Unknown error";
      req.flash("error", `Failed to save student(s): ${safeErrorMessage}`);
      res.redirect("/common/addStudent");
    } finally {
      client.release();
    }
  },

  checkStudentDuplicates: async (req, res, db) => {
    try {
      const organizationId = req.session?.organizationId || req.user?.organization_id;
      const students = Array.isArray(req.body?.students) ? req.body.students : [];

      if (!organizationId) {
        return res.status(400).json({ success: false, error: 'Missing organization context.' });
      }

      if (!students.length) {
        return res.json({ success: true, duplicates: [] });
      }

      const duplicates = [];

      for (const student of students) {
        const classId = student.classId;
        const firstName = (student.firstName || '').trim();
        const lastName = (student.lastName || '').trim();
        const dateOfBirth = (student.dateOfBirth || '').trim();
        const gender = (student.gender || '').trim();
        const hometown = (student.hometown || '').trim();

        if (!classId || !firstName || !lastName || !dateOfBirth) continue;

        const result = await db.query(
          `
          SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.gender, s.hometown, c.class_name
          FROM students s
          JOIN classes c ON c.class_id = s.class_id
          WHERE s.organization_id = $1
            AND s.class_id = $2
            AND LOWER(TRIM(s.first_name)) = LOWER(TRIM($3))
            AND LOWER(TRIM(s.last_name)) = LOWER(TRIM($4))
            AND s.date_of_birth = $5
            AND LOWER(TRIM(COALESCE(s.gender, ''))) = LOWER(TRIM(COALESCE($6, '')))
            AND LOWER(TRIM(COALESCE(s.hometown, ''))) = LOWER(TRIM(COALESCE($7, '')))
          LIMIT 1
          `,
          [organizationId, classId, firstName, lastName, dateOfBirth, gender, hometown]
        );

        if (result.rows.length > 0) {
          duplicates.push({
            input: { firstName, lastName, dateOfBirth, gender, hometown, classId },
            existing: result.rows[0],
          });
        }
      }

      return res.json({ success: true, duplicates });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to check duplicates.' });
    }
  },

  parseBulkStudents: async (req, res, db) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      const file = req.file;
      const fileExtension = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
      let students = [];

      // Import required libraries
      const ExcelJS = require('exceljs');
      const mammoth = require('mammoth');
      const pdfParse = require('pdf-parse');
      const Tesseract = require('tesseract.js');

      try {
        if (fileExtension === '.xlsx' || fileExtension === '.xls') {
          const readBuffer = file.buffer || (file.path ? await fs.promises.readFile(file.path) : null);
          if (!readBuffer) throw new Error('File data not accessible');

          const isSpreadsheetXmlXls =
            fileExtension === '.xls' &&
            String(readBuffer.slice(0, 300).toString('utf8')).toLowerCase().includes('<?xml');

          if (isSpreadsheetXmlXls) {
            const xmlText = readBuffer.toString('utf8');
            const worksheets = parseSpreadsheetXmlWorkbook(xmlText);
            const parsedStudents = [];

            for (const worksheetRows of worksheets) {
              const { headers, rows } = detectHeaderAndDataRows(worksheetRows);
              if (!headers.length || !rows.length) continue;
              parsedStudents.push(...parseRowsToStudents(headers, rows));
            }

            students = parsedStudents;
          } else {
            // Parse modern Excel workbook (.xlsx binary and compatible .xls variants)
            const workbook = new ExcelJS.Workbook();
            if (file.buffer) {
              await workbook.xlsx.load(file.buffer);
            } else if (file.path) {
              await workbook.xlsx.readFile(file.path);
            } else {
              throw new Error('File data not accessible');
            }

            const parsedStudents = [];
            workbook.worksheets.forEach((worksheet) => {
              const rowsAsArrays = [];
              worksheet.eachRow({ includeEmpty: false }, (row) => {
                rowsAsArrays.push(row.values.slice(1));
              });

              const { headers, rows } = detectHeaderAndDataRows(rowsAsArrays);
              if (!headers.length || !rows.length) return;
              parsedStudents.push(...parseRowsToStudents(headers, rows));
            });

            students = parsedStudents;
          }

        } else if (fileExtension === '.csv') {
          // Parse CSV file
          let fileContent;
          if (file.buffer) fileContent = file.buffer.toString('utf-8');
          else if (file.path) fileContent = await fs.promises.readFile(file.path, 'utf-8');
          else throw new Error('File data not accessible');

          const lines = fileContent.split(/\r?\n/).filter((line) => line.trim());
          if (lines.length < 2) throw new Error('CSV file is empty or invalid');

          const matrixRows = lines.map((line) => parseCSVLine(line));
          const { headers, rows } = detectHeaderAndDataRows(matrixRows);
          if (!headers.length || !rows.length) {
            throw new Error('Could not detect valid student headers in CSV file');
          }

          students = parseRowsToStudents(headers, rows);

        } else if (fileExtension === '.doc' || fileExtension === '.docx') {
          // Parse Word document
          let result;
          if (file.buffer) result = await mammoth.extractRawText({ buffer: file.buffer });
          else if (file.path) result = await mammoth.extractRawText({ path: file.path });
          else throw new Error('File data not accessible');

          const text = result.value;
          students = parseTextToStudents(text);

        } else if (fileExtension === '.pdf') {
          // Parse PDF text with pdf-parse
          const buffer = file.buffer || (file.path ? await fs.promises.readFile(file.path) : null);
          if (!buffer) throw new Error('File data not accessible');
          const parsed = await pdfParse(buffer);
          students = parseTextToStudents(parsed.text || '');

        } else if (['.jpg', '.jpeg', '.png'].includes(fileExtension)) {
          // OCR for images using Tesseract.js
          const imageInput = file.buffer || file.path;
          if (!imageInput) throw new Error('File data not accessible');
          const ocrResult = await Tesseract.recognize(imageInput, 'eng');
          students = parseTextToStudents(ocrResult?.data?.text || '');
        } else {
          return res.json({
            success: false,
            error: 'Unsupported file format. Please use Excel, CSV, PDF, Word, or image files.'
          });
        }

        // Clean up uploaded file if it was saved to disk
        if (file.path) {
          try {
            await fs.promises.unlink(file.path);
          } catch (e) {
            // Ignore cleanup errors
          }
        }

        if (students.length === 0) {
          return res.json({
            success: false,
            error: 'No valid student data found in the file. Please check the format.'
          });
        }

        // Validate classes and subjects against database
        const warnings = {
          missingClasses: [],
          missingSubjects: []
        };

        // Get organization ID from session or user object
        const organizationId = req.session?.organizationId || req.user?.organization_id;

        // Import sheets almost never include a "+" country code — assume
        // any guardian phone missing one is local to the school's own
        // country and prefix that country's dial code.
        if (organizationId) {
          try {
            const orgCountryResult = await db.query(
              'SELECT organization_country FROM organizations WHERE organization_id = $1 LIMIT 1',
              [organizationId]
            );
            const orgCountryCode = String(orgCountryResult.rows[0]?.organization_country || '').trim().toUpperCase();
            const { DIAL_CODES } = require('../utils/dialCodes');
            const defaultDial = (DIAL_CODES.find((c) => c.iso2 === orgCountryCode) || {}).dial;
            if (defaultDial) {
              students = students.map((s) => (
                s && s.phone ? { ...s, phone: applyDefaultDialCode(s.phone, defaultDial) } : s
              ));
            }
          } catch (_) {
            // Non-fatal — imported numbers just keep whatever shape the sheet had.
          }
        }

        // Only perform database validation if organization ID is available
        if (organizationId) {
          // Get all unique classes from parsed data
          const uniqueClasses = [...new Set(students.map(s => (s.class || '').trim()).filter(c => c))];
          
          // Get all unique subjects from parsed data
          const allSubjects = students
            .map(s => s.subjects ? s.subjects.split(',').map(sub => sub.trim()) : [])
            .flat()
            .filter(s => s);
          const uniqueSubjects = [...new Set(allSubjects.map((s) => s.trim()).filter(Boolean))];

          // Check if classes exist in database
          if (uniqueClasses.length > 0) {
            const classCheckQuery = `
              SELECT class_name FROM classes 
              WHERE organization_id = $1 AND LOWER(TRIM(class_name)) = ANY($2::text[])
            `;
            const classResult = await db.query(classCheckQuery, [organizationId, uniqueClasses.map((c) => c.toLowerCase())]);
            const existingClasses = classResult.rows.map(r => (r.class_name || '').toLowerCase().trim());
            
            warnings.missingClasses = uniqueClasses.filter(c => !existingClasses.includes(c.toLowerCase()));
          }

          // Check if subjects exist in database
          if (uniqueSubjects.length > 0) {
            const subjectCheckQuery = `
              SELECT subject_name FROM subjects 
              WHERE organization_id = $1 AND LOWER(TRIM(subject_name)) = ANY($2::text[])
            `;
            const subjectResult = await db.query(subjectCheckQuery, [organizationId, uniqueSubjects.map((s) => s.toLowerCase())]);
            const existingSubjects = subjectResult.rows.map(r => (r.subject_name || '').toLowerCase().trim());
            
            warnings.missingSubjects = uniqueSubjects.filter(s => !existingSubjects.includes(s.toLowerCase()));
          }

          // Check for existing guardians by email or phone
          for (let student of students) {
            if (student.guardian && (student.guardian.email || student.guardian.phone)) {
              let guardianQuery = '';
              let params = [organizationId];
              
              if (student.guardian.email && student.guardian.phone) {
                guardianQuery = `
                  SELECT guardian_id, first_name, last_name, phone, email, address, hometown
                  FROM guardian_profiles 
                  WHERE organization_id = $1 AND (LOWER(email) = LOWER($2) OR phone = $3)
                  LIMIT 1
                `;
                params.push(student.guardian.email, student.guardian.phone);
              } else if (student.guardian.email) {
                guardianQuery = `
                  SELECT guardian_id, first_name, last_name, phone, email, address, hometown
                  FROM guardian_profiles 
                  WHERE organization_id = $1 AND LOWER(email) = LOWER($2)
                  LIMIT 1
                `;
                params.push(student.guardian.email);
              } else if (student.guardian.phone) {
                guardianQuery = `
                  SELECT guardian_id, first_name, last_name, phone, email, address, hometown
                  FROM guardian_profiles 
                  WHERE organization_id = $1 AND phone = $2
                  LIMIT 1
                `;
                params.push(student.guardian.phone);
              }

              if (guardianQuery) {
                const guardianResult = await db.query(guardianQuery, params);
                if (guardianResult.rows.length > 0) {
                  student.guardian.existing = true;
                  student.guardian.guardianId = guardianResult.rows[0].guardian_id;
                  student.guardian.matchedData = guardianResult.rows[0];
                } else {
                  student.guardian.existing = false;
                }
              }
            }
          }
        }

        return res.json({
          success: true,
          students: students,
          warnings: warnings,
          message: `Successfully parsed ${students.length} student(s)`
        });

      } catch (parseError) {
        console.error('Parse error:', parseError);
        // Clean up file on error
        if (file.path) {
          try {
            await fs.promises.unlink(file.path);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        return res.json({
          success: false,
          error: `Failed to parse file: ${parseError.message}`
        });
      }

    } catch (error) {
      console.error('Bulk import error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error processing file'
      });
    }
  },

  publicRegisterStudentGet: async (req, res, db) => {
    try {
      // ✅ Use organizationId from query, or fallback to schoolDetails for production
      const organizationId =
        req.query.organizationId ||
        (req.schoolDetails && req.schoolDetails.organization_id);

      if (!organizationId) {
        req.flash("error", "Missing organization ID.");
        return res.redirect("/common/publicDashboard");
      }

      const orgResult = await db.query(
        `SELECT organization_id, organization_name, registration_description,
              public_registration_enabled, registration_start_date,
              registration_end_date, public_registration_price,
              public_registration_currency, logo, aboutus, motto,
              theme_color, font_style
        FROM organizations
        WHERE organization_id = $1`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");
        return res.redirect("/common/publicDashboard");
      }

      const orgDetails = orgResult.rows[0];

      const classResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [organizationId]
      );

      const graduationYearGroupResult = await db.query(
        `SELECT id, name FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name ASC`,
        [organizationId]
      );

      const subjectResult = await db.query(
        `SELECT subject_id, subject_name FROM subjects WHERE organization_id = $1 ORDER BY subject_name ASC`,
        [organizationId]
      );

      const schoolYearResults = await db.query(
        `SELECT id AS school_year_id, year_label FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId]
      );
      const schoolYears = schoolYearResults.rows;

      const termResults = await db.query(
        `SELECT term_id, school_year_id, term_name, current FROM terms WHERE organization_id = $1 ORDER BY start_date`,
        [organizationId]
      );
      const terms = termResults.rows;

      schoolYears.forEach((year) => {
        year.terms = terms.filter(
          (term) => term.school_year_id === year.school_year_id
        );
      });

      const currentTerm = terms.find((term) => term.current) || null;

      const paystackSubaccountsResult = await db.query(
        `SELECT id, business_name, account_number, account_type, bank_code, bank_name, momo_number, momo_provider, account_holder_name, subaccount_code, is_primary FROM paystack_subaccounts WHERE organization_id = $1 AND account_type != 'stripe_card' ORDER BY is_primary DESC, id ASC`,
        [organizationId]
      );
      const paystackSubaccounts = paystackSubaccountsResult.rows;
      await ensurePaymentProviderSchema(db);

      // Determine fallback debit card when no real bank payout accounts exist
      const bankPayoutAccounts = paystackSubaccounts.filter(
        (a) => a.account_type !== 'stripe_card' && a.subaccount_code
      );
      let fallbackCard = null;
      if (bankPayoutAccounts.length === 0) {
        try {
          const storedCardMetaResult = await db.query(
            `SELECT authorization_code, display_name, is_primary
               FROM stored_cards
              WHERE organization_id = $1
                AND is_active = true
              ORDER BY is_primary DESC, updated_at DESC, created_at DESC`,
            [organizationId]
          );
          const storedCardMetaById = new Map(
            storedCardMetaResult.rows.map((row) => [row.authorization_code, row])
          );

          const orgBillingRow = await db.query(
            `SELECT billing_provider, stripe_customer_id FROM organizations WHERE organization_id = $1`,
            [organizationId]
          );
          const orgBilling = orgBillingRow.rows[0];
          if (orgBilling?.billing_provider === 'stripe' && orgBilling?.stripe_customer_id) {
            const stripe = await getStripeClient(db);
            const pmResult = await stripe.paymentMethods.list({
              customer: orgBilling.stripe_customer_id,
              type: 'card',
            });
            const debitCards = (pmResult.data || [])
              .filter((m) => m.card?.funding === 'debit' || m.card?.funding === 'prepaid')
              .map((m) => {
                const storedMeta = storedCardMetaById.get(m.id);
                return {
                  id: m.id,
                  brand: m.card?.brand,
                  last4: m.card?.last4,
                  expMonth: m.card?.exp_month,
                  expYear: m.card?.exp_year,
                  displayName: storedMeta?.display_name || null,
                  isPrimary: Boolean(storedMeta?.is_primary),
                };
              })
              .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
            const best = debitCards[0];
            if (best) {
              fallbackCard = best;
            }
          } else {
            // Paystack billing — use stored_cards (Verve = always debit in Ghana)
            const storedResult = await db.query(
              `SELECT card_type, last4, exp_month, exp_year, display_name FROM stored_cards
               WHERE organization_id = $1 AND is_active = true
               ORDER BY is_primary DESC, created_at DESC LIMIT 1`,
              [organizationId]
            );
            if (storedResult.rows.length) {
              const c = storedResult.rows[0];
              fallbackCard = {
                brand: c.card_type,
                last4: c.last4,
                expMonth: c.exp_month,
                expYear: c.exp_year,
                displayName: c.display_name || null,
              };
            }
          }
        } catch (_) {
          // fallback is optional — silent fail
        }
      }
      const paystackConfig = await getActivePaystackConfig(db);
      const stripeSettings = await getStripeSettings(db).catch(() => ({ mode: 'test' }));
      const stripePublishableKey = await getActiveStripePublicKey(db).catch(() => '');
      await ensureStripeConnectAccountSchema(db);
      const stripeConnectRow = await db.query(
        `SELECT stripe_connect_account_id, stripe_connect_account_id_test, stripe_connect_account_id_live FROM organizations WHERE organization_id = $1`,
        [organizationId]
      ).catch(() => ({ rows: [] }));
      const stripeConnectAccountId = getStripeConnectAccountId(stripeConnectRow.rows[0] || {}, stripeSettings.mode) || null;
      // Unified payout readiness — Stripe Connect OR Paystack subaccount counts.
      const { resolveSchoolPayoutDestination } = require("../utils/payoutDestination");
      const payoutContext = await resolveSchoolPayoutDestination(organizationId, db).catch(() => null);
      let hasPayoutAccount = false;
      let stripePayoutReady = false;
      let paystackPayoutReady = Boolean(payoutContext?.paystack?.available);
      let payoutProvider = payoutContext?.provider || null;
      if (stripeConnectAccountId) {
        try {
          const stripePlatform = await getStripePlatformClient(db);
          const connectAccount = await stripePlatform.accounts.retrieve(stripeConnectAccountId);
          stripePayoutReady = Boolean(connectAccount?.charges_enabled);
        } catch (_) {
          stripePayoutReady = false;
        }
      }
      const stripeSelectable = Boolean(
        stripePublishableKey && (
          stripePayoutReady ||
          Boolean(payoutContext?.stripe?.available) ||
          Boolean(stripeConnectAccountId)
        )
      );
      hasPayoutAccount = Boolean(stripeSelectable || paystackPayoutReady);

      // Restrict the payer's selectable route to the school's chosen payout provider.
      let _prSelectablePaystack = paystackSubaccounts;
      let _prStripeSelectable = stripeSelectable;
      if (payoutProvider === 'stripe') {
        _prSelectablePaystack = [];
      } else if (payoutProvider === 'paystack') {
        _prStripeSelectable = false;
      }

      // Platform service fee preview (shown immediately on the payment step).
      const { percentage: platformFeePercentage } = await getPlatformFeeSettings(db).catch(() => ({ percentage: 0 }));
      const platformFeeBearer = await getOrgPlatformFeeBearer(organizationId, db).catch(() => 'parent');

      res.render("common/publicRegisterStudent", {
        title: "Public Student Registration",
        classes: classResult.rows,
        graduationYearGroups: graduationYearGroupResult.rows,
        subjects: subjectResult.rows,
        schoolYears,
        currentTerm,
        organizationId,
        orgDetails,
        paystackSubaccounts: _prSelectablePaystack,
        fallbackCard,
        publishableKey: paystackConfig.publicKey,
        stripePublishableKey,
        hasPayoutAccount,
        stripePayoutReady,
        stripeSelectable: _prStripeSelectable,
        paystackPayoutReady,
        payoutProvider,
        stripeConnectAccountId,
        platformFeePercentage,
        platformFeeBearer,
        messages: req.flash(),
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to load registration page.");
      res.redirect("/common/publicDashboard");
    }
  },

  publicRegisterStudentPost: async (req, res, db) => {
    const { body } = req;
    const files = req.files;
    const organizationId =
      req.query.organizationId ||
      (req.schoolDetails && req.schoolDetails.organization_id);

    try {
      await ensureStudentEmailSchema(db);
      if (
        !body.firstName ||
        !body.lastName ||
        !body.dateOfBirth ||
        !body.gender ||
        !body.classId
      ) {
        return res
          .status(400)
          .json({ success: false, error: "Missing required fields." });
      }
      const orgResult = await db.query(
        `SELECT public_registration_price, public_registration_currency FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "Organization not found." });
      }

      const {
        public_registration_price: amount,
        public_registration_currency: currency,
      } = orgResult.rows[0];

      // Upload student image to S3 if provided
      let imageUrl = "profilePlaceholder.png";
      if (files && files.studentImage && files.studentImage[0]) {
        const file = files.studentImage[0];
        const s3Key = `images/studentimages/${organizationId}/${file.originalname}`;
        imageUrl = await uploadToS3(file, s3Key);
      }

      // Handle guardian image upload if new guardian
      let guardianImageUrl = null;
      if (files && files.guardianImage0 && files.guardianImage0[0]) {
        const guardianFile = files.guardianImage0[0];
        const s3Key = `images/guardians/${organizationId}/${guardianFile.originalname}`;
        guardianImageUrl = await uploadToS3(guardianFile, s3Key);
      }

      // Insert pending student record right away
      const isFreeRegistration = !(parseFloat(amount) > 0);
      const insertResult = await db.query(
        `INSERT INTO pending_students 
        (first_name, last_name, date_of_birth, gender, hometown, email, class_id, image_url, enrollment_type, school_year_id, term_id, graduation_year_group_id, organization_id, stripe_payment_verified, payment_pending, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        RETURNING pending_id`,
        [
          body.firstName,
          body.lastName,
          body.dateOfBirth,
          body.gender,
          body.hometown,
          normalizeOptionalEmail(body.studentEmail),
          body.classId,
          imageUrl,
          body.enrollmentType,
          body.schoolYearId,
          body.termId,
          body.graduationYearGroupId,
          organizationId,
          isFreeRegistration,   // stripe_payment_verified: true when no payment needed
          !isFreeRegistration,  // payment_pending: false when no payment needed
        ]
      );

      const pendingStudentId = insertResult.rows[0].pending_id;

      // Check if using existing guardian or creating new
      if (body.existingGuardianId) {
        // Fetch existing guardian's info and create a record in pending_guardians
        const existingGuardian = await db.query(
          `SELECT first_name, last_name, phone, email, hometown, image_url
           FROM guardian_profiles
           WHERE guardian_id = $1 AND organization_id = $2`,
          [body.existingGuardianId, organizationId]
        );

        if (existingGuardian.rows.length > 0) {
          const g = existingGuardian.rows[0];
          await db.query(
            `INSERT INTO pending_guardians (pending_id, first_name, last_name, phone, email, hometown)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              pendingStudentId,
              g.first_name,
              g.last_name,
              g.phone,
              g.email,
              g.hometown,
            ]
          );
        }
      } else {
        // Save new guardian with image
        const guardians = extractGuardians(body);
        for (const guardian of guardians) {
          await db.query(
            `INSERT INTO pending_guardians (pending_id, first_name, last_name, phone, email, hometown)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              pendingStudentId,
              guardian.firstName,
              guardian.lastName,
              guardian.phone,
              guardian.email,
              guardian.hometown,
            ]
          );
        }
      }

      // Save subjects
      const subjects = Array.isArray(body.subjects)
        ? body.subjects
        : [body.subjects];
      for (const subjectId of subjects) {
        if (subjectId) {
          await db.query(
            `INSERT INTO pending_student_subjects (pending_student_id, subject_id, organization_id) VALUES ($1, $2, $3)`,
            [pendingStudentId, subjectId, organizationId]
          );
        }
      }

      // Save pending student ID in session
      req.session.pendingStudentId = pendingStudentId;
      req.session.publicRegistrationExistingGuardianId = body.existingGuardianId || null;

      // Send admission received confirmation to guardian
      const guardianEmail = body.guardianEmail0 || body.existingGuardianEmail || null;
      const guardianFirstName = body.guardianFirstName0 || "Parent/Guardian";
      if (guardianEmail) {
        notifyGuardianAdmissionReceived(db, {
          organizationId,
          guardianEmail,
          guardianFirstName,
          studentName: `${body.firstName} ${body.lastName}`,
        }).catch(err => console.error("[Notify] Admission confirmation failed:", err.message));
      }

      // F1 — notify all APPROVE_ADMISSIONS staff about new pending admission
      notifSvc.notifyByPermission(db, {
        orgId: Number(organizationId),
        permission: 'APPROVE_ADMISSIONS',
        type: 'admission_pending',
        title: 'New admission pending',
        body: `${body.firstName} ${body.lastName} submitted an application`,
        link: '/common/admissionPending',
      }).catch(err => console.error('[Notif] admission_pending failed:', err.message));

      // Send response for payment initiation
      const skipPayment = isFreeRegistration;
      const payload = { success: true, amount, currency, pendingStudentId, skipPayment };
      return req.session.save
        ? req.session.save(() => res.json(payload))
        : res.json(payload);
    } catch (err) {
      res
        .status(500)
        .json({ success: false, error: "Failed to save pending student." });
    }
  },

  // ─── Inline Stripe Payment Element (Stripe Connect destination charge) ────────
  // Creates a PaymentIntent with transfer_data so money flows:
  //   Parent → Managira platform → School connected account
  // Platform fee is pulled from app_settings (set in admin service pricing).
  createPaymentIntent: async (req, res, db) => {
    const { amount, payoutAccountId } = req.body;
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    const configuredProdBaseUrl =
      process.env.BASE_URL_PRODUCTION ||
      process.env.BASE_URL_PRODUCTION_FALLBACK ||
      "https://managira.com";
    const BASE_URL = requestOrigin ||
      (process.env.NODE_ENV === "production"
        ? configuredProdBaseUrl
        : process.env.BASE_URL_LOCAL || "http://localhost:4000");
    const pendingStudentId = req.session.pendingStudentId;

    if (!pendingStudentId) {
      return res.status(400).json({ success: false, error: 'Missing pending registration session. Please fill the form again.' });
    }

    try {
      await ensurePublicRegistrationSchema(db);

      // 1. Get pending student
      const studentResult = await db.query(
        `SELECT organization_id, first_name, last_name FROM pending_students WHERE pending_id = $1`,
        [pendingStudentId]
      );
      if (!studentResult.rows.length) {
        return res.status(400).json({ success: false, error: 'Pending student not found.' });
      }
      const { organization_id: organizationId, first_name, last_name } = studentResult.rows[0];

      // 2. Get org details including Stripe connected account
      await ensureStripeConnectAccountSchema(db);
      const orgResult = await db.query(
        `SELECT public_registration_currency, organization_name, stripe_connect_account_id, stripe_connect_account_id_test, stripe_connect_account_id_live
           FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const orgRow = orgResult.rows[0];
      const currency = normalizeCurrencyCode(orgRow?.public_registration_currency) || 'USD';
      const organizationName = orgRow?.organization_name || 'School';
      const payoutContext = await resolveSchoolPayoutDestination(organizationId, db, { fresh: true }).catch(() => null);
      const selectedIsStripe = String(payoutAccountId || '').toLowerCase() === 'stripe';
      const selectedIsPaystack = Boolean(payoutAccountId && !selectedIsStripe);
      const preferredProvider = String(payoutContext?.preference || '').trim().toLowerCase();

      if (preferredProvider === 'stripe' && selectedIsPaystack) {
        return res.status(400).json({
          success: false,
          error: 'This school currently has Stripe as the active payout provider.',
          code: 'PAYOUT_PROVIDER_LOCKED',
        });
      }
      if (preferredProvider === 'paystack' && selectedIsStripe) {
        return res.status(400).json({
          success: false,
          error: 'This school currently has Paystack as the active payout provider.',
          code: 'PAYOUT_PROVIDER_LOCKED',
        });
      }

      let payoutProvider = payoutContext?.provider || null;
      if (preferredProvider === 'stripe' || preferredProvider === 'paystack') {
        payoutProvider = preferredProvider;
      } else {
        if (selectedIsStripe) payoutProvider = 'stripe';
        if (selectedIsPaystack) payoutProvider = 'paystack';
      }

      let platformStripe = null;
      let stripe = null;
      let stripeConnectAccountId = null;

      // BLOCK payment if the school has no ready payout account at all.
      if (!payoutContext?.ready) {
        return res.status(400).json({
          success: false,
          error: 'Online payment is not available for this school yet. The school has not set up their payout account. Please contact the school directly.',
          code: 'NO_PAYOUT_ACCOUNT',
        });
      }

      // 3. Get guardian email
      const guardianResult = await db.query(
        `SELECT email, first_name FROM pending_guardians WHERE pending_id = $1 LIMIT 1`,
        [pendingStudentId]
      );
      const primaryGuardian = guardianResult.rows[0] || null;
      const guardianEmail = primaryGuardian?.email || null;

      // 4. Convert amount to Stripe charge currency
      const requestedAmount = roundCurrencyAmount(parseFloat(amount));
      if (!(requestedAmount > 0)) {
        return res.status(400).json({ success: false, error: 'Invalid registration amount.' });
      }
      const paymentReference = `PR-${organizationId}-${pendingStudentId}-${Date.now()}`;

      if (payoutProvider === 'stripe') {
        platformStripe = await getStripePlatformCredentials(db);
        if (platformStripe.issue) {
          return res.status(500).json({
            success: false,
            error: `${platformStripe.issue} Update Stripe mode or keys in Admin Service Pricing.`,
            code: 'STRIPE_PLATFORM_NOT_CONFIGURED',
          });
        }
        // Use the platform client (full sk_ key) that matches the active admin mode.
        stripe = await getStripePlatformClient(db);
        stripeConnectAccountId = getStripeConnectAccountId(orgRow || {}, platformStripe.mode) || null;
      }

      const { percentage: platformFeePercentage } = await getPlatformFeeSettings(db).catch(() => ({ percentage: 0 }));
      const platformFeeBearer = await getOrgPlatformFeeBearer(organizationId, db).catch(() => 'parent');
      const chargeBreakdown = buildPlatformChargeBreakdown(requestedAmount, {
        platformFeePercentage,
        bearer: platformFeeBearer,
      });

      if (payoutProvider === 'paystack') {
        // Resolve which specific payout account to use
        let subaccountCodeToUse = payoutContext?.paystack?.subaccountCode || null;
        let selectedPaystackAccountType = payoutContext?.paystack?.accountType || null;
        if (payoutAccountId && payoutAccountId !== 'stripe') {
          const acctRow = await db.query(
            `SELECT subaccount_code, account_type FROM paystack_subaccounts WHERE id=$1 AND organization_id=$2`,
            [parseInt(payoutAccountId, 10), organizationId]
          );
          if (acctRow.rows.length) {
            if (acctRow.rows[0].subaccount_code) {
              subaccountCodeToUse = acctRow.rows[0].subaccount_code;
            }
            selectedPaystackAccountType = acctRow.rows[0].account_type || selectedPaystackAccountType;
          }
        }

        const paystackChannels =
          selectedPaystackAccountType === 'mobile_money'
            ? ['mobile_money']
            : (selectedPaystackAccountType === 'bank' ? ['bank_transfer'] : undefined);

        const paystackConfig = await getActivePaystackConfig(db);
        if (!paystackConfig.secretKey) {
          return res.status(500).json({
            success: false,
            error: 'Paystack is not configured for this school yet.',
            code: 'PAYSTACK_NOT_CONFIGURED',
          });
        }

        if (!subaccountCodeToUse) {
          return res.status(400).json({
            success: false,
            error: 'This school has not saved a valid Paystack payout account yet.',
            code: 'NO_PAYOUT_ACCOUNT',
          });
        }

        if (!guardianEmail) {
          return res.status(400).json({
            success: false,
            error: 'A guardian email is required for Paystack checkout.',
            code: 'GUARDIAN_EMAIL_REQUIRED',
          });
        }

        const paystackReference = paymentReference;
        const paystackAmount = Math.round(chargeBreakdown.totalChargedAmount * 100);
        const useSubaccount = Boolean(subaccountCodeToUse && subaccountCodeToUse.startsWith('ACCT_'));
        const platformFeeMinor = Math.round(chargeBreakdown.platformFeeAmount * 100);
        const paystackCallbackUrl = `${BASE_URL}/common/paymentCallback?reference=${encodeURIComponent(paystackReference)}&pendingStudentId=${encodeURIComponent(pendingStudentId)}&organizationId=${encodeURIComponent(organizationId)}`;
        const paystackMetadata = {
          flow: 'public_registration_inline',
          pending_student_id: String(pendingStudentId),
          organization_id: String(organizationId),
          student_name: `${first_name} ${last_name}`,
          guardian_name: primaryGuardian?.first_name || 'Guardian',
          existing_guardian_id: req.session.publicRegistrationExistingGuardianId
            ? String(req.session.publicRegistrationExistingGuardianId) : '',
          registration_amount: requestedAmount.toFixed(2),
          registration_currency: currency,
          payout_provider: 'paystack',
          payout_subaccount_code: subaccountCodeToUse || '',
          payout_account_id: payoutAccountId ? String(payoutAccountId) : '',
          paystack_reference: paystackReference,
          platform_fee_bearer: platformFeeBearer,
          platform_fee_amount: String(chargeBreakdown.platformFeeAmount),
          platform_fee_percentage: String(chargeBreakdown.platformFeePercentage),
        };

        const paystackResponse = await axios.post(
          'https://api.paystack.co/transaction/initialize',
          {
            email: guardianEmail,
            amount: paystackAmount,
            reference: paystackReference,
            callback_url: paystackCallbackUrl,
            currency: currency.toUpperCase(),
            ...(useSubaccount
              ? {
                  subaccount: subaccountCodeToUse,
                  transaction_charge: platformFeeMinor,
                  bearer: 'account',
                }
              : {}),
            ...(Array.isArray(paystackChannels) && paystackChannels.length ? { channels: paystackChannels } : {}),
            metadata: paystackMetadata,
          },
          {
            headers: { Authorization: `Bearer ${paystackConfig.secretKey}` },
          }
        );

        const paystackInit = paystackResponse.data?.data || {};

        await db.query(
          `INSERT INTO public_registration_payments (
            organization_id, pending_student_id, student_name, student_email,
            amount, currency, payment_provider, stripe_session_id,
            subaccount_code, status, metadata, paystack_reference
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT DO NOTHING`,
          [
            organizationId,
            pendingStudentId,
            `${first_name} ${last_name}`,
            guardianEmail,
            chargeBreakdown.totalChargedAmount,
            currency,
            'paystack',
            null,
            subaccountCodeToUse || null,
            'pending',
            JSON.stringify(paystackMetadata),
            paystackReference,
          ]
        );

        return res.json({
          success: true,
          provider: 'paystack',
          payment_url: paystackInit.authorization_url,
          authorization_url: paystackInit.authorization_url,
          reference: paystackReference,
          paystack_reference: paystackReference,
          access_code: paystackInit.access_code,
          callback_url: paystackCallbackUrl,
          charge_breakdown: chargeBreakdown,
        });
      }

      if (!stripeConnectAccountId) {
        return res.status(400).json({
          success: false,
          error: 'This organization is not configured to accept payments. Stripe Connect is required.',
        });
      }

      const stripeChargeCurrency = normalizeCurrencyCode(getStripeChargeCurrency()) || currency;
      const stripeChargeAmount = await convertAmountBetweenCurrencies(
        chargeBreakdown.totalChargedAmount,
        currency,
        stripeChargeCurrency
      );
      const amountInMinorUnit = Math.round(stripeChargeAmount * 100);
      const platformFeeInStripeCurrency = chargeBreakdown.platformFeeAmount > 0
        ? await convertAmountBetweenCurrencies(
            chargeBreakdown.platformFeeAmount,
            currency,
            stripeChargeCurrency
          )
        : 0;
      const applicationFeeAmount = Math.round(platformFeeInStripeCurrency * 100);

      // 6. Build metadata
      const metadata = {
        flow: 'public_registration_inline',
        pending_student_id: String(pendingStudentId),
        organization_id: String(organizationId),
        student_name: `${first_name} ${last_name}`,
        guardian_name: primaryGuardian?.first_name || 'Guardian',
        existing_guardian_id: req.session.publicRegistrationExistingGuardianId
          ? String(req.session.publicRegistrationExistingGuardianId) : '',
        registration_amount: requestedAmount.toFixed(2),
        registration_currency: currency,
        stripe_charge_amount: stripeChargeAmount.toFixed(2),
        stripe_charge_currency: stripeChargeCurrency,
        platform_fee_percent: String(chargeBreakdown.platformFeePercentage),
        application_fee_amount: String(applicationFeeAmount),
        platform_fee_bearer: platformFeeBearer,
        platform_fee_amount: String(chargeBreakdown.platformFeeAmount),
        stripe_connect_account_id: stripeConnectAccountId || '',
      };

      // 7. Build PaymentIntent params (destination charge when connected account present)
      const paymentIntentParams = {
        amount: amountInMinorUnit,
        currency: stripeChargeCurrency.toLowerCase(),
        description: `Public registration – ${first_name} ${last_name} · ${organizationName}`,
        metadata,
        automatic_payment_methods: { enabled: true, allow_redirects: 'always' },
        ...(guardianEmail ? { receipt_email: guardianEmail } : {}),
        transfer_data: { destination: stripeConnectAccountId },
      };

      if (applicationFeeAmount > 0) {
        paymentIntentParams.application_fee_amount = applicationFeeAmount;
      }

      // 8. Create PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

      // 9. Persist payment record
      await db.query(
        `INSERT INTO public_registration_payments (
          organization_id, pending_student_id, student_name, student_email,
          amount, currency, payment_provider, stripe_session_id,
          subaccount_code, status, metadata, paystack_reference
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT DO NOTHING`,
        [
          organizationId, pendingStudentId,
          `${first_name} ${last_name}`, guardianEmail,
          chargeBreakdown.totalChargedAmount, currency, 'stripe',
          paymentIntent.id,
          null, // subaccount_code — Stripe Connect ID is not a Paystack subaccount; FK would reject it
          'pending',
          JSON.stringify(metadata),
          `stripe-${paymentIntent.id}`,
        ]
      );

      return res.json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        publishableKey: platformStripe.publicKey,
        amount: chargeBreakdown.totalChargedAmount,
        currency,
        paymentIntentId: paymentIntent.id,
        platformFeePercent: chargeBreakdown.platformFeePercentage,
        schoolReceives: chargeBreakdown.schoolReceivesAmount.toFixed(2),
        charge_breakdown: chargeBreakdown,
      });
    } catch (error) {
      const stripeMessage = error?.raw?.message || error?.message || '';
      const errorMessage = stripeMessage || 'Payment initialization failed. Please try again.';
      return res.status(500).json({ success: false, error: errorMessage });
    }
  },

  paymentCallback: async (req, res, db) => {
        async function getPreferredStripeClient() {
          return getStripePlatformClient(db);
        }

    const stripeSessionId = String(req.query.session_id || '').trim();
    // Payment Element redirect returns payment_intent instead of session_id
    const paymentIntentIdFromQuery = String(req.query.payment_intent || '').trim();
    const redirectStatus = String(req.query.redirect_status || '').trim();
    const pendingStudentId = req.query.pendingStudentId;
    const wasCancelled = parseTruthyFlag(req.query.cancelled);

    // ── Branch 1: Payment Element inline flow (payment_intent in query) ──────
    if (paymentIntentIdFromQuery && !wasCancelled) {
      let organizationId = req.query.organizationId || '';
      const qPendingStudentId = pendingStudentId;
      try {
        await ensurePublicRegistrationSchema(db);

        const stripe = await getPreferredStripeClient();
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentIdFromQuery, {
          expand: ['payment_method'],
        });

        const orgLookup = await db.query(
          `SELECT o.organization_id, o.organization_name, o.nickname
             FROM organizations o
             JOIN pending_students ps ON ps.organization_id = o.organization_id
            WHERE ps.pending_id = $1
            LIMIT 1`,
          [qPendingStudentId || '0']
        );
        const orgDetails = orgLookup.rows[0] || null;
        organizationId = orgDetails?.organization_id || organizationId;
        const orgName = orgDetails?.organization_name || 'School';

        const registrationRedirect =
          process.env.NODE_ENV === 'production' && orgDetails?.nickname
            ? `https://${orgDetails.nickname}.managira.com/common/publicRegister?organizationId=${organizationId}`
            : `/common/publicRegister?organizationId=${organizationId}`;

        if (redirectStatus === 'canceled' || paymentIntent.status === 'canceled') {
          if (qPendingStudentId) {
            await db.query(`UPDATE public_registration_payments SET status = 'cancelled' WHERE stripe_session_id = $1`, [paymentIntentIdFromQuery]).catch(() => {});
            await db.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [qPendingStudentId]).catch(() => {});
            await db.query(`DELETE FROM pending_student_subjects WHERE pending_student_id = $1`, [qPendingStudentId]).catch(() => {});
            await db.query(`DELETE FROM pending_students WHERE pending_id = $1`, [qPendingStudentId]).catch(() => {});
          }
          req.session.pendingStudentId = null;
          req.session.publicRegistrationExistingGuardianId = null;
          req.flash('error', 'Payment was cancelled. Registration was not saved.');
          return res.redirect(registrationRedirect);
        }

        if (paymentIntent.status !== 'succeeded') {
          req.flash('error', 'Your payment is not complete yet. Please try again in a moment or contact the school if this continues.');
          return res.redirect(registrationRedirect);
        }

        // Payment succeeded – look up the payment record by payment_intent id
        const paymentRecordResult = await db.query(
          `SELECT * FROM public_registration_payments WHERE stripe_session_id = $1 LIMIT 1`,
          [paymentIntentIdFromQuery]
        );
        const paymentRecord = paymentRecordResult.rows[0] || null;

        const recordPendingId = paymentRecord?.pending_student_id || qPendingStudentId;

        // Mark payment verified
        await db.query(
          `UPDATE pending_students SET stripe_payment_verified = true, payment_pending = false WHERE pending_id = $1`,
          [recordPendingId]
        );
        await db.query(
          `UPDATE public_registration_payments SET status = 'success', updated_at = NOW() WHERE stripe_session_id = $1`,
          [paymentIntentIdFromQuery]
        );

        // Save guardian portal payment method snapshot
        const pm = paymentIntent.payment_method;
        if (pm && pm.card && recordPendingId) {
          try {
            const guardianInfo = await db.query(
              `SELECT email, first_name, last_name FROM pending_guardians WHERE pending_id = $1 LIMIT 1`,
              [recordPendingId]
            );
            const gRow = guardianInfo.rows[0] || {};
            const guardianIdResult = await db.query(
              `SELECT guardian_id FROM guardian_profiles WHERE organization_id = $1 AND LOWER(TRIM(COALESCE(email,''))) = $2 LIMIT 1`,
              [organizationId, (gRow.email || '').toLowerCase()]
            );
            const guardianId = guardianIdResult.rows[0]?.guardian_id || null;
            if (guardianId) {
              await saveGuardianPortalPaymentMethod(db, {
                guardianId,
                organizationId,
                brand: pm.card.brand,
                last4: pm.card.last4,
                holderName: `${gRow.first_name || ''} ${gRow.last_name || ''}`.trim(),
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
                provider: 'stripe',
                externalPaymentMethodId: pm.id,
                studentId: paymentRecord?.pending_student_id || null,
              });
            }
          } catch (_) { /* non-critical */ }
        }

        // Send confirmation email
        const guardianResult = await db.query(
          `SELECT email, first_name FROM pending_guardians WHERE pending_id = $1 LIMIT 1`,
          [recordPendingId]
        );
        const primaryGuardian = guardianResult.rows[0] || null;
        if (primaryGuardian?.email) {
          const html = renderCleanEmail({
            title: 'Student Registration & Payment Confirmation',
            greeting: `Hello <strong>${he.encode(primaryGuardian.first_name || 'Guardian')}</strong>,`,
            paragraphs: [
              `We are pleased to confirm that the student's registration and payment have been successfully processed for <strong>${he.encode(orgName)}</strong>.`,
              'The admissions team has received the details and will be in touch. Thank you for choosing us!',
            ],
            note: 'For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a>.',
          });
          sendEmailInBackground(
            {
              to: primaryGuardian.email,
              subject: `Student Registration & Payment Confirmation - ${orgName}`,
              html,
              failureNotification: buildFailureNotification(organizationId, {
                title: 'Registration payment confirmation email failed',
                body: `The registration payment confirmation email could not be delivered to ${primaryGuardian.email}.`,
              }),
              attachments: [{ filename: 'managira.png', path: require('path').join(__dirname, '../public/images/managira.png'), cid: 'managira_logo' }],
            },
            'Payment Confirmation Email'
          );
        }

        req.session.pendingStudentId = null;
        req.session.publicRegistrationExistingGuardianId = null;
        req.flash('success', 'Registration and payment completed successfully!');

        const successRedirect =
          process.env.NODE_ENV === 'production' && orgDetails?.nickname
            ? `https://${orgDetails.nickname}.managira.com/common/publicDashboard?success=1`
            : `/common/publicDashboard?organizationId=${organizationId}&success=1`;
        return res.redirect(successRedirect);
      } catch (error) {
        const knownCode = String(error?.code || '').trim().toUpperCase();
        const safeMessage =
          knownCode === 'NO_PAYOUT_ACCOUNT' || knownCode === 'CONNECT_ACCOUNT_NOT_READY'
            ? (error?.message || 'Online payment is not available yet for this school. Please contact the school directly.')
            : 'We could not start payment right now. Please try again in a moment. If this continues, contact the school directly.';
        return res.status(500).json({ success: false, error: safeMessage });
      }
    }

    if (stripeSessionId || wasCancelled) {
      let organizationId = req.query.organizationId || '';

      try {
        await ensurePublicRegistrationSchema(db);

        if (!pendingStudentId) {
          req.flash('error', 'Missing pending registration session.');
          return res.redirect(`/common/publicDashboard?organizationId=${organizationId}`);
        }

        const orgLookup = await db.query(
          `SELECT organization_id, organization_name, nickname
             FROM organizations
            WHERE organization_id = COALESCE($1::int, (SELECT organization_id FROM pending_students WHERE pending_id = $2))`,
          [organizationId || null, pendingStudentId]
        );
        const orgDetails = orgLookup.rows[0] || null;
        organizationId = orgDetails?.organization_id || organizationId;

        const registrationRedirect =
          process.env.NODE_ENV === 'production' && orgDetails?.nickname
            ? `https://${orgDetails.nickname}.managira.com/common/publicRegister?organizationId=${organizationId}`
            : `/common/publicRegister?organizationId=${organizationId}`;

        if (wasCancelled) {
          await db.query(
            `UPDATE public_registration_payments
                SET status = 'cancelled', updated_at = NOW()
              WHERE pending_student_id = $1 AND payment_provider = 'stripe'`,
            [pendingStudentId]
          ).catch(() => {});
          await db.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [pendingStudentId]).catch(() => {});
          await db.query(`DELETE FROM pending_student_subjects WHERE pending_student_id = $1`, [pendingStudentId]).catch(() => {});
          await db.query(`DELETE FROM pending_students WHERE pending_id = $1`, [pendingStudentId]).catch(() => {});
          req.session.pendingStudentId = null;
          req.session.publicRegistrationExistingGuardianId = null;
          req.flash('error', 'Payment was cancelled. Registration was not saved.');
          return res.redirect(registrationRedirect);
        }

        const paymentRecordResult = await db.query(
          `SELECT *
             FROM public_registration_payments
            WHERE stripe_session_id = $1
              AND pending_student_id = $2
            LIMIT 1`,
          [stripeSessionId, pendingStudentId]
        );
        const paymentRecord = paymentRecordResult.rows[0] || null;

        if (!paymentRecord) {
          req.flash('error', 'We could not locate this Stripe checkout session.');
          return res.redirect(registrationRedirect);
        }

        if (String(paymentRecord.status || '').toLowerCase() === 'success') {
          req.session.pendingStudentId = null;
          req.session.publicRegistrationExistingGuardianId = null;
          req.flash('success', 'Registration and payment completed successfully!');
          const successRedirect =
            process.env.NODE_ENV === 'production' && orgDetails?.nickname
              ? `https://${orgDetails.nickname}.managira.com/common/publicDashboard?success=1`
              : `/common/publicDashboard?organizationId=${organizationId}&success=1`;
          return res.redirect(successRedirect);
        }

        const stripe = await getPreferredStripeClient();
        const checkoutSession = await stripe.checkout.sessions.retrieve(stripeSessionId, {
          expand: ['payment_intent.payment_method'],
        });

        let paymentIntent = checkoutSession.payment_intent;
        if (paymentIntent && typeof paymentIntent !== 'object') {
          paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent, {
            expand: ['payment_method'],
          });
        }

        if (checkoutSession.payment_status !== 'paid' && paymentIntent?.status !== 'succeeded') {
          await db.query(
            `UPDATE public_registration_payments
                SET status = 'failed',
                    stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
                    updated_at = NOW()
              WHERE stripe_session_id = $2`,
            [paymentIntent?.id || null, stripeSessionId]
          );
          await db.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [pendingStudentId]).catch(() => {});
          await db.query(`DELETE FROM pending_student_subjects WHERE pending_student_id = $1`, [pendingStudentId]).catch(() => {});
          await db.query(`DELETE FROM pending_students WHERE pending_id = $1`, [pendingStudentId]).catch(() => {});
          req.session.pendingStudentId = null;
          req.session.publicRegistrationExistingGuardianId = null;
          req.flash('error', 'Stripe payment was not completed. Registration was not saved.');
          return res.redirect(registrationRedirect);
        }

        const guardianResult = await db.query(
          `SELECT first_name, last_name, phone, email, hometown
             FROM pending_guardians
            WHERE pending_id = $1
            ORDER BY email DESC NULLS LAST, first_name ASC
            LIMIT 1`,
          [pendingStudentId]
        );
        const primaryGuardian = guardianResult.rows[0] || null;

        const metadata = paymentRecord.metadata || {};
        let guardianId = metadata.existing_guardian_id ? Number(metadata.existing_guardian_id) : null;

        if (!guardianId && primaryGuardian) {
          guardianId = await ensureGuardianPortalProfileAndAccount(db, {
            organizationId,
            firstName: primaryGuardian.first_name,
            lastName: primaryGuardian.last_name,
            phone: primaryGuardian.phone,
            email: primaryGuardian.email,
            hometown: primaryGuardian.hometown,
          });
        }

        const paymentMethod = paymentIntent?.payment_method && typeof paymentIntent.payment_method === 'object'
          ? paymentIntent.payment_method
          : null;
        const cardDetails = paymentMethod?.card || null;
        const holderName = paymentMethod?.billing_details?.name || checkoutSession.customer_details?.name || null;
        const paymentMethodSnapshot = cardDetails
          ? {
              brand: cardDetails.brand || 'card',
              last4: cardDetails.last4 || null,
              exp_month: cardDetails.exp_month != null ? String(cardDetails.exp_month) : null,
              exp_year: cardDetails.exp_year != null ? String(cardDetails.exp_year) : null,
              holder_name: holderName,
              wallet_type: cardDetails.wallet?.type || null,
            }
          : null;

        if (guardianId && paymentMethodSnapshot?.last4) {
          await saveGuardianPortalPaymentMethod(db, {
            guardianId,
            organizationId,
            brand: paymentMethodSnapshot.brand,
            last4: paymentMethodSnapshot.last4,
            holderName: paymentMethodSnapshot.holder_name,
            expMonth: paymentMethodSnapshot.exp_month,
            expYear: paymentMethodSnapshot.exp_year,
            provider: 'stripe',
            externalPaymentMethodId: paymentMethod?.id || null,
          });
        }

        await db.query(
          `UPDATE pending_students
              SET stripe_payment_verified = true,
                  payment_pending = false
            WHERE pending_id = $1`,
          [pendingStudentId]
        );

        await db.query(
          `UPDATE public_registration_payments
              SET status = 'success',
                  stripe_payment_intent_id = $1,
                  guardian_id = COALESCE($2, guardian_id),
                  payment_method_snapshot = $3,
                  updated_at = NOW()
            WHERE stripe_session_id = $4`,
          [
            paymentIntent?.id || null,
            guardianId || null,
            paymentMethodSnapshot ? JSON.stringify(paymentMethodSnapshot) : null,
            stripeSessionId,
          ]
        );

        if (primaryGuardian && primaryGuardian.email) {
          const html = renderCleanEmail({
            title: 'Student Registration & Payment Confirmation',
            greeting: `Hello <strong>${he.encode(primaryGuardian.first_name || 'Guardian')}</strong>,`,
            paragraphs: [
              `We are pleased to confirm that the student's registration and payment have been successfully processed for <strong>${he.encode(orgDetails?.organization_name || 'the school')}</strong>.`,
              `The admissions team at <strong>${he.encode(orgDetails?.organization_name || 'the school')}</strong> has received the details. You may hear from them soon, or you can reach out directly if you have any questions.`,
              'Thank you for choosing us!',
            ],
            note: 'For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
          });

          sendEmailInBackground({
            to: primaryGuardian.email,
            subject: `Student Registration & Payment Confirmation - ${orgDetails?.organization_name || 'School'}`,
            html,
            failureNotification: buildFailureNotification(organizationId, {
              title: 'Registration payment confirmation email failed',
              body: `The registration payment confirmation email could not be delivered to ${primaryGuardian.email}.`,
            }),
          }, 'Public Registration Payment Confirmation').catch((err) => {
            console.error('[Payment Callback] Stripe confirmation email failed:', err.message);
          });
        }

        req.flash('success', 'Registration and payment completed successfully!');
        req.session.pendingStudentId = null;
        req.session.publicRegistrationExistingGuardianId = null;

        const successRedirect =
          process.env.NODE_ENV === 'production' && orgDetails?.nickname
            ? `https://${orgDetails.nickname}.managira.com/common/publicDashboard?success=1`
            : `/common/publicDashboard?organizationId=${organizationId}&success=1`;

        return res.redirect(successRedirect);
      } catch (err) {
        console.error('[Payment Callback] Stripe public registration error:', err.message);
        req.flash('error', 'Error verifying Stripe payment. Please contact support.');
        return res.redirect(`/common/publicDashboard?organizationId=${organizationId || ''}`);
      }
    }

    const reference = req.query.reference;
    const paystackPendingStudentId = req.query.pendingStudentId;

    console.log('[Payment Callback] Reference:', reference);
    console.log('[Payment Callback] Pending Student ID:', paystackPendingStudentId);

    if (!reference || !paystackPendingStudentId) {
      console.log('[Payment Callback] Missing reference or pending student ID');
      
      // Try to get organizationId from query or session
      const orgId = req.query.organizationId || req.session.organizationId || '';
      
      req.flash("error", "Missing transaction reference or pending student.");
      return res.redirect(`/common/publicDashboard?organizationId=${orgId}`);
    }

    try {
      const paystackConfig = await getActivePaystackConfig(db);
      // ✅ Verify payment with Paystack
      console.log('[Payment Callback] Verifying payment with Paystack...');
      const result = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: { Authorization: `Bearer ${paystackConfig.secretKey}` },
        }
      );

      console.log('[Payment Callback] Paystack verification response:', result.data);

      const paymentStatus = result.data.data.status;

      if (paymentStatus === "success") {
        console.log('[Payment Callback] ✅ Payment successful, updating database...');

        // Tenant boundary: bind the verified Paystack reference to the
        // supplied pendingStudentId via the payment record's organization.
        // This prevents a forged callback (valid reference + foreign
        // pending id) from mutating another org's pending student state.
        const ownershipCheck = await db.query(
          `SELECT 1
             FROM public_registration_payments prp
             JOIN pending_students ps
               ON ps.organization_id = prp.organization_id
            WHERE prp.paystack_reference = $1
              AND ps.pending_id = $2
            LIMIT 1`,
          [reference, paystackPendingStudentId]
        );

        if (ownershipCheck.rows.length === 0) {
          console.log('[Payment Callback] ❌ Reference does not belong to the supplied pending student.');
          req.flash('error', 'Payment verification failed.');
          const fallbackOrg = req.query.organizationId || req.session.organizationId || '';
          return res.redirect(`/common/publicDashboard?organizationId=${fallbackOrg}`);
        }

        // ✅ Mark payment as verified
        await db.query(
          `UPDATE pending_students SET stripe_payment_verified = true, payment_pending = false WHERE pending_id = $1`,
          [paystackPendingStudentId]
        );

        // Update payment record
        await db.query(
          `UPDATE public_registration_payments SET status = 'success' WHERE paystack_reference = $1`,
          [reference]
        );

        // Auto-settle the school's share when this charge was NOT split at
        // charge time (mobile money / bank-recipient / local accounts). For
        // ACCT_ subaccounts this is a no-op (already settled by Paystack split).
        try {
          await settleFromPaystackTransaction(db, {
            txn: result.data?.data || null,
            context: 'public_registration',
            secretKey: paystackConfig.secretKey,
          });
        } catch (settleErr) {
          console.error('[Payment Callback] Auto-settle failed (will retry on schedule):', settleErr.message);
        }

        const guardianResult = await db.query(
          `SELECT email, first_name FROM pending_guardians WHERE pending_id = $1 LIMIT 1`,
          [paystackPendingStudentId]
        );
        const primaryGuardian = guardianResult.rows[0];

        // ✅ Fetch organization details
        const orgResult = await db.query(
          `SELECT organization_id, organization_name, nickname FROM organizations WHERE organization_id = (
            SELECT organization_id FROM pending_students WHERE pending_id = $1
          )`,
          [paystackPendingStudentId]
        );
        const orgDetails = orgResult.rows[0];
        const orgName = orgDetails?.organization_name || "the school";
        const organizationId = orgDetails?.organization_id;

        console.log('[Payment Callback] Organization ID:', organizationId);

        // ✅ Send email if primary guardian email exists
        if (primaryGuardian && primaryGuardian.email) {
          const html = renderCleanEmail({
            title: "Student Registration & Payment Confirmation",
            greeting: `Hello <strong>${he.encode(primaryGuardian.first_name || "Guardian")}</strong>,`,
            paragraphs: [
              `We are pleased to confirm that the student's registration and payment have been successfully processed for <strong>${he.encode(orgName)}</strong>.`,
              `The admissions team at <strong>${he.encode(orgName)}</strong> has received the details. You may hear from them soon, or you can reach out directly if you have any questions.`,
              "Thank you for choosing us!",
            ],
            note: 'For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
          });

          try {
            sendEmailInBackground({
              to: primaryGuardian.email,
              subject: `Student Registration & Payment Confirmation - ${orgName}`,
              html,
              failureNotification: buildFailureNotification(organizationId, {
                title: 'Registration payment confirmation email failed',
                body: `The registration payment confirmation email could not be delivered to ${primaryGuardian.email}.`,
              }),
              attachments: [
                {
                  filename: "managira.png",
                  path: require("path").join(__dirname, "../public/images/managira.png"),
                  cid: "managira_logo",
                },
              ],
            }, "Payment Confirmation Email");
          } catch (error) {
            // ...removed error log for clean background operation...
          }
        }

        req.flash(
          "success",
          "Registration and payment completed successfully!"
        );
        req.session.pendingStudentId = null;
        req.session.publicRegistrationExistingGuardianId = null;

        console.log('[Payment Callback] ✅ Redirecting to public dashboard with organizationId:', organizationId);

        // ✅ Build proper redirect URL for production (to subdomain) or fallback
        const redirectUrl =
          process.env.NODE_ENV === "production" && orgDetails?.nickname
            ? `https://${orgDetails.nickname}.managira.com/common/publicDashboard?success=1`
            : `/common/publicDashboard?organizationId=${organizationId}&success=1`;

        return res.redirect(redirectUrl);
      } else {
        console.log('[Payment Callback] ❌ Payment failed, deleting pending record...');

        // Tenant boundary: only delete the pending student if the verified
        // Paystack reference actually belongs to that pending student's org.
        const failureOwnership = await db.query(
          `SELECT ps.organization_id
             FROM public_registration_payments prp
             JOIN pending_students ps
               ON ps.organization_id = prp.organization_id
            WHERE prp.paystack_reference = $1
              AND ps.pending_id = $2
            LIMIT 1`,
          [reference, paystackPendingStudentId]
        );

        if (failureOwnership.rows.length === 0) {
          console.log('[Payment Callback] ❌ Failure callback rejected: reference does not own the supplied pending student.');
          req.flash('error', 'Payment verification failed.');
          const fallbackOrg = req.query.organizationId || req.session.organizationId || '';
          return res.redirect(`/common/publicDashboard?organizationId=${fallbackOrg}`);
        }

        const failedOrgId = failureOwnership.rows[0].organization_id;

        // Payment failed — delete pending record (already org-bound above)
        await db.query(`DELETE FROM pending_students WHERE pending_id = $1`, [
          paystackPendingStudentId,
        ]);
        req.flash("error", "Payment failed. Registration was not saved.");
        req.session.pendingStudentId = null;
        req.session.publicRegistrationExistingGuardianId = null;

        const fallbackRedirect =
          process.env.NODE_ENV === "production" && req.schoolDetails
            ? `https://${req.schoolDetails.nickname}.managira.com/common/publicDashboard`
            : `/common/publicDashboard?organizationId=${failedOrgId || ""}`;
        
        console.log('[Payment Callback] Redirecting after failure to:', fallbackRedirect);
        return res.redirect(fallbackRedirect);
      }
    } catch (err) {
      console.error('[Payment Callback] ❌❌❌ ERROR:', err.message);
      console.error('[Payment Callback] Error stack:', err.stack);
      
      // Try to get organizationId from pending student
      let errorOrgId = '';
      try {
        const orgIdResult = await db.query(
          `SELECT organization_id FROM pending_students WHERE pending_id = $1`,
          [paystackPendingStudentId]
        );
        errorOrgId = orgIdResult.rows[0]?.organization_id || '';
      } catch (dbErr) {
        console.error('[Payment Callback] Could not fetch organizationId:', dbErr.message);
      }
      
      req.flash("error", "Error verifying payment. Please contact support.");

      const fallbackRedirect =
        process.env.NODE_ENV === "production" && req.schoolDetails
          ? `https://${req.schoolDetails.nickname}.managira.com/common/publicDashboard`
          : `/common/publicDashboard?organizationId=${errorOrgId}`;
      
      console.log('[Payment Callback] Redirecting after error to:', fallbackRedirect);
      return res.redirect(fallbackRedirect);
    }
  },

  getPendingStudentDetails: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;

    try {
      // Fetch the pending student
      const studentResult = await db.query(
        `
        SELECT ps.*, c.class_name, g.name AS graduation_group
        FROM pending_students ps
        LEFT JOIN classes c ON ps.class_id = c.class_id
        LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
        WHERE ps.pending_id = $1 AND ps.organization_id = $2
      `,
        [id, organizationId]
      );

      if (!studentResult.rows.length) {
        return res.status(404).json({ error: "Student not found." });
      }

      const student = studentResult.rows[0];

      // Fetch selected subjects for the pending student
      const subjectsResult = await db.query(
        `
        SELECT s.subject_id, s.subject_name
        FROM pending_student_subjects pss
        JOIN subjects s ON s.subject_id = pss.subject_id
        WHERE pss.pending_student_id = $1
      `,
        [id]
      );

      // Fetch only subjects for this class
      const allSubjectsResult = await db.query(
        `
        SELECT subject_id, subject_name
        FROM subjects
        WHERE organization_id = $1 AND class_id = $2
        ORDER BY subject_name ASC
      `,
        [organizationId, student.class_id]
      );

      // Fetch guardians
      const guardiansResult = await db.query(
        `
        SELECT * FROM pending_guardians
        WHERE pending_id = $1
      `,
        [id]
      );

      // Fetch all classes
      const classResult = await db.query(
        `
        SELECT class_id, class_name
        FROM classes
        WHERE organization_id = $1
        ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}
      `,
        [organizationId]
      );

      // Fetch all graduation year groups
      const gradGroupResult = await db.query(
        `
        SELECT id, name
        FROM graduation_year_groups
        WHERE organization_id = $1
        ORDER BY name ASC
      `,
        [organizationId]
      );

      // ✅ Fetch school years and terms
      const schoolYearResults = await db.query(
        `
        SELECT id AS school_year_id, year_label
        FROM school_years
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `,
        [organizationId]
      );

      const termResults = await db.query(
        `
        SELECT term_id, school_year_id, term_name
        FROM terms
        WHERE organization_id = $1
        ORDER BY start_date ASC
      `,
        [organizationId]
      );

      const schoolYears = schoolYearResults.rows;
      const terms = termResults.rows;

      schoolYears.forEach((year) => {
        year.terms = terms.filter(
          (term) => term.school_year_id === year.school_year_id
        );
      });

      return res.json({
        student,
        subjects: subjectsResult.rows || [],
        allSubjects: allSubjectsResult.rows || [],
        guardians: guardiansResult.rows || [],
        classes: classResult.rows || [],
        graduationYearGroups: gradGroupResult.rows || [],
        schoolYears, // ✅ now passed to frontend
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      return res.status(500).json({ error: "Error loading student details." });
    }
  },

  viewPendingAdmissions: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const isEmbedded = isEmbeddedRequest(req, "admissionPending");

      const result = await db.query(
        `
        SELECT ps.*, c.class_name, g.name AS graduation_group
        FROM pending_students ps
        LEFT JOIN classes c ON ps.class_id = c.class_id
        LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
        WHERE ps.organization_id = $1
        ORDER BY ps.submitted_at DESC
      `,
        [organizationId]
      );

      res.render("common/admissionPending", {
        title: "Admission Pending",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        pendingStudents: result.rows,
        messages: req.flash(),
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Error loading data");
    }
  },

  approvePendingStudent: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;
    const client = await db.connect();

    try {
      await ensureStudentEmailSchema(db);
      await client.query("BEGIN");

      console.log('[Approve Pending Student] Starting approval for ID:', id);
      console.log('[Approve Pending Student] Request body:', req.body);
      console.log('[Approve Pending Student] Request file:', req.file);

      // ✅ Save changes if any data was submitted
      if (req.body && Object.keys(req.body).length > 1) { // More than just the student ID
        console.log('[Approve Pending Student] Saving changes before approval...');
        
        // Parse and coerce values
        const classId = req.body.class_id ? parseInt(req.body.class_id) : null;
        const gradGroupId = req.body.graduation_year_group_id ? parseInt(req.body.graduation_year_group_id) : null;

        let schoolYearId = null;
        let termId = null;

        if (req.body.enrollmentType === "current") {
          const currentYearRes = await client.query(
            `SELECT id AS school_year_id FROM school_years WHERE current = TRUE AND organization_id = $1 LIMIT 1`,
            [organizationId]
          );
          if (currentYearRes.rows.length > 0) {
            schoolYearId = currentYearRes.rows[0].school_year_id;
            const currentTermRes = await client.query(
              `SELECT term_id FROM terms WHERE school_year_id = $1 AND current = TRUE LIMIT 1`,
              [schoolYearId]
            );
            if (currentTermRes.rows.length > 0) {
              termId = currentTermRes.rows[0].term_id;
            }
          }
        } else {
          schoolYearId = req.body.schoolYearId ? parseInt(req.body.schoolYearId) : null;
          termId = req.body.termId ? parseInt(req.body.termId) : null;
        }

        // ✅ Upload and save image if provided
        let imageUrl = null;
        if (req.file) {
          console.log('[Approve Pending Student] Uploading image...');
          const s3Key = `images/studentimages/${organizationId}/${Date.now()}_${req.file.originalname}`;
          imageUrl = await uploadToS3(req.file, s3Key);
          console.log('[Approve Pending Student] Image uploaded:', imageUrl);
        }

        // ✅ Update pending student
        const baseParams = [
          req.body.first_name,
          req.body.last_name,
          req.body.date_of_birth,
          req.body.gender,
          req.body.hometown,
          normalizeOptionalEmail(req.body.student_email),
          classId,
          gradGroupId,
          schoolYearId,
          termId,
          req.body.enrollmentType,
        ];

        const queryParams = imageUrl
          ? [...baseParams, imageUrl, id, organizationId]
          : [...baseParams, id, organizationId];

        const updateQuery = `
          UPDATE pending_students SET
            first_name = $1,
            last_name = $2,
            date_of_birth = $3,
            gender = $4,
            hometown = $5,
            email = COALESCE($6, email),
            class_id = $7,
            graduation_year_group_id = $8,
            school_year_id = $9,
            term_id = $10,
            enrollment_type = $11
            ${imageUrl ? ", image_url = $12" : ""}
          WHERE pending_id = $${imageUrl ? 13 : 12} AND organization_id = $${imageUrl ? 14 : 13}
        `;

        await client.query(updateQuery, queryParams);
        console.log('[Approve Pending Student] ✅ Changes saved');

        // ✅ Update subjects if provided
        if (req.body.subjects) {
          await client.query(
            `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
            [id]
          );
          const subjectArray = Array.isArray(req.body.subjects)
            ? req.body.subjects
            : [req.body.subjects];
          for (const subjectId of subjectArray) {
            if (subjectId) {
              await client.query(
                `INSERT INTO pending_student_subjects (pending_student_id, subject_id, organization_id)
                 VALUES ($1, $2, $3)`,
                [id, parseInt(subjectId), organizationId]
              );
            }
          }
        }

        // ✅ Update guardians if provided
        const guardianKeys = Object.keys(req.body).filter((k) => k.startsWith("guardianFirstName"));
        if (guardianKeys.length > 0) {
          await client.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [id]);
          for (let i = 0; i < guardianKeys.length; i++) {
            const fn = req.body[`guardianFirstName${i}`];
            if (fn) {
              await client.query(
                `INSERT INTO pending_guardians 
                 (pending_id, first_name, last_name, phone, email, hometown)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  id,
                  fn,
                  req.body[`guardianLastName${i}`],
                  req.body[`guardianPhone${i}`],
                  req.body[`guardianEmail${i}`],
                  req.body[`guardianHometown${i}`],
                ]
              );
            }
          }
        }
      }

      console.log('[Approve Pending Student] Fetching updated pending record...');

      // ✅ Now re-fetch the updated pending record
      const pending = await client.query(
        `SELECT * FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      if (!pending.rows.length) throw new Error("No such pending student.");

      const student = pending.rows[0];

      // ✅ Get org name for email
      const orgResult = await client.query(
        `SELECT organization_name FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const orgName = orgResult.rows[0]?.organization_name || "Our School";

      // ✅ Create student
      const inserted = await client.query(
        `INSERT INTO students (first_name, last_name, date_of_birth, gender, hometown, email, class_id, graduation_year_group_id, organization_id, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING student_id`,
        [
          student.first_name,
          student.last_name,
          student.date_of_birth,
          student.gender,
          student.hometown,
          normalizeOptionalEmail(student.email),
          student.class_id,
          student.graduation_year_group_id,
          organizationId,
          student.image_url,
        ]
      );

      const studentId = inserted.rows[0].student_id;

      // ✅ Enrollment
      let enrollmentId;
      const enrollmentCheck = await client.query(
        `SELECT enrollment_id FROM enrollments
         WHERE school_year_id = $1 AND term_id = $2 AND organization_id = $3`,
        [student.school_year_id, student.term_id, organizationId]
      );

      if (enrollmentCheck.rows.length) {
        enrollmentId = enrollmentCheck.rows[0].enrollment_id;
      } else {
        const created = await client.query(
          `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
           VALUES ($1, $2, $3, NOW()) RETURNING enrollment_id`,
          [student.school_year_id, student.term_id, organizationId]
        );
        enrollmentId = created.rows[0].enrollment_id;
      }

      await client.query(
        `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
         VALUES ($1, $2, $3)`,
        [enrollmentId, studentId, student.class_id]
      );

      // ✅ Subjects
      const subjects = await client.query(
        `SELECT subject_id FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );

      for (const row of subjects.rows) {
        await client.query(
          `INSERT INTO student_subjects (student_id, subject_id, organization_id)
           VALUES ($1, $2, $3)`,
          [studentId, row.subject_id, organizationId]
        );
      }

      // ✅ Guardians
      const guardians = await client.query(
        `SELECT * FROM pending_guardians WHERE pending_id = $1`,
        [id]
      );

      for (const g of guardians.rows) {
        await client.query(
          `INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, student_id, organization_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            g.first_name,
            g.last_name,
            g.address,
            g.phone,
            g.email,
            g.hometown,
            studentId,
            organizationId,
          ]
        );

        const portalGuardianId = await ensureGuardianPortalProfileAndAccount(client, {
          organizationId,
          firstName: g.first_name,
          lastName: g.last_name,
          phone: g.phone,
          email: g.email,
          hometown: g.hometown,
          imageUrl: g.image_url,
        });

        if (portalGuardianId) {
          await client.query(
            `INSERT INTO guardian_students (guardian_id, student_id)
             VALUES ($1, $2)
             ON CONFLICT (guardian_id, student_id) DO NOTHING`,
            [portalGuardianId, studentId]
          );
        }
      }

      // ✅ Delete from pending
      await client.query(
        `DELETE FROM pending_guardians WHERE pending_id = $1`,
        [id]
      );
      await client.query(
        `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );
      await client.query(`DELETE FROM pending_students WHERE pending_id = $1`, [
        id,
      ]);

      // ✅ Notify guardians
      const guardianEmails = guardians.rows.map((g) => g.email).filter(Boolean);
      if (guardianEmails.length) {
        const html = renderCleanEmail({
          title: "Admission Approved",
          greeting: "Dear Guardian,",
          paragraphs: [
            `We are pleased to inform you that the admission application for <strong>${he.encode(student.first_name)} ${he.encode(student.last_name)}</strong> has been approved by <strong>${he.encode(orgName)}</strong>.`,
            "Thank you for choosing our school.",
          ],
          note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
        });
        const mailOptions = {
          from: process.env.NOTIFY_EMAIL_USER,
          to: guardianEmails.join(","),
          subject: `Admission Approved: ${he.encode(
            student.first_name
          )} ${he.encode(student.last_name)}`,
          html,
          failureNotification: buildFailureNotification(organizationId, {
            title: "Admission approval email failed",
            body: `The admission approval email for ${student.first_name} ${student.last_name} could not be delivered to one or more guardian email addresses.`,
          }),
          attachments: [
            {
              filename: "managira.png",
              path: require("path").join(
                __dirname,
                "../public/images/managira.png"
              ),
              cid: "managira_logo",
            },
          ],
        };
        sendEmailInBackground(mailOptions, "Admission Approved Email");
      }

      await client.query("COMMIT");

      // F2 — notify guardian(s) in-app that admission was approved
      // guardians.rows holds pending_guardians; if guardian portal profile exists, notify there
      const studentFullName = `${student.first_name} ${student.last_name}`;
      for (const g of guardians.rows) {
        if (!g.email) continue;
        // Resolve guardian_profiles id by email match
        try {
          const gp = await db.query(
            `SELECT guardian_id FROM guardian_profiles
             WHERE organization_id = $1 AND email = $2 LIMIT 1`,
            [organizationId, g.email]
          );
          if (gp.rows.length) {
            notifSvc.createNotification(db, {
              orgId: Number(organizationId),
              recipientType: 'guardian',
              recipientId: gp.rows[0].guardian_id,
              type: 'admission_approved',
              title: 'Admission approved',
              body: `${studentFullName} has been admitted`,
              link: null,
            }).catch(() => {});
          }
        } catch { /* silent */ }
      }

      req.flash("success", "Student approved and added to the system.");
      res.redirect("/common/admissionPending");
    } catch (err) {
      await client.query("ROLLBACK");
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to approve student.");
      res.redirect("/common/admissionPending");
    } finally {
      client.release();
    }
  },

  rejectPendingStudent: async (req, res, db) => {
    const { id } = req.params;
    // pending_id is a globally-unique SERIAL, not scoped per org in any of
    // these queries below - without an explicit organization_id check here,
    // a staff member from ANY org could reject (permanently delete) another
    // org's pending admission just by guessing/iterating pending_id, since
    // every other handler on this page (approve, save-changes, get-details)
    // already scopes by organization_id and this one didn't.
    const sessionOrgId = req.session.organizationId;
    try {
      const ownerCheck = await db.query(
        `SELECT 1 FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [id, sessionOrgId]
      );
      if (!ownerCheck.rows.length) {
        req.flash("error", "Student application not found.");
        return res.redirect("/common/admissionPending");
      }

      const guardians = await db.query(
        `SELECT email FROM pending_guardians WHERE pending_id = $1`,
        [id]
      );
      const pending = await db.query(
        `SELECT first_name, last_name, organization_id FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [id, sessionOrgId]
      );

      const orgId = pending.rows[0]?.organization_id;
      let orgName = "Our School";
      if (orgId) {
        const orgRes = await db.query(
          `SELECT organization_name FROM organizations WHERE organization_id = $1`,
          [orgId]
        );
        orgName = orgRes.rows[0]?.organization_name || orgName;
      }

      await db.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [
        id,
      ]);
      await db.query(
        `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );
      await db.query(`DELETE FROM pending_students WHERE pending_id = $1 AND organization_id = $2`, [
        id,
        sessionOrgId,
      ]);

      req.flash("info", "Student application rejected and deleted.");

      if (guardians.rows.length && pending.rows.length) {
        const guardianEmails = guardians.rows
          .map((g) => g.email)
          .filter((e) => e);
        const student = pending.rows[0];

        const html = renderCleanEmail({
          title: "Admission Rejected",
          greeting: "Dear Guardian,",
          paragraphs: [
            `We regret to inform you that the admission application for <strong>${he.encode(student.first_name)} ${he.encode(student.last_name)}</strong> has been rejected by <strong>${he.encode(orgName)}</strong>.`,
            "We appreciate your interest in our school.",
          ],
          note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
        });
        const mailOptions = {
          from: process.env.NOTIFY_EMAIL_USER,
          to: guardianEmails.join(","),
          subject: `Admission Rejected: ${student.first_name} ${student.last_name}`,
          html,
          failureNotification: buildFailureNotification(orgId, {
            title: "Admission rejection email failed",
            body: `The admission rejection email for ${student.first_name} ${student.last_name} could not be delivered to one or more guardian email addresses.`,
          }),
          attachments: [
            {
              filename: "managira.png",
              path: require("path").join(
                __dirname,
                "../public/images/managira.png"
              ),
              cid: "managira_logo",
            },
          ],
        };
        sendEmailInBackground(mailOptions, "Admission Rejected Email");

        // F3 — notify guardian(s) in-app that admission was rejected
        const rejectedName = `${pending.rows[0]?.first_name || ''} ${pending.rows[0]?.last_name || ''}`.trim();
        for (const g of guardians.rows) {
          if (!g.email) continue;
          try {
            const gp = await db.query(
              `SELECT guardian_id FROM guardian_profiles
               WHERE organization_id = $1 AND email = $2 LIMIT 1`,
              [orgId, g.email]
            );
            if (gp.rows.length) {
              notifSvc.createNotification(db, {
                orgId: Number(orgId),
                recipientType: 'guardian',
                recipientId: gp.rows[0].guardian_id,
                type: 'admission_rejected',
                title: 'Admission not approved',
                body: `${rejectedName}'s application was not approved`,
                link: null,
              }).catch(() => {});
            }
          } catch { /* silent */ }
        }
      }

      res.redirect("/common/admissionPending");
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to reject student.");
      res.redirect("/common/admissionPending");
    }
  },

  getMajorityGraduationYearGroup: async (req, res, db) => {
    const { classId } = req.query;

    if (!classId) {
      return res.status(400).json({ error: "Class ID is required." });
    }

    try {
      const result = await db.query(
        `
                SELECT graduation_year_group_id, COUNT(*) as count
                FROM students
                WHERE class_id = $1 AND organization_id = $2
                GROUP BY graduation_year_group_id
                ORDER BY count DESC
                LIMIT 1;
            `,
        [classId, req.session.organizationId]
      );

      if (result.rows.length > 0) {
        res.json({
          majorityGraduationYearGroupId:
            result.rows[0].graduation_year_group_id,
        });
      } else {
        res.json({ majorityGraduationYearGroupId: null });
      }
    } catch (err) {
      // ...removed error log for clean background operation...
      res
        .status(500)
        .json({ error: "Failed to fetch majority graduation year group." });
    }
  },

  getSubjectsForClass: async (req, res, db) => {
    const { classId } = req.query;
    const organizationId = req.session.organizationId;

    if (!classId) {
      return res.status(400).json({ error: "Class ID is required." });
    }
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const result = await db.query(
        `
        SELECT subject_id, subject_name
        FROM subjects
        WHERE class_id = $1 AND organization_id = $2
        ORDER BY subject_name ASC
        `,
        [classId, organizationId]
      );

      res.json(result.rows);
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).json({ error: "Failed to load subjects." });
    }
  },

  // Controller for rendering studentDetails page
  studentDetails: async (req, res, db) => {
    const studentId = req.query.studentId;
    const termId = req.query.termId;
    const requestedClassId = Number.parseInt(req.query.classId, 10);
    const organizationId = req.session.organizationId;
    const userRole = req.session.userRole;
    const accountType = req.session.accountType || req.session.user?.account_type || null;
    const userId = req.session.user ? req.session.user.user_id : null;
    const normalizedUserRole = normalizeRoleKey(userRole || req.session.accountType);

    if (!studentId || !termId) {
      return res.status(400).send("Student ID and Term ID are required.");
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/common/orgDashboard");
      }

      // Fetch student details
      const studentResult = await db.query(
        `
          SELECT s.*, c.class_name, c.class_id, g.name AS grad_year_group_name
          FROM students s
          LEFT JOIN classes c ON s.class_id = c.class_id
          LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
          WHERE s.student_id = $1 AND s.organization_id = $2
          `,
        [studentId, organizationId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).send("Student not found.");
      }

      const student = studentResult.rows[0];
      const classId = Number.isInteger(requestedClassId)
        ? requestedClassId
        : student.class_id;

      await ensureStudentPortalSchema(db);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const studentPortalIntegrationActive = Boolean(studentPortalIntegration.activated);
      const studentPortalAccountResult = await db.query(
        `SELECT login_email, password_hash
           FROM student_accounts
          WHERE organization_id = $1 AND student_id = $2
          LIMIT 1`,
        [organizationId, studentId]
      );
      const studentPortalAccount = studentPortalAccountResult.rows[0] || null;
      const studentPortalSetupComplete = Boolean(
        studentPortalAccount &&
        studentPortalAccount.password_hash &&
        String(studentPortalAccount.password_hash).trim()
      );
      const canBypassAsAdmin = ["admin"].includes(normalizeRoleKey(userRole)) || ["admin"].includes(normalizeRoleKey(accountType));
      const canManageStudentsSettings = canBypassAsAdmin || await userHasPermission(
        db,
        {
          userId,
          userRole,
          organizationId,
          accountType,
          userEmail: req.session?.user?.email || null,
        },
        PERMISSIONS.MANAGE_STUDENTS
      );
      const canSendStudentPortalRequest = Boolean(
        req.session &&
        studentPortalIntegrationActive &&
        canManageStudentsSettings &&
        normalizeStudentEmail(student.email)
      );
      const studentPortalAction = studentPortalSetupComplete ? "reset" : "setup";
      const studentPortalActionLabel = studentPortalSetupComplete
        ? "Reset Student Portal Password"
        : "Send Student Portal Request";
      await ensureTransportationSchema(db);
      const transportationSnapshot = await getStudentTransportationSnapshot(
        db,
        organizationId,
        Number(studentId)
      ).catch(() => null);

      // **Check if user is the main teacher of the class**
      let isMainTeacher = false;

      if (userRole === "Teacher") {
        const mainTeacherCheck = await db.query(
          `SELECT user_id FROM user_classes 
               WHERE class_id = $1 AND main = TRUE`,
          [classId]
        );

        const mainTeacherId =
          mainTeacherCheck.rows.length > 0
            ? mainTeacherCheck.rows[0].user_id
            : null;
        isMainTeacher = userId === mainTeacherId;
      }

      // **Fetch subjects for the student's class**
      let subjectsQuery;
      let subjectsParams;

      if (userRole === "Teacher" && !isMainTeacher) {
        // If it's a teacher who is not the main teacher, show only their assigned subjects for the student's class
        subjectsQuery = `
          SELECT s.subject_id, s.subject_name
          FROM user_subjects us
          INNER JOIN subjects s ON us.subject_id = s.subject_id
          WHERE us.user_id = $1 AND s.class_id = $2 AND s.organization_id = $3
          ORDER BY s.subject_name
        `;
        subjectsParams = [userId, classId, organizationId];
      } else {
        // For everyone else (including main teacher), show only subjects that the student is actually enrolled in
        subjectsQuery = `
          SELECT s.subject_id, s.subject_name
          FROM student_subjects ss
          INNER JOIN subjects s ON ss.subject_id = s.subject_id
          WHERE ss.student_id = $1 AND ss.organization_id = $2
          ORDER BY s.subject_name
        `;
        subjectsParams = [studentId, organizationId];
      }

      const subjectsResult = await db.query(subjectsQuery, subjectsParams);

      const subjectsMap = new Map();
      subjectsResult.rows.forEach((subject) => {
        subjectsMap.set(subject.subject_id, {
          ...subject,
          totalScore: null,
          totalMaxScore: 0,
          totalPercentage: null,
          grade: null,
          position: null,
          scaleBase: 100,
          hasEnteredScore: false,
          assessments: [],
        });
      });

      // **Fetch assessments and scores for the student for the specified term**
      const assessmentsResult = await db.query(
        `
          SELECT DISTINCT ON (a.assessment_id) a.assessment_id, a.title, a.weight, ar.score, a.subject_id, a.max_score, a.category,
                 ar.total_subject_score,
                 ar.total_percentage,
                 COALESCE(
                   (
                     SELECT COALESCE(NULLIF(sr.grade_label, ''),
                       CASE
                         WHEN ar.total_percentage >= 90 THEN 'A'
                         WHEN ar.total_percentage >= 80 THEN 'B'
                         WHEN ar.total_percentage >= 70 THEN 'C'
                         ELSE 'D'
                       END
                     )
                     FROM score_remarks sr
                     WHERE sr.organization_id = $3
                       AND sr.class_id = $2
                       AND sr.term_id = $4
                       AND NULLIF(TRIM(sr.grade_label), '') IS NOT NULL
                     ORDER BY
                       CASE
                         WHEN ar.total_percentage IS NULL THEN 1000000000
                         WHEN ar.total_percentage::numeric BETWEEN sr.from_percentage AND sr.to_percentage THEN 0
                         WHEN ar.total_percentage::numeric < sr.from_percentage THEN sr.from_percentage - ar.total_percentage::numeric
                         ELSE ar.total_percentage::numeric - sr.to_percentage
                       END ASC,
                       sr.from_percentage DESC
                     LIMIT 1
                   ),
                   CASE
                     WHEN ar.total_percentage IS NULL THEN NULL
                     WHEN ar.total_percentage >= 90 THEN 'A'
                     WHEN ar.total_percentage >= 80 THEN 'B'
                     WHEN ar.total_percentage >= 70 THEN 'C'
                     ELSE 'D'
                   END
                 ) AS grade,
                 COALESCE(a.scale_base, 100) AS scale_base
          FROM assessments a
          LEFT JOIN assessment_results ar ON a.assessment_id = ar.assessment_id AND ar.student_id = $1
          WHERE a.subject_id IN (SELECT subject_id FROM subjects WHERE class_id = $2)
          AND a.organization_id = $3 AND a.term_id = $4
          ORDER BY a.assessment_id
          `,
        [studentId, classId, organizationId, termId]
      );

      // Aggregate assessments by subject
      assessmentsResult.rows.forEach((assessment) => {
        if (subjectsMap.has(assessment.subject_id)) {
          const subject = subjectsMap.get(assessment.subject_id);
          subject.assessments.push(assessment);
          if (assessment.score !== null) {
            if (subject.totalScore === null) {
              subject.totalScore = 0;
            }
            subject.hasEnteredScore = true;
            subject.totalScore += parseFloat(assessment.score);
            subject.totalMaxScore += parseFloat(assessment.max_score);
          }
          if (assessment.scale_base) {
            subject.scaleBase = parseInt(assessment.scale_base) || 100;
          }
        }
      });

      // Fetch positions from student_positions table for the specified term
      const positionsResult = await db.query(
        `
          SELECT subject_id, position
          FROM student_positions
          WHERE student_id = $1 AND organization_id = $2 AND term_id = $3
          `,
        [studentId, organizationId, termId]
      );

      const positions = positionsResult.rows.reduce((acc, position) => {
        acc[position.subject_id] = position.position;
        return acc;
      }, {});

      for (const subject of subjectsMap.values()) {
        if (!subject.hasEnteredScore || !Number.isFinite(subject.totalScore) || subject.totalMaxScore <= 0) {
          subject.totalScore = null;
          subject.totalPercentage = null;
          subject.grade = null;
          subject.position = "-";
          continue;
        }

        subject.totalPercentage = (subject.totalScore / subject.totalMaxScore) * 100;
        subject.grade = await getGradeLabelFromScoreRemark(
          db,
          organizationId,
          classId,
          termId,
          subject.totalPercentage
        );
        subject.position = positions[subject.subject_id] || "-";
      }

      const subjects = Array.from(subjectsMap.values());

      // Calculate unique assessments for all subjects to use in the table headers
      const uniqueAssessments = Array.from(
        new Set(assessmentsResult.rows.map((a) => a.title))
      ).map((title) => {
        return assessmentsResult.rows.find((a) => a.title === title);
      });

      // Fetch guardians associated with the student
      const guardiansResult = await db.query(
        `
          SELECT * FROM guardians
          WHERE student_id = $1
          `,
        [studentId]
      );

      // Fetch current school year from the current term
      const currentTermId = req.session.currentTermId;

      let studentEnrolledInCurrent = false;
      let currentSchoolYearLabel = null;
      let currentTermName = null;

      if (currentTermId) {
        const currentInfoResult = await db.query(
          `
    SELECT t.term_id, t.term_name, sy.id AS school_year_id, sy.year_label
    FROM terms t
    INNER JOIN school_years sy ON t.school_year_id = sy.id
    WHERE t.term_id = $1 AND t.organization_id = $2
  `,
          [currentTermId, organizationId]
        );

        if (currentInfoResult.rows.length > 0) {
          const { school_year_id, year_label, term_name } =
            currentInfoResult.rows[0];
          currentSchoolYearLabel = year_label;
          currentTermName = term_name;

          // Check enrollment
          const enrollmentCheck = await db.query(
            `
      SELECT 1
      FROM enrollments e
      INNER JOIN enrolled_students es ON e.enrollment_id = es.enrollment_id
      WHERE e.term_id = $1 AND e.school_year_id = $2
      AND es.student_id = $3 AND e.organization_id = $4
      LIMIT 1
    `,
            [currentTermId, school_year_id, studentId, organizationId]
          );

          studentEnrolledInCurrent = enrollmentCheck.rows.length > 0;
        }
      }

      const guardians = guardiansResult.rows;

      // Get enrolled class for this term
      const enrolledClassResult = await db.query(
        `
  SELECT c.class_name
  FROM enrolled_students es
  JOIN enrolled_classes ec ON es.enrollment_id = ec.enrollment_id AND es.class_id = ec.class_id
  JOIN classes c ON es.class_id = c.class_id
  JOIN enrollments e ON es.enrollment_id = e.enrollment_id
  WHERE es.student_id = $1 AND e.term_id = $2 AND e.organization_id = $3
  ORDER BY e.created_at DESC
  LIMIT 1
`,
        [studentId, termId, organizationId]
      );

      const enrolledClassForTerm =
        enrolledClassResult.rows[0]?.class_name || "Not enrolled";

      const termResult = await db.query(
        `
  SELECT term_name
  FROM terms
  WHERE term_id = $1 AND organization_id = $2
  LIMIT 1
`,
        [termId, organizationId]
      );

      const termNameForPage = termResult.rows[0]?.term_name || "Unknown";

      // Fetch student ID settings for display
      const sidSettingsResult = await db.query(
        `SELECT use_custom_student_id, student_id_prefix FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const studentIdSettings = sidSettingsResult.rows[0] || {};

      res.render("common/studentDetails", {
        title: "Student Details",
        student,
        studentIdSettings,
        guardians,
        subjects,
        uniqueAssessments,
        isMainTeacher,
        getOrdinalSuffix,
        gradYearGroupName:
          student.grad_year_group_name || "No graduation year group assigned",
        currentTerm: termId,
        currentSchoolYearLabel,
        currentTermName,
        enrolledClassForTerm,
        termNameForPage,
        studentEnrolledInCurrent,
        studentPortalIntegrationActive,
        studentPortalSetupComplete,
        studentPortalAction,
        studentPortalActionLabel,
        canSendStudentPortalRequest,
        transportationSnapshot,
        messages: req.flash(),
        hideGlobalHeader: true,
        hideGlobalFooter: true,
      });
        } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Failed to fetch student details");
        }
  },

  studentInfo: async (req, res, db) => {
    const studentId = req.query.studentId;

    if (!studentId) {
      return res.status(400).send("Student ID is required.");
    }

    try {
      const organizationId = req.session.organizationId;

      // Fetch student details
      const studentResult = await db.query(
        `
            SELECT s.*, c.class_name, g.name AS grad_year_group_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
            WHERE s.student_id = $1 AND s.organization_id = $2
        `,
        [studentId, organizationId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).send("Student not found.");
      }

      const student = studentResult.rows[0];

      // Fetch guardians for the student
      const guardiansResult = await db.query(
        `
            SELECT * FROM guardians WHERE student_id = $1
        `,
        [studentId]
      );

      const guardians = guardiansResult.rows;

      res.render("common/studentInfo", {
        title: "Student Info",
        student,
        guardians,
        gradYearGroupName:
          student.grad_year_group_name || "No graduation year group assigned",
        messages: req.flash(),
      });
    } catch (err) {
      // ...removed error log for clean background operation...
      res.status(500).send("Failed to fetch student information.");
    }
  },

  editStudentGet: async (req, res, db) => {
    try {
      const { studentId, termId: queryTermId, classId: queryClassId } = req.query;
      const organizationId = req.session.organizationId;

      // Fetch student details
      const studentQuery = `
            SELECT s.*, c.class_id, c.class_name 
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            WHERE s.student_id = $1 AND s.organization_id = $2;
        `;
      const studentResult = await db.query(studentQuery, [
        studentId,
        organizationId,
      ]);
      const student = studentResult.rows[0];

      if (!student) {
        req.flash("error", "Student not found.");
        return res.redirect("/common/orgDashboard");
      }

      // Resolve classId: prefer query param, fall back to student's class
      const resolvedClassId = queryClassId || student.class_id;

      // Resolve currentTerm: prefer termId from query param, then DB lookup
      let currentTerm = null;
      if (queryTermId) {
        const termByIdResult = await db.query(
          `SELECT term_id, term_name FROM terms WHERE term_id = $1 LIMIT 1`,
          [queryTermId]
        );
        if (termByIdResult.rows.length > 0) {
          currentTerm = termByIdResult.rows[0];
        }
      }

      if (!currentTerm) {
        const termQuery = `
              SELECT t.term_id, t.term_name 
              FROM enrollments e
              INNER JOIN enrolled_classes ec ON e.enrollment_id = ec.enrollment_id
              INNER JOIN terms t ON e.term_id = t.term_id
              WHERE ec.class_id = $1 AND e.organization_id = $2
              ORDER BY t.start_date DESC LIMIT 1;
          `;
        const termResult = await db.query(termQuery, [
          resolvedClassId,
          organizationId,
        ]);
        currentTerm = termResult.rows.length > 0 ? termResult.rows[0] : null;
      }

      // If still no term, try to get any term for the org as last resort
      if (!currentTerm) {
        const anyTermResult = await db.query(
          `SELECT term_id, term_name FROM terms WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [organizationId]
        );
        currentTerm = anyTermResult.rows.length > 0 ? anyTermResult.rows[0] : null;
      }

      // Fetch classes
      const classResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [organizationId]
      );

      // Fetch graduation year groups
      const graduationYearGroups = await db.query(
        `SELECT id, name FROM graduation_year_groups WHERE organization_id = $1;`,
        [organizationId]
      );

      // Fetch subjects for the student's class
      const subjects = await db.query(
        `SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2;`,
        [student.class_id, organizationId]
      );

      // Fetch guardians
      const guardians = await db.query(
        `SELECT * FROM guardians WHERE student_id = $1;`,
        [studentId]
      );

      // Fetch subjects already assigned to the student
      const studentSubjects = await db.query(
        `SELECT subject_id FROM student_subjects WHERE student_id = $1;`,
        [studentId]
      );

      // ✅ Ensure term is always defined
      // Fetch org student ID settings for the edit form
      const editOrgIdSettingsResult = await db.query(
        `SELECT use_custom_student_id, student_id_prefix, student_id_auto_generate
         FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const studentIdSettings = editOrgIdSettingsResult.rows[0] || {};

      res.render("common/editStudent", {
        title: "Edit Student",
        hideGlobalHeader: true,
        hideGlobalFooter: true,
        student,
        classes: classResult.rows,
        graduationYearGroups: graduationYearGroups.rows,
        subjects: subjects.rows,
        studentGuardians: guardians.rows,
        studentSubjects: studentSubjects.rows.map((row) => row.subject_id),
        currentTerm, // ✅ Fix: Now always defined
        returnClassId: resolvedClassId,
        returnTermId: currentTerm ? currentTerm.term_id : null,
        studentIdSettings,
        messages: req.flash(),
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to fetch student details.");
      res.redirect("/common/orgDashboard");
    }
  },

  editStudentPost: async (req, res, db) => {
    const client = await db.connect();
    try {
      await ensureStudentEmailSchema(db);
      await ensureStudentAddressSchema(db);
      await ensureStudentDobUnknownSchema(db);
      const { studentId } = req.params;
      const sessionOrganizationId = req.session.organizationId;
      const {
        firstName,
        lastName,
        dateOfBirth,
        dateOfBirthUnknown,
        height,
        hometown,
        studentAddress,
        homeLatitude,
        homeLongitude,
        studentHomeLatitude,
        studentHomeLongitude,
        transportHomeLatitude,
        transportHomeLongitude,
        studentEmail,
        classId,
        graduationYearGroupId,
        gender,
        customStudentId,
        returnClassId,
        returnTermId,
      } = req.body;
      const keepExistingSubjectsOnClassChange = parseKeepExistingSubjectsPreference(
        req.body && req.body.keepExistingSubjectsOnClassChange,
        true
      );

      if (!sessionOrganizationId) {
        req.flash("error", "Unauthorized.");
        return res.redirect("/account/login");
      }

      // Tenant boundary: the student being edited must belong to the
      // caller's organization. Without this, a hostile or buggy client
      // could overwrite or cascade-delete (student_subjects/guardians)
      // rows in a foreign organization.
      const ownership = await client.query(
        `SELECT 1 FROM students WHERE student_id = $1 AND organization_id = $2`,
        [studentId, sessionOrganizationId]
      );
      if (!ownership.rows.length) {
        req.flash("error", "Student does not belong to your organization.");
        return res.redirect("/common/orgDashboard");
      }

      // Tenant boundary on referenced ids supplied by the client.
      let safeClassId = null;
      if (classId) {
        const classCheck = await client.query(
          `SELECT class_id FROM classes WHERE class_id = $1 AND organization_id = $2`,
          [classId, sessionOrganizationId]
        );
        if (!classCheck.rows.length) {
          req.flash("error", "Selected class does not belong to your organization.");
          return res.redirect("/common/editStudent?studentId=" + studentId);
        }
        safeClassId = classCheck.rows[0].class_id;
      }

      let safeGraduationYearGroupId = null;
      if (graduationYearGroupId) {
        const gygCheck = await client.query(
          `SELECT id FROM graduation_year_groups WHERE id = $1 AND organization_id = $2`,
          [graduationYearGroupId, sessionOrganizationId]
        );
        if (gygCheck.rows.length) {
          safeGraduationYearGroupId = gygCheck.rows[0].id;
        }
      }

      // subjects[] comes as an array; guardians[n][field] comes as an object keyed by index
      const subjectsRaw = req.body.subjects || req.body['subjects[]'];
      const subjectsInput = Array.isArray(subjectsRaw)
        ? subjectsRaw
        : subjectsRaw
        ? [subjectsRaw]
        : [];
      const normalizedSubjectIds = [...new Set(
        subjectsInput.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0)
      )];

      const guardiansRaw = req.body.guardians;
      const guardians = Array.isArray(guardiansRaw)
        ? guardiansRaw
        : guardiansRaw && typeof guardiansRaw === 'object'
        ? Object.values(guardiansRaw)
        : [];

      let imageUrl = null;
      if (req.file) {
        const s3Key = `images/studentimages/${sessionOrganizationId}/${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, s3Key);
      }

      const editOrgIdSettingsResult = await client.query(
        `SELECT use_custom_student_id, student_id_prefix
           FROM organizations
          WHERE organization_id = $1`,
        [sessionOrganizationId]
      );
      const editStudentIdSettings = editOrgIdSettingsResult.rows[0] || {};

      await client.query("BEGIN");

      // Fetch old class info before update (for class-change notification)
      const oldStudentResult = await client.query(
        `SELECT s.class_id, c.class_name AS old_class_name
         FROM students s LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE s.student_id = $1 AND s.organization_id = $2`,
        [studentId, sessionOrganizationId]
      );
      const oldClassId = oldStudentResult.rows[0]?.class_id;
      const oldClassName = oldStudentResult.rows[0]?.old_class_name;
      const effectiveClassId = safeClassId || oldClassId || null;
      const hasClassChange = !!safeClassId && String(safeClassId) !== String(oldClassId || '');
      const submittedSubjectsRes = normalizedSubjectIds.length
        ? await client.query(
            `SELECT subject_id, subject_name, class_id
               FROM subjects
              WHERE subject_id = ANY($1::int[]) AND organization_id = $2`,
            [normalizedSubjectIds, sessionOrganizationId]
          )
        : { rows: [] };
      const validSubjectRows = effectiveClassId
        ? submittedSubjectsRes.rows.filter((row) => String(row.class_id) === String(effectiveClassId))
        : [];
      const invalidSubmittedSubjectNames = submittedSubjectsRes.rows
        .filter((row) => !effectiveClassId || String(row.class_id) !== String(effectiveClassId))
        .map((row) => row.subject_name)
        .filter(Boolean);
      let subjectIdsToPersist = validSubjectRows.map((row) => row.subject_id);
      let subjectCarryoverNotice = { message: '', skippedMessage: '' };

      // Validate custom student ID uniqueness (exclude current student)
      const rawCustomId = (customStudentId || '').trim();
      const editPrefix = editStudentIdSettings.use_custom_student_id
        ? (editStudentIdSettings.student_id_prefix || '')
        : '';
      const normalizedCustomId = rawCustomId
        ? (editPrefix && rawCustomId.toUpperCase().startsWith(editPrefix.toUpperCase())
            ? rawCustomId
            : editPrefix + rawCustomId)
        : '';
      const rawCustomNumeric = rawCustomId.replace(/\D/g, '');
      const customNumericValue = rawCustomNumeric ? parseInt(rawCustomNumeric, 10) : null;
      if (normalizedCustomId) {
        const conflictParams = [sessionOrganizationId, studentId, normalizedCustomId];
        const conflictClauses = ['custom_student_id = $3'];
        if (Number.isInteger(customNumericValue)) {
          conflictParams.push(customNumericValue);
          conflictClauses.push('student_id = $4');
        }
        const idConflict = await client.query(
          `SELECT 1
             FROM students
            WHERE organization_id = $1
              AND student_id <> $2
              AND (${conflictClauses.join(' OR ')})
            LIMIT 1`,
          conflictParams
        );
        if (idConflict.rows.length > 0) {
          await client.query('ROLLBACK');
          // Find next available suggestion
          const numPart = customNumericValue || 0;
          const padLen = rawCustomNumeric.length || 3;
          let suggestion = null;
          for (let n = numPart + 1; n < numPart + 1000; n++) {
            const candidate = editPrefix + String(n).padStart(padLen, '0');
            const check = await client.query(
              `SELECT 1
                 FROM students
                WHERE organization_id = $1
                  AND student_id <> $2
                  AND (custom_student_id = $3 OR student_id = $4)
                LIMIT 1`,
              [sessionOrganizationId, studentId, candidate, n]
            );
            if (check.rows.length === 0) { suggestion = candidate; break; }
          }
          req.flash('error', `ID "${normalizedCustomId}" is already taken.${suggestion ? ` Try "${suggestion}" instead.` : ''}`);
          return res.redirect('/common/editStudent?studentId=' + studentId);
        }
      }

      // Update student details
      const normalizedStudentEmail = normalizeOptionalEmail(studentEmail);

      const updateStudentQuery = `
            UPDATE students
            SET first_name = $1, 
                last_name = $2, 
                date_of_birth = $3, 
                date_of_birth_unknown = $4,
                height = $5, 
                hometown = $6, 
                address = $7,
                email = $8,
                class_id = $9, 
                graduation_year_group_id = $10, 
                gender = $11, 
                image_url = COALESCE($12, image_url),
                custom_student_id = $15
            WHERE student_id = $13 
            AND organization_id = $14;
        `;
      await client.query(updateStudentQuery, [
        firstName,
        lastName,
        parseBooleanLike(dateOfBirthUnknown) ? null : (dateOfBirth || null),
        parseBooleanLike(dateOfBirthUnknown),
        height,
        hometown,
        studentAddress,
        normalizedStudentEmail,
        safeClassId,
        safeGraduationYearGroupId,
        gender,
        imageUrl,
        studentId,
        sessionOrganizationId,
        normalizedCustomId || null,
      ]);

      if (normalizedStudentEmail) {
        const emailConflict = await client.query(
          `SELECT 1
             FROM student_accounts
            WHERE organization_id = $1
              AND student_id <> $2
              AND LOWER(login_email) = $3
            LIMIT 1`,
          [sessionOrganizationId, studentId, normalizedStudentEmail.toLowerCase()]
        );

        if (emailConflict.rows.length > 0) {
          await client.query('ROLLBACK');
          req.flash('error', 'That student login email is already in use by another student account.');
          return res.redirect('/common/editStudent?studentId=' + studentId);
        }

        await client.query(
          `UPDATE student_accounts
              SET login_email = $1,
                  updated_at = NOW()
            WHERE student_id = $2
              AND organization_id = $3`,
          [normalizedStudentEmail.toLowerCase(), studentId, sessionOrganizationId]
        );
      }

      if (hasClassChange && keepExistingSubjectsOnClassChange && subjectIdsToPersist.length === 0) {
        const carryoverResult = await carryStudentSubjectsToClass(client, {
          organizationId: sessionOrganizationId,
          studentId: Number(studentId),
          newClassId: Number(effectiveClassId),
          keepExistingSubjects: true,
        });
        subjectIdsToPersist = carryoverResult.assignedSubjectIds;
        subjectCarryoverNotice = buildSubjectCarryoverNotice(carryoverResult);
      } else {
        await replaceStudentSubjects(client, sessionOrganizationId, Number(studentId), subjectIdsToPersist);

        if (hasClassChange && !keepExistingSubjectsOnClassChange && subjectIdsToPersist.length === 0) {
          subjectCarryoverNotice = buildSubjectCarryoverNotice(
            {
              keptSubjects: false,
              unmatchedSubjectNames: invalidSubmittedSubjectNames,
            },
            'Previous subjects were not carried into the new class.'
          );
        } else if (invalidSubmittedSubjectNames.length) {
          subjectCarryoverNotice = {
            message: subjectCarryoverNotice.message,
            skippedMessage: `Subjects not added to this class: ${summarizeSubjectNames(invalidSubmittedSubjectNames)}.`,
          };
        }
      }

      // Update guardians (legacy table) - org-scoped delete
      await client.query(
        `DELETE FROM guardians WHERE student_id = $1 AND organization_id = $2;`,
        [studentId, sessionOrganizationId]
      );
      if (Array.isArray(guardians)) {
        for (const guardian of guardians) {
          await client.query(
            `
                    INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, student_id, organization_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
                    `,
            [
              guardian.firstName,
              guardian.lastName,
              guardian.address,
              guardian.phone,
              guardian.email, // Add the email field correctly
              guardian.hometown,
              studentId,
              sessionOrganizationId,
            ]
          );
        }
      }

      await upsertStudentTransportationAssignment(client, {
        organizationId: sessionOrganizationId,
        studentId: Number(studentId),
        homeAddress: studentAddress,
        homeLatitude: homeLatitude || studentHomeLatitude || transportHomeLatitude,
        homeLongitude: homeLongitude || studentHomeLongitude || transportHomeLongitude,
      });

      await client.query("COMMIT");

      // Notify guardians if class changed
      if (safeClassId && String(safeClassId) !== String(oldClassId)) {
        const newClassResult = await client.query(
          `SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2`,
          [safeClassId, sessionOrganizationId]
        );
        const newClassName = newClassResult.rows[0]?.class_name;
        if (oldClassName && newClassName) {
          notifyGuardiansOnClassChange(db, {
            organizationId: sessionOrganizationId,
            studentId,
            studentName: `${firstName} ${lastName}`,
            oldClassName,
            newClassName,
          }).catch(err => console.error("[Notify] Class change notification failed:", err.message));
        }
      }

      const successMessages = ["Student updated successfully."];
      if (subjectCarryoverNotice.message) successMessages.push(subjectCarryoverNotice.message);
      if (subjectCarryoverNotice.skippedMessage) successMessages.push(subjectCarryoverNotice.skippedMessage);
      req.flash("success", successMessages.join(' '));

      const effectiveReturnClassId = safeClassId || oldClassId || returnClassId || null;
      const effectiveReturnTermId = returnTermId || null;
      if (effectiveReturnClassId && effectiveReturnTermId) {
        return res.redirect(
          `/common/classDashboard/${effectiveReturnClassId}/student/${studentId}?termId=${effectiveReturnTermId}`
        );
      }

      return res.redirect("/common/editStudent?studentId=" + studentId);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // ...removed error log for clean background operation...

      // Ensure `studentId` is referenced in error handling
      const studentIdFallback = req.params.studentId || "unknown";
      req.flash("error", "Failed to update student.");
      res.redirect("/common/editStudent?studentId=" + studentIdFallback);
    } finally {
      client.release();
    }
  },

  deleteStudentImage: async (req, res, db) => {
    const { studentId } = req.params;
    const organizationId = req.session.organizationId;

    try {
      if (!studentId || isNaN(Number(studentId))) {
        req.flash("error", "Invalid student ID.");
        return res.redirect("/common/orgDashboard");
      }

      const studentRes = await db.query(
        `SELECT image_url, class_id FROM students WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );

      if (studentRes.rows.length === 0) {
        // ...removed warn for clean background operation...
        req.flash("error", "Student not found.");
        return res.redirect("/common/orgDashboard");
      }

      const { image_url: currentImageUrl, class_id: classId } =
        studentRes.rows[0];

      if (currentImageUrl && currentImageUrl !== "profilePlaceholder.png") {
        // Remove the S3 URL prefix to get the key if needed
        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
        let imageKey = currentImageUrl;
        if (currentImageUrl.startsWith(s3Prefix)) {
          imageKey = currentImageUrl.substring(s3Prefix.length);
        }
        await deleteFromS3(imageKey);
      }

      await db.query(
        `UPDATE students SET image_url = 'profilePlaceholder.png' WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );

      const termRes = await db.query(
        `SELECT t.term_id FROM enrollments e
         INNER JOIN enrolled_classes ec ON e.enrollment_id = ec.enrollment_id
         INNER JOIN terms t ON e.term_id = t.term_id
         WHERE ec.class_id = $1 AND e.organization_id = $2
         ORDER BY t.start_date DESC LIMIT 1;`,
        [classId, organizationId]
      );

      const termId = termRes.rows.length > 0 ? termRes.rows[0].term_id : null;

      req.flash("success", "Student image deleted successfully.");
      res.redirect(
        `/common/editStudent?studentId=${studentId}${
          termId ? `&termId=${termId}` : ""
        }`
      );
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to delete student image.");
      res.redirect(`/common/editStudent?studentId=${studentId}`);
    }
  },

  deletePendingStudentImage: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;

    try {
      if (!id || isNaN(Number(id))) {
        req.flash("error", "Invalid pending student ID.");
        return res.redirect("/common/admissionPending");
      }

      // Fetch image URL
      const imageRes = await db.query(
        `SELECT image_url FROM pending_students WHERE pending_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if (imageRes.rows.length === 0) {
        // ...removed warn for clean background operation...
        req.flash("error", "Pending student not found.");
        return res.redirect("/common/admissionPending");
      }

      const currentImageUrl = imageRes.rows[0].image_url;

      // Delete from S3 if not placeholder
      if (currentImageUrl && currentImageUrl !== "profilePlaceholder.png") {
        const s3Key = currentImageUrl.startsWith("/")
          ? currentImageUrl.substring(1)
          : currentImageUrl;
        await deleteFromS3(s3Key);
      }

      // Update DB
      await db.query(
        `UPDATE pending_students SET image_url = 'profilePlaceholder.png' WHERE pending_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      req.flash("success", "Pending student image deleted successfully.");
      res.redirect(`/common/admissionPending`);
    } catch (err) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to delete pending student image.");
      res.redirect(`/common/admissionPending`);
    }
  },

  deleteStudent: async (req, res, db) => {
    const { studentId } = req.params;
    const sessionOrganizationId = req.session.organizationId;

    if (!studentId) {
      req.flash("error", "Student ID is required.");
      return res.redirect(`/common/editStudent?studentId=${studentId}`);
    }
    if (!sessionOrganizationId) {
      req.flash("error", "Unauthorized.");
      return res.redirect("/auth/login");
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN"); // Start a transaction

      // Fetch the student's image URL and class ID -- scoped to the
      // session organization so a request for another org's student id
      // cannot cascade-delete its related rows.
      const studentResult = await client.query(
        "SELECT image_url, class_id FROM students WHERE student_id = $1 AND organization_id = $2",
        [studentId, sessionOrganizationId]
      );

      if (studentResult.rows.length > 0) {
        const imageUrl = studentResult.rows[0].image_url;
        const classId = studentResult.rows[0].class_id;

        // Delete the student's image from S3, if applicable
        if (imageUrl && imageUrl !== "profilePlaceholder.png") {
          const imageKey = path.basename(imageUrl);
          await deleteFromS3(`images/${imageKey}`);
        }

        // Delete all references to the student in other tables
        await client.query("DELETE FROM guardians WHERE student_id = $1", [
          studentId,
        ]);
        await client.query(
          "DELETE FROM student_subjects WHERE student_id = $1",
          [studentId]
        );
        await client.query(
          "DELETE FROM enrolled_students WHERE student_id = $1",
          [studentId]
        );
        await client.query(
          "DELETE FROM attendance_records WHERE student_id = $1",
          [studentId]
        );

        // Finally, delete the student
        await client.query(
          "DELETE FROM students WHERE student_id = $1 AND organization_id = $2",
          [studentId, sessionOrganizationId]
        );

        await client.query("COMMIT"); // Commit the transaction
        req.flash("success", "Student deleted successfully.");
        res.redirect(`/common/classDashboard?classId=${classId}`);
      } else {
        await client.query("ROLLBACK"); // Rollback transaction on error
        req.flash("error", "Student not found.");
        res.redirect(`/common/editStudent?studentId=${studentId}`);
      }
    } catch (error) {
      await client.query("ROLLBACK"); // Rollback transaction on error
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to delete student.");
      res.redirect(`/common/editStudent?studentId=${studentId}`);
    } finally {
      client.release();
    }
  },

  getAttendanceForClass: async (req, res, db) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    if (!termId) {
      return res.status(400).send("Term ID is required");
    }
    if (!organizationId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
      const result = await db.query(
        `
          SELECT attendance_id,
                 student_id,
                 class_id,
                 term_id,
                 organization_id,
                 status,
                 marked_by,
                 marked_at,
                 updated_at,
                 date::text AS date
          FROM attendance_records
          WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
        `,
        [classId, termId, organizationId]
      );
      res.json({ success: true, attendance: result.rows });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  },

  attendanceCollection: async (req, res, db) => {
    const { classId, termId } = req.query;
    const isEmbedded = isEmbeddedRequest(req, "attendanceCollection");

    if (!classId || !termId) {
      return res.status(400).send("Class ID and Term ID are required.");
    }

    try {
      const organizationId = req.session.organizationId;

      // Fetch class name
      const classResult = await db.query(
        "SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2",
        [classId, organizationId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).send("Class not found");
      }
      const className = classResult.rows[0].class_name;

      // Fetch term name and school year
      const termResult = await db.query(
        `SELECT t.term_name, sy.year_label 
                 FROM terms t 
                 JOIN school_years sy ON t.school_year_id = sy.id 
                 WHERE t.term_id = $1`,
        [termId]
      );

      if (termResult.rows.length === 0) {
        return res.status(404).send("Term not found");
      }

      const termName = termResult.rows[0].term_name;
      const schoolYear = {
        year_label: termResult.rows[0].year_label,
      };

      // Fetch students enrolled in the current term for this class
      const studentsResult = await db.query(
        `
                SELECT s.student_id, s.first_name, s.last_name, s.gender
                FROM enrolled_students es
                INNER JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                INNER JOIN students s ON es.student_id = s.student_id
                WHERE es.class_id = $1 
                  AND e.term_id = $2 
                  AND e.organization_id = $3
                  AND s.graduated = FALSE
                ORDER BY s.last_name, s.first_name

            `,
        [classId, termId, organizationId]
      );

      const students = studentsResult.rows;

      // Fetch term dates for the class
      const termDatesResult = await db.query(
        `
                SELECT start_date::text AS start_date_key,
                       end_date::text AS end_date_key
                FROM terms
                WHERE term_id = $1
            `,
        [termId]
      );

      if (termDatesResult.rows.length === 0) {
        return res.status(404).send("Term not found");
      }

      const { start_date_key, end_date_key } = termDatesResult.rows[0];
      await ensureAttendanceCalendarSchema(db);

      const termStartKey = String(start_date_key).slice(0, 10);
      const termEndKey = String(end_date_key).slice(0, 10);
      const termStart = new Date(`${termStartKey}T00:00:00.000Z`);
      const termEnd = new Date(`${termEndKey}T23:59:59.999Z`);

      const dates = [];
      let currentDate = new Date(termStart);
      const today = new Date();

      while (currentDate <= termEnd && currentDate <= today) {
        dates.push(currentDate.toISOString().split("T")[0]);
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }

      const attendanceCalendarProfile = await getAttendanceCalendarProfile(db, organizationId, termId);
      const attendanceCalendarDays = attendanceCalendarProfile
        ? await getAttendanceCalendarDays(
            db,
            attendanceCalendarProfile.calendar_id,
            termStart,
            termEnd
          )
        : [];
      const attendanceCalendarDayMap = buildCalendarDayMap(attendanceCalendarDays);

      const weekendDays = new Set(
        ((attendanceCalendarProfile && attendanceCalendarProfile.weekend_days) || [])
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day))
      );

      const getDateMeta = (dateKey) => {
        if (!attendanceCalendarProfile) {
          return {
            countable: true,
            marker: null,
            markerLabel: null,
          };
        }

        const matchedDay = attendanceCalendarDayMap.get(dateKey);
        if (matchedDay && String(matchedDay.source || '').toLowerCase() === 'manual') {
          const countable = Boolean(matchedDay.counts_for_attendance);
          return {
            countable,
            marker: countable ? null : 'manual',
            markerLabel: countable ? null : (matchedDay.label || 'Excluded'),
          };
        }

        if (
          matchedDay &&
          String(matchedDay.source || '').toLowerCase() === 'public_holiday' &&
          Boolean(attendanceCalendarProfile.include_public_holidays)
        ) {
          return {
            countable: false,
            marker: 'holiday',
            markerLabel: matchedDay.label || 'Holiday',
          };
        }

        const dayOfWeek = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
        if (weekendDays.has(dayOfWeek)) {
          return {
            countable: false,
            marker: 'weekend',
            markerLabel: 'Weekend',
          };
        }

        return {
          countable: true,
          marker: null,
          markerLabel: null,
        };
      };

      // Role-based date limit: teachers see up to 6 calendar days; supervisors/managers see all.
      // We intentionally limit by calendar days (not only valid days) so term-end days still appear.
      const userRole = (req.session.userRole || '').toLowerCase();
      const isTeacher = userRole === 'teacher';
      const dateLimit = isTeacher ? 6 : dates.length;

      const displayDates = [...dates]
        .sort((a, b) => new Date(b) - new Date(a))
        .slice(0, dateLimit)
        .reverse();

      const dateMetaMap = {};
      displayDates.forEach((dateKey) => {
        dateMetaMap[dateKey] = getDateMeta(dateKey);

        // Always mark the official term end date and keep it editable/countable.
        if (dateKey === termEndKey) {
          dateMetaMap[dateKey] = {
            ...dateMetaMap[dateKey],
            countable: true,
            isOfficialTermEnd: true,
            marker: 'term_end',
            markerLabel: 'Official Term End Date',
          };
        }
      });

      const excludedDisplayDateCount = displayDates.filter((dateKey) => !dateMetaMap[dateKey].countable).length;
      const excludedTotalDateCount = dates.filter((dateKey) => !getDateMeta(dateKey).countable).length;

      const weekendLabelMap = WEEKDAY_OPTIONS.reduce((acc, item) => {
        acc[item.value] = item.label;
        return acc;
      }, {});

      const attendanceCalendarSummary = attendanceCalendarProfile
        ? {
            enabled: true,
            countryCode: attendanceCalendarProfile.country_code,
            includePublicHolidays: Boolean(attendanceCalendarProfile.include_public_holidays),
            weekendLabels: (attendanceCalendarProfile.weekend_days || [])
              .map((day) => weekendLabelMap[Number(day)])
              .filter(Boolean),
            hiddenDateCount: 0,
            excludedDisplayDateCount,
            excludedTotalDateCount,
          }
        : { enabled: false, hiddenDateCount: 0, excludedDisplayDateCount: 0, excludedTotalDateCount: 0 };

      // Fetch attendance records
      const attendanceResult = await db.query(
        `
                SELECT student_id, date::text AS date, status, updated_at
                FROM attendance_records
                WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
            `,
        [classId, termId, organizationId]
      );

      const attendanceMap = {};
      const lastEditedMap = {};

      attendanceResult.rows.forEach((record) => {
        const dateKey = String(record.date).slice(0, 10);
        if (!attendanceMap[record.student_id]) {
          attendanceMap[record.student_id] = {};
        }
        attendanceMap[record.student_id][dateKey] = record.status;

        if (record.updated_at) {
          lastEditedMap[dateKey] = record.updated_at;
        }
      });

      // Render the attendance collection page
      res.render("common/attendanceCollection", {
        title: "Attendance Records",
        classId,
        className,
        termId,
        termName,
        displayDates,
        dateMetaMap,
        students,
        attendanceMap,
        lastEditedMap,
        schoolYear,
        userRole,
        attendanceCalendarSummary,
        isEmbedded,
        hideGlobalHeader: true,
        hideGlobalFooter: true,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      res.status(500).send("Error loading attendance records page");
    }
  },

  saveSingleAttendance: async (req, res, db) => {
    const { attendance, classId, termId, date } = req.body;

    if (!termId) {
      return res.status(400).send("Term ID is required");
    }

    const organizationId = req.session.organizationId;
    if (!organizationId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    try {
      // Tenant boundary: class and term must belong to the caller's org.
      const ctxCheck = await db.query(
        `SELECT (SELECT 1 FROM classes WHERE class_id = $1 AND organization_id = $3) AS class_ok,
                (SELECT 1 FROM terms   WHERE term_id  = $2 AND organization_id = $3) AS term_ok`,
        [classId, termId, organizationId]
      );
      if (!ctxCheck.rows[0] || !ctxCheck.rows[0].class_ok || !ctxCheck.rows[0].term_ok) {
        return res.status(403).json({ success: false, message: "Class or term does not belong to your organization." });
      }

      // Tenant boundary: keep only student ids that belong to this class and org.
      const requestedStudentIds = Object.keys(attendance || {})
        .map(v => Number(v))
        .filter(v => Number.isInteger(v) && v > 0);
      const ownedStudentsRes = requestedStudentIds.length
        ? await db.query(
            `SELECT student_id FROM students
             WHERE student_id = ANY($1::int[]) AND class_id = $2 AND organization_id = $3`,
            [requestedStudentIds, classId, organizationId]
          )
        : { rows: [] };
      const ownedStudentIds = new Set(ownedStudentsRes.rows.map(r => Number(r.student_id)));

      await ensureAttendanceCalendarSchema(db);
      const attendanceCalendarProfile = await getAttendanceCalendarProfile(db, organizationId, termId);

      if (attendanceCalendarProfile) {
        const term = await getTermRecord(db, organizationId, termId);
        const termEndKey = term ? toDateKey(term.end_date) : null;
        const submittedDateKey = toDateKey(date);

        if (termEndKey && submittedDateKey && submittedDateKey === termEndKey) {
          // Official term end date is always allowed for marking.
        } else {
        const attendanceCalendarDays = term
          ? await getAttendanceCalendarDays(
              db,
              attendanceCalendarProfile.calendar_id,
              term.start_date,
              term.end_date
            )
          : [];
        const dayMap = buildCalendarDayMap(attendanceCalendarDays);
        const countable = isAttendanceCountableForDate(date, attendanceCalendarProfile, dayMap);

        if (!countable) {
          return res.status(400).json({
            success: false,
            message: "Attendance is disabled for this date by the term calendar settings.",
          });
        }
        }
      }

      await db.query("BEGIN");

      const touchedStudentIds = [];
      for (const studentId in attendance) {
        const status = attendance[studentId];
        const parsedStudentId = Number.parseInt(studentId, 10);
        if (!Number.isInteger(parsedStudentId) || !ownedStudentIds.has(parsedStudentId)) {
          continue; // skip foreign or unknown student ids
        }
        touchedStudentIds.push(parsedStudentId);

        // Tenant-safe UPSERT: the ON CONFLICT key (student_id, date, term_id)
        // is enforced as unique at the DB level, but because student/term ids
        // are now constrained above to this org, the conflict target cannot
        // legitimately collide with another org's row.
        await db.query(
          `
                    INSERT INTO attendance_records (student_id, date, status, class_id, term_id, marked_by, organization_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (student_id, date, term_id)
                    DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, updated_at = NOW()
                    WHERE attendance_records.organization_id = EXCLUDED.organization_id`,
          [
            parsedStudentId,
            date,
            status,
            classId,
            termId,
            req.session.userId,
            organizationId,
          ]
        );
      }

      await db.query("COMMIT");

      // Trigger parent absence-threshold checks in background; dedupe protects against duplicate sends.
      if (touchedStudentIds.length > 0) {
        setImmediate(() => {
          triggerAbsenceAlertsForStudents(db, organizationId, touchedStudentIds).catch((notifyError) => {
            console.error("[Attendance] Absence-threshold notification trigger failed:", notifyError.message);
          });
        });
      }

      res.json({ success: true });
    } catch (error) {
      await db.query("ROLLBACK");
      res
        .status(500)
        .json({ success: false, message: "Failed to save attendance" });
    }
  },

  createEmployeeGet: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "createEmployee");
      await ensurePermissionsSchema(db);
      await ensureClassDashboardLayoutSchema(db);

      const classesResult = await db.query(
        `SELECT * FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [req.session.organizationId]
      );

      const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
      const permissionOptions = setAssessmentQuestionsFeatureEnabled
        ? PERMISSION_OPTIONS
        : PERMISSION_OPTIONS.filter((option) => option.key !== PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
      const stripUnavailablePermissions = (permissions = []) =>
        setAssessmentQuestionsFeatureEnabled
          ? permissions
          : permissions.filter((permissionKey) => permissionKey !== PERMISSIONS.SET_ASSESSMENT_QUESTIONS);

      res.render("common/createEmployee", {
        title: "Create Employee",
        classes: classesResult.rows,
        permissionOptions,
        managerDefaultPermissions: stripUnavailablePermissions(getSuggestedPermissionsForRole("Manager")),
        roleDefaultPermissionsMap: {
          Manager: stripUnavailablePermissions(getSuggestedPermissionsForRole("Manager")),
          Teacher: stripUnavailablePermissions(mergePermissionsForRole("Teacher", [])),
          Supervisor: stripUnavailablePermissions(mergePermissionsForRole("Supervisor", [])),
          Driver: stripUnavailablePermissions(mergePermissionsForRole("Driver", [])),
        },
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (error) {
      req.flash("error", "Failed to load classes.");
      res.redirect("/common/manageEmployees");
    }
  },

  createEmployeePost: async (req, res, db) => {
    const isEmbedded = isEmbeddedRequest(req, "createEmployee");
    const createEmployeeRedirectUrl = isEmbedded ? "/common/createEmployee?embed=workspace" : "/common/createEmployee";
    const { firstName, lastName, email, account_type, dateOfBirth } = req.body;

    let classes = req.body.classes || [];
    let subjects = req.body.subjects || [];
    // Drivers can be assigned classes (e.g. which routes/classes they cover)
    // but must never be assigned subjects.
    if (account_type === "Driver") subjects = [];
    const mailroomScope = req.body.mailroomScope === "classes" ? "classes" : "all";
    let mailroomClassIds = req.body.mailroomClassIds || [];
    const requestorRole = req.session.userRole;
    const requestorId = req.session.user?.user_id || req.session.userId || null;
    const organizationId = req.session.organizationId;
    const requestedPermissions = normalizePermissionsList(req.body.permissions);
    const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
    const featureFilteredPermissions = setAssessmentQuestionsFeatureEnabled
      ? requestedPermissions
      : requestedPermissions.filter((permissionKey) => permissionKey !== PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
    const highRiskPermissions = new Set([
      PERMISSIONS.MANAGE_EMPLOYEES,
      PERMISSIONS.MANAGE_SETTINGS,
      PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS,
      PERMISSIONS.APPROVE_PROMOTIONS,
      PERMISSIONS.MANAGE_BILLING,
    ]);

    if (!Array.isArray(classes)) classes = [classes];
    if (!Array.isArray(subjects)) subjects = [subjects];

    if (!firstName || !lastName || !email || !account_type) {
      req.flash("error", "All fields are required.");
      return res.redirect(createEmployeeRedirectUrl);
    }

    const requestorRoleName = String(requestorRole || "").trim();
    const canAssignSensitivePermissions =
      isManagerLikeRole(requestorRole) || requestorRoleName === "Manager";

    if (account_type === "Manager" && !canAssignSensitivePermissions) {
      req.flash("error", "Only managers can create manager accounts.");
      return res.redirect(createEmployeeRedirectUrl);
    }

    const sanitizedRequestedPermissions = canAssignSensitivePermissions
      ? featureFilteredPermissions
      : featureFilteredPermissions.filter((permission) => !highRiskPermissions.has(permission));

    // Persist exactly what was selected in the form (after safety filtering)
    // so the permission page remains authoritative for every employee role.
    // Drivers are restricted to the student roster only — no other
    // permission can be granted to them from this form, even if requested.
    const effectivePermissions = account_type === "Driver"
      ? sanitizedRequestedPermissions.filter((permission) => permission === PERMISSIONS.MANAGE_STUDENTS)
      : sanitizedRequestedPermissions;

    // Mailroom scope is a separate marker, not a checkbox in the permission
    // list — "all" means every guardian contact org-wide; "classes" means
    // only guardians of students in the classes picked below.
    if (effectivePermissions.includes(PERMISSIONS.MAILROOM) && mailroomScope === "all") {
      effectivePermissions.push(MAILROOM_ALL_ACCESS_KEY);
    }
    if (!Array.isArray(mailroomClassIds)) mailroomClassIds = [mailroomClassIds];

    // ─── Step 1: Ensure schema using the POOL (not a transaction client) to
    //             avoid locking issues that cause the request to hang. ────────
    try {
      await ensureUserBirthdaySchema(db);
      await ensurePermissionsSchema(db);
      await ensureUserMailroomClassesSchema(db);
    } catch (schemaErr) {
      req.flash("error", "Database schema error: " + schemaErr.message);
      return res.redirect(createEmployeeRedirectUrl);
    }

    // ─── Step 2: Acquire a connection from the pool ──────────────────────────
    let client;
    try {
      client = await db.connect();
    } catch (connErr) {
      req.flash("error", "Could not connect to the database. Please try again.");
      return res.redirect(createEmployeeRedirectUrl);
    }

    try {
      // ─── Step 3: Check for duplicate email ────────────────────────────────
      await client.query("BEGIN");

      const emailCheckResult = await client.query(
        `SELECT email FROM users WHERE LOWER(email) = LOWER($1)
         UNION
         SELECT email FROM organizations WHERE LOWER(email) = LOWER($1)`,
        [email]
      );

      if (emailCheckResult.rows.length > 0) {
        req.flash("error", "This email is already in use by another user or organization.");
        await client.query("ROLLBACK");
        return res.redirect(createEmployeeRedirectUrl);
      }

      // ─── Step 4: Generate token ───────────────────────────────────────────
      const token = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const tokenExpiration = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      // ─── Step 5: Insert user ──────────────────────────────────────────────
      const result = await client.query(
        `INSERT INTO users (
           first_name, last_name, email, account_type, date_of_birth, organization_id,
           created_at, updated_at, reset_password_token, reset_password_expires
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, $8)
         RETURNING user_id`,
        [firstName, lastName, email, account_type, dateOfBirth || null, req.session.organizationId, hashedToken, tokenExpiration]
      );
      const userId = result.rows[0].user_id;

      // ─── Step 6: Assign classes ───────────────────────────────────────────
      const normalizedClassIds = [...new Set(
        classes.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
      )];
      const normalizedSubjectIds = [...new Set(
        subjects.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
      )];
      // Tenant boundary: only assign classes/subjects that belong to this org.
      const ownedClassesCE = normalizedClassIds.length
        ? await client.query(
            `SELECT class_id FROM classes WHERE class_id = ANY($1::int[]) AND organization_id = $2`,
            [normalizedClassIds, req.session.organizationId]
          )
        : { rows: [] };
      const safeClassIds = ownedClassesCE.rows.map(r => Number(r.class_id));
      const ownedSubjectsCE = normalizedSubjectIds.length
        ? await client.query(
            `SELECT subject_id FROM subjects WHERE subject_id = ANY($1::int[]) AND organization_id = $2`,
            [normalizedSubjectIds, req.session.organizationId]
          )
        : { rows: [] };
      const safeSubjectIds = ownedSubjectsCE.rows.map(r => Number(r.subject_id));

      if (safeClassIds.length > 0) {
        await client.query(
          `INSERT INTO user_classes (user_id, class_id, main)
           SELECT $1, unnest($2::int[]), FALSE`,
          [userId, safeClassIds]
        );
      }

      if (safeSubjectIds.length > 0) {
        await client.query(
          `INSERT INTO user_subjects (user_id, subject_id)
           SELECT $1, unnest($2::int[])
           ON CONFLICT (user_id, subject_id) DO NOTHING`,
          [userId, safeSubjectIds]
        );
      }

      // ─── Step 6b: Mailroom class scope (only when restricted, not all-access) ──
      if (effectivePermissions.includes(PERMISSIONS.MAILROOM) && mailroomScope === "classes") {
        const normalizedMailroomClassIds = [...new Set(
          mailroomClassIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
        )];
        const ownedMailroomClassesCE = normalizedMailroomClassIds.length
          ? await client.query(
              `SELECT class_id FROM classes WHERE class_id = ANY($1::int[]) AND organization_id = $2`,
              [normalizedMailroomClassIds, req.session.organizationId]
            )
          : { rows: [] };
        const safeMailroomClassIds = ownedMailroomClassesCE.rows.map((r) => Number(r.class_id));
        if (safeMailroomClassIds.length > 0) {
          await client.query(
            `INSERT INTO user_mailroom_classes (user_id, class_id)
             SELECT $1, unnest($2::int[])
             ON CONFLICT (user_id, class_id) DO NOTHING`,
            [userId, safeMailroomClassIds]
          );
        }
      }

      // ─── Step 7: Save permissions ─────────────────────────────────────────
      if (effectivePermissions.length > 0) {
          await client.query(
          `INSERT INTO user_permissions (user_id, organization_id, permission_key, granted_by)
           SELECT $1, $2, unnest($3::text[]), $4
           ON CONFLICT (user_id, organization_id, permission_key) DO UPDATE
           SET granted_by = EXCLUDED.granted_by
             `,
          [userId, organizationId, effectivePermissions, requestorId]
        );
      }

      // ─── Step 8: Commit ───────────────────────────────────────────────────
      const baseUrl = req.protocol + "://" + req.get("host");
      const setPasswordUrl = `${baseUrl}/common/set-password?token=${token}`;
      const organizationName = req.session.organizationName;

      await client.query("COMMIT");
      invalidateUserPermissionCache(organizationId, userId);

      setImmediate(async () => {
        try {
          const { classNames, subjectNames } = await resolveAssignmentNames(db, normalizedClassIds, normalizedSubjectIds);
          await sendInviteEmail(email, firstName, lastName, setPasswordUrl, organizationName, organizationId, classNames, subjectNames);
        } catch (_) {
          // Best-effort email send should never block creation flow.
        }
      });

      req.flash("success", "Employee created successfully. Password invite is being sent now.");
      res.redirect(createEmployeeRedirectUrl);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      req.flash("error", "Failed to create employee: " + error.message);
      res.redirect(createEmployeeRedirectUrl);
    } finally {
      client.release();
    }
  },

  setPasswordGet: async (req, res, db) => {
    const { token, type } = req.query;

    const renderInvalid = (reason) =>
      res.status(400).render("common/setPassword", {
        title: "Invite Link Problem",
        invalid: true,
        reason,
        user: null,
        token: "",
        type: type || "",
        messages: req.flash(),
      });

    if (!token) {
      return renderInvalid(
        "This invite link is missing its security token. Please open the full link directly from your invite email."
      );
    }

    try {
      const tokenResult = await db.query(
        `SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1`,
        [token]
      );

      const tokenRow = tokenResult.rows[0] || null;

      if (tokenRow && new Date(tokenRow.expires_at) < new Date()) {
        return renderInvalid(
          "This invite link has expired. Please ask your administrator to resend the invite."
        );
      }

      const resetTokenUserId = tokenRow ? String(tokenRow.user_id || "") : "";

      // Guardian token from password_reset_tokens table
      if (tokenRow && (type === 'guardian' || resetTokenUserId.startsWith('guardian_'))) {
        const user_id = resetTokenUserId;
        const guardianId = user_id.replace('guardian_', '');
        const guardianResult = await db.query(
          `SELECT gp.first_name, gp.last_name, gp.email, ga.login_email, ga.login_phone, o.organization_name
           FROM guardian_profiles gp
           JOIN guardian_accounts ga ON ga.guardian_id = gp.guardian_id
           JOIN organizations o ON o.organization_id = gp.organization_id
           WHERE gp.guardian_id = $1`,
          [guardianId]
        );

        if (guardianResult.rows.length === 0) {
          return renderInvalid(
            "We couldn't find the account for this invite link. Please ask your administrator to resend the invite."
          );
        }

        const guardian = guardianResult.rows[0];
        const user = {
          first_name: guardian.first_name,
          last_name: guardian.last_name,
          email: guardian.login_email || guardian.email,
          role: 'Guardian',
          organization: guardian.organization_name
        };

        return res.render("common/setPassword", {
          title: "Set Your Password",
          user,
          token,
          type: 'guardian',
          messages: req.flash(),
        });
      }

      // Student token from password_reset_tokens table
      if (tokenRow && (type === 'student' || resetTokenUserId.startsWith('student_'))) {
        const studentId = resetTokenUserId.replace('student_', '');
        await ensureStudentPortalSchema(db);

        const studentResult = await db.query(
          `SELECT s.first_name, s.last_name, s.email, sa.login_email, o.organization_name
           FROM students s
           JOIN organizations o ON o.organization_id = s.organization_id
           LEFT JOIN student_accounts sa ON sa.student_id = s.student_id AND sa.organization_id = s.organization_id
           WHERE s.student_id = $1
           LIMIT 1`,
          [studentId]
        );

        if (studentResult.rows.length === 0) {
          return renderInvalid(
            "We couldn't find the student account for this invite link. Please ask your school to resend the invite."
          );
        }

        const student = studentResult.rows[0];
        const user = {
          first_name: student.first_name,
          last_name: student.last_name,
          email: student.login_email || student.email,
          role: 'Student',
          organization: student.organization_name,
        };

        return res.render("common/setPassword", {
          title: "Set Your Password",
          user,
          token,
          type: 'student',
          messages: req.flash(),
        });
      }

      // Staff employee invite token from users table
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const result = await db.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type AS role,
                o.organization_name AS organization
         FROM users u
         LEFT JOIN organizations o ON o.organization_id = u.organization_id
         WHERE u.reset_password_token = $1 AND u.reset_password_expires > NOW()`,
        [hashedToken]
      );

      if (result.rows.length === 0) {
        return renderInvalid(
          "This invite link is invalid, has expired, or has already been used. If you have already set your password, please log in."
        );
      }

      const user = result.rows[0];

      res.render("common/setPassword", {
        title: "Set Your Password",
        user,
        token,
        type: 'staff',
        messages: req.flash(),
      });
        } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "An error occurred. Please try again.");
      res.redirect("/account/login");
        }
  },

  setPasswordPost: async (req, res, db) => {
    const { token, password, confirmPassword, type } = req.body;

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect(`/common/set-password?token=${token}&type=${type || ''}`);
    }

    if (password.length < 6) {
      req.flash("error", "Password must be at least 6 characters long.");
      return res.redirect(`/common/set-password?token=${token}&type=${type || ''}`);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const tokenResult = await db.query(
        `SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1`,
        [token]
      );

      const tokenRow = tokenResult.rows[0] || null;
      const resetTokenUserId = tokenRow ? String(tokenRow.user_id || "") : "";
      const isGuardianToken = Boolean(tokenRow && (type === 'guardian' || resetTokenUserId.startsWith('guardian_')));
      const isStudentToken = Boolean(tokenRow && (type === 'student' || resetTokenUserId.startsWith('student_')));

      if (tokenRow && new Date(tokenRow.expires_at) < new Date()) {
        req.flash("error", "Token has expired. Please ask your school administrator to send a new password setup link.");
        if (isGuardianToken) return res.redirect("/account/guardian-login");
        if (isStudentToken) return res.redirect("/account/student-login");
        return res.redirect("/account/login");
      }

      // Handle guardian password setup/reset from password_reset_tokens table
      if (isGuardianToken) {
        const guardianId = resetTokenUserId.replace('guardian_', '');

        // Update guardian account password. The WHERE uses guardian_id which may match
        // multiple rows (one per org) – that is intentional; all of the guardian's
        // accounts get the same password so they can log in to any linked school.
        const updateResult = await db.query(
          `UPDATE guardian_accounts
           SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW()
           WHERE guardian_id = $2
           RETURNING guardian_id, login_email, login_phone`,
          [hashedPassword, guardianId]
        );

        if (updateResult.rowCount === 0) {
          // Guard account may have been deleted; attempt a graceful recovery.
          // Re-fetch the guardian profile so we can show a useful error.
          req.flash("error", "Guardian account not found. Please ask your school administrator to resend the password setup link.");
          return res.redirect("/account/guardian-login");
        }

        // Delete the used token
        await db.query(`DELETE FROM password_reset_tokens WHERE token = $1`, [token]);

        req.flash("success", "Password set successfully! You can now log in to the Parent Portal.");
        return res.redirect("/account/guardian-login");
      }

      // Handle student password setup/reset from password_reset_tokens table
      if (isStudentToken) {
        const studentId = resetTokenUserId.replace('student_', '');
        await ensureStudentPortalSchema(db);

        const updateResult = await db.query(
          `UPDATE student_accounts
           SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW()
           WHERE student_id = $2
           RETURNING student_id`,
          [hashedPassword, studentId]
        );

        if (updateResult.rowCount === 0) {
          req.flash("error", "Student account not found. Please ask your school to resend the password setup link.");
          return res.redirect("/account/student-login");
        }

        await db.query(`DELETE FROM password_reset_tokens WHERE token = $1`, [token]);

        req.flash("success", "Password set successfully! You can now log in to the Student Portal.");
        return res.redirect("/account/student-login");
      }

      // Handle staff employee invite tokens stored in users table
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const result = await db.query(
        `UPDATE users
         SET password = $1, reset_password_token = NULL, reset_password_expires = NULL
         WHERE reset_password_token = $2 AND reset_password_expires > NOW()
         RETURNING first_name, last_name, email, organization_id`,
        [hashedPassword, hashedToken]
      );

      if (result.rowCount === 0) {
        req.flash("error", "Invalid or expired token.");
        return res.redirect("/account/login");
      }

      const { first_name, last_name, email, organization_id } = result.rows[0];

      // Send success email to the user
      await sendPasswordSetSuccessEmail(email, first_name, last_name, organization_id);

      req.flash("success", "Password set successfully. You can now log in.");
      res.redirect("/account/login");
        } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "An error occurred. Please try again.");
      res.redirect(`/common/set-password?token=${token}&type=${type || ''}`);
        }
  },

  getEmployeeDetails: async (req, res, db) => {
    try {
      const requesterId = req.session.user?.user_id || req.session.userId || null;
      const userId = req.query.userId || requesterId;
      const organizationId = req.session.organizationId;
      const requesterRole = req.session.userRole;

      if (!userId) {
        req.flash("error", "Employee ID is required.");
        return res.redirect("/common/orgDashboard");
      }

      const canManageEmployees = await userHasPermission(
        db,
        { userId: requesterId, userRole: requesterRole, organizationId },
        PERMISSIONS.MANAGE_EMPLOYEES
      );

      if (!canManageEmployees && String(userId) !== String(requesterId)) {
        req.flash("error", "You do not have permission to view this employee.");
        return res.redirect("/common/orgDashboard");
      }

      // Basic employee info
      let employeeResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type
         FROM users 
         WHERE user_id = $1 AND organization_id = $2`,
        [userId, organizationId]
      );

      let employee;
      let isManager = false;

      if (employeeResult.rows.length > 0) {
        employee = employeeResult.rows[0];
        employee.image_url = "/images/profilePlaceholder.png";

        // 🔥 Fetch classes and subjects assigned to this user
        const classSubjectsResult = await db.query(
          `
          SELECT c.class_id, c.class_name, s.subject_id, s.subject_name
          FROM user_classes uc
          JOIN classes c ON uc.class_id = c.class_id
          JOIN subjects s ON s.class_id = c.class_id
          JOIN user_subjects us ON us.subject_id = s.subject_id AND us.user_id = uc.user_id
          WHERE uc.user_id = $1
          ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC, s.subject_name
          `,
          [userId]
        );

        // 🔥 Group by classes and subjects
        const classesMap = {};
        classSubjectsResult.rows.forEach((row) => {
          if (!classesMap[row.class_id]) {
            classesMap[row.class_id] = {
              class_id: row.class_id,
              class_name: row.class_name,
              subjects: [],
            };
          }
          classesMap[row.class_id].subjects.push({
            subject_id: row.subject_id,
            subject_name: row.subject_name,
          });
        });

        employee.classes = Object.values(classesMap);
      } else {
        // Manager logic
        const orgResult = await db.query(
          `SELECT 
             o.organization_id AS user_id,
             o.first_name,
             o.last_name,
             o.email,
             'Manager' AS account_type,
             o.organization_name,
             o.nickname,
             p.plan_name
           FROM organizations o
           LEFT JOIN plans p ON o.plan_id = p.id
           WHERE o.organization_id = $1`,
          [userId]
        );

        if (orgResult.rows.length === 0) {
          req.flash("error", "Employee not found.");
          return res.redirect("/common/manageEmployees");
        }

        employee = orgResult.rows[0];
        employee.image_url = "/images/profilePlaceholder.png";
        employee.classes = [];
        isManager = true;
      }

      res.render("common/employeeDetails", {
        employee,
        isManager,
        title: "Employee Details",
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
        loggedInUserId: requesterId,
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Could not load employee details.");
      res.redirect("/common/manageEmployees");
    }
  },

  manageEmployees: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "manageEmployees");
      await ensurePermissionsSchema(db);
      await ensureClassDashboardLayoutSchema(db);

      const orgOwnerResult = await db.query(
        `
          SELECT organization_id, first_name, last_name, email, password
          FROM organizations
          WHERE organization_id = $1
          LIMIT 1
        `,
        [req.session.organizationId]
      );

      if (orgOwnerResult.rows.length > 0) {
        const orgOwner = orgOwnerResult.rows[0];
        const ownerEmail = String(orgOwner.email || "").trim();

        if (ownerEmail) {
          const existingOwnerUser = await db.query(
            `
              SELECT user_id, account_type
              FROM users
              WHERE organization_id = $1
                AND LOWER(email) = LOWER($2)
              ORDER BY user_id ASC
              LIMIT 1
            `,
            [req.session.organizationId, ownerEmail]
          );

          if (existingOwnerUser.rows.length > 0) {
            await db.query(
              `
                UPDATE users
                SET first_name = $1,
                    last_name = $2,
                    email = $3,
                    account_type = 'Manager',
                    updated_at = NOW()
                WHERE user_id = $4
              `,
              [
                orgOwner.first_name,
                orgOwner.last_name,
                orgOwner.email,
                existingOwnerUser.rows[0].user_id,
              ]
            );
          } else {
            await db.query(
              `
                INSERT INTO users (
                  organization_id, email, first_name, last_name, password, account_type, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, 'Manager', NOW(), NOW())
              `,
              [
                req.session.organizationId,
                orgOwner.email,
                orgOwner.first_name,
                orgOwner.last_name,
                orgOwner.password || null,
              ]
            );
          }
        }
      }

      // Basic employee info (with class IDs)
      const employeeNameSortExpression = buildNameSortExpression(req.session?.nameDisplayFormat, "u");
      const result = await db.query(
        `
          SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type,
                 u.reset_password_token, u.password, array_agg(uc.class_id) as class_ids
          FROM users u
          LEFT JOIN user_classes uc ON u.user_id = uc.user_id
          WHERE u.organization_id = $1
          GROUP BY u.user_id
          ORDER BY ${employeeNameSortExpression}
        `,
        [req.session.organizationId]
      );

      const classesResult = await db.query(
        `SELECT * FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [req.session.organizationId]
      );

      const permissionsResult = await db.query(
        `
          SELECT user_id, permission_key
          FROM user_permissions
          WHERE organization_id = $1
        `,
        [req.session.organizationId]
      );

      const permissionsByUser = permissionsResult.rows.reduce((acc, row) => {
        if (!acc[row.user_id]) acc[row.user_id] = [];
        acc[row.user_id].push(row.permission_key);
        return acc;
      }, {});

      const permissionLabelMap = PERMISSION_OPTIONS.reduce((acc, option) => {
        acc[option.key] = option.label;
        return acc;
      }, {});

      const employees = result.rows;

      for (let employee of employees) {
        const classIds = employee.class_ids || [];
        employee.permissions = permissionsByUser[employee.user_id] || [];

        // 🔥 Fetch only the classes assigned to this employee
        const classesQuery = await db.query(
          `SELECT class_id, class_name
           FROM classes
           WHERE class_id = ANY($1)
             AND organization_id = $2
           ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
          [classIds, req.session.organizationId]
        );
        const classes = classesQuery.rows;

        // 🔥 Fetch subjects only for the assigned classes
        const subjectsQuery = await db.query(
          `
            SELECT s.subject_id, s.subject_name, s.class_id
            FROM user_subjects us
            JOIN subjects s ON us.subject_id = s.subject_id
            WHERE us.user_id = $1 AND s.class_id = ANY($2)
          `,
          [employee.user_id, classIds]
        );

        // 🔥 Group subjects by class_id
        const classMap = new Map();
        classes.forEach((cls) => {
          classMap.set(cls.class_id, {
            class_id: cls.class_id,
            class_name: cls.class_name,
            subjects: [],
          });
        });

        subjectsQuery.rows.forEach((sub) => {
          const targetClass = classMap.get(sub.class_id);
          if (targetClass) {
            targetClass.subjects.push({
              subject_id: sub.subject_id,
              subject_name: sub.subject_name,
            });
          }
        });

        // Preserve dashboard arrangement order from the classes query.
        employee.classes = Array.from(classMap.values());
      }

      res.render("common/manageEmployees", {
        title: "Manage Employees",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        employees: employees,
        permissionLabelMap,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
      });
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to load employees.");
      res.redirect("/common/createEmployee");
    }
  },

  toggleHoldEmployee: async (req, res, db) => {
    const { userId } = req.params;
    const isEmbedded = isEmbeddedRequest(req, "modifyEmployee");
    const modifyEmployeeRedirectUrl = `/common/modifyEmployee?userId=${userId}${isEmbedded ? "&embed=workspace" : ""}`;
    try {
      const result = await db.query(
        "UPDATE users SET on_hold = NOT on_hold WHERE user_id = $1 AND organization_id = $2 RETURNING on_hold",
        [userId, req.session.organizationId]
      );
      const onHold = result.rows[0].on_hold;
      const newStatus = onHold ? "on hold" : "resumed";

      // Notify the employee (email)
      notifyEmployeeOnHoldChange(db, {
        organizationId: req.session.organizationId,
        userId,
        onHold,
      }).catch(err => console.error("[Notify] Hold/resume notification failed:", err.message));

      // E1/E2 — in-app notification to the affected employee
      notifSvc.createNotification(db, {
        orgId: Number(req.session.organizationId),
        recipientType: 'staff',
        recipientId: Number(userId),
        type: onHold ? 'employee_on_hold' : 'employee_resumed',
        title: onHold ? 'Account put on hold' : 'Account hold removed',
        body: onHold ? 'Contact your administrator.' : 'Your access has been restored.',
        link: null,
      }).catch(err => console.error('[Notif] hold change failed:', err.message));

      req.flash("success", `Employee has been ${newStatus}.`);
      res.redirect(modifyEmployeeRedirectUrl);
    } catch (error) {
      // ...removed error log for clean background operation...
      req.flash("error", "Failed to update employee status.");
      res.redirect(modifyEmployeeRedirectUrl);
    }
  },

  modifyEmployeeGet: async (req, res, db) => {
    const { userId } = req.query;
    const isEmbedded = isEmbeddedRequest(req, "modifyEmployee");

    if (!userId) {
      res.status(400).send("User ID is required.");
      return;
    }

    try {
      await ensureUserBirthdaySchema(db);
      await ensurePermissionsSchema(db);
      await ensureUserMailroomClassesSchema(db);
      await ensureClassDashboardLayoutSchema(db);
      const userResult = await db.query(
        "SELECT * FROM users WHERE user_id = $1 AND organization_id = $2",
        [userId, req.session.organizationId]
      );
      if (userResult.rows.length === 0) {
        res.status(404).send("User not found.");
        return;
      }
      const user = userResult.rows[0];

      const classesResult = await db.query(
        `
                SELECT c.class_id, c.class_name
                FROM classes c
                WHERE c.organization_id = $1
                ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC`,
        [req.session.organizationId]
      );

      const subjectsResult = await db.query(
        `
          SELECT subject_id, subject_name, class_id
          FROM subjects
          WHERE organization_id = $1
          ORDER BY class_id ASC, subject_name ASC
        `,
        [req.session.organizationId]
      );

      const classMap = new Map(
        classesResult.rows.map((cls) => [cls.class_id, { ...cls, subjects: [] }])
      );

      subjectsResult.rows.forEach((subject) => {
        const targetClass = classMap.get(subject.class_id);
        if (targetClass) {
          targetClass.subjects.push(subject);
        }
      });

      const classes = Array.from(classMap.values());

      const enrolledSubjectsResult = await db.query(
        `
                SELECT us.subject_id
                FROM user_subjects us
                WHERE us.user_id = $1`,
        [userId]
      );
      const enrolledSubjects = enrolledSubjectsResult.rows.map(
        (subject) => subject.subject_id
      );

      const employeeClassesResult = await db.query(
        `
                SELECT class_id
                FROM user_classes
                WHERE user_id = $1`,
        [userId]
      );
      const enrolledClasses = employeeClassesResult.rows.map(
        (cls) => cls.class_id
      );

      const rawSelectedPermissions = await getUserPermissions(
        db,
        userId,
        req.session.organizationId
      );

      const mailroomClassesResult = await db.query(
        `SELECT class_id FROM user_mailroom_classes WHERE user_id = $1`,
        [userId]
      );
      const enrolledMailroomClasses = mailroomClassesResult.rows.map((row) => row.class_id);
      const mailroomScope = rawSelectedPermissions.includes(MAILROOM_ALL_ACCESS_KEY) ? "all" : "classes";

      const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
      const permissionOptions = setAssessmentQuestionsFeatureEnabled
        ? PERMISSION_OPTIONS
        : PERMISSION_OPTIONS.filter((option) => option.key !== PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
      const stripUnavailablePermissions = (permissions = []) =>
        setAssessmentQuestionsFeatureEnabled
          ? permissions
          : permissions.filter((permissionKey) => permissionKey !== PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
      const selectedPermissions = stripUnavailablePermissions(rawSelectedPermissions);

      res.render("common/modifyEmployee", {
        title: "Modify Employee",
        user,
        classes,
        enrolledClasses,
        enrolledSubjects,
        enrolledMailroomClasses,
        mailroomScope,
        permissionOptions,
        managerDefaultPermissions: stripUnavailablePermissions(getSuggestedPermissionsForRole("Manager")),
        roleDefaultPermissionsMap: {
          Manager: stripUnavailablePermissions(mergePermissionsForRole("Manager", [])),
          Teacher: stripUnavailablePermissions(mergePermissionsForRole("Teacher", [])),
          Supervisor: stripUnavailablePermissions(mergePermissionsForRole("Supervisor", [])),
          Driver: stripUnavailablePermissions(mergePermissionsForRole("Driver", [])),
        },
        selectedPermissions,
        messages: req.flash(),
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (error) {
            res.status(500).send("Failed to load employee details.");
    }
  },

  modifyEmployeePost: async (req, res, db) => {
    const { userId } = req.params;
    const isEmbedded = isEmbeddedRequest(req, "modifyEmployee");
    const {
      firstName,
      lastName,
      email,
      accountType,
      dateOfBirth,
      classIds = [],
      subjects: rawSubjects = [],
      mailroomClassIds = [],
    } = req.body;
    // Drivers can be assigned classes but must never be assigned subjects.
    const subjects = accountType === "Driver" ? [] : rawSubjects;
    const mailroomScope = req.body.mailroomScope === "classes" ? "classes" : "all";
    const requestorRole = req.session.userRole;
    const requestorId = req.session.user?.user_id || req.session.userId || null;
    const organizationId = req.session.organizationId;
    const wantsJson =
      req.xhr ||
      String(req.headers.accept || "").toLowerCase().includes("application/json");
    const respondModifyEmployeeError = (statusCode, message, redirectPath) => {
      if (wantsJson) {
        return res.status(statusCode).json({ success: false, error: message });
      }
      req.flash("error", message);
      const fallbackPath = `/common/modifyEmployee?userId=${userId}${isEmbedded ? "&embed=workspace" : ""}`;
      return res.redirect(redirectPath || fallbackPath);
    };
    const respondModifyEmployeeSuccess = (message) => {
      req.flash("success", message);
      if (wantsJson) {
        return res.status(200).json({ success: true, message });
      }
      return res.redirect("/common/manageEmployees");
    };
    const requestedPermissions = normalizePermissionsList(req.body.permissions);
    const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
    const featureFilteredPermissions = setAssessmentQuestionsFeatureEnabled
      ? requestedPermissions
      : requestedPermissions.filter((permissionKey) => permissionKey !== PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
    const highRiskPermissions = new Set([
      PERMISSIONS.MANAGE_EMPLOYEES,
      PERMISSIONS.MANAGE_SETTINGS,
      PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS,
      PERMISSIONS.APPROVE_PROMOTIONS,
      PERMISSIONS.MANAGE_BILLING,
    ]);

    const requestorRoleName = String(requestorRole || "").trim();
    const canAssignSensitivePermissions =
      isManagerLikeRole(requestorRole) || requestorRoleName === "Manager";

    if (!accountType) {
      return respondModifyEmployeeError(400, "Please select a role for this employee.");
    }

    if (accountType === "Manager" && !canAssignSensitivePermissions) {
      return respondModifyEmployeeError(403, "Only managers can assign manager role.");
    }

    const sanitizedRequestedPermissions = canAssignSensitivePermissions
      ? featureFilteredPermissions
      : featureFilteredPermissions.filter((permission) => !highRiskPermissions.has(permission));

    // Persist exactly what was selected in the form (after safety filtering).
    // Drivers are restricted to the student roster only.
    const effectivePermissions = accountType === "Driver"
      ? sanitizedRequestedPermissions.filter((permission) => permission === PERMISSIONS.MANAGE_STUDENTS)
      : sanitizedRequestedPermissions;

    // Mailroom scope is a separate marker, not a checkbox in the permission
    // list — "all" means every guardian contact org-wide; "classes" means
    // only guardians of students in the classes picked below.
    if (effectivePermissions.includes(PERMISSIONS.MAILROOM) && mailroomScope === "all") {
      effectivePermissions.push(MAILROOM_ALL_ACCESS_KEY);
    }

    // Guard: session must have organizationId or the INSERT will fail
    if (!organizationId) {
      return respondModifyEmployeeError(401, "Session error: please log in again.", "/account/login");
    }

    const normalizedClassIds = [...new Set(
      (Array.isArray(classIds) ? classIds : classIds ? [classIds] : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )];
    const normalizedSubjectIds = [...new Set(
      (Array.isArray(subjects) ? subjects : subjects ? [subjects] : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )];
    const normalizedMailroomClassIds = [...new Set(
      (Array.isArray(mailroomClassIds) ? mailroomClassIds : mailroomClassIds ? [mailroomClassIds] : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )];

    const client = await db.connect();

    try {
      await ensureUserBirthdaySchema(client);
      await ensureUserMailroomClassesSchema(client);
      // BEGIN immediately — every exit path below reaches the catch which ROLLBACKs
      await client.query("BEGIN");

      const currentUserResult = await client.query(
        `SELECT email
         FROM users
         WHERE user_id = $1 AND organization_id = $2`,
        [userId, organizationId]
      );
      if (currentUserResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return respondModifyEmployeeError(404, "Employee not found.", "/common/manageEmployees");
      }

      const currentEmail = currentUserResult.rows[0].email;

      if (email !== currentEmail) {
        const emailCheckResult = await client.query(
          `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND user_id != $2
           UNION
           SELECT 1 FROM organizations WHERE LOWER(email) = LOWER($1)`,
          [email, userId]
        );
        if (emailCheckResult.rows.length > 0) {
          await client.query("ROLLBACK");
          return respondModifyEmployeeError(
            409,
            "Email already in use by another user or organization. Please use a different email."
          );
        }
      }

      await client.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, email = $3, account_type = $4, date_of_birth = $5, updated_at = NOW()
         WHERE user_id = $6 AND organization_id = $7`,
        [firstName, lastName, email, accountType, dateOfBirth || null, userId, organizationId]
      );

      await client.query("DELETE FROM user_classes WHERE user_id = $1", [userId]);
      // Tenant boundary: only reassign classes that belong to this org.
      const ownedClassesME = normalizedClassIds.length
        ? await client.query(
            `SELECT class_id FROM classes WHERE class_id = ANY($1::int[]) AND organization_id = $2`,
            [normalizedClassIds, organizationId]
          )
        : { rows: [] };
      const safeClassIdsMod = ownedClassesME.rows.map(r => Number(r.class_id));
      if (safeClassIdsMod.length > 0) {
        await client.query(
          `INSERT INTO user_classes (user_id, class_id, main)
           SELECT $1, unnest($2::int[]), FALSE`,
          [userId, safeClassIdsMod]
        );
      }

      await client.query("DELETE FROM user_subjects WHERE user_id = $1", [userId]);
      const ownedSubjectsME = normalizedSubjectIds.length
        ? await client.query(
            `SELECT subject_id FROM subjects WHERE subject_id = ANY($1::int[]) AND organization_id = $2`,
            [normalizedSubjectIds, organizationId]
          )
        : { rows: [] };
      const safeSubjectIdsMod = ownedSubjectsME.rows.map(r => Number(r.subject_id));
      if (safeSubjectIdsMod.length > 0) {
        await client.query(
          `INSERT INTO user_subjects (user_id, subject_id)
           SELECT $1, unnest($2::int[])
           ON CONFLICT (user_id, subject_id) DO NOTHING`,
          [userId, safeSubjectIdsMod]
        );
      }

      // Mailroom class scope — always cleared first (covers the case where
      // mailroom was revoked, or scope switched to "all"), then re-synced
      // only when the employee still has mailroom AND is restricted to
      // specific classes rather than org-wide access.
      await client.query("DELETE FROM user_mailroom_classes WHERE user_id = $1", [userId]);
      if (effectivePermissions.includes(PERMISSIONS.MAILROOM) && mailroomScope === "classes" && normalizedMailroomClassIds.length) {
        const ownedMailroomClassesME = await client.query(
          `SELECT class_id FROM classes WHERE class_id = ANY($1::int[]) AND organization_id = $2`,
          [normalizedMailroomClassIds, organizationId]
        );
        const safeMailroomClassIdsMod = ownedMailroomClassesME.rows.map((r) => Number(r.class_id));
        if (safeMailroomClassIdsMod.length > 0) {
          await client.query(
            `INSERT INTO user_mailroom_classes (user_id, class_id)
             SELECT $1, unnest($2::int[])
             ON CONFLICT (user_id, class_id) DO NOTHING`,
            [userId, safeMailroomClassIdsMod]
          );
        }
      }

      // ✅ Replace permissions — hard DELETE for this user+org, then fresh INSERT
      //    No ON CONFLICT needed: DELETE cleared our rows; a plain INSERT is cleaner
      //    and avoids masking cross-org uniqueness constraint issues.
      await client.query(
        "DELETE FROM user_permissions WHERE user_id = $1 AND organization_id = $2",
        [userId, organizationId]
      );

      if (effectivePermissions.length > 0) {
        await client.query(
          `INSERT INTO user_permissions (user_id, organization_id, permission_key, granted_by)
           SELECT $1, $2, unnest($3::text[]), $4
           RETURNING permission_key`,
          [userId, organizationId, effectivePermissions, requestorId]
        );
      }

      await client.query("COMMIT");
      invalidateUserPermissionCache(organizationId, userId);

      const requestorIdNumber = Number(requestorId);
      const editedUserIdNumber = Number(userId);
      if (Number.isInteger(requestorIdNumber) && Number.isInteger(editedUserIdNumber) && requestorIdNumber === editedUserIdNumber) {
        req.session.userRole = accountType;
        req.session.firstName = firstName;
        req.session.lastName = lastName;

        const sessionAccountType = String(req.session.accountType || '').trim().toLowerCase();
        if (!['organization', 'hub'].includes(sessionAccountType)) {
          req.session.accountType = accountType;
        }

        if (req.session.user && typeof req.session.user === 'object') {
          req.session.user.account_type = accountType;
          req.session.user.first_name = firstName;
          req.session.user.last_name = lastName;
          req.session.user.email = email;
        }
      }

      return respondModifyEmployeeSuccess("Employee details updated successfully.");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return respondModifyEmployeeError(
        500,
        "Failed to update employee details: " + error.message
      );
    } finally {
      client.release();
    }
  },

  assessment: async function (req, res, db) {
    const { classId, subjectId } = req.query;
    const requestedTermId = Number.parseInt(req.query.termId || req.session.currentTermId, 10);
    const isEmbedded = String(req.query.embed || '').toLowerCase() === 'workspace';

    if (!classId || !subjectId) {
      return res
        .status(400)
        .send("Class ID and Subject ID are required for the assessment.");
    }

    try {
      await ensureAssessmentControlSchema(db);
      await ensureScoreRemarkGradeSchema(db);
      await ensureGoogleIntegrationSchema(db);
      const organizationId = req.session.organizationId;
      const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      const canManageGoogleIntegration = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.MANAGE_SETTINGS
      );
      const canSetAssessmentQuestions = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.SET_ASSESSMENT_QUESTIONS
      );
      const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);

      // Validate `organizationId`
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/common/orgDashboard");
      }

      // Resolve term context: prefer requested/session term, otherwise fall back to DB current term.
      let currentTerm = null;
      if (Number.isInteger(requestedTermId)) {
        const requestedTermResult = await db.query(
          `
                SELECT term_id, term_name, start_date, end_date
                FROM terms
                WHERE term_id = $1 AND organization_id = $2
                LIMIT 1
            `,
          [requestedTermId, organizationId]
        );
        currentTerm = requestedTermResult.rows[0] || null;
      }

      if (!currentTerm) {
        const currentTermResult = await db.query(
          `
                SELECT t.term_id, t.term_name, t.start_date, t.end_date
                FROM terms t
                JOIN school_years sy ON t.school_year_id = sy.id
                WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
                LIMIT 1
            `,
          [organizationId]
        );

        if (currentTermResult.rows.length === 0) {
          req.flash("error", "No current school year or term found.");
          return res.redirect("/common/manageRecords");
        }

        currentTerm = currentTermResult.rows[0];
      }
      req.session.currentTermId = currentTerm.term_id;

      // Fetch the class name and subject name
      const classNameResult = await db.query(
        "SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2",
        [classId, organizationId]
      );
      const subjectNameResult = await db.query(
        "SELECT subject_name FROM subjects WHERE subject_id = $1 AND organization_id = $2",
        [subjectId, organizationId]
      );

      if (
        classNameResult.rows.length === 0 ||
        subjectNameResult.rows.length === 0
      ) {
        return res.status(404).send("Class or Subject not found.");
      }

      const className = classNameResult.rows[0].class_name;
      const subjectName = subjectNameResult.rows[0].subject_name;

      // Fetch students enrolled in the class for the current term
      const studentsResult = await db.query(
        `
                SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.gender
                FROM students s
                JOIN enrolled_students es ON s.student_id = es.student_id
                JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                WHERE es.class_id = $1
                  AND e.term_id = $2
                  AND e.organization_id = $3
                  AND s.organization_id = $3
                  AND s.graduated = FALSE
                ORDER BY s.last_name ASC, s.first_name ASC
            `,
        [classId, currentTerm.term_id, organizationId]
      );

      const students = studentsResult.rows;

      const noStudentsUrl = `/common/admissions?panel=create-student&page=${encodeURIComponent("/common/addStudent")}&label=${encodeURIComponent("Add New Student")}`;
      if (students.length === 0) {
        req.flash(
          "error",
          `No students found for this class in the current term. Go to Admissions to add a new student.`
        );
      }

      // Fetch assessments for the class, subject, and term
      const assessmentsResult = await db.query(
        `
                SELECT assessment_id, group_id, title, weight, max_score, category,
                       COALESCE(scale_base, 100) AS scale_base,
                      COALESCE(open_book, FALSE) AS open_book,
                      time_limit_minutes,
                       COALESCE(is_locked, FALSE) AS is_locked,
                       COALESCE(is_active, TRUE) AS is_active,
                    COALESCE(show_question_set_on_dashboard, FALSE) AS show_question_set_on_dashboard,
                       edit_window_start,
                       edit_window_end
                FROM assessments
                WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3 AND term_id = $4
                ORDER BY assessment_id
            `,
        [subjectId, classId, organizationId, currentTerm.term_id]
      );

      const assessments = assessmentsResult.rows.map((assessmentRow) => {
        const editability = computeAssessmentEditability(assessmentRow);
        return {
          ...assessmentRow,
          can_edit_scores: editability.canEdit,
          access_reason: editability.reason,
        };
      });

      const manageAssessmentUrl = `/common/manageAssessment?organizationId=${organizationId}&termId=${currentTerm.term_id}`;
      const noAssessmentsUrl = `/common/management?panel=assessment-scores&page=${encodeURIComponent(manageAssessmentUrl)}&label=${encodeURIComponent("Assessments")}`;
      if (assessments.length === 0) {
        req.flash(
          "error",
          "No assessments found for the current term, subject, and class. Go to Management Tools to add assessments."
        );
      }

      // Fetch scores and positions for the students in this subject
      const resultsResult = await db.query(
        `
                SELECT ar.assessment_id,
                       ar.student_id,
                       ar.score,
                       sp.position
                FROM assessment_results ar
                LEFT JOIN student_positions sp
                ON ar.student_id = sp.student_id AND ar.subject_id = sp.subject_id
                WHERE ar.assessment_id IN (
                    SELECT assessment_id
                    FROM assessments
                    WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3 AND term_id = $4
                )
                AND ar.student_id IN (
                    SELECT es.student_id
                    FROM enrolled_students es
                    JOIN enrollments e ON es.enrollment_id = e.enrollment_id
                    WHERE es.class_id = $2 AND e.term_id = $4 AND e.organization_id = $3
                )
                ORDER BY ar.student_id, ar.assessment_id
            `,
        [subjectId, classId, organizationId, currentTerm.term_id]
      );

      const results = resultsResult.rows;
      const maxScoreByAssessmentId = new Map(
        assessments.map((assessmentRow) => [
          Number(assessmentRow.assessment_id),
          Number(assessmentRow.max_score || 0),
        ])
      );

      // Organize the scores by student and populate total scores and other details
      const studentScores = {};
      results.forEach((result) => {
        if (!studentScores[result.student_id]) {
          studentScores[result.student_id] = {
            assessments: {},
            total_subject_score: 0,
            total_percentage: null,
            grade: '-',
            position: result.position,
            max_total_score: 0,
          };
        }
        studentScores[result.student_id].assessments[result.assessment_id] = result.score;
        if (result.score !== null && result.score !== undefined && result.score !== '') {
          const numericScore = Number(result.score);
          const numericMax = maxScoreByAssessmentId.get(Number(result.assessment_id)) || 0;
          studentScores[result.student_id].total_subject_score += numericScore;
          studentScores[result.student_id].max_total_score += numericMax;
        }
      });

      for (const [studentIdKey, summary] of Object.entries(studentScores)) {
        if (summary.max_total_score > 0) {
          summary.total_percentage = (summary.total_subject_score / summary.max_total_score) * 100;
          summary.grade = await getGradeLabelFromScoreRemark(
            db,
            organizationId,
            classId,
            currentTerm.term_id,
            summary.total_percentage
          );
        }
      }

      students.forEach((student) => {
        student.scores = studentScores[student.student_id]
          ? studentScores[student.student_id].assessments
          : {};
        student.total_subject_score = studentScores[student.student_id]
          ? studentScores[student.student_id].total_subject_score
          : "-";
        student.total_percentage = studentScores[student.student_id]
          ? studentScores[student.student_id].total_percentage
          : "-";
        student.grade = studentScores[student.student_id]
          ? studentScores[student.student_id].grade
          : "-";
        student.position = studentScores[student.student_id]
          ? studentScores[student.student_id].position
          : "-";
      });

      // Fetch employees assigned to the class
      const employeesResult = await db.query(
        `
                SELECT u.first_name, u.last_name, uc.main
                FROM user_classes uc
                JOIN users u ON uc.user_id = u.user_id
                WHERE uc.class_id = $1 AND u.organization_id = $2
            `,
        [classId, organizationId]
      );

      const employees = employeesResult.rows;

      const scaleBase = assessments.length > 0 ? (assessments[0].scale_base || 100) : 100;
      const maxPossibleScore = assessments.reduce((sum, a) => sum + parseFloat(a.max_score || 0), 0);
      const questionSetEnabledAssessmentIds = assessments
        .filter((row) => Boolean(row.show_question_set_on_dashboard))
        .map((row) => Number(row.assessment_id))
        .filter((value) => Number.isInteger(value) && value > 0);
      const canShowQuestionSetControls =
        assessments.length > 0 &&
        canUseQuestionSetIntegration &&
        setAssessmentQuestionsFeatureEnabled &&
        canSetAssessmentQuestions;
      let hasQuestionSets = false;
      try {
        const assessmentIds = canShowQuestionSetControls ? questionSetEnabledAssessmentIds : [];

        if (assessmentIds.length) {
          const questionSetCountResult = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM assessment_question_sets
             WHERE organization_id = $1
               AND term_id = $2
               AND class_id = $3
               AND subject_id = $4
               AND assessment_id = ANY($5::int[])`,
            [organizationId, currentTerm.term_id, classId, subjectId, assessmentIds]
          );
          hasQuestionSets = Number(questionSetCountResult.rows[0]?.total || 0) > 0;
        }
      } catch (_) {
        hasQuestionSets = false;
      }

      // Render the assessment page
      res.render("common/assessment", {
        title: "Assessment",
        classId,
        className,
        subjectId,
        subjectName,
        currentTerm,
        assessments,
        hasEditableAssessments: assessments.some((assessmentRow) => assessmentRow.can_edit_scores),
        students,
        noStudentsUrl,
        noAssessmentsUrl,
        employees,
        scaleBase,
        maxPossibleScore,
        hasQuestionSets,
        canShowQuestionSetControls,
        canSetAssessmentQuestions,
        setAssessmentQuestionsFeatureEnabled,
        isEmbedded,
        canUseGoogleClassroom: googleIntegration.shouldShowFeatures,
        canUseQuestionSetIntegration,
        canManageGoogleIntegration,
        messages: req.flash(),
        hideGlobalHeader: true,
        hideGlobalFooter: true,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (err) {
            res.status(500).send("Error fetching assessment data.");
    }
  },

  updateStudentPositions: async function (
    db,
    subjectId,
    organizationId,
    classId,
    termId
  ) {
    const updateQuery = `
            WITH RankedScores AS (
                SELECT
                    student_id,
                    subject_id,
                    SUM(score) AS total_subject_score,
                    RANK() OVER (PARTITION BY subject_id ORDER BY SUM(score) DESC) AS position
                FROM assessment_results
                WHERE subject_id = $1 AND organization_id = $2
                GROUP BY student_id, subject_id
            )
            INSERT INTO student_positions (student_id, subject_id, organization_id, total_subject_score, position, class_id, term_id)
            SELECT 
                rs.student_id,
                rs.subject_id,
                $2,
                rs.total_subject_score,
                rs.position,
                $3,
                $4
            FROM RankedScores rs
            ON CONFLICT (student_id, subject_id) DO UPDATE
            SET 
                total_subject_score = EXCLUDED.total_subject_score,
                position = EXCLUDED.position,
                class_id = EXCLUDED.class_id,
                term_id = EXCLUDED.term_id;
        `;

    try {
      await db.query(updateQuery, [subjectId, organizationId, classId, termId]);
    } catch (error) {
            throw error;
    }
  },

  saveAllScores: async function (req, res, db) {
    const { subjectId, classId } = req.query;
    const { scores } = req.body;
    const requestedTermId = Number.parseInt(req.query.termId || req.session.currentTermId, 10);

    if (!subjectId || !classId) {
      res.status(400).send("Subject ID and Class ID are required.");
      return;
    }

    const organizationId = req.session.organizationId;

    try {
      let currentTermId = Number.isInteger(requestedTermId) ? requestedTermId : null;
      if (!currentTermId) {
        const termResult = await db.query(
          `
                SELECT t.term_id
                FROM terms t
                JOIN classes c ON t.organization_id = c.organization_id
                WHERE c.class_id = $1 AND t.organization_id = $2 AND t.current = TRUE
                LIMIT 1
            `,
          [classId, organizationId]
        );

        if (termResult.rows.length === 0) {
          res.status(404).send("No current term found for this class.");
          return;
        }

        currentTermId = termResult.rows[0].term_id;
      }
      req.session.currentTermId = currentTermId;

      await ensureAssessmentControlSchema(db);

      const submittedAssessmentIds = Array.from(
        new Set(
          Object.values(scores || {}).flatMap((studentScores) =>
            Object.keys(studentScores || {})
              .map((assessmentId) => Number(assessmentId))
              .filter((assessmentId) => Number.isInteger(assessmentId) && assessmentId > 0)
          )
        )
      );

      // Tenant boundary: only keep student ids that belong to (classId, org).
      // Without this, a foreign student_id could be inserted into this org's
      // assessment_results table.
      const requestedStudentIds = Object.keys(scores || {})
        .map(v => Number(v))
        .filter(v => Number.isInteger(v) && v > 0);
      const ownedStudentsRes = requestedStudentIds.length
        ? await db.query(
            `SELECT student_id FROM students
             WHERE student_id = ANY($1::int[]) AND class_id = $2 AND organization_id = $3`,
            [requestedStudentIds, classId, organizationId]
          )
        : { rows: [] };
      const ownedStudentIds = new Set(ownedStudentsRes.rows.map(r => Number(r.student_id)));

      const assessmentControlResult = await db.query(
        `
          SELECT assessment_id, title, weight, max_score, category,
                 COALESCE(is_locked, FALSE) AS is_locked,
                 COALESCE(is_active, TRUE) AS is_active,
                 edit_window_start,
                 edit_window_end
          FROM assessments
          WHERE assessment_id = ANY($1::int[])
            AND class_id = $2
            AND subject_id = $3
            AND organization_id = $4
            AND term_id = $5
        `,
        [submittedAssessmentIds.length ? submittedAssessmentIds : [0], classId, subjectId, organizationId, currentTermId]
      );

      const assessmentControlMap = new Map();
      assessmentControlResult.rows.forEach((assessmentRow) => {
        assessmentControlMap.set(
          Number(assessmentRow.assessment_id),
          {
            ...assessmentRow,
            ...computeAssessmentEditability(assessmentRow),
          }
        );
      });

      const blockedAssessmentTitles = new Set();
      Object.values(scores || {}).forEach((studentScores) => {
        Object.entries(studentScores || {}).forEach(([assessmentId, scoreValue]) => {
          if (scoreValue === null || scoreValue === "") return;
          const control = assessmentControlMap.get(Number(assessmentId));
          if (control && !control.canEdit) {
            blockedAssessmentTitles.add(`${control.title} (${control.reason})`);
          }
        });
      });

      if (blockedAssessmentTitles.size > 0) {
        return res.status(403).json({
          error: `This assessment is currently not editable: ${Array.from(blockedAssessmentTitles).join(", ")}`,
        });
      }

      await db.query("BEGIN");

      // Insert or update scores for each student
      for (let studentId in scores) {
        const parsedStudentId = Number(studentId);
        if (!Number.isInteger(parsedStudentId) || !ownedStudentIds.has(parsedStudentId)) {
          continue; // skip foreign or unknown students
        }
        let totalScore = 0;
        let maxTotalScore = 0; // Maximum possible score
        const categoryScoresMap = {}; // To store total scores for each category

        for (let assessmentId in scores[studentId]) {
          let score = scores[studentId][assessmentId];

          const assessmentControl = assessmentControlMap.get(Number(assessmentId));
          if (!assessmentControl || !assessmentControl.canEdit) continue;

          if (score === null || score === "") {
            // Score was cleared — delete the existing row so it doesn't reappear
            await db.query(
              `DELETE FROM assessment_results WHERE student_id = $1 AND assessment_id = $2`,
              [studentId, assessmentId]
            );
            continue;
          }

          const { max_score, category } = assessmentControl;

          totalScore += parseFloat(score);
          maxTotalScore += parseFloat(max_score);

          // Insert or update the score in the assessment_results table
          await db.query(
            `
                            INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, term_id, organization_id, class_id, category)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                            ON CONFLICT (student_id, assessment_id)
                            DO UPDATE SET 
                                score = EXCLUDED.score,
                                term_id = EXCLUDED.term_id,
                                subject_id = EXCLUDED.subject_id,
                                organization_id = EXCLUDED.organization_id,
                                class_id = EXCLUDED.class_id,
                                category = EXCLUDED.category
                        `,
            [
              studentId,
              assessmentId,
              score,
              subjectId,
              currentTermId,
              organizationId,
              classId,
              category,
            ]
          );

          // Update categoryScoresMap for each category
          if (!categoryScoresMap[category]) {
            categoryScoresMap[category] = 0;
          }
          categoryScoresMap[category] += parseFloat(score);
        }

        // Calculate total percentage based on the scores achieved vs. the maximum possible score
        const totalPercentage =
          maxTotalScore > 0 ? (totalScore / maxTotalScore) * 100 : null;

        // Calculate grade
        const grade =
          totalPercentage !== null
            ? await getGradeLabelFromScoreRemark(
                db,
                organizationId,
                classId,
                currentTermId,
                totalPercentage
              )
            : "-";

        // Save total_subject_score, total_percentage, and grade in assessment_results table
        await db.query(
          `
                    UPDATE assessment_results
                    SET total_subject_score = $1,
                        total_percentage = $2,
                        grade = $3
                    WHERE student_id = $4 AND subject_id = $5 AND term_id = $6 AND class_id = $7
                `,
          [
            totalScore,
            totalPercentage,
            grade,
            studentId,
            subjectId,
            currentTermId,
            classId,
          ]
        );

        // Insert or update category scores in the category_scores table
        for (let category in categoryScoresMap) {
          const totalCategoryScore = categoryScoresMap[category];

          await db.query(
            `
                        INSERT INTO category_scores (student_id, class_id, subject_id, organization_id, category, total_score, term_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (student_id, class_id, subject_id, organization_id, category, term_id)
                        DO UPDATE SET 
                            total_score = EXCLUDED.total_score
                    `,
            [
              studentId,
              classId,
              subjectId,
              organizationId,
              category,
              totalCategoryScore,
              currentTermId,
            ]
          );
        }
      }

      // Update student positions after scores are updated
      await this.updateStudentPositions(
        db,
        subjectId,
        organizationId,
        classId,
        currentTermId
      );

      await db.query("COMMIT");
      req.flash("success", "Scores and grades saved successfully.");
      res
        .status(200)
        .json({ success: true, message: "Scores saved successfully." });
    } catch (error) {
      await db.query("ROLLBACK");
            req.flash(
        "error",
        "An error occurred while saving scores. Please try again."
      );
      res.status(500).json({
        error: "An error occurred while saving scores. Please try again.",
      });
    }
  },

  getAssessmentQuestionSets: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const questionSetId = req.query.questionSetId ? Number(req.query.questionSetId) : null;
    const classId = Number(req.query.classId);
    const subjectId = Number(req.query.subjectId);
    const termId = Number(req.query.termId || req.session.currentTermId);
    const assessmentId = req.query.assessmentId ? Number(req.query.assessmentId) : null;

    if (!organizationId || !Number.isInteger(classId) || !Number.isInteger(subjectId) || !Number.isInteger(termId)) {
      return res.status(400).json({ success: false, error: "classId, subjectId, and termId are required." });
    }

    try {
      await ensureAssessmentControlSchema(db);
      await ensureGoogleIntegrationSchema(db);
      await ensureAssessmentQuestionSetReviewSchema(db);

      let selectedAssessmentRule = null;
      if (Number.isInteger(assessmentId) && assessmentId > 0) {
        const assessmentRuleResult = await db.query(
          `SELECT
             assessment_id,
             title,
             weight,
             max_score,
             category,
             COALESCE(scale_base, 100) AS scale_base,
             COALESCE(open_book, FALSE) AS open_book,
             time_limit_minutes,
             GREATEST(COALESCE(max_attempts, 1), 1) AS max_attempts,
             COALESCE(is_locked, FALSE) AS is_locked,
             COALESCE(is_active, TRUE) AS is_active,
             COALESCE(show_question_set_on_dashboard, FALSE) AS show_question_set_on_dashboard,
             edit_window_start,
             edit_window_end
           FROM assessments
           WHERE organization_id = $1
             AND term_id = $2
             AND class_id = $3
             AND subject_id = $4
             AND assessment_id = $5
           LIMIT 1`,
          [organizationId, termId, classId, subjectId, assessmentId]
        );

        if (assessmentRuleResult.rows.length) {
          const row = assessmentRuleResult.rows[0];
          if (!row.show_question_set_on_dashboard) {
            selectedAssessmentRule = null;
          } else {
          const editability = computeAssessmentEditability(row);
          selectedAssessmentRule = {
            assessmentId: row.assessment_id,
            termId: Number(termId),
            classId: Number(classId),
            subjectId: Number(subjectId),
            title: row.title,
            weight: Number(row.weight || 0),
            maxScore: Number(row.max_score || 0),
            category: row.category || "Assessment",
            scaleBase: Number(row.scale_base || 100),
            openBook: Boolean(row.open_book),
            timeLimitMinutes: row.time_limit_minutes !== null && row.time_limit_minutes !== undefined
              ? Number(row.time_limit_minutes)
              : null,
            maxAttempts: Number(row.max_attempts || 1),
            canEditScores: Boolean(editability.canEdit),
            accessReason: editability.reason || "",
            isLocked: Boolean(row.is_locked),
            isActive: Boolean(row.is_active),
            editWindowStart: row.edit_window_start,
            editWindowEnd: row.edit_window_end,
          };
          }
        }
      }

      let params;
      let whereClause;

      if (Number.isInteger(questionSetId) && questionSetId > 0) {
        params = [organizationId, questionSetId];
        whereClause = `
          qs.organization_id = $1
          AND qs.question_set_id = $2
        `;
      } else {
        params = [organizationId, termId, classId, subjectId];
        whereClause = `
          qs.organization_id = $1
          AND qs.term_id = $2
          AND qs.class_id = $3
          AND qs.subject_id = $4
          AND EXISTS (
            SELECT 1
            FROM assessments a2
            WHERE a2.assessment_id = qs.assessment_id
              AND a2.organization_id = qs.organization_id
              AND COALESCE(a2.show_question_set_on_dashboard, FALSE) = TRUE
          )
        `;
        if (Number.isInteger(assessmentId) && assessmentId > 0) {
          params.push(assessmentId);
          whereClause += ` AND qs.assessment_id = $5`;
        }
      }

      const setsResult = await db.query(
        `SELECT
           qs.question_set_id,
           qs.assessment_id,
           qs.group_id,
           qs.set_title,
           qs.set_description,
           qs.question_card_layout,
           qs.total_points,
           qs.is_active,
           qs.review_status,
           qs.review_note,
           qs.reviewed_at,
           qs.submitted_at,
           qs.created_at,
           qs.updated_at,
           a.title AS assessment_title,
           CONCAT(COALESCE(ru.first_name, ''), CASE WHEN ru.last_name IS NOT NULL AND ru.last_name <> '' THEN ' ' || ru.last_name ELSE '' END) AS reviewed_by_name
         FROM assessment_question_sets qs
         LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id
         LEFT JOIN users ru ON ru.user_id = qs.reviewed_by AND ru.organization_id = qs.organization_id
         WHERE ${whereClause}
         ORDER BY qs.updated_at DESC, qs.question_set_id DESC`,
        params
      );

      const setIds = setsResult.rows.map((row) => Number(row.question_set_id)).filter(Boolean);
      const questionsResult = setIds.length
        ? await db.query(
            `SELECT
               question_id,
               question_set_id,
               question_type,
               question_text,
               options_json,
              options_layout,
               answer_key,
               marks,
               position_index
             FROM assessment_questions
             WHERE question_set_id = ANY($1::int[])
             ORDER BY question_set_id ASC, position_index ASC, question_id ASC`,
            [setIds]
          )
        : { rows: [] };

      const questionsBySet = new Map();
      questionsResult.rows.forEach((row) => {
        const key = Number(row.question_set_id);
        if (!questionsBySet.has(key)) questionsBySet.set(key, []);
        questionsBySet.get(key).push({
          questionId: row.question_id,
          questionType: row.question_type,
          questionText: row.question_text,
          options: Array.isArray(row.options_json) ? row.options_json : [],
          optionLayout: String(row.options_layout || 'stacked').toLowerCase() === 'side_by_side' ? 'side_by_side' : 'stacked',
          answerKey: row.answer_key || "",
          marks: Number(row.marks || 0),
          positionIndex: Number(row.position_index || 0),
        });
      });

      const sets = setsResult.rows.map((row) => ({
        questionSetId: row.question_set_id,
        assessmentId: row.assessment_id,
        assessmentTitle: row.assessment_title || "Assessment",
        groupId: row.group_id,
        setTitle: row.set_title,
        setDescription: row.set_description || "",
        questionCardLayout: String(row.question_card_layout || 'stacked').toLowerCase() === 'side_by_side' ? 'side_by_side' : 'stacked',
        totalPoints: Number(row.total_points || 0),
        isActive: Boolean(row.is_active),
        reviewStatus: String(row.review_status || "pending").toLowerCase(),
        reviewNote: row.review_note || "",
        reviewedAt: row.reviewed_at,
        submittedAt: row.submitted_at,
        reviewedByName: String(row.reviewed_by_name || "").trim(),
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        questions: questionsBySet.get(Number(row.question_set_id)) || [],
      }));

      return res.json({ success: true, sets, assessment: selectedAssessmentRule });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Failed to load question sets." });
    }
  },

  upsertAssessmentQuestionSet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const actorUserId = req.session.userId || req.session.user?.user_id || null;
    const requestedClassId = Number(req.body.classId);
    const requestedSubjectId = Number(req.body.subjectId);
    const requestedTermId = Number(req.body.termId || req.session.currentTermId);
    const assessmentId = Number(req.body.assessmentId);
    const questionSetId = req.body.questionSetId ? Number(req.body.questionSetId) : null;
    const setTitle = String(req.body.setTitle || "").trim();
    const setDescription = String(req.body.setDescription || "").trim();
    const questionCardLayoutRaw = String(req.body.questionCardLayout || "").trim().toLowerCase();
    const questionCardLayout = questionCardLayoutRaw === 'side_by_side' ? 'side_by_side' : 'stacked';
    const hasOpenBookSetting = Object.prototype.hasOwnProperty.call(req.body || {}, "openBook");
    const hasTimeLimitSetting = Object.prototype.hasOwnProperty.call(req.body || {}, "timeLimitMinutes");
    const hasMaxAttemptsSetting = Object.prototype.hasOwnProperty.call(req.body || {}, "maxAttempts");
    const parsedOpenBookSetting = parseBooleanValue(req.body.openBook, false);
    const parsedTimeLimitValue = Number.parseInt(req.body.timeLimitMinutes, 10);
    const parsedTimeLimitSetting = Number.isInteger(parsedTimeLimitValue) && parsedTimeLimitValue > 0
      ? parsedTimeLimitValue
      : null;
    const parsedMaxAttemptsValue = Number.parseInt(req.body.maxAttempts, 10);
    const parsedMaxAttemptsSetting = Number.isInteger(parsedMaxAttemptsValue) && parsedMaxAttemptsValue > 0
      ? parsedMaxAttemptsValue
      : 1;
    const questions = normalizeQuestionPayload(req.body.questions || []);

    if (!organizationId || !Number.isInteger(assessmentId)) {
      return res.status(400).json({ success: false, error: "assessmentId is required." });
    }
    if (!setTitle) {
      return res.status(400).json({ success: false, error: "Set title is required." });
    }
    if (!questions.length) {
      return res.status(400).json({ success: false, error: "Add at least one question." });
    }

    const client = await db.connect();
    try {
      await ensureAssessmentControlSchema(client);
      await ensureGoogleIntegrationSchema(client);
      await ensureAssessmentQuestionSetReviewSchema(client);
      await client.query("BEGIN");

      const assessmentResult = await client.query(
        `SELECT assessment_id, group_id, class_id, subject_id, term_id,
                COALESCE(open_book, FALSE) AS open_book,
                time_limit_minutes,
                GREATEST(COALESCE(max_attempts, 1), 1) AS max_attempts,
                COALESCE(show_question_set_on_dashboard, FALSE) AS show_question_set_on_dashboard
         FROM assessments
         WHERE assessment_id = $1
           AND organization_id = $2
         LIMIT 1`,
        [assessmentId, organizationId]
      );

      if (!assessmentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Assessment not found." });
      }

      const assessmentRow = assessmentResult.rows[0];
      const isEditingExistingSet = Number.isInteger(questionSetId) && questionSetId > 0;
      if (!assessmentRow.show_question_set_on_dashboard && !isEditingExistingSet) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          success: false,
          error: "Question sets are disabled for this assessment. Turn on question sets for this assessment to create a new set.",
        });
      }
      const classId = Number(assessmentRow.class_id || requestedClassId || 0);
      const subjectId = Number(assessmentRow.subject_id || requestedSubjectId || 0);
      const termId = Number(assessmentRow.term_id || requestedTermId || 0);

      if (Number.isInteger(requestedClassId) && requestedClassId > 0 && requestedClassId !== classId) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Selected class does not match this assessment." });
      }
      if (Number.isInteger(requestedSubjectId) && requestedSubjectId > 0 && requestedSubjectId !== subjectId) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Selected subject does not match this assessment." });
      }
      if (Number.isInteger(requestedTermId) && requestedTermId > 0 && requestedTermId !== termId) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Selected school year/term does not match this assessment." });
      }

      if (!Number.isInteger(classId) || classId <= 0 || !Number.isInteger(subjectId) || subjectId <= 0 || !Number.isInteger(termId) || termId <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Assessment scope is incomplete." });
      }

      if (hasOpenBookSetting || hasTimeLimitSetting || hasMaxAttemptsSetting) {
        await client.query(
          `UPDATE assessments
           SET open_book = $1,
               time_limit_minutes = $2,
               max_attempts = $3
           WHERE assessment_id = $4
             AND organization_id = $5`,
          [
            hasOpenBookSetting ? parsedOpenBookSetting : Boolean(assessmentRow.open_book),
            hasTimeLimitSetting ? parsedTimeLimitSetting : assessmentRow.time_limit_minutes,
            hasMaxAttemptsSetting ? parsedMaxAttemptsSetting : Number(assessmentRow.max_attempts || 1),
            assessmentId,
            organizationId,
          ]
        );
      }

      const totalPoints = questions.reduce((sum, item) => sum + Number(item.marks || 0), 0);

      let resolvedQuestionSetId = null;

      if (Number.isInteger(questionSetId) && questionSetId > 0) {
        const existingTargetResult = await client.query(
          `SELECT question_set_id, review_status
           FROM assessment_question_sets
           WHERE question_set_id = $1
             AND organization_id = $2
             AND assessment_id = $3
             AND class_id = $4
             AND subject_id = $5
             AND term_id = $6
             AND retake_student_id IS NULL
           LIMIT 1`,
          [questionSetId, organizationId, assessmentId, classId, subjectId, termId]
        );

        if (!existingTargetResult.rows.length) {
          await client.query("ROLLBACK");
          return res.status(404).json({ success: false, error: "Question set not found for this assessment." });
        }

        await client.query(
          `UPDATE assessment_question_sets
           SET term_id = $1,
               class_id = $2,
               subject_id = $3,
               assessment_id = $4,
               group_id = $5,
               set_title = $6,
               set_description = $7,
               question_card_layout = $8,
               total_points = $9,
               updated_by = $10,
               updated_at = NOW()
           WHERE question_set_id = $11
             AND organization_id = $12`,
          [
            termId,
            classId,
            subjectId,
            assessmentId,
            assessmentRow.group_id || null,
            setTitle,
            setDescription || null,
            questionCardLayout,
            totalPoints,
            actorUserId,
            questionSetId,
            organizationId,
          ]
        );

        resolvedQuestionSetId = questionSetId;
      } else {
        const existingSetResult = await client.query(
          `SELECT question_set_id, review_status
           FROM assessment_question_sets
           WHERE organization_id = $1
             AND term_id = $2
             AND class_id = $3
             AND subject_id = $4
             AND assessment_id = $5
             AND retake_student_id IS NULL
           ORDER BY question_set_id DESC
           LIMIT 1`,
          [organizationId, termId, classId, subjectId, assessmentId]
        );

        if (existingSetResult.rows.length > 0) {
          const existing = existingSetResult.rows[0];
          const existingQuestionSetId = Number(existing.question_set_id);

          await client.query(
            `UPDATE assessment_question_sets
             SET group_id = $1,
                 set_title = $2,
                 set_description = $3,
                 question_card_layout = $4,
                 total_points = $5,
                 updated_by = $6,
                 updated_at = NOW()
             WHERE question_set_id = $7
               AND organization_id = $8`,
            [
              assessmentRow.group_id || null,
              setTitle,
              setDescription || null,
              questionCardLayout,
              totalPoints,
              actorUserId,
              existingQuestionSetId,
              organizationId,
            ]
          );

          resolvedQuestionSetId = existingQuestionSetId;
        } else {
          const insertResult = await client.query(
            `INSERT INTO assessment_question_sets (
               organization_id,
               term_id,
               class_id,
               subject_id,
               assessment_id,
               group_id,
               set_title,
               set_description,
               total_points,
               review_status,
               submitted_at,
               created_by,
               updated_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), $10, $10)
             RETURNING question_set_id`,
            [
              organizationId,
              termId,
              classId,
              subjectId,
              assessmentId,
              assessmentRow.group_id || null,
              setTitle,
              setDescription || null,
              totalPoints,
              actorUserId,
            ]
          );

            await client.query(
              `UPDATE assessment_question_sets
               SET question_card_layout = $1
               WHERE question_set_id = $2
                 AND organization_id = $3`,
              [questionCardLayout, insertResult.rows[0].question_set_id, organizationId]
            );

          resolvedQuestionSetId = insertResult.rows[0].question_set_id;
        }
      }

      // assessment_questions -> student_assessment_responses is ON DELETE
      // CASCADE, so replacing a set's questions (always a full
      // delete-then-reinsert here) used to silently wipe any student's
      // already-submitted answers and manually-entered marks along with
      // the old rows, with zero check. Block instead - same principle as
      // the class/school-year/test delete guards.
      const attemptCount = await client.query(
        `SELECT COUNT(*)::int AS count FROM student_assessment_attempts WHERE question_set_id = $1`,
        [resolvedQuestionSetId]
      );
      if (Number(attemptCount.rows[0]?.count || 0) > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          error: "Cannot change this question set's questions because one or more students have already started or submitted an attempt on it. Use the retake/unlock flow for individual students instead, or create a new question set.",
        });
      }

      await client.query(
        `DELETE FROM assessment_questions WHERE question_set_id = $1`,
        [resolvedQuestionSetId]
      );

      for (const question of questions) {
        await client.query(
          `INSERT INTO assessment_questions (
             question_set_id,
             organization_id,
             question_type,
             question_text,
             options_json,
             options_layout,
             answer_key,
             marks,
             position_index
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
          [
            resolvedQuestionSetId,
            organizationId,
            question.questionType,
            question.questionText,
            JSON.stringify(question.options || []),
            String(question.optionLayout || '').toLowerCase() === 'side_by_side' ? 'side_by_side' : 'stacked',
            question.answerKey || null,
            question.marks,
            question.positionIndex,
          ]
        );
      }

      await client.query("COMMIT");

      try {
        const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
        if (googleIntegration.shouldShowFeatures) {
          await markGoogleSync(
            db,
            organizationId,
            "queued",
            "Question set changes detected. Google Classroom sync queued."
          );
        }
      } catch (_) {
      }

      return res.json({
        success: true,
        message: Number.isInteger(questionSetId) && questionSetId > 0
          ? "Question set updated and submitted for review."
          : "Question set submitted for review.",
        questionSetId: resolvedQuestionSetId,
        reviewStatus: "pending",
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
      }
      return res.status(500).json({ success: false, error: "Failed to save question set." });
    } finally {
      client.release();
    }
  },

  extractAssessmentQuestionsFromPdf: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const anthropicKey = String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
    const anthropicModel = String(process.env.ANTHROPIC_EXTRACTION_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-4-6").trim();

    if (!organizationId) {
      return res.status(401).json({ success: false, error: "Unauthorized request." });
    }
    const file = req.file;
    if (!file || !file.buffer || !file.buffer.length) {
      return res.status(400).json({ success: false, error: "Please upload a supported exam file." });
    }

    const mimeType = String(file.mimetype || "").toLowerCase();
    const fileName = String(file.originalname || "").toLowerCase();
    const isPdf = mimeType === "application/pdf" || fileName.endsWith(".pdf");
    const isDocx = mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx");
    const isDoc = mimeType === "application/msword" || fileName.endsWith(".doc");
    const isXlsx = mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || fileName.endsWith(".xlsx");
    const isXls = mimeType === "application/vnd.ms-excel" || fileName.endsWith(".xls");
    const isImage = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mimeType)
      || [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((ext) => fileName.endsWith(ext));

    if (!(isPdf || isDocx || isDoc || isXlsx || isXls || isImage)) {
      return res.status(400).json({
        success: false,
        error: "Unsupported file type. Please upload PDF, Word, Excel, or image files.",
      });
    }

    // Import-style parsing first (same server-side pattern as other imports).
    try {
      const extractedText = await extractTextFromExamFile(file);
      if (extractedText) {
        const localQuestions = parseQuestionsFromPlainText(extractedText);
        if (shouldAcceptLocalExtraction(localQuestions)) {
          return res.json({ success: true, questions: localQuestions });
        }
      }
    } catch (_) {
      // Non-fatal: if local parsing fails, optionally fall back to Anthropic.
    }

    if (!anthropicKey) {
      return res.status(422).json({
        success: false,
        error: "Import could not parse questions from this file. Try a cleaner PDF/image, or set ANTHROPIC_API_KEY for AI-assisted extraction.",
      });
    }

    const systemPrompt = `You are a precise exam paper parser. Your job is to extract questions from an exam paper and return them as a clean JSON array.

OUTPUT FORMAT:
Return ONLY a valid JSON array. No markdown, no backticks, no explanations, no preamble. Just the array.

EACH QUESTION OBJECT must have exactly these keys:
{
  "questionNumber": <integer, the printed question number e.g. 1, 2, 3>,
  "questionType": <string: "multiple_choice" | "single_choice" | "true_false" | "short_text" | "essay">,
  "questionText": <string: ONLY the question sentence itself — no section headers, no answer keys, no labels>,
  "options": <array of strings for MCQ/true_false/single_choice types; empty array [] for all others>,
  "answerKey": <string: the correct answer if shown with ✓; empty string "" if no answer given>,
  "marks": <number: extract from paper; default to 1 if not shown>
}

TYPE DETECTION:
- Labeled "MCQ" or "Multiple Choice" → "multiple_choice"
- Labeled "MULTI-SELECT" or "Multiple Select" → "multiple_choice" (allow multiple correct answers)
- Labeled "TRUE/FALSE" → "true_false"
- Labeled "FILL BLANK" or contains ___ → "short_text"
- Labeled "SHORT ANS" or "Short Answer" → "short_text"
- Labeled "ESSAY" → "essay"
- Labeled "MATCHING" → treat EACH ROW as its own "short_text" question with questionText = the Column A item only, and answerKey = the matching letter/answer shown

OPTION EXTRACTION RULES:
- For multiple_choice/single_choice: extract options as plain text e.g. ["Mercury", "Venus", "Mars", "Jupiter"]
- Do NOT include option letters (A, B, C, D) in the option text itself
- For true_false: always set options to ["True", "False"]
- For short_text/essay/fill_blank: set options to []

ANSWER KEY RULES:
- "✓ Answer: C. Mars" → answerKey = "Mars"
- "✓ Correct Answers: A, C, D (Red · Green · Blue)" → answerKey = "Red,Green,Blue"
- "✓ Model Answer: Democracy is..." → answerKey = "Democracy is a system of government in which citizens elect representatives to govern on their behalf."
- "✓ Marking Guide / Rubric: Key points..." → answerKey = "Key points: Law of Demand (inverse), Law of Supply (direct), equilibrium price."
- "Answer not provided — student to respond" → answerKey = ""
- No ✓ symbol present → answerKey = ""

WHAT TO SKIP (do not create questions for these):
- Section header lines like "A MULTIPLE CHOICE...", "B MULTIPLE SELECT...", "C TRUE/FALSE...", etc.
- Paper header lines like "Subject:", "Term:", "Time:", "Total:", "GENERAL INSTRUCTIONS:"
- Footer lines like "End of Paper"
- Blank lines, dashes, underscores used as answer lines
- Labels like "Response:", "Answer:", "Column A", "Column B" when they appear alone

MATCHING SECTION RULE (CRITICAL):
- The matching section has rows like: "25. Photosynthesis | A. Longest river in the world | D"
- Extract EACH ROW as a SEPARATE question
- questionNumber = the printed number (25, 26, 27...)
- questionText = ONLY the Column A item text (e.g. "Photosynthesis")
- options = [] (empty)
- answerKey = the letter shown in the Answer column (e.g. "D")
- marks = 1

QUESTION TEXT RULE (CRITICAL):
- questionText must contain ONLY the question sentence
- Do NOT include: option letters, answer keys, section codes, marks labels, column B content
- For fill-in-the-blank: keep the ___ in the text e.g. "The chemical formula for water is ___"
- Strip any trailing labels like "2mk", "4mk", "8mk" from the question text

NUMBERING:
- Use the exact printed question number
- This paper has questions 1 through 40 — extract ALL of them
- Do not skip any question, do not merge questions together
- Each question number must appear exactly once in the output`;

    try {
      const base64File = file.buffer.toString("base64");
      let requestContent = [];

      if (isPdf) {
        requestContent = [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64File,
            },
          },
          {
            type: "text",
            text: "Extract ALL questions from this exam paper (questions 1 through 40). Return ONLY the JSON array. Each question must be a separate object. Do NOT merge multiple questions into one. Do NOT include section headers as questions.",
          },
        ];
      } else if (isImage) {
        const normalizedImageMime = mimeType === "image/jpg" ? "image/jpeg" : (mimeType || "image/png");
        requestContent = [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: normalizedImageMime,
              data: base64File,
            },
          },
          {
            type: "text",
            text: "Extract ALL questions from this exam paper (questions 1 through 40). Return ONLY the JSON array. Each question must be a separate object. Do NOT merge multiple questions into one. Do NOT include section headers as questions.",
          },
        ];
      } else {
        let extractedText = "";

        if (isDocx || isDoc) {
          if (isDocx) {
            const mammoth = require("mammoth");
            const textResult = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = String(textResult?.value || "").trim();
          } else {
            requestContent = [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/msword",
                  data: base64File,
                },
              },
              {
                type: "text",
                text: "Extract ALL questions from this exam paper (questions 1 through 40). Return ONLY the JSON array. Each question must be a separate object. Do NOT merge multiple questions into one. Do NOT include section headers as questions.",
              },
            ];
          }
        } else if (isXlsx || isXls) {
          if (isXlsx) {
            const ExcelJS = require("exceljs");
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(file.buffer);

            const rows = [];
            workbook.eachSheet((sheet) => {
              rows.push("Sheet: " + sheet.name);
              sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                const values = Array.isArray(row.values)
                  ? row.values.slice(1).map((value) => String(value || "").trim()).filter(Boolean)
                  : [];
                if (values.length) {
                  rows.push("Row " + rowNumber + ": " + values.join(" | "));
                }
              });
            });
            extractedText = rows.join("\n").trim();
          } else {
            requestContent = [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/vnd.ms-excel",
                  data: base64File,
                },
              },
              {
                type: "text",
                text: "Extract ALL questions from this exam paper. Return ONLY the JSON array. Count every question including matching sub-items. Do not skip any question. Do not merge multiple questions into one.",
              },
            ];
          }
        }

        if (!requestContent.length && !extractedText) {
          return res.status(422).json({
            success: false,
            error: "Could not read usable text from the uploaded file.",
          });
        }

        if (!requestContent.length) {
          requestContent = [
            {
              type: "text",
              text: [
                "The following text was extracted from an exam file.",
                "Extract ALL questions from this exam paper (questions 1 through 40). Return ONLY the JSON array. Each question must be a separate object. Do NOT merge multiple questions into one. Do NOT include section headers as questions.",
                "--- BEGIN EXTRACTED FILE TEXT ---",
                extractedText,
                "--- END EXTRACTED FILE TEXT ---",
              ].join("\n"),
            },
          ];
        }
      }

      const anthropicResponse = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: anthropicModel,
          max_tokens: 8000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: requestContent,
            },
          ],
        },
        {
          headers: {
            "content-type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          timeout: 120000,
        }
      );

      const blocks = Array.isArray(anthropicResponse?.data?.content)
        ? anthropicResponse.data.content
        : [];
      const combinedText = blocks
        .filter((block) => block && block.type === "text")
        .map((block) => String(block.text || ""))
        .join("\n")
        .trim();

      const extracted = extractJsonArrayFromText(combinedText);
      if (!extracted) {
        return res.status(422).json({
          success: false,
          error: "Could not parse question JSON from extraction response.",
        });
      }

      const questions = normalizeExtractedQuestions(postProcessQuestions(extracted));
      if (!questions.length) {
        return res.status(422).json({
          success: false,
          error: "No questions were extracted from this file.",
        });
      }

      return res.json({ success: true, questions });
    } catch (error) {
      const apiMessage = error?.response?.data?.error?.message;
      return res.status(500).json({
        success: false,
        error: apiMessage || "Failed to extract questions from uploaded file.",
      });
    }
  },

  reviewAssessmentQuestionSet: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const reviewerUserId = Number(req.session.userId || req.session.user?.user_id || 0) || null;
    const questionSetId = Number(req.body.questionSetId);
    const action = String(req.body.action || "").trim().toLowerCase();
    const reviewNote = String(req.body.reviewNote || "").trim();

    if (!organizationId || !Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, error: "questionSetId is required." });
    }
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, error: "action must be approve or reject." });
    }

    const nextStatus = action === "approve" ? "approved" : "rejected";

    try {
      await ensureAssessmentQuestionSetReviewSchema(db);

      const updateResult = await db.query(
        `UPDATE assessment_question_sets
         SET review_status = $1,
             review_note = NULLIF($2, ''),
             reviewed_by = $3,
             reviewed_at = NOW(),
             updated_by = $3,
             updated_at = NOW()
         WHERE question_set_id = $4
           AND organization_id = $5
         RETURNING question_set_id, review_status`,
        [nextStatus, reviewNote, reviewerUserId, questionSetId, organizationId]
      );

      if (!updateResult.rows.length) {
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      return res.json({
        success: true,
        message: nextStatus === "approved" ? "Question set approved." : "Question set rejected.",
        questionSetId: Number(updateResult.rows[0].question_set_id),
        reviewStatus: String(updateResult.rows[0].review_status || nextStatus).toLowerCase(),
      });
    } catch (_error) {
      return res.status(500).json({ success: false, error: "Failed to update review status." });
    }
  },

  deleteAssessmentQuestionSet: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const actorUserId = Number(req.session.userId || req.session.user?.user_id || 0) || null;
    const questionSetId = Number(req.body.questionSetId || 0);

    if (!organizationId || !Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, error: "questionSetId is required." });
    }

    const client = await db.connect();
    try {
      await ensureGoogleIntegrationSchema(client);
      await client.query("BEGIN");

      const existingResult = await client.query(
        `SELECT question_set_id, set_title
         FROM assessment_question_sets
         WHERE question_set_id = $1
           AND organization_id = $2
         LIMIT 1`,
        [questionSetId, organizationId]
      );

      if (!existingResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      // Same guard as upsertAssessmentQuestionSet above - assessment_questions
      // cascades to student_assessment_responses, so this used to silently
      // wipe every student's submitted answers/marks with no check.
      const attemptCount = await client.query(
        `SELECT COUNT(*)::int AS count FROM student_assessment_attempts WHERE question_set_id = $1`,
        [questionSetId]
      );
      if (Number(attemptCount.rows[0]?.count || 0) > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          error: "Cannot delete this question set because one or more students have already started or submitted an attempt on it. Remove those attempts first, then try again.",
        });
      }

      await client.query(
        `DELETE FROM assessment_questions
         WHERE question_set_id = $1`,
        [questionSetId]
      );

      const deleteResult = await client.query(
        `DELETE FROM assessment_question_sets
         WHERE question_set_id = $1
           AND organization_id = $2`,
        [questionSetId, organizationId]
      );

      if (!deleteResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      await client.query("COMMIT");

      try {
        const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
        if (googleIntegration.shouldShowFeatures) {
          await markGoogleSync(
            db,
            organizationId,
            "queued",
            "Question set deletion detected. Google Classroom sync queued."
          );
        }
      } catch (_) {
      }

      return res.json({
        success: true,
        message: "Question set deleted successfully.",
        questionSetId,
        deletedBy: actorUserId,
      });
    } catch (_error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
      }
      return res.status(500).json({ success: false, error: "Failed to delete question set." });
    } finally {
      client.release();
    }
  },

  listClassAssessmentExams: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number(req.query.classId);
    const termId = Number(req.query.termId || req.session.currentTermId);
    const role = normalizeRoleKey(req.session.userRole || req.session.accountType || req.session.user?.account_type);

    if (!["manager", "supervisor"].includes(role)) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    if (!organizationId || !Number.isInteger(classId) || !Number.isInteger(termId)) {
      return res.status(400).json({ success: false, error: "classId and termId are required." });
    }

    try {
      const result = await db.query(
        `SELECT
           a.group_id,
           MIN(a.title) AS exam_title,
           COUNT(*)::int AS assessment_count,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subject_name ORDER BY s.subject_name), NULL) AS subjects
         FROM assessments a
         LEFT JOIN subjects s ON s.subject_id = a.subject_id
         WHERE a.organization_id = $1
           AND a.class_id = $2
           AND a.term_id = $3
         GROUP BY a.group_id
         ORDER BY MIN(a.title) ASC`,
        [organizationId, classId, termId]
      );

      return res.json({ success: true, exams: result.rows });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Failed to load class assessment exams." });
    }
  },

  renameClassAssessmentExam: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number(req.body.classId);
    const termId = Number(req.body.termId || req.session.currentTermId);
    const groupId = Number(req.body.groupId);
    const newTitle = String(req.body.newTitle || "").trim();
    const role = normalizeRoleKey(req.session.userRole || req.session.accountType || req.session.user?.account_type);

    if (!["manager", "supervisor"].includes(role)) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    if (!organizationId || !Number.isInteger(classId) || !Number.isInteger(termId) || !Number.isInteger(groupId) || !newTitle) {
      return res.status(400).json({ success: false, error: "groupId, classId, termId and newTitle are required." });
    }

    try {
      const updateResult = await db.query(
        `UPDATE assessments
         SET title = $1
         WHERE organization_id = $2
           AND class_id = $3
           AND term_id = $4
           AND group_id = $5`,
        [newTitle, organizationId, classId, termId, groupId]
      );

      if (!updateResult.rowCount) {
        return res.status(404).json({ success: false, error: "Assessment exam group not found." });
      }

      try {
        const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
        if (googleIntegration.shouldShowFeatures) {
          await markGoogleSync(
            db,
            organizationId,
            "queued",
            "Assessment exam rename detected. Google Classroom sync queued."
          );
        }
      } catch (_) {
      }

      return res.json({ success: true, message: "Assessment exam renamed successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Failed to rename class assessment exam." });
    }
  },

  calculateGrade: function (totalPercentage) {
    if (totalPercentage === "-" || isNaN(totalPercentage)) return "-";
    return getDefaultGradeLabel(totalPercentage);
  },

  calculateTotalPercentage: (scores, assessments) => {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    let hasScore = false;

    assessments.forEach((assessment) => {
      const score = scores ? scores[assessment.assessment_id] : null;
      let scorePercentage = 100; // Default to 100% if no score is present

      if (score !== null && score !== undefined) {
        hasScore = true;
        scorePercentage = (score / assessment.max_score) * 100; // Calculate the percentage score
      }

      const weightedScore = (scorePercentage / 100) * assessment.weight; // Scale by the test's weight
      totalWeightedScore += weightedScore;
      totalWeight += assessment.weight;
    });

    if (!hasScore) {
      return "-"; // No score entered for any test
    }

    const scaledTotalPercentage = totalWeight > 0 ? totalWeightedScore : "-";
    return scaledTotalPercentage;
  },

  calculateGrade: (totalPercentage) => {
    if (totalPercentage === "-" || isNaN(totalPercentage)) return "-";
    return getDefaultGradeLabel(totalPercentage);
  },

  getAssessments: async (req, res, db) => {
    const { classId, subjectId } = req.query;

    try {
      await ensureAssessmentControlSchema(db);
      const result = await db.query(
        `SELECT *,
                COALESCE(is_locked, FALSE) AS is_locked,
                COALESCE(is_active, TRUE) AS is_active,
                edit_window_start,
                edit_window_end
         FROM assessments
         WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3
         ORDER BY assessment_id ASC`,
        [classId, subjectId, req.session.organizationId]
      );
      res.json(result.rows);
    } catch (error) {
            res.status(500).send("Failed to fetch assessments");
    }
  },

  getScores: async (req, res, db) => {
    const { classId, subjectId } = req.query;

    try {
      const result = await db.query(
        `
                SELECT ar.student_id, ar.assessment_id, ar.score, s.first_name, s.last_name
                FROM assessment_results ar
                JOIN students s ON ar.student_id = s.student_id
                JOIN assessments a ON ar.assessment_id = a.assessment_id
                WHERE a.class_id = $1 AND a.subject_id = $2 AND s.organization_id = $3
                ORDER BY ar.assessment_id ASC, s.student_id ASC`,
        [classId, subjectId, req.session.organizationId]
      );

      res.json(result.rows);
    } catch (error) {
            res.status(500).send("Failed to fetch scores");
    }
  },

  manageAssessment: async (req, res, db) => {
    const isEmbedded = isEmbeddedRequest(req, "manageAssessment");
    const sessionOrganizationId = parseInt(req.session.organizationId, 10);
    const requestedOrganizationId = req.query.organizationId
      ? parseInt(req.query.organizationId, 10)
      : sessionOrganizationId;
    const organizationId = sessionOrganizationId;
    const rawTermId = req.query.termId || req.session.termId || req.session.currentTermId;
    const termId = parseInt(rawTermId, 10);

    if (!organizationId || Number.isNaN(organizationId) || !termId || Number.isNaN(termId)) {
      req.flash("error", "Organization ID and Term ID are required.");
      return res.status(400).send("Organization ID and Term ID are required.");
    }

    if (requestedOrganizationId && !Number.isNaN(requestedOrganizationId) && requestedOrganizationId !== organizationId) {
      req.flash("error", "You cannot access another organization's assessments.");
      return res.status(403).send("Forbidden");
    }

    try {
      // Schema DDL – columns already exist on established DBs.
      // Wrap in try/catch so a transient connection error at startup
      // (ECONNRESET on idle client) doesn't abort the entire page load.
      try {
        await ensureAssessmentControlSchema(db);
      } catch (ddlErr) {
        console.warn('[manageAssessment] DDL warm-up failed (non-fatal):', ddlErr.message);
      }
      await ensureClassDashboardLayoutSchema(db);

      await ensureGoogleIntegrationSchema(db);
      const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      const canManageGoogleIntegration = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.MANAGE_SETTINGS
      );
      const canSetAssessmentQuestions = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.SET_ASSESSMENT_QUESTIONS
      );
      const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
      const canAccessAssessmentQuestions =
        canUseQuestionSetIntegration && setAssessmentQuestionsFeatureEnabled && canSetAssessmentQuestions;

      const termOwnershipResult = await db.query(
        `
          SELECT term_id
          FROM terms
          WHERE term_id = $1 AND organization_id = $2
          LIMIT 1
        `,
        [termId, organizationId]
      );

      if (!termOwnershipResult.rows.length) {
        req.flash("error", "Invalid term for this organization.");
        return res.status(404).send("Term not found.");
      }

      // Fetch assessments with their associated classes and subjects, grouped by group_id
      const assessmentsQuery = `
                SELECT a.group_id, a.title, a.weight, a.max_score, a.category, a.term_id, 
            c.class_id, c.class_name, s.subject_name,
            BOOL_OR(COALESCE(a.is_locked, FALSE)) OVER (PARTITION BY a.group_id) AS is_locked,
            BOOL_AND(COALESCE(a.is_active, TRUE)) OVER (PARTITION BY a.group_id) AS is_active,
          BOOL_OR(COALESCE(a.show_question_set_on_dashboard, FALSE)) OVER (PARTITION BY a.group_id) AS show_question_set_on_dashboard,
            MIN(a.edit_window_start) OVER (PARTITION BY a.group_id) AS edit_window_start,
            MAX(a.edit_window_end) OVER (PARTITION BY a.group_id) AS edit_window_end
                FROM assessments a
                LEFT JOIN classes c ON a.class_id = c.class_id
                LEFT JOIN subjects s ON a.subject_id = s.subject_id
                WHERE a.organization_id = $1 AND a.term_id = $2
                ORDER BY a.group_id,
                     COALESCE(c.dashboard_sort_order, 2147483647),
                     c.class_name,
                     c.class_id,
                     s.subject_name
            `;
      const assessmentsResult = await db.query(assessmentsQuery, [
        organizationId,
        termId,
      ]);

      // Group classes and subjects under each assessment group
      const assessmentsMap = {};
      for (let row of assessmentsResult.rows) {
        const groupId = row.group_id;

        if (!assessmentsMap[groupId]) {
          const editability = computeAssessmentEditability(row);
          assessmentsMap[groupId] = {
            group_id: groupId,
            title: row.title,
            weight: row.weight,
            max_score: row.max_score,
            category: row.category,
            term_id: row.term_id,
            is_locked: row.is_locked,
            is_active: row.is_active,
            show_question_set_on_dashboard: Boolean(row.show_question_set_on_dashboard),
            edit_window_start: row.edit_window_start,
            edit_window_end: row.edit_window_end,
            can_edit_scores: editability.canEdit,
            access_reason: editability.reason,
            assigned_classes: {},
          };
        }

        if (!assessmentsMap[groupId].assigned_classes[row.class_id]) {
          assessmentsMap[groupId].assigned_classes[row.class_id] = {
            class_id: row.class_id,
            class_name: row.class_name,
            subjects: [],
          };
        }

        assessmentsMap[groupId].assigned_classes[row.class_id].subjects.push(
          row.subject_name
        );
      }

      // Convert the map into an array for easier rendering in EJS
      const assessments = Object.values(assessmentsMap).map((assessment) => {
        return {
          ...assessment,
          assigned_classes: Object.values(assessment.assigned_classes),
        };
      });

      res.render("common/manageAssessment", {
        title: "Manage Assessments",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        organizationId,
        termId,
        assessments,
        canUseGoogleClassroom: googleIntegration.shouldShowFeatures,
        canUseQuestionSetIntegration,
        canSetAssessmentQuestions,
        setAssessmentQuestionsFeatureEnabled,
        canAccessAssessmentQuestions,
        canManageGoogleIntegration,
        messages: req.flash(),
      });
    } catch (err) {
      console.error('[manageAssessment] ERROR:', err.message, err.stack);
      req.flash("error", "Failed to load manage assessment data.");
      res.status(500).send("Error fetching manage assessment data.");
    }
  },

  allClassAssessmentExamsPage: async (req, res, db) => {
    const sessionOrganizationId = parseInt(req.session.organizationId, 10);
    const isEmbedded = isEmbeddedRequest(req, "allClassAssessmentExams");
    const requestedOrganizationId = req.query.organizationId
      ? parseInt(req.query.organizationId, 10)
      : sessionOrganizationId;
    const organizationId = sessionOrganizationId;
    const rawTermId = req.query.termId || req.session.termId || req.session.currentTermId || null;
    const requestedTermId = rawTermId ? parseInt(rawTermId, 10) : null;
    const rawClassId = req.query.classId || null;
    const requestedClassId = rawClassId ? parseInt(rawClassId, 10) : null;

    if (!organizationId || Number.isNaN(organizationId)) {
      req.flash("error", "Organization ID is required.");
      return res.status(400).send("Organization ID is required.");
    }

    if (requestedOrganizationId && !Number.isNaN(requestedOrganizationId) && requestedOrganizationId !== organizationId) {
      req.flash("error", "You cannot access another organization's assessments.");
      return res.status(403).send("Forbidden");
    }

    try {
      await ensureAssessmentControlSchema(db);
      await ensureGoogleIntegrationSchema(db);
      await ensureAssessmentQuestionSetReviewSchema(db);
      const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      const canManageGoogleIntegration = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.MANAGE_SETTINGS
      );
      const currentUserId = Number(req.session.userId || req.session.user?.user_id || 0) || null;
      const normalizedRole = normalizeRoleKey(
        req.session.userRole || req.session.user?.account_type || req.session.accountType
      );
      let allowedTeacherClassIds = null;
      if (normalizedRole === "teacher" && currentUserId) {
        try {
          const teacherClassesResult = await db.query(
            `SELECT uc.class_id
             FROM user_classes uc
             JOIN classes c ON c.class_id = uc.class_id
             WHERE uc.user_id = $1
               AND c.organization_id = $2`,
            [currentUserId, organizationId]
          );
          allowedTeacherClassIds = teacherClassesResult.rows
            .map((row) => Number(row.class_id))
            .filter((value) => Number.isInteger(value) && value > 0);
        } catch (scopeError) {
          console.warn(
            "[allClassAssessmentExamsPage] Teacher scope lookup failed; continuing without teacher-only class narrowing:",
            scopeError?.message || scopeError
          );
          allowedTeacherClassIds = null;
        }
      }

      let scopedClassId = Number.isInteger(requestedClassId) && requestedClassId > 0
        ? Number(requestedClassId)
        : null;
      const allowedTeacherClassSet = Array.isArray(allowedTeacherClassIds)
        ? new Set(allowedTeacherClassIds)
        : null;

      if (allowedTeacherClassSet) {
        if (scopedClassId && !allowedTeacherClassSet.has(scopedClassId)) {
          req.flash("error", "You can only access assessment questions for classes assigned to you.");
          return res.status(403).send("Forbidden");
        }
        if (!scopedClassId && allowedTeacherClassIds.length) {
          scopedClassId = allowedTeacherClassIds[0];
        }
      }

      const isClassInScope = (classIdValue) => {
        const numericClassId = Number(classIdValue || 0);
        if (!Number.isInteger(numericClassId) || numericClassId <= 0) return false;
        if (allowedTeacherClassSet && !allowedTeacherClassSet.has(numericClassId)) return false;
        if (scopedClassId && numericClassId !== scopedClassId) return false;
        return true;
      };

      const termContextResult = await db.query(
        `SELECT
           t.term_id,
           t.term_name,
           t.current AS term_current,
           t.school_year_id,
           sy.year_label,
           sy.current AS school_year_current
         FROM terms t
         JOIN school_years sy ON sy.id = t.school_year_id
         WHERE t.organization_id = $1
         ORDER BY sy.current DESC, sy.id DESC, t.current DESC, t.start_date DESC, t.term_id DESC`,
        [organizationId]
      );

      if (!termContextResult.rows.length) {
        req.flash("error", "No terms found for this organization.");
        return res.status(404).send("No terms found.");
      }

      const selectedTermRow = Number.isInteger(requestedTermId)
        ? termContextResult.rows.find((row) => Number(row.term_id) === Number(requestedTermId)) || null
        : null;
      const fallbackCurrentTerm = termContextResult.rows.find((row) => Boolean(row.term_current)) || termContextResult.rows[0];
      const activeTermRow = selectedTermRow || fallbackCurrentTerm;
      const termId = Number(activeTermRow.term_id);
      req.session.currentTermId = termId;

      const schoolYearMap = new Map();
      termContextResult.rows.forEach((row) => {
        const schoolYearId = Number(row.school_year_id);
        if (!schoolYearMap.has(schoolYearId)) {
          schoolYearMap.set(schoolYearId, {
            schoolYearId,
            yearLabel: row.year_label,
            current: Boolean(row.school_year_current),
            terms: [],
          });
        }
        schoolYearMap.get(schoolYearId).terms.push({
          termId: Number(row.term_id),
          termName: row.term_name,
          current: Boolean(row.term_current),
        });
      });

      const schoolYears = Array.from(schoolYearMap.values());

      const classesResult = await db.query(
        `SELECT c.class_id, c.class_name
         FROM enrolled_classes ec
         JOIN classes c ON c.class_id = ec.class_id
         JOIN enrollments e ON e.enrollment_id = ec.enrollment_id
         WHERE e.organization_id = $1
           AND e.term_id = $2
           AND c.organization_id = $1
         GROUP BY c.class_id, c.class_name, c.dashboard_sort_order
         ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC`,
        [organizationId, termId]
      );

      const scopedClasses = classesResult.rows.filter((row) => isClassInScope(row.class_id));

      const classIds = scopedClasses
        .map((row) => Number(row.class_id))
        .filter((value) => Number.isInteger(value) && value > 0);

      const subjectsResult = classIds.length
        ? await db.query(
            `SELECT subject_id, class_id, subject_name
             FROM subjects
             WHERE organization_id = $1
               AND class_id = ANY($2::int[])
             ORDER BY class_id ASC, subject_name ASC`,
            [organizationId, classIds]
          )
        : { rows: [] };

      const termClassSubjectsResult = await db.query(
        `SELECT DISTINCT
           e.term_id,
           c.class_id,
           c.class_name,
           s.subject_id,
           s.subject_name
         FROM enrollments e
         JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
         JOIN classes c ON c.class_id = ec.class_id AND c.organization_id = e.organization_id
         LEFT JOIN subjects s ON s.class_id = c.class_id AND s.organization_id = e.organization_id
         WHERE e.organization_id = $1
         ORDER BY e.term_id ASC, c.class_name ASC, s.subject_name ASC NULLS LAST`,
        [organizationId]
      );

      const scopedTermClassSubjects = termClassSubjectsResult.rows.filter((row) => isClassInScope(row.class_id));

      const assessmentsForOrgResult = await db.query(
        `SELECT
           a.assessment_id,
           a.organization_id,
           a.term_id,
           t.school_year_id,
           a.class_id,
           a.subject_id,
           a.title,
           a.weight,
           a.max_score,
           a.category,
           COALESCE(a.scale_base, 100) AS scale_base,
           COALESCE(a.open_book, FALSE) AS open_book,
           a.time_limit_minutes,
           GREATEST(COALESCE(a.max_attempts, 1), 1) AS max_attempts,
           COALESCE(a.is_locked, FALSE) AS is_locked,
           COALESCE(a.is_active, TRUE) AS is_active,
           a.edit_window_start,
           a.edit_window_end,
           c.class_name,
           s.subject_name
         FROM assessments a
         JOIN terms t
           ON t.term_id = a.term_id
          AND t.organization_id = a.organization_id
         JOIN school_years sy
           ON sy.id = t.school_year_id
          AND sy.organization_id = a.organization_id
         JOIN classes c
           ON c.class_id = a.class_id
          AND c.organization_id = a.organization_id
         JOIN subjects s
           ON s.subject_id = a.subject_id
          AND s.class_id = a.class_id
          AND s.organization_id = a.organization_id
         WHERE a.organization_id = $1
           AND a.term_id IS NOT NULL
           AND a.class_id IS NOT NULL
           AND a.subject_id IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM enrollments e
             JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
             WHERE e.organization_id = a.organization_id
               AND e.term_id = a.term_id
               AND e.school_year_id = t.school_year_id
               AND ec.class_id = a.class_id
           )
         ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC, s.subject_name ASC, a.title ASC, a.assessment_id ASC`,
        [organizationId]
      );

      const scopedAssessmentRows = assessmentsForOrgResult.rows.filter((row) => isClassInScope(row.class_id));

      const assessmentsForOrg = scopedAssessmentRows.map((row) => {
        const editability = computeAssessmentEditability(row);
        return {
          assessment_id: row.assessment_id,
          organization_id: Number(row.organization_id),
          term_id: row.term_id,
          school_year_id: row.school_year_id,
          class_id: row.class_id,
          subject_id: row.subject_id,
          title: row.title,
          weight: Number(row.weight || 0),
          max_score: Number(row.max_score || 0),
          category: row.category || "Assessment",
          scale_base: Number(row.scale_base || 100),
          open_book: Boolean(row.open_book),
          time_limit_minutes: row.time_limit_minutes !== null && row.time_limit_minutes !== undefined
            ? Number(row.time_limit_minutes)
            : null,
          max_attempts: Number(row.max_attempts || 1),
          is_locked: Boolean(row.is_locked),
          is_active: Boolean(row.is_active),
          class_name: row.class_name || "Class",
          subject_name: row.subject_name || "Subject",
          can_edit_scores: Boolean(editability.canEdit),
          access_reason: editability.reason || "",
        };
      });

      const assessmentsForTerm = assessmentsForOrg.filter(
        (assessment) => Number(assessment.term_id) === Number(termId)
      );

      const assessmentIdsForTerm = assessmentsForTerm
        .map((assessment) => Number(assessment.assessment_id))
        .filter((assessmentId) => Number.isInteger(assessmentId) && assessmentId > 0);

      const assessmentAttemptInsights = new Map();
      if (assessmentIdsForTerm.length) {
        const enrolledStudentsByAssessmentResult = await db.query(
          `SELECT DISTINCT
             a.assessment_id,
             st.student_id,
             st.first_name,
             st.last_name
           FROM assessments a
           JOIN enrollments e
             ON e.organization_id = a.organization_id
            AND e.term_id = a.term_id
           JOIN enrolled_students es
             ON es.enrollment_id = e.enrollment_id
            AND es.class_id = a.class_id
           JOIN students st
             ON st.student_id = es.student_id
            AND st.organization_id = a.organization_id
           WHERE a.organization_id = $1
             AND a.term_id = $2
             AND a.assessment_id = ANY($3::int[])
           ORDER BY a.assessment_id ASC, st.last_name ASC, st.first_name ASC, st.student_id ASC`,
          [organizationId, termId, assessmentIdsForTerm]
        );

        const submittedAttemptsByAssessmentResult = await db.query(
          `SELECT DISTINCT ON (saa.assessment_id, saa.student_id)
             saa.assessment_id,
             saa.student_id,
             saa.attempt_id,
             saa.status,
             saa.started_at,
             saa.submitted_at,
             saa.score,
             saa.max_score,
             st.first_name,
             st.last_name
           FROM student_assessment_attempts saa
           JOIN students st
             ON st.student_id = saa.student_id
            AND st.organization_id = saa.organization_id
           WHERE saa.organization_id = $1
             AND saa.assessment_id = ANY($2::int[])
             AND LOWER(COALESCE(saa.status, '')) = 'submitted'
           ORDER BY saa.assessment_id ASC,
                    saa.student_id ASC,
                    saa.submitted_at DESC NULLS LAST,
                    saa.started_at DESC NULLS LAST,
                    saa.attempt_id DESC`,
          [organizationId, assessmentIdsForTerm]
        );

        enrolledStudentsByAssessmentResult.rows.forEach((row) => {
          const assessmentId = Number(row.assessment_id);
          const studentId = Number(row.student_id);
          if (!Number.isInteger(assessmentId) || !Number.isInteger(studentId)) {
            return;
          }

          if (!assessmentAttemptInsights.has(assessmentId)) {
            assessmentAttemptInsights.set(assessmentId, {
              enrolledStudents: [],
              attemptedByStudentId: new Map(),
            });
          }

          assessmentAttemptInsights.get(assessmentId).enrolledStudents.push({
            student_id: studentId,
            first_name: row.first_name || "",
            last_name: row.last_name || "",
          });
        });

        submittedAttemptsByAssessmentResult.rows.forEach((row) => {
          const assessmentId = Number(row.assessment_id);
          const studentId = Number(row.student_id);
          if (!Number.isInteger(assessmentId) || !Number.isInteger(studentId)) {
            return;
          }

          if (!assessmentAttemptInsights.has(assessmentId)) {
            assessmentAttemptInsights.set(assessmentId, {
              enrolledStudents: [],
              attemptedByStudentId: new Map(),
            });
          }

          assessmentAttemptInsights.get(assessmentId).attemptedByStudentId.set(studentId, {
            student_id: studentId,
            first_name: row.first_name || "",
            last_name: row.last_name || "",
            attempt_id: Number(row.attempt_id || 0),
            status: row.status || "submitted",
            started_at: row.started_at || null,
            submitted_at: row.submitted_at || null,
            score: row.score,
            max_score: row.max_score,
          });
        });
      }

      const enrichedAssessmentsForTerm = assessmentsForTerm.map((assessment) => {
        const insight = assessmentAttemptInsights.get(Number(assessment.assessment_id)) || {
          enrolledStudents: [],
          attemptedByStudentId: new Map(),
        };

        const enrolledStudents = Array.isArray(insight.enrolledStudents)
          ? insight.enrolledStudents
          : [];
        const attemptedByStudentId = insight.attemptedByStudentId instanceof Map
          ? insight.attemptedByStudentId
          : new Map();

        const attemptedStudents = Array.from(attemptedByStudentId.values()).sort((left, right) => {
          const leftName = `${left.last_name || ""} ${left.first_name || ""}`.trim().toLowerCase();
          const rightName = `${right.last_name || ""} ${right.first_name || ""}`.trim().toLowerCase();
          return leftName.localeCompare(rightName);
        });

        const nonAttemptedStudents = enrolledStudents
          .filter((student) => !attemptedByStudentId.has(Number(student.student_id)))
          .sort((left, right) => {
            const leftName = `${left.last_name || ""} ${left.first_name || ""}`.trim().toLowerCase();
            const rightName = `${right.last_name || ""} ${right.first_name || ""}`.trim().toLowerCase();
            return leftName.localeCompare(rightName);
          });

        const eligibleStudentCount = enrolledStudents.length;
        const attemptedStudentCount = attemptedStudents.length;
        const nonAttemptedStudentCount = nonAttemptedStudents.length;
        const completedStatus = eligibleStudentCount > 0 && nonAttemptedStudentCount === 0
          ? "completed"
          : "uncompleted";

        return {
          ...assessment,
          eligible_student_count: eligibleStudentCount,
          attempted_student_count: attemptedStudentCount,
          non_attempted_student_count: nonAttemptedStudentCount,
          completed_status: completedStatus,
          attempted_students: attemptedStudents,
          non_attempted_students: nonAttemptedStudents,
        };
      });

      const questionSetsResult = await db.query(
        `SELECT
           qs.question_set_id,
           qs.class_id,
           qs.subject_id,
           qs.assessment_id,
           qs.set_title,
           qs.set_description,
           qs.total_points,
           qs.review_status,
           qs.review_note,
           qs.reviewed_at,
           qs.submitted_at,
           qs.updated_at,
           c.class_name,
           s.subject_name,
           a.title AS assessment_title,
           COALESCE(a.open_book, FALSE) AS open_book,
           a.time_limit_minutes,
           GREATEST(COALESCE(a.max_attempts, 1), 1) AS max_attempts,
           CONCAT(COALESCE(ru.first_name, ''), CASE WHEN ru.last_name IS NOT NULL AND ru.last_name <> '' THEN ' ' || ru.last_name ELSE '' END) AS reviewed_by_name,
           COUNT(q.question_id)::int AS question_count
         FROM assessment_question_sets qs
         LEFT JOIN classes c ON c.class_id = qs.class_id AND c.organization_id = qs.organization_id
         LEFT JOIN subjects s ON s.subject_id = qs.subject_id AND s.organization_id = qs.organization_id
         LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
         LEFT JOIN users ru ON ru.user_id = qs.reviewed_by AND ru.organization_id = qs.organization_id
         LEFT JOIN assessment_questions q ON q.question_set_id = qs.question_set_id
         WHERE qs.organization_id = $1
           AND qs.term_id = $2
         GROUP BY
           qs.question_set_id,
           qs.class_id,
           qs.subject_id,
           qs.assessment_id,
           qs.set_title,
           qs.set_description,
           qs.total_points,
           qs.review_status,
           qs.review_note,
           qs.reviewed_at,
           qs.submitted_at,
           qs.updated_at,
           c.class_name,
           s.subject_name,
           a.title,
           a.open_book,
           a.time_limit_minutes,
           a.max_attempts,
           ru.first_name,
           ru.last_name
         ORDER BY qs.updated_at DESC, qs.question_set_id DESC`,
        [organizationId, termId]
      );

      const scopedQuestionSetRows = questionSetsResult.rows.filter((row) => isClassInScope(row.class_id));
      const dedupedQuestionSetRows = [];
      const seenAssessmentQuestionSets = new Set();
      scopedQuestionSetRows.forEach((row) => {
        const assessmentKey = Number(row.assessment_id || 0);
        if (!assessmentKey) return;
        if (seenAssessmentQuestionSets.has(assessmentKey)) return;
        seenAssessmentQuestionSets.add(assessmentKey);
        dedupedQuestionSetRows.push(row);
      });

      const questionSetIds = dedupedQuestionSetRows
        .map((row) => Number(row.question_set_id))
        .filter((value) => Number.isInteger(value) && value > 0);

      const questionsResult = questionSetIds.length
        ? await db.query(
            `SELECT
               question_set_id,
               question_id,
               question_type,
               question_text,
               marks,
               position_index
             FROM assessment_questions
             WHERE question_set_id = ANY($1::int[])
             ORDER BY question_set_id ASC, position_index ASC, question_id ASC`,
            [questionSetIds]
          )
        : { rows: [] };

      const questionsBySetId = new Map();
      questionsResult.rows.forEach((row) => {
        const key = Number(row.question_set_id);
        if (!questionsBySetId.has(key)) {
          questionsBySetId.set(key, []);
        }
        questionsBySetId.get(key).push({
          questionId: row.question_id,
          questionType: row.question_type,
          questionText: row.question_text,
          marks: Number(row.marks || 0),
          positionIndex: Number(row.position_index || 0),
        });
      });

      const assessmentIdsForPostStatus = dedupedQuestionSetRows
        .map((row) => Number(row.assessment_id))
        .filter((value) => Number.isInteger(value) && value > 0);

      const postStatusResult = assessmentIdsForPostStatus.length
        ? await db.query(
            `SELECT
               assessment_id,
               COUNT(*) FILTER (WHERE status = 'submitted') AS completed_count,
               COUNT(*) FILTER (WHERE status = 'submitted' AND posted_at IS NOT NULL) AS posted_count
             FROM student_assessment_attempts
             WHERE organization_id = $1
               AND assessment_id = ANY($2::int[])
             GROUP BY assessment_id`,
            [organizationId, assessmentIdsForPostStatus]
          )
        : { rows: [] };

      const postStatusByAssessmentId = new Map();
      postStatusResult.rows.forEach((row) => {
        postStatusByAssessmentId.set(Number(row.assessment_id), {
          completedCount: Number(row.completed_count || 0),
          postedCount: Number(row.posted_count || 0),
        });
      });

      const questionSets = dedupedQuestionSetRows.map((row) => {
        const postStatus = postStatusByAssessmentId.get(Number(row.assessment_id)) || { completedCount: 0, postedCount: 0 };
        return {
        question_set_id: row.question_set_id,
        class_id: Number(row.class_id),
        subject_id: Number(row.subject_id),
        assessment_id: Number(row.assessment_id),
        completed_count: postStatus.completedCount,
        posted_count: postStatus.postedCount,
        pending_post_count: Math.max(postStatus.completedCount - postStatus.postedCount, 0),
        class_name: row.class_name || "Class",
        subject_name: row.subject_name || "Subject",
        assessment_title: row.assessment_title || "Assessment",
        open_book: Boolean(row.open_book),
        time_limit_minutes: row.time_limit_minutes !== null && row.time_limit_minutes !== undefined
          ? Number(row.time_limit_minutes)
          : null,
        max_attempts: Number(row.max_attempts || 1),
        set_title: row.set_title || "Question Set",
        set_description: row.set_description || "",
        total_points: Number(row.total_points || 0),
        question_count: Number(row.question_count || 0),
        review_status: String(row.review_status || "pending").toLowerCase(),
        review_note: row.review_note || "",
        reviewed_at: row.reviewed_at,
        submitted_at: row.submitted_at,
        reviewed_by_name: String(row.reviewed_by_name || "").trim(),
        updated_at: row.updated_at,
        questions: questionsBySetId.get(Number(row.question_set_id)) || [],
        };
      });

      return res.render("common/allClassAssessmentExams", {
        title: "All Class Assessment Questions",
        organizationId,
        isEmbedded,
        termId,
        selectedTermName: activeTermRow.term_name,
        selectedSchoolYearId: Number(activeTermRow.school_year_id),
        selectedClassId: scopedClassId || 0,
        schoolYears,
        classes: scopedClasses,
        subjects: subjectsResult.rows,
        termClassSubjects: scopedTermClassSubjects,
        assessmentsForOrg: [],
        assessmentsForTerm: enrichedAssessmentsForTerm,
        questionSets,
        canUseGoogleClassroom: googleIntegration.shouldShowFeatures,
        canUseQuestionSetIntegration,
        canManageGoogleIntegration,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[allClassAssessmentExamsPage] ERROR:", error.message, error.stack);
      req.flash("error", "Failed to load class assessment questions.");
      return res.status(500).send("Error loading class assessment questions.");
    }
  },

  getAssessmentQuestionSetStudents: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const questionSetId = Number(req.query.questionSetId || 0);

    if (!organizationId || !Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, error: "questionSetId is required." });
    }

    try {
      await ensureStudentAssessmentLockSchema(db);
      await ensureStudentPortalSchema(db);

      const scopeResult = await db.query(
        `SELECT
           qs.question_set_id,
           qs.assessment_id,
           qs.term_id,
           qs.class_id,
           qs.subject_id,
           qs.set_title,
           c.class_name,
           s.subject_name,
           a.title AS assessment_title
         FROM assessment_question_sets qs
         LEFT JOIN classes c
           ON c.class_id = qs.class_id
          AND c.organization_id = qs.organization_id
         LEFT JOIN subjects s
           ON s.subject_id = qs.subject_id
          AND s.organization_id = qs.organization_id
         LEFT JOIN assessments a
           ON a.assessment_id = qs.assessment_id
          AND a.organization_id = qs.organization_id
         WHERE qs.organization_id = $1
           AND qs.question_set_id = $2
         LIMIT 1`,
        [organizationId, questionSetId]
      );

      if (!scopeResult.rows.length) {
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      const scope = scopeResult.rows[0];
      const assessmentId = Number(scope.assessment_id || 0);
      const termId = Number(scope.term_id || 0);
      const classId = Number(scope.class_id || 0);

      if (!assessmentId || !termId || !classId) {
        return res.status(400).json({ success: false, error: "Question set scope is incomplete." });
      }

      const studentsResult = await db.query(
        `WITH eligible_students AS (
           SELECT DISTINCT
             st.student_id,
             st.first_name,
             st.last_name
           FROM enrollments e
           JOIN enrolled_students es
             ON es.enrollment_id = e.enrollment_id
            AND es.class_id = $3
           JOIN students st
             ON st.student_id = es.student_id
            AND st.organization_id = e.organization_id
           WHERE e.organization_id = $1
             AND e.term_id = $2
         )
         SELECT
           es.student_id,
           es.first_name,
           es.last_name,
           la.attempt_id,
           la.status AS attempt_status,
           la.started_at,
           la.submitted_at,
           la.score,
           la.max_score,
           la.posted_at,
           COALESCE(salo.is_locked, FALSE) AS override_locked
         FROM eligible_students es
         LEFT JOIN LATERAL (
           SELECT
             saa.attempt_id,
             saa.status,
             saa.started_at,
             saa.submitted_at,
             saa.score,
             saa.max_score,
             saa.posted_at,
             saa.updated_at
           FROM student_assessment_attempts saa
           WHERE saa.organization_id = $1
             AND saa.assessment_id = $4
             AND saa.student_id = es.student_id
           ORDER BY
             CASE WHEN LOWER(COALESCE(saa.status, '')) = 'submitted' THEN 0 ELSE 1 END,
             saa.submitted_at DESC NULLS LAST,
             saa.updated_at DESC NULLS LAST,
             saa.attempt_id DESC
           LIMIT 1
         ) la ON TRUE
         LEFT JOIN student_assessment_lock_overrides salo
           ON salo.organization_id = $1
          AND salo.student_id = es.student_id
          AND salo.assessment_id = $4
         ORDER BY LOWER(COALESCE(es.last_name, '')) ASC,
                  LOWER(COALESCE(es.first_name, '')) ASC,
                  es.student_id ASC`,
        [organizationId, termId, classId, assessmentId]
      );

      const students = studentsResult.rows.map((row) => {
        const attemptStatus = String(row.attempt_status || "").toLowerCase();
        const hasAttemptDate = Boolean(row.started_at || row.submitted_at);
        const isCompleted = Boolean(row.started_at && row.submitted_at);
        const isLocked = hasAttemptDate || Boolean(row.override_locked);
        const isPosted = Boolean(row.posted_at);
        return {
          studentId: Number(row.student_id),
          firstName: row.first_name || "",
          lastName: row.last_name || "",
          attemptId: row.attempt_id ? Number(row.attempt_id) : null,
          attemptStatus: attemptStatus || "not_started",
          isCompleted,
          isLocked,
          isPosted,
          hasAttemptDate,
          hasOverrideLock: Boolean(row.override_locked),
          startedAt: row.started_at || null,
          submittedAt: row.submitted_at || null,
          postedAt: row.posted_at || null,
          score: row.score,
          maxScore: row.max_score,
        };
      });

      const completedCount = students.filter((student) => student.isLocked).length;
      const pendingPostCount = students.filter(
        (student) => student.attemptStatus === "submitted" && !student.isPosted
      ).length;

      return res.json({
        success: true,
        scope: {
          questionSetId,
          setTitle: scope.set_title || "Question Set",
          classId,
          className: scope.class_name || "Class",
          subjectId: Number(scope.subject_id || 0),
          subjectName: scope.subject_name || "Subject",
          termId,
          assessmentId,
          assessmentTitle: scope.assessment_title || "Assessment",
        },
        summary: {
          totalStudents: students.length,
          completedCount,
          unlockedCount: students.length - completedCount,
          pendingPostCount,
        },
        students,
      });
    } catch (_error) {
      return res.status(500).json({ success: false, error: "Failed to load students for this question set." });
    }
  },

  postAssessmentQuestionSetScores: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const questionSetId = Number(req.body?.questionSetId || 0);

    if (!organizationId || !Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, error: "questionSetId is required." });
    }

    try {
      await ensureStudentPortalSchema(db);

      const scopeResult = await db.query(
        `SELECT qs.assessment_id, qs.term_id, qs.class_id, qs.subject_id, a.category, a.title
         FROM assessment_question_sets qs
         LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
         WHERE qs.organization_id = $1 AND qs.question_set_id = $2
         LIMIT 1`,
        [organizationId, questionSetId]
      );

      if (!scopeResult.rows.length) {
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      const scope = scopeResult.rows[0];
      const assessmentId = Number(scope.assessment_id || 0);
      if (!assessmentId) {
        return res.status(400).json({ success: false, error: "Question set scope is incomplete." });
      }

      const pendingResult = await db.query(
        `SELECT attempt_id, student_id, score, max_score
         FROM student_assessment_attempts
         WHERE organization_id = $1
           AND assessment_id = $2
           AND question_set_id = $3
           AND status = 'submitted'
           AND posted_at IS NULL`,
        [organizationId, assessmentId, questionSetId]
      );

      let postedCount = 0;
      for (const attempt of pendingResult.rows) {
        await db.query(
          `INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, term_id, organization_id, class_id, category)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (student_id, assessment_id)
           DO UPDATE SET score = EXCLUDED.score`,
          [
            attempt.student_id,
            assessmentId,
            attempt.score,
            scope.subject_id,
            scope.term_id,
            organizationId,
            scope.class_id,
            scope.category,
          ]
        );

        await recomputeSubjectTotalsForStudent(db, {
          studentId: attempt.student_id,
          subjectId: scope.subject_id,
          classId: scope.class_id,
          termId: scope.term_id,
          organizationId,
        });

        await db.query(
          `UPDATE student_assessment_attempts SET posted_at = NOW() WHERE attempt_id = $1`,
          [attempt.attempt_id]
        );

        postedCount += 1;
      }

      if (postedCount > 0) {
        await commonController.updateStudentPositions(
          db,
          scope.subject_id,
          organizationId,
          scope.class_id,
          scope.term_id
        );
      }

      return res.json({
        success: true,
        postedCount,
        message: postedCount
          ? `Posted ${postedCount} score(s) for "${scope.title || "this assessment"}".`
          : "No new completed attempts to post.",
      });
    } catch (error) {
      console.error("[postAssessmentQuestionSetScores] Error:", error?.message || error);
      return res.status(500).json({ success: false, error: "Failed to post scores." });
    }
  },

  unpostAssessmentQuestionSetScores: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const questionSetId = Number(req.body?.questionSetId || 0);

    if (!organizationId || !Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, error: "questionSetId is required." });
    }

    try {
      await ensureStudentPortalSchema(db);

      const scopeResult = await db.query(
        `SELECT qs.assessment_id, qs.term_id, qs.class_id, qs.subject_id, a.title
         FROM assessment_question_sets qs
         LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
         WHERE qs.organization_id = $1 AND qs.question_set_id = $2
         LIMIT 1`,
        [organizationId, questionSetId]
      );

      if (!scopeResult.rows.length) {
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      const scope = scopeResult.rows[0];
      const assessmentId = Number(scope.assessment_id || 0);
      if (!assessmentId) {
        return res.status(400).json({ success: false, error: "Question set scope is incomplete." });
      }

      const postedResult = await db.query(
        `SELECT attempt_id, student_id
         FROM student_assessment_attempts
         WHERE organization_id = $1
           AND assessment_id = $2
           AND question_set_id = $3
           AND status = 'submitted'
           AND posted_at IS NOT NULL`,
        [organizationId, assessmentId, questionSetId]
      );

      let unpostedCount = 0;
      for (const attempt of postedResult.rows) {
        await db.query(
          `DELETE FROM assessment_results WHERE student_id = $1 AND assessment_id = $2`,
          [attempt.student_id, assessmentId]
        );

        await recomputeSubjectTotalsForStudent(db, {
          studentId: attempt.student_id,
          subjectId: scope.subject_id,
          classId: scope.class_id,
          termId: scope.term_id,
          organizationId,
        });

        await db.query(
          `UPDATE student_assessment_attempts SET posted_at = NULL WHERE attempt_id = $1`,
          [attempt.attempt_id]
        );

        unpostedCount += 1;
      }

      if (unpostedCount > 0) {
        await commonController.updateStudentPositions(
          db,
          scope.subject_id,
          organizationId,
          scope.class_id,
          scope.term_id
        );
      }

      return res.json({
        success: true,
        unpostedCount,
        message: unpostedCount
          ? `Unposted ${unpostedCount} score(s) for "${scope.title || "this assessment"}". They no longer show on the subject dashboard.`
          : "No posted scores to unpost.",
      });
    } catch (error) {
      console.error("[unpostAssessmentQuestionSetScores] Error:", error?.message || error);
      return res.status(500).json({ success: false, error: "Failed to unpost scores." });
    }
  },

  verifyAssessmentAnswerPassword: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const userId = Number(req.session.userId || 0);
    const password = String(req.body?.password || "");

    if (!organizationId || !password.trim()) {
      return res.status(400).json({ success: false, error: "Password is required." });
    }

    try {
      if (userId) {
        const userResult = await db.query(
          `SELECT password FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
          [userId, organizationId]
        );
        if (userResult.rows.length && userResult.rows[0].password) {
          const matchUser = await bcrypt.compare(password, userResult.rows[0].password);
          if (matchUser) return res.json({ success: true });
        }
      }

      const orgResult = await db.query(
        `SELECT password FROM organizations WHERE organization_id = $1 LIMIT 1`,
        [organizationId]
      );
      if (orgResult.rows.length && orgResult.rows[0].password) {
        const matchOrg = await bcrypt.compare(password, orgResult.rows[0].password);
        if (matchOrg) return res.json({ success: true });
      }

      return res.status(401).json({ success: false, error: "Incorrect password." });
    } catch (error) {
      console.error("[verifyAssessmentAnswerPassword] Error:", error?.message || error);
      return res.status(500).json({ success: false, error: "Unable to verify password right now." });
    }
  },

  getAssessmentAttemptForGrading: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const attemptId = Number(req.query.attemptId || 0);

    if (!organizationId || !Number.isInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({ success: false, error: "attemptId is required." });
    }

    try {
      const attemptResult = await db.query(
        `SELECT saa.attempt_id, saa.student_id, saa.assessment_id, saa.question_set_id,
                saa.status, saa.started_at, saa.submitted_at, saa.score, saa.max_score,
                st.first_name, st.last_name,
                a.title AS assessment_title, a.class_id, a.subject_id, a.term_id,
                a.max_score AS assessment_max_score, a.is_locked, a.is_active,
                a.edit_window_start, a.edit_window_end,
                c.class_name, s.subject_name
         FROM student_assessment_attempts saa
         JOIN students st ON st.student_id = saa.student_id AND st.organization_id = saa.organization_id
         JOIN assessments a ON a.assessment_id = saa.assessment_id AND a.organization_id = saa.organization_id
         LEFT JOIN classes c ON c.class_id = a.class_id AND c.organization_id = a.organization_id
         LEFT JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
         WHERE saa.organization_id = $1 AND saa.attempt_id = $2
         LIMIT 1`,
        [organizationId, attemptId]
      );

      if (!attemptResult.rows.length) {
        return res.status(404).json({ success: false, error: "Attempt not found." });
      }

      const attempt = attemptResult.rows[0];
      if (!attempt.question_set_id) {
        return res.status(400).json({ success: false, error: "This attempt has no linked question set." });
      }

      const questionsResult = await db.query(
        `SELECT q.question_id, q.question_type, q.question_text, q.options_json, q.answer_key,
                q.marks, q.position_index,
                r.response_text, r.response_json, r.is_correct, r.awarded_marks
         FROM assessment_questions q
         LEFT JOIN student_assessment_responses r
           ON r.question_id = q.question_id AND r.attempt_id = $2
         WHERE q.question_set_id = $1
         ORDER BY q.position_index ASC, q.question_id ASC`,
        [attempt.question_set_id, attemptId]
      );

      const editability = computeAssessmentEditability(attempt);

      return res.json({
        success: true,
        attempt: {
          attemptId: Number(attempt.attempt_id),
          status: attempt.status,
          startedAt: attempt.started_at,
          submittedAt: attempt.submitted_at,
          score: attempt.score,
          maxScore: attempt.max_score,
        },
        student: {
          studentId: Number(attempt.student_id),
          firstName: attempt.first_name || "",
          lastName: attempt.last_name || "",
        },
        assessment: {
          assessmentId: Number(attempt.assessment_id),
          title: attempt.assessment_title,
          classId: Number(attempt.class_id),
          className: attempt.class_name || "",
          subjectId: Number(attempt.subject_id),
          subjectName: attempt.subject_name || "",
          termId: Number(attempt.term_id),
          maxScore: attempt.assessment_max_score,
        },
        canEdit: editability.canEdit,
        editReason: editability.reason || "",
        questions: questionsResult.rows.map((q) => ({
          questionId: Number(q.question_id),
          questionType: q.question_type,
          questionText: q.question_text,
          options: q.options_json || null,
          answerKey: q.answer_key,
          marks: Number(q.marks),
          responseText: q.response_text,
          responseJson: q.response_json,
          isCorrect: q.is_correct,
          awardedMarks:
            q.awarded_marks !== null && q.awarded_marks !== undefined ? Number(q.awarded_marks) : null,
        })),
      });
    } catch (error) {
      console.error("[getAssessmentAttemptForGrading] Error:", error?.message || error);
      return res.status(500).json({ success: false, error: "Failed to load attempt for grading." });
    }
  },

  saveAssessmentAttemptGrade: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const attemptId = Number(req.body?.attemptId || 0);
    const marksInput = req.body?.marks && typeof req.body.marks === "object" ? req.body.marks : {};

    if (!organizationId || !Number.isInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({ success: false, error: "attemptId is required." });
    }

    try {
      await ensureStudentPortalSchema(db);

      const attemptResult = await db.query(
        `SELECT saa.attempt_id, saa.student_id, saa.assessment_id, saa.posted_at,
                a.class_id, a.subject_id, a.term_id, a.category,
                a.is_locked, a.is_active, a.edit_window_start, a.edit_window_end
         FROM student_assessment_attempts saa
         JOIN assessments a ON a.assessment_id = saa.assessment_id AND a.organization_id = saa.organization_id
         WHERE saa.organization_id = $1 AND saa.attempt_id = $2
         LIMIT 1`,
        [organizationId, attemptId]
      );

      if (!attemptResult.rows.length) {
        return res.status(404).json({ success: false, error: "Attempt not found." });
      }

      const attempt = attemptResult.rows[0];
      const editability = computeAssessmentEditability(attempt);
      if (!editability.canEdit) {
        return res.status(403).json({
          success: false,
          error: `This assessment is not editable right now: ${editability.reason}`,
        });
      }

      const questionsResult = await db.query(
        `SELECT q.question_id, q.marks
         FROM assessment_questions q
         JOIN student_assessment_attempts saa ON saa.question_set_id = q.question_set_id
         WHERE saa.attempt_id = $1`,
        [attemptId]
      );
      const marksByQuestion = new Map(
        questionsResult.rows.map((q) => [Number(q.question_id), Number(q.marks)])
      );

      await db.query("BEGIN");
      let newScore = 0;
      try {
        for (const [questionIdStr, rawValue] of Object.entries(marksInput)) {
          const questionId = Number(questionIdStr);
          if (!marksByQuestion.has(questionId)) continue;

          const maxMarks = marksByQuestion.get(questionId);
          let awarded = Number(rawValue);
          if (!Number.isFinite(awarded)) awarded = 0;
          awarded = Math.max(0, Math.min(awarded, maxMarks));

          await db.query(
            `UPDATE student_assessment_responses
             SET awarded_marks = $1, updated_at = NOW()
             WHERE attempt_id = $2 AND question_id = $3`,
            [awarded, attemptId, questionId]
          );
        }

        const totalResult = await db.query(
          `SELECT COALESCE(SUM(awarded_marks), 0) AS total
           FROM student_assessment_responses
           WHERE attempt_id = $1`,
          [attemptId]
        );
        newScore = Number(totalResult.rows[0].total) || 0;

        // Grading always updates the attempt's own score. It does NOT post to
        // assessment_results (the subject dashboard's source) unless this
        // attempt was already posted before — posting itself only happens via
        // the explicit "Post Score" action.
        await db.query(
          `UPDATE student_assessment_attempts SET score = $1, updated_at = NOW() WHERE attempt_id = $2`,
          [newScore, attemptId]
        );

        const wasAlreadyPosted = Boolean(attempt.posted_at);

        if (wasAlreadyPosted) {
          await db.query(
            `INSERT INTO assessment_results (student_id, assessment_id, score, subject_id, term_id, organization_id, class_id, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (student_id, assessment_id)
             DO UPDATE SET score = EXCLUDED.score`,
            [
              attempt.student_id,
              attempt.assessment_id,
              newScore,
              attempt.subject_id,
              attempt.term_id,
              organizationId,
              attempt.class_id,
              attempt.category,
            ]
          );

          await recomputeSubjectTotalsForStudent(db, {
            studentId: attempt.student_id,
            subjectId: attempt.subject_id,
            classId: attempt.class_id,
            termId: attempt.term_id,
            organizationId,
          });

          await commonController.updateStudentPositions(
            db,
            attempt.subject_id,
            organizationId,
            attempt.class_id,
            attempt.term_id
          );
        }

        await db.query("COMMIT");
      } catch (txError) {
        await db.query("ROLLBACK");
        throw txError;
      }

      return res.json({ success: true, score: newScore });
    } catch (error) {
      console.error("[saveAssessmentAttemptGrade] Error:", error?.message || error);
      return res.status(500).json({ success: false, error: "Failed to save grade." });
    }
  },

  unlockAssessmentQuestionSetStudents: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId || 0);
    const actorUserId = Number(req.session.userId || req.session.user?.user_id || 0) || null;
    const questionSetId = Number(req.body.questionSetId || 0);
    const studentId = req.body.studentId !== undefined ? Number(req.body.studentId) : null;
    const unlockAll = Boolean(req.body.unlockAll);
    const action = String(req.body.action || 'unlock').trim().toLowerCase();
    const reshuffleQuestions = Boolean(req.body.reshuffleQuestions);

    if (!organizationId || !Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, error: "questionSetId is required." });
    }

    if (!unlockAll && (!Number.isInteger(studentId) || Number(studentId) <= 0)) {
      return res.status(400).json({ success: false, error: "studentId is required when unlockAll is false." });
    }
    if (!['lock', 'unlock'].includes(action)) {
      return res.status(400).json({ success: false, error: "action must be lock or unlock." });
    }
    if (unlockAll && action !== 'unlock') {
      return res.status(400).json({ success: false, error: "unlockAll only supports unlock." });
    }

    const client = await db.connect();
    try {
      await ensureStudentAssessmentLockSchema(client);
      await client.query("BEGIN");

      const scopeResult = await client.query(
        `SELECT
           question_set_id,
           assessment_id,
           term_id,
           class_id,
           subject_id
         FROM assessment_question_sets
         WHERE organization_id = $1
           AND question_set_id = $2
         LIMIT 1
         FOR UPDATE`,
        [organizationId, questionSetId]
      );

      if (!scopeResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Question set not found." });
      }

      const scope = scopeResult.rows[0];
      const assessmentId = Number(scope.assessment_id || 0);
      const termId = Number(scope.term_id || 0);
      const classId = Number(scope.class_id || 0);

      if (!assessmentId || !termId || !classId) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Question set scope is incomplete." });
      }

      const eligibleStudentsResult = await client.query(
        `SELECT DISTINCT es.student_id
         FROM enrollments e
         JOIN enrolled_students es
           ON es.enrollment_id = e.enrollment_id
          AND es.class_id = $3
         WHERE e.organization_id = $1
           AND e.term_id = $2`,
        [organizationId, termId, classId]
      );

      const eligibleStudentIds = eligibleStudentsResult.rows
        .map((row) => Number(row.student_id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (!eligibleStudentIds.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "No eligible students found for this scope." });
      }

      let targetStudentIds = eligibleStudentIds;
      if (!unlockAll) {
        if (!eligibleStudentIds.includes(Number(studentId))) {
          await client.query("ROLLBACK");
          return res.status(403).json({ success: false, error: "Student is outside the selected class and term scope." });
        }
        targetStudentIds = [Number(studentId)];
      }

      const updateResult = action === 'lock'
        ? await client.query(
            `SELECT NULL::INTEGER AS attempt_id, student_id
             FROM unnest($1::int[]) AS u(student_id)`,
            [targetStudentIds]
          )
        : await client.query(
            `SELECT DISTINCT saa.attempt_id, saa.student_id
             FROM student_assessment_attempts saa
             WHERE saa.organization_id = $1
               AND saa.assessment_id = $2
               AND saa.student_id = ANY($3::int[])`,
            [organizationId, assessmentId, targetStudentIds]
          );

      const unlockedAttemptIds = updateResult.rows
        .map((row) => Number(row.attempt_id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const unlockedStudentIds = updateResult.rows
        .map((row) => Number(row.student_id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (action === 'lock' && targetStudentIds.length) {
        await client.query(
          `UPDATE student_assessment_lock_overrides
              SET question_set_id = $4,
                  is_locked = TRUE,
                  updated_at = NOW()
            WHERE organization_id = $1
              AND assessment_id = $2
              AND student_id = ANY($3::int[])`,
          [organizationId, assessmentId, targetStudentIds, questionSetId]
        );

        await client.query(
          `INSERT INTO student_assessment_lock_overrides (
             organization_id,
             student_id,
             assessment_id,
             question_set_id,
             is_locked,
             updated_at
           )
           SELECT $1, student_id, $2, $4, TRUE, NOW()
           FROM unnest($3::int[]) AS u(student_id)
           WHERE NOT EXISTS (
             SELECT 1
             FROM student_assessment_lock_overrides salo
             WHERE salo.organization_id = $1
               AND salo.assessment_id = $2
               AND salo.student_id = u.student_id
           )`,
          [organizationId, assessmentId, targetStudentIds, questionSetId]
        );
      }

      if (action === 'unlock' && targetStudentIds.length && !reshuffleQuestions) {
        await client.query(
          `DELETE FROM student_assessment_lock_overrides
           WHERE organization_id = $1
             AND assessment_id = $2
             AND student_id = ANY($3::int[])`,
          [organizationId, assessmentId, targetStudentIds]
        );
      }

      if (action === 'unlock' && reshuffleQuestions && targetStudentIds.length) {
        for (const targetId of targetStudentIds) {
          const reshuffledQuestionSetId = await cloneQuestionSetForRetakeShuffle(client, {
            organizationId,
            sourceQuestionSetId: questionSetId,
            actorUserId,
            retakeStudentId: targetId,
            shuffleMode: "random",
          });

          await client.query(
            `UPDATE student_assessment_lock_overrides
                SET question_set_id = $4,
                    is_locked = FALSE,
                    updated_at = NOW()
              WHERE organization_id = $1
                AND student_id = $2
                AND assessment_id = $3`,
            [organizationId, targetId, assessmentId, reshuffledQuestionSetId]
          );

          await client.query(
            `INSERT INTO student_assessment_lock_overrides (
               organization_id,
               student_id,
               assessment_id,
               question_set_id,
               is_locked,
               updated_at
             )
             SELECT $1, $2, $3, $4, FALSE, NOW()
             WHERE NOT EXISTS (
               SELECT 1
               FROM student_assessment_lock_overrides salo
               WHERE salo.organization_id = $1
                 AND salo.student_id = $2
                 AND salo.assessment_id = $3
             )`,
            [organizationId, targetId, assessmentId, reshuffledQuestionSetId]
          );
        }
      }

      if (action === 'unlock' && unlockedAttemptIds.length) {
        await client.query(
          `DELETE FROM student_assessment_responses
           WHERE attempt_id = ANY($1::int[])`,
          [unlockedAttemptIds]
        );

        await client.query(
          `DELETE FROM student_assessment_attempts
           WHERE attempt_id = ANY($1::int[])`,
          [unlockedAttemptIds]
        );
      }

      if (action === 'unlock' && unlockedStudentIds.length) {
        await client.query(
          `DELETE FROM assessment_results
           WHERE organization_id = $1
             AND assessment_id = $2
             AND student_id = ANY($3::int[])`,
          [organizationId, assessmentId, unlockedStudentIds]
        );
      }

      await client.query("COMMIT");

      return res.json({
        success: true,
        message: action === 'lock'
          ? (targetStudentIds.length ? 'Student locked.' : 'Student could not be locked.')
          : (unlockAll
              ? `Unlocked ${targetStudentIds.length} student record(s)${reshuffleQuestions ? ' with reshuffled questions' : ''}.`
              : (targetStudentIds.length ? `Student unlocked${reshuffleQuestions ? ' with reshuffled questions' : ''}.` : "Student has no locked attempt to unlock.")),
        unlockedCount: unlockedStudentIds.length,
      });
    } catch (_error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
      }
      console.error("[unlockAssessmentQuestionSetStudents]", {
        action,
        questionSetId,
        studentId,
        unlockAll,
        reshuffleQuestions,
        message: _error && _error.message ? _error.message : _error,
      });
      return res.status(500).json({
        success: false,
        error: action === 'lock'
          ? "Failed to lock student submission access."
          : "Failed to unlock student submissions.",
      });
    } finally {
      client.release();
    }
  },

  getAssessmentOptionsByScope: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const termId = Number(req.query.termId);
    const schoolYearId = Number(req.query.schoolYearId);
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;

    if (!organizationId || !Number.isInteger(termId) || !Number.isInteger(schoolYearId)) {
      return res.status(400).json({ success: false, error: "termId and schoolYearId are required." });
    }

    if ((classId !== null && (!Number.isInteger(classId) || classId <= 0)) || (subjectId !== null && (!Number.isInteger(subjectId) || subjectId <= 0))) {
      return res.status(400).json({ success: false, error: "Invalid classId or subjectId." });
    }

    try {
      await ensureAssessmentControlSchema(db);
      const params = [organizationId, termId, schoolYearId];
      let additionalWhere = "";

      if (classId !== null) {
        params.push(classId);
        additionalWhere += ` AND a.class_id = $${params.length}`;
      }

      if (subjectId !== null) {
        params.push(subjectId);
        additionalWhere += ` AND a.subject_id = $${params.length}`;
      }

      const result = await db.query(
        `SELECT
           a.assessment_id,
           a.organization_id,
           a.term_id,
           t.school_year_id,
           a.class_id,
           a.subject_id,
           a.title,
           a.weight,
           a.max_score,
           a.category,
           COALESCE(a.scale_base, 100) AS scale_base,
           COALESCE(a.open_book, FALSE) AS open_book,
           a.time_limit_minutes,
           GREATEST(COALESCE(a.max_attempts, 1), 1) AS max_attempts,
           COALESCE(a.is_locked, FALSE) AS is_locked,
           COALESCE(a.is_active, TRUE) AS is_active,
           a.edit_window_start,
           a.edit_window_end,
           c.class_name,
           s.subject_name
         FROM assessments a
         JOIN terms t
           ON t.term_id = a.term_id
          AND t.organization_id = a.organization_id
         JOIN school_years sy
           ON sy.id = t.school_year_id
          AND sy.organization_id = a.organization_id
         JOIN classes c
           ON c.class_id = a.class_id
          AND c.organization_id = a.organization_id
         LEFT JOIN subjects s
           ON s.subject_id = a.subject_id
          AND s.organization_id = a.organization_id
         WHERE a.organization_id = $1
           AND a.term_id = $2
           AND t.school_year_id = $3
           AND a.term_id IS NOT NULL
           AND a.class_id IS NOT NULL
           AND a.subject_id IS NOT NULL
           ${additionalWhere}
         ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC, s.subject_name ASC, a.title ASC, a.assessment_id ASC`,
        params
      );

      const assessments = result.rows.map((row) => {
        const editability = computeAssessmentEditability(row);
        return {
          assessment_id: Number(row.assessment_id),
          organization_id: Number(row.organization_id),
          term_id: Number(row.term_id),
          school_year_id: Number(row.school_year_id),
          class_id: Number(row.class_id),
          subject_id: Number(row.subject_id),
          title: row.title,
          weight: Number(row.weight || 0),
          max_score: Number(row.max_score || 0),
          category: row.category || "Assessment",
          scale_base: Number(row.scale_base || 100),
          open_book: Boolean(row.open_book),
          time_limit_minutes: row.time_limit_minutes !== null && row.time_limit_minutes !== undefined
            ? Number(row.time_limit_minutes)
            : null,
          max_attempts: Number(row.max_attempts || 1),
          class_name: row.class_name || "Class",
          subject_name: row.subject_name || "Subject",
          can_edit_scores: Boolean(editability.canEdit),
          access_reason: editability.reason || "",
        };
      });

      return res.json({ success: true, assessments });
    } catch (_error) {
      return res.status(500).json({ success: false, error: "Failed to load assessments." });
    }
  },

  reuseAssessmentQuestionSet: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const actorUserId = req.session.userId || req.session.user?.user_id || null;

    const sourceQuestionSetId = Number(req.body.sourceQuestionSetId);
    const targetTermId = Number(req.body.targetTermId);
    const targetClassId = Number(req.body.targetClassId);
    const targetSubjectId = Number(req.body.targetSubjectId);
    const targetAssessmentTitle = String(req.body.targetAssessmentTitle || "").trim();
    const shuffleMode = String(req.body.shuffleMode || "none").trim().toLowerCase();
    const shuffleOptions = String(req.body.shuffleOptions || "false").trim().toLowerCase() === "true";

    const validShuffleModes = new Set(["none", "random", "reverse"]);

    if (!organizationId || !Number.isInteger(sourceQuestionSetId) || sourceQuestionSetId <= 0) {
      return res.status(400).json({ success: false, error: "sourceQuestionSetId is required." });
    }
    if (!Number.isInteger(targetTermId) || targetTermId <= 0 || !Number.isInteger(targetClassId) || targetClassId <= 0 || !Number.isInteger(targetSubjectId) || targetSubjectId <= 0) {
      return res.status(400).json({ success: false, error: "targetTermId, targetClassId and targetSubjectId are required." });
    }
    if (!targetAssessmentTitle) {
      return res.status(400).json({ success: false, error: "Target assessment title is required." });
    }
    if (!validShuffleModes.has(shuffleMode)) {
      return res.status(400).json({ success: false, error: "Invalid shuffle mode." });
    }

    const client = await db.connect();
    try {
      await ensureGoogleIntegrationSchema(client);
      await client.query("BEGIN");

      const sourceSetResult = await client.query(
        `SELECT
           qs.question_set_id,
           qs.assessment_id,
           qs.set_title,
           qs.set_description,
           qs.total_points,
           a.title AS assessment_title,
           a.weight,
           a.max_score,
           a.category,
           COALESCE(a.scale_base, 100) AS scale_base,
           COALESCE(a.is_locked, FALSE) AS is_locked,
           COALESCE(a.is_active, TRUE) AS is_active,
           a.edit_window_start,
           a.edit_window_end
         FROM assessment_question_sets qs
         LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
         WHERE qs.question_set_id = $1 AND qs.organization_id = $2
         LIMIT 1`,
        [sourceQuestionSetId, organizationId]
      );

      if (!sourceSetResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Source question set not found." });
      }

      const sourceSet = sourceSetResult.rows[0];

      const sourceQuestionsResult = await client.query(
        `SELECT
           question_type,
           question_text,
           options_json,
           answer_key,
           marks,
           position_index
         FROM assessment_questions
         WHERE question_set_id = $1
         ORDER BY position_index ASC, question_id ASC`,
        [sourceQuestionSetId]
      );

      if (!sourceQuestionsResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Source question set has no questions to reuse." });
      }

      const targetTermResult = await client.query(
        `SELECT term_id
         FROM terms
         WHERE term_id = $1 AND organization_id = $2
         LIMIT 1`,
        [targetTermId, organizationId]
      );
      if (!targetTermResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Target term not found." });
      }

      const classEnrollmentResult = await client.query(
        `SELECT 1
         FROM enrollments e
         JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
         WHERE e.organization_id = $1
           AND e.term_id = $2
           AND ec.class_id = $3
         LIMIT 1`,
        [organizationId, targetTermId, targetClassId]
      );
      if (!classEnrollmentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Target class is not enrolled in the selected term." });
      }

      const subjectResult = await client.query(
        `SELECT subject_id
         FROM subjects
         WHERE organization_id = $1
           AND class_id = $2
           AND subject_id = $3
         LIMIT 1`,
        [organizationId, targetClassId, targetSubjectId]
      );
      if (!subjectResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Target subject not found for selected class." });
      }

      const groupIdResult = await client.query(
        `SELECT nextval('assessments_group_id_seq') AS next_group_id`
      );
      const newGroupId = Number(groupIdResult.rows[0].next_group_id);

      const insertAssessmentResult = await client.query(
        `INSERT INTO assessments (
           group_id,
           title,
           weight,
           max_score,
           category,
           subject_id,
           organization_id,
           term_id,
           class_id,
           is_locked,
           is_active,
           edit_window_start,
           edit_window_end,
           scale_base
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (class_id, subject_id, title, term_id) DO NOTHING
         RETURNING assessment_id, group_id`,
        [
          newGroupId,
          targetAssessmentTitle,
          sourceSet.weight || 20,
          sourceSet.max_score || 100,
          sourceSet.category || "Class Assessment",
          targetSubjectId,
          organizationId,
          targetTermId,
          targetClassId,
          Boolean(sourceSet.is_locked),
          Boolean(sourceSet.is_active),
          sourceSet.edit_window_start || null,
          sourceSet.edit_window_end || null,
          Number(sourceSet.scale_base || 100),
        ]
      );

      let targetAssessmentId = null;
      let targetGroupId = null;
      if (insertAssessmentResult.rows.length) {
        targetAssessmentId = Number(insertAssessmentResult.rows[0].assessment_id);
        targetGroupId = Number(insertAssessmentResult.rows[0].group_id);
      } else {
        const existingAssessmentResult = await client.query(
          `SELECT assessment_id, group_id
           FROM assessments
           WHERE organization_id = $1
             AND term_id = $2
             AND class_id = $3
             AND subject_id = $4
             AND title = $5
           LIMIT 1`,
          [organizationId, targetTermId, targetClassId, targetSubjectId, targetAssessmentTitle]
        );
        if (!existingAssessmentResult.rows.length) {
          await client.query("ROLLBACK");
          return res.status(500).json({ success: false, error: "Could not create or resolve target assessment." });
        }
        targetAssessmentId = Number(existingAssessmentResult.rows[0].assessment_id);
        targetGroupId = Number(existingAssessmentResult.rows[0].group_id);
      }

      const clonedSetTitle = `${sourceSet.set_title || "Question Set"} (Reuse)`;
      const insertQuestionSetResult = await client.query(
        `INSERT INTO assessment_question_sets (
           organization_id,
           term_id,
           class_id,
           subject_id,
           assessment_id,
           group_id,
           set_title,
           set_description,
           total_points,
           created_by,
           updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING question_set_id`,
        [
          organizationId,
          targetTermId,
          targetClassId,
          targetSubjectId,
          targetAssessmentId,
          targetGroupId,
          clonedSetTitle,
          sourceSet.set_description || null,
          Number(sourceSet.total_points || 0),
          actorUserId,
        ]
      );

      const targetQuestionSetId = Number(insertQuestionSetResult.rows[0].question_set_id);

      const questions = sourceQuestionsResult.rows.map((row) => ({
        question_type: row.question_type,
        question_text: row.question_text,
        options_json: Array.isArray(row.options_json) ? [...row.options_json] : [],
        answer_key: row.answer_key || null,
        marks: Number(row.marks || 0),
        position_index: Number(row.position_index || 0),
      }));

      if (shuffleMode === "reverse") {
        questions.reverse();
      } else if (shuffleMode === "random") {
        for (let i = questions.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [questions[i], questions[j]] = [questions[j], questions[i]];
        }
      }

      if (shuffleOptions) {
        questions.forEach((question) => {
          if (Array.isArray(question.options_json) && question.options_json.length > 1) {
            for (let i = question.options_json.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [question.options_json[i], question.options_json[j]] = [question.options_json[j], question.options_json[i]];
            }
          }
        });
      }

      for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];
        await client.query(
          `INSERT INTO assessment_questions (
             question_set_id,
             organization_id,
             question_type,
             question_text,
             options_json,
             answer_key,
             marks,
             position_index
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            targetQuestionSetId,
            organizationId,
            question.question_type,
            question.question_text,
            JSON.stringify(question.options_json || []),
            question.answer_key,
            Number(question.marks || 0),
            index + 1,
          ]
        );
      }

      await client.query("COMMIT");

      try {
        const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
        if (googleIntegration.shouldShowFeatures) {
          await markGoogleSync(
            db,
            organizationId,
            "queued",
            "Question set reuse detected. Google Classroom sync queued."
          );
        }
      } catch (_) {
      }

      return res.json({
        success: true,
        message: "Question set reused successfully.",
        questionSetId: targetQuestionSetId,
        assessmentId: targetAssessmentId,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
      }
      return res.status(500).json({ success: false, error: "Failed to reuse question set." });
    } finally {
      client.release();
    }
  },

  modifyAssessmentGet: async (req, res, db) => {
    const { organizationId } = req.session;
    const { termId, groupId } = req.query;

    if (!organizationId || !termId || !groupId) {
      req.flash("error", "Missing required parameters.");
      return res.redirect("/common/manageAssessment");
    }

    try {
      await ensureAssessmentControlSchema(db);
      await ensureClassDashboardLayoutSchema(db);
          await ensureGoogleIntegrationSchema(db);
          const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      // Fetch assessment details for the group
      const assessmentQuery = `
                SELECT title, weight, max_score, category,
                       COALESCE(scale_base, 100) AS scale_base,
                       COALESCE(is_locked, FALSE) AS is_locked,
                       COALESCE(is_active, TRUE) AS is_active,
            COALESCE(show_question_set_on_dashboard, FALSE) AS show_question_set_on_dashboard,
                       edit_window_start,
                       edit_window_end
                FROM assessments
                WHERE group_id = $1 AND organization_id = $2 AND term_id = $3
                LIMIT 1
            `;
      const assessmentResult = await db.query(assessmentQuery, [
        groupId,
        organizationId,
        termId,
      ]);
      const assessment = assessmentResult.rows[0];

      if (!assessment) {
        req.flash("error", "Assessment not found.");
        return res.redirect("/common/manageAssessment");
      }

      // Fetch enrolled classes for the term
      const enrolledClassesQuery = `
                SELECT c.class_id, c.class_name,
                       EXISTS (
                           SELECT 1 FROM assessments a
                           WHERE a.group_id = $1 AND a.class_id = c.class_id
                       ) AS selected
                FROM enrolled_classes ec
                INNER JOIN classes c ON ec.class_id = c.class_id
                WHERE ec.enrollment_id = (
                    SELECT enrollment_id
                    FROM enrollments
                    WHERE term_id = $2 AND organization_id = $3
                    LIMIT 1
                )
                  ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC
            `;
      const classesResult = await db.query(enrolledClassesQuery, [
        groupId,
        termId,
        organizationId,
      ]);
      const classes = classesResult.rows;

      // Fetch subjects linked to the organization
      const subjectsQuery = `
                SELECT s.subject_id, s.subject_name, s.class_id,
                       EXISTS (
                           SELECT 1 FROM assessments a
                           WHERE a.group_id = $1 AND a.subject_id = s.subject_id
                       ) AS selected
                FROM subjects s
                WHERE s.organization_id = $2
                ORDER BY s.subject_name
            `;
      const subjectsResult = await db.query(subjectsQuery, [
        groupId,
        organizationId,
      ]);
      const subjects = subjectsResult.rows;

      res.render("common/modifyAssessment", {
        title: "Modify Assessment",
        assessment,
        classes,
        subjects,
        organizationId,
        termId,
        groupId,
        canUseGoogleClassroom: googleIntegration.shouldShowFeatures,
        canUseQuestionSetIntegration,
        messages: req.flash(),
        hideGlobalHeader: true,
        hideGlobalFooter: true,
      });
    } catch (error) {
            req.flash("error", "Failed to load assessment details.");
      res.redirect("/common/manageAssessment");
    }
  },

  modifyAssessmentPost: async (req, res, db) => {
    const {
      termId,
      groupId,
      testName,
      testWeight,
      maxScore,
      category,
      scaleBase,
      classes = [],
      subjects = [],
      isLocked,
      isActive,
      editWindowStart,
      editWindowEnd,
      showQuestionSetOnDashboard,
      notifyTeachers,
    } = req.body;

    // Tenant boundary: the organization is always the caller's session org.
    // Any organizationId supplied in the request body is ignored.
    const organizationId = req.session.organizationId;

    // Validate required fields
    if (
      !organizationId ||
      !termId ||
      !groupId ||
      !testName ||
      !testWeight ||
      !maxScore ||
      !category
    ) {
            return res
        .status(400)
        .json({ error: "Organization ID and Term ID are required." });
    }

    const normalizedClassIds = (Array.isArray(classes) ? classes : [classes])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const normalizedSubjectSelections = [
      ...new Set(
        (Array.isArray(subjects) ? subjects : [subjects])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      ),
    ];

    const locked = parseBooleanValue(isLocked, false);
    const active = parseBooleanValue(isActive, true);
    const shouldNotifyTeachers = parseBooleanValue(notifyTeachers, false);
    const parsedWindowStart = parseDateTimeValue(editWindowStart);
    const parsedWindowEnd = parseDateTimeValue(editWindowEnd);

    if (parsedWindowStart && parsedWindowEnd && parsedWindowStart > parsedWindowEnd) {
      return res.status(400).json({ error: "Edit window start must be before edit window end." });
    }

    const desiredAssignments = normalizedSubjectSelections
      .map((value) => {
        const [classIdValue, subjectIdValue] = value.split("-");
        const classIdNumber = Number(classIdValue);
        const subjectIdNumber = Number(subjectIdValue);
        if (
          !Number.isInteger(classIdNumber) ||
          classIdNumber <= 0 ||
          !Number.isInteger(subjectIdNumber) ||
          subjectIdNumber <= 0 ||
          !normalizedClassIds.includes(classIdNumber)
        ) {
          return null;
        }

        return {
          key: `${classIdNumber}-${subjectIdNumber}`,
          classId: classIdNumber,
          subjectId: subjectIdNumber,
        };
      })
      .filter(Boolean);

    if (desiredAssignments.length === 0) {
      return res.status(400).json({ error: "Please select at least one subject for the chosen class list." });
    }

    const client = await db.connect();

    try {
      await ensureAssessmentControlSchema(client);
      await ensureGoogleIntegrationSchema(client);
      await ensureScoreRemarkGradeSchema(client);
      const googleIntegration = await getGoogleIntegrationStatus(client, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(client, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      const showQuestionSetFlag = canUseQuestionSetIntegration && parseBooleanValue(showQuestionSetOnDashboard, false);
      await client.query("BEGIN"); // Start transaction

      const existingAssessmentsResult = await client.query(
        `
          SELECT a.assessment_id, a.class_id, a.subject_id, a.max_score, a.category,
                 EXISTS (
                   SELECT 1
                   FROM assessment_results ar
                   WHERE ar.assessment_id = a.assessment_id
                 ) AS has_results
          FROM assessments a
          WHERE a.group_id = $1 AND a.organization_id = $2 AND a.term_id = $3
          ORDER BY a.assessment_id ASC
        `,
        [groupId, organizationId, termId]
      );

      const existingAssessments = existingAssessmentsResult.rows;
      const existingByPair = new Map(
        existingAssessments.map((row) => [`${row.class_id}-${row.subject_id}`, row])
      );
      const desiredByPair = new Map(
        desiredAssignments.map((assignment) => [assignment.key, assignment])
      );

      const parsedScaleBase = parseInt(scaleBase) > 0 ? parseInt(scaleBase) : 100;
      const normalizedRequestedCategory = String(category || "").trim();
      const normalizedRequestedMaxScore = Number(maxScore);

      const updateAssessmentMetadata = async (assessmentId, assignment) => {
        await client.query(
          `
            UPDATE assessments
            SET title = $1,
                weight = $2,
                max_score = $3,
                category = $4,
                subject_id = $5,
                class_id = $6,
                is_locked = $7,
                is_active = $8,
                edit_window_start = $9,
                edit_window_end = $10,
                scale_base = $11,
                show_question_set_on_dashboard = $12
            WHERE assessment_id = $13
          `,
          [
            testName,
            testWeight,
            maxScore,
            category,
            assignment.subjectId,
            assignment.classId,
            locked,
            active,
            parsedWindowStart,
            parsedWindowEnd,
            parsedScaleBase,
            showQuestionSetFlag,
            assessmentId,
          ]
        );
      };

      const recalculateAssignmentSummaries = async (queryable, assignment) => {
        await queryable.query(
          `
            DELETE FROM category_scores
            WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3 AND term_id = $4
          `,
          [assignment.subjectId, assignment.classId, organizationId, termId]
        );
        await queryable.query(
          `
            INSERT INTO category_scores (
              student_id,
              class_id,
              subject_id,
              organization_id,
              category,
              total_score,
              term_id
            )
            SELECT
              ar.student_id,
              ar.class_id,
              ar.subject_id,
              ar.organization_id,
              a.category,
              SUM(ar.score)::numeric,
              ar.term_id
            FROM assessment_results ar
            JOIN assessments a ON a.assessment_id = ar.assessment_id
            WHERE ar.subject_id = $1
              AND ar.class_id = $2
              AND ar.organization_id = $3
              AND ar.term_id = $4
              AND ar.score IS NOT NULL
            GROUP BY ar.student_id, ar.class_id, ar.subject_id, ar.organization_id, a.category, ar.term_id
            ON CONFLICT (student_id, class_id, subject_id, organization_id, category, term_id)
            DO UPDATE SET total_score = EXCLUDED.total_score
          `,
          [assignment.subjectId, assignment.classId, organizationId, termId]
        );

        await queryable.query(
          `
            WITH summarized AS (
              SELECT
                ar.student_id,
                ar.subject_id,
                ar.class_id,
                ar.term_id,
                SUM(CASE WHEN ar.score IS NULL THEN 0 ELSE ar.score END)::numeric AS total_subject_score,
                SUM(CASE WHEN ar.score IS NULL THEN 0 ELSE a.max_score END)::numeric AS max_total_score
              FROM assessment_results ar
              JOIN assessments a ON a.assessment_id = ar.assessment_id
              WHERE ar.subject_id = $1
                AND ar.class_id = $2
                AND ar.organization_id = $3
                AND ar.term_id = $4
              GROUP BY ar.student_id, ar.subject_id, ar.class_id, ar.term_id
            ),
            decorated AS (
              SELECT
                s.student_id,
                s.subject_id,
                s.class_id,
                s.term_id,
                s.total_subject_score,
                CASE
                  WHEN s.max_total_score > 0 THEN (s.total_subject_score / s.max_total_score) * 100
                  ELSE NULL
                END AS total_percentage
              FROM summarized s
            )
            UPDATE assessment_results ar
            SET total_subject_score = d.total_subject_score,
                total_percentage = d.total_percentage,
                grade = COALESCE(
                  (
                    SELECT NULLIF(TRIM(sr.grade_label), '')
                    FROM score_remarks sr
                    WHERE sr.organization_id = $3
                      AND sr.class_id = $2
                      AND sr.term_id = $4
                      AND d.total_percentage IS NOT NULL
                      AND d.total_percentage BETWEEN sr.from_percentage AND sr.to_percentage
                    ORDER BY sr.from_percentage DESC
                    LIMIT 1
                  ),
                  CASE
                    WHEN d.total_percentage IS NULL THEN '-'
                    WHEN d.total_percentage >= 90 THEN 'A'
                    WHEN d.total_percentage >= 80 THEN 'B'
                    WHEN d.total_percentage >= 70 THEN 'C'
                    ELSE 'D'
                  END
                )
            FROM decorated d
            WHERE ar.student_id = d.student_id
              AND ar.subject_id = d.subject_id
              AND ar.class_id = d.class_id
              AND ar.organization_id = $3
              AND ar.term_id = d.term_id
          `,
          [assignment.subjectId, assignment.classId, organizationId, termId]
        );

        await queryable.query(
          `
            WITH ranked_scores AS (
              SELECT
                student_id,
                subject_id,
                class_id,
                term_id,
                SUM(score) AS total_subject_score,
                RANK() OVER (
                  PARTITION BY subject_id, class_id, term_id
                  ORDER BY SUM(score) DESC
                ) AS position
              FROM assessment_results
              WHERE subject_id = $1 AND class_id = $2 AND organization_id = $3 AND term_id = $4
              GROUP BY student_id, subject_id, class_id, term_id
            )
            INSERT INTO student_positions (student_id, subject_id, organization_id, total_subject_score, position, class_id, term_id)
            SELECT student_id, subject_id, $3, total_subject_score, position, class_id, term_id
            FROM ranked_scores
            ON CONFLICT (student_id, subject_id)
            DO UPDATE SET
              total_subject_score = EXCLUDED.total_subject_score,
              position = EXCLUDED.position,
              class_id = EXCLUDED.class_id,
              term_id = EXCLUDED.term_id
          `,
          [assignment.subjectId, assignment.classId, organizationId, termId]
        );
      };

      let scoreRelevantMetadataChanged = false;

      for (const assignment of desiredAssignments) {
        const existingAssessment = existingByPair.get(assignment.key);
        if (existingAssessment) {
          const existingMaxScore = Number(existingAssessment.max_score);
          const existingCategory = String(existingAssessment.category || "").trim();
          if (
            existingMaxScore !== normalizedRequestedMaxScore ||
            existingCategory !== normalizedRequestedCategory
          ) {
            scoreRelevantMetadataChanged = true;
          }

          await updateAssessmentMetadata(existingAssessment.assessment_id, assignment);
        }
      }

      const reusableAssessments = existingAssessments.filter(
        (row) => !desiredByPair.has(`${row.class_id}-${row.subject_id}`)
      );
      const newAssignments = desiredAssignments.filter(
        (assignment) => !existingByPair.has(assignment.key)
      );
      const assignmentsChanged =
        newAssignments.length > 0 || reusableAssessments.length > 0;

      const reusableCount = Math.min(reusableAssessments.length, newAssignments.length);
      for (let index = 0; index < reusableCount; index += 1) {
        await updateAssessmentMetadata(
          reusableAssessments[index].assessment_id,
          newAssignments[index]
        );
      }

      for (let index = reusableCount; index < newAssignments.length; index += 1) {
        const assignment = newAssignments[index];
        const insertQuery = `
                  INSERT INTO assessments (
                group_id, title, weight, max_score, category, subject_id, organization_id, term_id, class_id,
                is_locked, is_active, edit_window_start, edit_window_end, scale_base, show_question_set_on_dashboard
                  ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
                  )
                  ON CONFLICT ON CONSTRAINT unique_test_per_term_class_subject DO NOTHING
              `;
        await client.query(insertQuery, [
        groupId,
          testName,
          testWeight,
          maxScore,
          category,
          assignment.subjectId,
          organizationId,
          termId,
          assignment.classId,
          locked,
          active,
          parsedWindowStart,
          parsedWindowEnd,
          parsedScaleBase,
          showQuestionSetFlag,
        ]);
      }

      const staleAssessments = reusableAssessments.slice(reusableCount);
      for (const staleAssessment of staleAssessments) {
        if (!staleAssessment.has_results) {
          await client.query(
            `DELETE FROM assessments WHERE assessment_id = $1`,
            [staleAssessment.assessment_id]
          );
        } else {
          await client.query(
            `
              UPDATE assessments
              SET title = $1,
                  weight = $2,
                  max_score = $3,
                  category = $4,
                  is_locked = $5,
                  is_active = $6,
                  edit_window_start = $7,
                  edit_window_end = $8,
                  scale_base = $9,
                  show_question_set_on_dashboard = $10
              WHERE assessment_id = $11
            `,
            [
              testName,
              testWeight,
              maxScore,
              category,
              locked,
              active,
              parsedWindowStart,
              parsedWindowEnd,
              parsedScaleBase,
              showQuestionSetFlag,
              staleAssessment.assessment_id,
            ]
          );
        }
      }

      let finalAssignmentsForRecalc = [];
      if (assignmentsChanged || scoreRelevantMetadataChanged) {
        const finalAssignmentsResult = await client.query(
          `
            SELECT DISTINCT class_id, subject_id
            FROM assessments
            WHERE group_id = $1 AND organization_id = $2 AND term_id = $3
          `,
          [groupId, organizationId, termId]
        );

        finalAssignmentsForRecalc = finalAssignmentsResult.rows.map((row) => ({
          classId: Number(row.class_id),
          subjectId: Number(row.subject_id),
        }));
      }

      await client.query("COMMIT"); // Commit transaction

      // Respond immediately after commit for the fastest UX.
      res.status(200).json({
        message: "Assessment updated successfully.",
      });

      // Run expensive recalculation and notifications after response.
      setImmediate(async () => {
        try {
          // Keep request latency low: align denormalized assessment_result metadata in background.
          await db.query(
            `
              UPDATE assessment_results ar
              SET title = a.title,
                  subject_id = a.subject_id,
                  class_id = a.class_id,
                  category = a.category,
                  term_id = a.term_id,
                  organization_id = a.organization_id
              FROM assessments a
              WHERE ar.assessment_id = a.assessment_id
                AND a.group_id = $1
                AND a.organization_id = $2
                AND a.term_id = $3
                AND (
                  ar.title IS DISTINCT FROM a.title OR
                  ar.subject_id IS DISTINCT FROM a.subject_id OR
                  ar.class_id IS DISTINCT FROM a.class_id OR
                  ar.category IS DISTINCT FROM a.category OR
                  ar.term_id IS DISTINCT FROM a.term_id OR
                  ar.organization_id IS DISTINCT FROM a.organization_id
                )
            `,
            [groupId, organizationId, termId]
          );

          if (finalAssignmentsForRecalc.length > 0) {
            for (const assignment of finalAssignmentsForRecalc) {
              await recalculateAssignmentSummaries(db, assignment);
            }
          }

          let termName = "Unknown Term";
          if (normalizedClassIds.length > 0 || shouldNotifyTeachers) {
            try {
              const termResult = await db.query(
                `SELECT term_name FROM terms WHERE term_id = $1`,
                [termId]
              );
              termName = termResult.rows[0]?.term_name || "Unknown Term";
            } catch (termErr) {
              console.error("[ModifyAssessment] Failed to resolve term name:", termErr.message);
            }
          }

          if (shouldNotifyTeachers && normalizedClassIds.length > 0) {
            notifyTeachersForAssessmentControl({
              database: db,
              organizationId: Number(organizationId),
              classIds: normalizedClassIds,
              testTitle: testName,
              termName,
              lockState: locked,
              activeState: active,
              editWindowStart: parsedWindowStart,
              editWindowEnd: parsedWindowEnd,
            }).catch((notifyErr) => {
              console.error("[Notify] modifyAssessment teacher email failed:", notifyErr.message);
            });
          }

          if (normalizedClassIds.length) {
            notifSvc.notifyPerClassTeachers(db, {
              orgId: Number(organizationId),
              classIds: normalizedClassIds,
              type: "assessment_modified",
              title: `✏️ ${testName}`,
              body: `Updated · ${termName}`,
              linkTemplate: "/common/classDashboard/{classId}/subject",
            }).catch((err) =>
              console.error("[Notif] assessment_modified failed:", err.message)
            );
          }

          if (googleIntegration.shouldShowFeatures) {
            await markGoogleSync(
              db,
              organizationId,
              "queued",
              "Assessment updates detected. Google Classroom sync queued."
            ).catch(() => {});

            pushPendingAssessmentsForOrganization(Number(organizationId), {
              dbClient: db,
              limit: 200,
              includeExisting: true,
            }).catch((err) =>
              console.error("[ModifyAssessment] Google Classroom push failed:", err?.message || err)
            );
          }
        } catch (backgroundErr) {
          console.error(
            "[ModifyAssessment] Background post-save work failed:",
            backgroundErr.message
          );
        }
      });
    } catch (error) {
            await client.query("ROLLBACK"); // Rollback transaction
      res
        .status(500)
        .json({ error: `Failed to update assessment. ${error.message}` });
    } finally {
      client.release();
    }
  },

  updateAssessmentControlPost: async (req, res, db) => {
    const { groupId, termId, action } = req.body;
    const organizationId = req.session.organizationId;

    if (!groupId || !organizationId || !termId || !action) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const allowedActions = new Set(["lock", "unlock", "activate", "deactivate"]);
    if (!allowedActions.has(String(action))) {
      return res.status(400).json({ error: "Invalid action." });
    }

    const updates = {
      lock: { column: "is_locked", value: true },
      unlock: { column: "is_locked", value: false },
      activate: { column: "is_active", value: true },
      deactivate: { column: "is_active", value: false },
    };

    const { column, value } = updates[action];

    try {
      await ensureAssessmentControlSchema(db);
      await db.query(
        `
          UPDATE assessments
          SET ${column} = $1
          WHERE group_id = $2 AND organization_id = $3 AND term_id = $4
        `,
        [value, groupId, organizationId, termId]
      );

      // Notify teachers about the assessment control change
      notifyTeachersOnAssessmentControl(db, { organizationId, groupId, termId, action })
        .catch(err => console.error("[Notify] Assessment control notification failed:", err.message));

      // B3/B4 — bell notification to class teachers when assessment locked/unlocked
      if (action === 'lock' || action === 'unlock') {
        try {
          const classRows = await db.query(
            `SELECT DISTINCT a.class_id
             FROM assessments a
             WHERE a.group_id = $1 AND a.organization_id = $2`,
            [groupId, organizationId]
          );
          const affectedClassIds = classRows.rows.map(r => r.class_id).filter(Boolean);
          if (affectedClassIds.length) {
            // Get a test name for the title
            const nameRow = await db.query(
              `SELECT test_name FROM assessments WHERE group_id = $1 LIMIT 1`,
              [groupId]
            );
            const testName = nameRow.rows[0]?.test_name || 'Assessment';
            notifSvc.notifyPerClassTeachers(db, {
              orgId: Number(organizationId),
              classIds: affectedClassIds,
              type: action === 'lock' ? 'assessment_locked' : 'assessment_unlocked',
              title: action === 'lock'
                ? `🔒 ${testName}`
                : `🔓 ${testName}`,
              body: action === 'lock'
                ? 'Score entry closed.'
                : 'Score entry open.',
              linkTemplate: '/common/classDashboard/{classId}/subject',
            }).catch(err => console.error('[Notif] assessment lock/unlock failed:', err.message));
          }
        } catch { /* silent */ }
      }

      return res.status(200).json({ message: "Assessment control updated successfully." });
    } catch (error) {
      return res.status(500).json({ error: "Failed to update assessment control." });
    }
  },

  updateAssessmentItemControlPost: async (req, res, db) => {
    const organizationId = Number(req.session.organizationId);
    const assessmentId = Number(req.body.assessmentId);
    const action = String(req.body.action || "").trim().toLowerCase();

    if (!organizationId || !Number.isInteger(assessmentId) || assessmentId <= 0 || !action) {
      return res.status(400).json({ success: false, error: "assessmentId and action are required." });
    }

    const allowedActions = new Set(["lock", "open", "reactivate"]);
    if (!allowedActions.has(action)) {
      return res.status(400).json({ success: false, error: "Invalid action." });
    }

    try {
      await ensureAssessmentControlSchema(db);

      let updateQuery = "";
      if (action === "lock") {
        updateQuery = `
          UPDATE assessments
          SET is_locked = TRUE
          WHERE assessment_id = $1 AND organization_id = $2
        `;
      } else if (action === "open") {
        updateQuery = `
          UPDATE assessments
          SET is_locked = FALSE
          WHERE assessment_id = $1 AND organization_id = $2
        `;
      } else {
        updateQuery = `
          UPDATE assessments
          SET is_locked = FALSE,
              is_active = TRUE
          WHERE assessment_id = $1 AND organization_id = $2
        `;
      }

      const updateResult = await db.query(updateQuery, [assessmentId, organizationId]);
      if (!updateResult.rowCount) {
        return res.status(404).json({ success: false, error: "Assessment not found." });
      }

      return res.json({ success: true, message: "Assessment status updated successfully." });
    } catch (_error) {
      return res.status(500).json({ success: false, error: "Failed to update assessment status." });
    }
  },

  // Controller to delete an assessment group
  deleteAssessmentPost: async (req, res, db) => {
    const { groupId } = req.body;
    const organizationId = req.session.organizationId;

    if (!groupId) {
      return res.status(400).json({ error: "Group ID is required." });
    }
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN"); // Start a transaction

      // assessment_results.assessment_id is ON DELETE CASCADE, so this
      // used to silently delete every student score already entered for
      // the test along with it - no check, no warning. Block instead,
      // same principle as the class/school-year/term delete guards.
      const resultCount = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM assessment_results ar
         JOIN assessments a ON a.assessment_id = ar.assessment_id
         WHERE a.group_id = $1 AND a.organization_id = $2`,
        [groupId, organizationId]
      );
      const scoreCount = Number(resultCount.rows[0]?.count || 0);
      if (scoreCount > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Cannot delete this test because ${scoreCount} student score${scoreCount === 1 ? "" : "s"} have already been entered for it. Remove those results first, then try again.`,
        });
      }

      // Delete all assessments associated with the given group ID --
      // restricted to the caller's organization to prevent cross-org
      // deletions when group ids are guessable.
      const deleteResult = await client.query(
        `DELETE FROM assessments
             WHERE group_id = $1 AND organization_id = $2`,
        [groupId, organizationId]
      );
      if (deleteResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Test was not found or could not be deleted." });
      }

      await client.query("COMMIT"); // Commit the transaction
      res
        .status(200)
        .json({ message: "Assessment group deleted successfully." });
    } catch (err) {
      await client.query("ROLLBACK"); // Rollback transaction on error
            res.status(500).json({ error: "Failed to delete assessment group." });
    } finally {
      client.release();
    }
  },

  createTestGet: async (req, res, db) => {
    const { organizationId } = req.session;
    const { termId: urlTermId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is required.");
      return res.redirect("/common/orgDashboard");
    }

    try {
      await ensureClassDashboardLayoutSchema(db);
      await ensureGoogleIntegrationSchema(db);
      const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      // Fetch the current term for the organization
      const termQuery = `
        SELECT term_id, term_name 
        FROM terms 
        WHERE organization_id = $1 AND (current = TRUE OR (start_date <= NOW() AND end_date >= NOW()))
        ORDER BY current DESC, start_date DESC LIMIT 1
    `;

      const termResult = await db.query(termQuery, [organizationId]);

      if (termResult.rows.length === 0) {
        req.flash(
          "error",
          "No active term found for the organization. Please create or set a term to be able to create & manage assessment scores"
        );
        return res.redirect("/common/manageRecords");
      }

      // Assign termId either from URL or the fetched current term
      const currentTerm = termResult.rows[0];
      const termId = urlTermId || currentTerm.term_id;

      // Fetch enrolled classes for the organization
      const enrolledClassesQuery = `
            SELECT c.class_id, c.class_name
            FROM enrolled_classes ec
            INNER JOIN classes c ON ec.class_id = c.class_id
            WHERE ec.enrollment_id = (
                SELECT enrollment_id 
                FROM enrollments 
                WHERE term_id = $1 AND organization_id = $2
                LIMIT 1
            )
            ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC
        `;
      const enrolledClassesResult = await db.query(enrolledClassesQuery, [
        termId,
        organizationId,
      ]);
      const classes = enrolledClassesResult.rows;

      // Fetch subjects associated with the organization
      const subjectsResult = await db.query(
        `SELECT * FROM subjects WHERE organization_id = $1 ORDER BY subject_name`,
        [organizationId]
      );
      const subjects = subjectsResult.rows;

      // Render the createTest view with enrolled classes only
      res.render("common/createTest", {
        title: "Add New Test",
        classes, // Only enrolled classes
        subjects,
        organizationId,
        termId,
        currentTerm,
        canUseGoogleClassroom: googleIntegration.shouldShowFeatures,
        canUseQuestionSetIntegration,
        messages: req.flash(),
        hideGlobalHeader: true,
        hideGlobalFooter: true,
      });
    } catch (error) {
      req.flash("error", "Failed to load create test form.");
            res.redirect(
        `/common/createTest?organizationId=${organizationId}&termId=${urlTermId}`
      );
    }
  },

  createTestPost: async (req, res, db) => {
    const { termId: formTermId, tests } = req.body;
    // Tenant boundary: organization is always the caller's session org;
    // any organizationId supplied in the request body is ignored.
    const organizationId = req.session.organizationId;

    if (!organizationId || !formTermId) {
      return res
        .status(400)
        .json({ error: "Organization ID and Term ID are required." });
    }

    const client = await db.connect();

    try {
      await ensureAssessmentControlSchema(client);
      await ensureGoogleIntegrationSchema(client);
      const googleIntegration = await getGoogleIntegrationStatus(client, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(client, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      await client.query("BEGIN"); // Start a transaction

      // Track the classes for which tests were added
      const addedClasses = new Set();
      const pendingTeacherNotifications = [];

      for (const test of tests) {
        const selectedClasses = test.classes;
        const selectedSubjects = test.subjects;
        const locked = parseBooleanValue(test.isLocked, false);
        const active = parseBooleanValue(test.isActive, true);
        const showQuestionSetFlag = canUseQuestionSetIntegration && parseBooleanValue(test.showQuestionSetOnDashboard, false);
        const notifyTeachers = parseBooleanValue(test.notifyTeachers, false);
        const parsedWindowStart = parseDateTimeValue(test.editWindowStart);
        const parsedWindowEnd = parseDateTimeValue(test.editWindowEnd);

        if (parsedWindowStart && parsedWindowEnd && parsedWindowStart > parsedWindowEnd) {
          throw new Error(`Invalid edit window for test \"${test.testName}\".`);
        }

        if (
          !selectedClasses ||
          !selectedSubjects ||
          selectedClasses.length === 0 ||
          selectedSubjects.length === 0
        ) {
          throw new Error("At least one Class ID and Subject ID are required.");
        }

        // Generate a unique group ID for this form's assessments
        const groupIdResult = await client.query(
          `SELECT nextval('assessments_group_id_seq') AS next_group_id`
        );
        const newGroupId = groupIdResult.rows[0].next_group_id;

        for (let cls of selectedClasses) {
          addedClasses.add(cls); // Track the class ID
          const subjectsForClass = selectedSubjects.filter((subject) => {
            const subjectClassId = subject.split("-")[0];
            return subjectClassId == cls;
          });

          for (let subject of subjectsForClass) {
            const [, subj] = subject.split("-");

            // Insert the test while allowing duplicate names for different subjects or terms
            const parsedScaleBase = parseInt(test.scaleBase) > 0 ? parseInt(test.scaleBase) : 100;
            const insertAssessmentQuery = `
                        INSERT INTO assessments (
                    group_id, title, weight, max_score, category, subject_id, organization_id, term_id, class_id,
                is_locked, is_active, edit_window_start, edit_window_end, scale_base, show_question_set_on_dashboard
                        ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
                        )
                        ON CONFLICT (class_id, subject_id, title, term_id) DO NOTHING
                    `;
            await client.query(insertAssessmentQuery, [
              newGroupId,
              test.testName,
              test.testWeight,
              test.maxScore,
              test.category,
              subj,
              organizationId,
              formTermId,
              cls,
              locked,
              active,
              parsedWindowStart,
              parsedWindowEnd,
              parsedScaleBase,
              showQuestionSetFlag,
            ]);
          }
        }

        if (notifyTeachers) {
          pendingTeacherNotifications.push({
            classIds: selectedClasses.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
            testTitle: test.testName,
            lockState: locked,
            activeState: active,
            editWindowStart: parsedWindowStart,
            editWindowEnd: parsedWindowEnd,
          });
        }
      }

      // Fetch term name
      const termQuery = `SELECT term_name FROM terms WHERE term_id = $1`;
      const termResult = await client.query(termQuery, [formTermId]);
      const termName = termResult.rows[0]?.term_name || "Unknown Term";

      // Fetch class names
      const classQuery = `
            SELECT class_name
            FROM classes
            WHERE class_id = ANY($1::int[])
        ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}
        `;
      const classResult = await client.query(classQuery, [
        Array.from(addedClasses),
      ]);
      const classNames = classResult.rows.map((row) => row.class_name);

      await client.query("COMMIT"); // Commit the transaction

      for (const notification of pendingTeacherNotifications) {
        if (!notification.classIds.length) continue;
        await notifyTeachersForAssessmentControl({
          database: db,
          organizationId: Number(organizationId),
          classIds: notification.classIds,
          testTitle: notification.testTitle,
          termName,
          lockState: notification.lockState,
          activeState: notification.activeState,
          editWindowStart: notification.editWindowStart,
          editWindowEnd: notification.editWindowEnd,
        });
      }

      // B1 — notify class teachers of the new assessment(s) via in-app bell
      const classIdsArr = Array.from(addedClasses).map(Number).filter(Boolean);
      if (classIdsArr.length) {
        const testNames = [...new Set(tests.map(t => t.testName).filter(Boolean))];
        const titleText = testNames.length === 1
          ? `➕ ${testNames[0]}`
          : `➕ ${testNames.length} assessments added`;
        notifSvc.notifyPerClassTeachers(db, {
          orgId: Number(organizationId),
          classIds: classIdsArr,
          type: 'assessment_created',
          title: titleText,
          body: `Added · ${termName}`,
          linkTemplate: '/common/classDashboard/{classId}/subject',
        }).catch(err => console.error('[Notif] assessment_created failed:', err.message));
      }

      try {
        const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
        if (googleIntegration.shouldShowFeatures) {
          await markGoogleSync(
            db,
            organizationId,
            "queued",
            "Assessment creation detected. Google Classroom sync queued."
          );

          pushPendingAssessmentsForOrganization(Number(organizationId), {
            dbClient: db,
            limit: 200,
          }).catch(() => {});
        }
      } catch (_) {
      }

      // Respond with the success message
      res.status(200).json({
        message: `Tests added successfully to Term: ${termName} for Classes: ${classNames.join(
          ", "
        )}`,
      });
    } catch (error) {
      await client.query("ROLLBACK");
            res.status(400).json({ error: `Failed to add tests. ${error.message}` });
    } finally {
      client.release();
    }
  },

  deleteEmployee: async (req, res, db) => {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).send("User ID is required.");
    }

    const organizationId = req.session.organizationId;
    const requesterUserId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
    let replacementUser = null;

    try {
      await db.query("BEGIN");

      // Confirm employee exists in this organization
      const employeeResult = await db.query(
        "SELECT user_id, first_name, last_name, account_type FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1",
        [userId, organizationId]
      );

      if (employeeResult.rows.length === 0) {
        await db.query("ROLLBACK");
        req.flash("error", "Employee not found in this organization.");
        return res.redirect("/common/manageEmployees");
      }

      const employee = employeeResult.rows[0];
      const allPermissionKeys = PERMISSION_OPTIONS.map((permission) => permission.key);
      const toPermissionSet = (keys) => new Set((keys || []).map((key) => String(key || "").trim()).filter(Boolean));
      const areSetsEqual = (a, b) => {
        if (a.size !== b.size) return false;
        for (const value of a) {
          if (!b.has(value)) return false;
        }
        return true;
      };

      if (employee.account_type === "Manager") {
        const primaryManagerUserId = await getPrimaryManagerUserId(db, organizationId);
        const isPrimaryManager =
          primaryManagerUserId !== null && String(primaryManagerUserId) === String(userId);

        if (isPrimaryManager) {
          const fullPermissionSet = toPermissionSet(allPermissionKeys);

          const replacementCandidatesResult = await db.query(
            `
              SELECT
                u.user_id,
                u.account_type,
                ARRAY(
                  SELECT up.permission_key
                  FROM user_permissions up
                  WHERE up.user_id = u.user_id
                    AND up.organization_id = u.organization_id
                  ORDER BY up.permission_key
                ) AS permissions
              FROM users u
              WHERE u.organization_id = $1
                AND u.user_id <> $2
                AND LOWER(u.account_type) IN ('manager', 'supervisor')
              ORDER BY
                CASE WHEN LOWER(u.account_type) = 'manager' THEN 0 ELSE 1 END,
                u.created_at ASC NULLS LAST,
                u.user_id ASC
            `,
            [organizationId, userId]
          );

          for (const candidate of replacementCandidatesResult.rows) {
            const candidateRole = String(candidate.account_type || "").toLowerCase();
            const candidatePermissions = toPermissionSet(candidate.permissions || []);
            const candidateEffectivePermissions =
              candidateRole === "manager" && candidatePermissions.size === 0
                ? fullPermissionSet
                : candidatePermissions;

            if (areSetsEqual(candidateEffectivePermissions, fullPermissionSet)) {
              replacementUser = candidate;
              break;
            }
          }

          if (!replacementUser) {
            await db.query("ROLLBACK");
            req.flash(
              "error",
              "Primary manager cannot be deleted until another Manager or Supervisor with all permissions exists."
            );
            return res.redirect("/common/manageEmployees");
          }

          const replacementRole = String(replacementUser.account_type || "").toLowerCase();
          if (replacementRole === "supervisor") {
            await db.query(
              `
                UPDATE users
                SET account_type = 'Manager', updated_at = NOW()
                WHERE user_id = $1 AND organization_id = $2
              `,
              [replacementUser.user_id, organizationId]
            );

            await db.query(
              "DELETE FROM user_permissions WHERE user_id = $1 AND organization_id = $2",
              [replacementUser.user_id, organizationId]
            );

            await db.query(
              `
                INSERT INTO user_permissions (user_id, organization_id, permission_key, granted_by)
                SELECT $1, $2, unnest($3::text[]), $4
              `,
              [
                replacementUser.user_id,
                organizationId,
                allPermissionKeys,
                requesterUserId ? Number(requesterUserId) : null,
              ]
            );
          }
        }
      }

      // Determine fallback owner for documents created by this employee
      // IMPORTANT: requesterUserId may be organization_id for org-account logins,
      // so only select fallback from actual users table in this organization.
      const fallbackResult = await db.query(
        `SELECT user_id
         FROM users
         WHERE organization_id = $1
           AND user_id <> $2
         ORDER BY CASE
                    WHEN $3::int IS NOT NULL AND user_id = $3::int THEN 0
                    WHEN account_type IN ('Manager', 'Admin', 'Mini Admin', 'Supervisor') THEN 1
                    ELSE 2
                  END,
                  created_at ASC
         LIMIT 1`,
        [organizationId, userId, requesterUserId ? Number(requesterUserId) : null]
      );
      const fallbackOwnerId = fallbackResult.rows[0]?.user_id || null;

      // Reassign ownership of documents if documents table exists
      try {
        const docsTableExists = await db.query(`SELECT to_regclass('public.documents') AS tbl`);
        if (docsTableExists.rows[0]?.tbl) {
          const docsOwnedResult = await db.query(
            "SELECT COUNT(*)::int AS count FROM documents WHERE organization_id = $1 AND created_by = $2",
            [organizationId, userId]
          );
          const docsOwnedCount = docsOwnedResult.rows[0]?.count || 0;

          if (docsOwnedCount > 0 && !fallbackOwnerId) {
            throw new Error("This employee owns documents and cannot be deleted because there is no fallback owner to transfer them to.");
          }

          if (docsOwnedCount > 0 && fallbackOwnerId) {
            await db.query(
              "UPDATE documents SET created_by = $1, updated_at = NOW() WHERE organization_id = $2 AND created_by = $3",
              [fallbackOwnerId, organizationId, userId]
            );
          }
        }
      } catch (documentError) {
        throw documentError;
      }

      await db.query("DELETE FROM user_classes WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM user_subjects WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM user_permissions WHERE user_id = $1", [userId]);

      const deleteResult = await db.query(
        "DELETE FROM users WHERE user_id = $1 AND organization_id = $2",
        [userId, organizationId]
      );

      if (deleteResult.rowCount === 0) {
        throw new Error("Employee deletion failed. The employee could not be removed.");
      }

      await db.query("COMMIT");
      if (replacementUser?.user_id) {
        invalidateUserPermissionCache(organizationId, replacementUser.user_id);
      }
      invalidateUserPermissionCache(organizationId, userId);

      req.flash("success", "Employee deleted successfully.");
      res.redirect("/common/manageEmployees");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch (rollbackError) {}

      if (error?.code === "23503") {
        let detailedMessage = "Failed to delete employee: this user is linked to protected records.";

        try {
          if (error?.constraint) {
            const fkInfoResult = await db.query(
              `SELECT ns.nspname AS schema_name,
                      cls.relname AS table_name,
                      att.attname AS column_name
               FROM pg_constraint con
               JOIN pg_class cls ON cls.oid = con.conrelid
               JOIN pg_namespace ns ON ns.oid = cls.relnamespace
               JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
               JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.attnum
               WHERE con.conname = $1
               LIMIT 1`,
              [error.constraint]
            );

            const fkInfo = fkInfoResult.rows[0];

            if (fkInfo) {
              const qSchema = String(fkInfo.schema_name).replace(/"/g, '""');
              const qTable = String(fkInfo.table_name).replace(/"/g, '""');
              const qColumn = String(fkInfo.column_name).replace(/"/g, '""');

              const countResult = await db.query(
                `SELECT COUNT(*)::int AS count
                 FROM "${qSchema}"."${qTable}"
                 WHERE "${qColumn}" = $1`,
                [userId]
              );

              const linkedCount = countResult.rows[0]?.count || 0;
              detailedMessage = `Failed to delete employee: linked to ${linkedCount} record(s) in ${fkInfo.table_name} (${fkInfo.column_name}). Reassign or remove those records and try again.`;
            }
          } else if (error?.detail) {
            const tableMatch = String(error.detail).match(/table\s+"([^"]+)"/i);
            if (tableMatch) {
              detailedMessage = `Failed to delete employee: linked records still exist in ${tableMatch[1]}. Reassign or remove them and try again.`;
            }
          }
        } catch (fkLookupError) {
          // Keep fallback message if FK introspection fails
        }

        req.flash("error", detailedMessage);
      } else if (error?.message) {
        req.flash("error", `Failed to delete employee: ${error.message}`);
      } else {
        req.flash("error", "Failed to delete employee.");
      }
      res.redirect("/common/manageEmployees");
    }
  },

  classDashboard: async (req, res, db, csrfToken) => {
    const classId = req.params.classId || req.query.classId;
    const requestedTermId = Number.parseInt(req.query.termId || req.session.currentTermId, 10);
    if (!classId) {
      res.redirect("/common/orgDashboard");
      return;
    }

    try {
      const organizationId = req.session.organizationId;
      const currentUserRole = req.session.userRole;
      const currentUserId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
      const normalizedRole = normalizeRoleKey(currentUserRole || req.session.accountType);
      await ensureStudentReportCustomRemarksColumn(db);
      await ensureGoogleIntegrationSchema(db);
      const googleIntegration = await getGoogleIntegrationStatus(db, organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      const canSetAssessmentQuestions = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.SET_ASSESSMENT_QUESTIONS
      );
      const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
      const canAccessAssessmentQuestions =
        canUseQuestionSetIntegration && setAssessmentQuestionsFeatureEnabled && canSetAssessmentQuestions;
      const canManageAllClassAssessmentExams = ["manager", "supervisor"].includes(normalizedRole);

      // Fetch the current school year and term
      const schoolYearResult = await db.query(
        `
            SELECT sy.id as school_year_id, sy.year_label, t.term_id, t.term_name, t.start_date, t.end_date, t.current
            FROM school_years sy
            LEFT JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE
            ORDER BY t.start_date
            `,
        [organizationId]
      );

      let schoolYear = null;
      let currentTerm = null;

      if (schoolYearResult.rows.length > 0) {
        schoolYear = {
          id: schoolYearResult.rows[0].school_year_id,
          year_label: schoolYearResult.rows[0].year_label,
          terms: schoolYearResult.rows.map((row) => ({
            term_id: row.term_id,
            term_name: row.term_name,
            start_date: row.start_date,
            end_date: row.end_date,
            current: row.current,
          })),
        };

        // Prefer selected/session term when present; otherwise fall back to current.
        currentTerm = Number.isInteger(requestedTermId)
          ? schoolYearResult.rows.find((row) => Number(row.term_id) === requestedTermId)
          : null;
        if (!currentTerm) {
          currentTerm = schoolYearResult.rows.find((row) => row.current) || schoolYearResult.rows[0] || null;
        }
      }

      // If no current term is found, redirect to the org dashboard
      if (!currentTerm) {
        req.flash("error", "No current term found.");
        return res.redirect("/common/orgDashboard");
      }
      req.session.currentTermId = currentTerm.term_id;

      // Fetch class details
      const classResult = await db.query(
        `
            SELECT c.class_name, g.name as graduation_year_group_name
            FROM classes c
            LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
            WHERE c.class_id = $1 AND c.organization_id = $2
            `,
        [classId, organizationId]
      );

      if (classResult.rows.length === 0) {
                return res
          .status(500)
          .send("Error fetching class details or class not found");
      }

      const className = classResult.rows[0].class_name;
      const graduationYearGroupName =
        classResult.rows[0].graduation_year_group_name;

      if (normalizedRole === 'teacher' && currentUserId) {
        const teacherAccessResult = await db.query(
          `SELECT 1
           FROM user_classes
           WHERE user_id = $1 AND class_id = $2
           LIMIT 1`,
          [currentUserId, classId]
        );
        if (!teacherAccessResult.rows.length) {
          req.flash('error', 'You can only access classes assigned to you.');
          return res.redirect('/common/orgDashboard');
        }
      }

      // Fetch students enrolled in the current term for this class
      const studentsResult = await db.query(
        `
            SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth
            FROM enrolled_students es
            INNER JOIN students s ON es.student_id = s.student_id
            INNER JOIN enrollments e ON es.enrollment_id = e.enrollment_id
            WHERE es.class_id = $1
              AND e.term_id = $2
              AND e.school_year_id = $3
              AND e.organization_id = $4
              AND s.graduated = FALSE
            ORDER BY s.last_name, s.first_name
            `,
        [classId, currentTerm.term_id, schoolYear.id, organizationId]
      );

      const students = studentsResult.rows;
      const upcomingClassBirthdays = buildUpcomingBirthdayCards(students, 7);
      const classStudentIds = students
        .map((studentRow) => Number(studentRow.student_id))
        .filter((studentIdValue) => Number.isInteger(studentIdValue) && studentIdValue > 0);

      const transportationIntegration = await getTransportationIntegrationStatus(db, organizationId).catch(
        () => ({ activated: false })
      );
      const classTransportationSnapshot = transportationIntegration.activated
        ? await getClassTransportationSnapshot(
            db,
            organizationId,
            Number(classId),
            Number(currentTerm.term_id),
            Number(schoolYear.id)
          ).catch(() => [])
        : [];
      const classTransportationSchoolDestination = transportationIntegration.activated
        ? await db.query(
            `SELECT organization_address, geo_lat, geo_lng
               FROM organizations
              WHERE organization_id = $1
              LIMIT 1`,
            [organizationId]
          ).then((result) => ({
            address: String(result.rows[0]?.organization_address || '').trim() || null,
            latitude: result.rows[0]?.geo_lat !== null && result.rows[0]?.geo_lat !== undefined ? Number(result.rows[0].geo_lat) : null,
            longitude: result.rows[0]?.geo_lng !== null && result.rows[0]?.geo_lng !== undefined ? Number(result.rows[0].geo_lng) : null,
          })).catch(() => ({ address: null, latitude: null, longitude: null }))
        : { address: null, latitude: null, longitude: null };

      const configuredClassroomRemarkTypes = await getConfiguredClassroomRemarkTypes(
        db,
        organizationId,
        Number(classId),
        Number(currentTerm.term_id)
      );

      const [customRemarkTypes, teacherRemarkOptions, studentTeacherRemarkRowsResult] = await Promise.all([
        getOrganizationCustomRemarkTypes(db, organizationId),
        getTeacherRemarkOptionsCached(db, organizationId, Number(classId), Number(currentTerm.term_id), {
          remarkTypes: configuredClassroomRemarkTypes,
        }),
        classStudentIds.length
          ? db.query(
              `SELECT student_id, teacher_remarks, conduct_remarks, interest_remarks, attitude_remarks, custom_remarks_json
               FROM student_reports
               WHERE organization_id = $1
                 AND class_id = $2
                 AND term_id = $3
                 AND student_id = ANY($4::int[])`,
              [organizationId, classId, currentTerm.term_id, classStudentIds]
            )
          : Promise.resolve({ rows: [] }),
      ]);

      const studentTeacherRemarksMap = {};
      (studentTeacherRemarkRowsResult.rows || []).forEach((row) => {
        const key = String(row.student_id || "").trim();
        if (!key) return;
        const customRemarkValues = row.custom_remarks_json && typeof row.custom_remarks_json === 'object'
          ? row.custom_remarks_json
          : {};
        studentTeacherRemarksMap[key] = {
          teacher: String(row.teacher_remarks || ""),
          conduct: String(row.conduct_remarks || ""),
          interest: String(row.interest_remarks || ""),
          attitude: String(row.attitude_remarks || ""),
          ...customRemarkValues,
        };
      });

      // **Fetch subjects for this class**
      let subjectsResult;
      if (currentUserRole === "Teacher") {
        subjectsResult = await db.query(
          `
                SELECT s.subject_id, s.subject_name
                FROM user_subjects us
                INNER JOIN subjects s ON us.subject_id = s.subject_id
                WHERE us.user_id = $1 AND s.class_id = $2 AND s.organization_id = $3
                ORDER BY s.subject_name
                `,
          [currentUserId, classId, organizationId]
        );
      } else {
        subjectsResult = await db.query(
          `
                SELECT subject_id, subject_name
                FROM subjects
                WHERE class_id = $1 AND organization_id = $2
                ORDER BY subject_name
                `,
          [classId, organizationId]
        );
      }
      // Fetch the main teacher assigned to the class
      const mainTeacherResult = await db.query(
        `
  SELECT user_id 
  FROM user_classes 
  WHERE class_id = $1 AND main = TRUE
  `,
        [classId]
      );

      const mainTeacherId =
        mainTeacherResult.rows.length > 0
          ? mainTeacherResult.rows[0].user_id
          : null;
      const isMainTeacher = currentUserId === mainTeacherId;
      const canEditClassSchedule = buildClassSchedulePermissions(req, isMainTeacher);
      const scheduleSubjects = await getClassScheduleSubjects(db, {
        organizationId,
        classId,
        currentUserId,
        currentUserRole,
      });
      const scheduleBundle = await getClassScheduleBundle(db, { organizationId, classId, termId: currentTerm.term_id });
      const initialClassScheduleData = buildClassSchedulePayload({
        canEdit: canEditClassSchedule,
        subjects: scheduleSubjects,
        term: scheduleBundle?.term || {
          term_id: currentTerm.term_id,
          term_name: currentTerm.term_name,
          school_year_id: schoolYear.id,
          year_label: schoolYear.year_label,
        },
        schedule: scheduleBundle?.currentSchedule || null,
        previousSchedule: scheduleBundle?.previousSchedule || null,
      });

      // Fetch employees associated with the class
      const employees = await getClassEmployeesWithMain(db, classId);

      let assignedFilesCount = 0;
      if (currentUserRole === 'Teacher' && currentUserId) {
        const assignedFiles = await db.query(`
          SELECT COUNT(DISTINCT d.id) AS total
          FROM documents d
          JOIN document_class_assignments dca ON d.id = dca.document_id
          JOIN user_classes uc ON uc.class_id = dca.class_id
          WHERE d.organization_id = $1
            AND d.is_deleted = FALSE
            AND dca.class_id = $2
            AND uc.user_id = $3
        `, [organizationId, classId, currentUserId]);
        assignedFilesCount = Number(assignedFiles.rows[0]?.total || 0);
      }

      // Count reports where this user is a CC recipient for students in this class
      let classReportsCount = 0;
      if (currentUserId) {
        const reportsCountResult = await db.query(
          `SELECT COUNT(DISTINCT r.report_id) AS total
           FROM guardian_reports r
           JOIN students s ON r.student_id = s.student_id
           LEFT JOIN guardian_report_recipients grr ON grr.report_id = r.report_id
           LEFT JOIN user_classes uc ON uc.class_id = s.class_id AND uc.user_id = $3
           WHERE r.organization_id = $1
             AND s.class_id = $2
             AND r.deleted_at IS NULL
             AND (grr.user_id = $3 OR uc.user_id IS NOT NULL)`,
          [organizationId, classId, currentUserId]
        );
        classReportsCount = Number(reportsCountResult.rows[0]?.total || 0);
      }

      const classDashOrgSwitchRestriction = await getOrgSwitchFeatureRestriction(db, req).catch(() => ({ isRestricted: false }));
      const canOpenPaygiraWorkspace = !classDashOrgSwitchRestriction.isRestricted
        || classDashOrgSwitchRestriction.flags.canViewBilling
        || classDashOrgSwitchRestriction.flags.canViewPaygira;

      const routePanel = String(req.params.panel || '').trim().toLowerCase();
      const routeItemId = req.params.itemId ? String(req.params.itemId).trim() : '';
      const queryReportId = req.query.reportId ? String(req.query.reportId).trim() : '';
      let initialWorkspaceRoute = {
        panel: 'overview',
        itemId: '',
      };

      if (routePanel === 'attendance') {
        initialWorkspaceRoute = { panel: 'attendance', itemId: '' };
      } else if (routePanel === 'reports') {
        initialWorkspaceRoute = { panel: queryReportId ? 'report-detail' : 'reports', itemId: queryReportId };
      } else if (routePanel === 'schedule') {
        initialWorkspaceRoute = { panel: 'schedule', itemId: '' };
      } else if (routePanel === 'transportation') {
        initialWorkspaceRoute = { panel: 'transportation', itemId: '' };
      } else if (routePanel === 'students') {
        initialWorkspaceRoute = { panel: 'students', itemId: '' };
      } else if (routePanel === 'assessment-questions') {
        initialWorkspaceRoute = { panel: 'assessment-questions', itemId: '' };
      } else if (routePanel === 'subjects') {
        initialWorkspaceRoute = { panel: 'subjects', itemId: '' };
      } else if (routePanel === 'class-exams' && canManageAllClassAssessmentExams) {
        initialWorkspaceRoute = { panel: 'assessment-questions', itemId: '' };
      } else if (routePanel === 'paygira') {
        initialWorkspaceRoute = { panel: 'paygira', itemId: '' };
      } else if (routePanel === 'student' && routeItemId) {
        initialWorkspaceRoute = { panel: 'student', itemId: routeItemId };
      } else if (routePanel === 'subject' && routeItemId) {
        initialWorkspaceRoute = { panel: 'subject', itemId: routeItemId };
      } else if (routePanel === 'docs') {
        initialWorkspaceRoute = { panel: 'docs', itemId: '' };
      }

      // Render the classDashboard view with the updated context
      res.render("common/classDashboard", {
        title: `Class Dashboard - ${className}`,
        className: className,
        graduationYearGroup: graduationYearGroupName,
        students: students,
        subjects: subjectsResult.rows, // Assigned subjects for teacher, all subjects for others
        classId: classId,
        employees: employees,
        attendanceLink: `/common/attendanceCollection?classId=${classId}`,
        schoolYear,
        currentTerm,
        messages: req.flash(),
        csrfToken: csrfToken,
        isMainTeacher: isMainTeacher,
        canEditClassSchedule,
        classScheduleWeekdays: CLASS_SCHEDULE_WEEKDAYS,
        scheduleSubjects,
        initialClassScheduleData,
        assignedFilesCount,
        classReportsCount,
        upcomingClassBirthdays,
        initialWorkspaceRoute,
        classWorkspaceBasePath: `/common/classDashboard/${classId}`,
        googleIntegration,
        canManageAllClassAssessmentExams,
        canOpenPaygiraWorkspace,
        teacherRemarkOptions,
        classroomRemarkTypes: configuredClassroomRemarkTypes,
        classroomCustomRemarkTypes: customRemarkTypes,
        studentTeacherRemarksMap,
        canAccessAssessmentQuestions,
        transportationIntegration,
        classTransportationSnapshot,
        classTransportationSchoolDestination,
        hideGlobalFooter: true,
      });
    } catch (err) {
            res.status(500).send("Error loading class dashboard");
    }
  },

  getStudentTeacherRemarkOptions: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number.parseInt(req.query.classId, 10);
    const termId = Number.parseInt(req.query.termId, 10);
    const studentId = Number.parseInt(req.query.studentId, 10);
    const currentUserRole = req.session.userRole;
    const currentUserId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
    const normalizedRole = normalizeRoleKey(currentUserRole || req.session.accountType);

    if (!organizationId || !Number.isInteger(classId) || !Number.isInteger(termId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ success: false, message: "Missing or invalid class, term, or student." });
    }

    try {
      await ensureStudentReportCustomRemarksColumn(db);
      const isElevatedRole = ["manager", "supervisor", "admin", "organization", "mini admin"].includes(normalizedRole);
      if (!isElevatedRole && !currentUserId) {
        return res.status(403).json({ success: false, message: "Unauthorized." });
      }

      const accessJoinSql = isElevatedRole
        ? ""
        : "JOIN user_classes uc ON uc.class_id = es.class_id AND uc.user_id = $5";
      const scopedParams = isElevatedRole
        ? [studentId, classId, termId, organizationId]
        : [studentId, classId, termId, organizationId, currentUserId];

      const scopedStudentResult = await db.query(
        `SELECT es.student_id
         FROM enrolled_students es
         JOIN enrollments e ON es.enrollment_id = e.enrollment_id
         JOIN classes c ON c.class_id = es.class_id
         JOIN terms t ON t.term_id = e.term_id
         ${accessJoinSql}
         WHERE es.student_id = $1
           AND es.class_id = $2
           AND e.term_id = $3
           AND e.organization_id = $4
           AND c.organization_id = $4
           AND t.organization_id = $4
         LIMIT 1`,
        scopedParams
      );

      if (!scopedStudentResult.rows.length) {
        if (!isElevatedRole) {
          return res.status(403).json({ success: false, message: "You can only manage remarks for classes assigned to you." });
        }
        return res.status(404).json({ success: false, message: "Student/class/term context not found for this organization." });
      }

      const [customRemarkTypes, configuredRemarkTypes, savedRemarkResult] = await Promise.all([
        getOrganizationCustomRemarkTypes(db, organizationId),
        getConfiguredClassroomRemarkTypes(db, organizationId, classId, termId),
        db.query(
          `SELECT teacher_remarks, conduct_remarks, interest_remarks, attitude_remarks, custom_remarks_json
           FROM student_reports
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = $4
           LIMIT 1`,
          [organizationId, classId, termId, studentId]
        ),
      ]);

      const teacherOptions = await getTeacherRemarkOptionsCached(db, organizationId, classId, termId, {
        remarkTypes: configuredRemarkTypes,
      });

      const customRemarkValues = savedRemarkResult.rows[0]?.custom_remarks_json && typeof savedRemarkResult.rows[0].custom_remarks_json === 'object'
        ? savedRemarkResult.rows[0].custom_remarks_json
        : {};

      return res.json({
        success: true,
        options: teacherOptions || [],
        selectedRemarkTypes: configuredRemarkTypes,
        customRemarkTypes,
        teacherRemark: String(savedRemarkResult.rows[0]?.teacher_remarks || ""),
        remarkValues: {
          teacher: String(savedRemarkResult.rows[0]?.teacher_remarks || ""),
          conduct: String(savedRemarkResult.rows[0]?.conduct_remarks || ""),
          interest: String(savedRemarkResult.rows[0]?.interest_remarks || ""),
          attitude: String(savedRemarkResult.rows[0]?.attitude_remarks || ""),
          ...customRemarkValues,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to load remark options." });
    }
  },

  getClassDashboardStudentTransportSnapshot: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const currentUserRole = req.session.userRole;
    const currentUserId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
    const normalizedRole = normalizeRoleKey(currentUserRole || req.session.accountType);
    const classId = Number.parseInt(req.query.classId, 10);
    const studentId = Number.parseInt(req.query.studentId, 10);

    if (!organizationId || !Number.isInteger(classId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid class/student.' });
    }

    try {
      const isElevatedRole = ["manager", "supervisor", "admin", "organization", "mini admin"].includes(normalizedRole);
      if (!isElevatedRole && normalizedRole === 'teacher' && currentUserId) {
        const teacherAccessResult = await db.query(
          `SELECT 1
             FROM user_classes
            WHERE user_id = $1
              AND class_id = $2
            LIMIT 1`,
          [currentUserId, classId]
        );
        if (!teacherAccessResult.rows.length) {
          return res.status(403).json({ success: false, error: 'Unauthorized.' });
        }
      }

      const studentScopedResult = await db.query(
        `SELECT 1
           FROM enrolled_students es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
           JOIN students s ON s.student_id = es.student_id
          WHERE e.organization_id = $1
            AND es.class_id = $2
            AND s.student_id = $3
            AND COALESCE(s.graduated, FALSE) = FALSE
          LIMIT 1`,
        [organizationId, classId, studentId]
      );

      if (!studentScopedResult.rows.length) {
        return res.status(404).json({ success: false, error: 'Student not found in this class.' });
      }

      const snapshot = await getStudentTransportationSnapshot(db, organizationId, studentId).catch(() => null);
      return res.json({ success: true, snapshot });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Unable to load student transportation details.' });
    }
  },

  saveStudentTeacherRemark: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const currentUserRole = req.session.userRole;
    const currentUserId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
    const normalizedRole = normalizeRoleKey(currentUserRole || req.session.accountType);
    const classId = Number.parseInt(req.body.classId, 10);
    const termId = Number.parseInt(req.body.termId, 10);
    const studentId = Number.parseInt(req.body.studentId, 10);
    const incomingRemarkValues = req.body.remarkValues && typeof req.body.remarkValues === "object"
      ? req.body.remarkValues
      : {};

    if (!organizationId || !Number.isInteger(classId) || !Number.isInteger(termId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ success: false, message: "Missing or invalid class, term, or student." });
    }

    try {
      await ensureStudentReportCustomRemarksColumn(db);
      const customRemarkTypes = await getOrganizationCustomRemarkTypes(db, organizationId);
      const allowedRemarkTypes = ["teacher", "conduct", "interest", "attitude"];
      const customTypeKeys = customRemarkTypes.map(function(entry) {
        return String(entry.type_key || '').trim().toLowerCase();
      }).filter(Boolean);
      const normalizedRemarkValues = {
        teacher: String(incomingRemarkValues.teacher ?? req.body.teacherRemark ?? "").trim(),
        conduct: String(incomingRemarkValues.conduct ?? "").trim(),
        interest: String(incomingRemarkValues.interest ?? "").trim(),
        attitude: String(incomingRemarkValues.attitude ?? "").trim(),
      };
      const customRemarkValues = {};

      customTypeKeys.forEach(function(typeKey) {
        customRemarkValues[typeKey] = String(incomingRemarkValues[typeKey] ?? '').trim();
      });

      const overLimitBuiltinType = allowedRemarkTypes.find(function(typeKey) {
        return normalizedRemarkValues[typeKey].length > 500;
      });
      if (overLimitBuiltinType) {
        const labelMap = {
          teacher: "Teacher",
          conduct: "Conduct",
          interest: "Interest",
          attitude: "Attitude",
        };
        return res.status(400).json({
          success: false,
          message: `${labelMap[overLimitBuiltinType] || "Remark"} remark is too long. Keep it under 500 characters.`,
        });
      }

      const overLimitCustomType = customTypeKeys.find(function(typeKey) {
        return String(customRemarkValues[typeKey] || '').length > 500;
      });
      if (overLimitCustomType) {
        var matchingCustomType = customRemarkTypes.find(function(entry) {
          return String(entry.type_key || '').trim().toLowerCase() === overLimitCustomType;
        });
        return res.status(400).json({
          success: false,
          message: `${matchingCustomType?.label || 'Custom'} remark is too long. Keep it under 500 characters.`,
        });
      }

      const isElevatedRole = ["manager", "supervisor", "admin", "organization", "mini admin"].includes(normalizedRole);
      if (!isElevatedRole && !currentUserId) {
        return res.status(403).json({ success: false, message: "Unauthorized." });
      }

      const accessJoinSql = isElevatedRole
        ? ""
        : "JOIN user_classes uc ON uc.class_id = es.class_id AND uc.user_id = $5";
      const scopedParams = isElevatedRole
        ? [studentId, classId, termId, organizationId]
        : [studentId, classId, termId, organizationId, currentUserId];

      const scopedStudentResult = await db.query(
        `SELECT es.student_id
         FROM enrolled_students es
         JOIN enrollments e ON es.enrollment_id = e.enrollment_id
         JOIN classes c ON c.class_id = es.class_id
         JOIN terms t ON t.term_id = e.term_id
         ${accessJoinSql}
         WHERE es.student_id = $1
           AND es.class_id = $2
           AND e.term_id = $3
           AND e.organization_id = $4
           AND c.organization_id = $4
           AND t.organization_id = $4
         LIMIT 1`,
        scopedParams
      );

      if (!scopedStudentResult.rows.length) {
        if (!isElevatedRole) {
          return res.status(403).json({ success: false, message: "You can only manage remarks for classes assigned to you." });
        }
        return res.status(404).json({ success: false, message: "Student/class/term context not found for this organization." });
      }

      await db.query(
        `INSERT INTO student_reports (
           organization_id, class_id, term_id, student_id,
           teacher_remarks, conduct_remarks, interest_remarks, attitude_remarks, custom_remarks_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, class_id, term_id, student_id)
         DO UPDATE SET
           teacher_remarks = EXCLUDED.teacher_remarks,
           conduct_remarks = EXCLUDED.conduct_remarks,
           interest_remarks = EXCLUDED.interest_remarks,
           attitude_remarks = EXCLUDED.attitude_remarks,
           custom_remarks_json = EXCLUDED.custom_remarks_json,
           updated_at = CURRENT_TIMESTAMP`,
        [
          organizationId,
          classId,
          termId,
          studentId,
          normalizedRemarkValues.teacher,
          normalizedRemarkValues.conduct,
          normalizedRemarkValues.interest,
          normalizedRemarkValues.attitude,
          customRemarkValues,
        ]
      );

      return res.json({ success: true, message: "Student remarks saved." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to save student remarks." });
    }
  },

  birthdaysPageGet: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const userRole = req.session.userRole || req.session.accountType || '';
      const normalizedRole = normalizeRoleKey(userRole);
      const userId = req.session.user?.user_id || req.session.userId || null;
      const isElevated = ['manager', 'supervisor', 'admin', 'mini admin', 'organization'].includes(normalizedRole);

      if (!organizationId) {
        req.flash('error', 'Organization not found in session.');
        return res.redirect('/account/login');
      }

      let classFilterSql = '';
      const params = [organizationId];

      if (!isElevated) {
        if (userId) {
          classFilterSql = `
            AND s.class_id IN (
              SELECT uc.class_id
              FROM user_classes uc
              WHERE uc.user_id = $2
            )`;
          params.push(userId);
        } else {
          classFilterSql = ' AND 1 = 0';
        }
      }

      const studentsResult = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.class_id, c.class_name
         FROM students s
         JOIN classes c ON c.class_id = s.class_id
         WHERE s.organization_id = $1
           AND s.class_id IS NOT NULL
           AND s.date_of_birth IS NOT NULL
           AND COALESCE(s.graduated, FALSE) = FALSE
           ${classFilterSql}
         ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC, s.last_name, s.first_name`,
        params
      );

      const birthdayStudents = buildUpcomingBirthdayCards(studentsResult.rows, 7, { includeWeekendCarryover: true });

      const staffResult = await db.query(
        `SELECT user_id, first_name, last_name, date_of_birth, account_type
         FROM users
         WHERE organization_id = $1
           AND COALESCE(on_hold, FALSE) = FALSE
           AND date_of_birth IS NOT NULL
         ORDER BY first_name, last_name`,
        [organizationId]
      );

      const birthdayStaff = staffResult.rows
        .map((staff) => {
          const info = getUpcomingBirthdayInfo(staff.date_of_birth, new Date(), { includeWeekendCarryover: true });
          if (!info || info.daysUntil > 7) return null;
          const name = [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim();
          return {
            studentId: `staff-${staff.user_id}`,
            isStaff: true,
            name,
            className: staff.account_type || 'Staff',
            classLabel: 'Role',
            daysUntil: info.daysUntil,
            isToday: info.daysUntil === 0,
            nextBirthdayLabel: info.label,
            turningAge: info.turningAge,
            timingLabel: info.daysUntil === 0 ? 'Today' : (info.daysUntil === 1 ? 'Tomorrow' : `In ${info.daysUntil} days`),
            wishMessage: info.daysUntil === 0 ? getStaffBirthdayWish(staff.user_id) : 'Upcoming this week',
          };
        })
        .filter(Boolean);

      const birthdaysPageItems = [...birthdayStudents, ...birthdayStaff]
        .sort((left, right) => left.daysUntil - right.daysUntil || left.name.localeCompare(right.name));

      res.render('common/birthdays', {
        title: 'Birthdays 🎂',
        birthdayStudents: birthdaysPageItems,
        isTeacherScope: !isElevated,
        viewerCelebrationKey: `${organizationId}:${userId || 'guest'}`,
        messages: req.flash(),
      });
    } catch (error) {
      req.flash('error', 'Could not load birthdays page.');
      return res.redirect('/common/orgDashboard');
    }
  },

  getClassSchedule: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number.parseInt(req.query.classId, 10);
    const termId = Number.parseInt(req.query.termId || req.session.currentTermId, 10);
    const currentUserId = getSessionUserId(req);

    if (!Number.isInteger(classId) || !Number.isInteger(termId)) {
      return res.status(400).json({ success: false, message: "Class and term are required." });
    }

    try {
      const mainTeacherResult = await db.query(
        `SELECT user_id FROM user_classes WHERE class_id = $1 AND main = TRUE LIMIT 1`,
        [classId]
      );
      const isMainTeacher = Number(mainTeacherResult.rows[0]?.user_id || 0) === Number(currentUserId || 0);
      const bundle = await getClassScheduleBundle(db, { organizationId, classId, termId });
      const subjects = await getClassScheduleSubjects(db, {
        organizationId,
        classId,
        currentUserId,
        currentUserRole: req.session.userRole,
      });
      if (!bundle) {
        const term = await getTermContext(db, organizationId, termId);
        if (!term) {
          return res.status(404).json({ success: false, message: "Class schedule context could not be loaded." });
        }

        return res.json(
          buildClassSchedulePayload({
            canEdit: buildClassSchedulePermissions(req, isMainTeacher),
            subjects,
            term,
            schedule: null,
            previousSchedule: null,
          })
        );
      }

      return res.json(
        buildClassSchedulePayload({
          canEdit: buildClassSchedulePermissions(req, isMainTeacher),
          subjects,
          term: bundle.term,
          schedule: bundle.currentSchedule,
          previousSchedule: bundle.previousSchedule,
        })
      );
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to load class schedule." });
    }
  },

  saveClassSchedule: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number.parseInt(req.body.classId, 10);
    const termId = Number.parseInt(req.body.termId || req.session.currentTermId, 10);
    const schoolYearId = Number.parseInt(req.body.schoolYearId, 10);
    const actorUserId = getSessionUserId(req);

    if (!Number.isInteger(classId) || !Number.isInteger(termId) || !Number.isInteger(schoolYearId)) {
      return res.status(400).json({ success: false, message: "Class, school year, and term are required." });
    }

    try {
      const mainTeacherResult = await db.query(
        `SELECT user_id FROM user_classes WHERE class_id = $1 AND main = TRUE LIMIT 1`,
        [classId]
      );
      const isMainTeacher = Number(mainTeacherResult.rows[0]?.user_id || 0) === Number(actorUserId || 0);

      if (!buildClassSchedulePermissions(req, isMainTeacher)) {
        return res.status(403).json({ success: false, message: "You can only view this schedule." });
      }

      const schedule = await persistClassSchedule(db, {
        organizationId,
        classId,
        termId,
        schoolYearId,
        entries: req.body.entries,
        actorUserId,
      });

      return res.json({ success: true, message: "Class schedule saved.", schedule });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Failed to save class schedule." });
    }
  },

  deleteClassSchedule: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number.parseInt(req.body.classId, 10);
    const termId = Number.parseInt(req.body.termId || req.session.currentTermId, 10);
    const actorUserId = getSessionUserId(req);

    if (!Number.isInteger(classId) || !Number.isInteger(termId)) {
      return res.status(400).json({ success: false, message: "Class and term are required." });
    }

    try {
      const mainTeacherResult = await db.query(
        `SELECT user_id FROM user_classes WHERE class_id = $1 AND main = TRUE LIMIT 1`,
        [classId]
      );
      const isMainTeacher = Number(mainTeacherResult.rows[0]?.user_id || 0) === Number(actorUserId || 0);

      if (!buildClassSchedulePermissions(req, isMainTeacher)) {
        return res.status(403).json({ success: false, message: "You can only view this schedule." });
      }

      await removeClassSchedule(db, { organizationId, classId, termId });
      return res.json({ success: true, message: "Class schedule deleted." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete class schedule." });
    }
  },

  reuseClassSchedule: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const classId = Number.parseInt(req.body.classId, 10);
    const termId = Number.parseInt(req.body.termId || req.session.currentTermId, 10);
    const schoolYearId = Number.parseInt(req.body.schoolYearId, 10);
    const actorUserId = getSessionUserId(req);

    if (!Number.isInteger(classId) || !Number.isInteger(termId) || !Number.isInteger(schoolYearId)) {
      return res.status(400).json({ success: false, message: "Class, school year, and term are required." });
    }

    try {
      const mainTeacherResult = await db.query(
        `SELECT user_id FROM user_classes WHERE class_id = $1 AND main = TRUE LIMIT 1`,
        [classId]
      );
      const isMainTeacher = Number(mainTeacherResult.rows[0]?.user_id || 0) === Number(actorUserId || 0);

      if (!buildClassSchedulePermissions(req, isMainTeacher)) {
        return res.status(403).json({ success: false, message: "You can only view this schedule." });
      }

      const schedule = await clonePreviousClassSchedule(db, {
        organizationId,
        classId,
        termId,
        schoolYearId,
        actorUserId,
      });

      return res.json({
        success: true,
        message: "Previous schedule copied. Subjects not found in this term were left empty and may need to be filled in.",
        schedule,
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Failed to reuse previous class schedule." });
    }
  },

  setMainEmployee: async (req, res, db) => {
    const { class_id, main_employee } = req.body;
    const organizationId = req.session.organizationId;
    if (!organizationId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    try {
      // Tenant boundary: class and target user must belong to caller's org.
      const ownership = await db.query(
        `SELECT (SELECT 1 FROM classes WHERE class_id = $1 AND organization_id = $3) AS class_ok,
                (SELECT 1 FROM users   WHERE user_id  = $2 AND organization_id = $3) AS user_ok`,
        [class_id, main_employee, organizationId]
      );
      if (!ownership.rows[0] || !ownership.rows[0].class_ok || !ownership.rows[0].user_ok) {
        return res.status(403).json({ success: false, message: "Class or employee does not belong to your organization." });
      }
      await db.query("BEGIN");
      await db.query(
        `UPDATE user_classes uc SET main = FALSE
          WHERE uc.class_id = $1
            AND EXISTS (SELECT 1 FROM users u WHERE u.user_id = uc.user_id AND u.organization_id = $2)`,
        [class_id, organizationId]
      );
      await db.query(
        `UPDATE user_classes uc SET main = TRUE
          WHERE uc.class_id = $1 AND uc.user_id = $2
            AND EXISTS (SELECT 1 FROM users u WHERE u.user_id = uc.user_id AND u.organization_id = $3)`,
        [class_id, main_employee, organizationId]
      );
      await db.query("COMMIT");
      res.json({ success: true, message: "Main employee set successfully." });
    } catch (error) {
      await db.query("ROLLBACK");
            res
        .status(500)
        .json({ success: false, message: "Failed to set main employee." });
    }
  },

  registerSchoolYear: async (req, res, db) => {
    const { schoolYear, terms } = req.body;
    const trimmedSchoolYear = String(schoolYear || "").trim();
    const yearMatch = trimmedSchoolYear.match(/^(\d{4})\s*-\s*(\d{4})$/);

    if (!yearMatch) {
      req.flash("error", "Please enter School Year in the format YYYY-YYYY (for example 2026-2027).");
      return res.redirect("/common/registerSchoolYear");
    }

    if (Number(yearMatch[2]) !== Number(yearMatch[1]) + 1) {
      req.flash("error", "Please use consecutive years in School Year, such as 2026-2027.");
      return res.redirect("/common/registerSchoolYear");
    }

    const dup = await db.query(
      `SELECT 1
         FROM school_years
        WHERE year_label = $1
          AND organization_id = $2`,
      [trimmedSchoolYear, req.session.organizationId]
    );
    if (dup.rowCount) {
      req.flash("error", "A school year with that label already exists.");
      // re-load classes so we can re-render the form
      const classesResult = await db.query(
        `SELECT class_id, class_name
           FROM classes
          WHERE organization_id = $1
          ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [req.session.organizationId]
      );
      return res.render("common/registerSchoolYear", {
        title: "Register School Year",
        classes: classesResult.rows,
        messages: req.flash(),
        oldSchoolYear: trimmedSchoolYear,
        oldTerms: terms,
        // oldCurrent: isCurrent,
      });
    }

    // ——— 1) Validation: require at least one term ———
    if (!terms || (Array.isArray(terms) && terms.length === 0)) {
      req.flash(
        "error",
        "Please add at least one term before registering the school year."
      );
      // reload classes for the form
      const classesResult = await db.query(
        "SELECT class_id, class_name FROM classes WHERE organization_id= ORDER BY ",
        [req.session.organizationId]
      );
      return res.render("common/registerSchoolYear", {
        title: "Register School Year",
        classes: classesResult.rows,
        messages: req.flash(),
        // (optional) you can pass oldSchoolYear back as well, if you’ve wired up
        // your view to prefill it:
        oldSchoolYear: trimmedSchoolYear,
      });
    }
    // ——— Backend overlap validation ———
    const termsArr = Array.isArray(terms) ? terms : [];
    for (let i = 0; i < termsArr.length; i++) {
      const s = new Date(termsArr[i].startDate);
      const e = new Date(termsArr[i].endDate);
      if (s > e) {
        req.flash("error", `Start date must be before end date for term: ${termsArr[i].termName}`);
        return res.redirect("/common/registerSchoolYear");
      }
      for (let j = i + 1; j < termsArr.length; j++) {
        const s2 = new Date(termsArr[j].startDate);
        const e2 = new Date(termsArr[j].endDate);
        if (s <= e2 && e >= s2) {
          req.flash("error", `Date ranges for "${termsArr[i].termName}" and "${termsArr[j].termName}" overlap.`);
          return res.redirect("/common/registerSchoolYear");
        }
      }
    }

    const orderedTerms = [...termsArr]
      .map((t) => ({ ...t, _start: String(t.startDate || ""), _end: String(t.endDate || "") }))
      .sort((a, b) => a._start.localeCompare(b._start));

    for (let i = 1; i < orderedTerms.length; i++) {
      const previousEnd = new Date(orderedTerms[i - 1]._end);
      previousEnd.setDate(previousEnd.getDate() + 1);
      const currentStart = new Date(orderedTerms[i]._start);

      if (currentStart < previousEnd) {
        req.flash(
          "error",
          `Please adjust term dates: "${orderedTerms[i].termName}" should start on or after ${previousEnd.toISOString().slice(0, 10)}.`
        );
        return res.redirect("/common/registerSchoolYear");
      }
    }

    try {
      // Insert the new school year into the database
      const yearResult = await db.query(
        "INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id",
        [trimmedSchoolYear, req.session.organizationId]
      );
      const schoolYearId = yearResult.rows[0].id;

      // Loop through each term to insert into the database
      for (const term of terms) {
        const termResult = await db.query(
          "INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id",
          [
            term.termName,
            term.startDate,
            term.endDate,
            schoolYearId,
            req.session.organizationId,
          ]
        );
        const termId = termResult.rows[0].term_id;

        // Check if selectedClasses exists and is an array
        if (Array.isArray(term.selectedClasses)) {
          // Insert each selected class for the term
          for (const classId of term.selectedClasses) {
            await db.query(
              "INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)",
              [termId, classId, req.session.organizationId]
            );
          }
        } else {
                  }
      }

      // Add success flash message
      req.flash(
        "success",
        'School year saved successfully. To make this the active current school year, select "Set as Current" beside the school year and one of its terms to activate it.'
      );

      // Redirect to the manageRecords page upon successful insertion
      res.redirect("/common/manageRecords");
    } catch (error) {
            req.flash("error", "Error registering school year.");
      res.redirect("/common/manageRecords");
    }
  },

  registerSchoolYearGet: async (req, res, db) => {
    // Add this method
    try {
      // Fetch all classes for the organization
      const classesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [req.session.organizationId]
      );

      res.render("common/registerSchoolYear", {
        title: "Register School Year",
        classes: classesResult.rows, // Pass classes to the view
        messages: req.flash(),
        hideGlobalHeader: true,
        hideGlobalFooter: true,
      });
    } catch (error) {
            req.flash(
        "error",
        "Failed to load the form for registering a school year."
      );
      res.redirect("/common/manageRecords");
    }
  },

  getClasses: async (req, res, db) => {
    try {
      const classesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [req.session.organizationId]
      );
      res.json(classesResult.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch classes." });
    }
  },

  registerSchoolYearEvent: async (req, res, db) => {
    try {
      await db.query(
        "INSERT INTO school_events (name, event_date, details, organization_id, visibility) VALUES ($1, $2, $3, $4, $5)",
        [
          req.body.eventName,
          req.body.startDate,
          req.body.eventDetails,
          req.session.organizationId,
          req.body.visibility,
        ]
      );
      res.redirect("/common/manageRecords");
    } catch (error) {
            res.status(500).send("Error processing your request");
    }
  },

  registerSchoolYearAnnouncement: async (req, res, db) => {
    try {
      await db.query(
        "INSERT INTO announcements (message, organization_id, visibility) VALUES ($1, $2, $3)",
        [req.body.announcement, req.session.organizationId, req.body.visibility]
      );
      res.redirect("/common/manageRecords");
    } catch (error) {
            res.status(500).send("Error processing your request");
    }
  },

  getSchoolYearsData: async (db, organizationId) => {
    const schoolYearsResult = await db.query(
      "SELECT * FROM school_years WHERE organization_id = $1 ORDER BY created_at DESC",
      [organizationId]
    );
    const schoolYears = schoolYearsResult.rows;

    for (const year of schoolYears) {
      const termsResult = await db.query(
        "SELECT * FROM terms WHERE year_id = $1 AND organization_id = $2 ORDER BY start_date",
        [year.id, organizationId]
      );
      const terms = termsResult.rows;

      for (const term of terms) {
        const termClassesResult = await db.query(
          `SELECT tc.class_id, c.class_name 
                     FROM term_classes tc
                     JOIN classes c ON tc.class_id = c.class_id
                     WHERE tc.term_id = $1`,
          [term.term_id]
        );
        term.class_ids = termClassesResult.rows.map((row) => row.class_id);
        term.classes = termClassesResult.rows;
      }
      year.terms = terms;
    }
    return schoolYears;
  },

  manageRecords: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const isEmbedded = isEmbeddedRequest(req, "manageRecords");
      const schoolYearsResult = await db.query(
        "SELECT * FROM school_years WHERE organization_id = $1 ORDER BY current DESC, id ASC",
        [organizationId]
      );
      const termsResult = await db.query(
        `
                SELECT t.*, array_agg(tc.class_id) AS class_ids
                FROM terms t
                LEFT JOIN term_classes tc ON t.term_id = tc.term_id
                WHERE t.organization_id = $1
                GROUP BY t.term_id
            `,
        [organizationId]
      );
      const classesResult = await db.query(
        `SELECT * FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [organizationId]
      );
      const eventsResult = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1",
        [organizationId]
      );
      const announcementsResult = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1",
        [organizationId]
      );

      const currentTermResult = await db.query(
        `SELECT term_id, term_name, school_year_id
         FROM terms
         WHERE organization_id = $1
           AND current = TRUE
         ORDER BY term_id DESC
         LIMIT 1`,
        [organizationId]
      );

      const previousCurrentTermId = Number(currentTermResult.rows[0]?.term_id) || null;
      const previousCurrentTermName = currentTermResult.rows[0]?.term_name || null;

      let previousTermEnrollmentClasses = [];
      if (previousCurrentTermId) {
        const previousTermClassesResult = await db.query(
          `SELECT
              es.class_id,
              c.class_name,
              c.dashboard_sort_order,
              COUNT(DISTINCT es.student_id)::int AS student_count
           FROM enrollments e
           JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
           JOIN classes c ON c.class_id = es.class_id
           JOIN students s ON s.student_id = es.student_id
           WHERE e.organization_id = $1
             AND e.term_id = $2
             AND c.organization_id = $1
             AND s.organization_id = $1
             AND COALESCE(s.graduated, FALSE) = FALSE
           GROUP BY es.class_id, c.class_name, c.dashboard_sort_order
           ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, es.class_id ASC`,
          [organizationId, previousCurrentTermId]
        );

        previousTermEnrollmentClasses = previousTermClassesResult.rows.map((row) => ({
          class_id: Number(row.class_id),
          class_name: row.class_name,
          student_count: Number(row.student_count) || 0,
        }));
      }

      // Attach classes to each term and map them to school years
      const schoolYears = schoolYearsResult.rows.map((schoolYear) => {
        const terms = termsResult.rows
          .filter((term) => term.school_year_id === schoolYear.id)
          .map((term) => ({
            ...term,
            class_ids: term.class_ids || [], // Ensure class_ids is present and defaults to an empty array if none
          }));
        return { ...schoolYear, terms };
      });

      // Pass messages to the view
      res.render("common/manageRecords", {
        title: "Manage Records",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        schoolYears,
        classes: classesResult.rows,
        events: eventsResult.rows,
        announcements: announcementsResult.rows,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
        previousCurrentTermId,
        previousCurrentTermName,
        previousTermEnrollmentClasses,
      });
    } catch (error) {
      console.error("[ManageRecords] Failed to load page:", error);
      req.flash("error", "Error loading manage records page.");
      res.redirect("/common/orgDashboard");
    }
  },

  updateSchoolYearAndTerms: async (req, res, db) => {
    const {
      yearId,
      year_label,
      currentYear,
      termIds = [],
      termNames = [],
      startDates = [],
      endDates = [],
      currentTerm = [],
      termClasses = [],
      enrollPreviousTerm,
      enrollPreviousTermMode,
      previousCurrentTermId,
      enrollClassIds = [],
    } = req.body;
    const { organizationId } = req.session;
    const normalizedYearLabel = String(year_label || "").trim();
    const yearMatch = normalizedYearLabel.match(/^(\d{4})\s*-\s*(\d{4})$/);
    const termIdsArr = Array.isArray(termIds) ? termIds : (termIds ? [termIds] : []);
    const termNamesArr = Array.isArray(termNames) ? termNames : (termNames ? [termNames] : []);
    const startDatesArr = Array.isArray(startDates) ? startDates : (startDates ? [startDates] : []);
    const endDatesArr = Array.isArray(endDates) ? endDates : (endDates ? [endDates] : []);
    const termClassesArr = Array.isArray(termClasses) ? termClasses : (termClasses ? [termClasses] : []);
    const currentTermArr = Array.isArray(currentTerm) ? currentTerm.map(String) : (currentTerm ? [String(currentTerm)] : []);
    const enrollClassIdsArr = Array.isArray(enrollClassIds) ? enrollClassIds : (enrollClassIds ? [enrollClassIds] : []);
    const requestedEnrollClassIds = [...new Set(enrollClassIdsArr
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0))];
    const normalizedEnrollMode = String(enrollPreviousTermMode || "classes_and_students").trim().toLowerCase() === "classes_only"
      ? "classes_only"
      : "classes_and_students";

    try {
      if (!yearMatch) {
        req.flash("error", "Please enter School Year in the format YYYY-YYYY (for example 2026-2027).");
        return res.redirect("/common/manageRecords");
      }

      if (Number(yearMatch[2]) !== Number(yearMatch[1]) + 1) {
        req.flash("error", "Please use consecutive years in School Year, such as 2026-2027.");
        return res.redirect("/common/manageRecords");
      }

      const currentTermBeforeResult = await db.query(
        `SELECT term_id, school_year_id
         FROM terms
         WHERE organization_id = $1
           AND current = TRUE
         ORDER BY term_id DESC
         LIMIT 1`,
        [organizationId]
      );

      const previousCurrentTermIdFromDb = Number(currentTermBeforeResult.rows[0]?.term_id) || null;
      const previousCurrentTermIdFromRequest = Number(previousCurrentTermId) || null;

      // Validate current term selection if current year is set
      if (currentYear && (!currentTerm || currentTerm.length === 0)) {
        req.flash(
          "error",
          "School year cannot be set as current because no term is selected. Please select a term."
        );
        return res.redirect("/common/manageRecords");
      }

      // ✅ Explicitly ensure yearId is a single value
      const yearIdInt = Array.isArray(yearId)
        ? parseInt(yearId[0], 10)
        : parseInt(yearId, 10);

      // ——— Backend overlap validation for term dates ———
      for (let i = 0; i < startDatesArr.length; i++) {
        const s = new Date(startDatesArr[i]);
        const e = new Date(endDatesArr[i]);
        if (s > e) {
          req.flash("error", `Start date must be before end date for term: ${termNamesArr[i]}`);
          return res.redirect("/common/manageRecords");
        }
        for (let j = i + 1; j < startDatesArr.length; j++) {
          const s2 = new Date(startDatesArr[j]);
          const e2 = new Date(endDatesArr[j]);
          if (s <= e2 && e >= s2) {
            req.flash("error", `Date ranges for "${termNamesArr[i]}" and "${termNamesArr[j]}" overlap.`);
            return res.redirect("/common/manageRecords");
          }
        }
      }

      const orderedTerms = termNamesArr
        .map((name, idx) => ({
          name,
          start: String(startDatesArr[idx] || ""),
          end: String(endDatesArr[idx] || ""),
        }))
        .sort((a, b) => a.start.localeCompare(b.start));

      for (let i = 1; i < orderedTerms.length; i++) {
        const previousEnd = new Date(orderedTerms[i - 1].end);
        previousEnd.setDate(previousEnd.getDate() + 1);
        const currentStart = new Date(orderedTerms[i].start);

        if (currentStart < previousEnd) {
          req.flash(
            "error",
            `Please adjust term dates: "${orderedTerms[i].name}" should start on or after ${previousEnd.toISOString().slice(0, 10)}.`
          );
          return res.redirect("/common/manageRecords");
        }
      }

      await db.query("BEGIN");

      let enrollmentCopySummary = null;

      // Update school year label
      await db.query(
        "UPDATE school_years SET year_label = $1 WHERE id = $2 AND organization_id = $3",
        [normalizedYearLabel, yearIdInt, organizationId]
      );

      // Mark current year
      if (currentYear) {
        await db.query(
          "UPDATE school_years SET current = FALSE WHERE organization_id = $1",
          [organizationId]
        );
        await db.query(
          "UPDATE school_years SET current = TRUE WHERE id = $1 AND organization_id = $2",
          [yearIdInt, organizationId]
        );
      }

      for (let i = 0; i < termNamesArr.length; i++) {
        // ✅ Sanitize term ID
        const rawTermId = termIdsArr[i];
        const termIdInt = rawTermId
          ? parseInt(Array.isArray(rawTermId) ? rawTermId[0] : rawTermId, 10)
          : null;

        const termName = termNamesArr[i];
        const startDate = startDatesArr[i];
        const endDate = endDatesArr[i];

        // ✅ Check if current term for this term
        const termIdStr = termIdInt ? termIdInt.toString() : "";
        const isCurrent = currentTermArr.includes(termIdStr);

        // ✅ Parse classes properly
        let rawClasses = termClassesArr[i];
        let selectedClasses = [];
        if (Array.isArray(rawClasses)) {
          selectedClasses = rawClasses.map((v) => v.toString().trim());
        } else if (typeof rawClasses === "string") {
          selectedClasses = rawClasses
            .replace(/[\{\}"]/g, "")
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
        }

        if (termIdInt) {
          // Update existing term
          await db.query(
            "UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5",
            [termName, startDate, endDate, termIdInt, organizationId]
          );

          if (isCurrent) {
            await db.query(
              "UPDATE terms SET current = FALSE WHERE organization_id = $1",
              [organizationId]
            );
            await db.query(
              "UPDATE terms SET current = TRUE WHERE term_id = $1 AND organization_id = $2",
              [termIdInt, organizationId]
            );
          }

          // Clean up classes
          await db.query(
            "DELETE FROM term_classes WHERE term_id = $1 AND organization_id = $2",
            [termIdInt, organizationId]
          );

          // Insert selected classes
          for (const classId of selectedClasses) {
            const idInt = parseInt(classId, 10);
            if (!isNaN(idInt)) {
              await db.query(
                "INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)",
                [termIdInt, idInt, organizationId]
              );
            }
          }
        } else {
          // Insert new term
          const newTermResult = await db.query(
            "INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id, current) VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING term_id",
            [termName, startDate, endDate, yearIdInt, organizationId]
          );
          const newTermId = newTermResult.rows[0].term_id;

          if (isCurrent) {
            await db.query(
              "UPDATE terms SET current = FALSE WHERE organization_id = $1",
              [organizationId]
            );
            await db.query(
              "UPDATE terms SET current = TRUE WHERE term_id = $1 AND organization_id = $2",
              [newTermId, organizationId]
            );
          }

          // Insert classes for the new term
          for (const classId of selectedClasses) {
            const idInt = parseInt(classId, 10);
            if (!isNaN(idInt)) {
              await db.query(
                "INSERT INTO term_classes (term_id, class_id, organization_id) VALUES ($1, $2, $3)",
                [newTermId, idInt, organizationId]
              );
            }
          }
        }
      }

      const selectedCurrentTermId = currentTermArr.length > 0
        ? Number(currentTermArr[0])
        : null;
      const shouldCopyPreviousEnrollment =
        String(enrollPreviousTerm || "") === "1" &&
        Number.isFinite(selectedCurrentTermId) &&
        selectedCurrentTermId > 0 &&
        Number.isFinite(previousCurrentTermIdFromDb) &&
        selectedCurrentTermId !== previousCurrentTermIdFromDb;

      if (shouldCopyPreviousEnrollment) {
        if (previousCurrentTermIdFromRequest && previousCurrentTermIdFromRequest !== previousCurrentTermIdFromDb) {
          throw new Error("Current term changed while preparing enrollment copy. Please try saving again.");
        }

        const targetTermResult = await db.query(
          `SELECT term_id, school_year_id
           FROM terms
           WHERE term_id = $1
             AND organization_id = $2
           LIMIT 1`,
          [selectedCurrentTermId, organizationId]
        );

        if (!targetTermResult.rows.length) {
          throw new Error("Selected current term could not be found for enrollment copy.");
        }

        const targetSchoolYearId = Number(targetTermResult.rows[0].school_year_id);

        const sourceClassResult = await db.query(
          `SELECT DISTINCT es.class_id
           FROM enrollments e
           JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
           JOIN students s ON s.student_id = es.student_id
           WHERE e.organization_id = $1
             AND e.term_id = $2
             AND s.organization_id = $1
             AND COALESCE(s.graduated, FALSE) = FALSE`,
          [organizationId, previousCurrentTermIdFromDb]
        );

        const sourceClassIds = [...new Set(sourceClassResult.rows
          .map((row) => Number(row.class_id))
          .filter((value) => Number.isFinite(value) && value > 0))];

        const organizationClassResult = await db.query(
          `SELECT class_id
           FROM classes
           WHERE organization_id = $1`,
          [organizationId]
        );

        const organizationClassIds = new Set(
          organizationClassResult.rows
            .map((row) => Number(row.class_id))
            .filter((value) => Number.isFinite(value) && value > 0)
        );

        const sourceClassSet = new Set(sourceClassIds);
        const effectiveClassIds = requestedEnrollClassIds.filter((classId) => organizationClassIds.has(classId));
        const carryStudentClassIds = effectiveClassIds.filter((classId) => sourceClassSet.has(classId));

        let targetEnrollmentId;
        const targetEnrollmentResult = await db.query(
          `SELECT enrollment_id
           FROM enrollments
           WHERE organization_id = $1
             AND term_id = $2
             AND school_year_id = $3
           ORDER BY enrollment_id DESC
           LIMIT 1`,
          [organizationId, selectedCurrentTermId, targetSchoolYearId]
        );

        if (targetEnrollmentResult.rows.length) {
          targetEnrollmentId = Number(targetEnrollmentResult.rows[0].enrollment_id);
        } else {
          const insertEnrollmentResult = await db.query(
            `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING enrollment_id`,
            [targetSchoolYearId, selectedCurrentTermId, organizationId]
          );
          targetEnrollmentId = Number(insertEnrollmentResult.rows[0].enrollment_id);
        }

        let insertedClassCount = 0;
        if (effectiveClassIds.length > 0) {
          const insertClassResult = await db.query(
            `INSERT INTO enrolled_classes (enrollment_id, class_id)
             SELECT $1, class_id
             FROM UNNEST($2::int[]) AS src(class_id)
             WHERE NOT EXISTS (
               SELECT 1
               FROM enrolled_classes ec
               WHERE ec.enrollment_id = $1
                 AND ec.class_id = src.class_id
             )`,
            [targetEnrollmentId, effectiveClassIds]
          );
          insertedClassCount = insertClassResult.rowCount || 0;
        }

        let insertedStudentCount = 0;
        if (normalizedEnrollMode === "classes_and_students" && carryStudentClassIds.length > 0) {
          const sourceStudentResult = await db.query(
            `SELECT DISTINCT es.student_id, es.class_id
             FROM enrollments e
             JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
             JOIN students s ON s.student_id = es.student_id
             WHERE e.organization_id = $1
               AND e.term_id = $2
               AND es.class_id = ANY($3::int[])
               AND s.organization_id = $1
               AND COALESCE(s.graduated, FALSE) = FALSE`,
            [organizationId, previousCurrentTermIdFromDb, carryStudentClassIds]
          );

          for (const row of sourceStudentResult.rows) {
            const studentId = Number(row.student_id);
            const classId = Number(row.class_id);
            if (!Number.isFinite(studentId) || !Number.isFinite(classId)) continue;

            const insertStudentResult = await db.query(
              `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
               SELECT $1, $2, $3
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM enrolled_students es
                 WHERE es.enrollment_id = $1
                   AND es.student_id = $2
               )`,
              [targetEnrollmentId, studentId, classId]
            );
            insertedStudentCount += insertStudentResult.rowCount || 0;
          }
        }

        enrollmentCopySummary = {
          insertedClassCount,
          insertedStudentCount,
          selectedClassCount: effectiveClassIds.length,
          carriedStudentClassCount: carryStudentClassIds.length,
          mode: normalizedEnrollMode,
        };
      }

      await db.query("COMMIT");

      const activeTermResult = await db.query(
        `SELECT t.term_id, t.term_name, sy.year_label
         FROM terms t
         JOIN school_years sy ON sy.id = t.school_year_id
         WHERE t.organization_id = $1
           AND t.current = TRUE
         ORDER BY t.term_id DESC
         LIMIT 1`,
        [organizationId]
      );

      const activeTerm = activeTermResult.rows[0] || null;
      const activeTermLabel = activeTerm
        ? [activeTerm.year_label, activeTerm.term_name].filter(Boolean).join(' - ')
        : 'the new term';

      notifyManagersAndSupervisors(db, {
        orgId: Number(organizationId),
        type: 'term_changed',
        title: 'Term settings updated',
        body: `School year / term has changed to ${activeTermLabel}.`,
        link: '/common/manageRecords',
        refId: Number(activeTerm?.term_id) || null,
      }).catch(err => console.error('[Notif] term_changed failed:', err.message));

      if (activeTerm) {
        notifyManagersAndSupervisors(db, {
          orgId: Number(organizationId),
          type: 'new_term_welcome',
          title: `Welcome to ${activeTerm.term_name}`,
          body: `We wish you all the best and good success this new term in ${activeTerm.year_label}.`,
          link: '/common/orgDashboard',
          refId: Number(activeTerm.term_id) || null,
        }).catch(err => console.error('[Notif] new_term_welcome failed:', err.message));
      }

      if (enrollmentCopySummary) {
        if (enrollmentCopySummary.mode === "classes_only") {
          req.flash(
            "success",
            `School year and terms updated successfully. Enrollment copied for ${enrollmentCopySummary.selectedClassCount} class(es): ${enrollmentCopySummary.insertedClassCount} new class record(s) added to the new current term (classes only).`
          );
        } else {
          req.flash(
            "success",
            `School year and terms updated successfully. Enrollment copied for ${enrollmentCopySummary.selectedClassCount} selected class(es): ${enrollmentCopySummary.insertedClassCount} new class record(s) added, and ${enrollmentCopySummary.insertedStudentCount} student(s) carried from ${enrollmentCopySummary.carriedStudentClassCount} previous-term class(es).`
          );
        }
      } else {
        req.flash("success", "School year and terms updated successfully.");
      }
      res.redirect("/common/manageRecords");
    } catch (error) {
      await db.query("ROLLBACK");
      console.error("[ManageRecords] Failed to update school year/terms:", error);
      req.flash("error", "Failed to update school year and terms.");
      res.redirect("/common/manageRecords");
    }
  },

  // Render Create Event & Announcement Form (GET)
  createEventAnnouncementGet: (req, res) => {
    res.render("common/createEventAnnouncement", {
      title: "Create Event & Announcement",
      messages: req.flash(),
    });
  },

  // Handle Create Event & Announcement Form (POST)
  createEventAnnouncementPost: async (req, res, db) => {
    const { type } = req.body;

    try {
      // Log the incoming request body

      // Fetch the current school year and term for the organization
      const currentSchoolYearTerm = await db.query(
        `
            SELECT sy.id as school_year_id, t.term_id
            FROM school_years sy
            JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        `,
        [req.session.organizationId]
      );

      if (currentSchoolYearTerm.rows.length === 0) {
        req.flash(
          "error",
          "No current school year or term found. Please set the current school year and term."
        );
        return res.redirect("/common/manageRecords");
      }

      const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

      const notifyByEmail = req.body.notifyByEmail === 'true' || req.body.notifyByEmail === '1';

      if (type === "event") {
        // Insert new event with the current school year and term
        const insertResult = await db.query(
          "INSERT INTO school_events (name, event_date, details, visibility, organization_id, school_year_id, term_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [
            req.body.eventName,
            req.body.eventDate,
            req.body.eventDetails,
            req.body.visibility,
            req.session.organizationId,
            school_year_id,
            term_id,
          ]
        );

        if (notifyByEmail) {
          const contentId = insertResult.rows[0]?.id;
          broadcastEventAnnouncement(db, {
            organizationId: req.session.organizationId,
            contentType: 'event',
            visibility: req.body.visibility || 'both',
            title: req.body.eventName,
            body: req.body.eventDetails,
            eventDate: req.body.eventDate,
            contentId,
          }).catch((err) => console.error('[Broadcast] Event notification failed:', err.message));
        }

        // G1 — broadcast in-app notification for new event
        notifSvc.createNotification(db, {
          orgId: Number(req.session.organizationId),
          recipientType: 'broadcast',
          recipientId: 0,
          type: 'event_created',
          title: req.body.eventName || 'New Event',
          body: req.body.eventDetails || '',
          link: '/common/orgDashboard',
        }).catch(err => console.error('[Notif] event_created failed:', err.message));
      } else if (type === "announcement") {
        // Insert new announcement with the current school year and term
        const insertResult = await db.query(
          "INSERT INTO announcements (message, visibility, organization_id, school_year_id, term_id) VALUES ($1, $2, $3, $4, $5) RETURNING announcement_id",
          [
            req.body.announcementMessage,
            req.body.visibility,
            req.session.organizationId,
            school_year_id,
            term_id,
          ]
        );

        if (notifyByEmail) {
          const contentId = insertResult.rows[0]?.announcement_id;
          broadcastEventAnnouncement(db, {
            organizationId: req.session.organizationId,
            contentType: 'announcement',
            visibility: req.body.visibility || 'both',
            title: (req.body.announcementMessage || '').substring(0, 80),
            body: req.body.announcementMessage,
            contentId,
          }).catch((err) => console.error('[Broadcast] Announcement notification failed:', err.message));
        }

        // G2 — broadcast in-app notification for new announcement
        notifSvc.createNotification(db, {
          orgId: Number(req.session.organizationId),
          recipientType: 'broadcast',
          recipientId: 0,
          type: 'announcement_created',
          title: (req.body.announcementMessage || 'New Announcement').substring(0, 80),
          body: '',
          link: '/common/orgDashboard',
        }).catch(err => console.error('[Notif] announcement_created failed:', err.message));
      }

      req.flash("success", notifyByEmail
        ? "Event/Announcement created and email notifications are being sent."
        : "Event/Announcement created successfully.");
      res.redirect("/common/manageEventsAnnouncements");
    } catch (err) {
      // Log the error to understand what went wrong
            req.flash("error", "Error creating event/announcement.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  // Manage Events & Announcements (GET)
  manageEventsAnnouncementsGet: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "manageEventsAnnouncements");
      // Fetch the current school year and term
      const currentSchoolYearTerm = await db.query(
        `
            SELECT sy.id as school_year_id, t.term_id
            FROM school_years sy
            JOIN terms t ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        `,
        [req.session.organizationId]
      );

      if (currentSchoolYearTerm.rows.length === 0) {
        req.flash("error", "No current school year or term found.");
        return res.redirect("/common/manageRecords");
      }

      const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

      // Fetch events and announcements tied to the current school year and term
      const events = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",
        [req.session.organizationId, school_year_id, term_id]
      );
      const announcements = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",
        [req.session.organizationId, school_year_id, term_id]
      );

      const messagingStatus = await getMessagingChannelStatus(db, req.session.organizationId).catch(() => ({
        sms: { ready: false },
        whatsapp: { ready: false },
      }));

      res.render("common/manageEventsAnnouncements", {
        title: "Manage Events & Announcements",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        events: events.rows,
        announcements: announcements.rows,
        canBroadcastToGuardians: Boolean(messagingStatus.sms?.ready || messagingStatus.whatsapp?.ready),
        messages: req.flash(),
      });
    } catch (err) {
      req.flash("error", "Error loading events and announcements.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  // Update Event (POST)
  updateEvent: async (req, res, db) => {
    const { id, visibility } = req.body;
    const eventName = req.body.eventName || req.body.name;
    const eventDate = req.body.eventDate;
    const eventDetails = req.body.eventDetails || req.body.details;
    const organizationId = req.session.organizationId;
    const notifyByEmail = req.body.notifyByEmail === 'true' || req.body.notifyByEmail === '1';
    try {
      const updateResult = await db.query(
        "UPDATE school_events SET name = $1, event_date = $2, details = $3, visibility = $4 WHERE id = $5 AND organization_id = $6",
        [eventName, eventDate, eventDetails, visibility, id, organizationId]
      );
      if (updateResult.rowCount === 0) {
        req.flash("error", "Event not found.");
      } else if (notifyByEmail) {
        broadcastEventAnnouncement(db, {
          organizationId,
          contentType: 'event',
          visibility: visibility || 'both',
          title: eventName,
          body: eventDetails,
          eventDate,
          contentId: id,
        }).catch((err) => console.error('[Broadcast] Event update notification failed:', err.message));
      }
      req.flash("success", notifyByEmail
        ? "Event updated and email notifications are being sent."
        : "Event updated successfully.");
      res.redirect("/common/manageEventsAnnouncements");
    } catch (err) {
      req.flash("error", "Error updating event.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  // Update Announcement (POST)
  updateAnnouncement: async (req, res, db) => {
    const { id, visibility } = req.body;
    const announcementMessage = req.body.announcementMessage || req.body.message;
    const notifyByEmail = req.body.notifyByEmail === 'true' || req.body.notifyByEmail === '1';
    try {
      await db.query(
        "UPDATE announcements SET message = $1, visibility = $2 WHERE announcement_id = $3 AND organization_id = $4",
        [announcementMessage, visibility, id, req.session.organizationId]
      );
      if (notifyByEmail) {
        broadcastEventAnnouncement(db, {
          organizationId: req.session.organizationId,
          contentType: 'announcement',
          visibility: visibility || 'both',
          title: (announcementMessage || '').substring(0, 80),
          body: announcementMessage,
          contentId: id,
        }).catch((err) => console.error('[Broadcast] Announcement update notification failed:', err.message));
      }
      req.flash("success", notifyByEmail
        ? "Announcement updated and email notifications are being sent."
        : "Announcement updated successfully.");
      res.redirect("/common/manageEventsAnnouncements");
    } catch (err) {
      req.flash("error", "Error updating announcement.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  addClassSubject: async (req, res, db) => {
    try {
      const { organizationId } = req.session;
      const isEmbedded = isEmbeddedRequest(req, "addClassSubject");

      await ensureClassDashboardLayoutSchema(db);

      const classResult = await db.query(
        `SELECT * FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [organizationId]
      );
      const classes = classResult.rows;

      const subjectResult = await db.query(
        "SELECT * FROM subjects WHERE organization_id = $1",
        [organizationId]
      );
      const subjects = subjectResult.rows;

      const subjectAssignmentsResult = await db.query(
        `SELECT
            LOWER(TRIM(subject_name)) AS subject_key,
            MIN(TRIM(subject_name)) AS subject_name,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT class_id), NULL) AS assigned_class_ids
         FROM subjects
         WHERE organization_id = $1
           AND subject_name IS NOT NULL
           AND TRIM(subject_name) <> ''
         GROUP BY LOWER(TRIM(subject_name))
         ORDER BY MIN(TRIM(subject_name)) ASC`,
        [organizationId]
      );

      const assignableSubjects = subjectAssignmentsResult.rows.map((row) => {
        const assignedClassSet = new Set((row.assigned_class_ids || []).map(Number));
        const availableClasses = classes
          .filter((cls) => !assignedClassSet.has(Number(cls.class_id)))
          .map((cls) => ({
            class_id: cls.class_id,
            class_name: cls.class_name,
          }));

        return {
          subject_key: row.subject_key,
          subject_name: row.subject_name,
          available_classes: availableClasses,
        };
      });

      const gradYearGroupsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE organization_id = $1",
        [organizationId]
      );
      const availableGradYearGroups = gradYearGroupsResult.rows;

      res.render("common/addClassSubject", {
        title: "Add Class and Subject",
        classes,
        subjects,
        assignableSubjects,
        availableGradYearGroups,
        messages: req.flash(),
        isEmbedded,
        hideGlobalHeader: true,
        hideGlobalFooter: true,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (error) {
            req.flash(
        "error",
        "Failed to load the form for adding a class and subject."
      );
      res.redirect("/common/orgDashboard");
    }
  },

  addClass: async (req, res, db) => {
    const { className } = req.body; // This will be an array of class names
    const { organizationId } = req.session;

    if (!className || className.length === 0) {
      req.flash("error", "Please provide at least one class name.");
      return res.redirect("/common/addClassSubject");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await ensureClassDashboardLayoutSchema(client);

      const maxOrderResult = await client.query(
        "SELECT COALESCE(MAX(dashboard_sort_order), 0) AS max_order FROM classes WHERE organization_id = $1",
        [organizationId]
      );
      let nextSortOrder = Number(maxOrderResult.rows[0]?.max_order || 0);

      for (let name of className) {
        if (name.trim() !== "") {
          nextSortOrder += 1;
          await client.query(
            "INSERT INTO classes (class_name, organization_id, dashboard_sort_order) VALUES ($1, $2, $3)",
            [name.trim(), organizationId, nextSortOrder]
          );
        }
      }

      await client.query("COMMIT");
      req.flash("success", "Classes added successfully.");
      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
            req.flash("error", "Failed to add classes.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  addSubject: async (req, res, db) => {
    const { subjectName, classId } = req.body; // Arrays of subject names and classId is now an array of arrays
    const { organizationId } = req.session;

    // Ensure we have at least one subject name and one class ID
    if (!Array.isArray(subjectName) || subjectName.length === 0) {
      req.flash("error", "Please provide at least one subject name.");
      return res.redirect("/common/addClassSubject");
    }

    if (!classId || (Array.isArray(classId) && classId.length === 0)) {
      req.flash("error", "Please select at least one class.");
      return res.redirect("/common/addClassSubject");
    }

    if (subjectName.length > 100) {
      req.flash("error", "Too many subjects submitted.");
      return res.redirect("/common/addClassSubject");
    }

    // prevent  over-insertion of subjects

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < subjectName.length; i++) {
        const name = subjectName[i].trim();

        // Only add the subject if the name is not empty
        if (name !== "") {
          // Get the classIds for this specific subject (indexed)
          let classIds = classId[i];

          // If classIds is not an array or is undefined, skip this subject
          if (!classIds || !Array.isArray(classIds)) {
            continue;
          }

          // Convert to integers
          classIds = classIds.map(Number);

          // Loop through classIds and insert each subject-class pair
          for (let classIdValue of classIds) {
            // Check if this subject already exists for the given class to avoid duplicates
            const existingSubject = await client.query(
              "SELECT * FROM subjects WHERE subject_name = $1 AND class_id = $2 AND organization_id = $3",
              [name, classIdValue, organizationId]
            );

            // If the subject does not already exist, insert it
            if (existingSubject.rows.length === 0) {
              await client.query(
                "INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3)",
                [name, classIdValue, organizationId]
              );
            }
          }
        }
      }
      await client.query("COMMIT");
      req.flash("success", "Subjects added successfully.");
      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
            req.flash("error", "Failed to add subjects.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  assignExistingSubject: async (req, res, db) => {
    const { organizationId } = req.session;
    const subjectKey = (req.body.subjectKey || "").trim().toLowerCase();
    const rawClassIds = req.body.classId;

    const selectedClassIds = Array.isArray(rawClassIds)
      ? rawClassIds
      : rawClassIds
      ? [rawClassIds]
      : [];

    if (!subjectKey) {
      req.flash("error", "Please select an existing subject.");
      return res.redirect("/common/addClassSubject");
    }

    if (selectedClassIds.length === 0) {
      req.flash("error", "Please select at least one class.");
      return res.redirect("/common/addClassSubject");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const subjectNameResult = await client.query(
        `SELECT MIN(TRIM(subject_name)) AS subject_name
         FROM subjects
         WHERE organization_id = $1
           AND LOWER(TRIM(subject_name)) = $2`,
        [organizationId, subjectKey]
      );

      const canonicalSubjectName = subjectNameResult.rows[0]?.subject_name;
      if (!canonicalSubjectName) {
        await client.query("ROLLBACK");
        req.flash("error", "Selected subject was not found.");
        return res.redirect("/common/addClassSubject");
      }

      const classIdNumbers = selectedClassIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);

      if (classIdNumbers.length === 0) {
        await client.query("ROLLBACK");
        req.flash("error", "Please select valid classes.");
        return res.redirect("/common/addClassSubject");
      }

      const validClassesResult = await client.query(
        `SELECT class_id
         FROM classes
         WHERE organization_id = $1
           AND class_id = ANY($2::int[])`,
        [organizationId, classIdNumbers]
      );
      const validClassIds = validClassesResult.rows.map((row) => Number(row.class_id));

      if (validClassIds.length === 0) {
        await client.query("ROLLBACK");
        req.flash("error", "No valid classes selected.");
        return res.redirect("/common/addClassSubject");
      }

      const existingAssignmentsResult = await client.query(
        `SELECT class_id
         FROM subjects
         WHERE organization_id = $1
           AND class_id = ANY($2::int[])
           AND LOWER(TRIM(subject_name)) = $3`,
        [organizationId, validClassIds, subjectKey]
      );
      const alreadyAssigned = new Set(
        existingAssignmentsResult.rows.map((row) => Number(row.class_id))
      );

      const classIdsToInsert = validClassIds.filter((classId) => !alreadyAssigned.has(classId));

      for (const classId of classIdsToInsert) {
        await client.query(
          "INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3)",
          [canonicalSubjectName, classId, organizationId]
        );
      }

      await client.query("COMMIT");

      if (classIdsToInsert.length === 0) {
        req.flash("success", "Subject is already assigned to all selected classes.");
      } else {
        req.flash(
          "success",
          `${canonicalSubjectName} assigned to ${classIdsToInsert.length} class${
            classIdsToInsert.length === 1 ? "" : "es"
          } successfully.`
        );
      }
      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
      req.flash("error", "Failed to assign existing subject.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  updateTerm: async (req, res, db) => {
    const { term_id, term_name, start_date, end_date } = req.body;
    try {
      await db.query(
        "UPDATE terms SET term_name = $1, start_date = $2, end_date = $3 WHERE term_id = $4 AND organization_id = $5",
        [term_name, start_date, end_date, term_id, req.session.organizationId]
      );
      res.redirect("/common/manageRecords");
    } catch (error) {
            res.status(500).send("Error updating term");
    }
  },

  deleteTerm: async (req, res, db) => {
    const termId = Number.parseInt(String(req.body?.term_id ?? ""), 10);
    const organizationId = req.session.organizationId;
    const expectsJson = requestExpectsJson(req);

    const sendError = (statusCode, message) => {
      if (expectsJson) {
        return res.status(statusCode).json({ success: false, message });
      }
      req.flash("error", message);
      return res.redirect("/common/manageRecords");
    };

    if (!organizationId) {
      return sendError(401, "Unauthorized.");
    }
    if (!Number.isInteger(termId)) {
      return sendError(400, "Invalid term selected.");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const termOwn = await client.query(
        `SELECT term_id, school_year_id FROM terms WHERE term_id = $1 AND organization_id = $2 FOR UPDATE`,
        [termId, organizationId]
      );
      if (!termOwn.rows.length) {
        await client.query("ROLLBACK");
        return sendError(404, "Term does not belong to your organization.");
      }
      const schoolYearId = termOwn.rows[0].school_year_id;

      const siblingCount = await client.query(
        `SELECT COUNT(*)::int AS count FROM terms WHERE school_year_id = $1 AND organization_id = $2`,
        [schoolYearId, organizationId]
      );
      if (Number(siblingCount.rows[0]?.count || 0) <= 1) {
        await client.query("ROLLBACK");
        return sendError(409, "Cannot delete the only remaining term for this school year. Delete the school year itself instead, or add another term first.");
      }

      const blockers = await collectTermDeletionBlockers(client, { organizationId, termIds: [termId] });
      if (blockers.length) {
        await client.query("ROLLBACK");
        return sendError(409, buildSchoolYearDependencyErrorMessage(blockers, "term"));
      }

      await client.query(`DELETE FROM term_classes WHERE organization_id = $1 AND term_id = $2`, [organizationId, termId]);
      const deleteResult = await client.query(`DELETE FROM terms WHERE term_id = $1 AND organization_id = $2`, [termId, organizationId]);

      if (deleteResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(404, "Term was not found or could not be deleted.");
      }

      await client.query("COMMIT");
      if (expectsJson) {
        return res.json({ success: true, message: "Term deleted successfully." });
      }
      req.flash("success", "Term deleted successfully.");
      return res.redirect("/common/manageRecords");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error && error.code === "23503") {
        return sendError(409, "Cannot delete this term because related records still exist. Remove them first, then try again.");
      }
      return sendError(500, "Failed to delete term.");
    } finally {
      client.release();
    }
  },

  addGraduationYearGroup: async (req, res, db) => {
    const { graduationYear } = req.body; // Array of graduation years
    const { organizationId } = req.session;

    if (!graduationYear || graduationYear.length === 0) {
      req.flash("error", "Please provide at least one graduation year.");
      return res.redirect("/common/addClassSubject");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Ensure uniqueness is tenant-scoped so each organization can keep the same year-group names.
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'graduation_year_groups_name_key'
          ) THEN
            ALTER TABLE graduation_year_groups
              DROP CONSTRAINT graduation_year_groups_name_key;
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'graduation_year_groups_org_name_key'
          ) THEN
            ALTER TABLE graduation_year_groups
              ADD CONSTRAINT graduation_year_groups_org_name_key UNIQUE (organization_id, name);
          END IF;
        END
        $$;
      `);

      let insertedCount = 0;
      let skippedCount = 0;

      for (let year of graduationYear) {
        if (year.trim() !== "") {
          const yearGroup = `Graduation Class of ${year.trim()} Group`;
          const insertResult = await client.query(
            "INSERT INTO graduation_year_groups (name, organization_id) VALUES ($1, $2) ON CONFLICT (organization_id, name) DO NOTHING",
            [yearGroup, organizationId]
          );

          if (insertResult.rowCount > 0) {
            insertedCount += 1;
          } else {
            skippedCount += 1;
          }
        }
      }

      await client.query("COMMIT");

      if (insertedCount > 0 && skippedCount > 0) {
        req.flash(
          "success",
          `Added ${insertedCount} graduation year group${insertedCount === 1 ? "" : "s"}. ${skippedCount} already existed.`
        );
      } else if (insertedCount > 0) {
        req.flash(
          "success",
          `Added ${insertedCount} graduation year group${insertedCount === 1 ? "" : "s"} successfully.`
        );
      } else {
        req.flash("error", "No new graduation year groups were added. They may already exist.");
      }

      res.redirect("/common/addClassSubject");
    } catch (error) {
      await client.query("ROLLBACK");
            req.flash("error", "Failed to add graduation year groups.");
      res.redirect("/common/addClassSubject");
    } finally {
      client.release();
    }
  },

  manageClassSubjectAndGradYr: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "manageClassSubjectAndGradYr");
      await ensureClassDashboardLayoutSchema(db);

      const graduationYearsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name",
        [req.session.organizationId]
      );
      const classesResult = await db.query(
        `SELECT * FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [req.session.organizationId]
      );
      const subjectsResult = await db.query(
        "SELECT * FROM subjects WHERE organization_id = $1 ORDER BY subject_name",
        [req.session.organizationId]
      );

      const classes = classesResult.rows;
      const subjects = subjectsResult.rows;
      const classMap = new Map(classes.map((cls) => [Number(cls.class_id), cls]));
      const subjectGroupMap = new Map();

      subjects.forEach((subject) => {
        const rawName = (subject.subject_name || "").trim();
        if (!rawName) return;

        const subjectKey = rawName.toLowerCase();
        if (!subjectGroupMap.has(subjectKey)) {
          subjectGroupMap.set(subjectKey, {
            subject_key: subjectKey,
            subject_name: rawName,
            assigned_classes: [],
          });
        }

        const group = subjectGroupMap.get(subjectKey);
        const classId = Number(subject.class_id);
        if (!Number.isInteger(classId)) return;

        const classInfo = classMap.get(classId);
        if (!classInfo) return;

        const alreadyAssigned = group.assigned_classes.some(
          (assignedCls) => Number(assignedCls.class_id) === classId
        );
        if (!alreadyAssigned) {
          group.assigned_classes.push({
            class_id: classInfo.class_id,
            class_name: classInfo.class_name,
          });
        }
      });

      const subjectGroups = Array.from(subjectGroupMap.values())
        .map((group) => {
          const assignedClassIds = new Set(
            group.assigned_classes.map((assignedCls) => Number(assignedCls.class_id))
          );

          const unassigned_classes = classes
            .filter((cls) => !assignedClassIds.has(Number(cls.class_id)))
            .map((cls) => ({
              class_id: cls.class_id,
              class_name: cls.class_name,
            }));

          group.assigned_classes.sort((a, b) =>
            String(a.class_name).localeCompare(String(b.class_name), undefined, {
              sensitivity: "base",
              numeric: true,
            })
          );
          unassigned_classes.sort((a, b) =>
            String(a.class_name).localeCompare(String(b.class_name), undefined, {
              sensitivity: "base",
              numeric: true,
            })
          );

          return {
            ...group,
            unassigned_classes,
          };
        })
        .sort((a, b) =>
          String(a.subject_name).localeCompare(String(b.subject_name), undefined, {
            sensitivity: "base",
            numeric: true,
          })
        );

      res.render("common/manageClassSubjectAndGradYr", {
        title: "Modify Class, Subject & Grad Year",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        graduationYearGroups: graduationYearsResult.rows,
        classes,
        subjects,
        subjectGroups,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
        },
      });
    } catch (error) {
            res.status(500).send("Error loading the management page.");
    }
  },

  management: async (req, res, db) => {
    try {
      await ensureGoogleIntegrationSchema(db);
      const orgSwitchRestriction = await getOrgSwitchFeatureRestriction(db, req).catch(() => ({ isRestricted: false }));
      const canViewPaygiraOrgSwitch = !orgSwitchRestriction.isRestricted
        || orgSwitchRestriction.flags.canViewBilling
        || orgSwitchRestriction.flags.canViewPaygira;
      const roleStr = String(
        req.session.userRole || req.session.user?.account_type || req.session.accountType || ''
      ).trim().toLowerCase();
      const managementPermissionKeys = new Set([
        PERMISSIONS.MANAGE_RECORDS,
        PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS,
        PERMISSIONS.MANAGE_CLASSES_SUBJECTS,
        PERMISSIONS.MANAGE_ASSESSMENTS,
        PERMISSIONS.SET_ASSESSMENT_QUESTIONS,
        PERMISSIONS.MANAGE_STUDENTS,
        PERMISSIONS.MANAGE_GUARDIANS,
        PERMISSIONS.MANAGE_PROMOTIONS,
        PERMISSIONS.APPROVE_PROMOTIONS,
        PERMISSIONS.APPROVE_ADMISSIONS,
        PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS,
        PERMISSIONS.MARK_ATTENDANCE,
        PERMISSIONS.MANAGE_EMPLOYEES,
      ]);
      const localPermissions = Array.isArray(res.locals.userPermissions)
        ? res.locals.userPermissions
        : [];
      const hasManagementPermission = localPermissions.some((permissionKey) =>
        managementPermissionKeys.has(String(permissionKey || '').trim().toLowerCase())
      );
      const canAccessManagementByRole = [
        'organization',
        'admin',
        'mini admin',
        'manager',
        'supervisor',
        'superviser',
      ].includes(roleStr);

      if (!canAccessManagementByRole && !hasManagementPermission) {
        req.flash('error', 'You do not have access to Management Tools.');
        return res.redirect('/common/orgDashboard');
      }

      // Get current term for assessment link
      const termResult = await db.query(`
        SELECT t.term_id, t.term_name
        FROM terms t
        JOIN school_years sy ON t.school_year_id = sy.id
        WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
        LIMIT 1
      `, [req.session.organizationId]);
      
      const currentTerm = termResult.rows.length > 0 ? termResult.rows[0] : null;
      const canManageEmployees = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: req.session.organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.MANAGE_EMPLOYEES
      );
      const googleIntegration = await getGoogleIntegrationStatus(db, req.session.organizationId);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, req.session.organizationId);
      const transportationIntegration = await getTransportationIntegrationStatus(db, req.session.organizationId);
      const miraIntegration = await getMiraIntegrationStatus(db, req.session.organizationId);
      const canUseQuestionSetIntegration =
        Boolean(googleIntegration.activated) || Boolean(studentPortalIntegration.activated);
      const canSetAssessmentQuestions = await userHasPermission(
        db,
        {
          userId: req.session.user?.user_id || req.session.userId || null,
          userRole: req.session.userRole || req.session.user?.account_type || null,
          organizationId: req.session.organizationId || null,
          accountType: req.session.accountType || req.session.user?.account_type || null,
          userEmail: req.session.user?.email || null,
        },
        PERMISSIONS.SET_ASSESSMENT_QUESTIONS
      );
      const setAssessmentQuestionsFeatureEnabled = hasSetAssessmentQuestionsFeature(req);
      const canAccessAssessmentQuestions =
        canUseQuestionSetIntegration && setAssessmentQuestionsFeatureEnabled && canSetAssessmentQuestions;
      const normalizedRole = normalizeRoleKey(
        req.session.userRole || req.session.user?.account_type || req.session.accountType
      );
      const canManageAllClassAssessmentExams = ["manager", "supervisor"].includes(normalizedRole);

      // Email Issues — count failures visible to managers/supervisors
      const canSeeEmailIssues = ['organization', 'admin', 'mini admin', 'supervisor', 'superviser', 'manager'].includes(roleStr);
      let failedEmailCount = 0;
      if (canSeeEmailIssues) {
        try {
          const countRes = await db.query(
            `SELECT COUNT(*) FROM email_delivery_failures WHERE organization_id = $1`,
            [req.session.organizationId]
          );
          failedEmailCount = parseInt(countRes.rows[0].count, 10) || 0;
        } catch (_) { /* table may not exist yet */ }
      }

      res.render("common/managementTools", {
        title: "Management Tools",
        disableMainZoom: true,
        organizationId: req.session.organizationId,
        currentTerm: currentTerm,
        canManageEmployees,
        canSeeEmailIssues,
        failedEmailCount,
        googleIntegration,
        transportationIntegration,
        miraIntegration,
        canManageAllClassAssessmentExams,
        canAccessAssessmentQuestions,
        canViewPaygiraOrgSwitch,
      });
    } catch (error) {
            res.status(500).send("Failed to load management data");
    }
  },

  // ── Email Issues ────────────────────────────────────────────────────────────

  getFailedEmails: async (req, res, db) => {
    try {
      const orgId = req.session.organizationId;
      if (!orgId) return res.status(401).send('Unauthorized');
      const isEmbedded = isEmbeddedRequest(req, "failedEmails");

      // Only managers and supervisors may access this page
      const role = String(
        req.session.userRole || req.session.user?.account_type || req.session.accountType || ''
      ).trim().toLowerCase();
      const allowed = ['organization', 'admin', 'mini admin', 'supervisor', 'superviser', 'manager'].includes(role);
      if (!allowed) return res.status(403).render('403', { title: 'Access Denied' });

      // Ensure the table exists (auto-create on first visit)
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS email_delivery_failures (
            id              SERIAL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            user_id         INTEGER NOT NULL,
            user_type       TEXT NOT NULL DEFAULT 'staff',
            failed_email    TEXT NOT NULL,
            reason          TEXT NOT NULL DEFAULT 'unknown',
            failure_count   INTEGER NOT NULL DEFAULT 1,
            first_failed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (organization_id, user_id, user_type)
          )
        `);
      } catch (_) { /* already exists or no permission — handled below */ }

      let rows = [];
      try {
        const result = await db.query(
          `WITH grouped_failures AS (
             SELECT
               LOWER(TRIM(failed_email)) AS email_key,
               MAX(id) AS id,
               SUM(failure_count)::int AS failure_count,
               MIN(first_failed_at) AS first_failed_at,
               MAX(last_failed_at) AS last_failed_at
             FROM email_delivery_failures
             WHERE organization_id = $1
             GROUP BY LOWER(TRIM(failed_email))
           )
           SELECT
             f.id, f.user_id, f.user_type, f.failed_email, f.reason,
             grouped.failure_count, grouped.first_failed_at, grouped.last_failed_at,
             COALESCE(u.first_name, g.first_name, s.first_name, '') AS first_name,
             COALESCE(u.last_name,  g.last_name,  s.last_name,  '') AS last_name,
             COALESCE(NULLIF(u.image_url,''), NULLIF(g.image_url,''), NULLIF(s.image_url,''), 'profilePlaceholder.png') AS image_url,
             COALESCE(u.account_type::text, CASE WHEN f.user_type = 'student' THEN 'Student' ELSE 'guardian' END) AS account_type
           FROM grouped_failures grouped
           JOIN email_delivery_failures f ON f.id = grouped.id
           LEFT JOIN users    u ON f.user_type = 'staff'    AND u.user_id     = f.user_id AND u.organization_id = f.organization_id
           LEFT JOIN guardians g ON f.user_type = 'guardian' AND g.guardian_id = f.user_id AND g.organization_id = f.organization_id
           LEFT JOIN students s ON f.user_type = 'student'  AND s.student_id  = f.user_id AND s.organization_id = f.organization_id
           ORDER BY grouped.last_failed_at DESC`,
          [orgId]
        );
        rows = result.rows;
      } catch (queryErr) {
        // Table may not exist yet — treat as empty
        console.warn('[failedEmails] table not ready yet, showing empty state:', queryErr.message);
      }

      res.render('common/failedEmails', {
        title: 'Email Issues',
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        failures: rows,
        messages: req.flash(),
      });
    } catch (err) {
      console.error('[failedEmails] getFailedEmails error:', err.message);
      // Render an empty page rather than a hard error
      res.render('common/failedEmails', {
        title: 'Email Issues',
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        failures: [],
        messages: {},
      });
    }
  },

  checkFailedEmail: async (req, res, db) => {
    try {
      const orgId = req.session.organizationId;
      if (!orgId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      await ensureStudentPortalSchema(db);

      const email = String(req.query.email || '').trim().toLowerCase();
      const excludeFailureId = parseInt(req.query.excludeFailureId, 10) || null;

      // 1 — format check
      if (!email) return res.json({ ok: false, error: 'Email is required.' });
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        return res.json({ ok: false, error: 'Invalid email format.' });
      }

      // 2 — duplicate check: same email already used by another user in this org
      //     (we exclude the failure record's own current user from the conflict check)
      let excludeUserId = null;
      let excludeUserType = null;
      if (excludeFailureId) {
        const fRow = await db.query(
          `SELECT user_id, user_type FROM email_delivery_failures WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [excludeFailureId, orgId]
        );
        if (fRow.rows.length > 0) {
          excludeUserId   = fRow.rows[0].user_id;
          excludeUserType = fRow.rows[0].user_type;
        }
      }

      // Check users table
      const staffConflict = await db.query(
        `SELECT user_id, first_name, last_name, account_type::text AS account_type
         FROM users
         WHERE LOWER(email) = $1
           AND organization_id = $2
           AND ($3::int IS NULL OR NOT (user_id = $3 AND $4 = 'staff'))
         LIMIT 1`,
        [email, orgId, excludeUserId, excludeUserType]
      );
      if (staffConflict.rows.length > 0) {
        const u = staffConflict.rows[0];
        return res.json({
          ok: false,
          error: `Already used by ${u.first_name} ${u.last_name} (${u.account_type}) in this organisation.`,
        });
      }

      // Check guardians table
      const guardianConflict = await db.query(
        `SELECT guardian_id, first_name, last_name
         FROM guardians
         WHERE LOWER(email) = $1
           AND organization_id = $2
           AND ($3::int IS NULL OR NOT (guardian_id = $3 AND $4 = 'guardian'))
         LIMIT 1`,
        [email, orgId, excludeUserId, excludeUserType]
      );
      if (guardianConflict.rows.length > 0) {
        const g = guardianConflict.rows[0];
        return res.json({
          ok: false,
          error: `Already used by ${g.first_name} ${g.last_name} (Guardian) in this organisation.`,
        });
      }

      // Check students table
      const studentConflict = await db.query(
        `SELECT student_id, first_name, last_name
         FROM students
         WHERE LOWER(email) = $1
           AND organization_id = $2
           AND ($3::int IS NULL OR NOT (student_id = $3 AND $4 = 'student'))
         LIMIT 1`,
        [email, orgId, excludeUserId, excludeUserType]
      );
      if (studentConflict.rows.length > 0) {
        const s = studentConflict.rows[0];
        return res.json({
          ok: false,
          error: `Already used by ${s.first_name} ${s.last_name} (Student) in this organisation.`,
        });
      }

      const studentAccountConflict = await db.query(
        `SELECT student_id
         FROM student_accounts
         WHERE organization_id = $1
           AND LOWER(login_email) = $2
           AND ($3::int IS NULL OR NOT (student_id = $3 AND $4 = 'student'))
         LIMIT 1`,
        [orgId, email, excludeUserId, excludeUserType]
      );
      if (studentAccountConflict.rows.length > 0) {
        return res.json({
          ok: false,
          error: 'That email address is already used by another student portal account in this organisation.',
        });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('[failedEmails] checkFailedEmail error:', err.message);
      return res.json({ ok: true }); // fail open — don't block the UI on a DB error
    }
  },

  updateFailedEmail: async (req, res, db) => {
    try {
      const orgId = req.session.organizationId;
      if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      await ensureStudentPortalSchema(db);

      const role = String(
        req.session.userRole || req.session.user?.account_type || req.session.accountType || ''
      ).trim().toLowerCase();
      const allowed = ['organization', 'admin', 'mini admin', 'supervisor', 'superviser', 'manager'].includes(role);
      if (!allowed) return res.status(403).json({ success: false, error: 'Access denied' });

      const failureId = parseInt(req.params.id, 10);
      const newEmail = String(req.body.email || '').trim().toLowerCase();

      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(newEmail)) {
        return res.json({ success: false, error: 'Please enter a valid email address.' });
      }

      // Fetch the failure record (scoped to this org)
      const failResult = await db.query(
        `SELECT * FROM email_delivery_failures WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [failureId, orgId]
      );
      if (failResult.rows.length === 0) {
        return res.json({ success: false, error: 'Record not found.' });
      }
      const failure = failResult.rows[0];

      // Server-side duplicate check — reject if another user already owns this email
      const dupStaff = await db.query(
        `SELECT user_id FROM users WHERE LOWER(email) = $1 AND organization_id = $2
         AND NOT (user_id = $3 AND $4 = 'staff') LIMIT 1`,
        [newEmail, orgId, failure.user_id, failure.user_type]
      );
      if (dupStaff.rows.length > 0) {
        return res.json({ success: false, error: 'That email address is already in use by another staff member in this organisation.' });
      }
      const dupGuardian = await db.query(
        `SELECT guardian_id FROM guardians WHERE LOWER(email) = $1 AND organization_id = $2
         AND NOT (guardian_id = $3 AND $4 = 'guardian') LIMIT 1`,
        [newEmail, orgId, failure.user_id, failure.user_type]
      );
      if (dupGuardian.rows.length > 0) {
        return res.json({ success: false, error: 'That email address is already in use by another guardian in this organisation.' });
      }

      const dupStudent = await db.query(
        `SELECT student_id FROM students WHERE LOWER(email) = $1 AND organization_id = $2
         AND NOT (student_id = $3 AND $4 = 'student') LIMIT 1`,
        [newEmail, orgId, failure.user_id, failure.user_type]
      );
      if (dupStudent.rows.length > 0) {
        return res.json({ success: false, error: 'That email address is already in use by another student in this organisation.' });
      }

      const dupStudentAccount = await db.query(
        `SELECT student_id FROM student_accounts WHERE LOWER(login_email) = $1 AND organization_id = $2
         AND NOT (student_id = $3 AND $4 = 'student') LIMIT 1`,
        [newEmail, orgId, failure.user_id, failure.user_type]
      );
      if (dupStudentAccount.rows.length > 0) {
        return res.json({ success: false, error: 'That email address is already in use by another student portal account in this organisation.' });
      }

      // Update the email on the user record
      if (failure.user_type === 'staff') {
        await db.query(
          `UPDATE users SET email = $1 WHERE user_id = $2 AND organization_id = $3`,
          [newEmail, failure.user_id, orgId]
        );
      } else if (failure.user_type === 'student') {
        await db.query(
          `UPDATE students SET email = $1 WHERE student_id = $2 AND organization_id = $3`,
          [newEmail, failure.user_id, orgId]
        );
        await db.query(
          `UPDATE student_accounts SET login_email = $1, updated_at = NOW() WHERE student_id = $2 AND organization_id = $3`,
          [newEmail, failure.user_id, orgId]
        );
      } else {
        await db.query(
          `UPDATE guardians SET email = $1 WHERE guardian_id = $2 AND organization_id = $3`,
          [newEmail, failure.user_id, orgId]
        );
      }

      // Remove the new address from the suppression list so it can receive mail
      const { unsuppressEmail } = require('../utils/emailSuppression');
      await unsuppressEmail(db, newEmail);
      await unsuppressEmail(db, failure.failed_email);

      // Get user's name for the test email
      let displayName = 'User';
      if (failure.user_type === 'staff') {
        const nameRes = await db.query(`SELECT first_name, last_name FROM users WHERE user_id = $1`, [failure.user_id]);
        if (nameRes.rows.length > 0) displayName = `${nameRes.rows[0].first_name} ${nameRes.rows[0].last_name}`.trim();
      } else if (failure.user_type === 'student') {
        const nameRes = await db.query(`SELECT first_name, last_name FROM students WHERE student_id = $1`, [failure.user_id]);
        if (nameRes.rows.length > 0) displayName = `${nameRes.rows[0].first_name} ${nameRes.rows[0].last_name}`.trim();
      } else {
        const nameRes = await db.query(`SELECT first_name, last_name FROM guardians WHERE guardian_id = $1`, [failure.user_id]);
        if (nameRes.rows.length > 0) displayName = `${nameRes.rows[0].first_name} ${nameRes.rows[0].last_name}`.trim();
      }

      // Send a test email — no failureNotification to avoid recursion
      const html = renderCleanEmail({
        title: 'Email Address Verified',
        greeting: `Hello ${displayName},`,
        paragraphs: [
          'Your email address has been successfully updated in Managira.',
          'This message confirms that your new address is working correctly.',
        ],
        noReply: true,
      });

      const sent = await sendEmailSafely({
        to: newEmail,
        subject: 'Managira — Email Address Verified',
        html,
        skipMxCheck: false,
        // No failureNotification — test failure stays silent
      }, 'EmailIssues-Test');

      if (sent) {
        // Test succeeded — clear the failure record
        await db.query(
          `DELETE FROM email_delivery_failures WHERE id = $1 AND organization_id = $2`,
          [failureId, orgId]
        );
        return res.json({ success: true, message: 'Email updated and verified. Record cleared.' });
      } else {
        // Test failed — update the failure record with the new (still-broken) address
        await recordEmailDeliveryFailure(db, orgId, newEmail, 'smtp_hard_bounce', failure.user_id, failure.user_type);
        return res.json({ success: false, error: 'Email address saved but test delivery failed. The address may still be incorrect.' });
      }
    } catch (err) {
      console.error('[failedEmails] updateFailedEmail error:', err.message);
      return res.status(500).json({ success: false, error: 'Server error. Please try again.' });
    }
  },

  feedbackGet: async (req, res, db) => {
    try {
      return res.redirect("/account/settings?section=feedback");
    } catch (error) {
      req.flash("error", "Unable to open the feedback form.");
      return res.redirect("/common/orgDashboard");
    }
  },

  feedbackPost: async (req, res, db) => {
    const shouldReturnJson = wantsJsonResponse(req);

    try {
      await ensureUserFeedbackSchema(db);
      const feedbackActor = await resolveFeedbackSessionContext(db, req);

      if (!feedbackActor.organizationId) {
        const errorMessage = "Unable to determine your organization for feedback.";
        if (shouldReturnJson) {
          return res.status(400).json({ success: false, error: errorMessage });
        }
        req.flash("error", errorMessage);
        return res.redirect("/account/settings?section=feedback");
      }

      const { errors, payload } = validateFeedbackPayload(req.body);
      if (errors.length > 0) {
        if (shouldReturnJson) {
          return res.status(400).json({ success: false, error: errors[0], errors });
        }
        req.flash("error", errors[0]);
        return res.redirect("/account/settings?section=feedback");
      }

      const insertResult = await db.query(
        `INSERT INTO user_feedback (
           organization_id,
           user_id,
           user_name,
           user_role,
           organization_name,
           feedback_type,
           area,
           subject,
           message,
           rating,
           priority,
           status,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'new', NOW(), NOW())
         RETURNING feedback_id, created_at`,
        [
          feedbackActor.organizationId,
          feedbackActor.userId,
          feedbackActor.userName,
          feedbackActor.userRole,
          feedbackActor.organizationName,
          payload.feedbackType,
          payload.area,
          payload.subject,
          payload.message,
          payload.rating,
          payload.priority,
        ]
      );

      if (shouldReturnJson) {
        return res.status(201).json({
          success: true,
          feedbackId: insertResult.rows[0]?.feedback_id || null,
          createdAt: insertResult.rows[0]?.created_at || null,
          message: "Thanks for your feedback. We have recorded it successfully.",
        });
      }

      req.flash("success", "Thanks for your feedback. We have recorded it successfully.");
      return res.redirect("/account/settings?section=feedback");
    } catch (error) {
      if (shouldReturnJson) {
        return res.status(500).json({
          success: false,
          error: "We could not save your feedback right now. Please try again.",
        });
      }

      req.flash("error", "We could not save your feedback right now. Please try again.");
      return res.redirect("/account/settings?section=feedback");
    }
  },

  editGraduationYearGroup: async (req, res, db) => {
    const ids = Array.isArray(req.body.id)
      ? req.body.id
      : req.body.id
      ? [req.body.id]
      : [];
    const names = Array.isArray(req.body.newName)
      ? req.body.newName
      : req.body.newName
      ? [req.body.newName]
      : [];

    if (ids.length === 0 || names.length === 0 || ids.length !== names.length) {
      req.flash("error", "Invalid graduation year group update request.");
      return res.redirect("/common/manageClassSubjectAndGradYr");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      let updatedCount = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = Number(ids[i]);
        const newName = String(names[i] || "").trim();

        if (!Number.isInteger(id) || id <= 0 || !newName) {
          continue;
        }

        await client.query(
          "UPDATE graduation_year_groups SET name = $1 WHERE id = $2 AND organization_id = $3",
          [newName, id, req.session.organizationId]
        );
        updatedCount++;
      }

      await client.query("COMMIT");

      if (updatedCount === 0) {
        req.flash("error", "No valid graduation year group updates were submitted.");
      } else {
        req.flash(
          "success",
          `Updated ${updatedCount} graduation year group${updatedCount === 1 ? "" : "s"} successfully.`
        );
      }
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      await client.query("ROLLBACK");
      req.flash("error", "Failed to update graduation year group.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } finally {
      client.release();
    }
  },

  deleteGraduationYearGroup: async (req, res, db) => {
    const idRaw = req.query?.id ?? req.body?.id;
    const id = Number.parseInt(String(idRaw ?? ""), 10);
    const organizationId = req.session.organizationId;
    const expectsJson = requestExpectsJson(req);

    const sendError = (statusCode, message) => {
      if (expectsJson) return res.status(statusCode).json({ success: false, message });
      req.flash("error", message);
      return res.redirect("/common/manageClassSubjectAndGradYr");
    };
    const sendSuccess = (message) => {
      if (expectsJson) return res.json({ success: true, message });
      req.flash("success", message);
      return res.redirect("/common/manageClassSubjectAndGradYr");
    };

    if (!organizationId) {
      if (expectsJson) return res.status(401).json({ success: false, message: "Unauthorized." });
      req.flash("error", "Unauthorized.");
      return res.redirect("/account/login");
    }
    if (!Number.isInteger(id)) return sendError(400, "Invalid graduation year group selected.");

    try {
      const own = await db.query("SELECT id FROM graduation_year_groups WHERE id = $1 AND organization_id = $2", [id, organizationId]);
      if (!own.rows.length) return sendError(404, "Graduation year group does not belong to your organization.");

      // graduation_year_group_id has no ON DELETE clause on classes/subjects
      // (defaults to RESTRICT), so a class still pointing at this group
      // would previously surface only as a generic "Failed to delete"
      // message via the raw 23503 below - checking first gives a real,
      // actionable count instead.
      const dependentClasses = await db.query(
        "SELECT COUNT(*)::int AS count FROM classes WHERE graduation_year_group_id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      const classCount = Number(dependentClasses.rows[0]?.count || 0);
      if (classCount > 0) {
        return sendError(409, `Cannot delete this graduation year group because ${classCount} class${classCount === 1 ? "" : "es"} still reference it. Reassign or remove them first, then try again.`);
      }

      const result = await db.query("DELETE FROM graduation_year_groups WHERE id = $1 AND organization_id = $2", [id, organizationId]);
      if (result.rowCount === 0) return sendError(404, "Graduation year group was not found or could not be deleted.");

      return sendSuccess("Graduation year group deleted successfully.");
    } catch (error) {
      if (error && error.code === "23503") {
        return sendError(409, "Cannot delete this graduation year group because related records still exist. Remove them first, then try again.");
      }
      return sendError(500, "Failed to delete graduation year group due to an internal error.");
    }
  },

  deleteClass: async (req, res, db) => {
    const classIdRaw = req.query?.classId ?? req.body?.classId;
    const classId = Number.parseInt(String(classIdRaw ?? ""), 10);
    const organizationId = req.session.organizationId;
    const expectsJson = requestExpectsJson(req);

    const sendError = (statusCode, message, extra = {}) => {
      if (expectsJson) {
        return res.status(statusCode).json({ success: false, message, ...extra });
      }
      req.flash("error", message);
      return res.redirect("/common/manageClassSubjectAndGradYr");
    };
    const sendSuccess = (message) => {
      if (expectsJson) {
        return res.json({ success: true, message });
      }
      req.flash("success", message);
      return res.redirect("/common/manageClassSubjectAndGradYr");
    };

    if (!organizationId) {
      if (expectsJson) return res.status(401).json({ success: false, message: "Unauthorized." });
      req.flash("error", "Unauthorized.");
      return res.redirect("/account/login");
    }
    if (!Number.isInteger(classId)) {
      return sendError(400, "Invalid class selected.");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Tenant boundary: ensure the class belongs to caller's org BEFORE
      // walking its subjects — otherwise a foreign classId would let us
      // delete subjects (and user_subjects rows) from another tenant.
      const classOwn = await client.query(
        `SELECT class_id FROM classes WHERE class_id = $1 AND organization_id = $2 FOR UPDATE`,
        [classId, organizationId]
      );
      if (!classOwn.rows.length) {
        await client.query("ROLLBACK");
        return sendError(404, "Class does not belong to your organization.");
      }

      // Previously this deleted straight through and relied on the
      // database's own ON DELETE CASCADE (students.class_id included) to
      // silently remove every student and their records - see
      // collectClassDeletionBlockers above. Now any real dependent data
      // blocks the delete instead.
      const blockers = await collectClassDeletionBlockers(client, { organizationId, classId });
      if (blockers.length) {
        await client.query("ROLLBACK");
        return sendError(409, buildSchoolYearDependencyErrorMessage(blockers, "class"));
      }

      // Check if the class has associated subjects and delete them first
      // (org-scoped subselect) - subjects are the one child this action
      // legitimately owns and is expected to take with it.
      const subjects = await client.query(
        "SELECT subject_id FROM subjects WHERE class_id = $1 AND organization_id = $2",
        [classId, organizationId]
      );

      for (const subject of subjects.rows) {
        // Delete associated records from user_subjects for each subject.
        // Constrain via EXISTS on users so we never wipe another org's
        // user_subjects rows that happen to share subject_id (they cannot
        // legitimately, but defense-in-depth).
        await client.query(
          `DELETE FROM user_subjects us
           WHERE us.subject_id = $1
             AND EXISTS (SELECT 1 FROM users u WHERE u.user_id = us.user_id AND u.organization_id = $2)`,
          [subject.subject_id, organizationId]
        );
        await client.query("DELETE FROM subjects WHERE subject_id = $1 AND organization_id = $2", [subject.subject_id, organizationId]);
      }

      const deleteResult = await client.query("DELETE FROM classes WHERE class_id = $1 AND organization_id = $2", [
        classId,
        organizationId,
      ]);
      if (deleteResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(404, "Class was not found or could not be deleted.");
      }

      await client.query("COMMIT");
      return sendSuccess("Class and all associated subjects deleted successfully.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error && error.code === "23503") {
        return sendError(409, "Cannot delete this class because related records still exist. Remove them first, then try again.");
      }
      return sendError(500, "Failed to delete class due to an internal error.");
    } finally {
      client.release();
    }
  },

  editClass: async (req, res, db) => {
    const classIds = Array.isArray(req.body.classId)
      ? req.body.classId
      : req.body.classId
      ? [req.body.classId]
      : [];
    const classNames = Array.isArray(req.body.newClassName)
      ? req.body.newClassName
      : req.body.newClassName
      ? [req.body.newClassName]
      : [];

    if (classIds.length === 0 || classNames.length === 0 || classIds.length !== classNames.length) {
      req.flash("error", "Invalid class update request.");
      return res.redirect("/common/manageClassSubjectAndGradYr");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      let updatedCount = 0;
      for (let i = 0; i < classIds.length; i++) {
        const classId = Number(classIds[i]);
        const newClassName = String(classNames[i] || "").trim();

        if (!Number.isInteger(classId) || classId <= 0 || !newClassName) {
          continue;
        }

        await client.query(
          "UPDATE classes SET class_name = $1 WHERE class_id = $2 AND organization_id = $3",
          [newClassName, classId, req.session.organizationId]
        );
        updatedCount++;
      }

      await client.query("COMMIT");

      if (updatedCount === 0) {
        req.flash("error", "No valid class updates were submitted.");
      } else {
        req.flash("success", `Updated ${updatedCount} class${updatedCount === 1 ? "" : "es"} successfully.`);
      }
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      await client.query("ROLLBACK");
      req.flash("error", "Failed to update class.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } finally {
      client.release();
    }
  },

  updateClassDashboardLayout: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const rawPayload = String(req.body.layoutPayload || "").trim();
    const expectsJson = requestExpectsJson(req);

    const sendError = (statusCode, message) => {
      if (expectsJson) return res.status(statusCode).json({ success: false, message });
      req.flash("error", message);
      return res.redirect("/common/manageClassSubjectAndGradYr");
    };
    const sendSuccess = (message) => {
      if (expectsJson) return res.json({ success: true, message });
      req.flash("success", message);
      return res.redirect("/common/manageClassSubjectAndGradYr");
    };

    if (!rawPayload) {
      return sendError(400, "No dashboard class layout was submitted.");
    }

    let submittedItems;
    try {
      submittedItems = JSON.parse(rawPayload);
    } catch (_) {
      return sendError(400, "Dashboard class layout data was invalid.");
    }

    if (!Array.isArray(submittedItems) || submittedItems.length === 0) {
      return sendError(400, "Dashboard class layout is empty.");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await ensureClassDashboardLayoutSchema(client);

      const existingClassesResult = await client.query(
        `SELECT class_id, dashboard_break_after, class_name
         FROM classes
         WHERE organization_id = $1
         ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
        [organizationId]
      );

      const existingClassIds = existingClassesResult.rows
        .map((row) => Number(row.class_id))
        .filter((value) => Number.isInteger(value) && value > 0);
      const existingBreakMap = new Map(
        existingClassesResult.rows.map((row) => [Number(row.class_id), Boolean(row.dashboard_break_after)])
      );

      const submittedMap = new Map();
      submittedItems.forEach((item) => {
        const classId = Number(item && item.classId);
        if (!Number.isInteger(classId) || classId <= 0 || submittedMap.has(classId)) return;
        submittedMap.set(classId, {
          classId,
          breakAfter: Boolean(item && item.breakAfter),
        });
      });

      const orderedClassIds = [
        ...Array.from(submittedMap.keys()).filter((classId) => existingBreakMap.has(classId)),
        ...existingClassIds.filter((classId) => !submittedMap.has(classId)),
      ];

      for (let index = 0; index < orderedClassIds.length; index++) {
        const classId = orderedClassIds[index];
        const submitted = submittedMap.get(classId);
        const breakAfter = submitted ? submitted.breakAfter : Boolean(existingBreakMap.get(classId));

        await client.query(
          `UPDATE classes
           SET dashboard_sort_order = $1,
               dashboard_break_after = $2
           WHERE class_id = $3 AND organization_id = $4`,
          [index + 1, breakAfter, classId, organizationId]
        );
      }

      await client.query("COMMIT");
      return sendSuccess("Dashboard class layout saved.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return sendError(500, "Failed to save dashboard class layout.");
    } finally {
      client.release();
    }
  },

  getSubjectsByClass: async (req, res, db) => {
    const { classId } = req.query;
    if (!classId) {
      return res.status(400).json({ error: "Class ID is required." });
    }

    try {
      const subjectsResult = await db.query(
        "SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2 ORDER BY subject_name",
        [classId, req.session.organizationId]
      );
      res.json(subjectsResult.rows);
    } catch (error) {
            res.status(500).json({ error: "Failed to load subjects." });
    }
  },

  editSubject: async (req, res, db) => {
    const { organizationId } = req.session;

    const subjectKeys = Array.isArray(req.body.subjectKey)
      ? req.body.subjectKey
      : req.body.subjectKey
      ? [req.body.subjectKey]
      : [];
    const newNames = Array.isArray(req.body.newName)
      ? req.body.newName
      : req.body.newName
      ? [req.body.newName]
      : [];

    const isBulkUpdate = subjectKeys.length > 0;

    if (!isBulkUpdate) {
      const { subjectId, newName } = req.body;
      try {
        await db.query(
          "UPDATE subjects SET subject_name = $1 WHERE subject_id = $2 AND organization_id = $3",
          [newName, subjectId, organizationId]
        );
        req.flash("success", "Subject updated successfully.");
        return res.redirect("/common/manageClassSubjectAndGradYr");
      } catch (error) {
        req.flash("error", "Failed to update subject.");
        return res.redirect("/common/manageClassSubjectAndGradYr");
      }
    }

    if (subjectKeys.length !== newNames.length) {
      req.flash("error", "Invalid subject update request.");
      return res.redirect("/common/manageClassSubjectAndGradYr");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      let updatedCount = 0;
      for (let i = 0; i < subjectKeys.length; i++) {
        const subjectKey = String(subjectKeys[i] || "").trim().toLowerCase();
        const newName = String(newNames[i] || "").trim();

        if (!subjectKey || !newName) {
          continue;
        }

        const updateResult = await client.query(
          `UPDATE subjects
           SET subject_name = $1
           WHERE organization_id = $2
             AND LOWER(TRIM(subject_name)) = $3`,
          [newName, organizationId, subjectKey]
        );

        if (updateResult.rowCount > 0) {
          updatedCount++;
        }
      }

      await client.query("COMMIT");

      if (updatedCount === 0) {
        req.flash("error", "No valid subject updates were submitted.");
      } else {
        req.flash("success", `Updated ${updatedCount} subject${updatedCount === 1 ? "" : "s"} successfully.`);
      }
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (error) {
      await client.query("ROLLBACK");
      req.flash("error", "Failed to update subjects.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } finally {
      client.release();
    }
  },

  deleteSubject: async (req, res, db) => {
    const { organizationId } = req.session;
    const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;
    const subjectKey = req.query.subjectKey
      ? String(req.query.subjectKey).trim().toLowerCase()
      : null;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      let subjectIds = [];
      if (subjectKey) {
        const subjectIdsResult = await client.query(
          `SELECT subject_id
           FROM subjects
           WHERE organization_id = $1
             AND LOWER(TRIM(subject_name)) = $2`,
          [organizationId, subjectKey]
        );
        subjectIds = subjectIdsResult.rows.map((row) => Number(row.subject_id));
      } else if (Number.isInteger(subjectId) && subjectId > 0) {
        const subjectIdsResult = await client.query(
          `SELECT subject_id
           FROM subjects
           WHERE organization_id = $1
             AND subject_id = $2`,
          [organizationId, subjectId]
        );
        subjectIds = subjectIdsResult.rows.map((row) => Number(row.subject_id));
      }

      if (subjectIds.length === 0) {
        await client.query("ROLLBACK");
        req.flash("error", "Subject not found.");
        return res.redirect("/common/manageClassSubjectAndGradYr");
      }

      const tablesToClean = [
        "user_subjects",
        "student_subjects",
        "pending_student_subjects",
        "assessment_results",
        "category_scores",
        "student_positions",
        "assessments",
      ];

      for (const tableName of tablesToClean) {
        const tableExistsResult = await client.query(
          `SELECT EXISTS (
             SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = $1
           ) AS exists`,
          [tableName]
        );

        if (!tableExistsResult.rows[0]?.exists) {
          continue;
        }

        await client.query(
          `DELETE FROM ${tableName}
           WHERE subject_id = ANY($1::int[])`,
          [subjectIds]
        );
      }

      await client.query(
        `DELETE FROM subjects
         WHERE organization_id = $1
           AND subject_id = ANY($2::int[])`,
        [organizationId, subjectIds]
      );

      await client.query("COMMIT");
      req.flash("success", "Subject and all related assignments/data were deleted successfully.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } catch (err) {
      await client.query("ROLLBACK");
      req.flash("error", "Failed to delete subject.");
      res.redirect("/common/manageClassSubjectAndGradYr");
    } finally {
      client.release();
    }
  },

  getGradYearGroupByClassId: async (req, res, db) => {
    const { classId } = req.query;
    if (!classId) {
      return res.status(400).json({ error: "Class ID is required" });
    }
    try {
      const result = await db.query(
        `
                SELECT g.name as grad_year_group_name
                FROM classes c
                JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.class_id = $1 AND c.organization_id = $2`,
        [classId, req.session.organizationId]
      );

      if (result.rows.length > 0) {
        res.json({ grad_year_group_name: result.rows[0].grad_year_group_name });
      } else {
        res.status(404).json({
          error: "Graduation year group not found for the given class ID.",
        });
      }
    } catch (err) {
            res
        .status(500)
        .json({ error: "Failed to fetch graduation year group data." });
    }
  },

  closeSchoolYear: async (req, res, db) => {
    try {
      const { organizationId } = req.session;
      const isEmbedded = isEmbeddedRequest(req, "closeSchoolYear");

      // Fetch the current school year and its terms
      const currentSchoolYearResult = await db.query(
        `
                SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1 AND sy.current = TRUE
                ORDER BY t.start_date
            `,
        [organizationId]
      );

      const currentSchoolYear =
        currentSchoolYearResult.rows.length > 0
          ? {
              year_label: currentSchoolYearResult.rows[0].year_label,
              terms: currentSchoolYearResult.rows.map((row) => ({
                term_id: row.term_id,
                term_name: row.term_name,
              })),
            }
          : null;

      // Fetch other school years and their terms
      const otherSchoolYearsResult = await db.query(
        `
                SELECT sy.id AS school_year_id, sy.year_label, t.term_id, t.term_name
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1 AND sy.current = FALSE
                ORDER BY sy.year_label DESC, t.start_date
            `,
        [organizationId]
      );

      const otherSchoolYears = [];
      otherSchoolYearsResult.rows.forEach((row) => {
        let schoolYear = otherSchoolYears.find(
          (y) => y.year_label === row.year_label
        );
        if (!schoolYear) {
          schoolYear = { year_label: row.year_label, terms: [] };
          otherSchoolYears.push(schoolYear);
        }
        if (row.term_id) {
          schoolYear.terms.push({
            term_id: row.term_id,
            term_name: row.term_name,
          });
        }
      });

      // Render the page
      res.render("common/closeSchoolYear", {
        title: "Close School Year",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        currentSchoolYear,
        otherSchoolYears,
      });
    } catch (error) {
            req.flash("error", "Failed to load school year data.");
      res.redirect("/");
    }
  },

  termDetails: async (req, res, db) => {
    const { termId } = req.params;
    const organizationId = req.session.organizationId;
    const isEmbedded = isEmbeddedRequest(req, "termDetails");

    try {
      // Best-effort: ensure dashboard arrangement columns exist and are seeded.
      // Do not block page render if this fails.
      try {
        await ensureClassDashboardLayoutSchema(db);
      } catch (_) {}

      // Fetch term details
      const termResult = await db.query(
        `
                SELECT term_id, term_name, start_date, end_date
                FROM terms
                WHERE term_id = $1 AND organization_id = $2
            `,
        [termId, organizationId]
      );

      const term = termResult.rows[0];
      if (!term) {
        req.flash("error", "Invalid term selected.");
        return res.redirect("/common/closeSchoolYear");
      }

      // Fetch all classes enrolled for the term.
      // Prefer dashboard arrangement order, but gracefully fall back to class_name
      // if dashboard_sort_order is not available in this environment.
      let classes = [];
      try {
        const classesResult = await db.query(
          `
                  SELECT
                    c.class_id,
                    c.class_name,
                    COALESCE(c.dashboard_sort_order, 2147483647) AS dashboard_order
                  FROM classes c
                  INNER JOIN enrolled_classes ec ON c.class_id = ec.class_id
                  INNER JOIN enrollments e ON ec.enrollment_id = e.enrollment_id
                  WHERE e.term_id = $1 AND c.organization_id = $2
                  GROUP BY c.class_id, c.class_name, c.dashboard_sort_order
                  ORDER BY dashboard_order, c.class_name ASC, c.class_id ASC
              `,
          [termId, organizationId]
        );
        classes = classesResult.rows.map((row) => ({
          class_id: row.class_id,
          class_name: row.class_name,
        }));
      } catch (_) {
        const fallbackClassesResult = await db.query(
          `
                  SELECT c.class_id, c.class_name
                  FROM classes c
                  INNER JOIN enrolled_classes ec ON c.class_id = ec.class_id
                  INNER JOIN enrollments e ON ec.enrollment_id = e.enrollment_id
                  WHERE e.term_id = $1 AND c.organization_id = $2
                  GROUP BY c.class_id, c.class_name
                  ORDER BY c.class_name ASC, c.class_id ASC
              `,
          [termId, organizationId]
        );
        classes = fallbackClassesResult.rows;
      }

      // Pass title, termId, and classes to the view
      res.render("common/termDetails", {
        title: "Term Details",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        term,
        classes,
        termId,
        organizationId,
        messages: {
          success: req.flash("success"),
          error: req.flash("error"),
          info: req.flash("info"),
        },
      });
    } catch (error) {
            req.flash("error", "Failed to load term details.");
      res.redirect("/common/closeSchoolYear");
    }
  },

  closeGraduationYearGroup: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "closeGraduationYearGroup");
      const gradYearGroupsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE organization_id = $1 ORDER BY name",
        [req.session.organizationId]
      );

      const studentsResult = await db.query(
        "SELECT * FROM students WHERE organization_id = $1 ORDER BY first_name, last_name",
        [req.session.organizationId]
      );

      const gradYearGroups = gradYearGroupsResult.rows.map((group) => ({
        ...group,
        students: studentsResult.rows.filter(
          (student) => student.graduation_year_group_id === group.id
        ),
      }));

      res.render("common/closeGraduationYearGroup", {
        title: "Close Graduation Year Group",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        gradYearGroups,
      });
    } catch (error) {
            res.status(500).send("Failed to load close graduation year group page.");
    }
  },

  closeGraduationYearGroupPost: async (req, res, db) => {
    const { students, action } = req.body;

    try {
      const studentIds = Array.isArray(students) ? students : [students];

      if (action === "archive") {
        // Archive selected students
        const studentData = await db.query(
          "SELECT student_id, graduation_year_group_id FROM students WHERE student_id = ANY($1) AND organization_id = $2",
          [studentIds, req.session.organizationId]
        );

        const archiveQueries = studentData.rows.map((student) =>
          db.query(
            "INSERT INTO archived_student_info (student_id, graduation_year_group_id, organization_id) VALUES ($1, $2, $3)",
            [
              student.student_id,
              student.graduation_year_group_id,
              req.session.organizationId,
            ]
          )
        );

        await Promise.all(archiveQueries);

        // Mark students as graduated
        await db.query(
          "UPDATE students SET graduated = TRUE WHERE student_id = ANY($1) AND organization_id = $2",
          [studentIds, req.session.organizationId]
        );
      }

      res.redirect("/common/closeGraduationYearGroup");
    } catch (error) {
            res.status(500).send("Failed to close graduation year group.");
    }
  },

  archivedStudents: async (req, res, db) => {
    try {
      const archivedGroupsResult = await db.query(
        "SELECT * FROM graduation_year_groups WHERE id IN (SELECT DISTINCT graduation_year_group_id FROM archived_student_info WHERE organization_id = $1)",
        [req.session.organizationId]
      );

      const archivedStudentsResult = await db.query(
        "SELECT s.*, a.graduation_year_group_id FROM students s JOIN archived_student_info a ON s.student_id = a.student_id WHERE a.organization_id = $1",
        [req.session.organizationId]
      );

      const archivedGroups = archivedGroupsResult.rows.map((group) => ({
        ...group,
        students: archivedStudentsResult.rows.filter(
          (student) => student.graduation_year_group_id === group.id
        ),
      }));

      res.render("common/archivedStudents", {
        title: "Archived Students",
        archivedGroups,
      });
    } catch (error) {
            res.status(500).send("Failed to load archived students.");
    }
  },

  unarchiveStudents: async (req, res, db) => {
    const { students } = req.body;

    try {
      const studentIds = Array.isArray(students) ? students : [students];

      // Remove from archive table
      await db.query(
        "DELETE FROM archived_student_info WHERE student_id = ANY($1) AND organization_id = $2",
        [studentIds, req.session.organizationId]
      );

      // Mark students as not graduated
      await db.query(
        "UPDATE students SET graduated = FALSE WHERE student_id = ANY($1) AND organization_id = $2",
        [studentIds, req.session.organizationId]
      );

      res.redirect("/common/archivedStudents");
    } catch (error) {
            res.status(500).send("Failed to unarchive students.");
    }
  },

  // Delete Event (POST)
  deleteEvent: async (req, res, db) => {
    const { id } = req.body;
    try {
      await db.query(
        "DELETE FROM school_events WHERE id = $1 AND organization_id = $2",
        [id, req.session.organizationId]
      );
      req.flash("success", "Event deleted successfully.");
      res.redirect("/common/manageEventsAnnouncements");
    } catch (err) {
      req.flash("error", "Error deleting event.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  // Delete Announcement (POST)
  deleteAnnouncement: async (req, res, db) => {
    const { id } = req.body;
    try {
      await db.query(
        "DELETE FROM announcements WHERE announcement_id = $1 AND organization_id = $2",
        [id, req.session.organizationId]
      );
      req.flash("success", "Announcement deleted successfully.");
      res.redirect("/common/manageEventsAnnouncements");
    } catch (err) {
      req.flash("error", "Error deleting announcement.");
      res.status(500).redirect("/common/manageEventsAnnouncements");
    }
  },

  deleteSchoolYear: async (req, res, db) => {
    const yearIdRaw = req.body?.yearId ?? req.body?.id;
    const yearId = Number.parseInt(String(yearIdRaw || ""), 10);
    const organizationId = req.session.organizationId;
    const expectsJson = requestExpectsJson(req);

    const sendError = (statusCode, message) => {
      if (expectsJson) {
        return res.status(statusCode).json({ success: false, message });
      }
      req.flash("error", message);
      return res.redirect("/common/manageRecords");
    };

    const sendSuccess = (message) => {
      if (expectsJson) {
        return res.json({ success: true, message });
      }
      req.flash("success", message);
      return res.redirect("/common/manageRecords");
    };

    if (!organizationId) {
      if (expectsJson) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }
      req.flash("error", "Unauthorized.");
      return res.redirect("/account/login");
    }

    if (!Number.isInteger(yearId)) {
      return sendError(400, "Invalid school year selected.");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Tenant boundary: only proceed when the year actually belongs to caller.
      const yearOwn = await client.query(
        `SELECT id
         FROM school_years
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [yearId, organizationId]
      );
      if (!yearOwn.rows.length) {
        await client.query("ROLLBACK");
        return sendError(404, "School year does not belong to your organization.");
      }

      const termResult = await client.query(
        `SELECT term_id
         FROM terms
         WHERE school_year_id = $1 AND organization_id = $2`,
        [yearId, organizationId]
      );
      const termIds = termResult.rows
        .map((row) => Number(row.term_id))
        .filter((termId) => Number.isInteger(termId));

      const blockers = await collectSchoolYearDeletionBlockers(client, {
        organizationId,
        schoolYearId: yearId,
        termIds,
      });

      if (blockers.length) {
        await client.query("ROLLBACK");
        return sendError(409, buildSchoolYearDependencyErrorMessage(blockers));
      }

      if (termIds.length) {
        await client.query(
          `DELETE FROM term_classes
           WHERE organization_id = $1
             AND term_id = ANY($2::int[])`,
          [organizationId, termIds]
        );
      }

      await client.query(
        "DELETE FROM terms WHERE school_year_id = $1 AND organization_id = $2",
        [yearId, organizationId]
      );

      const schoolYearDeleteResult = await client.query(
        "DELETE FROM school_years WHERE id = $1 AND organization_id = $2",
        [yearId, organizationId]
      );

      if (schoolYearDeleteResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(404, "School year was not found or could not be deleted.");
      }

      await client.query("COMMIT");
      return sendSuccess("School year deleted successfully.");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        // ignore rollback failures
      }

      if (error && error.code === "23503") {
        return sendError(
          409,
          "Cannot delete this school year because related records still exist. Remove them first, then try again."
        );
      }

      return sendError(500, "Failed to delete school year due to an internal error.");
    } finally {
      client.release();
    }
  },

  deleteSchoolYearPost: async (req, res, db) => {
    return commonController.deleteSchoolYear(req, res, db);
  },

  // Guardian Management Functions
  guardiansListGet: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const isEmbedded = isEmbeddedRequest(req, "guardians");

      const guardiansResult = await db.query(
        `
        WITH legacy_guardians AS (
          SELECT
            MAX(g.guardian_id) AS guardian_id,
            MIN(TRIM(g.first_name)) AS first_name,
            MIN(TRIM(COALESCE(g.last_name, ''))) AS last_name,
            MAX(NULLIF(TRIM(COALESCE(g.email, '')), '')) AS email,
            MAX(NULLIF(TRIM(COALESCE(g.phone, '')), '')) AS phone,
            MAX(NULLIF(TRIM(COALESCE(g.address, '')), '')) AS address,
            MAX(NULLIF(TRIM(COALESCE(g.hometown, '')), '')) AS hometown,
            MAX(NULLIF(TRIM(COALESCE(g.image_url, '')), '')) AS image_url,
            COUNT(DISTINCT g.student_id) AS student_count,
            LOWER(TRIM(g.first_name)) AS first_name_key,
            LOWER(TRIM(COALESCE(g.last_name, ''))) AS last_name_key,
            COALESCE(NULLIF(TRIM(COALESCE(g.phone, '')), ''), '__NO_PHONE__') AS phone_key
          FROM guardians g
          WHERE g.organization_id = $1
          GROUP BY
            LOWER(TRIM(g.first_name)),
            LOWER(TRIM(COALESCE(g.last_name, ''))),
            COALESCE(NULLIF(TRIM(COALESCE(g.phone, '')), ''), '__NO_PHONE__')
        ),
        legacy_with_access AS (
          SELECT
            lg.guardian_id,
            lg.first_name,
            lg.last_name,
            (
              SELECT gp.guardian_id
              FROM guardian_profiles gp
              LEFT JOIN guardian_accounts ga
                ON ga.guardian_id = gp.guardian_id
               AND ga.organization_id = gp.organization_id
              WHERE gp.organization_id = $1
                AND (
                  (lg.email IS NOT NULL AND LOWER(TRIM(COALESCE(gp.email, ''))) = LOWER(TRIM(lg.email)))
                  OR (
                    LOWER(TRIM(gp.first_name)) = lg.first_name_key
                    AND LOWER(TRIM(COALESCE(gp.last_name, ''))) = lg.last_name_key
                    AND COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = lg.phone_key
                  )
                )
              ORDER BY ga.updated_at DESC NULLS LAST, gp.guardian_id DESC
              LIMIT 1
            ) AS matched_profile_guardian_id,
            COALESCE(
              (
                SELECT NULLIF(TRIM(COALESCE(ga.login_email, '')), '')
                FROM guardian_profiles gp
                LEFT JOIN guardian_accounts ga
                  ON ga.guardian_id = gp.guardian_id
                 AND ga.organization_id = gp.organization_id
                WHERE gp.organization_id = $1
                  AND (
                    (lg.email IS NOT NULL AND LOWER(TRIM(COALESCE(gp.email, ''))) = LOWER(TRIM(lg.email)))
                    OR (
                      LOWER(TRIM(gp.first_name)) = lg.first_name_key
                      AND LOWER(TRIM(COALESCE(gp.last_name, ''))) = lg.last_name_key
                      AND COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = lg.phone_key
                    )
                  )
                ORDER BY ga.updated_at DESC NULLS LAST
                LIMIT 1
              ),
              lg.email
            ) AS email,
            COALESCE(
              (
                SELECT NULLIF(TRIM(COALESCE(ga.login_phone, '')), '')
                FROM guardian_profiles gp
                LEFT JOIN guardian_accounts ga
                  ON ga.guardian_id = gp.guardian_id
                 AND ga.organization_id = gp.organization_id
                WHERE gp.organization_id = $1
                  AND (
                    (lg.email IS NOT NULL AND LOWER(TRIM(COALESCE(gp.email, ''))) = LOWER(TRIM(lg.email)))
                    OR (
                      LOWER(TRIM(gp.first_name)) = lg.first_name_key
                      AND LOWER(TRIM(COALESCE(gp.last_name, ''))) = lg.last_name_key
                      AND COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = lg.phone_key
                    )
                  )
                ORDER BY ga.updated_at DESC NULLS LAST
                LIMIT 1
              ),
              lg.phone
            ) AS phone,
            lg.address,
            lg.hometown,
            lg.image_url,
            lg.student_count,
            EXISTS (
              SELECT 1
              FROM guardian_profiles gp
              LEFT JOIN guardian_accounts ga
                ON ga.guardian_id = gp.guardian_id
               AND ga.organization_id = gp.organization_id
              WHERE gp.organization_id = $1
                AND (
                  (lg.email IS NOT NULL AND LOWER(TRIM(COALESCE(gp.email, ''))) = LOWER(TRIM(lg.email)))
                  OR (
                    LOWER(TRIM(gp.first_name)) = lg.first_name_key
                    AND LOWER(TRIM(COALESCE(gp.last_name, ''))) = lg.last_name_key
                    AND COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = lg.phone_key
                  )
                )
            ) AS has_portal_access,
            'legacy'::text AS source
          FROM legacy_guardians lg
        ),
        legacy_collapsed AS (
          SELECT
            MAX(lga.guardian_id) AS guardian_id,
            MIN(lga.first_name) AS first_name,
            MIN(lga.last_name) AS last_name,
            MAX(lga.email) AS email,
            MAX(lga.phone) AS phone,
            MAX(lga.address) AS address,
            MAX(lga.hometown) AS hometown,
            MAX(lga.image_url) AS image_url,
            SUM(lga.student_count)::int AS student_count,
            BOOL_OR(lga.has_portal_access) AS has_portal_access,
            MAX(lga.matched_profile_guardian_id) AS matched_profile_guardian_id,
            'legacy'::text AS source
          FROM legacy_with_access lga
          GROUP BY
            CASE
              WHEN lga.matched_profile_guardian_id IS NOT NULL
                THEN 'profile:' || lga.matched_profile_guardian_id::text
              ELSE 'legacy:' || lga.guardian_id::text
            END
        ),
        profile_guardians AS (
          SELECT
            gp.guardian_id,
            TRIM(gp.first_name) AS first_name,
            TRIM(COALESCE(gp.last_name, '')) AS last_name,
            COALESCE(MAX(NULLIF(TRIM(COALESCE(ga.login_email, '')), '')), NULLIF(TRIM(COALESCE(gp.email, '')), '')) AS email,
            COALESCE(MAX(NULLIF(TRIM(COALESCE(ga.login_phone, '')), '')), NULLIF(TRIM(COALESCE(gp.phone, '')), '')) AS phone,
            NULLIF(TRIM(COALESCE(gp.address, '')), '') AS address,
            NULLIF(TRIM(COALESCE(gp.hometown, '')), '') AS hometown,
            NULLIF(TRIM(COALESCE(gp.image_url, '')), '') AS image_url,
            COUNT(DISTINCT gs.student_id) AS student_count,
            EXISTS (
              SELECT 1
              FROM guardian_accounts ga
              WHERE ga.guardian_id = gp.guardian_id
                AND ga.organization_id = gp.organization_id
            ) AS has_portal_access,
            'profile'::text AS source
          FROM guardian_profiles gp
          LEFT JOIN guardian_accounts ga
            ON ga.guardian_id = gp.guardian_id
           AND ga.organization_id = gp.organization_id
          LEFT JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
          WHERE gp.organization_id = $1
          GROUP BY
            gp.guardian_id,
            gp.first_name,
            gp.last_name,
            gp.email,
            gp.phone,
            gp.address,
            gp.hometown,
            gp.image_url,
            gp.organization_id
        )
        SELECT
          lga.guardian_id,
          lga.first_name,
          lga.last_name,
          lga.email,
          lga.phone,
          lga.address,
          lga.hometown,
          lga.image_url,
          CASE
            WHEN lga.matched_profile_guardian_id IS NOT NULL THEN (
              SELECT COUNT(DISTINCT linked.student_id)::int
              FROM (
                SELECT g.student_id
                FROM guardians g
                WHERE g.organization_id = $1
                  AND (
                    g.guardian_id = lga.guardian_id
                    OR (
                      LOWER(TRIM(COALESCE(g.first_name, ''))) = LOWER(TRIM(COALESCE(lga.first_name, '')))
                      AND LOWER(TRIM(COALESCE(g.last_name, ''))) = LOWER(TRIM(COALESCE(lga.last_name, '')))
                      AND (
                        COALESCE(NULLIF(TRIM(COALESCE(g.phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE(lga.phone, '')), ''), '__NO_PHONE__')
                        OR (
                          lga.email IS NOT NULL
                          AND LOWER(TRIM(COALESCE(g.email, ''))) = LOWER(TRIM(lga.email))
                        )
                      )
                    )
                  )
                UNION
                SELECT gs.student_id
                FROM guardian_students gs
                WHERE gs.guardian_id = lga.matched_profile_guardian_id
              ) linked
            )
            ELSE lga.student_count
          END AS student_count,
          lga.has_portal_access,
          lga.source
        FROM legacy_collapsed lga
        UNION ALL
        SELECT
          pg.guardian_id,
          pg.first_name,
          pg.last_name,
          pg.email,
          pg.phone,
          pg.address,
          pg.hometown,
          pg.image_url,
          pg.student_count,
          pg.has_portal_access,
          pg.source
        FROM profile_guardians pg
        WHERE NOT EXISTS (
          SELECT 1
          FROM legacy_collapsed lga
          WHERE (
            lga.matched_profile_guardian_id = pg.guardian_id
          )
          OR (
            pg.email IS NOT NULL
            AND lga.email IS NOT NULL
            AND LOWER(TRIM(pg.email)) = LOWER(TRIM(lga.email))
          )
          OR (
            LOWER(TRIM(pg.first_name)) = LOWER(TRIM(lga.first_name))
            AND LOWER(TRIM(COALESCE(pg.last_name, ''))) = LOWER(TRIM(COALESCE(lga.last_name, '')))
            AND COALESCE(NULLIF(TRIM(COALESCE(pg.phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE(lga.phone, '')), ''), '__NO_PHONE__')
          )
        )
        ORDER BY first_name ASC, last_name ASC, guardian_id DESC
        `,
        [organizationId]
      );

            return res.render("common/guardians", {
        title: "Guardian Management",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        guardians: guardiansResult.rows,
        messages: req.flash(),
        req,
      });
    } catch (error) {
            req.flash('error', 'Error loading guardians');
      return res.redirect('/common/orgDashboard');
    }
  },

  guardianDetailsGet: async (req, res, db) => {
    try {
      await ensureGuardianBirthdaySchema(db);
      const organizationId = req.session.organizationId;
      const guardianId = req.query.guardianId;
      const guardianSource = req.query.source === 'profile' ? 'profile' : 'legacy';
      const isEmbedded = isEmbeddedRequest(req, "guardianDetails");

      if (!guardianId) {
        req.flash('error', 'Guardian ID is required');
        return res.redirect('/common/guardians');
      }

      const userRole = req.session.userRole || '';
      const userId = req.session.user?.user_id || req.session.userId || null;

      let guardian = null;
      let account = { login_email: null, login_phone: null };
      let studentsResult;

      if (guardianSource === 'profile') {
        const guardianResult = await db.query(
          `SELECT gp.*, ga.login_email, ga.login_phone,
                  ga.password_hash IS NOT NULL                            AS has_password,
                  RIGHT(ga.password_hash, 1)                             AS password_last_char,
                  ga.created_at                                           AS account_created_at,
                  'profile'::text AS source
           FROM guardian_profiles gp
           LEFT JOIN guardian_accounts ga
             ON ga.guardian_id = gp.guardian_id
            AND ga.organization_id = gp.organization_id
           WHERE gp.guardian_id = $1 AND gp.organization_id = $2
           ORDER BY (ga.password_hash IS NOT NULL) DESC
           LIMIT 1`,
          [guardianId, organizationId]
        );

        if (!guardianResult.rows.length) {
          req.flash('error', 'Guardian not found');
          return res.redirect('/common/guardians');
        }

        guardian = guardianResult.rows[0];
        account = {
          login_email: guardian.login_email || guardian.email || null,
          login_phone: guardian.login_phone || guardian.phone || null,
        };

        const teacherFilter = userRole === 'Teacher' && userId
          ? `
            AND s.class_id IN (
              SELECT uc.class_id FROM user_classes uc WHERE uc.user_id = $3
              UNION
              SELECT DISTINCT sub.class_id
              FROM user_subjects us
              JOIN subjects sub ON us.subject_id = sub.subject_id
              WHERE us.user_id = $3 AND sub.organization_id = $2
            )`
          : '';
        const studentParams = userRole === 'Teacher' && userId
          ? [guardianId, organizationId, userId]
          : [guardianId, organizationId];

        studentsResult = await db.query(
          `
          WITH linked_students AS (
            SELECT gs.student_id
            FROM guardian_students gs
            WHERE gs.guardian_id = $1
            UNION
            SELECT g.student_id
            FROM guardians g
            WHERE g.guardian_id = $1 AND g.organization_id = $2
          )
          SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.image_url,
                 c.class_name, c.class_id, 'Parent/Guardian' AS relationship
          FROM linked_students ls
          JOIN students s ON ls.student_id = s.student_id
          LEFT JOIN classes c ON s.class_id = c.class_id
          WHERE s.organization_id = $2
          ${teacherFilter}
          ORDER BY s.first_name ASC
          `,
          studentParams
        );
      } else {
        const guardianResult = await db.query(
          `SELECT *, 'legacy'::text AS source FROM guardians WHERE guardian_id = $1 AND organization_id = $2`,
          [guardianId, organizationId]
        );

        if (!guardianResult.rows.length) {
          req.flash('error', 'Guardian not found');
          return res.redirect('/common/guardians');
        }

        guardian = guardianResult.rows[0];
        account = { login_email: guardian.email || null, login_phone: guardian.phone || null };

        const teacherFilter = userRole === 'Teacher' && userId
          ? `
            AND s.class_id IN (
              SELECT uc.class_id FROM user_classes uc WHERE uc.user_id = $3
              UNION
              SELECT DISTINCT sub.class_id
              FROM user_subjects us
              JOIN subjects sub ON us.subject_id = sub.subject_id
              WHERE us.user_id = $3 AND sub.organization_id = $2
            )`
          : '';

        const studentParams = userRole === 'Teacher' && userId
          ? [guardianId, organizationId, userId]
          : [guardianId, organizationId];

        studentsResult = await db.query(
          `
          WITH legacy_anchor AS (
            SELECT
              guardian_id,
              LOWER(TRIM(COALESCE(first_name, ''))) AS first_name_key,
              LOWER(TRIM(COALESCE(last_name, ''))) AS last_name_key,
              LOWER(TRIM(COALESCE(email, ''))) AS email_key,
              COALESCE(NULLIF(TRIM(COALESCE(phone, '')), ''), '__NO_PHONE__') AS phone_key
            FROM guardians
            WHERE guardian_id = $1 AND organization_id = $2
            LIMIT 1
          ),
          matched_profile AS (
            SELECT gp.guardian_id
            FROM guardian_profiles gp
            JOIN legacy_anchor la ON TRUE
            WHERE gp.organization_id = $2
              AND (
                (la.email_key <> '' AND LOWER(TRIM(COALESCE(gp.email, ''))) = la.email_key)
                OR (
                  LOWER(TRIM(COALESCE(gp.first_name, ''))) = la.first_name_key
                  AND LOWER(TRIM(COALESCE(gp.last_name, ''))) = la.last_name_key
                  AND COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = la.phone_key
                )
              )
            ORDER BY gp.updated_at DESC NULLS LAST, gp.guardian_id DESC
            LIMIT 1
          ),
          linked_students AS (
            SELECT DISTINCT g.student_id
            FROM guardians g
            JOIN legacy_anchor la ON TRUE
            WHERE g.organization_id = $2
              AND (
                g.guardian_id = la.guardian_id
                OR (
                  LOWER(TRIM(COALESCE(g.first_name, ''))) = la.first_name_key
                  AND LOWER(TRIM(COALESCE(g.last_name, ''))) = la.last_name_key
                  AND (
                    COALESCE(NULLIF(TRIM(COALESCE(g.phone, '')), ''), '__NO_PHONE__') = la.phone_key
                    OR (la.email_key <> '' AND LOWER(TRIM(COALESCE(g.email, ''))) = la.email_key)
                  )
                )
              )
            UNION
            SELECT DISTINCT gs.student_id
            FROM guardian_students gs
            WHERE gs.guardian_id = (SELECT guardian_id FROM matched_profile)
          )
          SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.image_url,
                 c.class_name, c.class_id, 'Parent/Guardian' AS relationship
          FROM linked_students ls
          JOIN students s ON ls.student_id = s.student_id
          LEFT JOIN classes c ON s.class_id = c.class_id
          WHERE s.organization_id = $2
          ${teacherFilter}
          ORDER BY s.first_name ASC
          `,
          studentParams
        );
      }

      if (studentsResult?.rows?.length) {
        const studentIds = studentsResult.rows
          .map((row) => Number.parseInt(row.student_id, 10))
          .filter((id) => Number.isInteger(id) && id > 0);

        if (studentIds.length) {
          const effectiveClassResult = await db.query(
            `WITH current_term AS (
               SELECT term_id
               FROM terms
               WHERE organization_id = $1 AND current = TRUE
               ORDER BY start_date DESC, term_id DESC
               LIMIT 1
             ),
             ranked AS (
               SELECT
                 es.student_id,
                 es.class_id,
                 c.class_name,
                 ROW_NUMBER() OVER (
                   PARTITION BY es.student_id
                   ORDER BY e.created_at DESC, e.enrollment_id DESC
                 ) AS rn
               FROM enrollments e
               JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
               JOIN classes c ON c.class_id = es.class_id
               WHERE e.organization_id = $1
                 AND e.term_id = (SELECT term_id FROM current_term)
                 AND es.student_id = ANY($2::int[])
             )
             SELECT student_id, class_id, class_name
             FROM ranked
             WHERE rn = 1`,
            [organizationId, studentIds]
          );

          const effectiveClassByStudent = new Map(
            effectiveClassResult.rows.map((row) => [Number.parseInt(row.student_id, 10), row])
          );

          studentsResult.rows = studentsResult.rows.map((row) => {
            const mapped = effectiveClassByStudent.get(Number.parseInt(row.student_id, 10));
            if (!mapped) return row;
            return {
              ...row,
              class_id: mapped.class_id || row.class_id,
              class_name: mapped.class_name || row.class_name,
            };
          });
        }
      }

      // Get current term
      const currentTermId = req.session.currentTermId;

      // ------------------------------------------------------------------
      // Resolve portal password status. For profile guardians the main query
      // already fetched it; for legacy guardians we need a separate lookup.
      // ------------------------------------------------------------------
      let guardianPasswordStatus = { hasPassword: false, lastChar: null };
      if (guardianSource === 'profile') {
        guardianPasswordStatus = {
          hasPassword: Boolean(guardian.has_password),
          lastChar: guardian.password_last_char || null,
        };
      } else {
        // Legacy guardian: look up via profile match (same heuristic used when
        // sending the password email).
        const legacyAccCheck = await db.query(
          `SELECT ga.password_hash IS NOT NULL AS has_password,
                  RIGHT(ga.password_hash, 1)   AS password_last_char
           FROM guardian_profiles gp
           JOIN guardian_accounts ga
             ON ga.guardian_id = gp.guardian_id
            AND ga.organization_id = gp.organization_id
           WHERE gp.organization_id = $1
             AND LOWER(TRIM(COALESCE(gp.first_name, ''))) = LOWER(TRIM(COALESCE($2, '')))
             AND LOWER(TRIM(COALESCE(gp.last_name, '')))  = LOWER(TRIM(COALESCE($3, '')))
             AND (
               COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE($4, '')), ''), '__NO_PHONE__')
               OR LOWER(TRIM(COALESCE(gp.email, ''))) = LOWER(TRIM(COALESCE($5, '')))
             )
           ORDER BY (ga.password_hash IS NOT NULL) DESC
           LIMIT 1`,
          [organizationId, guardian.first_name, guardian.last_name, guardian.phone || null, guardian.email || null]
        );
        if (legacyAccCheck.rows.length) {
          guardianPasswordStatus = {
            hasPassword: Boolean(legacyAccCheck.rows[0].has_password),
            lastChar: legacyAccCheck.rows[0].password_last_char || null,
          };
        }
      }

      // Determine edit capability: managers & anyone with manage_guardians permission
      // Teachers are never allowed to edit.
      const canEdit = userRole !== 'Teacher' && (
        isManagerLikeRole(userRole) || await userHasPermission(
          db,
          { userId, userRole, organizationId },
          PERMISSIONS.MANAGE_GUARDIANS
        )
      );

      const hasGuardianPortal = await hasGuardianPortalFeature(db, organizationId);

      return res.render("common/guardianDetails", {
        title: "Guardian Details",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        guardian: guardian,
        students: studentsResult.rows,
        currentTermId: currentTermId,
        account,
        canEdit,
        hasGuardianPortalFeature: hasGuardianPortal,
        guardianPasswordStatus,
        messages: req.flash(),
        req,
      });
    } catch (error) {
            req.flash('error', 'Error loading guardian details');
      return res.redirect('/common/guardians');
    }
  },

  guardianEditPost: async (req, res, db) => {
    try {
      await ensureGuardianBirthdaySchema(db);
      const organizationId = req.session.organizationId;
      const guardianId = req.params.guardianId;
      const guardianSource = req.query.source === 'profile' ? 'profile' : 'legacy';
      const { firstName, lastName, email, phone, address, hometown, dateOfBirth } = req.body;
      const cleanedPhone = phone ? String(phone).replace(/[^\d+]/g, '') : null;

      let imageUrl = null;
      if (req.file) {
        const s3Key = `images/guardianimages/${organizationId}/${Date.now()}_${req.file.originalname}`;
        imageUrl = await uploadToS3(req.file, s3Key);
      }

      if (guardianSource === 'profile') {
        // Read old profile name so we can cross-sync the legacy guardians table
        const oldProfileRow = (await db.query(
          `SELECT first_name, last_name FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
          [guardianId, organizationId]
        )).rows[0];

        const updateProfileQuery = imageUrl
          ? `UPDATE guardian_profiles
             SET first_name = $1, last_name = $2, email = $3, phone = $4,
             address = $5, hometown = $6, date_of_birth = $7, image_url = $8, updated_at = NOW()
           WHERE guardian_id = $9 AND organization_id = $10`
          : `UPDATE guardian_profiles
             SET first_name = $1, last_name = $2, email = $3, phone = $4,
             address = $5, hometown = $6, date_of_birth = $7, updated_at = NOW()
           WHERE guardian_id = $8 AND organization_id = $9`;

        const profileParams = imageUrl
          ? [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null, imageUrl, guardianId, organizationId]
          : [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null, guardianId, organizationId];

        await db.query(updateProfileQuery, profileParams);
        await db.query(
          `UPDATE guardian_accounts
           SET login_email = $1, login_phone = $2, updated_at = NOW()
           WHERE guardian_id = $3 AND organization_id = $4`,
          [email || null, cleanedPhone, guardianId, organizationId]
        );

        // Sync to legacy guardians table (name-based match using old name)
        if (oldProfileRow) {
          await db.query(
            `UPDATE guardians
               SET first_name = $1, last_name = $2, email = $3, phone = $4, address = $5, hometown = $6, date_of_birth = $7
             WHERE organization_id = $8
               AND LOWER(TRIM(first_name)) = LOWER(TRIM($9))
               AND LOWER(TRIM(last_name))  = LOWER(TRIM($10))`,
            [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null,
             organizationId, oldProfileRow.first_name, oldProfileRow.last_name]
          );
        }
      } else {
        // Read old guardian data so we can cross-sync guardian_profiles / guardian_accounts
        const oldGuardianRow = (await db.query(
          `SELECT first_name, last_name FROM guardians WHERE guardian_id=$1 AND organization_id=$2`,
          [guardianId, organizationId]
        )).rows[0];

        const updateQuery = imageUrl
          ? `UPDATE guardians
             SET first_name = $1, last_name = $2, email = $3, phone = $4,
             address = $5, hometown = $6, date_of_birth = $7, image_url = $8
           WHERE guardian_id = $9 AND organization_id = $10`
          : `UPDATE guardians
             SET first_name = $1, last_name = $2, email = $3, phone = $4,
             address = $5, hometown = $6, date_of_birth = $7
           WHERE guardian_id = $8 AND organization_id = $9`;

        const params = imageUrl
          ? [firstName, lastName, email || null, phone, address, hometown, dateOfBirth || null, imageUrl, guardianId, organizationId]
          : [firstName, lastName, email || null, phone, address, hometown, dateOfBirth || null, guardianId, organizationId];

        await db.query(updateQuery, params);

        // Sync to guardian_profiles and guardian_accounts by old name match
        if (oldGuardianRow) {
          await db.query(
            `UPDATE guardian_profiles
               SET first_name = $1, last_name = $2, email = $3, phone = $4, address = $5, hometown = $6, date_of_birth = $7, updated_at = NOW()
             WHERE organization_id = $8
               AND LOWER(TRIM(first_name)) = LOWER(TRIM($9))
               AND LOWER(TRIM(last_name))  = LOWER(TRIM($10))`,
            [firstName, lastName, email || null, phone || null, address, hometown, dateOfBirth || null,
             organizationId, oldGuardianRow.first_name, oldGuardianRow.last_name]
          );
          await db.query(
            `UPDATE guardian_accounts
               SET login_email = $1, login_phone = $2, updated_at = NOW()
             WHERE organization_id = $3
               AND guardian_id IN (
                 SELECT guardian_id FROM guardian_profiles
                 WHERE organization_id = $3
                   AND LOWER(TRIM(first_name)) = LOWER(TRIM($4))
                   AND LOWER(TRIM(last_name))  = LOWER(TRIM($5))
               )`,
            [email || null, cleanedPhone, organizationId, firstName, lastName]
          );
        }
      }

      req.flash('success', 'Guardian information updated successfully');
      return res.redirect(`/common/guardianDetails?guardianId=${guardianId}&source=${guardianSource}`);
    } catch (error) {
            req.flash('error', 'Error updating guardian information');
      const guardianSource = req.query.source === 'profile' ? 'profile' : 'legacy';
      return res.redirect(`/common/guardianDetails?guardianId=${req.params.guardianId}&source=${guardianSource}`);
    }
  },

  guardianRemoveStudent: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const { guardianId, studentId, source } = req.body;

      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      if (source === 'profile') {
        // Verify the guardian profile and the student both belong to the
        // caller's organization before unlinking the relationship.
        await db.query(
          `DELETE FROM guardian_students
           WHERE guardian_id = $1
             AND student_id = $2
             AND EXISTS (
               SELECT 1 FROM guardian_profiles gp
               WHERE gp.guardian_id = $1 AND gp.organization_id = $3
             )
             AND EXISTS (
               SELECT 1 FROM students s
               WHERE s.student_id = $2 AND s.organization_id = $3
             )`,
          [guardianId, studentId, organizationId]
        );
      } else {
        await db.query(
          `DELETE FROM guardians WHERE guardian_id = $1 AND student_id = $2 AND organization_id = $3`,
          [guardianId, studentId, organizationId]
        );
      }

      req.flash('success', 'Student removed from guardian');
      return res.json({ success: true });
    } catch (error) {
            return res.status(500).json({ success: false, error: 'Error removing student' });
    }
  },

  guardianRelinkStudent: async (req, res, db) => {
    const client = await db.connect();
    try {
      const organizationId = req.session.organizationId;
      const {
        currentGuardianId,
        studentId,
        source,
        mode,
        targetGuardianId,
        guardians,
        guardian,
      } = req.body || {};

      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const parsedStudentId = parseInt(studentId, 10);
      const parsedCurrentGuardianId = parseInt(currentGuardianId, 10);
      if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0 || !Number.isInteger(parsedCurrentGuardianId) || parsedCurrentGuardianId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid guardian or student.' });
      }

      const studentRow = (await client.query(
        `SELECT student_id FROM students WHERE student_id = $1 AND organization_id = $2 LIMIT 1`,
        [parsedStudentId, organizationId]
      )).rows[0];
      if (!studentRow) {
        return res.status(404).json({ success: false, error: 'Student not found.' });
      }

      await client.query('BEGIN');

      let targetGuardianProfileId = null;
      let targetGuardianProfile = null;
      let targetGuardianProfiles = [];

      if (mode === 'existing') {
        const parsedTargetGuardianId = parseInt(targetGuardianId, 10);
        if (!Number.isInteger(parsedTargetGuardianId) || parsedTargetGuardianId <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: 'Please select a guardian to relink.' });
        }

        targetGuardianProfile = (await client.query(
          `SELECT guardian_id, first_name, last_name, phone, email, address, hometown, image_url
           FROM guardian_profiles
           WHERE guardian_id = $1 AND organization_id = $2
           LIMIT 1`,
          [parsedTargetGuardianId, organizationId]
        )).rows[0] || null;

        if (!targetGuardianProfile) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, error: 'Selected guardian was not found.' });
        }

        targetGuardianProfileId = Number(targetGuardianProfile.guardian_id);
        targetGuardianProfiles = [targetGuardianProfile];
      } else if (mode === 'new') {
        const rawNewGuardians = Array.isArray(guardians)
          ? guardians
          : (guardian && typeof guardian === 'object' ? [guardian] : []);

        const normalizedNewGuardians = rawNewGuardians
          .map((entry) => ({
            firstName: String(entry?.firstName || '').trim(),
            lastName: String(entry?.lastName || '').trim(),
            phone: String(entry?.phone || '').trim(),
            email: String(entry?.email || '').trim().toLowerCase(),
            address: String(entry?.address || '').trim(),
            hometown: String(entry?.hometown || '').trim(),
          }))
          .filter((entry) => entry.firstName && entry.lastName);

        if (!normalizedNewGuardians.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: 'New guardian first and last name are required.' });
        }

        for (const newGuardian of normalizedNewGuardians) {
          const insertedOrExistingGuardianId = await ensureGuardianPortalProfileAndAccount(client, {
            organizationId,
            firstName: newGuardian.firstName,
            lastName: newGuardian.lastName,
            phone: newGuardian.phone || null,
            email: newGuardian.email || null,
            address: newGuardian.address || null,
            hometown: newGuardian.hometown || null,
            imageUrl: null,
          });

          const profileRow = (await client.query(
            `SELECT guardian_id, first_name, last_name, phone, email, address, hometown, image_url
             FROM guardian_profiles
             WHERE guardian_id = $1 AND organization_id = $2
             LIMIT 1`,
            [insertedOrExistingGuardianId, organizationId]
          )).rows[0] || null;

          if (!profileRow) {
            await client.query('ROLLBACK');
            return res.status(500).json({ success: false, error: 'Failed to create guardian profile.' });
          }

          if (!targetGuardianProfiles.some((row) => Number(row.guardian_id) === Number(profileRow.guardian_id))) {
            targetGuardianProfiles.push(profileRow);
          }
        }

        targetGuardianProfile = targetGuardianProfiles[0] || null;
        targetGuardianProfileId = targetGuardianProfile ? Number(targetGuardianProfile.guardian_id) : null;
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Invalid relink mode.' });
      }

      if (String(source) === 'profile') {
        const currentProfile = (await client.query(
          `SELECT guardian_id, first_name, last_name, phone, email
           FROM guardian_profiles
           WHERE guardian_id = $1 AND organization_id = $2
           LIMIT 1`,
          [parsedCurrentGuardianId, organizationId]
        )).rows[0] || null;

        if (!currentProfile) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, error: 'Current guardian profile not found.' });
        }

        if (targetGuardianProfiles.some((row) => Number(row.guardian_id) === Number(currentProfile.guardian_id))) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: 'Student is already linked to that guardian.' });
        }

        await client.query(
          `DELETE FROM guardian_students
           WHERE guardian_id = $1 AND student_id = $2`,
          [parsedCurrentGuardianId, parsedStudentId]
        );

        for (const targetProfile of targetGuardianProfiles) {
          await client.query(
            `INSERT INTO guardian_students (guardian_id, student_id, relationship)
             VALUES ($1, $2, 'Parent/Guardian')
             ON CONFLICT DO NOTHING`,
            [targetProfile.guardian_id, parsedStudentId]
          );
        }

        // Keep legacy table in sync for pages still backed by guardians rows.
        await client.query(
          `DELETE FROM guardians
           WHERE organization_id = $1
             AND student_id = $2
             AND LOWER(TRIM(first_name)) = LOWER(TRIM($3))
             AND LOWER(TRIM(COALESCE(last_name, ''))) = LOWER(TRIM(COALESCE($4, '')))
             AND (
               COALESCE(NULLIF(TRIM(COALESCE(phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE($5, '')), ''), '__NO_PHONE__')
               OR COALESCE(NULLIF(TRIM(COALESCE(email, '')), ''), '__NO_EMAIL__') = COALESCE(NULLIF(TRIM(COALESCE($6, '')), ''), '__NO_EMAIL__')
             )`,
          [
            organizationId,
            parsedStudentId,
            currentProfile.first_name,
            currentProfile.last_name,
            currentProfile.phone || null,
            currentProfile.email || null,
          ]
        );
      } else {
        const currentLegacyIdentity = (await client.query(
          `SELECT first_name, last_name, phone, email
           FROM guardians
           WHERE guardian_id = $1 AND organization_id = $2
           LIMIT 1`,
          [parsedCurrentGuardianId, organizationId]
        )).rows[0] || null;

        const deleteCurrentLegacy = await client.query(
          `DELETE FROM guardians
           WHERE organization_id = $1
             AND student_id = $2
             AND (
               guardian_id = $3
               OR (
                 $4::text IS NOT NULL
                 AND LOWER(TRIM(first_name)) = LOWER(TRIM($4::text))
                 AND LOWER(TRIM(COALESCE(last_name, ''))) = LOWER(TRIM(COALESCE($5::text, '')))
                 AND (
                   COALESCE(NULLIF(TRIM(COALESCE(phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE($6::text, '')), ''), '__NO_PHONE__')
                   OR COALESCE(NULLIF(TRIM(COALESCE(email, '')), ''), '__NO_EMAIL__') = COALESCE(NULLIF(TRIM(COALESCE($7::text, '')), ''), '__NO_EMAIL__')
                 )
               )
             )`,
          [
            organizationId,
            parsedStudentId,
            parsedCurrentGuardianId,
            currentLegacyIdentity?.first_name || null,
            currentLegacyIdentity?.last_name || null,
            currentLegacyIdentity?.phone || null,
            currentLegacyIdentity?.email || null,
          ]
        );

        const matchingCurrentProfileGuardianIds = currentLegacyIdentity
          ? await client.query(
              `SELECT DISTINCT gp.guardian_id
                 FROM guardian_profiles gp
                 JOIN guardian_students gs
                   ON gs.guardian_id = gp.guardian_id
                WHERE gp.organization_id = $1
                  AND gs.student_id = $2
                  AND LOWER(TRIM(COALESCE(gp.first_name, ''))) = LOWER(TRIM($3::text))
                  AND LOWER(TRIM(COALESCE(gp.last_name, ''))) = LOWER(TRIM(COALESCE($4::text, '')))
                  AND (
                    COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE($5::text, '')), ''), '__NO_PHONE__')
                    OR COALESCE(NULLIF(LOWER(TRIM(COALESCE(gp.email, ''))), ''), '__NO_EMAIL__') = COALESCE(NULLIF(LOWER(TRIM(COALESCE($6::text, ''))), ''), '__NO_EMAIL__')
                    OR (
                      COALESCE(NULLIF(TRIM(COALESCE(gp.phone, '')), ''), '__NO_PHONE__') = '__NO_PHONE__'
                      AND COALESCE(NULLIF(LOWER(TRIM(COALESCE(gp.email, ''))), ''), '__NO_EMAIL__') = '__NO_EMAIL__'
                    )
                  )`,
              [
                organizationId,
                parsedStudentId,
                currentLegacyIdentity.first_name || null,
                currentLegacyIdentity.last_name || null,
                currentLegacyIdentity.phone || null,
                currentLegacyIdentity.email || null,
              ]
            )
          : { rows: [] };

        // Keep profile-backed relationship table in sync for legacy pages as well.
        const profileGuardianIdsToDelete = matchingCurrentProfileGuardianIds.rows
          .map((row) => Number(row.guardian_id))
          .filter((guardianId) => Number.isInteger(guardianId) && guardianId > 0);
        const deleteCurrentProfileLink = profileGuardianIdsToDelete.length
          ? await client.query(
              `DELETE FROM guardian_students
                WHERE student_id = $1
                  AND guardian_id = ANY($2::int[])`,
              [parsedStudentId, profileGuardianIdsToDelete]
            )
          : { rowCount: 0 };

        // Legacy data can be inconsistent (clustered guardian rows by identity).
        // Treat missing old link as idempotent and still proceed with the new link.
        if (!deleteCurrentLegacy.rowCount && !deleteCurrentProfileLink.rowCount) {
          console.warn('[guardianRelinkStudent] No existing legacy/profile link found during relink', {
            organizationId,
            currentGuardianId: parsedCurrentGuardianId,
            studentId: parsedStudentId,
          });
        }

        for (const targetProfile of targetGuardianProfiles) {
          await client.query(
            `INSERT INTO guardian_students (guardian_id, student_id, relationship)
             VALUES ($1, $2, 'Parent/Guardian')
             ON CONFLICT DO NOTHING`,
            [targetProfile.guardian_id, parsedStudentId]
          );
        }
      }

      for (const targetProfile of targetGuardianProfiles) {
        const existingLegacyForTarget = await client.query(
          `SELECT guardian_id
           FROM guardians
           WHERE organization_id = $1
             AND student_id = $2
             AND LOWER(TRIM(first_name)) = LOWER(TRIM($3))
             AND LOWER(TRIM(COALESCE(last_name, ''))) = LOWER(TRIM(COALESCE($4, '')))
             AND (
               COALESCE(NULLIF(TRIM(COALESCE(phone, '')), ''), '__NO_PHONE__') = COALESCE(NULLIF(TRIM(COALESCE($5, '')), ''), '__NO_PHONE__')
               OR COALESCE(NULLIF(LOWER(TRIM(COALESCE(email, ''))), ''), '__NO_EMAIL__') = COALESCE(NULLIF(LOWER(TRIM(COALESCE($6, ''))), ''), '__NO_EMAIL__')
               OR (
                 COALESCE(NULLIF(TRIM(COALESCE(phone, '')), ''), '__NO_PHONE__') = '__NO_PHONE__'
                 AND COALESCE(NULLIF(LOWER(TRIM(COALESCE(email, ''))), ''), '__NO_EMAIL__') = '__NO_EMAIL__'
               )
             )
           LIMIT 1`,
          [
            organizationId,
            parsedStudentId,
            targetProfile.first_name,
            targetProfile.last_name,
            targetProfile.phone || null,
            targetProfile.email || null,
          ]
        );

        if (!existingLegacyForTarget.rows.length) {
          await client.query(
            `INSERT INTO guardians (first_name, last_name, address, phone, email, hometown, image_url, student_id, organization_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              targetProfile.first_name,
              targetProfile.last_name,
              targetProfile.address || null,
              targetProfile.phone || null,
              targetProfile.email || null,
              targetProfile.hometown || null,
              targetProfile.image_url || null,
              parsedStudentId,
              organizationId,
            ]
          );
        }
      }

      await client.query('COMMIT');
      return res.json({
        success: true,
        targetGuardianId: targetGuardianProfileId,
        targetGuardianIds: targetGuardianProfiles.map((row) => Number(row.guardian_id)),
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[guardianRelinkStudent] Error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Error relinking student to guardian.' });
    } finally {
      client.release();
    }
  },

  staffReportStudent: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const userId = req.session.userId;
      const { guardianId, studentId, reportType, message, sendEmail } = req.body;
      const sendEmailRequested =
        sendEmail === undefined || sendEmail === null
          ? true
          : (sendEmail === true || sendEmail === 'true' || sendEmail === 1 || sendEmail === '1');
      const trimmedMessage = String(message || '').trim();

      if (!trimmedMessage || !studentId || !guardianId) {
        return res.status(400).json({ success: false, error: 'Guardian, student and message are required.' });
      }

      const parsedStudentId = Number.parseInt(studentId, 10);
      const parsedGuardianId = Number.parseInt(guardianId, 10);
      if (!Number.isInteger(parsedStudentId) || !Number.isInteger(parsedGuardianId)) {
        return res.status(400).json({ success: false, error: 'Invalid guardian or student ID.' });
      }

      // Get student info
      const studentResult = await db.query(
        `SELECT first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2`,
        [parsedStudentId, organizationId]
      );
      const student = studentResult.rows[0];
      if (!student) return res.status(404).json({ success: false, error: 'Student not found' });

      const studentName = `${student.first_name} ${student.last_name}`;

      // Get staff info
      const staffResult = await db.query(
        `SELECT first_name, last_name, COALESCE(account_type::text, 'Staff') AS role FROM users WHERE user_id = $1`, [userId]
      );
      const staff = staffResult.rows[0] || { first_name: 'Staff', last_name: '', role: 'Staff' };

      // Get guardian info
      const guardianResult = await db.query(
        `SELECT g.first_name, g.last_name, g.email, g.phone
         FROM guardians g
         WHERE g.guardian_id = $1 AND g.organization_id = $2`,
        [parsedGuardianId, organizationId]
      );
      const guardian = guardianResult.rows[0] || null;

      // Resolve guardian profile ID so report appears in Parent Portal (which uses guardian_profiles.guardian_id)
      let targetGuardianId = parsedGuardianId;
      let guardianProfile = null;

      if (guardian) {
        const guardianProfileResult = await db.query(
          `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.email, gp.phone
           FROM guardian_profiles gp
           WHERE gp.organization_id = $1
             AND (
               gp.guardian_id = $2
               OR (
                 LOWER(TRIM(gp.first_name)) = LOWER(TRIM($3::text))
                 AND LOWER(TRIM(gp.last_name)) = LOWER(TRIM($4::text))
                 AND (
                   ($5::text IS NOT NULL AND gp.phone = $5::text)
                   OR ($6::text IS NOT NULL AND gp.email = $6::text)
                 )
               )
             )
           ORDER BY CASE WHEN gp.guardian_id = $2 THEN 0 ELSE 1 END, gp.guardian_id ASC
           LIMIT 1`,
          [organizationId, parsedGuardianId, guardian.first_name, guardian.last_name, guardian.phone || null, guardian.email || null]
        );
        guardianProfile = guardianProfileResult.rows[0] || null;
      } else {
        const guardianProfileResult = await db.query(
          `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.email, gp.phone
           FROM guardian_profiles gp
           WHERE gp.guardian_id = $1 AND gp.organization_id = $2
           LIMIT 1`,
          [parsedGuardianId, organizationId]
        );
        guardianProfile = guardianProfileResult.rows[0] || null;
      }

      if (guardianProfile?.guardian_id) {
        targetGuardianId = guardianProfile.guardian_id;
      }

      const normalizedReportType = String(reportType || 'general').trim().toLowerCase();
      const reportTypeLabel = normalizedReportType.charAt(0).toUpperCase() + normalizedReportType.slice(1);
      const subject = `Staff Report (${reportTypeLabel}): ${studentName}`;

      const staffFullName = `${staff.first_name} ${staff.last_name}`.trim();

      // Ensure reports table exists and schema is compatible on older deployments
      await db.query(
        `CREATE TABLE IF NOT EXISTS guardian_reports (
          report_id SERIAL PRIMARY KEY,
          guardian_id INTEGER NOT NULL,
          student_id INTEGER,
          organization_id INTEGER NOT NULL,
          report_type VARCHAR(50),
          subject VARCHAR(255),
          message TEXT,
          status VARCHAR(50) DEFAULT 'open',
          priority VARCHAR(50) DEFAULT 'normal',
          filed_by_user_id INTEGER,
          filed_by_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          resolved_at TIMESTAMP,
          deleted_at TIMESTAMP
        )`
      );

      // Ensure all needed columns exist (safe on older deployments)
      try {
        await db.query(`ALTER TABLE guardian_reports ADD COLUMN IF NOT EXISTS report_type VARCHAR(50)`);
        await db.query(`ALTER TABLE guardian_reports ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'normal'`);
        await db.query(`ALTER TABLE guardian_reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
        await db.query(`ALTER TABLE guardian_reports ADD COLUMN IF NOT EXISTS filed_by_user_id INTEGER`);
        await db.query(`ALTER TABLE guardian_reports ADD COLUMN IF NOT EXISTS filed_by_name VARCHAR(255)`);
      } catch (alterErr) {
        // Column might already exist or table permissions issue, ignore
      }

      // Insert report with staff attribution
      await db.query(
        `INSERT INTO guardian_reports
           (guardian_id, student_id, organization_id, report_type, subject, message, status, filed_by_user_id, filed_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)`,
        [targetGuardianId, parsedStudentId, organizationId, normalizedReportType, subject, trimmedMessage, userId || null, staffFullName]
      );

      // Send email to guardian if requested
      let emailSent = false;
      const emailRecipient = guardianProfile?.email || guardian?.email || null;
      const guardianFirstName = guardianProfile?.first_name || guardian?.first_name || 'Parent/Guardian';
      if (sendEmailRequested && emailRecipient) {
        // Honor guardian preference for staff-report emails.
        const guardianAllows = await isEmailEnabledForRecipient(db, emailRecipient, 'staff_report_to_guardian');
        if (!guardianAllows) {
          // Skip email but the report still gets stored in-app.
        } else {
        const { buildFailureNotification, renderCleanEmail, sendEmailInBackground } = require("../utils/emailHelper");
        const path = require("path");

        const orgResult = await db.query(
          `SELECT organization_name FROM organizations WHERE organization_id = $1`, [organizationId]
        );
        const orgName = orgResult.rows[0]?.organization_name || 'School';

        const html = renderCleanEmail({
          title: `Report Filed for ${studentName}`,
          greeting: `Dear ${guardianFirstName},`,
          paragraphs: [
            `A report has been filed regarding your child <strong>${studentName}</strong> by <strong>${staff.first_name} ${staff.last_name}</strong> (${staff.role}).`,
          ],
          details: [
            { label: 'Report Type', value: reportTypeLabel },
            { label: 'Student', value: studentName },
            { label: 'Message', value: trimmedMessage },
          ],
          note: `This report is also available in your Parent Portal under "My Reports". If you have questions, please contact the school directly.`,
        });

        sendEmailInBackground({
          to: emailRecipient,
          subject: `[${orgName}] Report for ${studentName}`,
          html,
          failureNotification: buildFailureNotification(organizationId, {
            title: 'Staff report email failed',
            body: `The staff report email for ${studentName} could not be delivered to ${emailRecipient}.`,
          }),
          attachments: [{
            filename: 'managira_logo.png',
            path: path.join(__dirname, '..', 'public', 'images', 'managira.png'),
            cid: 'managira_logo'
          }]
        }, 'Staff Report Email');
        emailSent = true; // Queued in background
        }
      }

      // A4 — in-app bell notification to the guardian portal
      notifSvc.createNotification(db, {
        orgId: Number(organizationId),
        recipientType: 'guardian',
        recipientId: Number(targetGuardianId),
        type: 'staff_report',
        title: 'New report from school',
        body: `A ${reportTypeLabel.toLowerCase()} report was filed for ${studentName}`,
        link: '/guardian/reports',
      }).catch(err => console.error('[Notif] staff_report failed:', err.message));

      return res.json({ success: true, emailSent });
    } catch (error) {
      console.error('Staff report error:', error);
      return res.status(500).json({ success: false, error: 'Error submitting report' });
    }
  },

  /**
   * Staff replies to an existing guardian report — inserts a reply and notifies the guardian.
   */
  staffReplyToReport: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const sessionUser = req.session.user || null;
      const userId = req.session.userId
        || sessionUser?.user_id
        || sessionUser?.id
        || req.user?.user_id
        || req.user?.id;
      const { reportId, message } = req.body;
      const trimmedMessage = String(message || "").trim();

      if (!userId) {
        return res.status(401).json({ success: false, error: "Unable to identify staff account. Please sign in again." });
      }

      if (!reportId || !trimmedMessage) {
        return res.status(400).json({ success: false, error: "Report ID and message are required." });
      }

      // Get report info
      const reportResult = await db.query(
        `SELECT r.report_id, r.guardian_id, r.student_id, r.subject, r.organization_id
         FROM guardian_reports r
         WHERE r.report_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL`,
        [reportId, organizationId]
      );
      if (!reportResult.rows.length) {
        return res.status(404).json({ success: false, error: "Report not found." });
      }
      const report = reportResult.rows[0];

      // Get staff name
      const staffResult = await db.query(
        `SELECT first_name, last_name FROM users WHERE user_id = $1`, [userId]
      );
      const staffName = staffResult.rows[0]
        ? `${staffResult.rows[0].first_name} ${staffResult.rows[0].last_name}`.trim()
        : "Staff";

      // Ensure reply table exists
      await db.query(
        `CREATE TABLE IF NOT EXISTS guardian_report_replies (
          reply_id SERIAL PRIMARY KEY,
          report_id INTEGER NOT NULL,
          sender_type VARCHAR(20) NOT NULL,
          sender_id INTEGER,
          sender_name VARCHAR(255),
          message TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )`
      );

      // Insert reply
      const insertReplyResult = await db.query(
        `INSERT INTO guardian_report_replies (report_id, sender_type, sender_id, sender_name, message)
         VALUES ($1, 'staff', $2, $3, $4)
         RETURNING reply_id, report_id, sender_type, sender_id, sender_name, message, created_at`,
        [reportId, userId, staffName, trimmedMessage]
      );

      // Update report status
      await db.query(
        `UPDATE guardian_reports SET status = 'in_progress', updated_at = NOW() WHERE report_id = $1`,
        [reportId]
      );

      // Get guardian email and student name for notification
      const guardianInfo = await db.query(
        `SELECT COALESCE(gp.email, g.email) AS email, COALESCE(gp.first_name, g.first_name) AS first_name
         FROM guardian_reports r
         LEFT JOIN guardian_profiles gp ON gp.guardian_id = r.guardian_id AND gp.organization_id = r.organization_id
         LEFT JOIN guardians g ON g.guardian_id = r.guardian_id AND g.organization_id = r.organization_id
         WHERE r.report_id = $1`,
        [reportId]
      );
      const guardianEmail = guardianInfo.rows[0]?.email;
      const guardianFirstName = guardianInfo.rows[0]?.first_name;

      let studentName = "";
      if (report.student_id) {
        const studentResult = await db.query(
          `SELECT first_name || ' ' || last_name AS name FROM students WHERE student_id = $1`,
          [report.student_id]
        );
        studentName = studentResult.rows[0]?.name || "";
      }

      // Notify guardian
      if (guardianEmail) {
        notifyGuardianOnStaffReply(db, {
          organizationId,
          reportId,
          guardianEmail,
          guardianFirstName,
          staffName,
          replyMessage: trimmedMessage,
          studentName,
          reportSubject: report.subject,
        }).catch(err => console.error("[Notify] Staff reply to guardian notification failed:", err.message));
      }

      // A3 — in-app bell notification to the guardian
      if (report.guardian_id) {
        notifSvc.createNotification(db, {
          orgId: Number(organizationId),
          recipientType: 'guardian',
          recipientId: Number(report.guardian_id),
          type: 'staff_reply',
          title: 'New reply from staff',
          body: studentName ? `Re: ${report.subject} (${studentName})` : `Re: ${report.subject}`,
          link: `/guardian/reports/${report.report_id}`,
        }).catch(err => console.error('[Notif] staff_reply failed:', err.message));
      }

      const reply = insertReplyResult.rows[0] || null;
      return res.json({
        success: true,
        reply: reply ? {
          reply_id: reply.reply_id,
          report_id: reply.report_id,
          sender_type: reply.sender_type,
          sender_id: Number(reply.sender_id || 0),
          sender_name: reply.sender_name || staffName,
          display_name: reply.sender_name || staffName,
          message: reply.message,
          created_at: reply.created_at,
        } : null,
      });
    } catch (error) {
      console.error("Staff reply error:", error);
      return res.status(500).json({ success: false, error: "Error submitting reply." });
    }
  },

  // AJAX: Get reports for a class (where current user is a recipient or class teacher)
  classReports: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const userId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
      const classId = req.query.classId;

      if (!classId || !userId) {
        return res.status(400).json({ success: false, error: "Missing classId" });
      }

      const result = await db.query(
        `SELECT DISTINCT r.report_id, r.subject, r.status, r.priority, r.created_at,
                s.first_name || ' ' || s.last_name AS student_name,
                COALESCE(gp.first_name || ' ' || gp.last_name, 'Parent') AS guardian_name,
                COUNT(rr.reply_id) AS reply_count
         FROM guardian_reports r
         JOIN students s ON r.student_id = s.student_id
         LEFT JOIN guardian_profiles gp ON gp.guardian_id = r.guardian_id AND gp.organization_id = r.organization_id
         LEFT JOIN guardian_report_replies rr ON rr.report_id = r.report_id
         LEFT JOIN guardian_report_recipients grr ON grr.report_id = r.report_id
         LEFT JOIN user_classes uc ON uc.class_id = s.class_id AND uc.user_id = $3
         WHERE r.organization_id = $1
           AND s.class_id = $2
           AND r.deleted_at IS NULL
           AND (grr.user_id = $3 OR uc.user_id IS NOT NULL)
         GROUP BY r.report_id, s.first_name, s.last_name, gp.first_name, gp.last_name
         ORDER BY r.created_at DESC`,
        [organizationId, classId, userId]
      );

      return res.json({ success: true, reports: result.rows });
    } catch (error) {
      console.error("classReports error:", error);
      return res.status(500).json({ success: false, error: "Error loading reports." });
    }
  },

  // AJAX: Get a single report detail with replies and recipients (for staff)
  classReportDetail: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const userId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
      const reportId = req.query.reportId;

      if (!reportId || !userId) {
        return res.status(400).json({ success: false, error: "Missing reportId" });
      }

      // Get report + verify this user has access (is a recipient or class teacher)
      const reportResult = await db.query(
        `SELECT r.report_id, r.subject, r.message, r.status, r.priority, r.created_at,
                s.first_name || ' ' || s.last_name AS student_name,
                COALESCE(gp.first_name || ' ' || gp.last_name, 'Parent') AS guardian_name,
                (
                  SELECT COUNT(*)::int
                  FROM guardian_report_recipients grr2
                  WHERE grr2.report_id = r.report_id
                ) AS cc_count
         FROM guardian_reports r
         JOIN students s ON r.student_id = s.student_id
         LEFT JOIN guardian_profiles gp ON gp.guardian_id = r.guardian_id AND gp.organization_id = r.organization_id
         LEFT JOIN guardian_report_recipients grr ON grr.report_id = r.report_id AND grr.user_id = $3
         LEFT JOIN user_classes uc ON uc.class_id = s.class_id AND uc.user_id = $3
         WHERE r.report_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
           AND (grr.user_id IS NOT NULL OR uc.user_id IS NOT NULL)
         LIMIT 1`,
        [reportId, organizationId, userId]
      );

      if (!reportResult.rows.length) {
        return res.status(404).json({ success: false, error: "Report not found or access denied." });
      }

      const report = reportResult.rows[0];

      const deletedColumnCheck = await db.query(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'guardian_report_replies'
             AND column_name = 'deleted'
         ) AS has_deleted`
      );
      const replyDeletedFilter = deletedColumnCheck.rows[0]?.has_deleted
        ? 'AND COALESCE(rr.deleted, FALSE) = FALSE'
        : '';

      // Get replies with display names
      const repliesResult = await db.query(
        `SELECT rr.*,
                CASE 
                  WHEN rr.sender_type = 'staff' THEN COALESCE(
                    (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.user_id = rr.sender_id),
                    rr.sender_name
                  )
                  WHEN rr.sender_type = 'guardian' THEN COALESCE(
                    (SELECT gp2.first_name || ' ' || gp2.last_name FROM guardian_profiles gp2 WHERE gp2.guardian_id = rr.sender_id),
                    rr.sender_name
                  )
                  ELSE rr.sender_name
                END AS display_name
         FROM guardian_report_replies rr
         WHERE rr.report_id = $1
           ${replyDeletedFilter}
         ORDER BY rr.created_at ASC`,
        [reportId]
      );

      return res.json({
        success: true,
        report,
        replies: repliesResult.rows,
      });
    } catch (error) {
      console.error("classReportDetail error:", error);
      return res.status(500).json({ success: false, error: "Error loading report." });
    }
  },

  classReportRecipients: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const userId = req.session.userId || (req.session.user ? req.session.user.user_id : null);
      const reportId = req.query.reportId;

      if (!reportId || !userId) {
        return res.status(400).json({ success: false, error: "Missing reportId" });
      }

      const accessResult = await db.query(
        `SELECT r.report_id
         FROM guardian_reports r
         JOIN students s ON r.student_id = s.student_id
         LEFT JOIN guardian_report_recipients grr ON grr.report_id = r.report_id AND grr.user_id = $3
         LEFT JOIN user_classes uc ON uc.class_id = s.class_id AND uc.user_id = $3
         WHERE r.report_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
           AND (grr.user_id IS NOT NULL OR uc.user_id IS NOT NULL)
         LIMIT 1`,
        [reportId, organizationId, userId]
      );

      if (!accessResult.rows.length) {
        return res.status(404).json({ success: false, error: "Report not found or access denied." });
      }

      const recipientsResult = await db.query(
        `SELECT grr.user_id,
                COALESCE(u.first_name || ' ' || u.last_name, grr.user_name) AS display_name,
                COALESCE(u.account_type::text, grr.user_role, 'Staff') AS display_role
         FROM guardian_report_recipients grr
         LEFT JOIN users u ON u.user_id = grr.user_id
         WHERE grr.report_id = $1
         ORDER BY display_name ASC`,
        [reportId]
      );

      return res.json({
        success: true,
        recipients: recipientsResult.rows,
        count: recipientsResult.rows.length,
      });
    } catch (error) {
      console.error("classReportRecipients error:", error);
      return res.status(500).json({ success: false, error: "Error loading CC recipients." });
    }
  },

  classReportReplyDelete: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const sessionUser = req.session.user || null;
      const userId = req.session.userId
        || sessionUser?.user_id
        || sessionUser?.id
        || req.user?.user_id
        || req.user?.id;
      const replyId = Number.parseInt(req.params.replyId, 10);
      const reportId = Number.parseInt(req.body.reportId, 10);

      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unable to identify staff account. Please sign in again.' });
      }
      if (!replyId || !reportId) {
        return res.status(400).json({ success: false, error: 'reportId and replyId are required.' });
      }

      const accessResult = await db.query(
        `SELECT r.report_id
         FROM guardian_reports r
         JOIN students s ON s.student_id = r.student_id
         LEFT JOIN guardian_report_recipients grr ON grr.report_id = r.report_id AND grr.user_id = $3
         LEFT JOIN user_classes uc ON uc.class_id = s.class_id AND uc.user_id = $3
         WHERE r.report_id = $1
           AND r.organization_id = $2
           AND r.deleted_at IS NULL
           AND (grr.user_id IS NOT NULL OR uc.user_id IS NOT NULL)
         LIMIT 1`,
        [reportId, organizationId, userId]
      );

      if (!accessResult.rows.length) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      const deleted = await db.query(
        `DELETE FROM guardian_report_replies
         WHERE reply_id = $1
           AND report_id = $2
           AND sender_type = 'staff'
           AND sender_id = $3
         RETURNING reply_id`,
        [replyId, reportId, userId]
      );

      if (!deleted.rows.length) {
        return res.status(404).json({ success: false, error: 'Message not found or not allowed to delete.' });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('classReportReplyDelete error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete message.' });
    }
  },

  guardianRequestPasswordReset: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const guardianId = req.body.guardianId;
      const guardianSource = req.body.source === 'profile' ? 'profile' : 'legacy';

      const guardianPortalEnabled = await hasGuardianPortalFeature(db, organizationId);
      if (!guardianPortalEnabled) {
        return res.status(403).json({
          success: false,
          error: 'Parent portal feature is not enabled for this organization plan.'
        });
      }

      let guardian;
      let guardianProfileId = null;

      if (guardianSource === 'profile') {
        const guardianResult = await db.query(
          `SELECT * FROM guardian_profiles WHERE guardian_id = $1 AND organization_id = $2 LIMIT 1`,
          [guardianId, organizationId]
        );

        if (!guardianResult.rows.length) {
          return res.status(404).json({ success: false, error: 'Guardian not found' });
        }

        guardian = guardianResult.rows[0];
        guardianProfileId = guardian.guardian_id;
      } else {
        const guardianResult = await db.query(
          `SELECT * FROM guardians WHERE guardian_id = $1 AND organization_id = $2`,
          [guardianId, organizationId]
        );

        if (!guardianResult.rows.length) {
          return res.status(404).json({ success: false, error: 'Guardian not found' });
        }

        guardian = guardianResult.rows[0];
      }

      // Check if guardian has email or phone
      if (!guardian.email && !guardian.phone) {
        return res.status(400).json({ 
          success: false, 
          error: 'Guardian must have an email address or phone number to receive login credentials.' 
        });
      }

      const contactEmail = guardian.email;
      const contactPhone = guardian.phone;

      if (!contactEmail) {
        return res.status(400).json({ 
          success: false, 
          error: 'Guardian must have an email address to receive password setup link.' 
        });
      }

      if (!guardianProfileId) {
        const profileCheck = await db.query(
          `SELECT guardian_id FROM guardian_profiles 
           WHERE first_name = $1 AND last_name = $2 AND phone = $3 AND organization_id = $4`,
          [guardian.first_name, guardian.last_name, guardian.phone, organizationId]
        );

        guardianProfileId = profileCheck.rows.length > 0 ? profileCheck.rows[0].guardian_id : null;
      }

      // If no profile exists, create one
      if (!guardianProfileId) {
        const profileInsert = await db.query(
          `INSERT INTO guardian_profiles (first_name, last_name, phone, email, address, hometown, image_url, organization_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
           RETURNING guardian_id`,
          [guardian.first_name, guardian.last_name, guardian.phone, contactEmail, guardian.address, guardian.hometown, guardian.image_url, organizationId]
        );
        guardianProfileId = profileInsert.rows[0].guardian_id;

        if (guardianSource !== 'profile') {
          const studentsResult = await db.query(
            `SELECT DISTINCT g.student_id, s.first_name, s.last_name
             FROM guardians g
             JOIN students s ON g.student_id = s.student_id
             WHERE g.first_name = $1 
             AND g.last_name = $2 
             AND (g.phone = $3 OR $3 IS NULL)
             AND g.organization_id = $4`,
            [guardian.first_name, guardian.last_name, guardian.phone, organizationId]
          );

          for (const student of studentsResult.rows) {
            await db.query(
              `INSERT INTO guardian_students (guardian_id, student_id, relationship)
               VALUES ($1, $2, 'Parent/Guardian')
               ON CONFLICT DO NOTHING`,
              [guardianProfileId, student.student_id]
            );
          }
        }

              }

      // Check if account exists
      const accountCheck = await db.query(
        `SELECT id, password_hash FROM guardian_accounts WHERE guardian_id = $1 AND organization_id = $2`,
        [guardianProfileId, organizationId]
      );

      const hasAccount = accountCheck.rows.length > 0;
      const hasPassword = hasAccount && accountCheck.rows[0].password_hash;
      const isNewAccount = !hasAccount;

      // Normalise phone to digits + optional leading '+' so login lookup always works.
      const cleanedContactPhone = contactPhone ? String(contactPhone).replace(/[^\d+]/g, "") : null;

      // If no account, create one
      if (!hasAccount) {
        await db.query(
          `INSERT INTO guardian_accounts (guardian_id, organization_id, login_email, login_phone, password_hash, created_at)
           VALUES ($1, $2, $3, $4, NULL, NOW())`,
          [guardianProfileId, organizationId, contactEmail, cleanedContactPhone]
        );
      } else {
        // Existing account: ensure login_email and login_phone are populated so both
        // login methods work after the parent sets their password via this link.
        const existingRow = accountCheck.rows[0];
        const needsEmailSync = !existingRow.login_email && contactEmail;
        const needsPhoneSync = !existingRow.login_phone && cleanedContactPhone;
        if (needsEmailSync || needsPhoneSync) {
          await db.query(
            `UPDATE guardian_accounts
             SET login_email   = COALESCE(login_email,   $1),
                 login_phone   = COALESCE(login_phone,   $2),
                 updated_at    = NOW()
             WHERE guardian_id = $3 AND organization_id = $4`,
            [contactEmail || null, cleanedContactPhone || null, guardianProfileId, organizationId]
          );
        }
      }

      // Generate token
      const token = crypto.randomBytes(32).toString("hex");
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Store token
      await db.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
        [`guardian_${guardianProfileId}`, token, tokenExpiry]
      );

      // Get organization info
      const orgResult = await db.query(
        `SELECT organization_name FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );

      const organizationName = orgResult.rows[0]?.organization_name || 'School';

      // Send password setup/reset email
      const resetLink = process.env.NODE_ENV === "production"
        ? `https://www.managira.com/common/set-password?token=${token}&type=guardian`
        : `http://localhost:4000/common/set-password?token=${token}&type=guardian`;

      const emailTitle = isNewAccount ? 'Parent Portal Access Setup' : 'Password Reset Request';
      const emailHeading = isNewAccount ? 'Welcome to Parent Portal!' : 'Password Reset Request';
      const emailMessage = isNewAccount 
        ? `You have been invited to access the Parent Portal at ${he.encode(organizationName)}. Click the button below to set your password and access your children's progress.`
        : `A password reset has been requested for your Parent Portal account at ${he.encode(organizationName)}. Click the button below to set a new password.`;
      const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';

      const html = renderCleanEmail({
        title: emailHeading,
        greeting: `Hello <strong>${he.encode(guardian.first_name)} ${he.encode(guardian.last_name)}</strong>,`,
        paragraphs: [
          emailMessage,
          ...(isNewAccount
            ? [`You can log in using your email <strong>${he.encode(contactEmail)}</strong> or phone number <strong>${he.encode(contactPhone)}</strong> with your new password.`]
            : []),
          ...(!isNewAccount ? ["If you did not request this reset, please ignore this email."] : []),
        ],
        cta: {
          text: isNewAccount ? 'Set Password' : 'Reset Password',
          url: he.encode(resetLink),
        },
        followManagira: isNewAccount,
        linkedinUrl,
        note: 'This link will expire in 24 hours.',
      });

      const mailOptions = {
        from: process.env.ADMIN_NOTIFY_EMAIL_USER,
        to: contactEmail,
        subject: `${emailTitle} - ${organizationName} Parent Portal`,
        html,
        failureNotification: buildFailureNotification(organizationId, {
          title: 'Guardian password email failed',
          body: `The guardian password email for ${contactEmail} could not be delivered.`,
        }),
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Guardian Password Email");

      return res.json({ 
        success: true, 
        message: isNewAccount ? 'Password setup email sent successfully!' : 'Password reset email sent successfully!' 
      });
    } catch (error) {
                  return res.status(500).json({ success: false, error: 'Error sending password setup email: ' + error.message });
    }
  },

  studentRequestPasswordReset: async (req, res, db) => {
    try {
      if (!req.session) {
        return res.status(403).json({ success: false, error: "You are not authorized to send student password emails." });
      }

      const organizationId = req.session.organizationId;
      const userId = req.session.user?.user_id || req.session.userId || null;
      const userRole = req.session.userRole || req.session.user?.account_type || null;
      const accountType = req.session.accountType || req.session.user?.account_type || null;
      const userEmail = req.session.user?.email || null;
      const canBypassAsAdmin = ["admin"].includes(normalizeRoleKey(userRole)) || ["admin"].includes(normalizeRoleKey(accountType));
      const canManageStudentsSettings = canBypassAsAdmin || await userHasPermission(
        db,
        { userId, userRole, organizationId, accountType, userEmail },
        PERMISSIONS.MANAGE_STUDENTS
      );

      if (!canManageStudentsSettings) {
        return res.status(403).json({ success: false, error: "You do not have permission to send student password setup/reset emails." });
      }

      const studentId = Number(req.body.studentId || 0);
      const requestedPortalAction = req.body.portalAction === "reset" ? "reset" : "setup";

      if (!organizationId || !studentId) {
        return res.status(400).json({ success: false, error: "Invalid student request." });
      }

      await ensureStudentPortalSchema(db);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      if (!studentPortalIntegration.activated) {
        return res.status(403).json({
          success: false,
          error: "Student Portal is deactivated for this organization. Activate it from Integrations to continue.",
        });
      }

      const studentResult = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.email, s.class_id, c.class_name
           FROM students s
           LEFT JOIN classes c ON c.class_id = s.class_id
          WHERE s.organization_id = $1 AND s.student_id = $2
          LIMIT 1`,
        [organizationId, studentId]
      );

      if (!studentResult.rows.length) {
        return res.status(404).json({ success: false, error: "Student not found." });
      }

      const student = studentResult.rows[0];
      const studentEmail = normalizeStudentEmail(student.email);
      if (!studentEmail) {
        return res.status(400).json({
          success: false,
          error: "This student does not have an email address attached.",
        });
      }

      const existingAccountResult = await db.query(
        `SELECT id, password_hash FROM student_accounts WHERE organization_id = $1 AND student_id = $2 LIMIT 1`,
        [organizationId, studentId]
      );

      const existingAccount = existingAccountResult.rows[0] || null;
      const hasExistingPassword = Boolean(
        existingAccount &&
        existingAccount.password_hash &&
        String(existingAccount.password_hash).trim()
      );

      if (requestedPortalAction === "setup" && hasExistingPassword) {
        return res.status(400).json({
          success: false,
          error: "This student already has portal access. Use reset (one student at a time).",
        });
      }

      if (requestedPortalAction === "reset" && !hasExistingPassword) {
        return res.status(400).json({
          success: false,
          error: "This student does not have portal access yet. Send setup first.",
        });
      }

      const isSetupInvite = requestedPortalAction !== "reset";

      await upsertStudentAccount(db, {
        organizationId,
        studentId,
        loginEmail: studentEmail,
      });

      const token = crypto.randomBytes(32).toString("hex");
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
        [`student_${studentId}`, token, tokenExpiry]
      );

      const orgResult = await db.query(
        `SELECT organization_name FROM organizations WHERE organization_id = $1`,
        [organizationId]
      );
      const organizationName = orgResult.rows[0]?.organization_name || "School";

      const resetLink = process.env.NODE_ENV === "production"
        ? `https://www.managira.com/common/set-password?token=${token}&type=student`
        : `http://localhost:4000/common/set-password?token=${token}&type=student`;

      const emailTitle = isSetupInvite ? "Student Portal Access Setup" : "Student Password Reset Request";
      const emailHeading = isSetupInvite ? "Welcome to Student Portal" : "Password Reset Request";
      const emailMessage = isSetupInvite
        ? `You have been invited to access the Student Portal at ${he.encode(organizationName)}.`
        : `A password reset has been requested for your Student Portal account at ${he.encode(organizationName)}.`;

      const html = renderCleanEmail({
        title: emailHeading,
        greeting: `Hello <strong>${he.encode(student.first_name || "Student")} ${he.encode(student.last_name || "")}</strong>,`,
        paragraphs: [
          emailMessage,
          `Use your student email <strong>${he.encode(studentEmail)}</strong> to sign in after setting your password.`,
          ...(student.class_name ? [`Class: <strong>${he.encode(student.class_name)}</strong>`] : []),
          ...(!isSetupInvite ? ["If you did not request this reset, please ignore this email."] : []),
        ],
        cta: {
          text: isSetupInvite ? "Set Password" : "Reset Password",
          url: he.encode(resetLink),
        },
        note: "This link will expire in 24 hours.",
      });

      sendEmailInBackground(
        {
          from: process.env.ADMIN_NOTIFY_EMAIL_USER,
          to: studentEmail,
          subject: `${emailTitle} - ${organizationName}`,
          html,
          failureNotification: buildFailureNotification(organizationId, {
            title: "Student password email failed",
            body: `The student password email for ${studentEmail} could not be delivered.`,
          }),
          attachments: [
            {
              filename: "managira.png",
              path: path.join(__dirname, "../public/images/managira.png"),
              cid: "managira_logo",
            },
          ],
        },
        "Student Password Email"
      );

      return res.json({
        success: true,
        message: isSetupInvite
          ? "Password setup email sent successfully."
          : "Password reset email sent successfully.",
        portalAction: isSetupInvite ? "setup" : "reset",
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Error sending student password email." });
    }
  },

  studentBulkRequestPasswordReset: async (req, res, db) => {
    try {
      if (!req.session) {
        return res.status(403).json({ success: false, error: "You are not authorized to send student password emails." });
      }

      const organizationId = req.session.organizationId;
      const userId = req.session.user?.user_id || req.session.userId || null;
      const userRole = req.session.userRole || req.session.user?.account_type || null;
      const accountType = req.session.accountType || req.session.user?.account_type || null;
      const userEmail = req.session.user?.email || null;
      const canBypassAsAdmin = ["admin"].includes(normalizeRoleKey(userRole)) || ["admin"].includes(normalizeRoleKey(accountType));
      const canManageStudentsSettings = canBypassAsAdmin || await userHasPermission(
        db,
        { userId, userRole, organizationId, accountType, userEmail },
        PERMISSIONS.MANAGE_STUDENTS
      );

      if (!canManageStudentsSettings) {
        return res.status(403).json({ success: false, error: "You do not have permission to send student password setup/reset emails." });
      }

      const requestedIds = Array.isArray(req.body?.studentIds)
        ? req.body.studentIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [];
      const studentIds = [...new Set(requestedIds)];

      if (!organizationId || !studentIds.length) {
        return res.status(400).json({ success: false, error: "Select at least one student." });
      }

      await ensureStudentPortalSchema(db);
      const studentPortalIntegration = await getStudentPortalIntegrationStatus(db, organizationId);
      if (!studentPortalIntegration.activated) {
        return res.status(403).json({
          success: false,
          error: "Student Portal is deactivated for this organization. Activate it from Integrations to continue.",
        });
      }

      const [studentsResult, accountResult, orgResult] = await Promise.all([
        db.query(
          `SELECT s.student_id, s.first_name, s.last_name, s.email, s.class_id, c.class_name
             FROM students s
             LEFT JOIN classes c ON c.class_id = s.class_id
            WHERE s.organization_id = $1
              AND s.student_id = ANY($2::int[])`,
          [organizationId, studentIds]
        ),
        db.query(
          `SELECT student_id, password_hash
             FROM student_accounts
            WHERE organization_id = $1
              AND student_id = ANY($2::int[])`,
          [organizationId, studentIds]
        ),
        db.query(
          `SELECT organization_name FROM organizations WHERE organization_id = $1 LIMIT 1`,
          [organizationId]
        ),
      ]);

      const studentsById = new Map(studentsResult.rows.map((student) => [Number(student.student_id), student]));
      const accountByStudentId = new Map(accountResult.rows.map((account) => [Number(account.student_id), account]));
      const organizationName = orgResult.rows[0]?.organization_name || "School";

      let sentCount = 0;
      let setupCount = 0;
      let resetCount = 0;
      let skippedNoEmailCount = 0;
      let skippedAlreadyAccessCount = 0;
      let skippedMissingCount = 0;

      for (const studentId of studentIds) {
        const student = studentsById.get(studentId);
        if (!student) {
          skippedMissingCount += 1;
          continue;
        }

        const existingAccount = accountByStudentId.get(studentId) || null;
        const hasExistingPassword = Boolean(
          existingAccount &&
          existingAccount.password_hash &&
          String(existingAccount.password_hash).trim()
        );

        // Students with an existing password already have portal access.
        if (hasExistingPassword) {
          skippedAlreadyAccessCount += 1;
          continue;
        }

        const studentEmail = normalizeStudentEmail(student.email);
        if (!studentEmail) {
          skippedNoEmailCount += 1;
          continue;
        }

        const isSetupInvite = true;

        await upsertStudentAccount(db, {
          organizationId,
          studentId,
          loginEmail: studentEmail,
        });

        const token = crypto.randomBytes(32).toString("hex");
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.query(
          `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
          [`student_${studentId}`, token, tokenExpiry]
        );

        const resetLink = process.env.NODE_ENV === "production"
          ? `https://www.managira.com/common/set-password?token=${token}&type=student`
          : `http://localhost:4000/common/set-password?token=${token}&type=student`;

        const emailTitle = isSetupInvite ? "Student Portal Access Setup" : "Student Password Reset Request";
        const emailHeading = isSetupInvite ? "Welcome to Student Portal" : "Password Reset Request";
        const emailMessage = isSetupInvite
          ? `You have been invited to access the Student Portal at ${he.encode(organizationName)}.`
          : `A password reset has been requested for your Student Portal account at ${he.encode(organizationName)}.`;

        const html = renderCleanEmail({
          title: emailHeading,
          greeting: `Hello <strong>${he.encode(student.first_name || "Student")} ${he.encode(student.last_name || "")}</strong>,`,
          paragraphs: [
            emailMessage,
            `Use your student email <strong>${he.encode(studentEmail)}</strong> to sign in after setting your password.`,
            ...(student.class_name ? [`Class: <strong>${he.encode(student.class_name)}</strong>`] : []),
            ...(!isSetupInvite ? ["If you did not request this reset, please ignore this email."] : []),
          ],
          cta: {
            text: isSetupInvite ? "Set Password" : "Reset Password",
            url: he.encode(resetLink),
          },
          note: "This link will expire in 24 hours.",
        });

        sendEmailInBackground(
          {
            from: process.env.ADMIN_NOTIFY_EMAIL_USER,
            to: studentEmail,
            subject: `${emailTitle} - ${organizationName}`,
            html,
            failureNotification: buildFailureNotification(organizationId, {
              title: "Student password email failed",
              body: `The student password email for ${studentEmail} could not be delivered.`,
            }),
            attachments: [
              {
                filename: "managira.png",
                path: path.join(__dirname, "../public/images/managira.png"),
                cid: "managira_logo",
              },
            ],
          },
          "Student Password Email"
        );

        sentCount += 1;
        setupCount += 1;
      }

      if (!sentCount) {
        const allAlreadyHaveAccess = skippedAlreadyAccessCount > 0 && skippedNoEmailCount === 0 && skippedMissingCount === 0;
        return res.status(400).json({
          success: false,
          error: allAlreadyHaveAccess
            ? "All selected students already have portal access."
            : "No student emails were sent. Select students without portal access and with valid email addresses.",
          sentCount,
          setupCount,
          resetCount,
          skippedNoEmailCount,
          skippedAlreadyAccessCount,
          skippedMissingCount,
        });
      }

      return res.json({
        success: true,
        message: `Sent ${sentCount} student portal setup email(s). Skipped ${skippedAlreadyAccessCount} with existing portal access${skippedNoEmailCount ? `, ${skippedNoEmailCount} without email` : ""}${skippedMissingCount ? `, ${skippedMissingCount} not found` : ""}.`,
        sentCount,
        setupCount,
        resetCount,
        skippedNoEmailCount,
        skippedAlreadyAccessCount,
        skippedMissingCount,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Error sending bulk student password emails." });
    }
  },

  // Admissions Hub
  admissionsHub: async (req, res, db) => {
    try {
      res.render("common/admissionsHub", {
        title: "Admissions",
        disableMainZoom: true,
      });
    } catch (error) {
            res.status(500).send("Failed to load admissions page");
    }
  },

  // All Students List (Admissions Hub)
  allStudents: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const isEmbedded = isEmbeddedRequest(req, "allStudents");
      const userId = req.session.user?.user_id || req.session.userId || null;
      const userRole = req.session.userRole || req.session.user?.account_type || null;
      const accountType = req.session.accountType || req.session.user?.account_type || null;
      const userEmail = req.session.user?.email || null;
      const canBypassAsAdmin = ["admin"].includes(normalizeRoleKey(userRole)) || ["admin"].includes(normalizeRoleKey(accountType));
      const nameSortClause = buildNameSortExpression(req.session?.nameDisplayFormat, "s");
      if (!organizationId) {
        req.flash("error", "Organization not found.");
        return res.redirect("/common/orgDashboard");
      }

      await ensureStudentIdSettingsSchema(db);
      const [studentsResult, classesResult, schoolYearsResult, orgIdSettingsResult, studentPortalIntegration, hasManageStudentsPermission] = await Promise.all([
        db.query(
          `SELECT
              s.student_id,
              s.custom_student_id,
              s.first_name,
              s.last_name,
              s.email,
              s.gender,
              s.date_of_birth,
              s.image_url,
              COALESCE(s.graduated, false) AS graduated,
              EXISTS (
                SELECT 1
                FROM student_accounts sa
                WHERE sa.organization_id = s.organization_id
                  AND sa.student_id = s.student_id
                  AND sa.password_hash IS NOT NULL
                  AND BTRIM(sa.password_hash) <> ''
              ) AS has_portal_access,
              c.class_name,
              c.class_id,
              g.name AS grad_year_group_name,
              last_sy.id AS last_school_year_id,
              last_sy.year_label AS last_school_year,
              last_sy.is_current AS in_current_year
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.class_id
            LEFT JOIN graduation_year_groups g ON s.graduation_year_group_id = g.id
            LEFT JOIN LATERAL (
              SELECT sy.id, sy.year_label, sy.current AS is_current
              FROM enrolled_students es
              JOIN enrollments e ON es.enrollment_id = e.enrollment_id
              JOIN school_years sy ON e.school_year_id = sy.id
              WHERE es.student_id = s.student_id
                AND e.organization_id = $1
              ORDER BY sy.id DESC
              LIMIT 1
            ) last_sy ON true
            WHERE s.organization_id = $1
            ORDER BY ${nameSortClause}`,
          [organizationId]
        ),
        db.query(
          `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY ${CLASS_DASHBOARD_ORDER_SQL}`,
          [organizationId]
        ),
        db.query(
          `SELECT id, year_label, current FROM school_years WHERE organization_id = $1 ORDER BY id DESC`,
          [organizationId]
        ),
        db.query(
          `SELECT use_custom_student_id, student_id_prefix, student_id_auto_generate, student_id_counter, student_id_start_number
             FROM organizations WHERE organization_id = $1`,
          [organizationId]
        ),
        getStudentPortalIntegrationStatus(db, organizationId),
        canBypassAsAdmin
          ? Promise.resolve(true)
          : userHasPermission(
              db,
              { userId, userRole, organizationId, accountType, userEmail },
              PERMISSIONS.MANAGE_STUDENTS
            ),
      ]);

      const studentPortalIntegrationActive = Boolean(studentPortalIntegration && studentPortalIntegration.activated);
      const canSendStudentPortalRequest = Boolean(studentPortalIntegrationActive && hasManageStudentsPermission);

      const studentIdSettings = orgIdSettingsResult.rows[0] || {};
      const nextAvailableStudentIdNumber = studentIdSettings.use_custom_student_id
        ? await getNextSuggestedStudentIdNumber(
            db,
            organizationId,
            studentIdSettings.student_id_counter || 0,
            [],
            null,
            studentIdSettings.student_id_start_number || null
          )
        : null;
      const students = studentsResult.rows.map((student) => ({
        ...student,
        display_name: formatDisplayName(student, req.session?.nameDisplayFormat) || "Student",
        display_student_id: buildStudentDisplayId(student, studentIdSettings),
        editable_student_id: getStudentIdEditorValue(student, studentIdSettings),
      }));

      res.render("common/allStudents", {
        title: "All Students",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        students,
        classes: classesResult.rows,
        schoolYears: schoolYearsResult.rows,
        studentIdSettings,
        nextAvailableStudentIdNumber,
        studentPortalIntegrationActive,
        canSendStudentPortalRequest,
        messages: req.flash(),
      });
    } catch (error) {
      res.status(500).send("Failed to load students list.");
    }
  },

  // Change student class (AJAX — used from All Students list)
  changeStudentClass: async (req, res, db) => {
    const client = await db.connect();
    try {
      const organizationId = req.session.organizationId;
      const { studentId } = req.params;
      const { classId } = req.body;
      const keepExistingSubjects = parseKeepExistingSubjectsPreference(req.body && req.body.keepExistingSubjects, true);

      if (!organizationId) return res.status(401).json({ success: false, error: "Unauthorized" });
      if (!classId) return res.status(400).json({ success: false, error: "classId is required" });

      await client.query("BEGIN");

      // Verify student belongs to this org
      const studentCheck = await client.query(
        `SELECT student_id FROM students WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );
      if (!studentCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Student not found" });
      }

      // Verify class belongs to this org
      const classCheck = await client.query(
        `SELECT class_id, class_name FROM classes WHERE class_id = $1 AND organization_id = $2`,
        [classId, organizationId]
      );
      if (!classCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Class not found" });
      }

      await client.query(
        `UPDATE students SET class_id = $1 WHERE student_id = $2 AND organization_id = $3`,
        [classId, studentId, organizationId]
      );

      // Also sync enrolled_students.class_id for the current school year so class rosters stay in sync
      await client.query(
        `UPDATE enrolled_students es
         SET class_id = $1
         FROM enrollments e
         INNER JOIN school_years sy ON e.school_year_id = sy.id
         WHERE es.enrollment_id = e.enrollment_id
           AND es.student_id = $2
           AND e.organization_id = $3
           AND sy.current = TRUE`,
        [classId, studentId, organizationId]
      );

      const carryoverResult = await carryStudentSubjectsToClass(client, {
        organizationId,
        studentId: Number(studentId),
        newClassId: Number(classId),
        keepExistingSubjects,
      });
      const subjectCarryoverNotice = buildSubjectCarryoverNotice(carryoverResult);

      await client.query("COMMIT");
      return res.json({
        success: true,
        className: classCheck.rows[0].class_name,
        subjectCarryoverMessage: subjectCarryoverNotice.message,
        subjectCarryoverWarning: subjectCarryoverNotice.skippedMessage,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ success: false, error: "Failed to update class" });
    } finally {
      client.release();
    }
  },

  updateStudentListDetails: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const studentId = parseInt(req.params.studentId, 10);

    await ensureStudentIdSettingsSchema(db);
    await ensureStudentEmailSchema(db);

    if (!organizationId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid student" });
    }

    const hasStudentIdChange = Object.prototype.hasOwnProperty.call(req.body || {}, 'customStudentId');
    const hasEmailChange = Object.prototype.hasOwnProperty.call(req.body || {}, 'email');
    const rawClassId = req.body.classId;
    const rawSchoolYearId = req.body.schoolYearId;
    const normalizedEmailInput = normalizeStudentEmail(req.body && req.body.email);
    const keepExistingSubjects = parseKeepExistingSubjectsPreference(req.body && req.body.keepExistingSubjects, true);

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const studentResult = await client.query(
        `SELECT s.student_id, s.class_id, s.custom_student_id, s.email, c.class_name
           FROM students s
           LEFT JOIN classes c ON c.class_id = s.class_id
          WHERE s.student_id = $1 AND s.organization_id = $2
          FOR UPDATE OF s`,
        [studentId, organizationId]
      );
      if (!studentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Student not found" });
      }

      const studentRow = studentResult.rows[0];
      const idSettingsResult = await client.query(
        `SELECT use_custom_student_id, student_id_prefix, student_id_counter, student_id_start_number
           FROM organizations
          WHERE organization_id = $1
          FOR UPDATE`,
        [organizationId]
      );
      const idSettings = idSettingsResult.rows[0] || {};

      let safeClassId = null;
      let newClassName = studentRow.class_name || null;
      const hasRequestedClassId = rawClassId !== undefined && String(rawClassId).trim() !== '';
      if (hasRequestedClassId) {
        const classCheck = await client.query(
          `SELECT class_id, class_name FROM classes WHERE class_id = $1 AND organization_id = $2`,
          [parseInt(rawClassId, 10), organizationId]
        );
        if (!classCheck.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ success: false, error: "Class not found" });
        }
        safeClassId = classCheck.rows[0].class_id;
        newClassName = classCheck.rows[0].class_name;
      }

      const hasClassChange = hasRequestedClassId
        && Number.isInteger(Number(safeClassId))
        && Number(safeClassId) !== Number(studentRow.class_id || 0);
      let subjectCarryoverNotice = { message: '', skippedMessage: '' };

      if (hasClassChange) {
        await client.query(
          `UPDATE students SET class_id = $1 WHERE student_id = $2 AND organization_id = $3`,
          [safeClassId, studentId, organizationId]
        );

        await client.query(
          `UPDATE enrolled_students es
              SET class_id = $1
             FROM enrollments e
             INNER JOIN school_years sy ON e.school_year_id = sy.id
            WHERE es.enrollment_id = e.enrollment_id
              AND es.student_id = $2
              AND e.organization_id = $3
              AND sy.current = TRUE`,
          [safeClassId, studentId, organizationId]
        );

        const carryoverResult = await carryStudentSubjectsToClass(client, {
          organizationId,
          studentId,
          newClassId: safeClassId,
          keepExistingSubjects,
        });
        subjectCarryoverNotice = buildSubjectCarryoverNotice(carryoverResult);
      }

      let safeSchoolYearId = null;
      let newYearLabel = null;
      let newYearIsCurrent = false;
      if (rawSchoolYearId !== undefined && String(rawSchoolYearId).trim() !== '') {
        const schoolYearCheck = await client.query(
          `SELECT id, year_label, current
             FROM school_years
            WHERE id = $1 AND organization_id = $2`,
          [parseInt(rawSchoolYearId, 10), organizationId]
        );
        if (!schoolYearCheck.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ success: false, error: "School year not found" });
        }

        safeSchoolYearId = schoolYearCheck.rows[0].id;
        newYearLabel = schoolYearCheck.rows[0].year_label;
        newYearIsCurrent = Boolean(schoolYearCheck.rows[0].current);

        let enrollmentId;
        const enrollmentResult = await client.query(
          `SELECT enrollment_id
             FROM enrollments
            WHERE school_year_id = $1 AND organization_id = $2
            ORDER BY enrollment_id DESC
            LIMIT 1`,
          [safeSchoolYearId, organizationId]
        );

        if (enrollmentResult.rows.length) {
          enrollmentId = enrollmentResult.rows[0].enrollment_id;
        } else {
          const newEnrollmentResult = await client.query(
            `INSERT INTO enrollments (school_year_id, organization_id)
             VALUES ($1, $2)
             RETURNING enrollment_id`,
            [safeSchoolYearId, organizationId]
          );
          enrollmentId = newEnrollmentResult.rows[0].enrollment_id;
        }

        await client.query(
          `DELETE FROM enrolled_students es
            USING enrollments e
           WHERE es.enrollment_id = e.enrollment_id
             AND e.school_year_id = $1
             AND e.organization_id = $2
             AND es.student_id = $3`,
          [safeSchoolYearId, organizationId, studentId]
        );

        const effectiveClassId = hasClassChange ? safeClassId : (studentRow.class_id || null);
        await client.query(
          `INSERT INTO enrolled_students (enrollment_id, student_id, class_id)
           VALUES ($1, $2, $3)`,
          [enrollmentId, studentId, effectiveClassId]
        );
      }

      if (hasStudentIdChange && idSettings.use_custom_student_id) {
        const prefix = String(idSettings.student_id_prefix || '');
        const rawStudentIdInput = String(req.body.customStudentId || '').trim();
        const withoutPrefix = prefix && rawStudentIdInput.toUpperCase().startsWith(prefix.toUpperCase())
          ? rawStudentIdInput.slice(prefix.length)
          : rawStudentIdInput;
        const digitsOnly = withoutPrefix.replace(/\D/g, '').slice(0, 10);

        if (withoutPrefix && !digitsOnly) {
          await client.query("ROLLBACK");
          return res.status(400).json({ success: false, error: "Student ID must contain numbers only" });
        }

        let resolvedCustomId = null;
        if (digitsOnly) {
          const numericStudentId = parseInt(digitsOnly, 10);
          resolvedCustomId = prefix + digitsOnly;
          const taken = await isStudentIdTaken(
            client,
            organizationId,
            resolvedCustomId,
            numericStudentId,
            studentId
          );

          if (taken) {
            const suggestionNumber = await getNextSuggestedStudentIdNumber(
              client,
              organizationId,
              idSettings.student_id_counter || 0,
              [],
              studentId,
              idSettings.student_id_start_number || null
            );
            const suggestion = prefix + String(suggestionNumber).padStart(Math.max(3, digitsOnly.length || 3), '0');
            await client.query("ROLLBACK");
            return res.status(409).json({
              success: false,
              error: `ID "${resolvedCustomId}" is already INUSED.`,
              suggestion,
            });
          }
        }

        await client.query(
          `UPDATE students
              SET custom_student_id = $1
            WHERE student_id = $2 AND organization_id = $3`,
          [resolvedCustomId, studentId, organizationId]
        );
      }

      if (hasEmailChange) {
        if (!normalizedEmailInput) {
          await client.query("ROLLBACK");
          return res.status(400).json({ success: false, error: "Email must be a valid address" });
        }

        const duplicateStaff = await client.query(
          `SELECT user_id FROM users WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
          [organizationId, normalizedEmailInput]
        );
        if (duplicateStaff.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, error: "This email is already used by a staff member." });
        }

        const duplicateGuardian = await client.query(
          `SELECT guardian_id FROM guardians WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
          [organizationId, normalizedEmailInput]
        );
        if (duplicateGuardian.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, error: "This email is already used by a guardian." });
        }

        const duplicateStudent = await client.query(
          `SELECT student_id FROM students
            WHERE organization_id = $1 AND student_id != $2 AND LOWER(email) = $3
            LIMIT 1`,
          [organizationId, studentId, normalizedEmailInput]
        );
        if (duplicateStudent.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, error: "This email is already used by another student." });
        }

        const duplicateStudentAccount = await client.query(
          `SELECT student_id FROM student_accounts
            WHERE organization_id = $1 AND student_id != $2 AND LOWER(login_email) = $3
            LIMIT 1`,
          [organizationId, studentId, normalizedEmailInput]
        );
        if (duplicateStudentAccount.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, error: "This email is already used by another student portal account." });
        }

        await client.query(
          `UPDATE students
              SET email = $1
            WHERE student_id = $2 AND organization_id = $3`,
          [normalizedEmailInput, studentId, organizationId]
        );
        await client.query(
          `UPDATE student_accounts
              SET login_email = $1,
                  updated_at = NOW()
            WHERE student_id = $2 AND organization_id = $3`,
          [normalizedEmailInput, studentId, organizationId]
        );
      }

      const refreshedStudentResult = await client.query(
        `SELECT student_id, class_id, custom_student_id, email
           FROM students
          WHERE student_id = $1 AND organization_id = $2`,
        [studentId, organizationId]
      );
      const refreshedStudent = refreshedStudentResult.rows[0] || studentRow;

      await client.query("COMMIT");
      return res.json({
        success: true,
        classId: refreshedStudent.class_id || null,
        className: newClassName,
        schoolYearId: safeSchoolYearId,
        yearLabel: newYearLabel,
        yearIsCurrent: newYearIsCurrent,
        email: refreshedStudent.email || null,
        displayStudentId: buildStudentDisplayId(refreshedStudent, idSettings),
        editableStudentId: getStudentIdEditorValue(refreshedStudent, idSettings),
        subjectCarryoverMessage: subjectCarryoverNotice.message,
        subjectCarryoverWarning: subjectCarryoverNotice.skippedMessage,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(500).json({ success: false, error: error.message || "Failed to update student" });
    } finally {
      client.release();
    }
  },

  // Bulk update students — change class and/or enroll in school year
  bulkUpdateStudents: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) return res.status(401).json({ success: false, error: "Unauthorized" });

      await ensureStudentIdSettingsSchema(db);
      await ensureStudentEmailSchema(db);

      const { studentIds, classId, schoolYearId, customStudentIds, studentEmails } = req.body;
      const keepExistingSubjects = parseKeepExistingSubjectsPreference(req.body && req.body.keepExistingSubjects, true);
      const hasStudentIdPayload = customStudentIds && typeof customStudentIds === 'object' && !Array.isArray(customStudentIds);
      const hasStudentEmailPayload = studentEmails && typeof studentEmails === 'object' && !Array.isArray(studentEmails);

      if (!Array.isArray(studentIds) || studentIds.length === 0)
        return res.status(400).json({ success: false, error: "No students selected" });
      if (!classId && !schoolYearId && !hasStudentIdPayload && !hasStudentEmailPayload)
        return res.status(400).json({ success: false, error: "Nothing to update — select a class, school year, student ID edits, or email edits" });

      // Sanitize to positive integers
      const safeIds = [...new Set(
        studentIds.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)
      )];
      if (!safeIds.length) return res.status(400).json({ success: false, error: "Invalid student IDs" });

      let sanitizedStudentIdUpdates = new Map();
      if (hasStudentIdPayload) {
        const incomingIds = Object.entries(customStudentIds).reduce((accumulator, [studentId, rawValue]) => {
          const parsedStudentId = parseInt(studentId, 10);
          if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0) return accumulator;
          if (!safeIds.includes(parsedStudentId)) return accumulator;
          const digitsOnly = String(rawValue == null ? '' : rawValue).replace(/\D/g, '').slice(0, 10);
          accumulator.set(parsedStudentId, digitsOnly);
          return accumulator;
        }, new Map());

        if (!incomingIds.size) {
          return res.status(400).json({ success: false, error: "No valid student ID changes were provided" });
        }
        sanitizedStudentIdUpdates = incomingIds;
      }

      let sanitizedStudentEmailUpdates = new Map();
      if (hasStudentEmailPayload) {
        const incomingEmails = Object.entries(studentEmails).reduce((accumulator, [studentId, rawValue]) => {
          const parsedStudentId = parseInt(studentId, 10);
          if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0) return accumulator;
          if (!safeIds.includes(parsedStudentId)) return accumulator;

          const normalizedEmail = normalizeStudentEmail(rawValue);
          accumulator.set(parsedStudentId, normalizedEmail);
          return accumulator;
        }, new Map());

        if (!incomingEmails.size) {
          return res.status(400).json({ success: false, error: "No valid student email changes were provided" });
        }
        sanitizedStudentEmailUpdates = incomingEmails;
      }

      // Verify all students belong to this org
      const ownershipCheck = await db.query(
        `SELECT COUNT(*)::int AS c FROM students WHERE student_id = ANY($1::int[]) AND organization_id = $2`,
        [safeIds, organizationId]
      );
      if (ownershipCheck.rows[0].c !== safeIds.length)
        return res.status(403).json({ success: false, error: "One or more students do not belong to your organisation" });

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const idSettingsResult = await client.query(
          `SELECT use_custom_student_id, student_id_prefix, student_id_counter, student_id_start_number
             FROM organizations
            WHERE organization_id = $1
            FOR UPDATE`,
          [organizationId]
        );
        const idSettings = idSettingsResult.rows[0] || {};

        if (sanitizedStudentIdUpdates.size && !idSettings.use_custom_student_id) {
          throw new Error("Custom student IDs are disabled for your organization");
        }

        const studentsSnapshotResult = await client.query(
          `SELECT student_id, custom_student_id, email
             FROM students
            WHERE student_id = ANY($1::int[]) AND organization_id = $2
            FOR UPDATE`,
          [safeIds, organizationId]
        );
        const studentsSnapshotById = studentsSnapshotResult.rows.reduce((accumulator, row) => {
          accumulator.set(Number(row.student_id), row);
          return accumulator;
        }, new Map());

        const prefix = String(idSettings.student_id_prefix || '').trim();
        const resolvedStudentIdUpdates = new Map();
        if (sanitizedStudentIdUpdates.size) {
          const seenResolved = new Set();

          for (const [currentStudentId, digitsOnly] of sanitizedStudentIdUpdates.entries()) {
            const currentStudent = studentsSnapshotById.get(Number(currentStudentId));
            if (!currentStudent) {
              throw new Error("One or more students could not be loaded for ID updates");
            }

            const resolvedCustomId = digitsOnly ? `${prefix}${digitsOnly}` : null;
            resolvedStudentIdUpdates.set(Number(currentStudentId), {
              digitsOnly,
              resolvedCustomId,
            });

            if (!resolvedCustomId) continue;
            if (seenResolved.has(resolvedCustomId)) {
              throw new Error(`Duplicate student ID "${resolvedCustomId}" was entered in bulk edit`);
            }
            seenResolved.add(resolvedCustomId);

            const numericStudentId = /^\d+$/.test(digitsOnly) ? parseInt(digitsOnly, 10) : null;
            const conflictParams = [organizationId, Number(currentStudentId), resolvedCustomId];
            let conflictQuery = `
              SELECT 1
                FROM students
               WHERE organization_id = $1
                 AND student_id != $2
                 AND (custom_student_id = $3`;
            if (digitsOnly && digitsOnly !== resolvedCustomId) {
              conflictParams.push(digitsOnly);
              conflictQuery += ` OR custom_student_id = $${conflictParams.length}`;
            }
            if (Number.isInteger(numericStudentId)) {
              conflictParams.push(numericStudentId);
              conflictQuery += ` OR student_id = $${conflictParams.length}`;
            }
            conflictQuery += `)
               LIMIT 1`;

            const conflictResult = await client.query(conflictQuery, conflictParams);
            if (conflictResult.rows.length) {
              throw new Error(`Student ID "${resolvedCustomId}" is already INUSED`);
            }
          }

          for (const [currentStudentId, updateDetails] of resolvedStudentIdUpdates.entries()) {
            await client.query(
              `UPDATE students
                  SET custom_student_id = $1
                WHERE student_id = $2 AND organization_id = $3`,
              [updateDetails.resolvedCustomId, Number(currentStudentId), organizationId]
            );
          }

          const maxNumericIdInBulk = Array.from(resolvedStudentIdUpdates.values()).reduce((maxValue, updateDetails) => {
            const numericValue = parseInt(updateDetails.digitsOnly, 10);
            if (!Number.isInteger(numericValue)) return maxValue;
            return Math.max(maxValue, numericValue);
          }, 0);
          if (maxNumericIdInBulk > Number(idSettings.student_id_counter || 0)) {
            await client.query(
              `UPDATE organizations
                  SET student_id_counter = $1
                WHERE organization_id = $2`,
              [maxNumericIdInBulk, organizationId]
            );
            idSettings.student_id_counter = maxNumericIdInBulk;
          }
        }

        if (sanitizedStudentEmailUpdates.size) {
          const seenEmails = new Set();

          for (const [currentStudentId, newEmail] of sanitizedStudentEmailUpdates.entries()) {
            const currentStudent = studentsSnapshotById.get(Number(currentStudentId));
            if (!currentStudent) {
              throw new Error("One or more students could not be loaded for email updates");
            }

            if (!newEmail) {
              throw new Error("Student email must be a valid address");
            }

            const normalizedCurrentEmail = normalizeStudentEmail(currentStudent.email);
            if (newEmail === normalizedCurrentEmail) continue;

            if (seenEmails.has(newEmail)) {
              throw new Error(`Duplicate student email "${newEmail}" was entered in bulk edit`);
            }
            seenEmails.add(newEmail);

            const conflictStaff = await client.query(
              `SELECT 1 FROM users WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
              [organizationId, newEmail]
            );
            if (conflictStaff.rows.length) {
              throw new Error(`Student email "${newEmail}" is already used by a staff member`);
            }

            const conflictGuardian = await client.query(
              `SELECT 1 FROM guardians WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
              [organizationId, newEmail]
            );
            if (conflictGuardian.rows.length) {
              throw new Error(`Student email "${newEmail}" is already used by a guardian`);
            }

            const conflictStudent = await client.query(
              `SELECT 1
                 FROM students
                WHERE organization_id = $1
                  AND student_id != $2
                  AND LOWER(email) = $3
                LIMIT 1`,
              [organizationId, Number(currentStudentId), newEmail]
            );
            if (conflictStudent.rows.length) {
              throw new Error(`Student email "${newEmail}" is already used by another student`);
            }

            const conflictStudentAccount = await client.query(
              `SELECT 1
                 FROM student_accounts
                WHERE organization_id = $1
                  AND student_id != $2
                  AND LOWER(login_email) = $3
                LIMIT 1`,
              [organizationId, Number(currentStudentId), newEmail]
            );
            if (conflictStudentAccount.rows.length) {
              throw new Error(`Student email "${newEmail}" is already used by another student portal account`);
            }
          }

          for (const [currentStudentId, newEmail] of sanitizedStudentEmailUpdates.entries()) {
            const currentStudent = studentsSnapshotById.get(Number(currentStudentId));
            if (!currentStudent) continue;
            const normalizedCurrentEmail = normalizeStudentEmail(currentStudent.email);
            if (newEmail === normalizedCurrentEmail) continue;

            await client.query(
              `UPDATE students
                  SET email = $1
                WHERE student_id = $2 AND organization_id = $3`,
              [newEmail, Number(currentStudentId), organizationId]
            );
            await client.query(
              `UPDATE student_accounts
                  SET login_email = $1,
                      updated_at = NOW()
                WHERE student_id = $2 AND organization_id = $3`,
              [newEmail, Number(currentStudentId), organizationId]
            );
          }
        }

        let safeClassId = null;
        let newClassName = null;
        let subjectCarryoverNotice = { message: '', skippedMessage: '' };
        if (classId) {
          const classCheck = await client.query(
            `SELECT class_id, class_name FROM classes WHERE class_id = $1 AND organization_id = $2`,
            [parseInt(classId, 10), organizationId]
          );
          if (!classCheck.rows.length) throw new Error("Selected class does not belong to your organisation");
          safeClassId = classCheck.rows[0].class_id;
          newClassName = classCheck.rows[0].class_name;

          await client.query(
            `UPDATE students SET class_id = $1 WHERE student_id = ANY($2::int[]) AND organization_id = $3`,
            [safeClassId, safeIds, organizationId]
          );

          // Also sync enrolled_students.class_id for the current school year so class rosters stay in sync
          await client.query(
            `UPDATE enrolled_students es
             SET class_id = $1
             FROM enrollments e
             INNER JOIN school_years sy ON e.school_year_id = sy.id
             WHERE es.enrollment_id = e.enrollment_id
               AND es.student_id = ANY($2::int[])
               AND e.organization_id = $3
               AND sy.current = TRUE`,
            [safeClassId, safeIds, organizationId]
          );

          const carryoverResults = [];
          for (const currentStudentId of safeIds) {
            const carryoverResult = await carryStudentSubjectsToClass(client, {
              organizationId,
              studentId: currentStudentId,
              newClassId: safeClassId,
              keepExistingSubjects,
            });
            carryoverResults.push(carryoverResult);
          }
          subjectCarryoverNotice = buildBulkSubjectCarryoverNotice(carryoverResults, keepExistingSubjects);
        }

        let newYearLabel = null;
        let newYearIsCurrent = false;
        if (schoolYearId) {
          const syCheck = await client.query(
            `SELECT id, year_label, current FROM school_years WHERE id = $1 AND organization_id = $2`,
            [parseInt(schoolYearId, 10), organizationId]
          );
          if (!syCheck.rows.length) throw new Error("Selected school year does not belong to your organisation");
          const safeSyId = syCheck.rows[0].id;
          newYearLabel = syCheck.rows[0].year_label;
          newYearIsCurrent = Boolean(syCheck.rows[0].current);

          // Find or create a single enrollment record for this school year + org
          let enrollmentId;
          const enrollRes = await client.query(
            `SELECT enrollment_id FROM enrollments WHERE school_year_id = $1 AND organization_id = $2 ORDER BY enrollment_id DESC LIMIT 1`,
            [safeSyId, organizationId]
          );
          if (enrollRes.rows.length) {
            enrollmentId = enrollRes.rows[0].enrollment_id;
          } else {
            const newEnroll = await client.query(
              `INSERT INTO enrollments (school_year_id, organization_id) VALUES ($1, $2) RETURNING enrollment_id`,
              [safeSyId, organizationId]
            );
            enrollmentId = newEnroll.rows[0].enrollment_id;
          }

          // For each student: remove old enrolled_students for this school year, then insert fresh
          for (const studentId of safeIds) {
            // Remove any existing entry for this student in this school year (across all enrollments of this year)
            await client.query(
              `DELETE FROM enrolled_students es
               USING enrollments e
               WHERE es.enrollment_id = e.enrollment_id
                 AND e.school_year_id = $1
                 AND e.organization_id = $2
                 AND es.student_id = $3`,
              [safeSyId, organizationId, studentId]
            );

            // Get effective class_id (may have just been updated above)
            const studentRow = await client.query(
              `SELECT class_id FROM students WHERE student_id = $1`,
              [studentId]
            );
            const effectiveClassId = safeClassId || studentRow.rows[0]?.class_id || null;

            await client.query(
              `INSERT INTO enrolled_students (enrollment_id, student_id, class_id) VALUES ($1, $2, $3)`,
              [enrollmentId, studentId, effectiveClassId]
            );
          }
        }

        await client.query("COMMIT");

        let updatedStudentIds = {};
        if (resolvedStudentIdUpdates && resolvedStudentIdUpdates.size) {
          const refreshedStudentsResult = await db.query(
            `SELECT student_id, custom_student_id
               FROM students
              WHERE organization_id = $1 AND student_id = ANY($2::int[])`,
            [organizationId, Array.from(resolvedStudentIdUpdates.keys())]
          );
          updatedStudentIds = refreshedStudentsResult.rows.reduce((accumulator, studentRow) => {
            const studentKey = String(studentRow.student_id);
            accumulator[studentKey] = {
              displayStudentId: buildStudentDisplayId(studentRow, idSettings),
              editableStudentId: getStudentIdEditorValue(studentRow, idSettings),
            };
            return accumulator;
          }, {});
        }

        let updatedStudentEmails = {};
        if (sanitizedStudentEmailUpdates && sanitizedStudentEmailUpdates.size) {
          const refreshedEmailStudentsResult = await db.query(
            `SELECT student_id, email
               FROM students
              WHERE organization_id = $1 AND student_id = ANY($2::int[])`,
            [organizationId, Array.from(sanitizedStudentEmailUpdates.keys())]
          );
          updatedStudentEmails = refreshedEmailStudentsResult.rows.reduce((accumulator, studentRow) => {
            accumulator[String(studentRow.student_id)] = {
              email: studentRow.email || null,
            };
            return accumulator;
          }, {});
        }

        return res.json({
          success: true,
          updated: safeIds.length,
          className: newClassName,
          yearLabel: newYearLabel,
          yearIsCurrent: newYearIsCurrent,
          updatedStudentIds,
          updatedStudentEmails,
          subjectCarryoverMessage: subjectCarryoverNotice.message,
          subjectCarryoverWarning: subjectCarryoverNotice.skippedMessage,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        return res.status(500).json({ success: false, error: err.message || "Bulk update failed" });
      } finally {
        client.release();
      }
    } catch (error) {
      return res.status(500).json({ success: false, error: "Bulk update failed" });
    }
  },

  // Reports Hub
  reportsHub: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;

      // Report Settings needs a classId/termId and otherwise redirects to
      // fill in defaults itself — precomputing the common case here means
      // clicking it from the hub goes straight to the real page instead of
      // paying for that extra redirect round trip inside the iframe.
      let defaultReportSettingsUrl = "/print/reportSettings";
      try {
        const [defaultClassResult, defaultTermResult] = await Promise.all([
          db.query(
            "SELECT class_id FROM classes WHERE organization_id = $1 ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name ASC, class_id ASC LIMIT 1",
            [organizationId]
          ),
          db.query(
            "SELECT term_id FROM terms WHERE organization_id = $1 AND current = TRUE ORDER BY start_date DESC LIMIT 1",
            [organizationId]
          ),
        ]);
        const defaultClassId = defaultClassResult.rows[0]?.class_id;
        const defaultTermId = defaultTermResult.rows[0]?.term_id;
        if (defaultClassId && defaultTermId) {
          defaultReportSettingsUrl = `/print/reportSettings?classId=${defaultClassId}&termId=${defaultTermId}`;
        }
      } catch (precomputeError) {
        // Fall back to the bare URL — reportSettingsPage will still resolve
        // its own defaults via its normal redirect, just with one extra hop.
      }

      res.render("common/reportsHub", {
        title: "Reports",
        disableMainZoom: true,
        defaultReportSettingsUrl,
        messages: req.flash(),
      });
    } catch (error) {
      res.status(500).send("Failed to load reports page");
    }
  },

  // Mailroom — SaaS-style page for ad-hoc SMS/WhatsApp/Email to guardians,
  // gated by the "mailroom" permission (see middleware/permissionMiddleware.js).
  mailroomHub: async (req, res, db) => {
    try {
      res.render("common/mailroom", {
        title: "Mailroom",
        disableMainZoom: true,
        organizationId: req.session.organizationId,
        messages: req.flash(),
      });
    } catch (error) {
      res.status(500).send("Failed to load mailroom page");
    }
  },

  // Activity Logs (dedicated page, linked from Reports Hub)
  activityLogs: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const isEmbedded = isEmbeddedRequest(req, "activityLogs");
      await ensureOrganizationActivityLogSchema(db);

      const filters = {
        startDate: String(req.query.startDate || "").trim(),
        endDate: String(req.query.endDate || "").trim(),
        user: String(req.query.user || "").trim(),
        action: String(req.query.action || "").trim(),
        module: String(req.query.module || "").trim(),
        role: String(req.query.role || "").trim(),
        search: String(req.query.search || "").trim(),
      };
      const allowedPageSizes = [20, 50, 70, 100, 200];
      const requestedPageSize = Math.max(1, Number(req.query.pageSize) || 20);
      const pageSize = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 20;
      const page = Math.max(1, Number(req.query.page) || 1);
      const logsBundle = await getOrganizationActivityLogs(db, {
        organizationId,
        page,
        pageSize,
        filters,
      });
      const filterOptions = await getActivityLogFilterOptions(db, organizationId);

      res.render("common/activityLogs", {
        title: "Activity Logs",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
        logs: logsBundle.rows,
        filters,
        filterOptions,
        pagination: {
          page: logsBundle.page,
          pageSize: logsBundle.pageSize,
          total: logsBundle.total,
          totalPages: logsBundle.totalPages,
          hasPrevious: logsBundle.page > 1,
          hasNext: logsBundle.page < logsBundle.totalPages,
        },
        messages: req.flash(),
      });
    } catch (error) {
      res.status(500).send("Failed to load activity logs");
    }
  },

  // Guardian search API for autocomplete in addStudent form
  searchGuardiansApi: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      const orgNameDisplayFormat = String(req.session?.nameDisplayFormat || "first_last");
      const q = (req.query.q || "").trim();

      if (!organizationId) return res.status(400).json({ guardians: [] });
      if (q.length < 2) return res.json({ guardians: [] });

      const like = `%${q}%`;

      const result = await db.query(
        `
        SELECT guardian_id, first_name, last_name, phone, email, image_url
        FROM guardian_profiles
        WHERE organization_id = $1
          AND (
            CONCAT_WS(' ', first_name, last_name) ILIKE $2
            OR CONCAT_WS(', ', last_name, first_name) ILIKE $2
            OR phone ILIKE $2
            OR email ILIKE $2
          )
        ORDER BY updated_at DESC, guardian_id DESC
        LIMIT 8
        `,
        [organizationId, like]
      );

      return res.json({
        guardians: result.rows.map((guardian) => ({
          ...guardian,
          display_name:
            formatDisplayName(guardian, orgNameDisplayFormat) ||
            [guardian.first_name, guardian.last_name].filter(Boolean).join(" ").trim(),
        })),
      });
    } catch (e) {
      return res.status(500).json({ guardians: [] });
    }
  },

  // Public guardian search (no authentication required)
  // Hardened: requires an exact phone or email match to prevent
  // unauthenticated enumeration of guardian PII by name fragments.
  searchGuardiansPublic: async (req, res, db) => {
    try {
      const organizationId = req.query.organizationId;
      const q = (req.query.q || "").trim();

      if (!organizationId) return res.status(400).json({ guardians: [] });
      if (q.length < 2) return res.json({ guardians: [] });

      const looksLikeEmail = /@/.test(q) && /\./.test(q);
      const looksLikePhone = /^\+?[0-9\s\-()]{5,}$/.test(q);
      const normalizedPhone = looksLikePhone ? q.replace(/[\s\-()]/g, "") : null;
      const namePattern = (!looksLikeEmail && !looksLikePhone) ? '%' + q.toLowerCase() + '%' : null;

      const result = await db.query(
        `
        WITH ranked AS (
          SELECT guardian_id, first_name, last_name, phone, email, image_url, updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY organization_id, LOWER(first_name), LOWER(last_name), LOWER(COALESCE(email, ''))
              ORDER BY updated_at DESC, guardian_id DESC
            ) AS rn
          FROM guardian_profiles
          WHERE organization_id = $1
            AND (
              ($2::text IS NOT NULL AND LOWER(email) = LOWER($2))
              OR ($3::text IS NOT NULL AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $3)
              OR ($4::text IS NOT NULL AND (
                LOWER(CONCAT(first_name, ' ', last_name)) LIKE $4
                OR LOWER(CONCAT(last_name, ', ', first_name)) LIKE $4
                OR LOWER(first_name) LIKE $4
                OR LOWER(last_name) LIKE $4
              ))
            )
        )
        SELECT guardian_id, first_name, last_name, phone, email, image_url
        FROM ranked
        WHERE rn = 1
        ORDER BY updated_at DESC, guardian_id DESC
        LIMIT 10
        `,
        [organizationId, looksLikeEmail ? q : null, normalizedPhone, namePattern]
      );

      let orgNameDisplayFormat = "first_last";
      try {
        const orgSettings = await db.query(
          `SELECT name_display_format FROM organizations WHERE organization_id = $1 LIMIT 1`,
          [organizationId]
        );
        if (orgSettings.rows.length > 0) {
          orgNameDisplayFormat = String(orgSettings.rows[0].name_display_format || "first_last");
        }
      } catch (_) {}

      return res.json({
        guardians: result.rows.map((guardian) => ({
          ...guardian,
          display_name:
            formatDisplayName(guardian, orgNameDisplayFormat) ||
            [guardian.first_name, guardian.last_name].filter(Boolean).join(" ").trim(),
        })),
      });
    } catch (e) {
      return res.status(500).json({ guardians: [] });
    }
  },

  savePendingStudentChanges: async (req, res, db) => {
    const { id } = req.params;
    const organizationId = req.session.organizationId;
    const body = req.body;
    const file = req.file;

    console.log('[Save Pending Student Changes] ID:', id);
    console.log('[Save Pending Student Changes] Organization ID:', organizationId);
    console.log('[Save Pending Student Changes] Body keys:', Object.keys(body));
    console.log('[Save Pending Student Changes] File:', file ? file.originalname : 'No file');

    const client = await db.connect();

    try {
      await ensureStudentEmailSchema(db);
      await client.query("BEGIN");

      // Parse and coerce values
      const classId = body.class_id ? parseInt(body.class_id) : null;
      const gradGroupId = body.graduation_year_group_id
        ? parseInt(body.graduation_year_group_id)
        : null;

      let schoolYearId = null;
      let termId = null;

      // ✅ If enrollment is current, fetch current school year and term
      if (body.enrollmentType === "current") {
        const currentYearRes = await client.query(
          `SELECT id AS school_year_id FROM school_years WHERE current = TRUE AND organization_id = $1 LIMIT 1`,
          [organizationId]
        );

        if (currentYearRes.rows.length > 0) {
          schoolYearId = currentYearRes.rows[0].school_year_id;

          const currentTermRes = await client.query(
            `SELECT term_id FROM terms WHERE school_year_id = $1 AND current = TRUE LIMIT 1`,
            [schoolYearId]
          );

          if (currentTermRes.rows.length > 0) {
            termId = currentTermRes.rows[0].term_id;
          }
        }
      } else {
        // Use submitted values for future enrollment
        schoolYearId = body.schoolYearId ? parseInt(body.schoolYearId) : null;
        termId = body.termId ? parseInt(body.termId) : null;
      }

      // ✅ Upload and save image if provided
      let imageUrl = null;
      if (file) {
        console.log('[Save Pending Student Changes] Uploading image to S3...');
        const s3Key = `images/studentimages/${organizationId}/${Date.now()}_${file.originalname}`;
        imageUrl = await uploadToS3(file, s3Key);
        console.log('[Save Pending Student Changes] Image uploaded:', imageUrl);
      }

      // ✅ Update pending student
      const baseParams = [
        body.first_name,
        body.last_name,
        body.date_of_birth,
        body.gender,
        body.hometown,
        normalizeOptionalEmail(body.student_email),
        classId,
        gradGroupId,
        schoolYearId,
        termId,
        body.enrollmentType,
      ];

      const queryParams = imageUrl
        ? [...baseParams, imageUrl, id, organizationId]
        : [...baseParams, id, organizationId];

      const updateQuery = `
        UPDATE pending_students SET
          first_name = $1,
          last_name = $2,
          date_of_birth = $3,
          gender = $4,
          hometown = $5,
          email = COALESCE($6, email),
          class_id = $7,
          graduation_year_group_id = $8,
          school_year_id = $9,
          term_id = $10,
          enrollment_type = $11
          ${imageUrl ? ", image_url = $12" : ""}
        WHERE pending_id = $${imageUrl ? 13 : 12} AND organization_id = $${
        imageUrl ? 14 : 13
      }
      `;

      await client.query(updateQuery, queryParams);
      console.log('[Save Pending Student Changes] ✅ Pending student updated');

      // ✅ Replace subjects
      await client.query(
        `DELETE FROM pending_student_subjects WHERE pending_student_id = $1`,
        [id]
      );
      const subjectArray = Array.isArray(body.subjects)
        ? body.subjects
        : body.subjects
        ? [body.subjects]
        : [];
      for (const subjectId of subjectArray) {
        await client.query(
          `INSERT INTO pending_student_subjects (pending_student_id, subject_id, organization_id)
          VALUES ($1, $2, $3)`,
          [id, parseInt(subjectId), organizationId]
        );
      }

      // ✅ Replace guardians
      await client.query(`DELETE FROM pending_guardians WHERE pending_id = $1`, [
        id,
      ]);
      const guardianKeys = Object.keys(body).filter((k) =>
        k.startsWith("guardianFirstName")
      );
      for (let i = 0; i < guardianKeys.length; i++) {
        const fn = body[`guardianFirstName${i}`];
        if (!fn) continue;
        await client.query(
          `INSERT INTO pending_guardians 
          (pending_id, first_name, last_name, phone, email, hometown)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            fn,
            body[`guardianLastName${i}`],
            body[`guardianPhone${i}`],
            body[`guardianEmail${i}`],
            body[`guardianHometown${i}`],
          ]
        );
      }

      await client.query("COMMIT");
      console.log('[Save Pending Student Changes] ✅✅✅ Changes saved successfully');
      return res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error('[Save Pending Student Changes] ❌❌❌ ERROR:', err.message);
      console.error('[Save Pending Student Changes] Error stack:', err.stack);
      return res.status(500).json({ error: "Failed to save changes." });
    } finally {
      client.release();
    }
  },

  // GET /common/check-student-id?id=MGI042&exclude=5
  // Returns { taken: true|false }
  checkStudentId: async (req, res, db) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
      const customId = (req.query.id || "").trim();
      if (!customId) return res.json({ taken: false });
      // numOnly is the bare number the user typed (e.g. "222").
      // customId is the full display ID (e.g. "MIS222"). We check both
      // custom IDs and system student_ids because some pages derive the display
      // ID from student_id when custom_student_id is null.
      const rawNumOnly = (req.query.num || "").trim();
      const trailingDigits = customId.match(/(\d+)$/);
      const numOnly = rawNumOnly || (trailingDigits ? trailingDigits[1] : "");
      const numericStudentId = /^\d+$/.test(numOnly) ? parseInt(numOnly, 10) : null;
      const excludeStudentId = parseInt(req.query.exclude) || null;
      const params = [organizationId];
      let query = `SELECT 1 FROM students WHERE organization_id = $1`;
      if (excludeStudentId) {
        params.push(excludeStudentId);
        query += ` AND student_id != $2`;
      }
      const conditions = [];
      params.push(customId);
      conditions.push(`custom_student_id = $${params.length}`);
      if (numOnly && numOnly !== customId) {
        params.push(numOnly);
        conditions.push(`custom_student_id = $${params.length}`);
      }
      if (Number.isInteger(numericStudentId)) {
        params.push(numericStudentId);
        conditions.push(`student_id = $${params.length}`);
      }
      query += ` AND (${conditions.join(' OR ')}) LIMIT 1`;
      const result = await db.query(query, params);
      return res.json({ taken: result.rows.length > 0 });
    } catch (err) {
      console.error('[checkStudentId]', err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },

  // Unified broadcast/announcement system (modal + banner popups) — list page.
  // Data is loaded client-side via GET /announcements; this just renders the shell.
  manageAnnouncementsGet: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "manageAnnouncements");
      const isPlatformAdmin = String(req.session?.accountType || "").trim().toLowerCase() === "admin";
      res.render("common/manageAnnouncements", {
        title: "Manage Announcements",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        isPlatformAdmin,
      });
    } catch (error) {
      console.error("[manageAnnouncementsGet]", error);
      req.flash("error", "Unable to load announcements.");
      return res.redirect("/common/orgDashboard");
    }
  },

  // Composer for the new broadcast_announcements table — used both standalone
  // and iframe-embedded inside the ManagiraDrawer opened from manageAnnouncements.
  announcementComposerGet: async (req, res, db) => {
    try {
      const isEmbedded = isEmbeddedRequest(req, "announcementComposer");
      let announcement = null;
      const id = parseInt(req.query.id, 10);
      if (Number.isInteger(id)) {
        const result = await db.query(`SELECT * FROM broadcast_announcements WHERE id = $1`, [id]);
        if (result.rows[0]) {
          const targetsResult = await db.query(
            `SELECT target_type, target_value FROM broadcast_announcement_targets WHERE announcement_id = $1`,
            [id]
          );
          announcement = { ...result.rows[0], targets: targetsResult.rows };
        }
      }
      const isPlatformAdmin = String(req.session?.accountType || "").trim().toLowerCase() === "admin";
      const isGlobalMode = isPlatformAdmin && req.query.global === "1";
      let orgOptions = [];
      if (isGlobalMode) {
        const orgsResult = await db.query(
          `SELECT organization_id, organization_name FROM organizations WHERE deleted IS NOT TRUE ORDER BY organization_name ASC`
        );
        orgOptions = orgsResult.rows;
      }
      res.render("common/announcementComposer", {
        title: announcement ? "Edit Announcement" : "New Announcement",
        isEmbedded,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        announcement,
        isPlatformAdmin,
        isGlobalMode,
        orgOptions,
      });
    } catch (error) {
      console.error("[announcementComposerGet]", error);
      req.flash("error", "Unable to load the announcement composer.");
      return res.redirect("/common/manageAnnouncements");
    }
  },
};


// Helper function to send invitation email
async function sendInviteEmail(
  email,
  firstName,
  lastName,
  link,
  organizationName,
  organizationId,
  classNames = [],
  subjectNames = []
) {
  const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
  const assignmentDetails = [];
  if (classNames.length) {
    assignmentDetails.push({ label: "Assigned Classes", value: classNames.map(n => he.encode(n)).join(", ") });
  }
  if (subjectNames.length) {
    assignmentDetails.push({ label: "Assigned Subjects", value: subjectNames.map(n => he.encode(n)).join(", ") });
  }

  const html = renderCleanEmail({
    title: `You're Invited to Join ${he.encode(organizationName)}`,
    greeting: `Hello <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
    paragraphs: [
      `${he.encode(organizationName)} is inviting you to join their institution. Accept this invitation to set your password.`,
      ...(assignmentDetails.length ? ["Here are your initial assignments:"] : []),
    ],
    details: assignmentDetails.length ? assignmentDetails : undefined,
    cta: {
      text: "Accept Invite & Set Password",
      url: he.encode(link),
    },
    followManagira: true,
    linkedinUrl,
    note: 'This link will expire in 3 days. For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });
  const mailOptions = {
    from: process.env.ADMIN_NOTIFY_EMAIL_USER,
    to: email,
    subject: "Set Your Password - Managira",
    html,
    failureNotification: buildFailureNotification(organizationId, {
      title: 'Employee invite email failed',
      body: `The employee invite email for ${firstName} ${lastName} could not be delivered to ${email}.`,
    }),
    attachments: [
      {
        filename: "managira.png",
        path: require("path").join(__dirname, "../public/images/managira.png"),
        cid: "managira_logo",
      },
    ],
  };
  sendEmailInBackground(mailOptions, "Employee Invite Email");
}

async function sendPasswordSetSuccessEmail(email, firstName, lastName, organizationId = null) {
  const html = renderCleanEmail({
    title: "Password Set Successfully",
    greeting: `Hello <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
    paragraphs: [
      "Your password has been set successfully. You can now log in with your email and new password.",
      "If you did not perform this action, please contact your administrator immediately.",
    ],
    note: 'If you have any questions, please visit our <a href="https://docs.google.com/document/d/1bgFP5cCQyr-9jdaYZTsWO8ONAnAuNUKqKQ2if_4TBOM/edit?tab=t.o84y9ldsnqto#heading=h.o10u93e8wqgq" target="_blank" rel="noopener">User Documentation Guide</a>, <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a>, or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,
    to: email,
    subject: "Your Password Has Been Set Successfully",
    html,
    failureNotification: buildFailureNotification(organizationId, {
      title: 'Password set success email failed',
      body: `The password set confirmation email for ${firstName} ${lastName} could not be delivered to ${email}.`,
    }),
    attachments: [
      {
        filename: "managira.png",
        path: require("path").join(__dirname, "../public/images/managira.png"),
        cid: "managira_logo",
      },
    ],
  };
  sendEmailInBackground(mailOptions, "Password Set Success Email");
}


// Send welcome email to new guardian with password setup
const sendGuardianWelcomeEmail = async (guardianEmail, guardianFirstName, guardianLastName, studentName, organizationName, organizationId, guardianId) => {
  try {
    const db = require("../config/db");

    // Org-level opt-out: Settings → Notifications → Organization Notifications.
    // Defaults to enabled, so this only skips sending when a school has
    // explicitly turned it off (staff then send the invite manually from
    // the guardian's page instead).
    const autoInviteEnabled = await isOrgEmailEnabled(db, organizationId, 'guardian_auto_invite_on_student_add');
    if (!autoInviteEnabled) return;

    const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
    // Generate token for password setup
    const token = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in database
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
      [`guardian_${guardianId}`, token, tokenExpiry]
    );

    const setupLink = process.env.NODE_ENV === "production"
      ? `https://www.managira.com/common/set-password?token=${token}&type=guardian`
      : `http://localhost:4000/common/set-password?token=${token}&type=guardian`;

    const html = renderCleanEmail({
      title: `Welcome to ${he.encode(organizationName)} Parent Portal`,
      greeting: `Hello <strong>${he.encode(guardianFirstName)} ${he.encode(guardianLastName)}</strong>,`,
      paragraphs: [
        `Great news! <strong>${he.encode(studentName)}</strong> has been registered at ${he.encode(organizationName)}, and you've been added as their guardian.`,
        "To monitor your child's academic progress, grades, and connect with teachers, please set up your Parent Portal password.",
      ],
      details: [
        { label: "Login Email", value: he.encode(guardianEmail) },
      ],
      cta: { text: "Set My Password", url: he.encode(setupLink) },
      followManagira: true,
      linkedinUrl,
      note: `This password setup link will expire in 24 hours. If you have any questions, please contact ${he.encode(organizationName)} directly.`,
    });

    const mailOptions = {
      from: process.env.ADMIN_NOTIFY_EMAIL_USER,
      to: guardianEmail,
      subject: `Action required: set your ${organizationName} parent portal password`,
      html,
      failureNotification: buildFailureNotification(organizationId, {
        title: 'Guardian welcome email failed',
        body: `The guardian welcome email for ${studentName} could not be delivered to ${guardianEmail}.`,
      }),
      attachments: [
        {
          filename: 'managira.png',
          path: require('path').join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo'
        }
      ]
    };

    sendEmailInBackground(mailOptions, "Guardian Welcome Email");
      } catch (error) {
      }
};

// Send notification when additional student is added to existing guardian
const sendGuardianStudentAddedEmail = async (guardianEmail, guardianFirstName, guardianLastName, studentName, organizationName, organizationId) => {
  try {
    // Honor guardian preference for "additional child added" notifications.
    const _db = require("../config/db");
    if (!(await isEmailEnabledForRecipient(_db, guardianEmail, 'guardian_additional_student_added'))) return;
    const html = renderCleanEmail({
      title: "New Student Added to Your Account",
      greeting: `Hello <strong>${he.encode(guardianFirstName)} ${he.encode(guardianLastName)}</strong>,`,
      paragraphs: [
        `<strong>${he.encode(studentName)}</strong> has been added to your Parent Portal account at ${he.encode(organizationName)}.`,
        "You can now view their academic progress, grades, and teacher information by logging in to your Parent Portal.",
      ],
      details: [{ label: "Login Email", value: he.encode(guardianEmail) }],
      cta: {
        text: "Login to Parent Portal",
        url: process.env.NODE_ENV === 'production' ? 'https://www.managira.com/account/login' : 'http://localhost:4000/account/login'
      },
    });

    const mailOptions = {
      from: process.env.ADMIN_NOTIFY_EMAIL_USER,
      to: guardianEmail,
      subject: `New Student Added - ${organizationName} Parent Portal`,
      html,
      failureNotification: buildFailureNotification(organizationId, {
        title: 'Guardian student-added email failed',
        body: `The student-added email for ${studentName} could not be delivered to ${guardianEmail}.`,
      }),
      attachments: [
        {
          filename: 'managira.png',
          path: require('path').join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo'
        }
      ]
    };

    sendEmailInBackground(mailOptions, "Guardian Student Added Email");
      } catch (error) {
      }
};

module.exports = {
  isAuthenticated,
  commonController,
  sendInviteEmail,
  sendPasswordSetSuccessEmail,
  sendGuardianWelcomeEmail,
  sendGuardianStudentAddedEmail,
  getUpcomingBirthdayInfo,
  buildUpcomingBirthdayCards,
  getStudentBirthdayWish,
  getStaffBirthdayWish,
};
