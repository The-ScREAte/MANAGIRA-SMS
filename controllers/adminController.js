const db = require("../config/db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const { Parser } = require("json2csv");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { uploadToS3, deleteFromS3 } = require("../config/s3");
const he = require("he");
const cacheManager = require("../utils/cacheManager");
const { sendEmailSafely, sendEmailInBackground, renderCleanEmail } = require("../utils/emailHelper");
const { pingSearchEngines } = require("../utils/sitemapPing");
const {
  getCurrencyProfileForRequest,
  localizeUsdAmount,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const {
  getPaystackSettings,
  upsertPaystackSettings,
  normalizeMode,
} = require("../utils/paystackConfig");
const {
  getPaymentProvider,
  normalizePaymentProvider,
  upsertPaymentProvider,
} = require("../utils/paymentProviderConfig");
const {
  getStripeSettings,
  getStripePlatformCredentials,
  normalizeMode: normalizeStripeMode,
  upsertStripeSettings,
} = require("../utils/stripeConfig");
const {
  getPlatformFeeSettings,
  upsertPlatformFeeSettings,
  normalizePlatformFeePercentage,
} = require("../utils/platformFee");
const { formatDisplayName } = require("../utils/organizationDisplayPreferences");
const { ensurePaymentProviderSchema } = require("../utils/paymentProviderSchema");
const {
  invalidateOrganizationAccessCache,
  invalidateAccessForPlan,
} = require("../utils/accessCache");
const { ensureEmploymentSchema } = require("../utils/employmentSchema");
const { ensureInternalWorkerSchema } = require("../utils/internalSchema");
const {
  ensureEmailPreferencesSchema,
  getStaffPreferencesForRole,
  getUserPreferenceMap,
  setUserPreferences,
} = require("../utils/emailPreferences");
const {
  ensureAdminEmailCampaignSchema,
  normalizeCampaignInput,
  computeNextRunAt,
} = require("../utils/adminEmailCampaigns");
const { ensureAdminAnnouncementSchema } = require("../utils/adminAnnouncementSchema");
const {
  ensureUserFeedbackSchema,
  FEEDBACK_STATUS_OPTIONS,
  normalizeFeedbackStatus,
} = require("../utils/userFeedback");
const { ensureEmailSuppressionSchema, unsuppressEmail } = require("../utils/emailSuppression");
// Dynamic Pricing v2 (Beta) — parallel system, not used by any legacy pricing code path
const {
  computeDynamicMonthlyPrice,
  applyCycle,
  getRegionForCountry,
  getPlanRegionPrice,
} = require("../utils/dynamicPricing");
const { COUNTRIES_BY_CONTINENT, COUNTRY_NAME_LOOKUP } = require("../utils/countries");

const EMPLOYMENT_INTERVIEW_INVITE_URL = "https://calendly.com/managirasms/managira-team-review-meeting";

function computeTierMonthlyPrice(planBasePrice, tier) {
  const basePrice = Number(planBasePrice || 0);
  const adjustmentPercent = Number(tier?.adjustment_percentage);
  if (Number.isFinite(adjustmentPercent)) {
    return Math.max(0, basePrice * (1 + adjustmentPercent / 100));
  }
  return Number(tier?.price_usd || 0);
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === "" || value === "all") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEmailAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isAjaxRequest(req) {
  return req.xhr || req.get("X-Requested-With") === "XMLHttpRequest";
}

function isAdminSideManager(accountType) {
  return accountType === 'Admin' || accountType === 'Mini Admin';
}

function isManagiraWorkerAccountType(accountType) {
  return (
    accountType === 'Admin' ||
    accountType === 'Mini Admin' ||
    accountType === 'Internal Worker' ||
    accountType === 'super_admin'
  );
}

// Returns { mode: 'own'|'all'|'selected', sourceUserIds: number[] } describing
// which other Managira Workers' internal_contacts this user has been granted
// visibility into (in addition to their own/assigned contacts).
async function getContactAccessGrant(userId) {
  const flagResult = await db.query(
    `SELECT contact_access_mode FROM user_feature_flags WHERE user_id = $1`,
    [userId]
  );
  const mode = flagResult.rows.length ? flagResult.rows[0].contact_access_mode : 'own';

  if (mode !== 'selected') {
    return { mode, sourceUserIds: [] };
  }

  const sourcesResult = await db.query(
    `SELECT source_user_id FROM user_extra_worker_contacts WHERE user_id = $1`,
    [userId]
  );
  return { mode, sourceUserIds: sourcesResult.rows.map((row) => row.source_user_id) };
}

async function hasExtraContactGrant(userId, contactId) {
  const grant = await getContactAccessGrant(userId);
  if (grant.mode === 'all') return true;
  if (grant.mode !== 'selected' || !grant.sourceUserIds.length) return false;

  const result = await db.query(
    `SELECT 1 FROM internal_contacts
     WHERE id = $1
       AND (created_by_user_id = ANY($2::int[]) OR assigned_to_user_id = ANY($2::int[]))
     LIMIT 1`,
    [contactId, grant.sourceUserIds]
  );
  return result.rows.length > 0;
}

function hasStripeWebhookSecretConfigured() {
  return Boolean(
    String(process.env.STRIPE_FINANCE_WEBHOOK_SECRET || "").trim() ||
    String(process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "").trim() ||
    String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()
  );
}

function resolveStripeModeReadiness(modeInput, settings) {
  const mode = normalizeStripeMode(modeInput);
  const isLive = mode === "live";
  const activeSecretKey = String(isLive ? settings.liveSecretKey : settings.testSecretKey || "").trim();
  const activePublicKey = String(isLive ? settings.livePublicKey : settings.testPublicKey || "").trim();
  const connectSecretKey = String(
    isLive
      ? (process.env.STRIPE_CONNECT_LIVE_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || "")
      : (process.env.STRIPE_CONNECT_TEST_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || "")
  ).trim();
  const fullSecretPrefix = isLive ? "sk_live_" : "sk_test_";
  const fullPlatformSecret = [connectSecretKey, activeSecretKey].find((key) => key.startsWith(fullSecretPrefix)) || "";

  return {
    mode,
    activeSecretKey,
    activePublicKey,
    fullPlatformSecret,
    hasWebhookSecret: hasStripeWebhookSecretConfigured(),
  };
}

function formatAdminSideRoleShort(accountType) {
  switch ((accountType || '').trim()) {
    case 'Internal Worker':
      return 'IW';
    case 'Admin':
      return 'AD';
    case 'Mini Admin':
      return 'MAD';
    default:
      return (accountType || '').trim();
  }
}

function wantsJsonResponse(req) {
  return req.xhr || String(req.get("accept") || "").includes("application/json");
}

function computeFeedbackSummary(feedbackItems = []) {
  const rows = Array.isArray(feedbackItems) ? feedbackItems : [];
  const reviewItems = rows.filter((item) => Number.isInteger(Number(item.rating)) && Number(item.rating) > 0);
  const averageRating = reviewItems.length
    ? reviewItems.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviewItems.length
    : 0;

  return {
    total: rows.length,
    newCount: rows.filter((item) => item.status === "new").length,
    featureRequestCount: rows.filter((item) => item.feedback_type === "feature_request").length,
    bugReportCount: rows.filter((item) => item.feedback_type === "bug_report").length,
    averageRating,
  };
}

async function fetchAdminSideUsers() {
  const result = await db.query(
    `SELECT user_id, first_name, last_name, email, account_type, on_hold
     FROM users
     WHERE account_type IN ('Admin', 'Mini Admin', 'Internal Worker')
     ORDER BY
       CASE account_type
         WHEN 'Admin' THEN 0
         WHEN 'Mini Admin' THEN 1
         ELSE 2
       END,
       last_name ASC,
       first_name ASC`
  );

  return result.rows.map((user) => {
    const first = (user.first_name || '').trim();
    const last = (user.last_name || '').trim();
    const fullName = `${first} ${last}`.trim() || user.email || `User ${user.user_id}`;
    const shortRole = formatAdminSideRoleShort(user.account_type);
    return {
      user_id: user.user_id,
      account_type: user.account_type,
      email: user.email,
      on_hold: !!user.on_hold,
      label: shortRole ? `${fullName} (${shortRole})` : fullName,
    };
  });
}

async function fetchAdminEmailCampaigns() {
  await ensureAdminEmailCampaignSchema(db);

  const result = await db.query(
    `SELECT c.id,
            c.subject,
            c.content,
            c.manual_emails,
            c.target_user_ids,
            c.frequency,
            c.send_time,
            c.day_of_week,
            c.day_of_month,
            c.start_date,
            c.end_date,
            c.is_active,
            c.last_sent_at,
            c.next_run_at,
            c.last_error,
            c.created_at,
            c.updated_at,
            c.created_by,
            CONCAT_WS(' ', creator.first_name, creator.last_name) AS created_by_name,
            COALESCE(target_users.users_json, '[]'::json) AS target_users
     FROM admin_email_campaigns c
     LEFT JOIN users creator ON creator.user_id = c.created_by
     LEFT JOIN LATERAL (
       SELECT json_agg(
                json_build_object(
                  'userId', u.user_id,
                  'name', CONCAT_WS(' ', u.first_name, u.last_name),
                  'email', u.email,
                  'accountType', u.account_type
                )
                ORDER BY u.first_name, u.last_name, u.email
              ) AS users_json
       FROM users u
       WHERE u.user_id = ANY(c.target_user_ids)
     ) target_users ON TRUE
     ORDER BY c.created_at DESC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    content: row.content,
    manualEmails: Array.isArray(row.manual_emails) ? row.manual_emails : [],
    targetUserIds: Array.isArray(row.target_user_ids) ? row.target_user_ids.map((value) => Number(value)) : [],
    targetUsers: Array.isArray(row.target_users) ? row.target_users : [],
    frequency: row.frequency,
    sendTime: row.send_time,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: Boolean(row.is_active),
    lastSentAt: row.last_sent_at,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
  }));
}

async function resolveTargetUsers(targetUserIds) {
  if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) {
    return [];
  }

  const result = await db.query(
    `SELECT user_id, first_name, last_name, email, account_type
     FROM users
     WHERE user_id = ANY($1::int[])
     ORDER BY first_name, last_name, email`,
    [targetUserIds]
  );

  return result.rows;
}

async function createOrUpdateAdminEmailCampaign({ payload, campaignId, actorUserId }) {
  await ensureAdminEmailCampaignSchema(db);

  const normalized = normalizeCampaignInput(payload);
  const targetUsers = await resolveTargetUsers(normalized.targetUserIds);
  const validTargetUserIds = targetUsers.map((user) => Number(user.user_id));

  if (normalized.manualEmails.length === 0 && validTargetUserIds.length === 0) {
    throw new Error("Select valid users or provide at least one manual email.");
  }

  const schedule = {
    frequency: normalized.frequency,
    sendTime: normalized.sendTime,
    dayOfWeek: normalized.dayOfWeek,
    dayOfMonth: normalized.dayOfMonth,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  };

  const nextRunAt = normalized.isActive
    ? computeNextRunAt(schedule, new Date(), { allowImmediateCatchUp: true })
    : null;
  const params = [
    normalized.subject,
    normalized.content,
    normalized.manualEmails,
    validTargetUserIds,
    normalized.frequency,
    normalized.sendTime,
    normalized.dayOfWeek,
    normalized.dayOfMonth,
    normalized.startDate,
    normalized.endDate,
    normalized.isActive,
    nextRunAt,
  ];

  if (campaignId) {
    params.push(campaignId);
    await db.query(
      `UPDATE admin_email_campaigns
       SET subject = $1,
           content = $2,
           manual_emails = $3,
           target_user_ids = $4,
           frequency = $5,
           send_time = $6,
           day_of_week = $7,
           day_of_month = $8,
           start_date = $9,
           end_date = $10,
           is_active = $11,
           next_run_at = $12,
           last_error = NULL
       WHERE id = $13`,
      params
    );
  } else {
    params.push(actorUserId || null);
    await db.query(
      `INSERT INTO admin_email_campaigns (
         subject,
         content,
         manual_emails,
         target_user_ids,
         frequency,
         send_time,
         day_of_week,
         day_of_month,
         start_date,
         end_date,
         is_active,
         next_run_at,
         created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params
    );
  }

  return fetchAdminEmailCampaigns();
}

function buildUserFullName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;
}

async function buildConstraintErrorMessage(error, referenceId, fallbackMessage, entityLabel) {
  if (error?.code !== "23503" || !error?.constraint) {
    return error?.message ? `${fallbackMessage} ${error.message}` : fallbackMessage;
  }

  try {
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
    if (!fkInfo) {
      return fallbackMessage;
    }

    const qSchema = String(fkInfo.schema_name).replace(/"/g, '""');
    const qTable = String(fkInfo.table_name).replace(/"/g, '""');
    const qColumn = String(fkInfo.column_name).replace(/"/g, '""');

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM "${qSchema}"."${qTable}"
       WHERE "${qColumn}" = $1`,
      [referenceId]
    );

    const linkedCount = countResult.rows[0]?.count || 0;
    return linkedCount > 0
      ? `Cannot delete this ${entityLabel}. It is still linked to ${linkedCount} record(s) in ${fkInfo.table_name} (${fkInfo.column_name}).`
      : `Cannot delete this ${entityLabel}. It is still linked to protected records in ${fkInfo.table_name} (${fkInfo.column_name}).`;
  } catch (lookupError) {
    return fallbackMessage;
  }
}

async function deleteUserWithDependencies({ userId, actorUserId }) {
  const userResult = await db.query(
    `SELECT user_id, organization_id, first_name, last_name, email, account_type, on_hold
     FROM users
     WHERE user_id = $1`,
    [userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    const notFoundError = new Error("User not found.");
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  if (actorUserId && Number(actorUserId) === Number(userId)) {
    const selfDeleteError = new Error("You cannot delete your own account from this page.");
    selfDeleteError.statusCode = 400;
    throw selfDeleteError;
  }

  try {
    await db.query("BEGIN");

    const organizationId = user.organization_id ? Number(user.organization_id) : null;
    let fallbackOwnerId = null;

    if (organizationId) {
      const fallbackResult = await db.query(
        `SELECT user_id
         FROM users
         WHERE organization_id = $1
           AND user_id <> $2
         ORDER BY CASE
                    WHEN account_type IN ('Manager', 'Admin', 'Mini Admin', 'Supervisor') THEN 0
                    ELSE 1
                  END,
                  created_at ASC
         LIMIT 1`,
        [organizationId, userId]
      );
      fallbackOwnerId = fallbackResult.rows[0]?.user_id || null;

      const docsTableExists = await db.query(`SELECT to_regclass('public.documents') AS tbl`);
      if (docsTableExists.rows[0]?.tbl) {
        const docsOwnedResult = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM documents
           WHERE organization_id = $1 AND created_by = $2`,
          [organizationId, userId]
        );
        const docsOwnedCount = docsOwnedResult.rows[0]?.count || 0;

        if (docsOwnedCount > 0 && !fallbackOwnerId) {
          throw new Error(
            "This user owns documents and cannot be deleted because there is no fallback user to transfer them to."
          );
        }

        if (docsOwnedCount > 0 && fallbackOwnerId) {
          await db.query(
            `UPDATE documents
             SET created_by = $1, updated_at = NOW()
             WHERE organization_id = $2 AND created_by = $3`,
            [fallbackOwnerId, organizationId, userId]
          );
        }
      }
    }

    await db.query("DELETE FROM user_classes WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM user_subjects WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM user_permissions WHERE user_id = $1", [userId]);

    const deleteResult = await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
    if (deleteResult.rowCount === 0) {
      throw new Error("User deletion failed.");
    }

    await db.query("COMMIT");
    return user;
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (rollbackError) {
    }
    throw error;
  }
}

const adminController = {
  adminDashboard: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);
      await ensureUserFeedbackSchema(db).catch(() => {});

      const accountType = req.session.accountType;
      const isInternalWorker = accountType === 'Internal Worker';
      const isFullAdmin = accountType === 'Admin';

      // Internal workers don't see the org list at all.
      let applications = [];
      if (!isInternalWorker) {
        applications = await cacheManager.getOrFetch(
          'admin',
          'organizations:list',
          async () => {
            const result = await db.query(`
              SELECT o.organization_id, o.organization_name, o.on_hold, o.hold_by,
                     first_name, last_name, email, organization_address, organization_country, organization_province,
                     organization_phone, proof_of_existence_1, proof_of_existence_2, subdomain,
                     o.created_at, p.plan_name
              FROM organizations o
              LEFT JOIN plans p ON p.id = o.plan_id
              WHERE o.deleted = false
                AND (o.hub_id IS NULL OR o.is_hub_member = false)
              ORDER BY o.organization_name ASC
            `);
            return result.rows;
          },
          { ttl: 300 } // 5 minute cache
        );
      }

      // Active announcements flagged for the admin dashboard, excluding any
      // the current user has already marked as seen.
      let latestAnnouncement = null;
      let adminAnnouncements = [];
      try {
        await ensureAdminAnnouncementSchema(db);
        const annResult = await db.query(
          `
          SELECT a.id, a.title, a.description, a.created_at
          FROM admin_announcements a
          LEFT JOIN announcement_views v
            ON v.announcement_id = a.id AND v.user_id = $1
          WHERE a.is_active = TRUE
            AND a.show_for_admins = TRUE
            AND v.view_id IS NULL
          ORDER BY a.created_at DESC
          `,
          [req.session.userId]
        );
        adminAnnouncements = annResult.rows;
        latestAnnouncement = adminAnnouncements[0] || null;
      } catch (_) {
        latestAnnouncement = null;
        adminAnnouncements = [];
      }

      // Contacts / referrals.
      // - Internal Worker sees only their own.
      // - Admin / Mini Admin sees all contacts with the creator's name.
      let contacts = [];
      const canManageAllContacts = isAdminSideManager(accountType);
      const canAssignContacts = accountType === 'Admin';
      const contactAccessGrant = isInternalWorker
        ? await getContactAccessGrant(req.session.userId)
        : { mode: 'all', sourceUserIds: [] };

      if (isInternalWorker && contactAccessGrant.mode !== 'all') {
        const own = await db.query(
          `SELECT ic.id, ic.contact_name, ic.organization_name, ic.appointment_set, ic.appointment_at,
                  ic.notes, ic.followed_up, ic.followed_up_at, ic.joined, ic.joined_at,
                  ic.created_at, ic.created_by_user_id, ic.assigned_to_user_id, ic.assigned_at,
                  creator.first_name AS creator_first_name,
                  creator.last_name AS creator_last_name,
                  creator.account_type AS creator_account_type,
                  assignee.first_name AS assignee_first_name,
                  assignee.last_name AS assignee_last_name,
                  assignee.account_type AS assignee_account_type
           FROM internal_contacts ic
           LEFT JOIN users creator ON creator.user_id = ic.created_by_user_id
           LEFT JOIN users assignee ON assignee.user_id = ic.assigned_to_user_id
           WHERE ic.deleted_at IS NULL
             AND (
               ic.created_by_user_id = $1
               OR ic.assigned_to_user_id = $1
               OR ic.created_by_user_id = ANY($2::int[])
               OR ic.assigned_to_user_id = ANY($2::int[])
             )
           ORDER BY created_at DESC
           LIMIT 200`,
          [req.session.userId, contactAccessGrant.sourceUserIds]
        );
        contacts = own.rows;
      } else {
        const all = await db.query(
          `SELECT ic.id, ic.contact_name, ic.organization_name, ic.appointment_set,
                  ic.appointment_at, ic.notes, ic.followed_up, ic.followed_up_at,
                  ic.joined, ic.joined_at, ic.assigned_to_user_id, ic.assigned_at,
                  ic.created_at, ic.created_by_user_id,
                  creator.first_name AS creator_first_name,
                  creator.last_name  AS creator_last_name,
                  creator.account_type AS creator_account_type,
                  assignee.first_name AS assignee_first_name,
                  assignee.last_name AS assignee_last_name,
                  assignee.account_type AS assignee_account_type
           FROM internal_contacts ic
           LEFT JOIN users creator ON creator.user_id = ic.created_by_user_id
           LEFT JOIN users assignee ON assignee.user_id = ic.assigned_to_user_id
           WHERE ic.deleted_at IS NULL
           ORDER BY ic.created_at DESC
           LIMIT 500`
        );
        contacts = all.rows;
      }

      let feedbackSummary = {
        total: 0,
        newCount: 0,
        featureRequestCount: 0,
        bugReportCount: 0,
        averageRating: 0,
      };

      try {
        const feedbackSummaryResult = await db.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'new')::int AS new_count,
             COUNT(*) FILTER (WHERE feedback_type = 'feature_request')::int AS feature_request_count,
             COUNT(*) FILTER (WHERE feedback_type = 'bug_report')::int AS bug_report_count,
             AVG(rating)::numeric(10,2) FILTER (WHERE rating IS NOT NULL) AS average_rating
           FROM user_feedback`
        );

        feedbackSummary = {
          total: Number(feedbackSummaryResult.rows[0]?.total || 0),
          newCount: Number(feedbackSummaryResult.rows[0]?.new_count || 0),
          featureRequestCount: Number(feedbackSummaryResult.rows[0]?.feature_request_count || 0),
          bugReportCount: Number(feedbackSummaryResult.rows[0]?.bug_report_count || 0),
          averageRating: Number(feedbackSummaryResult.rows[0]?.average_rating || 0),
        };
      } catch (_) {
        feedbackSummary = {
          total: 0,
          newCount: 0,
          featureRequestCount: 0,
          bugReportCount: 0,
          averageRating: 0,
        };
      }

      res.render("admin/dashboard", {
        title: "Admin Dashboard",
        applications,
        contacts,
        latestAnnouncement,
        adminAnnouncements,
        isInternalWorker,
        isFullAdmin,
        canManageAllContacts,
        canAssignContacts,
        feedbackSummary,
        messages: req.flash(),
        nodeEnv: process.env.NODE_ENV,
        baseDomain: "managira.com",
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Error fetching dashboard data.");
      res.render("admin/dashboard", {
        title: "Admin Dashboard",
        applications: [],
        contacts: [],
        latestAnnouncement: null,
        adminAnnouncements: [],
        isInternalWorker: req.session.accountType === 'Internal Worker',
        isFullAdmin: req.session.accountType === 'Admin',
        canManageAllContacts: isAdminSideManager(req.session.accountType),
        canAssignContacts: req.session.accountType === 'Admin',
        feedbackSummary: {
          total: 0,
          newCount: 0,
          featureRequestCount: 0,
          bugReportCount: 0,
          averageRating: 0,
        },
        messages: req.flash(),
        nodeEnv: process.env.NODE_ENV,
        baseDomain: "managira.com",
        showFooterTopSection: true
      });
    }
  },

  createInternalContact: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      const userId = req.session.userId;
      if (!userId) {
        req.flash("error", "You must be signed in to add a contact.");
        return res.redirect("/admin");
      }

      const contactName = String(req.body.contact_name || "").trim();
      const orgName = String(req.body.organization_name || "").trim();
      const apptSetRaw = String(req.body.appointment_set || "").toLowerCase();
      const appointmentSet = apptSetRaw === "yes" || apptSetRaw === "true" || apptSetRaw === "on" || apptSetRaw === "1";
      const apptAtRaw = String(req.body.appointment_at || "").trim();
      const notes = String(req.body.notes || "").trim();

      if (!contactName) {
        req.flash("error", "Contact name is required.");
        return res.redirect("/admin");
      }

      let appointmentAt = null;
      if (appointmentSet && apptAtRaw) {
        const parsed = new Date(apptAtRaw);
        if (!Number.isNaN(parsed.getTime())) {
          appointmentAt = parsed;
        }
      }

      await db.query(
        `INSERT INTO internal_contacts
          (created_by_user_id, contact_name, organization_name, appointment_set, appointment_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          contactName,
          orgName || null,
          appointmentSet,
          appointmentAt,
          notes || null,
        ]
      );

      req.flash("success", "Contact saved.");
      return res.redirect("/admin");
    } catch (error) {
      req.flash("error", "Failed to save contact.");
      return res.redirect("/admin");
    }
  },

  toggleInternalContactFollowUp: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        req.flash("error", "Invalid contact.");
        return res.redirect("/admin");
      }

      const userId = req.session.userId;
      const isPrivileged = isAdminSideManager(req.session.accountType);

      // Internal Worker may only update their own contacts; full admins may update any.
      const ownership = await db.query(
        `SELECT created_by_user_id, assigned_to_user_id, followed_up FROM internal_contacts WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!ownership.rows.length) {
        req.flash("error", "Contact not found.");
        return res.redirect("/admin");
      }
      if (
        !isPrivileged &&
        ownership.rows[0].created_by_user_id !== userId &&
        ownership.rows[0].assigned_to_user_id !== userId &&
        !(await hasExtraContactGrant(userId, id))
      ) {
        req.flash("error", "You can only update your own or assigned contacts.");
        return res.redirect("/admin");
      }

      const nextValue = !ownership.rows[0].followed_up;
      await db.query(
        `UPDATE internal_contacts
         SET followed_up = $2,
             followed_up_at = CASE WHEN $2 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, nextValue]
      );

      req.flash("success", nextValue ? "Marked as followed up." : "Follow-up cleared.");
      return res.redirect("/admin");
    } catch (error) {
      req.flash("error", "Failed to update contact.");
      return res.redirect("/admin");
    }
  },

  toggleInternalContactJoined: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        req.flash("error", "Invalid contact.");
        return res.redirect("/admin");
      }

      const userId = req.session.userId;
      const isPrivileged = isAdminSideManager(req.session.accountType);

      const ownership = await db.query(
        `SELECT created_by_user_id, assigned_to_user_id, joined FROM internal_contacts WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!ownership.rows.length) {
        req.flash("error", "Contact not found.");
        return res.redirect("/admin");
      }
      if (
        !isPrivileged &&
        ownership.rows[0].created_by_user_id !== userId &&
        ownership.rows[0].assigned_to_user_id !== userId &&
        !(await hasExtraContactGrant(userId, id))
      ) {
        req.flash("error", "You can only update your own or assigned contacts.");
        return res.redirect("/admin");
      }

      const nextValue = !ownership.rows[0].joined;
      await db.query(
        `UPDATE internal_contacts
         SET joined = $2,
             joined_at = CASE WHEN $2 = TRUE THEN CURRENT_TIMESTAMP ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, nextValue]
      );

      req.flash("success", nextValue ? "Marked as joined Managira." : "Joined status cleared.");
      return res.redirect("/admin");
    } catch (error) {
      req.flash("error", "Failed to update contact.");
      return res.redirect("/admin");
    }
  },

  deleteInternalContact: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        req.flash("error", "Invalid contact.");
        return res.redirect("/admin");
      }

      const userId = req.session.userId;
      const isPrivileged = isAdminSideManager(req.session.accountType);

      const ownership = await db.query(
        `SELECT created_by_user_id FROM internal_contacts WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!ownership.rows.length) {
        req.flash("error", "Contact not found.");
        return res.redirect("/admin");
      }
      if (!isPrivileged && ownership.rows[0].created_by_user_id !== userId) {
        req.flash("error", "You can only delete your own contacts.");
        return res.redirect("/admin");
      }

      await db.query(
        `UPDATE internal_contacts
         SET deleted_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );
      req.flash("success", "Contact moved to Super Admin trash.");
      return res.redirect("/admin");
    } catch (error) {
      req.flash("error", "Failed to delete contact.");
      return res.redirect("/admin");
    }
  },

  appendInternalContactNote: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        req.flash("error", "Invalid contact.");
        return res.redirect("/admin");
      }

      const userId = req.session.userId;
      const isPrivileged = isAdminSideManager(req.session.accountType);

      const newNote = String(req.body.note || "").trim();
      if (!newNote) {
        req.flash("error", "Note cannot be empty.");
        return res.redirect("/admin");
      }
      if (newNote.length > 2000) {
        req.flash("error", "Note is too long (max 2000 characters).");
        return res.redirect("/admin");
      }

      const ownership = await db.query(
        `SELECT created_by_user_id, assigned_to_user_id, notes FROM internal_contacts WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!ownership.rows.length) {
        req.flash("error", "Contact not found.");
        return res.redirect("/admin");
      }
      if (
        !isPrivileged &&
        ownership.rows[0].created_by_user_id !== userId &&
        ownership.rows[0].assigned_to_user_id !== userId &&
        !(await hasExtraContactGrant(userId, id))
      ) {
        req.flash("error", "You can only update your own or assigned contacts.");
        return res.redirect("/admin");
      }

      // Prefix the new note with a timestamp + author name so the
      // running history is readable.
      let authorLabel = "Unknown";
      try {
        const u = await db.query(
          `SELECT first_name, last_name, account_type FROM users WHERE user_id = $1`,
          [userId]
        );
        if (u.rows.length) {
          const f = (u.rows[0].first_name || "").trim();
          const l = (u.rows[0].last_name || "").trim();
          const name = `${f} ${l}`.trim() || "Unknown";
          authorLabel = u.rows[0].account_type ? `${name} (${u.rows[0].account_type})` : name;
        }
      } catch (_) {}

      const stamp = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const header = `— ${stamp} · ${authorLabel}`;
      const existing = (ownership.rows[0].notes || "").trim();
      const merged = existing
        ? `${existing}\n\n${header}\n${newNote}`
        : `${header}\n${newNote}`;

      await db.query(
        `UPDATE internal_contacts
         SET notes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, merged]
      );

      // Record current user as a contributor, then notify everyone who should know
      try {
        // 1. Stamp the current user as a contributor (idempotent)
        await db.query(
          `INSERT INTO internal_contact_note_contributors (contact_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (contact_id, user_id) DO NOTHING`,
          [id, Number(userId)]
        );

        // 2. Collect owner/assignee + all previous contributors, excluding the current user
        const creatorId = ownership.rows[0].created_by_user_id;
        const assigneeId = ownership.rows[0].assigned_to_user_id;
        const recipientRows = await db.query(
          `SELECT DISTINCT u.user_id, u.first_name, u.last_name, u.email
           FROM users u
           WHERE u.email IS NOT NULL
             AND u.user_id != $1
             AND (
               u.user_id = $2
               OR u.user_id = $4
               OR EXISTS (
                 SELECT 1 FROM internal_contact_note_contributors c
                 WHERE c.contact_id = $3 AND c.user_id = u.user_id
               )
             )`,
          [Number(userId), creatorId, id, assigneeId]
        );

        if (recipientRows.rows.length) {
          const contactRow = await db.query(
            `SELECT contact_name FROM internal_contacts WHERE id = $1`,
            [id]
          );
          const contactName = contactRow.rows[0]?.contact_name || `Contact #${id}`;
          const appBaseUrl = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
          const respondUrl = `${appBaseUrl}/admin#contactsListWidget`;

          for (const recipient of recipientRows.rows) {
            const recipientName = `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim() || recipient.email;
            const isCreator = creatorId && Number(recipient.user_id) === Number(creatorId);
            const isAssignee = assigneeId && Number(recipient.user_id) === Number(assigneeId);
            const roleNote = isCreator
              ? 'You are receiving this because you own this contact.'
              : (isAssignee
                ? 'You are receiving this because this contact is assigned to you.'
                : 'You are receiving this because you previously contributed a note on this contact.');

            const html = renderCleanEmail({
              title: "New Note on Your Contact",
              greeting: `Hi <strong>${recipientName}</strong>,`,
              paragraphs: [
                `A new note has been added to contact <strong>${contactName}</strong> by <strong>${authorLabel}</strong>.`,
              ],
              details: [
                { label: "Contact", value: contactName },
                { label: "Note", value: newNote },
                { label: "Added by", value: authorLabel },
                { label: "Date", value: stamp },
              ],
              cta: { url: respondUrl, text: 'Respond to This Note' },
              note: `${roleNote} Log in to Managira to view the full note history.`,
            });

            const mailOptions = {
              from: process.env.NOTIFY_EMAIL_USER,
              to: recipient.email,
              subject: `New note on contact: ${contactName}`,
              html,
              skipMxCheck: true,
              attachments: [
                {
                  filename: "managira.png",
                  path: require("path").join(__dirname, "../public/images/managira.png"),
                  cid: "managira_logo",
                },
              ],
            };

            sendEmailInBackground(mailOptions, "Contact Note Notification");
            console.log(`[ContactNote] Notification queued to ${recipient.email} (contact #${id})`);
          }
        }
      } catch (err) {
        console.error("[ContactNote] Email notification error:", err.message);
        // Email failure must never break the main flow
      }

      req.flash("success", "Note added.");
      return res.redirect("/admin");
    } catch (error) {
      req.flash("error", "Failed to add note.");
      return res.redirect("/admin");
    }
  },

  getInternalContactAssigneeOptions: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      if (req.session.accountType !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Only admins can assign contacts.' });
      }

      const users = await fetchAdminSideUsers();
      return res.json({ success: true, users });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to load assignees.' });
    }
  },

  assignInternalContact: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);

      if (req.session.accountType !== 'Admin') {
        const message = 'Only admins can assign contacts.';
        if (isAjaxRequest(req)) {
          return res.status(403).json({ success: false, message });
        }
        req.flash('error', message);
        return res.redirect('/admin');
      }

      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        const message = 'Invalid contact.';
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message });
        }
        req.flash('error', message);
        return res.redirect('/admin');
      }

      const rawAssignee = req.body.assignee_user_id;
      const assigneeUserId = rawAssignee === '' || rawAssignee === null || rawAssignee === undefined
        ? null
        : Number.parseInt(rawAssignee, 10);

      if (rawAssignee !== '' && rawAssignee !== null && rawAssignee !== undefined && !Number.isInteger(assigneeUserId)) {
        const message = 'Invalid assignee.';
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message });
        }
        req.flash('error', message);
        return res.redirect('/admin');
      }

      const contactResult = await db.query(
        `SELECT id, created_by_user_id FROM internal_contacts WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!contactResult.rows.length) {
        const message = 'Contact not found.';
        if (isAjaxRequest(req)) {
          return res.status(404).json({ success: false, message });
        }
        req.flash('error', message);
        return res.redirect('/admin');
      }

      let assigneeRow = null;
      if (assigneeUserId !== null) {
        const assigneeResult = await db.query(
          `SELECT user_id, first_name, last_name, email, account_type
           FROM users
           WHERE user_id = $1
             AND account_type IN ('Admin', 'Mini Admin', 'Internal Worker')`,
          [assigneeUserId]
        );
        if (!assigneeResult.rows.length) {
          const message = 'Assignee not found.';
          if (isAjaxRequest(req)) {
            return res.status(404).json({ success: false, message });
          }
          req.flash('error', message);
          return res.redirect('/admin');
        }
        assigneeRow = assigneeResult.rows[0];
      }

      await db.query(
        `UPDATE internal_contacts
         SET assigned_to_user_id = $2::int,
             assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, assigneeUserId]
      );

      const label = assigneeRow
        ? `${`${assigneeRow.first_name || ''} ${assigneeRow.last_name || ''}`.trim() || assigneeRow.email || `User ${assigneeRow.user_id}`}${formatAdminSideRoleShort(assigneeRow.account_type) ? ` (${formatAdminSideRoleShort(assigneeRow.account_type)})` : ''}`
        : null;

      if (isAjaxRequest(req)) {
        return res.json({
          success: true,
          message: assigneeRow ? 'Assignee saved.' : 'Assignee cleared.',
          assignee: assigneeRow ? {
            user_id: assigneeRow.user_id,
            label,
            account_type: assigneeRow.account_type,
          } : null,
        });
      }

      req.flash('success', assigneeRow ? 'Assignee saved.' : 'Assignee cleared.');
      return res.redirect('/admin');
    } catch (error) {
      if (isAjaxRequest(req)) {
        return res.status(500).json({ success: false, message: 'Failed to save assignee.' });
      }
      req.flash('error', 'Failed to save assignee.');
      return res.redirect('/admin');
    }
  },

  restoreInternalContact: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);
      const id = Number.parseInt(req.body.contactId || req.params.id, 10);
      if (!Number.isInteger(id)) {
        req.flash('error', 'Invalid contact.');
        return res.redirect('/admin/superDashboard');
      }
      const result = await db.query(
        `UPDATE internal_contacts
         SET deleted_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id]
      );
      if (!result.rowCount) {
        req.flash('error', 'Contact not found in trash.');
      } else {
        req.flash('success', 'Contact restored.');
      }
      return res.redirect('/admin/superDashboard');
    } catch (error) {
      req.flash('error', 'Failed to restore contact.');
      return res.redirect('/admin/superDashboard');
    }
  },

  permanentlyDeleteInternalContact: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);
      const id = Number.parseInt(req.body.contactId || req.params.id, 10);
      if (!Number.isInteger(id)) {
        req.flash('error', 'Invalid contact.');
        return res.redirect('/admin/superDashboard');
      }
      const result = await db.query(
        `DELETE FROM internal_contacts
         WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id]
      );
      if (!result.rowCount) {
        req.flash('error', 'Contact not found in trash.');
      } else {
        req.flash('success', 'Contact permanently deleted.');
      }
      return res.redirect('/admin/superDashboard');
    } catch (error) {
      req.flash('error', 'Failed to permanently delete contact.');
      return res.redirect('/admin/superDashboard');
    }
  },

  getAdminProfile: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);
      await ensureEmailPreferencesSchema(db);
      const userId = req.session.userId;
      if (!userId) {
        req.flash("error", "You must be signed in.");
        return res.redirect("/account/login");
      }

      const result = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, phone_number, organization_id,
                profile_image_url, org_role_description
         FROM users WHERE user_id = $1`,
        [userId]
      );
      if (!result.rows.length) {
        req.flash("error", "User not found.");
        return res.redirect("/admin");
      }

      // Admin-side platform users (Admin / Mini Admin / Internal Worker without
      // an organization) receive only operational/transactional emails, so the
      // toggle catalog is empty for them. Org-side users may also reach this
      // page if they were promoted, so we still respect role-based filtering.
      const profile = result.rows[0];
      const isPlatformAdmin = !profile.organization_id;
      const notificationPrefs = isPlatformAdmin
        ? []
        : getStaffPreferencesForRole(profile.account_type);
      const savedPrefs = notificationPrefs.length
        ? await getUserPreferenceMap(db, userId)
        : {};

      return res.render("admin/profile", {
        title: "Profile Settings",
        profile,
        notificationPrefs,
        savedPrefs,
        isPlatformAdmin,
        messages: req.flash(),
        showFooterTopSection: true,
      });
    } catch (error) {
      req.flash("error", "Failed to load profile.");
      return res.redirect("/admin");
    }
  },

  updateAdminProfile: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);
      const userId = req.session.userId;
      if (!userId) {
        req.flash("error", "You must be signed in.");
        return res.redirect("/account/login");
      }

      const firstName = String(req.body.firstName || "").trim();
      const lastName = String(req.body.lastName || "").trim();
      const phoneRaw = String(req.body.phoneNumber || "").trim();
      const bio = String(req.body.bio || "").trim().slice(0, 600) || null;

      if (!firstName || !lastName) {
        req.flash("error", "First and last name are required.");
        return res.redirect("/admin/profile");
      }
      if (firstName.length > 255 || lastName.length > 255) {
        req.flash("error", "Name is too long.");
        return res.redirect("/admin/profile");
      }

      // Light phone validation: digits, spaces, +, -, parentheses, max 50.
      let phoneNumber = null;
      if (phoneRaw) {
        if (phoneRaw.length > 50 || !/^[+()\-\s\d]{4,50}$/.test(phoneRaw)) {
          req.flash("error", "Please enter a valid phone number.");
          return res.redirect("/admin/profile");
        }
        phoneNumber = phoneRaw;
      }

      // Optional profile picture upload
      let imageUrl = null;
      if (req.file) {
        try {
          const result = await uploadToS3(req.file);
          imageUrl = result && (result.Location || result);
        } catch (e) {
          console.error('[updateAdminProfile upload]', e);
          req.flash('error', 'Profile picture could not be uploaded.');
          return res.redirect('/admin/profile');
        }
      }

      const sets = [
        'first_name = $1',
        'last_name = $2',
        'phone_number = $3',
        'org_role_description = $4',
        'updated_at = NOW()'
      ];
      const params = [firstName, lastName, phoneNumber, bio];
      if (imageUrl) {
        sets.splice(4, 0, `profile_image_url = $${params.length + 1}`);
        params.push(imageUrl);
      }
      params.push(userId);

      await db.query(
        `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${params.length}`,
        params
      );

      // Reflect in the live session so the header updates immediately.
      req.session.firstName = firstName;
      req.session.lastName = lastName;
      if (imageUrl) req.session.profileImageUrl = imageUrl;

      req.flash("success", "Profile updated successfully.");
      return res.redirect("/admin/profile");
    } catch (error) {
      req.flash("error", "Failed to update profile.");
      return res.redirect("/admin/profile");
    }
  },

  updateAdminNotificationPrefs: async (req, res) => {
    try {
      await ensureEmailPreferencesSchema(db);
      const userId = req.session.userId;
      if (!userId) {
        req.flash("error", "You must be signed in.");
        return res.redirect("/account/login");
      }

      const userResult = await db.query(
        `SELECT account_type, organization_id FROM users WHERE user_id = $1`,
        [userId]
      );
      if (!userResult.rows.length) {
        req.flash("error", "User not found.");
        return res.redirect("/admin/profile");
      }

      const { account_type, organization_id } = userResult.rows[0];
      const allowed = !organization_id
        ? []
        : getStaffPreferencesForRole(account_type).map(p => p.key);

      if (!allowed.length) {
        req.flash("error", "No notification preferences available for your account.");
        return res.redirect("/admin/profile");
      }

      // Checkboxes only post values when checked.
      const submittedRaw = req.body.preferences;
      const submitted = Array.isArray(submittedRaw)
        ? submittedRaw
        : (submittedRaw ? [submittedRaw] : []);

      await setUserPreferences(db, userId, allowed, submitted);

      req.flash("success", "Notification preferences saved.");
      return res.redirect("/admin/profile");
    } catch (error) {
      req.flash("error", "Failed to save notification preferences.");
      return res.redirect("/admin/profile");
    }
  },

  ensureAdmin: async (req, res, next) => {
    try {
      if (req.session.accountType !== "Admin") {
        req.flash("error", "You do not have permission to access this page.");
        return res.redirect("/admin");
      }
      next();
    } catch (error) {
            req.flash("error", "An error occurred during authorization.");
      res.redirect("/admin");
    }
  },

  createPromoPage: async (req, res) => {
    try {
      const promoCodesResult = await db.query(
        "SELECT * FROM promo_codes ORDER BY expiration_date DESC"
      );

      if (!promoCodesResult.rows.length) {
      }

      // Ensure promoCodes is always an array
      const promoCodes = promoCodesResult.rows || [];

      // Log what is being sent to the frontend

      res.render("admin/createPromo", {
        title: "Create Promo Code",
        promoCodes, // ✅ Ensure promoCodes is passed correctly
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to load promo codes.");
      res.redirect("/admin");
    }
  },

  createPromoCode: async (req, res) => {
    const { code, discount, expirationDate } = req.body;

    if (!code || !discount || !expirationDate) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/create-promo");
    }

    try {
      const existingPromo = await db.query(
        "SELECT * FROM promo_codes WHERE code = $1",
        [code.toUpperCase()]
      );
      if (existingPromo.rows.length > 0) {
        req.flash("error", "Promo code already exists.");
        return res.redirect("/admin/create-promo");
      }

      await db.query(
        "INSERT INTO promo_codes (code, discount_percentage, expiration_date, is_active) VALUES ($1, $2, $3, TRUE)",
        [code.toUpperCase(), discount, expirationDate]
      );

      req.flash("success", "Promo code created successfully!");
      return res.redirect("/admin/create-promo");
    } catch (error) {
            req.flash("error", "An error occurred. Please try again.");
      return res.redirect("/admin/create-promo");
    }
  },

  deletePromoCode: async (req, res) => {
    const { id } = req.params;

    if (!id) {
      req.flash("error", "Invalid promo code ID.");
      return res.redirect("/admin/create-promo");
    }

    try {
      await db.query("DELETE FROM promo_codes WHERE id = $1", [id]);

      req.flash("success", "Promo code deleted successfully!");
      return res.redirect("/admin/create-promo");
    } catch (error) {
            req.flash("error", "Failed to delete promo code.");
      return res.redirect("/admin/create-promo");
    }
  },

  holdOrganization: async (req, res) => {
    if (req.session?.accountType !== 'Admin') {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.redirect('/admin');
    }

    const { orgId } = req.body;
    try {
      // Update on_hold to true and record Admin in hold_by
      const result = await db.query(
        `UPDATE organizations 
                 SET on_hold = true, hold_by = 'Admin' 
                 WHERE organization_id = $1 
                 RETURNING email, first_name, last_name`,
        [orgId]
      );
      const organization = result.rows[0];

      // Invalidate cache after update
      cacheManager.invalidate('admin', 'organizations:list');

      req.flash("success", "Organization put on hold successfully by Admin.");

      // Send email notification to the organization
      await sendEmailNotification(
        organization.email,
        "Your organization has been put on hold",
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been temporarily put on hold. Please contact us at info@managira.com for further information.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
            req.flash("error", "Failed to put organization on hold.");
      res.redirect("/admin");
    }
  },

  resumeOrganization: async (req, res) => {
    if (req.session?.accountType !== 'Admin') {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.redirect('/admin');
    }

    const { orgId } = req.body;
    try {
      const result = await db.query(
        "UPDATE organizations SET on_hold = false WHERE organization_id = $1 RETURNING email, first_name, last_name",
        [orgId]
      );
      const organization = result.rows[0];

      // Invalidate cache after update
      cacheManager.invalidate('admin', 'organizations:list');

      // Notify search engines so the school page gets indexed quickly
      pingSearchEngines();

      req.flash("success", "Organization resumed successfully.");

      await sendEmailNotification(
        organization.email,
        "Your organization has been resumed",
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization's activities have been resumed. You can continue using the platform.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
            req.flash("error", "Failed to resume organization.");
      res.redirect("/admin");
    }
  },

  deleteOrganization: async (req, res) => {
    if (req.session?.accountType !== 'Admin') {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.redirect('/admin');
    }

    const { orgId } = req.body;
    try {
      await db.query("BEGIN");
      const result = await db.query(
        `UPDATE organizations
         SET deleted = true,
             on_hold = true,
             hold_by = 'Admin',
             scheduled_hold_date = NOW(),
             updated_at = NOW()
         WHERE organization_id = $1
         RETURNING email, first_name, last_name`,
        [orgId]
      );
      const organization = result.rows[0];

      if (!organization) {
        await db.query("ROLLBACK");
        req.flash("error", "Organization not found.");
        return res.redirect("/admin");
      }

      await db.query(
        "UPDATE stored_cards SET is_active = false, updated_at = NOW() WHERE organization_id = $1",
        [orgId]
      );

      await db.query("COMMIT");

      // Invalidate cache after update
      cacheManager.invalidate('admin', 'organizations:list');

      req.flash("success", "Organization deleted successfully.");

      await sendEmailNotification(
        organization.email,
        "Your organization has been deleted",
        `Dear ${organization.first_name} ${organization.last_name},\n\nYour organization has been deleted from our records. If you believe this is a mistake, please contact us at info@managira.com.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch (_) {}
            req.flash("error", "Failed to delete organization.");
      res.redirect("/admin");
    }
  },

  superAdminDashboard: async (req, res) => {
    try {
      // Fetch deleted organizations
      const deletedAccounts = await db.query(`
                SELECT organization_id, first_name, last_name, email, organization_name, organization_address, organization_country, organization_province, organization_phone, proof_of_existence_1, proof_of_existence_2
                FROM organizations
                WHERE deleted = true
            `);

      // Fetch deleted hubs
      const deletedHubs = await db.query(`
                SELECT h.hub_id,
                       h.hub_name,
                       h.hub_nickname,
                       h.hub_email,
                       h.first_name,
                       h.last_name,
                       h.hub_phone,
                       h.hub_address,
                       h.on_hold,
                       h.created_at,
                       h.updated_at,
                       COUNT(o.organization_id)::int AS linked_organizations_count,
                       COALESCE(
                         JSON_AGG(
                           JSON_BUILD_OBJECT(
                             'organization_id', o.organization_id,
                             'organization_name', o.organization_name,
                             'email', o.email,
                             'on_hold', o.on_hold,
                             'is_hub_member', o.is_hub_member
                           )
                           ORDER BY o.organization_name
                         ) FILTER (WHERE o.organization_id IS NOT NULL),
                         '[]'
                       ) AS linked_organizations
                FROM managira_hubs h
                LEFT JOIN organizations o ON o.hub_id = h.hub_id AND o.deleted = false
                WHERE h.deleted = true
                GROUP BY h.hub_id, h.hub_name, h.hub_nickname, h.hub_email, h.first_name, h.last_name,
                         h.hub_phone, h.hub_address, h.on_hold, h.created_at, h.updated_at
                ORDER BY h.updated_at DESC, h.created_at DESC
            `);

      // Fetch deleted threads
      const deletedThreads = await db.query(`
                SELECT ht.id AS thread_id, ht.name, ht.organization, ht.email, ht.phone, 
                       ARRAY_AGG(hm.message ORDER BY hm.created_at ASC) AS messages,
                       ht.is_resolved, ht.created_at, ht.last_updated
                FROM help_threads ht
                JOIN help_messages hm ON ht.id = hm.thread_id
                WHERE ht.is_deleted = true
                GROUP BY ht.id
                ORDER BY ht.id ASC
            `);

      // Fetch soft-deleted internal contacts (referrals)
      let deletedContacts = { rows: [] };
      try {
        await ensureInternalWorkerSchema(db);
        deletedContacts = await db.query(`
          SELECT ic.id, ic.contact_name, ic.organization_name,
                 ic.appointment_set, ic.appointment_at, ic.notes,
                 ic.followed_up, ic.followed_up_at, ic.joined, ic.joined_at,
                 ic.created_at, ic.deleted_at,
                 creator.first_name AS creator_first_name,
                 creator.last_name  AS creator_last_name,
                 creator.account_type AS creator_account_type,
                 assignee.first_name AS assignee_first_name,
                 assignee.last_name  AS assignee_last_name,
                 assignee.account_type AS assignee_account_type
          FROM internal_contacts ic
          LEFT JOIN users creator ON creator.user_id = ic.created_by_user_id
          LEFT JOIN users assignee ON assignee.user_id = ic.assigned_to_user_id
          WHERE ic.deleted_at IS NOT NULL
          ORDER BY ic.deleted_at DESC
          LIMIT 500
        `);
      } catch (_) {
        deletedContacts = { rows: [] };
      }

      res.render("admin/superDashboard", {
        title: "Super Admin Dashboard",
        deletedAccounts: deletedAccounts.rows, // Pass deleted accounts
        deletedHubs: deletedHubs.rows,
        deletedTickets: deletedThreads.rows, // Pass deleted threads
        deletedContacts: deletedContacts.rows,
        messages: req.flash(), // Pass flash messages
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to fetch data for the Super Admin Dashboard.");
      res.render("admin/superDashboard", {
        title: "Super Admin Dashboard",
        deletedAccounts: [], // Default to an empty array if the query fails
        deletedHubs: [],
        deletedTickets: [], // Default to an empty array if the query fails
        deletedContacts: [],
        messages: req.flash(),
        showFooterTopSection: true
      });
    }
  },

  superDashboardUsersAjax: async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const search = String(req.query.q || "").trim();
      const status = String(req.query.status || "all").trim().toLowerCase();
      const role = String(req.query.role || "all").trim();
      const organizationId = String(req.query.organizationId || "all").trim();
      const tab = String(req.query.tab || "all").trim().toLowerCase();

      const conditions = [];
      const values = [];

      const MANAGIRA_WORKER_TYPES = ['Admin', 'Mini Admin', 'Internal Worker', 'super_admin'];
      if (tab === 'managira_workers') {
        values.push(MANAGIRA_WORKER_TYPES);
        conditions.push(`u.account_type::text = ANY($${values.length}::text[])`);
      } else if (tab === 'school_users') {
        values.push(MANAGIRA_WORKER_TYPES);
        conditions.push(`NOT (u.account_type::text = ANY($${values.length}::text[]))`);
      }

      if (search) {
        values.push(`%${search}%`);
        const idx = values.length;
        conditions.push(`(
          u.first_name ILIKE $${idx}
          OR u.last_name ILIKE $${idx}
          OR (u.first_name || ' ' || u.last_name) ILIKE $${idx}
          OR u.email ILIKE $${idx}
          OR COALESCE(o.organization_name, '') ILIKE $${idx}
        )`);
      }

      if (status === "active") {
        conditions.push("u.on_hold = false");
      } else if (status === "on_hold") {
        conditions.push("u.on_hold = true");
      }

      if (role && role !== "all") {
        values.push(role);
        conditions.push(`u.account_type::text = $${values.length}`);
      }

      if (organizationId === "none") {
        conditions.push("u.organization_id IS NULL");
      } else {
        const parsedOrganizationId = parseOptionalInteger(organizationId);
        if (parsedOrganizationId !== null) {
          values.push(parsedOrganizationId);
          conditions.push(`u.organization_id = $${values.length}`);
        }
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const usersResult = await db.query(
        `SELECT u.user_id,
                u.first_name,
                u.last_name,
                u.email,
                u.phone_number,
                u.account_type::text AS account_type,
                u.on_hold,
                u.organization_id,
                u.created_at,
                u.updated_at,
                o.organization_name,
                COALESCE(o.deleted, false) AS organization_deleted,
                COALESCE(o.on_hold, false) AS organization_on_hold
         FROM users u
         LEFT JOIN organizations o ON o.organization_id = u.organization_id
         ${whereClause}
         ORDER BY COALESCE(o.organization_name, 'zzzzzz'), u.first_name ASC, u.last_name ASC, u.user_id ASC`,
        values
      );

      const [rolesResult, organizationsResult] = await Promise.all([
        db.query(
          `SELECT DISTINCT account_type::text AS account_type
           FROM users
           ORDER BY account_type::text ASC`
        ),
        db.query(
          `SELECT organization_id, organization_name, deleted, on_hold
           FROM organizations
           ORDER BY organization_name ASC`
        ),
      ]);

      const users = usersResult.rows.map((row) => ({
        userId: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        fullName: buildUserFullName(row),
        email: row.email,
        phoneNumber: row.phone_number || '',
        accountType: row.account_type,
        isManagiraWorker: isManagiraWorkerAccountType(row.account_type),
        onHold: !!row.on_hold,
        organizationId: row.organization_id,
        schools: row.organization_id
          ? [
              {
                organizationId: row.organization_id,
                name: row.organization_name || "Unknown school",
                deleted: !!row.organization_deleted,
                onHold: !!row.organization_on_hold,
              },
            ]
          : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return res.json({
        success: true,
        users,
        summary: {
          total: users.length,
          active: users.filter((user) => !user.onHold).length,
          onHold: users.filter((user) => user.onHold).length,
          schoolLinked: users.filter((user) => user.schools.length > 0).length,
          platform: users.filter((user) => user.schools.length === 0).length,
        },
        filters: {
          current: { search, status, role, organizationId, tab },
          roles: rolesResult.rows.map((row) => row.account_type).filter(Boolean),
          organizations: organizationsResult.rows.map((row) => ({
            organizationId: row.organization_id,
            organizationName: row.organization_name,
            deleted: !!row.deleted,
            onHold: !!row.on_hold,
          })),
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to load users.",
      });
    }
  },

  getUserPermissionsAjax: async (req, res) => {
    // Always hit the server for the latest grant state — a stale browser
    // cache here is what makes freshly-saved checkboxes look unchecked
    // after a page refresh.
    res.set('Cache-Control', 'no-store');

    const userId = parseOptionalInteger(req.params.userId);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid user selected." });
    }

    try {
      const userResult = await db.query(
        `SELECT user_id, account_type::text AS account_type FROM users WHERE user_id = $1`,
        [userId]
      );
      if (!userResult.rows.length) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      if (!isManagiraWorkerAccountType(userResult.rows[0].account_type)) {
        return res.status(400).json({ success: false, message: "Access grants only apply to Managira Workers." });
      }

      // Admin / Mini Admin already have unrestricted access to every contact,
      // every school, and the Team Org Chart, regardless of any grant rows —
      // reflect that as their real, active state rather than showing "own"/off.
      if (isAdminSideManager(userResult.rows[0].account_type)) {
        return res.json({
          success: true,
          isFullAdmin: true,
          contactAccessMode: 'all',
          canViewOrgChart: true,
          canViewBilling: true,
          canViewSecurity: true,
          canViewPaygira: true,
          extraWorkers: [],
          extraOrganizations: [],
        });
      }

      const [flagResult, workersResult, orgsResult] = await Promise.all([
        db.query(
          `SELECT can_view_org_chart, contact_access_mode, can_view_billing, can_view_security, can_view_paygira
           FROM user_feature_flags WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT u.user_id, u.first_name, u.last_name, u.account_type::text AS account_type
           FROM user_extra_worker_contacts p
           JOIN users u ON u.user_id = p.source_user_id
           WHERE p.user_id = $1
           ORDER BY u.first_name ASC, u.last_name ASC`,
          [userId]
        ),
        db.query(
          `SELECT o.organization_id, o.organization_name
           FROM user_extra_organizations p
           JOIN organizations o ON o.organization_id = p.organization_id
           WHERE p.user_id = $1
           ORDER BY o.organization_name ASC`,
          [userId]
        ),
      ]);

      return res.json({
        success: true,
        isFullAdmin: false,
        contactAccessMode: flagResult.rows.length ? flagResult.rows[0].contact_access_mode : 'own',
        canViewOrgChart: !!(flagResult.rows.length && flagResult.rows[0].can_view_org_chart),
        canViewBilling: !!(flagResult.rows.length && flagResult.rows[0].can_view_billing),
        canViewSecurity: !!(flagResult.rows.length && flagResult.rows[0].can_view_security),
        canViewPaygira: !!(flagResult.rows.length && flagResult.rows[0].can_view_paygira),
        extraWorkers: workersResult.rows.map((row) => ({
          id: row.user_id,
          name: buildUserFullName(row),
          accountType: row.account_type,
        })),
        extraOrganizations: orgsResult.rows.map((row) => ({
          id: row.organization_id,
          name: row.organization_name,
        })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to load permissions." });
    }
  },

  updateUserPermissionsAjax: async (req, res) => {
    const userId = parseOptionalInteger(req.params.userId);
    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid user selected." });
    }
    if (req.session?.accountType !== 'Admin') {
      return res.status(403).json({ success: false, message: "Only Admins can manage access grants." });
    }
    if (Number(req.session.userId) === Number(userId)) {
      return res.status(400).json({ success: false, message: "You cannot change your own access grants here." });
    }

    const contactAccessMode = ['own', 'all', 'selected'].includes(req.body.contactAccessMode)
      ? req.body.contactAccessMode
      : 'own';
    const extraWorkerIds = Array.isArray(req.body.extraWorkerIds)
      ? req.body.extraWorkerIds.map((id) => parseOptionalInteger(id)).filter((id) => id !== null && id !== userId)
      : [];
    const extraOrganizationIds = Array.isArray(req.body.extraOrganizationIds)
      ? req.body.extraOrganizationIds.map((id) => parseOptionalInteger(id)).filter((id) => id !== null)
      : [];
    const canViewOrgChart = !!req.body.canViewOrgChart;
    const canViewBilling = !!req.body.canViewBilling;
    const canViewSecurity = !!req.body.canViewSecurity;
    const canViewPaygira = !!req.body.canViewPaygira;

    try {
      const userResult = await db.query(
        `SELECT account_type::text AS account_type FROM users WHERE user_id = $1`,
        [userId]
      );
      if (!userResult.rows.length) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      if (!isManagiraWorkerAccountType(userResult.rows[0].account_type)) {
        return res.status(400).json({ success: false, message: "Access grants only apply to Managira Workers." });
      }
      if (isAdminSideManager(userResult.rows[0].account_type)) {
        return res.status(400).json({
          success: false,
          message: "Admins already have full access to every contact, every school, and the Team Org Chart. There is nothing to grant or revoke here.",
        });
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        await client.query(`DELETE FROM user_extra_worker_contacts WHERE user_id = $1`, [userId]);
        if (contactAccessMode === 'selected') {
          for (const sourceUserId of extraWorkerIds) {
            await client.query(
              `INSERT INTO user_extra_worker_contacts (user_id, source_user_id, granted_by)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id, source_user_id) DO NOTHING`,
              [userId, sourceUserId, req.session.userId]
            );
          }
        }

        await client.query(`DELETE FROM user_extra_organizations WHERE user_id = $1`, [userId]);
        for (const organizationId of extraOrganizationIds) {
          await client.query(
            `INSERT INTO user_extra_organizations (user_id, organization_id, granted_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, organization_id) DO NOTHING`,
            [userId, organizationId, req.session.userId]
          );
        }

        await client.query(
          `INSERT INTO user_feature_flags
             (user_id, can_view_org_chart, contact_access_mode, can_view_billing, can_view_security, can_view_paygira, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (user_id) DO UPDATE
             SET can_view_org_chart = EXCLUDED.can_view_org_chart,
                 contact_access_mode = EXCLUDED.contact_access_mode,
                 can_view_billing = EXCLUDED.can_view_billing,
                 can_view_security = EXCLUDED.can_view_security,
                 can_view_paygira = EXCLUDED.can_view_paygira,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
          [userId, canViewOrgChart, contactAccessMode, canViewBilling, canViewSecurity, canViewPaygira, req.session.userId]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return res.json({ success: true, message: "Access updated." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to update permissions." });
    }
  },

  // Step-up password re-entry before switching into another school's
  // dashboard (Admin, Mini Admin, Internal Worker — everyone but super_admin).
  orgSwitchConfirmGet: (req, res) => {
    const redirectUrl = String(req.query.redirect || "/admin");
    if (!/^\/admin\/org\/\d+(\?.*)?$/.test(redirectUrl)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin");
    }
    res.render("admin/confirmPassword", {
      title: "Confirm Password",
      redirectUrl,
      messages: req.flash(),
      layout: false,
    });
  },

  orgSwitchConfirmPost: async (req, res) => {
    const { password, redirectUrl } = req.body;
    const safeRedirectUrl = /^\/admin\/org\/\d+(\?.*)?$/.test(String(redirectUrl || "")) ? redirectUrl : "/admin";
    const userId = req.session.userId;

    try {
      const result = await db.query(`SELECT password FROM users WHERE user_id = $1`, [userId]);
      const match = result.rows.length && (await bcrypt.compare(String(password || ""), result.rows[0].password));

      if (!match) {
        req.flash("error", "Incorrect password. Please try again.");
        return res.redirect(`/admin/confirm-password?redirect=${encodeURIComponent(safeRedirectUrl)}`);
      }

      const organizationId = parseInt(safeRedirectUrl.match(/\/admin\/org\/(\d+)/)?.[1], 10);
      if (Number.isInteger(organizationId)) {
        const verified = new Set(req.session.orgSwitchVerifiedOrgIds || []);
        verified.add(organizationId);
        req.session.orgSwitchVerifiedOrgIds = Array.from(verified);
      }

      return res.redirect(safeRedirectUrl);
    } catch (error) {
      req.flash("error", "An unexpected error occurred. Please try again.");
      return res.redirect(`/admin/confirm-password?redirect=${encodeURIComponent(safeRedirectUrl)}`);
    }
  },

  searchManagiraWorkersAjax: async (req, res) => {
    const search = String(req.query.q || "").trim();
    const excludeUserId = parseOptionalInteger(req.query.excludeUserId);

    try {
      const values = ['%' + search + '%'];
      let query = `
        SELECT user_id, first_name, last_name, email, account_type::text AS account_type
        FROM users
        WHERE account_type::text = ANY($2::text[])
          AND (first_name ILIKE $1 OR last_name ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1 OR email ILIKE $1)
      `;
      values.push(['Admin', 'Mini Admin', 'Internal Worker', 'super_admin']);

      if (excludeUserId) {
        values.push(excludeUserId);
        query += ` AND user_id != $${values.length}`;
      }
      query += ` ORDER BY first_name ASC, last_name ASC LIMIT 20`;

      const result = await db.query(query, values);
      return res.json({
        success: true,
        workers: result.rows.map((row) => ({
          id: row.user_id,
          name: buildUserFullName(row),
          email: row.email,
          accountType: row.account_type,
        })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to search workers." });
    }
  },

  searchOrganizationsAjax: async (req, res) => {
    const search = String(req.query.q || "").trim();

    try {
      const result = await db.query(
        `SELECT organization_id, organization_name
         FROM organizations
         WHERE deleted = false
           AND ($1 = '' OR organization_name ILIKE $2)
         ORDER BY organization_name ASC
         LIMIT 20`,
        [search, `%${search}%`]
      );
      return res.json({
        success: true,
        organizations: result.rows.map((row) => ({
          id: row.organization_id,
          name: row.organization_name,
        })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to search schools." });
    }
  },

  superDashboardUserStatusAjax: async (req, res) => {
    const userId = parseOptionalInteger(req.params.userId);
    const action = String(req.body.status || "").trim().toLowerCase();

    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid user selected." });
    }

    if (!["hold", "resume"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid status action." });
    }

    if (req.session?.userId && Number(req.session.userId) === Number(userId)) {
      return res.status(400).json({ success: false, message: "You cannot change your own hold status here." });
    }

    try {
      const result = await db.query(
        `UPDATE users
         SET on_hold = $1, updated_at = NOW()
         WHERE user_id = $2
         RETURNING user_id, first_name, last_name, on_hold`,
        [action === "hold", userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const updatedUser = result.rows[0];
      return res.json({
        success: true,
        message: `${buildUserFullName(updatedUser)} has been ${updatedUser.on_hold ? "put on hold" : "resumed"}.`,
        user: {
          userId: updatedUser.user_id,
          onHold: !!updatedUser.on_hold,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to update user status." });
    }
  },

  superDashboardDeleteUserAjax: async (req, res) => {
    const userId = parseOptionalInteger(req.params.userId);

    if (!userId) {
      return res.status(400).json({ success: false, message: "Invalid user selected." });
    }

    try {
      const deletedUser = await deleteUserWithDependencies({
        userId,
        actorUserId: req.session?.userId,
      });

      return res.json({
        success: true,
        message: `${buildUserFullName(deletedUser)} was deleted successfully.`,
      });
    } catch (error) {
      const statusCode = error?.statusCode || (error?.code === "23503" ? 409 : 500);
      const message = await buildConstraintErrorMessage(
        error,
        userId,
        "Failed to delete this user.",
        "user"
      );

      return res.status(statusCode).json({
        success: false,
        message,
      });
    }
  },

  deleteAdminUser: async (req, res) => {
    const { userId } = req.params; // Ensure the userId is fetched correctly

    try {
      // Delete the user from the database
      await db.query(`DELETE FROM users WHERE user_id = $1`, [userId]);

      req.flash("success", "Admin user deleted successfully.");
      res.redirect("/admin/superSettings"); // Redirect back to the settings page
    } catch (error) {
            req.flash("error", "Failed to delete admin user.");
      res.redirect("/admin/superSettings");
    }
  },

  superAdminSettings: async (req, res) => {
    try {
      await ensureInternalWorkerSchema(db);
      // Fetch all admin-side users (Mini Admin, Admin, Internal Worker)
      const adminsResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, on_hold, phone_number,
                supervisor_user_id
                     FROM users
                     WHERE account_type IN ('Admin', 'Mini Admin', 'Internal Worker')
                     ORDER BY account_type, last_name, first_name`
      );

      // Build a quick id->user map for rendering supervisor names in the table
      const adminsById = {};
      adminsResult.rows.forEach((u) => { adminsById[u.user_id] = u; });

      res.render("admin/superSettings", {
        title: "Super Admin Settings",
        admins: adminsResult.rows,
        adminsById,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to fetch admin users.");
      res.render("admin/superSettings", {
        title: "Super Admin Settings",
        admins: [],
        adminsById: {},
        messages: req.flash(),
        showFooterTopSection: true
      });
    }
  },

  toggleAdminHoldStatus: async (req, res) => {
    const { userId } = req.body;

    try {
      // Toggle the hold status of the user
      const result = await db.query(
        `UPDATE users
                     SET on_hold = NOT on_hold
                     WHERE user_id = $1
                     RETURNING on_hold`,
        [userId]
      );

      const status = result.rows[0].on_hold ? "on hold" : "active";
      req.flash("success", `Admin user is now ${status}.`);
      res.redirect("/admin/superSettings");
    } catch (error) {
            req.flash("error", "Failed to update admin status.");
      res.redirect("/admin/superSettings");
    }
  },

  editAdminUserGet: async (req, res) => {
    const { userId } = req.params;

    try {
      // Fetch user details by userId
      const result = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type
                     FROM users
                     WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        req.flash("error", "Admin user not found.");
        return res.redirect("/admin/superSettings");
      }

      res.render("admin/editAdminUser", {
        title: "Edit Admin User",
        admin: result.rows[0],
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to load admin user details.");
      res.redirect("/admin/superSettings");
    }
  },

  editAdminUserPost: async (req, res) => {
    const { userId } = req.params;
    const { firstName, lastName, email, accountType } = req.body;

    try {
      await ensureInternalWorkerSchema(db);
      const ALLOWED_ROLES = ['Admin', 'Mini Admin', 'Internal Worker'];
      if (!ALLOWED_ROLES.includes(accountType)) {
        req.flash('error', 'Invalid role selected.');
        return res.redirect(`/admin/editAdminUser/${userId}`);
      }

      const currentUserResult = await db.query(
        `SELECT email FROM users WHERE user_id = $1`,
        [userId]
      );

      if (currentUserResult.rows.length === 0) {
        req.flash("error", "Admin user not found.");
        return res.redirect("/admin/superSettings");
      }

      const currentEmail = currentUserResult.rows[0].email;

      if (email !== currentEmail) {
        // 🔍 Check email in users table
        const userCheck = await db.query(
          `SELECT user_id FROM users WHERE email = $1 LIMIT 1`,
          [email]
        );

        if (userCheck.rows.length > 0) {
          req.flash("error", "This email is already in use by another user.");
          return res.redirect(`/admin/editAdminUser/${userId}`);
        }

        // 🔍 Check email in organizations table
        const orgCheck = await db.query(
          `SELECT organization_id FROM organizations WHERE email = $1 LIMIT 1`,
          [email]
        );

        if (orgCheck.rows.length > 0) {
          req.flash(
            "error",
            "This email is already in use by an organization."
          );
          return res.redirect(`/admin/editAdminUser/${userId}`);
        }
      }

      await db.query(
        `UPDATE users
                 SET first_name = $1, last_name = $2, email = $3, account_type = $4, updated_at = NOW()
                 WHERE user_id = $5`,
        [firstName, lastName, email, accountType, userId]
      );

      req.flash("success", "Admin user details updated successfully.");
      res.redirect("/admin/superSettings");
    } catch (error) {
            req.flash("error", "Failed to update admin user details.");
      res.redirect(`/admin/editAdminUser/${userId}`);
    }
  },

  resendAdminInvite: async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await db.query(
        `SELECT user_id, first_name, last_name, email
         FROM users WHERE user_id = $1`,
        [userId]
      );
      if (!result.rows.length) {
        req.flash("error", "Admin user not found.");
        return res.redirect("/admin/superSettings");
      }
      const user = result.rows[0];

      // Generate a new token (24h)
      const token = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const tokenExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.query(
        `UPDATE users
           SET reset_password_token = $1,
               reset_password_expires = $2,
               updated_at = NOW()
         WHERE user_id = $3`,
        [hashedToken, tokenExpiration, userId]
      );

      const baseUrl = req.protocol + "://" + req.get("host");
      const setPasswordUrl = `${baseUrl}/common/set-password?token=${token}`;

      await sendAdminInviteEmail(
        user.email,
        user.first_name,
        user.last_name,
        setPasswordUrl
      );

      req.flash(
        "success",
        `A new password setup link has been emailed to ${user.email}. It expires in 24 hours.`
      );
      return res.redirect(`/admin/editAdminUser/${userId}`);
    } catch (error) {
      req.flash("error", "Failed to resend the password setup email.");
      return res.redirect(`/admin/editAdminUser/${userId}`);
    }
  },

  createAdminUser: async (req, res) => {
    const { firstName, lastName, adminUsername, adminEmail, adminRole, supervisorUserId } =
      req.body;

    try {
      // Make sure the Internal Worker enum value exists before insert
      await ensureInternalWorkerSchema(db);

      // Validate role to one of the allowed admin-side roles
      const ALLOWED_ROLES = ['Admin', 'Mini Admin', 'Internal Worker'];
      if (!ALLOWED_ROLES.includes(adminRole)) {
        req.flash('error', 'Invalid role selected.');
        return res.redirect('/admin/superSettings');
      }

      // Optional supervisor: must be an existing admin-side user
      let supervisorId = null;
      if (supervisorUserId !== undefined && supervisorUserId !== '' && supervisorUserId !== null) {
        const parsed = parseInt(supervisorUserId, 10);
        if (Number.isFinite(parsed)) {
          const sup = await db.query(
            `SELECT user_id FROM users
              WHERE user_id = $1
                AND account_type IN ('Admin','Mini Admin','Internal Worker')`,
            [parsed]
          );
          if (sup.rows.length) supervisorId = parsed;
        }
      }

      // ✅ Check if the email exists in either users or organizations
      const emailCheckResult = await db.query(
        `
                  SELECT user_id FROM users WHERE email = $1
                  UNION
                  SELECT organization_id FROM organizations WHERE email = $1
                `,
        [adminEmail]
      );

      if (emailCheckResult.rows.length > 0) {
        req.flash(
          "error",
          "Email is already in use by an existing user or organization. Please choose a different email."
        );
        return res.redirect("/admin/superSettings");
      }

      // ✅ Generate a unique token for setting the password
      const token = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const tokenExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000); // Token expires in 24 hours

      // ✅ Insert the admin user without a password
      await db.query(
        `INSERT INTO users (first_name, last_name, email, account_type, username, supervisor_user_id, created_at, updated_at, reset_password_token, reset_password_expires)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, $8)`,
        [
          firstName,
          lastName,
          adminEmail,
          adminRole,
          adminUsername,
          supervisorId,
          hashedToken,
          tokenExpiration,
        ]
      );

      // ✅ Generate the password setup link
      const baseUrl = req.protocol + "://" + req.get("host");
      const setPasswordUrl = `${baseUrl}/common/set-password?token=${token}`;

      // ✅ Send the invite email
      await sendAdminInviteEmail(
        adminEmail,
        firstName,
        lastName,
        setPasswordUrl
      );

      req.flash(
        "success",
        "Admin user created successfully. Invitation sent to set their password."
      );
      res.redirect("/admin/superSettings");
    } catch (error) {
            req.flash("error", "Failed to create admin user.");
      res.redirect("/admin/superSettings");
    }
  },

  restoreOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      await db.query("BEGIN");
      const result = await db.query(
        `UPDATE organizations
         SET deleted = false,
             on_hold = false,
             hold_by = NULL,
             scheduled_hold_date = NULL,
             updated_at = NOW()
         WHERE organization_id = $1
         RETURNING email, first_name, last_name`,
        [orgId]
      );
      const organization = result.rows[0];

      if (!organization) {
        await db.query("ROLLBACK");
        req.flash("error", "Organization not found.");
        return res.redirect("/admin/superDashboard");
      }

      await db.query(
        "UPDATE stored_cards SET is_active = true, updated_at = NOW() WHERE organization_id = $1",
        [orgId]
      );

      await db.query("COMMIT");

      req.flash("success", "Organization restored successfully.");

      await sendEmailNotification(
        organization.email,
        "Your organization has been restored",
        `Dear ${organization.first_name} ${organization.last_name},\n\nWe apologize for any inconvenience caused. Your organization has been restored.\n\nBest regards,\nAdmin Team`
      );

      res.redirect("/admin/superDashboard");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch (_) {}
            req.flash("error", "Failed to restore organization.");
      res.redirect("/admin/superDashboard");
    }
  },

  // Display help messages page
  helpMessages: async (req, res) => {
    try {
      const threads = await db.query(`
                SELECT ht.id AS thread_id, ht.name, ht.organization, ht.email, ht.phone, 
                       ARRAY_AGG(hm.message ORDER BY hm.created_at ASC) AS messages,
                       ht.is_resolved, ht.is_deleted, ht.created_at, ht.last_updated
                FROM help_threads ht
                JOIN help_messages hm ON ht.id = hm.thread_id
                WHERE ht.is_resolved = false AND ht.is_deleted = false
                GROUP BY ht.id
                ORDER BY ht.id ASC
            `);

      res.render("admin/helpMessages", {
        title: "Help Messages",
        threads: threads.rows,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            res.status(500).send("Failed to fetch help messages.");
    }
  },

  feedbackInbox: async (req, res) => {
    try {
      await ensureUserFeedbackSchema(db);

      const feedbackResult = await db.query(
        `SELECT feedback_id, organization_id, user_id, user_name, user_role, organization_name,
                feedback_type, area, subject, message, rating, priority, status,
                created_at, updated_at
         FROM user_feedback
         ORDER BY created_at DESC, feedback_id DESC`
      );

      const feedbackItems = feedbackResult.rows.map((row) => ({
        ...row,
        feedback_id: Number(row.feedback_id || 0),
        organization_id: row.organization_id ? Number(row.organization_id) : null,
        user_id: row.user_id ? Number(row.user_id) : null,
        rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
      }));

      return res.render("admin/adminFeedback", {
        title: "Feedback",
        feedbackItems,
        feedbackStats: computeFeedbackSummary(feedbackItems),
        feedbackStatusOptions: FEEDBACK_STATUS_OPTIONS,
        messages: req.flash(),
        showFooterTopSection: true,
      });
    } catch (error) {
      req.flash("error", "Failed to load feedback.");
      return res.redirect("/admin");
    }
  },

  updateFeedbackStatus: async (req, res) => {
    const shouldReturnJson = wantsJsonResponse(req);
    const feedbackId = Number.parseInt(req.params.id, 10);
    const status = normalizeFeedbackStatus(req.body?.status);

    if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
      const errorMessage = "Invalid feedback ID.";
      if (shouldReturnJson) {
        return res.status(400).json({ success: false, error: errorMessage });
      }
      req.flash("error", errorMessage);
      return res.redirect("/admin/feedback");
    }

    if (!status) {
      const errorMessage = "Invalid feedback status.";
      if (shouldReturnJson) {
        return res.status(400).json({ success: false, error: errorMessage });
      }
      req.flash("error", errorMessage);
      return res.redirect("/admin/feedback");
    }

    try {
      await ensureUserFeedbackSchema(db);
      const updateResult = await db.query(
        `UPDATE user_feedback
         SET status = $2,
             updated_at = NOW()
         WHERE feedback_id = $1
         RETURNING feedback_id, status, updated_at`,
        [feedbackId, status]
      );

      if (updateResult.rows.length === 0) {
        const errorMessage = "Feedback entry not found.";
        if (shouldReturnJson) {
          return res.status(404).json({ success: false, error: errorMessage });
        }
        req.flash("error", errorMessage);
        return res.redirect("/admin/feedback");
      }

      if (shouldReturnJson) {
        return res.json({
          success: true,
          feedback: updateResult.rows[0],
          message: "Feedback status updated successfully.",
        });
      }

      req.flash("success", "Feedback status updated successfully.");
      return res.redirect("/admin/feedback");
    } catch (error) {
      if (shouldReturnJson) {
        return res.status(500).json({
          success: false,
          error: "Failed to update feedback status.",
        });
      }

      req.flash("error", "Failed to update feedback status.");
      return res.redirect("/admin/feedback");
    }
  },

  respondToMessage: async (req, res) => {
    const { threadId, response } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpMessages");
      }

      // Fetch the thread details
      const threadQuery = await db.query(
        `SELECT id, name, email FROM help_threads WHERE id = $1 LIMIT 1`,
        [threadIdInt]
      );

      if (threadQuery.rows.length === 0) {
        req.flash("error", "Thread not found.");
        return res.redirect("/admin/helpMessages");
      }

      const thread = threadQuery.rows[0];

      // Save the admin response
      await db.query(
        `INSERT INTO help_messages (thread_id, name, email, message, is_response) 
                 VALUES ($1, $2, $3, $4, true)`, // `is_response` is `true` for admin
        [threadIdInt, "Admin", process.env.EMAIL_USER, response]
      );

      const html = renderCleanEmail({
        title: "Support Ticket Response",
        greeting: `Dear <strong>${he.encode(thread.name)}</strong>,`,
        paragraphs: [
          `Our team has responded to your support ticket (#${threadIdInt}).`,
        ],
        details: [
          { label: "Ticket Number", value: `#${threadIdInt}` },
          { label: "Response", value: response },
        ],
        note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Response to Support Ticket #${threadIdInt}`,
        html,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Admin Support Response Email");
      req.flash("success", "Response sent and saved successfully.");
      res.redirect("/admin/helpMessages");
    } catch (error) {
            req.flash("error", "Failed to process the response.");
      res.redirect("/admin/helpMessages");
    }
  },

  // Mark a message as resolved
  markAsResolved: async (req, res) => {
    const { threadId } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpMessages");
      }

      // Fetch the thread details
      const threadQuery = await db.query(
        `SELECT id, name, email FROM help_threads WHERE id = $1 LIMIT 1`,
        [threadIdInt]
      );

      if (threadQuery.rows.length === 0) {
        req.flash("error", "Thread not found.");
        return res.redirect("/admin/helpMessages");
      }

      const thread = threadQuery.rows[0];

      // Mark the ticket as resolved
      await db.query(
        `UPDATE help_threads SET is_resolved = true WHERE id = $1`,
        [threadIdInt]
      );

      const html = renderCleanEmail({
        title: "Support Ticket Resolved",
        greeting: `Dear <strong>${he.encode(thread.name)}</strong>,`,
        paragraphs: [
          `We are pleased to inform you that your support ticket (#${threadIdInt}) has been resolved.`,
          "If you have any further questions, please reach out to us.",
        ],
        note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Your Support Ticket #${threadIdInt} Has Been Resolved`,
        html,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Admin Ticket Resolved Email");
      req.flash("success", "Ticket marked as closed and email notification queued.");
      res.redirect("/admin/helpMessages");
    } catch (error) {
            req.flash("error", "Failed to mark as closed.");
      res.redirect("/admin/helpMessages");
    }
  },

  helpHistory: async (req, res) => {
    try {
      const threads = await db.query(`
                SELECT ht.id AS thread_id, ht.name, ht.organization, ht.email, ht.phone, 
                       ARRAY_AGG(hm.message ORDER BY hm.created_at ASC) AS messages,
                       ht.is_resolved, ht.created_at, ht.last_updated
                FROM help_threads ht
                JOIN help_messages hm ON ht.id = hm.thread_id
                WHERE ht.is_resolved = true AND ht.is_deleted = false
                GROUP BY ht.id
                ORDER BY ht.id ASC
            `);

      res.render("admin/helpHistory", {
        title: "Help History",
        threads: threads.rows,
        showFooterTopSection: true
      });
    } catch (error) {
            res.status(500).send("Failed to fetch help history.");
    }
  },

  reopenThread: async (req, res) => {
    const { threadId } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpHistory");
      }

      // Fetch the thread details
      const threadQuery = await db.query(
        `SELECT id, name, email FROM help_threads WHERE id = $1 LIMIT 1`,
        [threadIdInt]
      );

      if (threadQuery.rows.length === 0) {
        req.flash("error", "Thread not found.");
        return res.redirect("/admin/helpHistory");
      }

      const thread = threadQuery.rows[0];

      // Reopen the ticket
      await db.query(
        `UPDATE help_threads SET is_resolved = false WHERE id = $1`,
        [threadIdInt]
      );

      const html = renderCleanEmail({
        title: "Support Ticket Reopened",
        greeting: `Dear <strong>${he.encode(thread.name)}</strong>,`,
        paragraphs: [
          `Your support ticket (#${threadIdInt}) has been reopened. Our team is actively working on your concern and will update you shortly.`,
        ],
        note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
      });

      const mailOptions = {
        from: process.env.NOTIFY_EMAIL_USER,
        to: thread.email,
        subject: `Your Support Ticket #${threadIdInt} Has Been Reopened`,
        html,
        attachments: [
          {
            filename: 'managira.png',
            path: require('path').join(__dirname, '../public/images/managira.png'),
            cid: 'managira_logo'
          }
        ]
      };

      sendEmailInBackground(mailOptions, "Admin Ticket Reopened Email");
      req.flash("success", "Ticket reopened and email notification queued.");
      res.redirect("/admin/helpHistory");
    } catch (error) {
            req.flash("error", "Failed to reopen the thread.");
      res.redirect("/admin/helpHistory");
    }
  },

  deleteThread: async (req, res) => {
    const { threadId } = req.body;

    try {
      await db.query(`DELETE FROM help_threads WHERE id = $1`, [threadId]);
      req.flash("success", "Thread deleted successfully.");
      res.redirect("/admin/helpHistory");
    } catch (error) {
            req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/helpHistory");
    }
  },

  restoreMessage: async (req, res) => {
    const { threadId } = req.body;

    try {
      await db.query(
        `UPDATE help_threads SET is_deleted = false, is_resolved = false WHERE id = $1`,
        [threadId]
      );
      req.flash("success", "Thread restored to Help Messages.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
            req.flash("error", "Failed to restore thread.");
      res.redirect("/admin/superDashboard");
    }
  },

  permanentDeleteMessage: async (req, res) => {
    const { threadId } = req.body;

    try {
      await db.query(`DELETE FROM help_threads WHERE id = $1`, [threadId]);
      req.flash("success", "Thread permanently deleted.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
            req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/superDashboard");
    }
  },

  tempDeleteMessage: async (req, res) => {
    const { threadId } = req.body;

    try {
      const threadIdInt = parseInt(threadId, 10);
      if (isNaN(threadIdInt)) {
        req.flash("error", "Invalid thread ID.");
        return res.redirect("/admin/helpMessages");
      }

      // Temporarily delete the thread
      await db.query(
        `UPDATE help_threads SET is_deleted = true WHERE id = $1`,
        [threadIdInt]
      );

      req.flash(
        "success",
        "Thread moved to review in the Super Admin Dashboard."
      );
      res.redirect("/admin/helpMessages");
    } catch (error) {
            req.flash("error", "Failed to delete thread.");
      res.redirect("/admin/helpMessages");
    }
  },

  servicePricingGet: async (req, res) => {
    try {
      await ensurePaymentProviderSchema(db);
      const currencyProfile = await getCurrencyProfileForRequest(req);
      const paystackSettings = await getPaystackSettings(db);
      const stripeSettings = await getStripeSettings(db);
      const stripePlatformStatus = await getStripePlatformCredentials(db).catch(() => ({
        mode: stripeSettings.mode,
        issue: "Stripe platform key status could not be verified.",
        secretKey: "",
        publicKey: "",
      }));
      const paymentProvider = await getPaymentProvider(db);
      const platformFeeSettings = await getPlatformFeeSettings(db);
      const featuresResult = await db.query(
        "SELECT * FROM features ORDER BY feature_name ASC"
      );

      const plansResult = await db.query(`
                SELECT p.id AS plan_id, p.plan_name, p.description, p.is_active, p.total_cost,
                    COALESCE(JSON_AGG(json_build_object(
                        'id', f.id, 
                        'feature_name', f.feature_name, 
                        'price_usd', f.price_usd
                    )) FILTER (WHERE f.id IS NOT NULL), '[]') AS features
                FROM plans p
                LEFT JOIN plan_features pf ON p.id = pf.plan_id
                LEFT JOIN features f ON pf.feature_id = f.id
                WHERE p.id IN (1, 2, 3, 4)
                GROUP BY p.id
                ORDER BY p.id;
            `);


      const localizedFeatures = (featuresResult.rows || []).map((feature) => {
        const usdPrice = Number(feature.price_usd || 0);
        const localized = localizeUsdAmount(usdPrice, currencyProfile);
        return {
          ...feature,
          priceUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
          localizedPriceDisplay: formatCurrencyAmount(
            localized.localizedAmount,
            localized.userCurrency,
            currencyProfile.locale
          ),
        };
      });

      const localizedPlans = (plansResult.rows || []).map((plan) => {
        const totalUsd = Number(plan.total_cost || 0);
        const localized = localizeUsdAmount(totalUsd, currencyProfile);
        const normalizedFeatures = Array.isArray(plan.features) ? plan.features : [];
        return {
          ...plan,
          features: normalizedFeatures.map((feature) => {
            const featureUsd = Number(feature.price_usd || 0);
            const featureLocalized = localizeUsdAmount(featureUsd, currencyProfile);
            return {
              ...feature,
              priceUsdDisplay: formatCurrencyAmount(featureLocalized.amountUsd, "USD"),
              localizedPriceDisplay: formatCurrencyAmount(
                featureLocalized.localizedAmount,
                featureLocalized.userCurrency,
                currencyProfile.locale
              ),
            };
          }),
          totalUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
          localizedTotalDisplay: formatCurrencyAmount(
            localized.localizedAmount,
            localized.userCurrency,
            currencyProfile.locale
          ),
        };
      });

      // Get free trial and billing interval settings directly from DB
      let freeTrialEnabled = 'false';
      let freeTrialDays = 7;
      let billingInterval = 'monthly';
      let dynamicTermMonths = 3;
      let dynamicTermDivider = 1;
      try {
        const enabledResult = await db.query("SELECT value FROM app_settings WHERE key = 'free_trial_enabled'");
        if (enabledResult.rows.length > 0) freeTrialEnabled = enabledResult.rows[0].value;
        const daysResult = await db.query("SELECT value FROM app_settings WHERE key = 'free_trial_days'");
        if (daysResult.rows.length > 0) freeTrialDays = daysResult.rows[0].value;
        const intervalResult = await db.query("SELECT value FROM app_settings WHERE key = 'billing_interval'");
        if (intervalResult.rows.length > 0) billingInterval = intervalResult.rows[0].value;
        const termMonthsResult = await db.query("SELECT value FROM app_settings WHERE key = 'dynamic_term_months'");
        if (termMonthsResult.rows.length > 0) {
          const parsedTermMonths = parseInt(termMonthsResult.rows[0].value, 10);
          if (Number.isInteger(parsedTermMonths) && parsedTermMonths > 0) {
            dynamicTermMonths = parsedTermMonths;
          }
        }
        const termDividerResult = await db.query("SELECT value FROM app_settings WHERE key = 'dynamic_term_divider'");
        if (termDividerResult.rows.length > 0) {
          const parsedDivider = parseInt(termDividerResult.rows[0].value, 10);
          if (Number.isInteger(parsedDivider) && parsedDivider > 0) {
            dynamicTermDivider = parsedDivider;
          }
        }
      } catch (err) {
              }

      // Fetch billing periods for discount management
      let billingPeriods = [];
      try {
        const bpResult = await db.query('SELECT * FROM billing_periods ORDER BY sort_order');
        billingPeriods = bpResult.rows || [];
      } catch (err) {
        // Table may not exist yet
      }

      // Fetch student count tiers grouped by plan
      let studentTiersByPlan = {};
      try {
        const tiersResult = await db.query('SELECT * FROM plan_student_tiers ORDER BY plan_id, sort_order, min_students');
        const planBasePriceById = new Map(localizedPlans.map((plan) => [String(plan.plan_id), Number(plan.total_cost || 0)]));
        (tiersResult.rows || []).forEach(tier => {
          if (!studentTiersByPlan[tier.plan_id]) studentTiersByPlan[tier.plan_id] = [];
          const usd = computeTierMonthlyPrice(planBasePriceById.get(String(tier.plan_id)), tier);
          const loc = localizeUsdAmount(usd, currencyProfile);
          studentTiersByPlan[tier.plan_id].push({
            ...tier,
            adjustment_percentage: tier.adjustment_percentage != null ? Number(tier.adjustment_percentage) : null,
            computedPriceUsd: usd,
            priceUsdDisplay: formatCurrencyAmount(loc.amountUsd, "USD"),
            localizedPriceDisplay: formatCurrencyAmount(loc.localizedAmount, loc.userCurrency, currencyProfile.locale),
          });
        });
      } catch (err) {
        // Table may not exist yet
      }

      // Dynamic pricing (beta) data for inline admin forms. Keep isolated from legacy pricing logic.
      let dynamicRegions = [];
      let dynamicRegionCountries = [];
      let dynamicPlanRegionPrices = [];
      let dynamicCycles = [];
      let dynamicRegionStats = [];
      let dynamicDefaultFallbackSchools = [];
      try {
        const [regionsRes, countriesRes, pricesRes, cyclesRes] = await Promise.all([
          db.query('SELECT * FROM pricing_regions ORDER BY is_default DESC, sort_order ASC, name ASC'),
          db.query('SELECT * FROM pricing_region_countries ORDER BY country_name ASC'),
          db.query('SELECT * FROM plan_region_prices'),
          db.query('SELECT * FROM dynamic_billing_cycles ORDER BY sort_order ASC, months ASC'),
        ]);
        dynamicRegions = regionsRes.rows || [];
        dynamicRegionCountries = countriesRes.rows || [];
        dynamicPlanRegionPrices = pricesRes.rows || [];
        dynamicCycles = cyclesRes.rows || [];

        if (dynamicRegions.length > 0) {
          const activeRegions = dynamicRegions.filter((region) => Boolean(region.is_active));
          const defaults = activeRegions.filter((region) => Boolean(region.is_default));
          let fallbackRegionId = null;

          if (defaults.length === 0) {
            if (activeRegions.length > 0) {
              fallbackRegionId = Number(activeRegions[0].id);
            } else {
              fallbackRegionId = Number(dynamicRegions[0].id);
            }
          } else if (defaults.length > 1) {
            const sortedDefaults = defaults.slice().sort((a, b) => {
              const sortDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
              if (sortDiff !== 0) return sortDiff;
              return Number(a.id || 0) - Number(b.id || 0);
            });
            fallbackRegionId = Number(sortedDefaults[0].id);
          }

          if (Number.isInteger(fallbackRegionId)) {
            await db.query('UPDATE pricing_regions SET is_default = FALSE WHERE id <> $1', [fallbackRegionId]);
            await db.query('UPDATE pricing_regions SET is_default = TRUE, is_active = TRUE WHERE id = $1', [fallbackRegionId]);
            dynamicRegions = dynamicRegions.map((region) => ({
              ...region,
              is_default: Number(region.id) === fallbackRegionId,
              is_active: Number(region.id) === fallbackRegionId ? true : Boolean(region.is_active),
            }));
          }
        }

        try {
          const regionMonthsRes = await db.query(
            "SELECT key, value FROM app_settings WHERE key LIKE 'dynamic_region_term_months_%'"
          );
          const regionMonthsById = new Map();
          (regionMonthsRes.rows || []).forEach((row) => {
            const key = String(row.key || '');
            const match = key.match(/^dynamic_region_term_months_(\d+)$/);
            if (!match) return;
            const regionId = Number(match[1]);
            const parsed = parseInt(row.value, 10);
            if (Number.isInteger(regionId) && Number.isInteger(parsed) && parsed > 0) {
              regionMonthsById.set(regionId, parsed);
            }
          });
          dynamicRegions = dynamicRegions.map((region) => ({
            ...region,
            term_months: regionMonthsById.get(Number(region.id)) || dynamicTermMonths,
          }));
        } catch (_) {
          dynamicRegions = dynamicRegions.map((region) => ({
            ...region,
            term_months: dynamicTermMonths,
          }));
        }

        const statsResult = await db.query(
          `SELECT
             pr.id AS region_id,
             COUNT(DISTINCT prc.country_code)::int AS country_count,
             COUNT(DISTINCT o.organization_id)::int AS matched_school_count
           FROM pricing_regions pr
           LEFT JOIN pricing_region_countries prc
             ON prc.region_id = pr.id
           LEFT JOIN organizations o
             ON o.deleted = false
            AND o.organization_country IS NOT NULL
            AND UPPER(TRIM(o.organization_country)) IN (
              UPPER(prc.country_code),
              UPPER(prc.country_name)
            )
           GROUP BY pr.id`
        );
        dynamicRegionStats = statsResult.rows || [];

        const defaultRegion = dynamicRegions.find((region) => region.is_default);
        if (defaultRegion) {
          const fallbackResult = await db.query(
            `SELECT o.organization_id, o.organization_name, o.organization_country
             FROM organizations o
             WHERE o.deleted = false
               AND COALESCE(TRIM(o.organization_country), '') <> ''
               AND NOT EXISTS (
                 SELECT 1
                 FROM pricing_region_countries prc
                 WHERE UPPER(TRIM(o.organization_country)) IN (
                   UPPER(prc.country_code),
                   UPPER(prc.country_name)
                 )
               )
             ORDER BY o.organization_name ASC
             LIMIT 30`
          );
          dynamicDefaultFallbackSchools = fallbackResult.rows || [];
        }
      } catch (err) {
        // Dynamic pricing tables may not exist in some environments.
      }

      res.render("admin/servicePricing", {
        title: "Service Pricing Management",
        features: localizedFeatures,
        plans: localizedPlans,
        currencyProfile,
        messages: req.flash(),
        freeTrialEnabled,
        freeTrialDays,
        billingInterval,
        dynamicTermMonths,
        dynamicTermDivider,
        billingPeriods,
        studentTiersByPlan,
        paymentProvider,
        platformFeePercentage: platformFeeSettings.percentage,
        paystackMode: paystackSettings.mode,
        stripeMode: stripeSettings.mode,
        stripeKeysMasked: stripeSettings.masked,
        stripePlatformStatus,
        dynamicRegions,
        dynamicRegionCountries,
        dynamicPlanRegionPrices,
        dynamicCycles,
        dynamicRegionStats,
        dynamicDefaultFallbackSchools,
        dynamicDbSourceLabel: 'Primary DB',
        dynamicDbIsolated: false,
        countriesByContinent: COUNTRIES_BY_CONTINENT,
        countryNameLookup: COUNTRY_NAME_LOOKUP,
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash("error", "Failed to fetch service pricing.");
      res.redirect("/admin");
    }
  },

  updateFreeTrialSettings: async (req, res) => {
    try {
      const { free_trial_enabled, free_trial_days } = req.body;
      const enabled = free_trial_enabled === 'true' ? 'true' : 'false';
      let days;
      if (free_trial_days === '5_minutes') {
        days = '5_minutes';
      } else {
        const numDays = parseInt(free_trial_days, 10);
        if ([1, 7, 14, 30, 60, 90, 120].includes(numDays)) {
          days = String(numDays);
        } else {
          days = '7'; // Default fallback
        }
      }
      await db.query(`INSERT INTO app_settings(key, value) VALUES ('free_trial_enabled', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [enabled]);
      await db.query(`INSERT INTO app_settings(key, value) VALUES ('free_trial_days', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [days]);
      req.flash('success', 'Free trial settings updated.');
    } catch (error) {
            req.flash('error', 'Failed to update free trial settings.');
    }
    res.redirect('/admin/servicePricing');
  },

  updateBillingInterval: async (req, res) => {
    try {
      const { billing_interval } = req.body;
      const allowed = ['5_minutes', 'daily', 'weekly', 'monthly', 'yearly', '2_years', '3_years'];
      const interval = allowed.includes(billing_interval) ? billing_interval : 'monthly';
      await db.query(`INSERT INTO app_settings(key, value) VALUES ('billing_interval', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [interval]);
      req.flash('success', 'Billing interval updated.');
    } catch (error) {
            req.flash('error', 'Failed to update billing interval.');
    }
    res.redirect('/admin/servicePricing');
  },

  updatePlatformFeeSettings: async (req, res) => {
    try {
      const percentage = normalizePlatformFeePercentage(req.body?.platform_fee_percentage, 2);
      await upsertPlatformFeeSettings({ platform_fee_percentage: percentage }, db);
      req.flash('success', `Platform fee updated to ${percentage}% for in-app card and wallet charges.`);
    } catch (error) {
      req.flash('error', 'Failed to update platform fee settings.');
    }
    return res.redirect('/admin/servicePricing');
  },

  updateBillingPeriod: async (req, res) => {
    try {
      const { period_key, discount_percentage, is_active } = req.body;
      if (!period_key) {
        return res.status(400).json({ success: false, message: 'Missing period_key' });
      }
      const discount = Math.max(0, Math.min(50, parseInt(discount_percentage, 10) || 0));
      const active = is_active === 'true' || is_active === true;
      await db.query(
        `UPDATE billing_periods SET discount_percentage = $1, is_active = $2, updated_at = NOW() WHERE period_key = $3`,
        [discount, active, period_key]
      );
      return res.json({ success: true, discount, is_active: active });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to update billing period.' });
    }
  },

  getBillingPeriods: async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM billing_periods ORDER BY sort_order');
      return res.json({ success: true, periods: result.rows });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to fetch billing periods.' });
    }
  },

  updatePaystackSettings: async (req, res) => {
    try {
      await ensurePaymentProviderSchema(db);
      const { paystack_mode } = req.body;

      const existing = await getPaystackSettings(db);
      const mode = normalizeMode(paystack_mode);

      if (mode === "live" && (!existing.liveSecretKey || !existing.livePublicKey)) {
        req.flash("error", "Live mode requires both live secret and live public keys.");
        return res.redirect("/admin/servicePricing");
      }

      if (mode === "test" && (!existing.testSecretKey || !existing.testPublicKey)) {
        req.flash("error", "Test mode requires both test secret and test public keys.");
        return res.redirect("/admin/servicePricing");
      }

      await upsertPaystackSettings(
        {
          paystack_mode: mode,
        },
        db
      );

      req.flash("success", `Paystack mode set to ${mode.toUpperCase()} and keys saved.`);
    } catch (error) {
      req.flash("error", "Failed to update Paystack settings.");
    }

    return res.redirect("/admin/servicePricing");
  },

  updatePaymentProviderSettings: async (req, res) => {
    try {
      await ensurePaymentProviderSchema(db);
      const { payment_provider } = req.body;
      const provider = normalizePaymentProvider(payment_provider);

      await upsertPaymentProvider(provider, db);
      const label = provider === "smart" ? "Both / Smart" : provider === "stripe" ? "Stripe" : "Paystack";
      req.flash("success", `Gateway strategy set to ${label}.`);
    } catch (error) {
      req.flash("error", "Failed to update default payment provider.");
    }

    return res.redirect("/admin/servicePricing");
  },

  updateStripeSettings: async (req, res) => {
    try {
      await ensurePaymentProviderSchema(db);
      const { stripe_mode } = req.body;
      const settings = await getStripeSettings(db);
      const mode = normalizeStripeMode(stripe_mode);
      const readiness = resolveStripeModeReadiness(mode, settings);

      if (!readiness.activeSecretKey || !readiness.activePublicKey) {
        req.flash("error", `${mode.toUpperCase()} Stripe mode requires both ${mode} secret and ${mode} publishable keys.`);
        return res.redirect("/admin/servicePricing");
      }

      if (mode === "live" && (!settings.liveSecretKey || !settings.livePublicKey)) {
        req.flash("error", "Live Stripe mode requires both live secret and live publishable keys.");
        return res.redirect("/admin/servicePricing");
      }

      if (mode === "test" && (!settings.testSecretKey || !settings.testPublicKey)) {
        req.flash("error", "Test Stripe mode requires both test secret and test publishable keys.");
        return res.redirect("/admin/servicePricing");
      }

      if (!readiness.fullPlatformSecret) {
        req.flash(
          "error",
          `${mode.toUpperCase()} Stripe mode requires a full platform secret key (${mode === "live" ? "sk_live_" : "sk_test_"}) for Connect and destination-charge flows. Add STRIPE_CONNECT_${mode.toUpperCase()}_SECRET_KEY or a full ${mode} secret key.`
        );
        return res.redirect("/admin/servicePricing");
      }

      if (mode === "live" && !readiness.hasWebhookSecret) {
        req.flash(
          "error",
          "Live Stripe mode requires a webhook secret. Set STRIPE_CONNECT_WEBHOOK_SECRET (preferred) or STRIPE_WEBHOOK_SECRET before switching to LIVE."
        );
        return res.redirect("/admin/servicePricing");
      }

      await upsertStripeSettings({ stripe_mode: mode }, db);
      req.flash("success", `Stripe mode set to ${mode.toUpperCase()}.`);
    } catch (error) {
      req.flash("error", "Failed to update Stripe settings.");
    }

    return res.redirect("/admin/servicePricing");
  },

  scheduledHoldsPage: async (req, res) => {
    try {
      const result = await db.query(
        `SELECT organization_id, organization_name, scheduled_hold_date 
                     FROM organizations 
                     WHERE scheduled_hold_date IS NOT NULL 
                     ORDER BY scheduled_hold_date ASC`
      );

      res.render("admin/scheduledHolds", {
        title: "Scheduled Holds",
        organizations: result.rows,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load scheduled holds.");
      res.redirect("/admin");
    }
  },

  addFeature: async (req, res) => {
    const { featureName, priceUsd } = req.body;
    try {
      await db.query(
        "INSERT INTO features (feature_name, price_usd) VALUES ($1, $2)",
        [featureName, priceUsd]
      );
      req.flash("success", "Feature added successfully.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to add feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  updateFeature: async (req, res) => {
    const { featureId, featureName, priceUsd } = req.body;
    try {
      await db.query(
        "UPDATE features SET feature_name = $1, price_usd = $2 WHERE id = $3",
        [featureName, priceUsd, featureId]
      );
      req.flash("success", "Feature updated successfully.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to update feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  togglePlanStatus: async (req, res) => {
    const { planId } = req.body;
    try {
      await db.query(
        "UPDATE plans SET is_active = NOT is_active WHERE id = $1",
        [planId]
      );
      req.flash("success", "Plan activation status updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to update plan status.");
      res.redirect("/admin/servicePricing");
    }
  },

  addFeatureToPlan: async (req, res) => {
    const { planId, featureId } = req.body;

    try {
      // Get feature price
      const featureResult = await db.query(
        "SELECT price_usd FROM features WHERE id = $1",
        [featureId]
      );

      if (featureResult.rows.length === 0) {
        req.flash("error", "Feature not found.");
        return res.redirect("/admin/servicePricing");
      }

      const featurePrice = featureResult.rows[0].price_usd;

      // Add feature to plan
      await db.query(
        "INSERT INTO plan_features (plan_id, feature_id) VALUES ($1, $2)",
        [planId, featureId]
      );

      // Update total cost
      await db.query(
        "UPDATE plans SET total_cost = total_cost + $1 WHERE id = $2",
        [featurePrice, planId]
      );

      await invalidateAccessForPlan(db, planId);

      req.flash("success", "Feature added and total cost updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to add feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  removeFeatureFromPlan: async (req, res) => {
    const { planId, featureId } = req.body;

    try {
      // Get feature price
      const featureResult = await db.query(
        "SELECT price_usd FROM features WHERE id = $1",
        [featureId]
      );

      if (featureResult.rows.length === 0) {
        req.flash("error", "Feature not found.");
        return res.redirect("/admin/servicePricing");
      }

      const featurePrice = featureResult.rows[0].price_usd;

      // Remove feature from plan
      await db.query(
        "DELETE FROM plan_features WHERE plan_id = $1 AND feature_id = $2",
        [planId, featureId]
      );

      // Update total cost
      await db.query(
        "UPDATE plans SET total_cost = total_cost - $1 WHERE id = $2",
        [featurePrice, planId]
      );

      await invalidateAccessForPlan(db, planId);

      req.flash("success", "Feature removed and total cost updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to remove feature.");
      res.redirect("/admin/servicePricing");
    }
  },

  updatePlanDescription: async (req, res) => {
    const { planId, description } = req.body;
    try {
      await db.query("UPDATE plans SET description = $1 WHERE id = $2", [
        description,
        planId,
      ]);
      req.flash("success", "Plan description updated.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to update.");
      res.redirect("/admin/servicePricing");
    }
  },

  deleteFeature: async (req, res) => {
    const { featureId } = req.body;
    try {
      await db.query("DELETE FROM features WHERE id = $1", [featureId]);
      res.json({ success: true });
    } catch (error) {
            res.json({ success: false, error: "Failed to delete feature." });
    }
  },

  permanentlyDeleteOrganization: async (req, res) => {
    const { orgId } = req.body;
    try {
      await db.query("BEGIN");

      await db.query(
        `DELETE FROM user_subjects
         WHERE user_id IN (
           SELECT user_id FROM users WHERE organization_id = $1
         )
         OR subject_id IN (
           SELECT subject_id FROM subjects WHERE organization_id = $1
         )`,
        [orgId]
      );

      await db.query(
        `DELETE FROM organization_texts WHERE organization_id = $1`,
        [orgId]
      );

      const deleteResult = await db.query("DELETE FROM organizations WHERE organization_id = $1", [
        orgId,
      ]);

      if (deleteResult.rowCount === 0) {
        await db.query("ROLLBACK");
        req.flash("error", "Organization not found or already deleted.");
        return res.redirect("/admin/superDashboard");
      }

      await db.query("COMMIT");

      req.flash("success", "Organization permanently deleted successfully.");
      res.redirect("/admin/superDashboard");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch (_) {}

      let detailedMessage = "Failed to permanently delete organization.";

      if (error?.code === "23503") {
        detailedMessage =
          "Failed to permanently delete organization: it is linked to protected records.";

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
                [orgId]
              );

              let linkedCount = countResult.rows[0]?.count || 0;

              if (linkedCount === 0 && fkInfo.table_name === "user_subjects") {
                if (fkInfo.column_name === "subject_id") {
                  const accurateCountResult = await db.query(
                    `SELECT COUNT(*)::int AS count
                     FROM user_subjects us
                     JOIN subjects s ON s.subject_id = us.subject_id
                     WHERE s.organization_id = $1`,
                    [orgId]
                  );
                  linkedCount = accurateCountResult.rows[0]?.count || 0;
                } else if (fkInfo.column_name === "user_id") {
                  const accurateCountResult = await db.query(
                    `SELECT COUNT(*)::int AS count
                     FROM user_subjects us
                     JOIN users u ON u.user_id = us.user_id
                     WHERE u.organization_id = $1`,
                    [orgId]
                  );
                  linkedCount = accurateCountResult.rows[0]?.count || 0;
                }
              }

              detailedMessage = linkedCount > 0
                ? `Failed to permanently delete organization: linked to ${linkedCount} record(s) in ${fkInfo.table_name} (${fkInfo.column_name}). Remove or reassign these records first.`
                : `Failed to permanently delete organization: linked records exist in ${fkInfo.table_name} (${fkInfo.column_name}). Remove or reassign related records first.`;
            }
          }
        } catch (fkLookupError) {
        }
      } else if (error?.message) {
        detailedMessage = `Failed to permanently delete organization: ${error.message}`;
      }

      req.flash("error", detailedMessage);
      res.redirect("/admin/superDashboard");
    }
  },

  dataExportPage: async (req, res) => {
    try {
      const result = await db.query(
        "SELECT organization_id, organization_name FROM organizations"
      );
      res.render("admin/dataExport", {
        title: "Data Export",
        organizations: result.rows,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load Data Export page.");
      res.redirect("/admin");
    }
  },

  getEmploymentAdmin: async (req, res) => {
    await ensureEmploymentSchema(db);

    const jobs = await db.query(`
      SELECT
        e.*,
        COALESCE(a.application_count, 0)::int AS application_count
      FROM employment e
      LEFT JOIN (
        SELECT employment_id, COUNT(*) AS application_count
        FROM employment_applications
        GROUP BY employment_id
      ) a ON a.employment_id = e.id
      ORDER BY e.created_at DESC
    `);

    const applications = await db.query(`
      SELECT
        ea.*,
        e.title AS job_title
      FROM employment_applications ea
      JOIN employment e ON e.id = ea.employment_id
      ORDER BY
        CASE
          WHEN ea.status = 'pending' THEN 0
          WHEN ea.status = 'approved' THEN 1
          ELSE 2
        END,
        ea.created_at DESC
    `);

    res.render("admin/manageEmployment", {
      title: "Manage Employment",
      jobs: jobs.rows,
      applications: applications.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  getEmploymentApplicationsAjax: async (req, res) => {
    await ensureEmploymentSchema(db);

    try {
      const applications = await db.query(`
        SELECT
          ea.id,
          ea.employment_id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.phone,
          ea.location,
          ea.status,
          ea.interview_stage,
          ea.created_at,
          ea.contact_via_email,
          ea.contact_via_text,
          ea.resume_url,
          ea.resume_filename,
          ea.cover_letter,
          ea.cover_letter_url,
          ea.cover_letter_filename,
          ea.qualification_score,
          ea.qualification_summary,
          ea.qualification_analyzed_at,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        ORDER BY
          CASE
            WHEN ea.status = 'pending' THEN 0
            WHEN ea.status = 'approved' THEN 1
            ELSE 2
          END,
          ea.created_at DESC
      `);

      return res.json({
        success: true,
        total: applications.rows.length,
        applications: applications.rows,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to load applicants right now.",
      });
    }
  },

  analyzeEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const { id } = req.params;
    const force = String(req.query.force || "").toLowerCase() === "true";

    try {
      const result = await db.query(
        `SELECT ea.id, ea.cover_letter, ea.resume_url,
                ea.qualification_score, ea.qualification_summary,
                ea.qualification_analyzed_at,
                e.title AS job_title, e.description AS job_description
         FROM employment_applications ea
         JOIN employment e ON e.id = ea.employment_id
         WHERE ea.id = $1`,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "Application not found." });
      }

      const app = result.rows[0];

      // Return cached analysis if present and not forced
      if (!force && app.qualification_analyzed_at && app.qualification_summary) {
        return res.json({
          success: true,
          cached: true,
          score: app.qualification_score,
          analyzed_at: app.qualification_analyzed_at,
          ...app.qualification_summary,
        });
      }

      const { analyzeQualification, fetchResumeText } = require("../utils/qualificationAnalyzer");
      const resumeText = await fetchResumeText(app.resume_url);
      const summary = analyzeQualification({
        jobDescription: app.job_description,
        coverLetter: app.cover_letter,
        resumeText,
      });

      await db.query(
        `UPDATE employment_applications
         SET qualification_score = $2,
             qualification_summary = $3,
             qualification_analyzed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, summary.score, JSON.stringify(summary)]
      );

      return res.json({
        success: true,
        cached: false,
        score: summary.score,
        analyzed_at: new Date().toISOString(),
        ...summary,
      });
    } catch (error) {
      console.error("analyzeEmploymentApplication error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to analyze this application right now.",
      });
    }
  },

  analyzeAllEmploymentApplications: async (req, res) => {
    await ensureEmploymentSchema(db);
    const force = String(req.query.force || "").toLowerCase() === "true";

    try {
      const filter = force ? "" : "AND ea.qualification_analyzed_at IS NULL";
      const rows = await db.query(
        `SELECT ea.id, ea.cover_letter, ea.resume_url,
                e.description AS job_description
         FROM employment_applications ea
         JOIN employment e ON e.id = ea.employment_id
         WHERE 1=1 ${filter}
         ORDER BY ea.created_at DESC`
      );

      const { analyzeQualification, fetchResumeText } = require("../utils/qualificationAnalyzer");

      let analyzed = 0;
      let failed = 0;

      // Run sequentially to avoid hammering S3 / pdf-parse with parallelism.
      for (const app of rows.rows) {
        try {
          const resumeText = await fetchResumeText(app.resume_url);
          const summary = analyzeQualification({
            jobDescription: app.job_description,
            coverLetter: app.cover_letter,
            resumeText,
          });
          await db.query(
            `UPDATE employment_applications
             SET qualification_score = $2,
                 qualification_summary = $3,
                 qualification_analyzed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [app.id, summary.score, JSON.stringify(summary)]
          );
          analyzed++;
        } catch (err) {
          console.error("Bulk analyze failed for application", app.id, err.message);
          failed++;
        }
      }

      return res.json({
        success: true,
        total: rows.rows.length,
        analyzed,
        failed,
        skipped_existing: !force,
      });
    } catch (error) {
      console.error("analyzeAllEmploymentApplications error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to run bulk analysis right now.",
      });
    }
  },

  postEmployment: async (req, res) => {
    await ensureEmploymentSchema(db);

    const { title, description, external_link, application_mode } = req.body;
    const normalizedMode = application_mode === "in_app" ? "in_app" : "external";
    const normalizedExternalLink = external_link ? external_link.trim() : "";

    if (!title || !description) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/employment");
    }

    if (normalizedMode === "external" && !normalizedExternalLink) {
      req.flash("error", "External application link is required for external mode.");
      return res.redirect("/admin/employment");
    }

    try {
      await db.query(
        `INSERT INTO employment (title, description, external_link, application_mode, is_active) VALUES ($1, $2, $3, $4, TRUE)`,
        [
          title.trim(),
          description.trim(),
          normalizedMode === "external" ? normalizedExternalLink : null,
          normalizedMode,
        ]
      );
      req.flash("success", "Job added successfully.");
    } catch (err) {
            req.flash("error", "Error saving job.");
    }

    res.redirect("/admin/employment");
  },

  updateEmployment: async (req, res) => {
    await ensureEmploymentSchema(db);

    const employmentId = Number.parseInt(req.params.id, 10);
    const { title, description, external_link, application_mode } = req.body;
    const normalizedMode = application_mode === "in_app" ? "in_app" : "external";
    const normalizedExternalLink = external_link ? external_link.trim() : "";

    if (!Number.isInteger(employmentId)) {
      req.flash("error", "Invalid job selected.");
      return res.redirect("/admin/employment");
    }

    if (!title || !description) {
      req.flash("error", "Title and description are required.");
      return res.redirect("/admin/employment");
    }

    if (normalizedMode === "external" && !normalizedExternalLink) {
      req.flash("error", "External application link is required for external mode.");
      return res.redirect("/admin/employment");
    }

    try {
      const result = await db.query(
        `UPDATE employment
         SET title = $2,
             description = $3,
             external_link = $4,
             application_mode = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id`,
        [
          employmentId,
          title.trim(),
          description.trim(),
          normalizedMode === "external" ? normalizedExternalLink : null,
          normalizedMode,
        ]
      );

      if (!result.rows.length) {
        req.flash("error", "Job not found.");
      } else {
        req.flash("success", "Job updated successfully.");
      }
    } catch (error) {
      req.flash("error", "Failed to update job.");
    }

    return res.redirect("/admin/employment");
  },

  toggleEmploymentStatus: async (req, res) => {
    await ensureEmploymentSchema(db);

    const employmentId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(employmentId)) {
      req.flash("error", "Invalid job selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const result = await db.query(
        `UPDATE employment
         SET is_active = NOT is_active,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING is_active`,
        [employmentId]
      );

      if (!result.rows.length) {
        req.flash("error", "Job not found.");
      } else {
        req.flash("success", result.rows[0].is_active ? "Job is now active and visible on Job Posting." : "Job is now inactive and hidden from Job Posting.");
      }
    } catch (error) {
      req.flash("error", "Failed to change job status.");
    }

    return res.redirect("/admin/employment");
  },

  recalculateAllPlanTotals: async (req, res) => {
    try {
      // Recalculate total_cost for all plans based on their current features
      await db.query(`
        UPDATE plans 
        SET total_cost = COALESCE((
          SELECT SUM(f.price_usd) 
          FROM plan_features pf 
          JOIN features f ON pf.feature_id = f.id 
          WHERE pf.plan_id = plans.id
        ), 0)
      `);
      
      req.flash("success", "All plan total costs have been recalculated successfully.");
      res.redirect("/admin/servicePricing");
    } catch (error) {
            req.flash("error", "Failed to recalculate plan totals.");
      res.redirect("/admin/servicePricing");
    }
  },

  // ── Student Count Tier CRUD ──

  addStudentTier: async (req, res) => {
    const { plan_id, min_students, max_students, adjustment_percentage } = req.body;
    try {
      const planCheck = await db.query('SELECT id FROM plans WHERE id = $1', [plan_id]);
      if (planCheck.rows.length === 0) {
        req.flash("error", "Plan not found.");
        return res.redirect("/admin/servicePricing");
      }
      const minVal = parseInt(min_students, 10) || 0;
      const maxVal = max_students === '' || max_students === undefined || max_students === null ? null : parseInt(max_students, 10);
      const label = maxVal != null ? `${minVal} – ${maxVal} students` : `${minVal}+ students`;
      const adjustment = Number.parseFloat(adjustment_percentage);
      const sortOrder = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM plan_student_tiers WHERE plan_id = $1', [plan_id]);
      await db.query(
        `INSERT INTO plan_student_tiers (plan_id, label, min_students, max_students, price_usd, adjustment_percentage, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [plan_id, label, minVal, maxVal, 0, Number.isFinite(adjustment) ? adjustment : 0, sortOrder.rows[0].next]
      );
      req.flash("success", "Student tier added.");
    } catch (error) {
      req.flash("error", "Failed to add student tier.");
    }
    res.redirect("/admin/servicePricing");
  },

  updateStudentTier: async (req, res) => {
    const { tier_id, min_students, max_students, adjustment_percentage } = req.body;
    try {
      const minVal = parseInt(min_students, 10) || 0;
      const maxVal = max_students === '' || max_students === undefined || max_students === null ? null : parseInt(max_students, 10);
      const label = maxVal != null ? `${minVal} – ${maxVal} students` : `${minVal}+ students`;
      const adjustment = Number.parseFloat(adjustment_percentage);
      await db.query(
        `UPDATE plan_student_tiers SET label = $1, min_students = $2, max_students = $3, adjustment_percentage = $4 WHERE id = $5`,
        [label, minVal, maxVal, Number.isFinite(adjustment) ? adjustment : 0, tier_id]
      );
      req.flash("success", "Student tier updated.");
    } catch (error) {
      req.flash("error", "Failed to update student tier.");
    }
    res.redirect("/admin/servicePricing");
  },

  saveStudentTiers: async (req, res) => {
    const {
      plan_id,
      tier_id,
      min_students,
      max_students,
      adjustment_percentage,
      new_min_students,
      new_max_students,
      new_adjustment_percentage,
    } = req.body;

    const asArray = (value) => {
      if (Array.isArray(value)) return value;
      if (value === undefined || value === null) return [];
      return [value];
    };

    const tierIds = asArray(tier_id);
    const minValues = asArray(min_students);
    const maxValues = asArray(max_students);
    const adjustmentValues = asArray(adjustment_percentage);
    const newMinValues = asArray(new_min_students);
    const newMaxValues = asArray(new_max_students);
    const newAdjustmentValues = asArray(new_adjustment_percentage);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      for (let index = 0; index < tierIds.length; index += 1) {
        const currentTierId = tierIds[index];
        const minVal = parseInt(minValues[index], 10) || 0;
        const rawMax = maxValues[index];
        const maxVal = rawMax === '' || rawMax === undefined || rawMax === null ? null : parseInt(rawMax, 10);
        const adjustment = Number.parseFloat(adjustmentValues[index]);
        const label = maxVal != null ? `${minVal} – ${maxVal} students` : `${minVal}+ students`;

        await client.query(
          `UPDATE plan_student_tiers
           SET label = $1, min_students = $2, max_students = $3, adjustment_percentage = $4
           WHERE id = $5 AND plan_id = $6`,
          [label, minVal, maxVal, Number.isFinite(adjustment) ? adjustment : 0, currentTierId, plan_id]
        );
      }

      let nextSortOrder = null;
      for (let index = 0; index < newMinValues.length; index += 1) {
        const rawNewMin = newMinValues[index];
        const rawNewMax = newMaxValues[index];
        const rawNewAdjustment = newAdjustmentValues[index];
        const newMin = rawNewMin === '' || rawNewMin === undefined || rawNewMin === null
          ? null
          : parseInt(rawNewMin, 10);
        const newMax = rawNewMax === '' || rawNewMax === undefined || rawNewMax === null
          ? null
          : parseInt(rawNewMax, 10);
        const newAdjustment = Number.parseFloat(rawNewAdjustment);

        if (newMin === null && (rawNewAdjustment === '' || rawNewAdjustment === undefined || rawNewAdjustment === null)) {
          continue;
        }

        if (newMin === null || !Number.isFinite(newAdjustment)) {
          throw new Error('Invalid new student tier row');
        }

        if (nextSortOrder === null) {
          const sortOrder = await client.query(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM plan_student_tiers WHERE plan_id = $1',
            [plan_id]
          );
          nextSortOrder = Number(sortOrder.rows[0].next || 1);
        }

        const label = newMax != null ? `${newMin} – ${newMax} students` : `${newMin}+ students`;
        await client.query(
          `INSERT INTO plan_student_tiers (plan_id, label, min_students, max_students, price_usd, adjustment_percentage, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [plan_id, label, newMin, newMax, 0, newAdjustment, nextSortOrder]
        );
        nextSortOrder += 1;
      }

      await client.query('COMMIT');
      req.flash('success', 'Student tiers saved.');
    } catch (error) {
      await client.query('ROLLBACK');
      req.flash('error', 'Failed to save student tiers.');
    } finally {
      client.release();
    }

    res.redirect('/admin/servicePricing');
  },

  deleteStudentTier: async (req, res) => {
    const { tier_id } = req.body;
    try {
      // Check if any org is using this tier
      const usage = await db.query('SELECT COUNT(*) AS cnt FROM organizations WHERE selected_student_tier_id = $1', [tier_id]);
      if (parseInt(usage.rows[0].cnt, 10) > 0) {
        req.flash("error", `Cannot delete: ${usage.rows[0].cnt} organization(s) are using this tier. Reassign them first.`);
        return res.redirect("/admin/servicePricing");
      }
      await db.query('DELETE FROM plan_student_tiers WHERE id = $1', [tier_id]);
      req.flash("success", "Student tier deleted.");
    } catch (error) {
      req.flash("error", "Failed to delete student tier.");
    }
    res.redirect("/admin/servicePricing");
  },

  getStudentTiers: async (req, res) => {
    const { plan_id } = req.query;
    try {
      const result = await db.query(
        'SELECT * FROM plan_student_tiers WHERE plan_id = $1 ORDER BY sort_order, min_students',
        [plan_id]
      );
      return res.json({ success: true, tiers: result.rows });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to fetch student tiers.' });
    }
  },

  deleteEmployment: async (req, res) => {
    await ensureEmploymentSchema(db);

    const { id } = req.params;
    try {
      await db.query(`DELETE FROM employment WHERE id = $1`, [id]);
      req.flash("success", "Job deleted.");
    } catch (err) {
            req.flash("error", "Error deleting job.");
    }
    res.redirect("/admin/employment");
  },

  approveEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const applicationResult = await db.query(
        `SELECT
          ea.id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.status,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        WHERE ea.id = $1`,
        [applicationId]
      );

      if (!applicationResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const application = applicationResult.rows[0];

      if (application.status !== "pending") {
        req.flash("error", "Only pending applications can be approved. Reverse rejection first if needed.");
        return res.redirect("/admin/employment");
      }

      const updateResult = await db.query(
        `UPDATE employment_applications
         SET status = 'approved',
             interview_stage = 'first',
             rejection_reason = NULL,
             reviewed_at = CURRENT_TIMESTAMP,
             stage_updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id`,
        [applicationId]
      );

      if (!updateResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const interviewInviteUrl = EMPLOYMENT_INTERVIEW_INVITE_URL;
      const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
      const html = renderCleanEmail({
        title: "Employment Application Approved",
        greeting: `Dear <strong>${he.encode(application.first_name)} ${he.encode(application.last_name)}</strong>,`,
        paragraphs: [
          `Thank you for applying for the ${he.encode(application.job_title)} position at Managira.`,
          "We are pleased to inform you that your application has been approved for the next stage of the selection process.",
          `As a next step, please schedule an interview at a time that works for you using the link below:`,
          `<a href="${interviewInviteUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;word-break:break-all;">${interviewInviteUrl}</a>`,
          "If you have any questions in the meantime, please feel free to reply to this email.",
        ],
        details: [
          { label: "Position", value: he.encode(application.job_title) },
          { label: "Application Status", value: "Approved for Next Stage" },
        ],
        cta: { url: interviewInviteUrl, text: "Open Interview Link" },
        followManagira: true,
        linkedinUrl,
        noReply: false,
      });

      sendEmailInBackground(
        {
          to: application.email,
          subject: `Your ${application.job_title} application has been approved`,
          html,
        },
        "Employment Approval Email"
      );

      req.flash("success", "Application approved and notification email queued.");
    } catch (error) {
      req.flash("error", "Failed to approve application.");
    }

    return res.redirect("/admin/employment");
  },

  rejectEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);
    const rejectionReason = (req.body.rejection_reason || "").trim();

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const applicationResult = await db.query(
        `SELECT
          ea.id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.status,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        WHERE ea.id = $1`,
        [applicationId]
      );

      if (!applicationResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const application = applicationResult.rows[0];

      const details = [
        { label: "Position", value: application.job_title },
        { label: "Application Status", value: "Rejected" },
      ];
      if (rejectionReason) {
        details.push({ label: "Reason", value: rejectionReason });
      }

      const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
      const html = renderCleanEmail({
        title: "Employment Application Update",
        greeting: `Dear <strong>${he.encode(application.first_name)} ${he.encode(application.last_name)}</strong>,`,
        paragraphs: [
          `Thank you for your interest in the ${he.encode(application.job_title)} position at Managira and for the time you took to apply.`,
          "We received a high volume of applications for this role, and after careful consideration we are sorry to share that we will not be moving forward with your application at this stage. This decision is in no way a reflection of your abilities, and we genuinely appreciate the effort you put into your submission.",
          "Please be assured that Managira is continuously hiring as we grow. New openings are posted on our LinkedIn page as soon as they become available, and we would be glad to consider you for future roles that match your experience.",
          `You can follow Managira on LinkedIn here: <a href="${linkedinUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">linkedin.com/company/managira</a>.`,
          "We wish you the very best in your job search and thank you again for considering Managira.",
        ],
        details,
        noReply: true,
      });

      sendEmailInBackground(
        {
          to: application.email,
          subject: `Update on your ${application.job_title} application`,
          html,
          headers: {
            'X-Managira-Category': 'employment-decision',
            'X-Managira-Transactional': 'true',
          },
          attachments: [
            {
              filename: "managira.png",
              path: path.join(__dirname, "../public/images/managira.png"),
              cid: "managira_logo",
            },
          ],
        },
        "Employment Rejection Email"
      );

      await db.query(
        `UPDATE employment_applications
         SET status = 'rejected',
             rejection_reason = $2,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [applicationId, rejectionReason || null]
      );

      req.flash("success", "Application rejected and notification email queued.");
    } catch (error) {
      req.flash("error", "Failed to reject application.");
    }

    return res.redirect("/admin/employment");
  },

  reverseEmploymentRejection: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const applicationResult = await db.query(
        `SELECT
          ea.id,
          ea.first_name,
          ea.last_name,
          ea.email,
          ea.status,
          e.title AS job_title
        FROM employment_applications ea
        JOIN employment e ON e.id = ea.employment_id
        WHERE ea.id = $1`,
        [applicationId]
      );

      if (!applicationResult.rows.length) {
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }

      const application = applicationResult.rows[0];
      if (application.status !== "rejected") {
        req.flash("error", "Only rejected applications can be reversed.");
        return res.redirect("/admin/employment");
      }

      const html = renderCleanEmail({
        title: "Update on Your Employment Application",
        greeting: `Dear <strong>${he.encode(application.first_name)} ${he.encode(application.last_name)}</strong>,`,
        paragraphs: [
          `Please disregard the previous email regarding your application for the ${application.job_title} position.`,
          "Following an additional review, we are pleased to inform you that your application has been reopened and is currently under consideration.",
          "Our team will share a further update with you shortly regarding next steps.",
        ],
        details: [
          { label: "Position", value: application.job_title },
          { label: "Application Status", value: "Reopened for Review" },
        ],
        noReply: true,
      });

      sendEmailInBackground(
        {
          to: application.email,
          subject: `Update: ${application.job_title} application reconsideration`,
          html,
          attachments: [
            {
              filename: "managira.png",
              path: path.join(__dirname, "../public/images/managira.png"),
              cid: "managira_logo",
            },
          ],
        },
        "Employment Reversal Email"
      );

      await db.query(
        `UPDATE employment_applications
         SET status = 'pending',
             rejection_reason = NULL,
             interview_stage = 'none',
             reviewed_at = CURRENT_TIMESTAMP,
             stage_updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [applicationId]
      );

      req.flash("success", "Rejection reversed and applicant notified by email.");
    } catch (error) {
      req.flash("error", "Failed to reverse rejection.");
    }

    return res.redirect("/admin/employment");
  },

  deleteEmploymentApplication: async (req, res) => {
    await ensureEmploymentSchema(db);

    const applicationId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const deleteResult = await db.query(
        `DELETE FROM employment_applications WHERE id = $1 RETURNING id`,
        [applicationId]
      );

      if (!deleteResult.rows.length) {
        req.flash("error", "Application not found.");
      } else {
        req.flash("success", "Application deleted.");
      }
    } catch (error) {
      req.flash("error", "Failed to delete application.");
    }

    return res.redirect("/admin/employment");
  },

  // ===== Multi-stage interview workflow =====
  sendSecondInterviewInvite: async (req, res) => {
    await ensureEmploymentSchema(db);
    const applicationId = Number.parseInt(req.params.id, 10);
    const customMessage = (req.body.custom_message || "").trim();
    const useTemplate = req.body.use_template === "true" || req.body.use_template === "on" || req.body.use_template === true;

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const r = await db.query(
        `SELECT ea.id, ea.first_name, ea.last_name, ea.email, ea.status, ea.interview_stage, e.title AS job_title
         FROM employment_applications ea JOIN employment e ON e.id = ea.employment_id WHERE ea.id = $1`,
        [applicationId]
      );
      if (!r.rows.length) { req.flash("error", "Application not found."); return res.redirect("/admin/employment"); }
      const app = r.rows[0];
      if (app.status !== 'approved') {
        req.flash("error", "Applicant must be approved before sending a second interview invite.");
        return res.redirect("/admin/employment");
      }
      if (app.interview_stage === 'second' || app.interview_stage === 'final') {
        req.flash("error", "This applicant has already been moved past the first interview stage.");
        return res.redirect("/admin/employment");
      }

      const interviewInviteUrl = EMPLOYMENT_INTERVIEW_INVITE_URL;
      const proposalEmail = "managirasms@gmail.com";
      const templateMessage = `Congratulations on moving forward to the second interview! As preparation, please prepare a short written proposal describing how you would help improve and grow Managira in your local area over the next 6 months. Outline the strategy, the activities you would lead, and the measurable results you expect to achieve. Email your proposal to <a href="mailto:${proposalEmail}" style="color:#0f766e;">${proposalEmail}</a> before your second interview. When joining the interview, please include a note that this is your second interview.`;

      const messageHtml = useTemplate
        ? templateMessage
        : (customMessage ? he.encode(customMessage).replace(/\n/g, '<br>') : templateMessage);

      const html = renderCleanEmail({
        title: "Invitation to Your Second Interview",
        greeting: `Dear <strong>${he.encode(app.first_name)} ${he.encode(app.last_name)}</strong>,`,
        paragraphs: [
          `Congratulations! We are pleased to invite you to the second interview stage for the ${he.encode(app.job_title)} position at Managira.`,
          messageHtml,
          `Please schedule your second interview using the link below and include <strong>"Second Interview"</strong> in your message/note:`,
          `<a href="${interviewInviteUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;word-break:break-all;">${interviewInviteUrl}</a>`,
        ],
        details: [
          { label: "Position", value: he.encode(app.job_title) },
          { label: "Stage", value: "Second Interview" },
        ],
        cta: { url: interviewInviteUrl, text: "Open Interview Link" },
        noReply: false,
      });

      sendEmailInBackground(
        { to: app.email, subject: `Second interview invitation — ${app.job_title}`, html },
        "Second Interview Invite Email"
      );

      await db.query(
        `UPDATE employment_applications SET interview_stage = 'second', second_interview_message = $2, stage_updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [applicationId, useTemplate ? templateMessage : (customMessage || templateMessage)]
      );

      req.flash("success", "Second interview invitation sent.");
    } catch (e) {
      req.flash("error", "Failed to send second interview invitation.");
    }
    return res.redirect("/admin/employment");
  },

  sendFinalInterviewInvite: async (req, res) => {
    await ensureEmploymentSchema(db);
    const applicationId = Number.parseInt(req.params.id, 10);
    const customMessage = (req.body.custom_message || "").trim();

    if (!Number.isInteger(applicationId)) {
      req.flash("error", "Invalid application selected."); return res.redirect("/admin/employment");
    }
    try {
      const r = await db.query(
        `SELECT ea.id, ea.first_name, ea.last_name, ea.email, ea.status, ea.interview_stage, e.title AS job_title
         FROM employment_applications ea JOIN employment e ON e.id = ea.employment_id WHERE ea.id = $1`,
        [applicationId]
      );
      if (!r.rows.length) { req.flash("error", "Application not found."); return res.redirect("/admin/employment"); }
      const app = r.rows[0];
      if (app.status !== 'approved') {
        req.flash("error", "Applicant must be approved before sending a final interview invite.");
        return res.redirect("/admin/employment");
      }
      if (app.interview_stage === 'final') {
        req.flash("error", "This applicant has already been sent the final interview invite.");
        return res.redirect("/admin/employment");
      }

      const interviewInviteUrl = EMPLOYMENT_INTERVIEW_INVITE_URL;
      const defaultMsg = `This is the final stage — a conversation with the wider Managira team. Please come prepared to discuss your proposal and how you envision working with us long term.`;
      const messageHtml = customMessage ? he.encode(customMessage).replace(/\n/g, '<br>') : defaultMsg;

      const html = renderCleanEmail({
        title: "Final Interview with the Managira Team",
        greeting: `Dear <strong>${he.encode(app.first_name)} ${he.encode(app.last_name)}</strong>,`,
        paragraphs: [
          `Congratulations on reaching the final stage of our hiring process for the ${he.encode(app.job_title)} position!`,
          messageHtml,
          `Please join your final interview using the link below and include <strong>"Final Interview"</strong> in your message/note:`,
          `<a href="${interviewInviteUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;word-break:break-all;">${interviewInviteUrl}</a>`,
        ],
        details: [
          { label: "Position", value: he.encode(app.job_title) },
          { label: "Stage", value: "Final Interview with Team" },
        ],
        cta: { url: interviewInviteUrl, text: "Open Interview Link" },
        noReply: false,
      });

      sendEmailInBackground(
        { to: app.email, subject: `Final interview invitation — ${app.job_title}`, html },
        "Final Interview Invite Email"
      );

      await db.query(
        `UPDATE employment_applications SET interview_stage = 'final', final_interview_message = $2, stage_updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [applicationId, customMessage || defaultMsg]
      );

      req.flash("success", "Final interview invitation sent.");
    } catch (e) {
      req.flash("error", "Failed to send final interview invitation.");
    }
    return res.redirect("/admin/employment");
  },

  rejectAtInterviewStage: async (req, res) => {
    await ensureEmploymentSchema(db);
    const applicationId = Number.parseInt(req.params.id, 10);
    const rejectionReason = (req.body.rejection_reason || "").trim();
    if (!Number.isInteger(applicationId)) { req.flash("error","Invalid application selected."); return res.redirect("/admin/employment"); }

    try {
      const r = await db.query(
        `SELECT ea.id, ea.first_name, ea.last_name, ea.email, ea.status, ea.interview_stage, e.title AS job_title
         FROM employment_applications ea JOIN employment e ON e.id = ea.employment_id WHERE ea.id = $1`,
        [applicationId]
      );
      if (!r.rows.length) { req.flash("error","Application not found."); return res.redirect("/admin/employment"); }
      const app = r.rows[0];
      const stageLabel = app.interview_stage === 'second' ? 'second interview' : (app.interview_stage === 'final' ? 'final interview' : 'interview');

      const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
      const details = [
        { label: "Position", value: app.job_title },
        { label: "Application Status", value: `Not Moving Forward After ${stageLabel.charAt(0).toUpperCase() + stageLabel.slice(1)}` },
      ];
      if (rejectionReason) details.push({ label: "Reason", value: rejectionReason });

      const html = renderCleanEmail({
        title: "Update on Your Application",
        greeting: `Dear <strong>${he.encode(app.first_name)} ${he.encode(app.last_name)}</strong>,`,
        paragraphs: [
          `Thank you for taking the time to interview with us for the ${he.encode(app.job_title)} position at Managira and for engaging with us through the ${stageLabel} stage.`,
          "We truly appreciated learning more about you. After careful consideration, we regret to inform you that we will not be moving forward with your application at this time. This decision was difficult given the strength of the candidates we have spoken with.",
          "We would love to keep in touch — Managira continues to grow, and new openings are posted regularly on our LinkedIn page.",
          `Follow Managira on LinkedIn here: <a href="${linkedinUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">linkedin.com/company/managira</a>.`,
          "We wish you every success in the next steps of your career.",
        ],
        details,
        noReply: true,
      });

      sendEmailInBackground(
        { to: app.email, subject: `Update on your ${app.job_title} application`, html },
        "Employment Stage Rejection Email"
      );

      await db.query(
        `UPDATE employment_applications SET status='rejected', rejection_reason=$2, reviewed_at=CURRENT_TIMESTAMP, stage_updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [applicationId, rejectionReason || null]
      );

      req.flash("success", "Applicant notified of decision.");
    } catch (e) {
      req.flash("error", "Failed to send rejection.");
    }
    return res.redirect("/admin/employment");
  },

  hireApplicant: async (req, res) => {
    await ensureEmploymentSchema(db);
    const applicationId = Number.parseInt(req.params.id, 10);
    const isAjaxRequest = req.get("X-Requested-With") === "XMLHttpRequest";
    if (!Number.isInteger(applicationId)) {
      if (isAjaxRequest) {
        return res.status(400).json({ success: false, message: "Invalid application selected." });
      }
      req.flash("error", "Invalid application selected.");
      return res.redirect("/admin/employment");
    }

    try {
      const r = await db.query(
        `SELECT ea.id, ea.first_name, ea.last_name, ea.email, ea.status, ea.interview_stage, e.title AS job_title
         FROM employment_applications ea JOIN employment e ON e.id = ea.employment_id WHERE ea.id = $1`,
        [applicationId]
      );
      if (!r.rows.length) {
        if (isAjaxRequest) {
          return res.status(404).json({ success: false, message: "Application not found." });
        }
        req.flash("error", "Application not found.");
        return res.redirect("/admin/employment");
      }
      const app = r.rows[0];
      const allowedStages = new Set(["none", "first", "second", "final"]);
      const normalizedStage = String(app.interview_stage || "none").toLowerCase();
      if (app.status !== "approved" || !allowedStages.has(normalizedStage)) {
        const message = "Only approved applicants at the 1st, 2nd, or final interview stage can be marked as hired.";
        if (isAjaxRequest) {
          return res.status(400).json({ success: false, message });
        }
        req.flash("error", message);
        return res.redirect("/admin/employment");
      }

      await db.query(
        `UPDATE employment_applications
         SET status = 'hired',
             interview_stage = 'completed',
             reviewed_at = CURRENT_TIMESTAMP,
             stage_updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [applicationId]
      );

      const message = `${app.first_name} ${app.last_name} has been marked as hired.`;
      if (isAjaxRequest) {
        return res.json({ success: true, message });
      }
      req.flash("success", message);
    } catch (e) {
      if (isAjaxRequest) {
        return res.status(500).json({ success: false, message: "Failed to mark applicant as hired." });
      }
      req.flash("error", "Failed to mark applicant as hired.");
    }
    return res.redirect("/admin/employment");
  },

  getDonationsAdmin: async (req, res) => {
    const donations = await db.query(
      `SELECT * FROM donations ORDER BY created_at DESC`
    );
    res.render("admin/manageDonations", {
      title: "Manage Donations",
      donations: donations.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  postDonation: async (req, res) => {
    const { title, description, external_link } = req.body;
    const file = req.file;

    if (!title || !description || !external_link || !file) {
      req.flash("error", "All fields including an image are required.");
      return res.redirect("/admin/donations");
    }

    try {
      const uploadResult = await uploadToS3(file);
      await db.query(
        `INSERT INTO donations (title, description, external_link, image_url, s3_key) VALUES ($1, $2, $3, $4, $5)`,
        [
          title,
          description,
          external_link,
          uploadResult.Location,
          uploadResult.Key,
        ]
      );
      req.flash("success", "Donation created.");
    } catch (err) {
            req.flash("error", "Failed to save donation.");
    }

    res.redirect("/admin/donations");
  },

  deleteDonation: async (req, res) => {
    const { id } = req.params;
    const { imageKey } = req.query;

    try {
      await deleteFromS3(imageKey);
      await db.query(`DELETE FROM donations WHERE id = $1`, [id]);
      req.flash("success", "Donation deleted.");
    } catch (err) {
            req.flash("error", "Error deleting donation.");
    }

    res.redirect("/admin/donations");
  },

  getAdminAnnouncements: async (req, res) => {
    try {
      await ensureAdminEmailCampaignSchema(db);
      await ensureAdminAnnouncementSchema(db);
      const [announcementResult, campaigns] = await Promise.all([
        db.query(`SELECT * FROM admin_announcements ORDER BY created_at DESC`),
        fetchAdminEmailCampaigns(),
      ]);

      res.render("admin/adminAnnouncements", {
        title: "Manage Admin Announcements",
        announcements: announcementResult.rows,
        campaigns,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load announcements.");
      res.redirect("/admin");
    }
  },

  getEmailSuppressionsPage: async (req, res) => {
    try {
      await ensureEmailSuppressionSchema(db);

      const searchTerm = String(req.query.q || "").trim();
      const params = [];
      let whereSql = "";

      if (searchTerm) {
        params.push(`%${searchTerm}%`);
        whereSql = "WHERE s.email ILIKE $1 OR s.reason ILIKE $1";
      }

      const suppressionQuery = `
        SELECT
          s.email,
          s.reason,
          s.last_error,
          s.failure_count,
          s.first_seen,
          s.last_seen,
          o.organization_id,
          o.organization_name
        FROM email_suppression_list s
        LEFT JOIN organizations o
          ON LOWER(TRIM(o.email)) = s.email
        ${whereSql}
        ORDER BY s.last_seen DESC
        LIMIT 500
      `;

      const countQuery = `
        SELECT COUNT(*)::int AS total
        FROM email_suppression_list s
        ${whereSql}
      `;

      const [suppressionResult, countResult] = await Promise.all([
        db.query(suppressionQuery, params),
        db.query(countQuery, params),
      ]);

      return res.render("admin/emailSuppressions", {
        title: "Email Suppression Manager",
        suppressedEmails: suppressionResult.rows,
        totalSuppressed: countResult.rows[0]?.total || 0,
        searchTerm,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[admin] getEmailSuppressionsPage error:", error && error.message);
      req.flash("error", "Failed to load suppression emails.");
      return res.redirect("/admin");
    }
  },

  removeEmailSuppression: async (req, res) => {
    try {
      const email = normalizeEmailAddress(req.body?.email || req.params?.email || "");
      if (!email) {
        req.flash("error", "Email is required.");
        return res.redirect("/admin/email-suppressions");
      }

      await ensureEmailSuppressionSchema(db);
      await unsuppressEmail(db, email);

      req.flash("success", `${email} was removed from suppression.`);
      return res.redirect("/admin/email-suppressions");
    } catch (error) {
      console.error("[admin] removeEmailSuppression error:", error && error.message);
      req.flash("error", "Failed to remove suppression entry.");
      return res.redirect("/admin/email-suppressions");
    }
  },

  // Standalone form page, loaded inside the ManagiraDrawer iframe from the
  // "+ New Announcement" button on /admin/announcements (see adminDrawer.js).
  // Posts to the existing /admin/announcements route unchanged - on success
  // that redirects back to /admin/announcements, which the drawer detects
  // via iframe path match and reloads the parent list, same convention as
  // the Modify Employee drawer.
  newAdminAnnouncementForm: async (req, res) => {
    res.render("admin/adminAnnouncementForm", {
      title: "New Admin Announcement",
      messages: req.flash(),
      hideGlobalHeader: true,
      hideGlobalFooter: true,
    });
  },

  createAdminAnnouncement: async (req, res) => {
    const { title, description } = req.body;
    const showForAdmins = req.body.show_for_admins === 'on'
      || req.body.show_for_admins === 'true'
      || req.body.show_for_admins === '1';
    if (!title || !description) {
      req.flash("error", "Both title and description are required.");
      return res.redirect("/admin/announcements");
    }

    try {
      await ensureAdminAnnouncementSchema(db);
      await db.query(
        `INSERT INTO admin_announcements (title, description, is_active, show_for_admins)
         VALUES ($1, $2, TRUE, $3)`,
        [title, description, showForAdmins]
      );
      req.flash("success", "Announcement created.");
    } catch (error) {
            req.flash("error", "Failed to create announcement.");
    }

    res.redirect("/admin/announcements");
  },

  // Mark an admin-targeted announcement as seen for the current admin-side user.
  // Idempotent — repeated calls don't create duplicate rows.
  markAdminAnnouncementSeen: async (req, res) => {
    const userId = req.session && req.session.userId;
    const announcementId = parseInt(req.params.id, 10);
    if (!userId || !Number.isFinite(announcementId)) {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }
    try {
      await ensureAdminAnnouncementSchema(db);
      await db.query(
        `INSERT INTO announcement_views (user_id, announcement_id, last_viewed)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, announcement_id)
         DO UPDATE SET last_viewed = CURRENT_TIMESTAMP`,
        [userId, announcementId]
      );
      return res.json({ success: true });
    } catch (error) {
      console.error('[markAdminAnnouncementSeen] error:', error && error.message);
      return res.status(500).json({ success: false, message: "Could not mark announcement as seen." });
    }
  },

  toggleAdminAnnouncement: async (req, res) => {
    const { id } = req.params;
    try {
      await db.query(
        `UPDATE admin_announcements SET is_active = NOT is_active WHERE id = $1`,
        [id]
      );
      req.flash("success", "Announcement status toggled.");
    } catch (error) {
            req.flash("error", "Failed to update announcement.");
    }

    res.redirect("/admin/announcements");
  },

  deleteAdminAnnouncement: async (req, res) => {
    const { id } = req.params;
    try {
      await db.query(`DELETE FROM admin_announcements WHERE id = $1`, [id]);
      req.flash("success", "Announcement deleted.");
    } catch (error) {
            req.flash("error", "Failed to delete announcement.");
    }

    res.redirect("/admin/announcements");
  },

  listAdminEmailCampaigns: async (req, res) => {
    try {
      const campaigns = await fetchAdminEmailCampaigns();
      return res.json({ success: true, campaigns });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to load scheduled emails." });
    }
  },

  searchAdminEmailRecipients: async (req, res) => {
    try {
      const organizationId = req.session?.organizationId;
      if (!organizationId) {
        return res.status(400).json({ success: false, message: "Organization context is required." });
      }

      const query = String(req.query.q || "").trim();
      const params = [organizationId];
      let whereClause = "WHERE organization_id = $1 AND email IS NOT NULL";

      if (query) {
        params.push(`%${query}%`);
        whereClause += ` AND (
          CONCAT_WS(' ', first_name, last_name) ILIKE $2
          OR CONCAT_WS(', ', last_name, first_name) ILIKE $2
          OR email ILIKE $2
          OR account_type::text ILIKE $2
        )`;
      }

      const result = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, organization_id
         FROM users
         ${whereClause}
         ORDER BY first_name, last_name, email
         LIMIT 25`,
        params
      );

      return res.json({
        success: true,
        users: result.rows.map((user) => ({
          userId: user.user_id,
          name: formatDisplayName(user, req.session?.nameDisplayFormat) || buildUserFullName(user),
          email: user.email,
          accountType: user.account_type,
          organizationId: user.organization_id,
        })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to search users." });
    }
  },

  createAdminEmailCampaign: async (req, res) => {
    try {
      const campaigns = await createOrUpdateAdminEmailCampaign({
        payload: req.body,
        actorUserId: req.session?.userId,
      });

      return res.status(201).json({ success: true, campaigns, message: "Scheduled email created." });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Failed to create scheduled email." });
    }
  },

  updateAdminEmailCampaign: async (req, res) => {
    const campaignId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid scheduled email selected." });
    }

    try {
      const campaigns = await createOrUpdateAdminEmailCampaign({
        payload: req.body,
        campaignId,
        actorUserId: req.session?.userId,
      });

      return res.json({ success: true, campaigns, message: "Scheduled email updated." });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Failed to update scheduled email." });
    }
  },

  toggleAdminEmailCampaign: async (req, res) => {
    const campaignId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid scheduled email selected." });
    }

    try {
      await ensureAdminEmailCampaignSchema(db);
      const currentResult = await db.query(`SELECT * FROM admin_email_campaigns WHERE id = $1`, [campaignId]);
      const campaign = currentResult.rows[0];

      if (!campaign) {
        return res.status(404).json({ success: false, message: "Scheduled email not found." });
      }

      const nextIsActive = !campaign.is_active;
      const nextRunAt = nextIsActive
        ? computeNextRunAt(
            {
              frequency: campaign.frequency,
              sendTime: campaign.send_time,
              dayOfWeek: campaign.day_of_week,
              dayOfMonth: campaign.day_of_month,
              startDate: campaign.start_date,
              endDate: campaign.end_date,
            },
            new Date(),
            { allowImmediateCatchUp: true }
          )
        : null;

      await db.query(
        `UPDATE admin_email_campaigns
         SET is_active = $1,
             next_run_at = $2,
             last_error = NULL
         WHERE id = $3`,
        [nextIsActive, nextRunAt, campaignId]
      );

      const campaigns = await fetchAdminEmailCampaigns();
      return res.json({
        success: true,
        campaigns,
        message: nextIsActive ? "Scheduled email activated." : "Scheduled email deactivated.",
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to update scheduled email status." });
    }
  },

  deleteAdminEmailCampaign: async (req, res) => {
    const campaignId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid scheduled email selected." });
    }

    try {
      await ensureAdminEmailCampaignSchema(db);
      const result = await db.query(`DELETE FROM admin_email_campaigns WHERE id = $1`, [campaignId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Scheduled email not found." });
      }

      const campaigns = await fetchAdminEmailCampaigns();
      return res.json({ success: true, campaigns, message: "Scheduled email deleted." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete scheduled email." });
    }
  },

  generateOrganizationCSV: async (req, res) => {
    try {
      const { organizationId, format } = req.body;
      if (!organizationId) {
        req.flash("error", "Invalid organization selected.");
        return res.redirect("/admin/data-export");
      }

      // Fetch Organization Information
      const orgQuery = await db.query(
        `
                SELECT organization_id, organization_name, organization_address, organization_phone, 
                       email, logo_path, created_at 
                FROM organizations WHERE organization_id = $1
            `,
        [organizationId]
      );

      if (orgQuery.rows.length === 0) {
        req.flash("error", "No organization data found.");
        return res.redirect("/admin/data-export");
      }
      const organization = orgQuery.rows[0];

      // Fetch Users (Admins, Teachers, Employees)
      const usersQuery = await db.query(
        `
                SELECT user_id, first_name, last_name, email, account_type, created_at, updated_at, on_hold
                FROM users WHERE organization_id = $1
            `,
        [organizationId]
      );

      // Fetch School Years & Terms
      const termsQuery = await db.query(
        `
                SELECT sy.id AS school_year_id, sy.year_label, sy.created_at AS start_date, 
                       t.term_id AS current_term_id, t.term_name AS current_term_name, 
                       t.start_date AS term_start_date, t.end_date AS term_end_date
                FROM school_years sy
                LEFT JOIN terms t ON sy.id = t.school_year_id
                WHERE sy.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Classes & Subjects
      const classesQuery = await db.query(
        `
                SELECT c.class_id, c.class_name, g.name AS graduation_year_group, 
                       COALESCE(STRING_AGG(s.subject_name, ', '), 'No subjects assigned') AS subjects_assigned
                FROM classes c
                LEFT JOIN subjects s ON c.class_id = s.class_id
                LEFT JOIN graduation_year_groups g ON c.graduation_year_group_id = g.id
                WHERE c.organization_id = $1
                GROUP BY c.class_id, g.name
            `,
        [organizationId]
      );

      // Fetch Students Information (Include Guardian Info)
      const studentsQuery = await db.query(
        `
                SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.gender, s.hometown, 
                       c.class_name AS class, s.image_url, 
                       COALESCE(g.first_name || ' ' || g.last_name, 'No Guardian') AS guardian_name, 
                       COALESCE(g.phone, 'N/A') AS guardian_phone, 
                       COALESCE(g.email, 'N/A') AS guardian_email
                FROM students s
                LEFT JOIN classes c ON s.class_id = c.class_id
                LEFT JOIN guardians g ON s.student_id = g.student_id
                WHERE s.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Student Assessments & Scores
      const assessmentsQuery = await db.query(
        `
                SELECT ar.student_id, sub.subject_name, a.title AS assessment_title, 
                       a.weight AS assessment_weight,
                       ar.score,
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
                           WHERE sr.organization_id = ar.organization_id
                             AND sr.class_id = ar.class_id
                             AND sr.term_id = ar.term_id
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
                       ) AS grade
                FROM assessment_results ar
                LEFT JOIN assessments a ON ar.assessment_id = a.assessment_id
                LEFT JOIN subjects sub ON a.subject_id = sub.subject_id
                WHERE ar.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Attendance Records
      const attendanceQuery = await db.query(
        `
                SELECT s.student_id, c.class_name AS class, 
                       COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS total_days_present,
                       COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS total_days_absent, t.term_name AS term
                FROM attendance_records a
                LEFT JOIN students s ON a.student_id = s.student_id
                LEFT JOIN classes c ON a.class_id = c.class_id
                LEFT JOIN terms t ON a.term_id = t.term_id
                WHERE a.organization_id = $1 
                GROUP BY s.student_id, c.class_name, t.term_name
            `,
        [organizationId]
      );

      // Fetch Remarks (Teacher, Conduct, Attitude, Interest)
      const remarksQuery = await db.query(
        `
                SELECT s.student_id, 
                       COALESCE(sr.teacher_remarks, 'No remarks') AS teacher_remark, 
                       COALESCE(sr.conduct_remarks, 'No remarks') AS conduct_remark, 
                       COALESCE(sr.attitude_remarks, 'No remarks') AS attitude_remark, 
                       COALESCE(sr.interest_remarks, 'No remarks') AS interest_remark
                FROM student_reports sr
                LEFT JOIN students s ON sr.student_id = s.student_id
                WHERE sr.organization_id = $1
            `,
        [organizationId]
      );

      // Fetch Events & Announcements
      const eventsQuery = await db.query(
        `
                SELECT e.id AS event_id, e.name AS event_name, e.event_date, e.details AS event_description, 
                       COALESCE(a.message, 'No announcements') AS announcement_details
                FROM school_events e
                LEFT JOIN announcements a ON e.organization_id = a.organization_id
                WHERE e.organization_id = $1
            `,
        [organizationId]
      );

      const dataSections = {
        "Organization Details": [organization],
        Users: usersQuery.rows || [],
        "School Years & Terms": termsQuery.rows || [],
        Classes: classesQuery.rows || [],
        Students: studentsQuery.rows || [],
        Assessments: assessmentsQuery.rows || [],
        Attendance: attendanceQuery.rows || [],
        "Student Remarks": remarksQuery.rows || [],
        "Events & Announcements": eventsQuery.rows || [],
      };

      if (format === "csv") {
        const json2csvParser = new Parser({ header: true });

        let csvContent = `### ${organization.organization_name}\n`;
        csvContent += `Comprehensive Data Report From Managira\nGenerated on: ${new Date().toLocaleString()}\n\n`;

        for (const [sectionTitle, data] of Object.entries(dataSections)) {
          csvContent += `### ${sectionTitle}\n`;
          csvContent += data.length
            ? json2csvParser.parse(data) + "\n\n"
            : "No data available.\n\n";
        }

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${organization.organization_name}_Data.csv"`
        );
        res.setHeader("Content-Type", "text/csv");
        res.send(csvContent);
      } else {
        // PDF Export with Report Header
        const doc = new PDFDocument({ margin: 30 });
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${organization.organization_name}_Data.pdf"`
        );
        res.setHeader("Content-Type", "application/pdf");
        doc.pipe(res);

        // Report Title & Metadata (Header)
        doc
          .fontSize(20)
          .fillColor("black")
          .text(`${organization.organization_name}`, { align: "center" });
        doc
          .fontSize(14)
          .text("Comprehensive Data Report From Managira", { align: "center" });
        doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, {
          align: "center",
        });
        doc.moveDown(2);

        const addSection = (title, data, color) => {
          doc
            .moveDown(1)
            .fontSize(16)
            .fillColor(color)
            .text(title, { underline: true });
          doc.moveDown(0.5).fontSize(10).fillColor("black");

          if (data.length === 0) {
            doc.text("No data available.");
          } else {
            data.forEach((row, index) => {
              doc.text(`${index + 1}. ${JSON.stringify(row, null, 2)}`);
              doc.moveDown(0.5);
            });
          }
        };

        Object.entries(dataSections).forEach(([title, data], index) => {
          const colors = [
            "blue",
            "green",
            "orange",
            "purple",
            "red",
            "brown",
            "darkblue",
            "teal",
            "pink",
          ];
          addSection(title, data, colors[index % colors.length]);
        });

        doc.end();
      }
    } catch (error) {
            req.flash("error", "Failed to generate export.");
      res.redirect("/admin/data-export");
    }
  },

  // ============================================================
  // Dynamic Pricing v2 (Beta)
  // Parallel system. None of these methods touch the legacy
  // plan_student_tiers / billing_periods / live pricing logic.
  // ============================================================

  dynamicPricingGet: async (req, res) => {
    try {
      const [regionsRes, countriesRes, plansRes, pricesRes, cyclesRes] = await Promise.all([
        db.query('SELECT * FROM pricing_regions ORDER BY is_default DESC, sort_order ASC, name ASC'),
        db.query('SELECT * FROM pricing_region_countries ORDER BY country_name ASC'),
        db.query('SELECT id, name, description, is_active FROM plans ORDER BY id ASC'),
        db.query('SELECT * FROM plan_region_prices'),
        db.query('SELECT * FROM dynamic_billing_cycles ORDER BY sort_order ASC, months ASC'),
      ]);

      res.render('admin/dynamicPricing', {
        session: req.session,
        regions: regionsRes.rows,
        regionCountries: countriesRes.rows,
        plans: plansRes.rows,
        planRegionPrices: pricesRes.rows,
        cycles: cyclesRes.rows,
        countriesByContinent: COUNTRIES_BY_CONTINENT,
        countryNameLookup: COUNTRY_NAME_LOOKUP,
        dynamicDbSourceLabel: 'Primary DB',
        dynamicDbIsolated: false,
        messages: { error: req.flash('error'), success: req.flash('success') },
      });
    } catch (error) {
      console.error('dynamicPricingGet error:', error.message);
      req.flash('error', 'Failed to load dynamic pricing. Has the migration been run?');
      res.redirect('/admin/servicePricing');
    }
  },

  // --- Regions ---------------------------------------------------------

  createRegion: async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: 'Region name is required.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const sortOrder = Number(req.body.sort_order) || 0;
      let isDefault = req.body.is_default === true || req.body.is_default === 'true';
      let termMonths = parseInt(req.body.term_months, 10);
      if (!Number.isInteger(termMonths) || termMonths < 1) {
        try {
          const termMonthsResult = await client.query(
            "SELECT value FROM app_settings WHERE key = 'dynamic_term_months' LIMIT 1"
          );
          const parsed = parseInt(termMonthsResult.rows?.[0]?.value, 10);
          termMonths = Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
        } catch (_) {
          termMonths = 3;
        }
      }
      if (!isDefault) {
        const existingDefaultRes = await client.query(
          'SELECT id FROM pricing_regions WHERE is_default = TRUE AND is_active = TRUE LIMIT 1'
        );
        if (!existingDefaultRes.rows[0]) {
          isDefault = true;
        }
      }

      // Ensure this request can safely become the single default region.
      if (isDefault) {
        await client.query(
          'UPDATE pricing_regions SET is_default = FALSE, updated_at = NOW() WHERE is_default = TRUE'
        );
      }

      const result = await client.query(
        `INSERT INTO pricing_regions (name, sort_order, is_default, is_active)
         VALUES ($1, $2, $3, TRUE) RETURNING *`,
        [name, sortOrder, isDefault]
      );
      const createdRegion = result.rows[0];

      await client.query(
        `INSERT INTO app_settings(key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`dynamic_region_term_months_${createdRegion.id}`, String(termMonths)]
      );

      await client.query('COMMIT');
      return res.json({ ok: true, region: { ...createdRegion, term_months: termMonths } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        if (error.constraint === 'pricing_regions_name_key') {
          return res.status(409).json({ ok: false, error: 'A region with that name already exists.' });
        }
        if (error.constraint === 'pricing_regions_single_default') {
          return res.status(409).json({ ok: false, error: 'Only one default fallback region can exist. Try saving again.' });
        }
      }
      console.error('createRegion error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to create region.' });
    } finally {
      client.release();
    }
  },

  updateRegion: async (req, res) => {
    const regionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(regionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid region id.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const regionRes = await client.query(
        'SELECT id, is_default, is_active FROM pricing_regions WHERE id = $1 FOR UPDATE',
        [regionId]
      );
      if (!regionRes.rows[0]) {
        const err = new Error('Region not found.');
        err.statusCode = 404;
        throw err;
      }
      const currentRegion = regionRes.rows[0];
      const nextIsDefault = req.body.is_default !== undefined
        ? (req.body.is_default === true || req.body.is_default === 'true')
        : Boolean(currentRegion.is_default);
      const nextIsActive = req.body.is_active !== undefined
        ? (req.body.is_active === true || req.body.is_active === 'true')
        : Boolean(currentRegion.is_active);

      if (nextIsDefault && !nextIsActive) {
        const err = new Error('The fallback default region must remain active.');
        err.statusCode = 400;
        throw err;
      }

      if (!nextIsDefault) {
        const anotherActiveDefaultRes = await client.query(
          'SELECT id FROM pricing_regions WHERE id <> $1 AND is_default = TRUE AND is_active = TRUE LIMIT 1',
          [regionId]
        );
        if (!anotherActiveDefaultRes.rows[0]) {
          const err = new Error('At least one active default fallback region is required.');
          err.statusCode = 400;
          throw err;
        }
      }

      const fields = [];
      const values = [];
      let idx = 1;
      if (req.body.name !== undefined) {
        const nextName = String(req.body.name).trim();
        if (!nextName) {
          const err = new Error('Region name is required.');
          err.statusCode = 400;
          throw err;
        }
        fields.push(`name = $${idx++}`);
        values.push(nextName);
      }
      if (req.body.sort_order !== undefined) {
        fields.push(`sort_order = $${idx++}`);
        values.push(Number(req.body.sort_order) || 0);
      }
      if (req.body.is_active !== undefined) {
        fields.push(`is_active = $${idx++}`);
        values.push(req.body.is_active === true || req.body.is_active === 'true');
      }
      if (fields.length) {
        fields.push('updated_at = NOW()');
        values.push(regionId);
        await client.query(
          `UPDATE pricing_regions SET ${fields.join(', ')} WHERE id = $${idx}`,
          values
        );
      }

      if (req.body.term_months !== undefined) {
        const termMonths = Math.max(1, parseInt(req.body.term_months, 10) || 1);
        await client.query(
          `INSERT INTO app_settings(key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [`dynamic_region_term_months_${regionId}`, String(termMonths)]
        );
      }

      if (req.body.is_default !== undefined) {
        const wantsDefault = req.body.is_default === true || req.body.is_default === 'true';
        if (wantsDefault) {
          await client.query(
            'UPDATE pricing_regions SET is_default = FALSE, updated_at = NOW() WHERE id <> $1',
            [regionId]
          );
          await client.query(
            'UPDATE pricing_regions SET is_default = TRUE, is_active = TRUE, updated_at = NOW() WHERE id = $1',
            [regionId]
          );
        } else {
          const anotherDefaultRes = await client.query(
            'SELECT id FROM pricing_regions WHERE id <> $1 AND is_default = TRUE AND is_active = TRUE LIMIT 1',
            [regionId]
          );
          if (!anotherDefaultRes.rows[0]) {
            const err = new Error('At least one active default fallback region is required.');
            err.statusCode = 400;
            throw err;
          }
          await client.query(
            'UPDATE pricing_regions SET is_default = FALSE, updated_at = NOW() WHERE id = $1',
            [regionId]
          );
        }
      }

      // Atomically re-assign the chosen set of countries to this region.
      if (Array.isArray(req.body.countryCodes)) {
        const normalizedCodes = req.body.countryCodes
          .map((c) => String(c || '').trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c));
        const invalidCodes = Array.from(
          new Set(normalizedCodes.filter((code) => !COUNTRY_NAME_LOOKUP[code]))
        );
        if (invalidCodes.length) {
          const err = new Error(`Unsupported country code(s): ${invalidCodes.join(', ')}`);
          err.statusCode = 400;
          throw err;
        }

        const codes = Array.from(new Set(normalizedCodes));

        // Remove any of these codes from other regions first (a country lives in one region only).
        if (codes.length) {
          await client.query(
            'DELETE FROM pricing_region_countries WHERE country_code = ANY($1)',
            [codes]
          );
        }
        // Drop this region's current set, then insert the new set.
        await client.query('DELETE FROM pricing_region_countries WHERE region_id = $1', [regionId]);
        for (const code of codes) {
          const name = COUNTRY_NAME_LOOKUP[code] || code;
          await client.query(
            `INSERT INTO pricing_region_countries (region_id, country_code, country_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (country_code) DO UPDATE SET region_id = EXCLUDED.region_id, country_name = EXCLUDED.country_name`,
            [regionId, code, name]
          );
        }
      }

      await client.query('COMMIT');
      return res.json({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message || 'Failed to update region.' });
      }
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, error: 'A region with that name already exists.' });
      }
      console.error('updateRegion error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to update region.' });
    } finally {
      client.release();
    }
  },

  deleteRegion: async (req, res) => {
    const regionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(regionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid region id.' });
    }
    try {
      const check = await db.query('SELECT is_default, is_active FROM pricing_regions WHERE id = $1', [regionId]);
      if (!check.rows[0]) {
        return res.status(404).json({ ok: false, error: 'Region not found.' });
      }
      if (check.rows[0].is_default) {
        return res.status(400).json({ ok: false, error: 'The active fallback default region cannot be deleted.' });
      }
      // ON DELETE CASCADE removes its country mappings and plan_region_prices.
      await db.query('DELETE FROM pricing_regions WHERE id = $1', [regionId]);
      await db.query('DELETE FROM app_settings WHERE key = $1', [`dynamic_region_term_months_${regionId}`]);
      return res.json({ ok: true });
    } catch (error) {
      console.error('deleteRegion error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to delete region.' });
    }
  },

  // --- Plan x Region prices -------------------------------------------

  upsertPlanRegionPrice: async (req, res) => {
    const planId = parseInt(req.body.plan_id, 10);
    const regionId = parseInt(req.body.region_id, 10);
    if (!Number.isInteger(planId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan or region.' });
    }
    const parseMoney = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    };
    try {
      const base = parseMoney(req.body.base_price_usd);
      const threshold = Number.parseInt(req.body.free_student_threshold, 10);
      const rate = parseMoney(req.body.per_student_rate_usd);

      if (!Number.isFinite(base) || base < 0 || base > 1000000) {
        return res.status(400).json({ ok: false, error: 'Base price must be between 0 and 1,000,000.' });
      }
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000000) {
        return res.status(400).json({ ok: false, error: 'Free-student threshold must be a whole number between 0 and 1,000,000.' });
      }
      if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
        return res.status(400).json({ ok: false, error: 'Per-student monthly rate must be between 0 and 100,000.' });
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        const [planCheck, regionCheck] = await Promise.all([
          client.query('SELECT id FROM plans WHERE id = $1 LIMIT 1', [planId]),
          client.query('SELECT id FROM pricing_regions WHERE id = $1 LIMIT 1', [regionId]),
        ]);
        if (!planCheck.rows[0]) {
          const err = new Error('Plan not found.');
          err.statusCode = 404;
          throw err;
        }
        if (!regionCheck.rows[0]) {
          const err = new Error('Region not found.');
          err.statusCode = 404;
          throw err;
        }

        const previousResult = await client.query(
          `SELECT base_price_usd, free_student_threshold, per_student_rate_usd
           FROM plan_region_prices
           WHERE plan_id = $1 AND region_id = $2
           FOR UPDATE`,
          [planId, regionId]
        );
        const previous = previousResult.rows[0] || null;

        const result = await client.query(
          `INSERT INTO plan_region_prices
             (plan_id, region_id, base_price_usd, free_student_threshold, per_student_rate_usd, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           ON CONFLICT (plan_id, region_id) DO UPDATE SET
             base_price_usd = EXCLUDED.base_price_usd,
             free_student_threshold = EXCLUDED.free_student_threshold,
             per_student_rate_usd = EXCLUDED.per_student_rate_usd,
             updated_at = NOW()
           RETURNING *`,
          [planId, regionId, base, threshold, rate]
        );

        await client.query(
          `INSERT INTO plan_region_prices_audit (
             plan_id,
             region_id,
             old_base_price_usd,
             new_base_price_usd,
             old_free_student_threshold,
             new_free_student_threshold,
             old_per_student_rate_usd,
             new_per_student_rate_usd,
             changed_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            planId,
            regionId,
            previous ? Number(previous.base_price_usd || 0) : null,
            base,
            previous ? Number(previous.free_student_threshold || 0) : null,
            threshold,
            previous ? Number(previous.per_student_rate_usd || 0) : null,
            rate,
            req.session?.userId || null,
          ]
        );

        await client.query('COMMIT');
        return res.json({ ok: true, price: result.rows[0] });
      } catch (innerError) {
        await client.query('ROLLBACK');
        throw innerError;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message || 'Failed to save price.' });
      }
      console.error('upsertPlanRegionPrice error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to save price.' });
    }
  },

  // --- Dynamic billing cycles -----------------------------------------

  createDynamicCycle: async (req, res) => {
    const cycleKey = String(req.body.cycle_key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const label = String(req.body.label || '').trim();
    const months = parseInt(req.body.months, 10);
    if (!cycleKey || !label || !Number.isInteger(months) || months < 1) {
      return res.status(400).json({ ok: false, error: 'Key, label and a months value (>= 1) are required.' });
    }
    try {
      const discount = Math.min(50, Math.max(0, parseInt(req.body.discount_percentage, 10) || 0));
      const hint = req.body.hint ? String(req.body.hint).trim() : null;
      const sortOrder = Number(req.body.sort_order) || 0;
      const result = await db.query(
        `INSERT INTO dynamic_billing_cycles (cycle_key, label, months, discount_percentage, hint, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
        [cycleKey, label, months, discount, hint, sortOrder]
      );
      return res.json({ ok: true, cycle: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, error: 'A cycle with that key already exists.' });
      }
      console.error('createDynamicCycle error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to create cycle.' });
    }
  },

  updateDynamicCycle: async (req, res) => {
    const cycleId = parseInt(req.params.id, 10);
    if (!Number.isInteger(cycleId)) {
      return res.status(400).json({ ok: false, error: 'Invalid cycle id.' });
    }
    try {
      const fields = [];
      const values = [];
      let idx = 1;
      if (req.body.label !== undefined) {
        fields.push(`label = $${idx++}`);
        values.push(String(req.body.label).trim());
      }
      if (req.body.months !== undefined) {
        const months = parseInt(req.body.months, 10);
        if (!Number.isInteger(months) || months < 1) {
          return res.status(400).json({ ok: false, error: 'Months must be >= 1.' });
        }
        fields.push(`months = $${idx++}`);
        values.push(months);
      }
      if (req.body.discount_percentage !== undefined) {
        fields.push(`discount_percentage = $${idx++}`);
        values.push(Math.min(50, Math.max(0, parseInt(req.body.discount_percentage, 10) || 0)));
      }
      if (req.body.hint !== undefined) {
        fields.push(`hint = $${idx++}`);
        values.push(req.body.hint ? String(req.body.hint).trim() : null);
      }
      if (req.body.sort_order !== undefined) {
        fields.push(`sort_order = $${idx++}`);
        values.push(Number(req.body.sort_order) || 0);
      }
      if (req.body.is_active !== undefined) {
        fields.push(`is_active = $${idx++}`);
        values.push(req.body.is_active === true || req.body.is_active === 'true');
      }
      if (!fields.length) {
        return res.json({ ok: true });
      }
      fields.push('updated_at = NOW()');
      values.push(cycleId);
      await db.query(`UPDATE dynamic_billing_cycles SET ${fields.join(', ')} WHERE id = $${idx}`, values);
      return res.json({ ok: true });
    } catch (error) {
      console.error('updateDynamicCycle error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to update cycle.' });
    }
  },

  deleteDynamicCycle: async (req, res) => {
    const cycleId = parseInt(req.params.id, 10);
    if (!Number.isInteger(cycleId)) {
      return res.status(400).json({ ok: false, error: 'Invalid cycle id.' });
    }
    try {
      await db.query('DELETE FROM dynamic_billing_cycles WHERE id = $1', [cycleId]);
      return res.json({ ok: true });
    } catch (error) {
      console.error('deleteDynamicCycle error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to delete cycle.' });
    }
  },

  updateDynamicTermMonths: async (req, res) => {
    try {
      const months = Math.max(1, parseInt(req.body.months, 10) || 3);
      const divider = months;
      await db.query(
        `INSERT INTO app_settings(key, value)
         VALUES ('dynamic_term_months', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(months)]
      );
      await db.query(
        `INSERT INTO app_settings(key, value)
         VALUES ('dynamic_term_divider', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(divider)]
      );
      await db.query(
        `INSERT INTO dynamic_billing_cycles (cycle_key, label, months, discount_percentage, hint, is_active, sort_order)
         VALUES ('term', 'Per Term', $1, 0, 'Paid monthly', TRUE, 2)
         ON CONFLICT (cycle_key) DO UPDATE SET
           label = EXCLUDED.label,
           months = EXCLUDED.months,
           discount_percentage = EXCLUDED.discount_percentage,
           hint = EXCLUDED.hint,
           is_active = TRUE,
           updated_at = NOW()`,
        [months]
      );
      return res.json({ ok: true, months, divider });
    } catch (error) {
      console.error('updateDynamicTermMonths error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to save term months.' });
    }
  },

  // --- Customer preview simulator -------------------------------------

  previewDynamicPrice: async (req, res) => {
    try {
      const planId = parseInt(req.body.plan_id, 10);
      const studentCount = Math.max(0, parseInt(req.body.student_count, 10) || 0);
      const countryCode = req.body.country_code ? String(req.body.country_code).trim().toUpperCase() : null;
      const cycleKey = req.body.cycle_key ? String(req.body.cycle_key).trim() : null;
      let monthsPerTerm = 1;

      try {
        const termMonthsResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'dynamic_term_months' LIMIT 1"
        );
        const parsedTermMonths = parseInt(termMonthsResult.rows?.[0]?.value, 10);
        if (Number.isInteger(parsedTermMonths) && parsedTermMonths > 0) {
          monthsPerTerm = parsedTermMonths;
        } else {
          const dividerResult = await db.query(
            "SELECT value FROM app_settings WHERE key = 'dynamic_term_divider' LIMIT 1"
          );
          const parsedDivider = parseInt(dividerResult.rows?.[0]?.value, 10);
          if (Number.isInteger(parsedDivider) && parsedDivider > 0) {
            monthsPerTerm = parsedDivider;
          }
        }
      } catch (_) {
      }

      if (!Number.isInteger(planId)) {
        return res.status(400).json({ ok: false, error: 'A plan must be selected.' });
      }

      const region = await getRegionForCountry(db, countryCode);
      if (!region) {
        return res.status(400).json({ ok: false, error: 'No region available. Create a default region first.' });
      }

      try {
        const regionTermResult = await db.query(
          'SELECT value FROM app_settings WHERE key = $1 LIMIT 1',
          [`dynamic_region_term_months_${region.id}`]
        );
        const parsedRegionTermMonths = parseInt(regionTermResult.rows?.[0]?.value, 10);
        if (Number.isInteger(parsedRegionTermMonths) && parsedRegionTermMonths > 0) {
          monthsPerTerm = parsedRegionTermMonths;
        }
      } catch (_) {
      }

      const priceRow = await getPlanRegionPrice(db, planId, region.id);
      if (!priceRow) {
        return res.json({
          ok: true,
          region,
          hasPrice: false,
          message: `No price configured for this plan in "${region.name}".`,
        });
      }

      const monthly = computeDynamicMonthlyPrice(priceRow, studentCount, { monthsPerTerm });

      let cycle = null;
      let cycleBreakdown = null;
      if (cycleKey) {
        const cyclesRes = await db.query(
          'SELECT * FROM dynamic_billing_cycles WHERE cycle_key = $1 AND is_active = TRUE',
          [cycleKey]
        );
        cycle = cyclesRes.rows[0] || null;
        if (cycle) {
          cycleBreakdown = applyCycle(monthly.monthlyTotal, cycle);
        }
      }

      return res.json({
        ok: true,
        hasPrice: true,
        region: { id: region.id, name: region.name, is_default: region.is_default },
        studentCount,
        monthly,
        cycle,
        cycleBreakdown,
      });
    } catch (error) {
      console.error('previewDynamicPrice error:', error.message);
      return res.status(500).json({ ok: false, error: 'Failed to compute preview.' });
    }
  },
};

async function sendEmailNotification(to, subject, text) {
  const rawText = String(text || "").trim();
  const chunks = rawText
    ? rawText
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  let greeting = "Hello,";
  const paragraphs = [];

  chunks.forEach((part, index) => {
    if (index === 0 && /^dear\s+/i.test(part)) {
      greeting = he.encode(part.replace(/\s*,$/, "")) + ",";
      return;
    }

    if (/^best regards/i.test(part)) {
      return;
    }

    paragraphs.push(he.encode(part));
  });

  if (paragraphs.length === 0) {
    paragraphs.push("Please review this administrative update from Managira.");
  }

  const html = renderCleanEmail({
    title: he.encode(subject || "Account Update"),
    greeting,
    paragraphs,
    note: 'For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });

  sendEmailInBackground(
    {
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'managira.png',
          path: path.join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo',
        },
      ],
    },
    "Admin Email Notification"
  );
}

async function sendAdminInviteEmail(email, firstName, lastName, link) {
  const linkedinUrl = process.env.MANAGIRA_LINKEDIN_URL || 'https://www.linkedin.com/company/managira';
  const html = renderCleanEmail({
    title: "You're Invited to Join as Admin",
    greeting: `Hello <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
    paragraphs: [
      "Managira is inviting you to join as an admin. Use the button below to set your password.",
      `For company updates and other activities from Managira, you can also follow us on LinkedIn here: <a href="${linkedinUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">linkedin.com/company/managira</a>.`,
    ],
    cta: { text: "Accept Invite & Set Password", url: he.encode(link) },
    note: 'This link will expire in 24 hours. For help, visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,
    to: email,
    subject: "Action required: set your Managira account password",
    html,
    attachments: [
      {
        filename: 'managira.png',
        path: require('path').join(__dirname, '../public/images/managira.png'),
        cid: 'managira_logo'
      }
    ]
  };
  sendEmailInBackground(mailOptions, "Admin Invite Email");
}

async function sendPasswordSetSuccessEmail(email, firstName, lastName) {
  const html = renderCleanEmail({
    title: "Password Set Successfully",
    greeting: `Hello <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
    paragraphs: [
      "Your password has been set successfully. You can now log in to Managira using your email and new password.",
      "If you did not perform this action, please contact your administrator immediately.",
    ],
    cta: { text: "Log in to Managira", url: "https://www.managira.com/account/login" },
    note: 'If you have any questions, please visit our <a href="https://docs.google.com/document/d/1bgFP5cCQyr-9jdaYZTsWO8ONAnAuNUKqKQ2if_4TBOM/edit?tab=t.o84y9ldsnqto#heading=h.o10u93e8wqgq" target="_blank" rel="noopener">User Documentation Guide</a>, <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a>, or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,
    to: email,
    subject: "Your Password Has Been Set Successfully",
    html,
    attachments: [
      {
        filename: 'managira.png',
        path: require('path').join(__dirname, '../public/images/managira.png'),
        cid: 'managira_logo'
      }
    ]
  };
  sendEmailInBackground(mailOptions, "Admin Password Success Email");
}

// =====================================================
// HUB MANAGEMENT FUNCTIONS
// =====================================================

// List all hubs
adminController.hubsListGet = async (req, res) => {
  try {
    const hubsResult = await db.query(`
      SELECT h.*, p.plan_name, p.total_cost,
             (SELECT COUNT(*) FROM organizations WHERE hub_id = h.hub_id AND deleted = false AND is_hub_member = true) as org_count
      FROM managira_hubs h
      LEFT JOIN plans p ON h.plan_id = p.id
      WHERE h.deleted = false
      ORDER BY h.created_at DESC
    `);

    res.render('admin/hubs', {
      title: 'Manage Hubs',
      hubs: hubsResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading hubs.');
    res.redirect('/admin');
  }
};

// Create hub form
adminController.hubCreateGet = async (req, res) => {
  try {
    const plansResult = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY id');
    
    res.render('admin/hubCreate', {
      title: 'Create New Hub',
      plans: plansResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading form.');
    res.redirect('/admin/hubs');
  }
};

// Create hub
adminController.hubCreatePost = async (req, res) => {
  const {
    hubName,
    hubNickname,
    hubEmail,
    firstName,
    lastName,
    hubPhone,
    hubAddress,
    planId,
    maxOrganizations,
    hubFooterText,
    contractStartDate,
    contractEndDate,
  } = req.body;

  try {
    // Validate required fields
    if (!hubName || !hubNickname || !hubEmail || !firstName || !lastName) {
      req.flash('error', 'All required fields must be filled.');
      return res.redirect('/admin/hubs/create');
    }

    // Check if nickname is already taken
    const nicknameCheck = await db.query(
      'SELECT hub_id FROM managira_hubs WHERE hub_nickname = $1',
      [hubNickname]
    );

    if (nicknameCheck.rows.length > 0) {
      req.flash('error', 'Hub nickname is already taken.');
      return res.redirect('/admin/hubs/create');
    }

    // Check if email is already taken
    const emailCheck = await db.query(
      `SELECT hub_email FROM managira_hubs WHERE hub_email = $1
       UNION
       SELECT email FROM organizations WHERE email = $1
       UNION
       SELECT email FROM users WHERE email = $1`,
      [hubEmail]
    );

    if (emailCheck.rows.length > 0) {
      req.flash('error', 'Email is already in use.');
      return res.redirect('/admin/hubs/create');
    }

    // Generate password setup token
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const tokenExpiration = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Insert hub
    const result = await db.query(
      `INSERT INTO managira_hubs 
       (hub_name, hub_nickname, hub_email, first_name, last_name, hub_phone, hub_address, 
        plan_id, max_organizations, hub_footer_text, contract_start_date, contract_end_date,
        reset_password_token, reset_password_expires, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING hub_id`,
      [hubName, hubNickname, hubEmail, firstName, lastName, hubPhone, hubAddress, 
       planId || null, maxOrganizations || 5, hubFooterText || '',
       contractStartDate || null, contractEndDate || null,
       hashedToken, tokenExpiration, req.session.userId]
    );

    const hubId = result.rows[0].hub_id;

    // Send setup email
    const baseUrl = req.protocol + '://' + req.get('host');
    const setupUrl = `${baseUrl}/hub/setup-password?token=${token}`;

    const emailHtml = renderCleanEmail({
      title: 'Welcome to Managira Hub',
      greeting: `Dear ${firstName} ${lastName},`,
      intro: `Your Managira Hub ${hubName} has been created successfully.`,
      message: 'To get started, please set up your password using the button below.',
      actionUrl: setupUrl,
      actionText: 'Set Up Password',
      details: [
        `Hub Name: ${hubName}`,
        `Hub Nickname: ${hubNickname}`,
        `Hub Login: ${baseUrl}/hub/login`,
        `Email: ${hubEmail}`,
        `Max Organizations: ${maxOrganizations || 5}`,
        `Contract Start: ${contractStartDate || 'Not set'}`,
        `Contract End: ${contractEndDate || 'Not set'}`,
      ],
      note: 'This setup link expires in 7 days. Please complete setup before then.',
      closing: 'This is a no-reply message. Please do not reply to this email.',
    });

    sendEmailInBackground({
      to: hubEmail,
      subject: 'Action required: set your Managira Hub password',
      html: emailHtml,
    }, 'Hub Setup Email');

    req.flash('success', 'Hub created successfully! Setup instructions sent to the hub email.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error creating hub.');
    res.redirect('/admin/hubs/create');
  }
};

// Edit hub form
adminController.hubEditGet = async (req, res) => {
  const { hubId } = req.params;

  try {
    const hubResult = await db.query(
      'SELECT * FROM managira_hubs WHERE hub_id = $1',
      [hubId]
    );

    if (hubResult.rows.length === 0) {
      req.flash('error', 'Hub not found.');
      return res.redirect('/admin/hubs');
    }

    const plansResult = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY id');

    res.render('admin/hubEdit', {
      title: 'Edit Hub',
      hub: hubResult.rows[0],
      plans: plansResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading form.');
    res.redirect('/admin/hubs');
  }
};

// Update hub
adminController.hubEditPost = async (req, res) => {
  const { hubId } = req.params;
  const {
    hubName,
    hubNickname,
    firstName,
    lastName,
    hubPhone,
    hubAddress,
    planId,
    maxOrganizations,
    hubFooterText,
    hubBrandingEnabled,
    contractStartDate,
    contractEndDate,
  } = req.body;

  try {
    const existingHubResult = await db.query(
      'SELECT plan_id FROM managira_hubs WHERE hub_id = $1',
      [hubId]
    );

    // Check if nickname is taken by another hub
    const nicknameCheck = await db.query(
      'SELECT hub_id FROM managira_hubs WHERE hub_nickname = $1 AND hub_id != $2',
      [hubNickname, hubId]
    );

    if (nicknameCheck.rows.length > 0) {
      req.flash('error', 'Hub nickname is already taken by another hub.');
      return res.redirect(`/admin/hubs/${hubId}/edit`);
    }

    await db.query(
      `UPDATE managira_hubs 
       SET hub_name = $1, hub_nickname = $2, first_name = $3, last_name = $4, 
           hub_phone = $5, hub_address = $6, plan_id = $7, max_organizations = $8, 
           hub_footer_text = $9, hub_branding_enabled = $10,
           contract_start_date = $11, contract_end_date = $12, updated_at = NOW()
      WHERE hub_id = $13`,
      [hubName, hubNickname, firstName, lastName, hubPhone, hubAddress, 
         planId || null, maxOrganizations || 5, hubFooterText || '',
         hubBrandingEnabled === 'on', contractStartDate || null, contractEndDate || null, hubId]
    );

    const previousPlanId = existingHubResult.rows[0]?.plan_id || null;
    const nextPlanId = planId || null;
    if (String(previousPlanId || '') !== String(nextPlanId || '')) {
      const memberOrganizations = await db.query(
        `SELECT organization_id
         FROM organizations
         WHERE hub_id = $1 AND deleted = false AND COALESCE(is_hub_member, false) = true`,
        [hubId]
      );

      for (const row of memberOrganizations.rows) {
        invalidateOrganizationAccessCache(row.organization_id);
      }
    }

    req.flash('success', 'Hub updated successfully.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error updating hub.');
    res.redirect(`/admin/hubs/${hubId}/edit`);
  }
};

// Put hub on hold
adminController.hubHoldPost = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query(
      'UPDATE managira_hubs SET on_hold = true, updated_at = NOW() WHERE hub_id = $1',
      [hubId]
    );

    req.flash('success', 'Hub put on hold successfully.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error putting hub on hold.');
    res.redirect('/admin/hubs');
  }
};

// Resume hub
adminController.hubResumePost = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query(
      'UPDATE managira_hubs SET on_hold = false, updated_at = NOW() WHERE hub_id = $1',
      [hubId]
    );

    req.flash('success', 'Hub resumed successfully.');
    res.redirect('/admin/hubs');
  } catch (error) {
        req.flash('error', 'Error resuming hub.');
    res.redirect('/admin/hubs');
  }
};

// Delete hub
adminController.hubDeletePost = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query('BEGIN');

    const result = await db.query(
      `UPDATE managira_hubs
       SET deleted = true, on_hold = true, updated_at = NOW()
       WHERE hub_id = $1
       RETURNING hub_name, hub_email, first_name, last_name`,
      [hubId]
    );

    const hub = result.rows[0];

    const memberOrganizations = await db.query(
      `UPDATE organizations
       SET on_hold = true,
           hold_by = 'Hub',
           updated_at = NOW()
       WHERE hub_id = $1
         AND deleted = false
       RETURNING organization_name, email, first_name, last_name`,
      [hubId]
    );

    await db.query('COMMIT');

    if (hub && hub.hub_email) {
      await sendEmailNotification(
        hub.hub_email,
        'Your hub has been placed on hold and moved to deleted review',
        `Dear ${hub.first_name || ''} ${hub.last_name || ''},\n\nYour hub "${hub.hub_name}" has been placed on hold and moved to deleted review by an administrator. Your data is retained and can be restored by the Super Admin.\n\nIf you believe this is a mistake, please contact info@managira.com.\n\nBest regards,\nAdmin Team`
      );
    }

    for (const org of memberOrganizations.rows) {
      if (!org.email) continue;
      await sendEmailNotification(
        org.email,
        'Your organization has been put on hold',
        `Dear ${org.first_name || ''} ${org.last_name || ''},\n\nYour organization "${org.organization_name}" has been placed on hold because your hub was temporarily deleted by an administrator.\n\nYour data remains safe and can be restored when the hub is restored.\n\nBest regards,\nAdmin Team`
      );
    }

    req.flash('success', `Hub moved to deleted review and placed on hold successfully. ${memberOrganizations.rows.length} linked organization(s) were also placed on hold.`);
    res.redirect('/admin/hubs');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) {}
        req.flash('error', 'Error deleting hub.');
    res.redirect('/admin/hubs');
  }
};

// Restore hub from deleted review
adminController.restoreHub = async (req, res) => {
  const { hubId } = req.body;

  try {
    const result = await db.query(
      `UPDATE managira_hubs
       SET deleted = false, on_hold = false, updated_at = NOW()
       WHERE hub_id = $1
       RETURNING hub_name, hub_email, first_name, last_name`,
      [hubId]
    );

    const hub = result.rows[0];

    if (hub && hub.hub_email) {
      await sendEmailNotification(
        hub.hub_email,
        'Your hub has been restored',
        `Dear ${hub.first_name || ''} ${hub.last_name || ''},\n\nYour hub "${hub.hub_name}" has been restored and reactivated. You can now continue using Managira Hub services.\n\nBest regards,\nAdmin Team`
      );
    }

    req.flash('success', 'Hub restored successfully.');
    res.redirect('/admin/superDashboard');
  } catch (error) {
        req.flash('error', 'Failed to restore hub.');
    res.redirect('/admin/superDashboard');
  }
};

// Permanently delete hub
adminController.permanentlyDeleteHub = async (req, res) => {
  const { hubId } = req.body;

  try {
    await db.query('BEGIN');

    // Detach all member organizations from this hub before hard delete
    await db.query(
      `UPDATE organizations
       SET hub_id = NULL,
           is_hub_member = false,
           joined_hub_at = NULL,
           updated_at = NOW()
       WHERE hub_id = $1`,
      [hubId]
    );

    await db.query('DELETE FROM managira_hubs WHERE hub_id = $1', [hubId]);

    await db.query('COMMIT');
    req.flash('success', 'Hub permanently deleted successfully.');
    res.redirect('/admin/superDashboard');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) {}
        req.flash('error', 'Failed to permanently delete hub.');
    res.redirect('/admin/superDashboard');
  }
};

// Bulk permanent delete: organizations (deleted applications)
adminController.bulkPermanentlyDeleteOrganizations = async (req, res) => {
  try {
    let ids = req.body.orgIds;
    if (!ids) { req.flash('error', 'No applications selected.'); return res.redirect('/admin/superDashboard'); }
    if (!Array.isArray(ids)) ids = [ids];
    const intIds = ids.map(x => parseInt(x, 10)).filter(Number.isFinite);
    if (!intIds.length) { req.flash('error', 'Invalid selection.'); return res.redirect('/admin/superDashboard'); }

    let deleted = 0;
    const failures = [];
    for (const orgId of intIds) {
      try {
        await db.query('BEGIN');
        await db.query(
          `DELETE FROM user_subjects
           WHERE user_id IN (SELECT user_id FROM users WHERE organization_id = $1)
              OR subject_id IN (SELECT subject_id FROM subjects WHERE organization_id = $1)`,
          [orgId]
        );
        await db.query(`DELETE FROM organization_texts WHERE organization_id = $1`, [orgId]);
        const r = await db.query('DELETE FROM organizations WHERE organization_id = $1', [orgId]);
        await db.query('COMMIT');
        if (r.rowCount > 0) deleted += 1; else failures.push(orgId);
      } catch (err) {
        try { await db.query('ROLLBACK'); } catch (_) {}
        failures.push(orgId);
      }
    }

    if (deleted > 0) req.flash('success', `${deleted} application(s) permanently deleted.`);
    if (failures.length) req.flash('error', `${failures.length} application(s) could not be deleted (likely linked to protected records).`);
    return res.redirect('/admin/superDashboard');
  } catch (error) {
    req.flash('error', 'Bulk delete failed.');
    return res.redirect('/admin/superDashboard');
  }
};

// Bulk permanent delete: hubs
adminController.bulkPermanentlyDeleteHubs = async (req, res) => {
  try {
    let ids = req.body.hubIds;
    if (!ids) { req.flash('error', 'No hubs selected.'); return res.redirect('/admin/superDashboard'); }
    if (!Array.isArray(ids)) ids = [ids];
    const intIds = ids.map(x => parseInt(x, 10)).filter(Number.isFinite);
    if (!intIds.length) { req.flash('error', 'Invalid selection.'); return res.redirect('/admin/superDashboard'); }

    let deleted = 0;
    const failures = [];
    for (const hubId of intIds) {
      try {
        await db.query('BEGIN');
        await db.query(
          `UPDATE organizations
             SET hub_id = NULL,
                 is_hub_member = false,
                 joined_hub_at = NULL,
                 updated_at = NOW()
           WHERE hub_id = $1`,
          [hubId]
        );
        const r = await db.query('DELETE FROM managira_hubs WHERE hub_id = $1', [hubId]);
        await db.query('COMMIT');
        if (r.rowCount > 0) deleted += 1; else failures.push(hubId);
      } catch (err) {
        try { await db.query('ROLLBACK'); } catch (_) {}
        failures.push(hubId);
      }
    }

    if (deleted > 0) req.flash('success', `${deleted} hub(s) permanently deleted.`);
    if (failures.length) req.flash('error', `${failures.length} hub(s) could not be deleted.`);
    return res.redirect('/admin/superDashboard');
  } catch (error) {
    req.flash('error', 'Bulk delete failed.');
    return res.redirect('/admin/superDashboard');
  }
};

// Bulk permanent delete: tickets (help threads)
adminController.bulkPermanentDeleteMessages = async (req, res) => {
  try {
    let ids = req.body.threadIds;
    if (!ids) { req.flash('error', 'No tickets selected.'); return res.redirect('/admin/superDashboard'); }
    if (!Array.isArray(ids)) ids = [ids];
    const intIds = ids.map(x => parseInt(x, 10)).filter(Number.isFinite);
    if (!intIds.length) { req.flash('error', 'Invalid selection.'); return res.redirect('/admin/superDashboard'); }

    try {
      const r = await db.query(`DELETE FROM help_threads WHERE id = ANY($1::int[])`, [intIds]);
      req.flash('success', `${r.rowCount || 0} ticket(s) permanently deleted.`);
    } catch (err) {
      req.flash('error', 'Bulk delete failed.');
    }
    return res.redirect('/admin/superDashboard');
  } catch (error) {
    req.flash('error', 'Bulk delete failed.');
    return res.redirect('/admin/superDashboard');
  }
};

// View hub organizations
adminController.hubOrganizationsGet = async (req, res) => {
  const { hubId } = req.params;

  try {
    const hubResult = await db.query('SELECT * FROM managira_hubs WHERE hub_id = $1', [hubId]);
    
    if (hubResult.rows.length === 0) {
      req.flash('error', 'Hub not found.');
      return res.redirect('/admin/hubs');
    }

    const orgsResult = await db.query(
      `SELECT o.*,
              (SELECT COUNT(*) FROM students WHERE organization_id = o.organization_id) as student_count,
              (SELECT COUNT(*) FROM users WHERE organization_id = o.organization_id) as teacher_count,
              (SELECT COUNT(*) FROM classes WHERE organization_id = o.organization_id) as class_count
       FROM organizations o
       WHERE o.hub_id = $1 AND o.deleted = false AND o.is_hub_member = true
       ORDER BY o.organization_name ASC`,
      [hubId]
    );

    res.render('admin/hubOrganizations', {
      title: 'Hub Organizations',
      hub: hubResult.rows[0],
      organizations: orgsResult.rows,
      messages: req.flash(),
      showFooterTopSection: true
    });
  } catch (error) {
        req.flash('error', 'Error loading organizations.');
    res.redirect('/admin/hubs');
  }
};

// ===== Org Chart (admin-side team) =====
adminController.getOrgChart = async (req, res) => {
  try {
    await ensureInternalWorkerSchema(db);
    const { rows: members } = await db.query(
      `SELECT user_id, first_name, last_name, email, account_type,
              supervisor_user_id, org_chart_position, org_role_title, org_role_description,
              profile_image_url, on_hold
         FROM users
        WHERE account_type IN ('Admin', 'Mini Admin', 'Internal Worker')
        ORDER BY CASE account_type
                   WHEN 'Admin' THEN 1
                   WHEN 'Mini Admin' THEN 2
                   WHEN 'Internal Worker' THEN 3
                   ELSE 4 END,
                 last_name, first_name`
    );

    res.render('admin/orgChart', {
      title: 'Team Org Chart',
      members,
      currentUserId: req.session.userId,
      currentAccountType: req.session.accountType,
      messages: req.flash(),
      showFooterTopSection: true,
    });
  } catch (err) {
    console.error('[getOrgChart]', err);
    req.flash('error', 'Failed to load org chart.');
    res.redirect('/admin');
  }
};

adminController.updateOrgChartMember = async (req, res) => {
  try {
    await ensureInternalWorkerSchema(db);
    const memberId = parseInt(req.params.id, 10);
    if (!Number.isFinite(memberId)) {
      req.flash('error', 'Invalid member id.');
      return res.redirect('/admin/org-chart');
    }

    const supervisorRaw = req.body.supervisorUserId;
    let supervisorUserId = null;
    if (supervisorRaw !== undefined && supervisorRaw !== '' && supervisorRaw !== null) {
      const parsed = parseInt(supervisorRaw, 10);
      if (Number.isFinite(parsed) && parsed !== memberId) supervisorUserId = parsed;
    }

    const rowPositionRaw = req.body.rowPosition;
    let requestedRowPosition = null;
    if (rowPositionRaw !== undefined && rowPositionRaw !== '' && rowPositionRaw !== null) {
      const parsed = parseInt(rowPositionRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) requestedRowPosition = parsed;
    }

    const roleTitle = String(req.body.roleTitle || '').trim().slice(0, 120) || null;
    const roleDescription = String(req.body.roleDescription || '').trim().slice(0, 600) || null;

    let imageUrl = null;
    if (req.file) {
      try {
        const result = await uploadToS3(req.file);
        imageUrl = result && (result.Location || result);
      } catch (e) {
        console.error('[orgChart upload]', e);
      }
    }

    await db.query('BEGIN');

    const memberResult = await db.query(
      `SELECT user_id, supervisor_user_id
         FROM users
        WHERE user_id = $1
          AND account_type IN ('Admin', 'Mini Admin', 'Internal Worker')
        FOR UPDATE`,
      [memberId]
    );

    if (!memberResult.rows.length) {
      await db.query('ROLLBACK');
      req.flash('error', 'Team member not found.');
      return res.redirect('/admin/org-chart');
    }

    const currentSupervisorUserId = memberResult.rows[0].supervisor_user_id || null;

    const siblingResult = await db.query(
      `SELECT user_id
         FROM users
        WHERE account_type IN ('Admin', 'Mini Admin', 'Internal Worker')
          AND user_id <> $1
          AND (
            ($2::int IS NULL AND supervisor_user_id IS NULL)
            OR supervisor_user_id = $2
          )
        ORDER BY COALESCE(org_chart_position, 2147483647),
                 CASE account_type
                   WHEN 'Admin' THEN 1
                   WHEN 'Mini Admin' THEN 2
                   WHEN 'Internal Worker' THEN 3
                   ELSE 4 END,
                 last_name, first_name, user_id`,
      [memberId, supervisorUserId]
    );

    const siblingIds = siblingResult.rows.map((row) => row.user_id);
    const targetRowPosition = Math.min(
      Math.max(requestedRowPosition || (siblingIds.length + 1), 1),
      siblingIds.length + 1
    );
    siblingIds.splice(targetRowPosition - 1, 0, memberId);

    const sets = [
      'supervisor_user_id = $1',
      'org_chart_position = $2',
      'org_role_title = $3',
      'org_role_description = $4',
    ];
    const params = [supervisorUserId, targetRowPosition, roleTitle, roleDescription];
    if (imageUrl) {
      sets.push(`profile_image_url = $${params.length + 1}`);
      params.push(imageUrl);
    }
    params.push(memberId);

    await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${params.length}
        AND account_type IN ('Admin', 'Mini Admin', 'Internal Worker')`,
      params
    );

    for (let index = 0; index < siblingIds.length; index += 1) {
      await db.query(
        `UPDATE users SET org_chart_position = $1 WHERE user_id = $2`,
        [index + 1, siblingIds[index]]
      );
    }

    if (currentSupervisorUserId !== supervisorUserId) {
      const previousSiblingResult = await db.query(
        `SELECT user_id
           FROM users
          WHERE account_type IN ('Admin', 'Mini Admin', 'Internal Worker')
            AND user_id <> $1
            AND (
              ($2::int IS NULL AND supervisor_user_id IS NULL)
              OR supervisor_user_id = $2
            )
          ORDER BY COALESCE(org_chart_position, 2147483647),
                   CASE account_type
                     WHEN 'Admin' THEN 1
                     WHEN 'Mini Admin' THEN 2
                     WHEN 'Internal Worker' THEN 3
                     ELSE 4 END,
                   last_name, first_name, user_id`,
        [memberId, currentSupervisorUserId]
      );

      for (let index = 0; index < previousSiblingResult.rows.length; index += 1) {
        await db.query(
          `UPDATE users SET org_chart_position = $1 WHERE user_id = $2`,
          [index + 1, previousSiblingResult.rows[index].user_id]
        );
      }
    }

    await db.query('COMMIT');

    req.flash('success', 'Team member updated.');
    res.redirect('/admin/org-chart');
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (rollbackErr) {}
    console.error('[updateOrgChartMember]', err);
    req.flash('error', 'Failed to update team member.');
    res.redirect('/admin/org-chart');
  }
};

module.exports = {
  ...adminController,
  sendAdminInviteEmail,
  sendPasswordSetSuccessEmail,
};
