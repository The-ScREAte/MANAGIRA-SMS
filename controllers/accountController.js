// Helper to parse truthy values from form/query/session
function parseTruthyFlag(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    return val === '1' || val.toLowerCase() === 'true' || val === 'on';
  }
  return false;
}

const REGISTER_PROOF_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const DOWNGRADE_USAGE_CHARGE_THRESHOLD_DAYS = 20;
const DOWNGRADE_USAGE_CHARGE_WINDOW_DAYS = 30;

let organizationPlanChangeEventsSchemaReady = false;

function sanitizeCurrencyProfileSnapshot(profile) {
  if (!profile || typeof profile !== "object") return null;
  const userCurrency = String(profile.userCurrency || "").trim().toUpperCase();
  const locale = String(profile.locale || "").trim() || "en-US";
  const usdToUserRate = Number(profile.usdToUserRate || 0);
  const usdToGhsRate = Number(profile.usdToGhsRate || 0);
  const countryCode = String(profile.countryCode || "").trim().toUpperCase();

  return {
    userCurrency: /^[A-Z]{3}$/.test(userCurrency) ? userCurrency : "USD",
    locale,
    usdToUserRate: usdToUserRate > 0 ? usdToUserRate : 1,
    usdToGhsRate: usdToGhsRate > 0 ? usdToGhsRate : null,
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    source: profile.source || profile.detectionSource || null,
  };
}

function isLikelyInternationalPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (!/^\+?[\d\s().-]+$/.test(raw)) return false;

  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

function startOfDayLocal(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = trimmed.match(datePattern);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

async function getOrganizationStudentCount(dbClient, organizationId) {
  if (!organizationId) return 0;
  try {
    // Bill only active students: exclude graduated and archived records.
    const activeResult = await dbClient.query(
      `SELECT COUNT(*)::int AS cnt
       FROM students s
       WHERE s.organization_id = $1
         AND COALESCE(s.graduated, FALSE) = FALSE
         AND NOT EXISTS (
           SELECT 1
           FROM archived_student_info a
           WHERE a.organization_id = s.organization_id
             AND a.student_id = s.student_id
         )`,
      [organizationId]
    );
    return Number(activeResult.rows[0]?.cnt || 0);
  } catch (_) {
    try {
      // Fallback if archive table is unavailable in older environments.
      const graduatedOnlyResult = await dbClient.query(
        `SELECT COUNT(*)::int AS cnt
         FROM students
         WHERE organization_id = $1
           AND COALESCE(graduated, FALSE) = FALSE`,
        [organizationId]
      );
      return Number(graduatedOnlyResult.rows[0]?.cnt || 0);
    } catch (_) {
      const totalResult = await dbClient.query(
        'SELECT COUNT(*)::int AS cnt FROM students WHERE organization_id = $1',
        [organizationId]
      );
      return Number(totalResult.rows[0]?.cnt || 0);
    }
  }
}

async function getActivePlanBillingPeriods(dbClient) {
  try {
    const cyclesResult = await dbClient.query(
      "SELECT cycle_key AS period_key, label, months, discount_percentage, sort_order FROM dynamic_billing_cycles WHERE is_active = TRUE ORDER BY sort_order, months"
    );
    if (cyclesResult.rows?.length) {
      return cyclesResult.rows;
    }
  } catch (_) {
  }

  return [{ period_key: 'monthly', label: 'Monthly', months: 1, discount_percentage: 0 }];
}

async function computeOrganizationPlanMonthlyPrice(dbClient, {
  planId,
  fallbackMonthlyUsd,
  studentCount,
  countryCode,
}) {
  const fallbackPrice = Number(fallbackMonthlyUsd || 0);
  const normalizedCount = Math.max(0, Number(studentCount || 0));

  try {
    const region = await getRegionForCountry(dbClient, countryCode || null);
    const pricingMatch = await getBestPlanRegionPrice(dbClient, Number(planId), Number(region?.id || 0) || null);
    if (!pricingMatch?.priceRow) {
      return {
        monthlyPriceUsd: fallbackPrice,
        pricingMode: 'flat',
        region: region || null,
        threshold: null,
        extraStudents: 0,
        perStudentRateUsd: 0,
        termStudentCostUsd: 0,
        studentMonthlyCostUsd: 0,
        monthsPerTerm: 1,
      };
    }

    const priceRow = pricingMatch.priceRow;
    const resolvedRegion = pricingMatch.region || region || null;

    const dynamicTermDivider = await getDynamicTermDivider(dbClient);
    const monthsPerTerm = await getDynamicRegionTermMonths(
      dbClient,
      Number(resolvedRegion?.id || region?.id || 0),
      dynamicTermDivider
    );
    const monthly = computeDynamicMonthlyPrice(priceRow, normalizedCount, {
      termDivider: monthsPerTerm,
    });

    return {
      monthlyPriceUsd: Number(monthly?.monthlyTotal || 0),
      pricingMode: 'dynamic',
      region: resolvedRegion,
      threshold: Number(monthly?.threshold || 0),
      extraStudents: Number(monthly?.extraStudents || 0),
      perStudentRateUsd: Number(monthly?.perStudentRate || 0),
      termStudentCostUsd: Number(monthly?.termStudentCost || 0),
      studentMonthlyCostUsd: Number(monthly?.studentCost || 0),
      monthsPerTerm: Number(monthly?.monthsPerTerm || monthsPerTerm || 1),
    };
  } catch (_) {
    return {
      monthlyPriceUsd: fallbackPrice,
      pricingMode: 'flat',
      region: null,
      threshold: null,
      extraStudents: 0,
      perStudentRateUsd: 0,
      termStudentCostUsd: 0,
      studentMonthlyCostUsd: 0,
      monthsPerTerm: 1,
    };
  }
}

async function getActiveDynamicCycleByKey(dbClient, cycleKey) {
  if (!cycleKey) return null;
  const result = await dbClient.query(
    "SELECT * FROM dynamic_billing_cycles WHERE cycle_key = $1 AND is_active = TRUE LIMIT 1",
    [cycleKey]
  );
  return result.rows[0] || null;
}

async function getDynamicTermDivider(dbClient) {
  try {
    const result = await dbClient.query(
      "SELECT value FROM app_settings WHERE key = 'dynamic_term_divider' LIMIT 1"
    );
    const parsed = parseInt(result.rows?.[0]?.value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  } catch (_) {
    return 1;
  }
}

async function getDynamicRegionTermMonths(dbClient, regionId, fallback = 1) {
  if (!Number.isInteger(Number(regionId))) {
    return Math.max(1, Number(fallback) || 1);
  }
  try {
    const result = await dbClient.query(
      'SELECT value FROM app_settings WHERE key = $1 LIMIT 1',
      [`dynamic_region_term_months_${Number(regionId)}`]
    );
    const parsed = parseInt(result.rows?.[0]?.value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : Math.max(1, Number(fallback) || 1);
  } catch (_) {
    return Math.max(1, Number(fallback) || 1);
  }
}

function normalizeLoginReturnPath(returnTo) {
  if (typeof returnTo !== "string") return "";
  const trimmed = returnTo.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed, "http://localhost");
    const normalized = `${parsed.pathname || ""}${parsed.search || ""}`;
    return normalized.startsWith("/") ? normalized : "";
  } catch (_) {
    return trimmed.startsWith("/") ? trimmed : "";
  }
}

let studentIdSettingsSchemaReady = false;

async function ensureStudentIdSettingsSchema(dbClient) {
  if (studentIdSettingsSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS student_id_start_number INTEGER DEFAULT NULL
  `);

  studentIdSettingsSchemaReady = true;
}

async function getOccupiedStudentIdNumbers(dbClient, organizationId) {
  const result = await dbClient.query(
    `SELECT DISTINCT occupied_number::int AS occupied_number
       FROM (
         SELECT student_id AS occupied_number
           FROM students
          WHERE organization_id = $1
            AND student_id IS NOT NULL
            AND student_id > 0
         UNION
         SELECT NULLIF(REGEXP_REPLACE(COALESCE(custom_student_id, ''), '\\D', '', 'g'), '')::int AS occupied_number
           FROM students
          WHERE organization_id = $1
            AND NULLIF(REGEXP_REPLACE(COALESCE(custom_student_id, ''), '\\D', '', 'g'), '') IS NOT NULL
       ) occupied_numbers
      WHERE occupied_number IS NOT NULL
        AND occupied_number > 0
      ORDER BY occupied_number ASC`,
    [organizationId]
  );

  return result.rows
    .map((row) => Number(row.occupied_number) || 0)
    .filter((number) => Number.isInteger(number) && number > 0);
}

function getFirstAvailableStudentIdNumber(occupiedNumbers = [], startingNumber = 1) {
  const usedNumbers = new Set();
  occupiedNumbers.forEach((number) => {
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

async function getNextSuggestedStudentIdNumber(dbClient, organizationId, currentCounter = 0, configuredStartNumber = null) {
  const occupiedNumbers = await getOccupiedStudentIdNumbers(dbClient, organizationId);
  const searchStart = getStudentIdSearchStart(occupiedNumbers, currentCounter, configuredStartNumber);
  return getFirstAvailableStudentIdNumber(occupiedNumbers, searchStart);
}

const LOGIN_REDIRECT_PERMISSION_RULES = [
  {
    pattern: /^\/common\/(manageEmployees|createEmployee|modifyEmployee|deleteEmployee|toggleHoldEmployee)(?:$|[/?#])/i,
    permissionKey: "manage_employees",
  },
];

async function resolveSafeLoginRedirect(database, permissionContext, returnTo, fallbackUrl) {
  const normalizedReturnTo = normalizeLoginReturnPath(returnTo);
  if (!normalizedReturnTo) return fallbackUrl;

  const matchedRule = LOGIN_REDIRECT_PERMISSION_RULES.find((rule) => rule.pattern.test(normalizedReturnTo));
  if (!matchedRule) return normalizedReturnTo;

  const allowed = await userHasPermission(database, permissionContext, matchedRule.permissionKey);
  return allowed ? normalizedReturnTo : fallbackUrl;
}

const bcrypt = require("bcryptjs");

const bcryptjs = require("bcryptjs");

const db = require("../config/db");
const { deriveOrgNickname, normalizeDisplayName } = require("../utils/orgNicknameSlug");
const crypto = require("crypto");

const path = require("path");

const nodemailer = require("nodemailer");

const { upload, uploadToS3, deleteFromS3 } = require("../middleware/s3Upload");

const fs = require("fs");

const PDFDocument = require("pdfkit");

const axios = require("axios");
const { google } = require("googleapis");

const he = require("he");

const { sendEmailSafely, sendEmailInBackground, renderCleanEmail } = require("../utils/emailHelper");
const {
  getCurrencyProfileForRequest,
  getCurrencyForCountry,
  getSupportedCurrencyOptions,
  inferCountryCodeFromLocationParts,
  normalizeCurrencyCode,
  getUsdRate,
  getLocaleForCurrency,
  localizeUsdAmount,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const {
  getFreeTrialSettings,
  formatFreeTrialLength,
  hasEmailLockedTrial,
} = require("../utils/freeTrial");
const { getPaystackSettings } = require("../utils/paystackConfig");
const { isPaystackEnabled } = require("../utils/paystackEnabled");
const { settleFromPaystackTransaction } = require("../utils/paystackPayout");
const {
  getPaymentProvider,
  providerSupportsPaystack,
  providerSupportsStripe,
} = require("../utils/paymentProviderConfig");
const {
  getStripeSettings,
  getStripeConfigurationIssue,
  getActiveStripePublicKey,
  getStripeClient,
  getStripePlatformClient,
  getStripeConnectAccountColumn,
  getStripeConnectAccountId,
  ensureStripeConnectAccountSchema,
  saveOrganizationStripeConnectAccountId,
  preserveStripeConnectAccountForOtherMode,
} = require("../utils/stripeConfig");
const { ensurePaymentProviderSchema, ensureStripeSubaccountSchema } = require("../utils/paymentProviderSchema");
const {
  getPlatformFeeSettings,
  normalizePlatformFeeBearer,
  upsertOrgPlatformFeeBearer,
  buildPlatformChargeBreakdown,
} = require("../utils/platformFee");
const {
  computeDynamicMonthlyPrice,
  applyCycle,
  getRegionForCountry,
  getBestPlanRegionPrice,
} = require("../utils/dynamicPricing");
const {
  WEEKDAY_OPTIONS,
  parseBoolean,
  normalizeWeekendDaysInput,
  ensureAttendanceCalendarSchema,
  getHolidayCountryOptions,
  getTermRecord,
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  upsertAttendanceCalendarProfile,
  syncPublicHolidayDays,
  upsertManualCalendarDay,
  deleteManualCalendarDay,
} = require("../utils/attendanceCalendar");
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { hasGuardianPortalFeature } = require("../utils/guardianPortalAccess");
const {
  ensureStudentPortalSchema,
  normalizeStudentEmail,
  getStudentPortalIntegrationStatus,
  setStudentPortalActivation,
} = require("../utils/studentPortal");
const { invalidateOrganizationAccessCache } = require("../utils/accessCache");
const { logOrganizationActivity } = require("../utils/activityLog");
const cacheManager = require("../utils/cacheManager");
const { pingSearchEngines, pingSchoolUrl } = require("../utils/sitemapPing");
const { autoGeocodeOrg } = require("../utils/geocode");
const { COUNTRIES_BY_CONTINENT, COUNTRY_NAME_LOOKUP } = require("../utils/countries");
const {
  ensureEmailPreferencesSchema,
  getStaffPreferencesForRole,
  getUserPreferenceMap,
  setUserPreferences,
} = require("../utils/emailPreferences");
const {
  FEEDBACK_TYPE_OPTIONS,
  FEEDBACK_AREA_OPTIONS,
  FEEDBACK_PRIORITY_OPTIONS,
} = require("../utils/userFeedback");
const {
  DEFAULT_NAME_DISPLAY_FORMAT,
  DEFAULT_DATE_DISPLAY_FORMAT,
  ensureOrganizationDisplayPreferencesSchema,
  normalizeNameDisplayFormat,
  normalizeDateDisplayFormat,
  applyDisplayPreferencesToSession,
} = require("../utils/organizationDisplayPreferences");
const {
  ensureGoogleIntegrationSchema,
  getGoogleIntegrationStatus,
  setGoogleIntegrationActivation,
  storeGoogleOauthTokens,
  markGoogleSync,
  disconnectGoogleIntegration,
  createOauthState,
  parseOauthState,
} = require("../utils/googleClassroomIntegration");
const {
  getMetaConfig,
  ensureWhatsappIntegrationSchema,
  getWhatsappIntegrationStatus,
  getWhatsappMessagingCredentials,
  setWhatsappIntegrationActivation,
  exchangeEmbeddedSignupCodeForToken,
  registerPhoneNumberForCloudApi,
  subscribeAppToWaba,
  saveWhatsappConnection,
  markWhatsappConnectionError,
  clearWhatsappConnectionError,
  isTransientWhatsappErrorMessage,
  disconnectWhatsappIntegration,
  normalizePhoneDigits,
  sendWhatsappTemplateMessage,
} = require("../utils/whatsappIntegration");
const {
  syncGoogleClassroomForOrganization,
  pushPendingAssessmentsForOrganization,
} = require("../utils/googleClassroomSync");

const WHATSAPP_SERVER_TEST_DEFAULTS = {
  phoneNumberId: "1149779811558777",
  recipient: "13854521960",
  accessToken:
    "EAAZBr7Wh6kf4BRZBpij1Sb2oGLP3jpPfEbvPGZCKkXwR8tleChLXyq8cReIGNecrNWvP0qVgj8ZByPf5ZBImiwwsD94h2W0IC7thGI2nDlOripEpQNuH0saoHlU04EEpspZBu7aICuD4F9RnZBBTelYxGscpb7yHF5ZAPrecY0sVLbHecJ8g0YxVZBX4Swpe8l5iASF27MzPNiCZAUZB9G4n4rqljLpB2pYlOjMy2v7a0w5NAuABlNyQAZDZD",
};

const GOOGLE_CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses",
  "https://www.googleapis.com/auth/classroom.rosters",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.coursework.me",
  "https://www.googleapis.com/auth/classroom.guardianlinks.students",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.profile.photos",
];

async function verifySessionPassword(rawPassword, req) {
  const password = String(rawPassword || "");
  if (!password) return false;

  const orgId = Number(req?.session?.organizationId || 0);
  const userId = Number(req?.session?.userId || 0);

  if (userId && orgId) {
    const userResult = await db.query(
      `SELECT password FROM users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
      [userId, orgId]
    );
    if (userResult.rows.length && userResult.rows[0].password) {
      const matchUser = await bcryptjs.compare(password, userResult.rows[0].password);
      if (matchUser) return true;
    }
  }

  if (!orgId) return false;

  const orgResult = await db.query(
    `SELECT password FROM organizations WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  if (!orgResult.rows.length || !orgResult.rows[0].password) return false;
  return bcryptjs.compare(password, orgResult.rows[0].password);
}
// Invalidate the /admin dashboard organizations cache so newly-registered
// organizations become visible immediately (mirrors adminController’s behavior
// on edit/approve actions; registration previously never busted this cache).
function invalidateAdminOrganizationsCache() {
  try {
    cacheManager.invalidate("admin", "organizations:list");
  } catch (err) {
    console.warn("[accountController] failed to invalidate admin organizations cache:", err && err.message);
  }
}

function getSettingsCountryOptions() {
  const rows = Object.values(COUNTRIES_BY_CONTINENT || {}).flat();
  const uniqueByCode = new Map();
  rows.forEach((country) => {
    const code = String(country?.code || "").trim().toUpperCase();
    const name = String(country?.name || "").trim();
    if (!/^[A-Z]{2}$/.test(code) || !name) return;
    if (!uniqueByCode.has(code)) {
      uniqueByCode.set(code, { code, name });
    }
  });

  return Array.from(uniqueByCode.values()).sort((a, b) => a.name.localeCompare(b.name));
}

let organizationCurrencyColumnReady = false;
let paystackCountriesCache = {
  expiresAt: 0,
  data: [],
};

async function getCachedPaystackCountries() {
  const now = Date.now();
  if (paystackCountriesCache.expiresAt > now && Array.isArray(paystackCountriesCache.data)) {
    return paystackCountriesCache.data;
  }

  const countries = await require("../utils/payoutDestination")
    .fetchPaystackCountries()
    .catch(() => []);

  paystackCountriesCache = {
    expiresAt: now + 1000 * 60 * 30,
    data: Array.isArray(countries) ? countries : [],
  };

  return paystackCountriesCache.data;
}

async function ensureOrganizationCurrencySchema(dbClient) {
  if (organizationCurrencyColumnReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS organization_currency VARCHAR(3)
  `).catch(() => null);

  organizationCurrencyColumnReady = true;
}

function extractS3KeyFromUrl(url) {
  const value = String(url || "").trim();
  if (!value || value === "profilePlaceholder.png") return null;

  const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
  if (value.startsWith(s3Prefix)) {
    return value.substring(s3Prefix.length);
  }
  if (value.startsWith("images/")) {
    return value;
  }
  return null;
}

async function getActivePaystackSecretKey() {
  const settings = await getPaystackSettings(db);
  return settings.activeSecretKey || process.env.PAYSTACK_SECRET_KEY || "";
}

async function getActivePaystackPublicKey() {
  const settings = await getPaystackSettings(db);
  return settings.activePublicKey || process.env.PAYSTACK_PUBLIC_KEY || "";
}

function isMissingStripeConnectAccountError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return code === "resource_missing" ||
    message.includes("not connected to your platform") ||
    message.includes("does not exist");
}

function getStripeConnectBaseUrl(req, mode) {
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  const configuredProdBaseUrl =
    process.env.BASE_URL_PRODUCTION ||
    process.env.BASE_URL_PRODUCTION_FALLBACK ||
    process.env.BASE_URL ||
    "https://managira.com";
  const localBaseUrl = process.env.BASE_URL_LOCAL || requestOrigin || "http://localhost:4000";

  return String(mode === "live" ? configuredProdBaseUrl : localBaseUrl)
    .trim()
    .replace(/\/$/, "");
}

function getStripeConnectOnboardingErrorMessage(error) {
  const message = String(error?.message || "").trim();
  const normalized = message.toLowerCase();

  if (normalized.includes("responsibilities of managing losses for connected accounts")) {
    return "Stripe live Connect is not fully activated yet. In your Stripe Dashboard, open Settings > Connect > Platform profile and review the responsibilities for managing losses for connected accounts, then try again.";
  }

  if (normalized.includes("invalid redirect url") || normalized.includes("must use https") || normalized.includes("valid https url")) {
    return "Stripe live Connect requires HTTPS return URLs. Set BASE_URL_PRODUCTION to your production https:// domain and try again.";
  }

  return "Could not start Stripe Connect onboarding. Please try again.";
}

function getPlainEnglishStripeError(input, fallbackMessage = "We could not process your card right now. Please check your card details and try again.") {
  const code = String(
    input?.code ||
      input?.raw?.code ||
      input?.decline_code ||
      input?.raw?.decline_code ||
      ""
  )
    .trim()
    .toLowerCase();
  const message = String(input?.raw?.message || input?.message || "").trim();
  const normalizedMessage = message.toLowerCase();

  const englishByCode = {
    card_declined: "Your bank declined this card. Please contact your bank or use another card.",
    do_not_honor: "Your bank declined this card. Please contact your bank or use another card.",
    generic_decline: "Your card was declined. Please try another card or contact your bank.",
    card_not_supported: "This card is not supported for this payment. Please use another card.",
    currency_not_supported: "This card does not support the required currency. Please use another card.",
    restricted_card: "This card has restrictions and cannot be used for this payment. Please contact your bank or use another card.",
    transaction_not_allowed: "This card is not allowed to complete this type of transaction. Please contact your bank or use another card.",
    service_not_allowed: "This card is not allowed for this type of payment. Please use another card.",
    withdrawal_count_limit_exceeded: "This card has reached its transaction limit. Please contact your bank or use another card.",
    insufficient_funds: "This card does not have enough funds for this payment. Please use another card.",
    incorrect_cvc: "The card security code (CVC) is incorrect. Please check it and try again.",
    incorrect_number: "The card number looks incorrect. Please check it and try again.",
    invalid_number: "The card number looks incorrect. Please check it and try again.",
    expired_card: "This card has expired. Please use a different card.",
    invalid_expiry_month: "The card expiry month is invalid. Please check it and try again.",
    invalid_expiry_year: "The card expiry year is invalid. Please check it and try again.",
    processing_error: "We could not process this card right now. Please try again in a moment.",
    authentication_required: "Your bank needs extra confirmation for this card. Please try again and complete bank verification.",
    payment_intent_authentication_failure: "Your bank verification was not completed. Please try again.",
    payment_method_provider_timeout: "The card provider took too long to respond. Please try again.",
    incomplete_number: "Please enter a complete card number.",
    incomplete_cvc: "Please enter the full card security code (CVC).",
    incomplete_expiry: "Please enter the full card expiry date.",
    invalid_request_error: "Some payment details are invalid. Please review your card details and try again.",
  };

  if (englishByCode[code]) {
    return englishByCode[code];
  }

  if (normalizedMessage.includes("insufficient") && normalizedMessage.includes("fund")) {
    return englishByCode.insufficient_funds;
  }
  if (normalizedMessage.includes("incorrect") && normalizedMessage.includes("cvc")) {
    return englishByCode.incorrect_cvc;
  }
  if ((normalizedMessage.includes("incorrect") || normalizedMessage.includes("invalid")) && normalizedMessage.includes("card number")) {
    return englishByCode.incorrect_number;
  }
  if (normalizedMessage.includes("expired")) {
    return englishByCode.expired_card;
  }
  if (normalizedMessage.includes("authentication") || normalizedMessage.includes("3d secure") || normalizedMessage.includes("3-d secure")) {
    return englishByCode.authentication_required;
  }
  if (
    normalizedMessage.includes("not support") ||
    normalizedMessage.includes("unsupported") ||
    normalizedMessage.includes("not allowed") ||
    normalizedMessage.includes("restricted card") ||
    normalizedMessage.includes("transaction is not allowed")
  ) {
    return englishByCode.card_not_supported;
  }
  if (normalizedMessage.includes("declin")) {
    return englishByCode.card_declined;
  }

  return message || fallbackMessage;
}

function getStripeConnectivityFlags(error) {
  const rawMessage = String(
    error?.raw?.message || error?.response?.data?.message || error?.message || ""
  );
  const rawDetailMessage = String(
    error?.raw?.detail?.message || error?.detail?.message || ""
  );
  const rawLower = rawMessage.toLowerCase();
  const detailLower = rawDetailMessage.toLowerCase();

  const isConnectionIssue =
    String(error?.type || "").toLowerCase() === "stripeconnectionerror" ||
    rawLower.includes("connection to stripe") ||
    rawLower.includes("network") ||
    rawLower.includes("socket") ||
    rawLower.includes("econn") ||
    detailLower.includes("econn");

  const isTlsIssue =
    isConnectionIssue && (
      rawLower.includes("unable to get local issuer certificate") ||
      rawLower.includes("unable to verify the first certificate") ||
      rawLower.includes("self signed certificate") ||
      detailLower.includes("unable to get local issuer certificate") ||
      detailLower.includes("unable to verify the first certificate") ||
      detailLower.includes("self signed certificate")
    );

  return {
    isConnectionIssue,
    isTlsIssue,
    rawMessage,
    rawDetailMessage,
  };
}

async function chargeOrganizationPlanChangeAmount(dbClient, {
  organizationId,
  amountUsd,
  fromPlanId = null,
  toPlanId = null,
  reason = "Plan change charge",
  metadata = {},
  missingCardMessage = "No payment card on file. Please add a payment method before continuing.",
  missingStripeCardMessage = "Payment failed: please add a Stripe card before continuing.",
  defaultFailureMessage = "Unable to charge your card for this plan change.",
}) {
  const normalizedUsd = Number(amountUsd || 0);
  if (!(normalizedUsd > 0)) {
    return {
      success: true,
      skipped: true,
      chargedAmount: 0,
      chargeCurrency: "USD",
      paymentIntentId: null,
    };
  }

  const cardResult = await dbClient.query(
    `SELECT authorization_code, provider FROM stored_cards
     WHERE organization_id = $1 AND is_primary = true AND is_active = true
     LIMIT 1`,
    [organizationId]
  );

  if (cardResult.rows.length === 0) {
    return {
      success: false,
      userMessage: missingCardMessage,
      isConnectionIssue: false,
      isTlsIssue: false,
    };
  }

  const authorizationCode = cardResult.rows[0].authorization_code;
  const cardProvider = cardResult.rows[0].provider || "paystack";
  const chargeCurrency = "USD";
  const amountInChargeCurrency = await convertUsdAmountToCurrency(normalizedUsd, chargeCurrency);
  const amountMinor = Math.round(amountInChargeCurrency * 100);

  const orgStripeRow = await dbClient.query(
    "SELECT stripe_customer_id FROM organizations WHERE organization_id = $1",
    [organizationId]
  );
  const stripeCustomerId = orgStripeRow.rows[0]?.stripe_customer_id;

  if (!stripeCustomerId || cardProvider !== "stripe") {
    return {
      success: false,
      userMessage: missingStripeCardMessage,
      isConnectionIssue: false,
      isTlsIssue: false,
    };
  }

  try {
    const stripeClient = await getStripeClient(dbClient);
    const mergedMetadata = {
      reason: String(reason || "Plan change charge"),
      from_plan: fromPlanId == null ? "" : String(fromPlanId),
      to_plan: toPlanId == null ? "" : String(toPlanId),
    };

    Object.entries(metadata || {}).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      mergedMetadata[String(key)] = String(value);
    });

    const intent = await stripeClient.paymentIntents.create({
      amount: amountMinor,
      currency: chargeCurrency,
      customer: stripeCustomerId,
      payment_method: authorizationCode,
      confirm: true,
      off_session: true,
      metadata: mergedMetadata,
    });

    if (intent.status !== "succeeded") {
      const intentFailureMessage = String(
        intent.last_payment_error?.message || defaultFailureMessage
      );
      return {
        success: false,
        userMessage: getPlainEnglishStripeError(
          { message: intentFailureMessage, raw: { message: intentFailureMessage } },
          defaultFailureMessage
        ),
        isConnectionIssue: false,
        isTlsIssue: false,
      };
    }

    return {
      success: true,
      skipped: false,
      chargedAmount: Number(amountInChargeCurrency || 0),
      chargeCurrency,
      paymentIntentId: intent.id || null,
      cardProvider,
    };
  } catch (chargeErr) {
    const connectivity = getStripeConnectivityFlags(chargeErr);
    const fallbackMessage = connectivity.isTlsIssue
      ? "Stripe TLS certificate validation failed. Set STRIPE_ALLOW_INSECURE_TLS=true for local/dev or install the missing CA chain."
      : defaultFailureMessage;

    return {
      success: false,
      userMessage: getPlainEnglishStripeError(chargeErr, fallbackMessage),
      isConnectionIssue: connectivity.isConnectionIssue,
      isTlsIssue: connectivity.isTlsIssue,
      error: chargeErr,
    };
  }
}

function buildStripeRegistrationIdempotencyKey({
  registrationDetails,
  paymentContext,
  selectedGateway,
  flowType,
}) {
  const planId = Number(registrationDetails?.planId || 0) || 0;
  const email = String(registrationDetails?.email || "").trim().toLowerCase();
  const orgName = String(registrationDetails?.orgName || "").trim().toLowerCase();
  const billingKey = String(paymentContext?.billingPeriodKey || "monthly").trim().toLowerCase();
  const amountDue = Number(paymentContext?.amountDue || 0);
  const currency = String(paymentContext?.chargeCurrency || "usd").trim().toLowerCase();
  const promoCode = String(paymentContext?.promoCode || "").trim().toUpperCase();
  const trialStart = paymentContext?.trialStartAt
    ? new Date(paymentContext.trialStartAt).toISOString().slice(0, 10)
    : "none";
  const gateway = String(selectedGateway || "stripe").trim().toLowerCase();
  const intentMode = String(flowType || (paymentContext?.isTrialCheckout ? "setup" : "payment")).trim().toLowerCase();

  return [
    "reg",
    "v1",
    intentMode,
    gateway,
    `plan_${planId}`,
    `email_${email}`,
    `org_${orgName}`,
    `cycle_${billingKey}`,
    `amt_${amountDue}`,
    `cur_${currency}`,
    `promo_${promoCode || "none"}`,
    `trial_${trialStart}`,
  ].join(":");
}

let stripeProcessedIntentsSchemaReady = false;

async function ensureStripeProcessedIntentsSchema(dbClient) {
  if (stripeProcessedIntentsSchemaReady) return;

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS stripe_processed_intents (
      id BIGSERIAL PRIMARY KEY,
      stripe_intent_id TEXT NOT NULL UNIQUE,
      stripe_intent_type TEXT,
      organization_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_stripe_processed_intents_org
    ON stripe_processed_intents (organization_id)
  `);

  stripeProcessedIntentsSchemaReady = true;
}

async function getActivePaymentProvider() {
  await ensurePaymentProviderSchema(db);
  return getPaymentProvider(db);
}

function resolveStripeChargeCurrencyForCountry(_countryCode, _organizationCurrency = null) {
  // Org billing charges are settled in USD only.
  // Country/currency settings are for localized display and reporting.
  return "USD";
}

async function convertUsdAmountToCurrency(usdAmount, targetCurrency) {
  const amountUsd = Number(usdAmount || 0);
  const normalizedTarget = normalizeCurrencyCode(targetCurrency) || "USD";

  if (!(amountUsd > 0)) return 0;
  if (normalizedTarget === "USD") return amountUsd;

  const rate = Number(await getUsdRate(normalizedTarget));
  if (!(rate > 0)) return amountUsd;

  return amountUsd * rate;
}

function computeNextPaymentEndDate({
  trialActiveUntil,
  chargedAmountMinor,
  billingPeriodMonths,
  billingInterval,
}) {
  if (trialActiveUntil && chargedAmountMinor <= 100) {
    return new Date(trialActiveUntil);
  }

  if (trialActiveUntil) {
    return new Date(trialActiveUntil);
  }

  const nextDate = new Date();
  if (billingPeriodMonths > 1) {
    nextDate.setMonth(nextDate.getMonth() + billingPeriodMonths);
    return nextDate;
  }

  switch (billingInterval) {
    case "5_minutes":
      nextDate.setMinutes(nextDate.getMinutes() + 5);
      break;
    case "daily":
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case "weekly":
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case "monthly":
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case "yearly":
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
    case "2_years":
      nextDate.setFullYear(nextDate.getFullYear() + 2);
      break;
    case "3_years":
      nextDate.setFullYear(nextDate.getFullYear() + 3);
      break;
    default:
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
  }

  return nextDate;
}

async function buildRegistrationChargeContext(registrationDetails, promoCode, trialStartDate, options = {}) {
  let discountAmount = 0;
  let applyDiscountOnce = false;

  const promoCodeStr = typeof promoCode === "string" ? promoCode.trim() : "";
  if (promoCodeStr) {
    const promoResult = await db.query(
      `SELECT discount_percentage, applies_once FROM promo_codes
       WHERE UPPER(code) = UPPER($1) AND is_active = TRUE AND expiration_date > NOW()`,
      [promoCodeStr]
    );

    if (promoResult.rows.length === 0) {
      const error = new Error("Invalid or expired promo code.");
      error.code = "INVALID_PROMO_CODE";
      throw error;
    }

    discountAmount = Number(promoResult.rows[0].discount_percentage || 0);
    applyDiscountOnce = Boolean(promoResult.rows[0].applies_once);
  }

  let finalAmount = Number(registrationDetails.totalCost) || 0;
  if (discountAmount > 0) {
    finalAmount -= finalAmount * (discountAmount / 100);
  }

  let chargeBreakdown = buildPlatformChargeBreakdown(finalAmount, {
    platformFeePercentage: 0,
    bearer: "parent",
    applyPlatformFee: false,
  });
  const chargeCurrency = resolveStripeChargeCurrencyForCountry(
    registrationDetails?.orgCountry,
    options.organizationCurrency
  );
  const convertedSubtotal = await convertUsdAmountToCurrency(
    chargeBreakdown.subtotalAmount,
    chargeCurrency
  );
  chargeBreakdown = buildPlatformChargeBreakdown(convertedSubtotal, {
    platformFeePercentage: 0,
    bearer: "parent",
    applyPlatformFee: false,
  });
  let amountDue = Math.round(chargeBreakdown.totalChargedAmount * 100);
  let billingInterval = "monthly";
  let freeTrialDays = null;
  let freeTrialEnabled = false;

  try {
    const intervalResult = await db.query(
      "SELECT value FROM app_settings WHERE key = 'billing_interval'"
    );
    if (intervalResult.rows.length > 0) {
      billingInterval = intervalResult.rows[0].value;
    }

    const enabledResult = await db.query(
      "SELECT value FROM app_settings WHERE key = 'free_trial_enabled'"
    );
    if (enabledResult.rows.length > 0) {
      freeTrialEnabled = enabledResult.rows[0].value;
    }

    const daysResult = await db.query(
      "SELECT value FROM app_settings WHERE key = 'free_trial_days'"
    );
    if (daysResult.rows.length > 0) {
      freeTrialDays = daysResult.rows[0].value;
    }
  } catch (_) {
  }

  const isTrialCheckout = freeTrialEnabled === "true" && !!freeTrialDays;
  let trialStartAt = null;
  let trialActiveUntil = null;

  if (isTrialCheckout) {
    amountDue = 0;
    chargeBreakdown = buildPlatformChargeBreakdown(0, {
      platformFeePercentage: 0,
      bearer: "parent",
      applyPlatformFee: false,
    });

    const minDate = startOfDayLocal(new Date());
    const maxDate = startOfDayLocal(new Date());
    maxDate.setMonth(maxDate.getMonth() + 3);

    trialStartAt = parseDateInput(trialStartDate);
    if (!trialStartAt || trialStartAt < minDate || trialStartAt > maxDate) {
      const error = new Error(
        "Please choose a valid trial start date between today and the next 3 months."
      );
      error.code = "INVALID_TRIAL_START_DATE";
      throw error;
    }

    trialActiveUntil = new Date(trialStartAt);
    if (freeTrialDays === "5_minutes") {
      trialActiveUntil.setMinutes(trialActiveUntil.getMinutes() + 5);
    } else {
      const days = parseInt(freeTrialDays, 10);
      if (days > 0) {
        trialActiveUntil.setDate(trialActiveUntil.getDate() + days);
      }
    }
  }

  return {
    promoCode: promoCodeStr,
    discountAmount,
    applyDiscountOnce,
    finalAmount,
    subtotalAmount: chargeBreakdown.subtotalAmount,
    amountDue,
    platformFeePercentage: chargeBreakdown.platformFeePercentage,
    platformFeeAmount: chargeBreakdown.platformFeeAmount,
    taxAmount: chargeBreakdown.taxAmount,
    totalChargedAmount: chargeBreakdown.totalChargedAmount,
    chargeCurrency,
    billingInterval,
    isTrialCheckout,
    freeTrialDays,
    trialStartAt,
    trialActiveUntil,
    billingPeriodKey: registrationDetails.billingPeriodKey || "monthly",
    billingPeriodMonths: Number(registrationDetails.billingPeriodMonths) || 1,
  };
}

async function saveStoredCardMethod(dbClient, orgId, card, options = {}) {
  const provider = options.provider || "paystack";
  const authorizationCode = options.authorizationCode || card.authorization_code || card.id;
  const displayName =
    options.displayName !== undefined
      ? options.displayName
      : card.display_name !== undefined
      ? card.display_name
      : card.displayName !== undefined
      ? card.displayName
      : null;

  await dbClient.query(
    `INSERT INTO stored_cards (
      organization_id,
      authorization_code,
      provider,
      last4,
      exp_month,
      exp_year,
      card_type,
      bank,
      bin,
      channel,
      signature,
      reusable,
      country_code,
      display_name,
      is_primary,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, true)
    ON CONFLICT (authorization_code) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      provider = EXCLUDED.provider,
      last4 = EXCLUDED.last4,
      exp_month = EXCLUDED.exp_month,
      exp_year = EXCLUDED.exp_year,
      card_type = EXCLUDED.card_type,
      bank = EXCLUDED.bank,
      bin = EXCLUDED.bin,
      channel = EXCLUDED.channel,
      signature = EXCLUDED.signature,
      reusable = EXCLUDED.reusable,
      country_code = EXCLUDED.country_code,
      display_name = COALESCE(stored_cards.display_name, EXCLUDED.display_name),
      is_active = true,
      updated_at = NOW()`,
    [
      orgId,
      authorizationCode,
      provider,
      card.last4 || null,
      card.exp_month || card.expMonth || null,
      card.exp_year || card.expYear || null,
      card.card_type || card.brand || "Card",
      card.bank || provider,
      card.bin || null,
      card.channel || "card",
      card.signature || null,
      card.reusable !== undefined ? card.reusable : true,
      card.country_code || null,
      displayName ? String(displayName).trim().slice(0, 120) : null,
    ]
  );

  // Only promote this card to primary if there is no other active primary card already.
  // This prevents a newly added card from displacing an existing primary.
  const existingPrimaryResult = await dbClient.query(
    `SELECT authorization_code FROM stored_cards
     WHERE organization_id = $1 AND provider = $2 AND is_active = true AND is_primary = true
       AND authorization_code <> $3
     LIMIT 1`,
    [orgId, provider, authorizationCode]
  );

  if (!existingPrimaryResult.rows.length) {
    await dbClient.query(
      `UPDATE stored_cards
       SET is_primary = true
       WHERE organization_id = $1 AND authorization_code = $2`,
      [orgId, authorizationCode]
    );
  }
}

async function ensureProfileImageColumns(db) {
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT 'profilePlaceholder.png'`);
  await db.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT 'profilePlaceholder.png'`);
}

async function sendBrandedReceiptEmail({
  to,

  name,

  amount,

  reference,

  organization,

  email,
  date,
}) {
  try {
    const templatePath = path.join(
      __dirname,
      "../utils/templates/receiptEmail.html"
    );
    let html = await fs.promises.readFile(templatePath, "utf8");
    const year = new Date().getFullYear();

    html = html

      .replace(/{{name}}/g, name)

      .replace(/{{amount}}/g, amount)

      .replace(/{{reference}}/g, reference)

      .replace(/{{organization}}/g, organization)

      .replace(/{{email}}/g, email)

      .replace(/{{date}}/g, date)

      .replace(/{{year}}/g, year);

    sendEmailInBackground(
      {
        to,
        subject: "Payment Receipt - Managira",
        html,
        attachments: [
          {
            filename: "managira.png",
            path: path.join(__dirname, "../public/images/managira.png"),
            cid: "managira_logo",
          },
        ],
      },
      "ReceiptEmail"
    );
  } catch (error) {
        throw new Error("Failed to send receipt email.");
  }
}

async function sendInvoiceEmail(email, orgName, invoice) {
  try {
    const invoiceUrl = invoice.hosted_invoice_url || "No URL available";

    const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString();

    const amountDue = (invoice.amount_due / 100).toFixed(2);

    const html = renderCleanEmail({
      title: "New Invoice from Managira",
      greeting: "Hello,",
      paragraphs: ["A new invoice has been generated for your subscription."],
      details: [
        { label: "Organization Name", value: he.encode(orgName) },
        { label: "Amount Due", value: `$${he.encode(amountDue)}` },
        { label: "Due Date", value: he.encode(dueDate) },
      ],
      cta: invoiceUrl !== "No URL available" ? { text: "View Invoice", url: invoiceUrl } : null,
      note: 'If you have any questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
    });

    const mailOptions = {
      from: process.env.NOTIFY_EMAIL_USER,

      to: email,

      subject: "New Invoice from Managira",

      html,

      attachments: [
        {
          filename: "managira.png",
          path: path.join(__dirname, "../public/images/managira.png"),
          cid: "managira_logo",
        },
      ],
    };

    sendEmailInBackground(mailOptions, "Invoice Email");
  } catch (error) {
        throw new Error("Failed to send invoice email.");
  }
}

async function sendCancellationEmail(orgName, firstName, email) {
  if (!email) {
    throw new Error("Recipient email is not defined.");
  }

  const html = renderCleanEmail({
    title: "Subscription Cancellation Confirmation",
    greeting: `Dear <strong>${he.encode(firstName)}</strong>,`,
    paragraphs: [
      `We wanted to confirm that your subscription for <strong>${he.encode(orgName)}</strong> has been successfully canceled.`,
      "You will continue to have full access until the end of your current billing cycle, after which your subscription will be fully deactivated.",
      "If you decide to reactivate before the billing cycle ends, you can do so from your account settings.",
      "If you need any assistance, our support team is always available.",
    ],
    note: 'If you have questions, please visit our <a href="https://www.managira.com/legal/help" target="_blank" rel="noopener">Help Center</a> or <a href="https://www.managira.com/legal/faq" target="_blank" rel="noopener">FAQ page</a>.',
  });

  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,

    to: email,

    subject: "Subscription Cancellation Confirmation",

    html,
    attachments: [
      {
        filename: "managira.png",
        path: path.join(__dirname, "../public/images/managira.png"),
        cid: "managira_logo",
      },
    ],
  };
  sendEmailInBackground(mailOptions, "Cancellation Email");
}

async function sendRegistrationSuccessEmail(
  email,

  firstName,

  lastName
) {
  try {
    const html = renderCleanEmail({
      title: "Welcome to Managira",
      greeting: `Hi <strong>${he.encode(firstName)} ${he.encode(lastName)}</strong>,`,
      paragraphs: [
        "Your organization account has been successfully registered and is now active.",
        "You can now log in and start using all the features of Managira.",
      ],
      cta: { text: "Log In to Your Account", url: "https://www.managira.com/account/login" },
      note: 'To get onboarded fast, open the attached Managira Starter Pack (PDF). You can also review our <a href="https://docs.google.com/document/d/1bgFP5cCQyr-9jdaYZTsWO8ONAnAuNUKqKQ2if_4TBOM/edit?tab=t.o84y9ldsnqto#heading=h.o10u93e8wqgq" target="_blank" rel="noopener">User Documentation Guide</a> and watch our <a href="https://youtu.be/D8da4yiDBWc?si=NMJKd9PCmMq98IzJ" target="_blank" rel="noopener">Walkthrough Video</a>.',
    });

    const mailOptions = {
      from: process.env.NOTIFY_EMAIL_USER,

      to: email,

      subject: "Account Registration Confirmation",

      html,

      attachments: [
        {
          filename: "managira.png",
          path: path.join(__dirname, "../public/images/managira.png"),
          cid: "managira_logo",
        },

        {
          // Attach the starter pack PDF for new users
          filename: "Managira Starter Pack.pdf",
          path: path.join(
            __dirname,
            "../public/managira pdf/Managira Starter Pack.pdf"
          ),
        },
      ],
    };

    sendEmailInBackground(mailOptions, "Registration Success Email");
  } catch (error) {
        throw new Error("Failed to send registration success email.");
  }
}

// Helper function to send password reset email

async function sendPasswordResetEmail(email, token, baseUrl) {
  const resetLink = `${baseUrl}/account/reset-password?token=${token}`;

  const html = renderCleanEmail({
    title: "Password Reset Request",
    greeting: "Hello,",
    paragraphs: [
      "You requested to reset your password.",
      "Click the button below to continue. This link will expire in 15 minutes.",
      "If you did not request this, you can safely ignore this email.",
    ],
    cta: { text: "Reset Password", url: resetLink },
  });

  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,

    to: email,

    subject: "Password Reset Request",

    html,
  };

  sendEmailInBackground(mailOptions, "Password Reset Request Email");
}

async function sendPasswordResetConfirmationEmail(email) {
  const html = renderCleanEmail({
    title: "Password Reset Successful",
    greeting: "Dear User,",
    paragraphs: [
      "Your password has been successfully reset.",
      "If you did not request this change, please contact support immediately.",
    ],
  });

  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_USER,

    to: email,

    subject: "Password Reset Successful",

    html,
  };

  try {
    sendEmailInBackground(mailOptions, "Password Reset Confirmation Email");
  } catch (error) {
      }
}

async function notifyAdminOfRegistration(
  firstName,

  lastName,

  orgName,

  email,

  orgPhone
) {
  sendEmailInBackground({
    to: process.env.ADMIN_EMAIL,
    subject: "New Account Registration",
    text: `A new account has been registered:\n\nName: ${firstName} ${lastName}\nOrganization: ${orgName}\nEmail: ${email}\nPhone: ${orgPhone}\n\nPlease review the registration details.`,
  }, "Admin Registration Notification");
}

async function saveCardAuthorization(db, orgId, authorization) {
  await saveStoredCardMethod(db, orgId, authorization, {
    provider: "paystack",
    authorizationCode: authorization.authorization_code,
  });
}

async function getStoredCardPaymentMethods(db, orgId, provider = null) {
  const result = await db.query(
    `SELECT authorization_code, card_type, last4, exp_month, exp_year, is_primary, fallback_order, display_name
     FROM stored_cards
     WHERE organization_id = $1 AND is_active = true
       AND ($2::text IS NULL OR provider = $2)
     ORDER BY is_primary DESC, fallback_order ASC NULLS LAST, updated_at DESC, created_at DESC`,
    [orgId, provider]
  );

  return result.rows.map((row) => ({
    id: row.authorization_code,
    brand: row.card_type || "Card",
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    displayName: row.display_name || null,
    isPrimary: Boolean(row.is_primary),
    fallbackOrder: row.fallback_order === null ? null : Number(row.fallback_order),
  }));
}

function pickDefaultCard(paymentMethods = [], storedCardMethods = []) {
  if (!paymentMethods.length) return null;

  const primaryStoredCard = storedCardMethods.find((card) => card.isPrimary);
  if (primaryStoredCard) {
    const matched = paymentMethods.find((card) => card.id === primaryStoredCard.id);
    if (matched) return matched;
  }

  return paymentMethods[0] || null;
}

async function listStripeInvoices(stripe, stripeCustomerId, limit = 12) {
  const invoiceResult = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit,
  });

  return (invoiceResult.data || []).map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: (invoice.currency || "usd").toUpperCase(),
    amountPaid: Number(invoice.amount_paid || 0) / 100,
    amountDue: Number(invoice.amount_due || 0) / 100,
    hostedInvoiceUrl: invoice.hosted_invoice_url || null,
    invoicePdf: invoice.invoice_pdf || null,
    createdAt: invoice.created ? new Date(invoice.created * 1000) : null,
  }));
}

async function ensureBillingInvoicesSchema(dbClient) {
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      invoice_number TEXT,
      invoice_type TEXT NOT NULL DEFAULT 'precharge',
      status TEXT NOT NULL DEFAULT 'issued',
      amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      billing_period_key TEXT,
      scheduled_charge_at TIMESTAMPTZ,
      email_sent_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      payment_intent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureOrganizationPlanChangeEventsSchema(dbClient) {
  if (organizationPlanChangeEventsSchemaReady) return;

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS organization_plan_change_events (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL,
      actor_user_id BIGINT,
      from_plan_id INT,
      to_plan_id INT,
      change_type TEXT NOT NULL,
      event_stage TEXT NOT NULL DEFAULT 'applied',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_at TIMESTAMPTZ,
      billing_period_key TEXT,
      charge_required BOOLEAN NOT NULL DEFAULT FALSE,
      charge_applied BOOLEAN NOT NULL DEFAULT FALSE,
      charge_amount_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
      charge_currency TEXT,
      charge_amount NUMERIC(12, 2),
      charge_reference TEXT,
      charge_reason TEXT,
      note TEXT
    )
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_org_plan_change_events_org_requested
    ON organization_plan_change_events (organization_id, requested_at DESC)
  `);

  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_org_plan_change_events_type_stage
    ON organization_plan_change_events (change_type, event_stage)
  `);

  organizationPlanChangeEventsSchemaReady = true;
}

async function recordOrganizationPlanChangeEvent(dbClient, eventPayload = {}) {
  const organizationId = Number(eventPayload.organizationId || 0);
  if (!organizationId) return null;

  await ensureOrganizationPlanChangeEventsSchema(dbClient);

  const actorUserId = Number(eventPayload.actorUserId || 0) || null;
  const fromPlanId = Number(eventPayload.fromPlanId || 0) || null;
  const toPlanId = Number(eventPayload.toPlanId || 0) || null;
  const changeType = String(eventPayload.changeType || "unknown").trim().toLowerCase();
  const eventStage = String(eventPayload.eventStage || "applied").trim().toLowerCase();
  const effectiveAt = eventPayload.effectiveAt ? new Date(eventPayload.effectiveAt) : null;
  const billingPeriodKey = eventPayload.billingPeriodKey ? String(eventPayload.billingPeriodKey).trim() : null;
  const chargeRequired = Boolean(eventPayload.chargeRequired);
  const chargeApplied = Boolean(eventPayload.chargeApplied);
  const chargeAmountUsd = Number(eventPayload.chargeAmountUsd || 0);
  const chargeCurrency = eventPayload.chargeCurrency ? String(eventPayload.chargeCurrency).trim().toUpperCase() : null;
  const chargeAmount = eventPayload.chargeAmount === null || eventPayload.chargeAmount === undefined
    ? null
    : Number(eventPayload.chargeAmount);
  const chargeReference = eventPayload.chargeReference ? String(eventPayload.chargeReference).trim() : null;
  const chargeReason = eventPayload.chargeReason ? String(eventPayload.chargeReason).trim() : null;
  const note = eventPayload.note ? String(eventPayload.note).trim() : null;

  const result = await dbClient.query(
    `INSERT INTO organization_plan_change_events (
      organization_id,
      actor_user_id,
      from_plan_id,
      to_plan_id,
      change_type,
      event_stage,
      effective_at,
      billing_period_key,
      charge_required,
      charge_applied,
      charge_amount_usd,
      charge_currency,
      charge_amount,
      charge_reference,
      charge_reason,
      note
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16
    )
    RETURNING id, requested_at`,
    [
      organizationId,
      actorUserId,
      fromPlanId,
      toPlanId,
      changeType,
      eventStage,
      effectiveAt && !Number.isNaN(effectiveAt.getTime()) ? effectiveAt : null,
      billingPeriodKey,
      chargeRequired,
      chargeApplied,
      Number.isFinite(chargeAmountUsd) ? chargeAmountUsd : 0,
      chargeCurrency,
      chargeAmount,
      chargeReference,
      chargeReason,
      note,
    ]
  );

  return result.rows[0] || null;
}

async function getLatestAppliedUpgradePlanChangeEvent(dbClient, organizationId) {
  const orgId = Number(organizationId || 0);
  if (!orgId) return null;

  await ensureOrganizationPlanChangeEventsSchema(dbClient);

  const result = await dbClient.query(
    `SELECT id, organization_id, from_plan_id, to_plan_id, requested_at, effective_at
     FROM organization_plan_change_events
     WHERE organization_id = $1
       AND change_type = 'upgrade'
       AND event_stage = 'applied'
     ORDER BY COALESCE(effective_at, requested_at) DESC, id DESC
     LIMIT 1`,
    [orgId]
  );

  return result.rows[0] || null;
}

async function listAppInvoices(dbClient, organizationId, limit = 12) {
  await ensureBillingInvoicesSchema(dbClient);
  const result = await dbClient.query(
    `SELECT id, invoice_number, invoice_type, status, amount_due, currency,
            billing_period_key, scheduled_charge_at, email_sent_at,
            paid_at, failed_at, created_at
     FROM billing_invoices
     WHERE organization_id = $1
     ORDER BY COALESCE(scheduled_charge_at, created_at) DESC
     LIMIT $2`,
    [organizationId, limit]
  );

  return result.rows.map((row) => {
    const publicReference = buildPublicInvoiceReference(row, organizationId);
    return {
      id: row.id,
      number: row.invoice_number,
      type: row.invoice_type,
      status: row.status,
      amountDue: Number(row.amount_due || 0),
      currency: String(row.currency || 'USD').toUpperCase(),
      billingPeriodKey: row.billing_period_key,
      scheduledChargeAt: row.scheduled_charge_at,
      emailSentAt: row.email_sent_at,
      paidAt: row.paid_at,
      failedAt: row.failed_at,
      createdAt: row.created_at,
      displayName: 'Managira Invoice (SCREATE LLC)',
      displayReference: publicReference,
      internalNumber: row.invoice_number || null,
    };
  });
}

function buildPublicInvoiceReference(invoice = {}, organizationIdFallback = null) {
  const dateSource = invoice.scheduled_charge_at
    || invoice.scheduledChargeAt
    || invoice.created_at
    || invoice.createdAt
    || Date.now();
  const refDate = new Date(dateSource);
  const safeDate = Number.isNaN(refDate.getTime()) ? new Date() : refDate;
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(safeDate.getUTCDate()).padStart(2, "0");
  const orgIdRaw = Number(
    invoice.organization_id
      || invoice.organizationId
      || organizationIdFallback
      || 0
  );
  const invoiceIdRaw = Number(invoice.id || invoice.invoice_id || 0);
  const orgSegment = String(orgIdRaw > 0 ? orgIdRaw : 0).padStart(4, "0");
  const invoiceSegment = String(invoiceIdRaw > 0 ? invoiceIdRaw : 0).padStart(4, "0");
  return `MGI-${yyyy}${mm}${dd}-${orgSegment}-${invoiceSegment}`;
}

function buildStudentPricingBasisSummary({
  studentCount,
  freeThreshold,
  extraStudents,
}) {
  const totalStudents = Math.max(0, Number(studentCount || 0));
  const threshold = Math.max(0, Number(freeThreshold || 0));
  const totalWord = totalStudents === 1 ? "student" : "students";

  if (!(threshold > 0)) {
    return `Student pricing basis: ${totalStudents} ${totalWord} total.`;
  }

  const billableStudents = Math.max(
    0,
    Number.isFinite(Number(extraStudents))
      ? Number(extraStudents)
      : totalStudents - threshold
  );
  const thresholdWord = threshold === 1 ? "student" : "students";
  const billableWord = billableStudents === 1 ? "student" : "students";

  return `Student pricing basis: ${totalStudents} ${totalWord} total, first ${threshold} ${thresholdWord} free, ${billableStudents} ${billableWord} billable.`;
}

function formatInvoicePdfDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function titleCaseStatus(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

async function generateAppInvoicePdfBuffer(payload) {
  const {
    invoice,
    organization,
    planName,
    cycleLabel,
    supportEmail,
    studentPricingSummary,
  } = payload;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 96;

    const teal = "#00D4AA";
    const deep = "#1a1f2e";
    const muted = "#5a6378";
    const border = "#e6e9f0";
    const soft = "#f5f7fb";

    const totalDue = Number(invoice.amount_due || 0);
    const currencyCode = String(invoice.currency || "USD").toUpperCase();
    const invoiceReference = buildPublicInvoiceReference(invoice);
    const status = String(invoice.status || "issued").toLowerCase();
    const statusLabel = titleCaseStatus(status);
    const invoiceHeaderTitle = "Invoice";
    const issuedAtText = formatInvoicePdfDate(invoice.created_at);
    const scheduledAtText = formatInvoicePdfDate(invoice.scheduled_charge_at);
    const paidAtText = invoice.paid_at ? formatInvoicePdfDate(invoice.paid_at) : null;
    const failedAtText = invoice.failed_at ? formatInvoicePdfDate(invoice.failed_at) : null;
    const emailSentText = invoice.email_sent_at ? formatInvoicePdfDate(invoice.email_sent_at) : null;
    const accountContactLine = [organization.organization_phone, organization.email].filter(Boolean).join(" · ");
    const issueDate = (() => {
      const d = invoice.created_at ? new Date(invoice.created_at) : null;
      if (!d || Number.isNaN(d.getTime())) return "-";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    })();
    const dueDate = (() => {
      const d = invoice.scheduled_charge_at ? new Date(invoice.scheduled_charge_at) : null;
      if (!d || Number.isNaN(d.getTime())) return "-";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    })();
    const amountDisplay = `${currencyCode} ${totalDue.toFixed(2)}`;

    doc.roundedRect(48, 38, contentWidth, 700, 14).fill("#ffffff").strokeColor(border).lineWidth(1).stroke();

    doc.rect(48, 38, contentWidth, 96).fill("#f5f6fa");
    doc.moveTo(48, 130).lineTo(48 + contentWidth, 130).strokeColor(teal).lineWidth(2).stroke();

    doc.fillColor(deep).font("Helvetica-Bold").fontSize(30).text(invoiceHeaderTitle, 64, 56, { width: 220 });
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(10).text("Managira (SCREATE LLC)", 320, 64, { width: 220, align: "right" });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(`Ref ${invoiceReference}`, 320, 80, { width: 220, align: "right" });

    const statusBg = status === "paid" ? "#d6f7ec" : status === "failed" ? "#ffd8df" : "#e6e9f0";
    const statusColor = status === "paid" ? "#00845f" : status === "failed" ? "#b1213e" : "#5a6378";
    doc.roundedRect(452, 138, 88, 18, 9).fill(statusBg);
    doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(8).text(statusLabel.toUpperCase(), 452, 144, { width: 88, align: "center" });

    let y = 156;
    const metaRows = [
      ["Invoice ref", invoiceReference],
      ["Date of issue", issueDate],
      ["Date due", dueDate],
      ["Billing period", cycleLabel || "Monthly"],
      ["Account", organization.organization_name || "Organization"],
    ];
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8);
    metaRows.forEach((row, index) => {
      const rowY = y + (index * 16);
      doc.text(row[0], 62, rowY, { width: 100 });
      doc.fillColor(deep).font("Helvetica").text(row[1], 170, rowY, { width: 190 });
      doc.fillColor(muted).font("Helvetica-Bold");
    });

    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("From", 320, y, { width: 100 });
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text("Managira (SCREATE LLC)", 320, y + 14, { width: 220 });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(`Support: ${supportEmail || "support@managira.com"}`, 320, y + 30, { width: 220 });

    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text("Bill to", 320, y + 52, { width: 100 });
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text(organization.organization_name || "Organization", 320, y + 66, { width: 220 });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(accountContactLine || "-", 320, y + 82, { width: 220 });

    y += 112;
    doc.roundedRect(48, y, contentWidth, 28, 6).fill(soft);
    doc.fillColor(muted).font("Helvetica-Bold").fontSize(8);
    doc.text("Description", 62, y + 10, { width: 260 });
    doc.text("Qty", 360, y + 10, { width: 45, align: "right" });
    doc.text("Unit Price", 410, y + 10, { width: 80, align: "right" });
    doc.text("Amount", 495, y + 10, { width: 45, align: "right" });

    y += 28;
    doc.roundedRect(48, y, contentWidth, 58, 6).strokeColor(border).lineWidth(1).stroke();
    doc.fillColor(deep).font("Helvetica").fontSize(10).text(`${planName || "Platform Subscription"} renewal invoice`, 62, y + 16, { width: 300 });
    doc.fillColor(muted).font("Helvetica").fontSize(8.5).text(studentPricingSummary || "Auto-generated from your billing settings", 62, y + 32, { width: 300 });
    doc.fillColor(deep).font("Helvetica").fontSize(10).text("1", 360, y + 22, { width: 45, align: "right" });
    doc.fillColor(deep).font("Helvetica").fontSize(10).text(amountDisplay, 410, y + 22, { width: 80, align: "right" });
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(11).text(amountDisplay, 495, y + 22, { width: 45, align: "right" });

    y += 76;
    doc.fillColor(muted).font("Helvetica").fontSize(10);
    doc.text("Subtotal", 340, y + 2, { width: 120 });
    doc.fillColor(deep).font("Helvetica").text(amountDisplay, 430, y + 2, { width: 110, align: "right" });
    doc.fillColor(muted).font("Helvetica").text("Total", 340, y + 18, { width: 120 });
    doc.fillColor(deep).font("Helvetica").text(amountDisplay, 430, y + 18, { width: 110, align: "right" });
    doc.moveTo(340, y + 36).lineTo(540, y + 36).strokeColor(border).lineWidth(1).stroke();
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(12).text("Amount due", 340, y + 42, { width: 120 });
    doc.text(amountDisplay, 430, y + 42, { width: 110, align: "right" });

    y += 72;
    const timelineLines = [
      `Issued: ${issuedAtText}`,
      `Scheduled charge date: ${scheduledAtText}`,
    ];
    if (emailSentText) {
      timelineLines.splice(1, 0, `Invoice email sent: ${emailSentText}`);
    }
    if (invoice.paid_at) {
      timelineLines.push(`Paid at: ${paidAtText}`);
    }
    if (invoice.failed_at) {
      timelineLines.push(`Failed at: ${failedAtText}`);
    }

    const timelineHeight = Math.max(88, 42 + (timelineLines.length * 16));
    doc.roundedRect(48, y, contentWidth, timelineHeight, 8).fill(soft);
    doc.fillColor(deep).font("Helvetica-Bold").fontSize(10).text("Payment Timeline", 62, y + 14);
    doc.fillColor(muted).font("Helvetica").fontSize(9);
    timelineLines.forEach((line, index) => {
      doc.text(line, 62, y + 34 + (index * 16));
    });

    const footerY = doc.page.height - 58;
    doc.moveTo(48, footerY - 10).lineTo(48 + contentWidth, footerY - 10).strokeColor(border).lineWidth(1).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(8);
    doc.text(`Need help? Contact ${supportEmail || "support@managira.com"}`, 48, footerY, { width: 320 });
    doc.text(`Generated ${formatInvoicePdfDate(new Date())}`, 320, footerY, { width: 228, align: "right" });

    doc.end();
  });
}

async function buildChargeResponse(db, orgId, chargeResult) {
  if (chargeResult?.status && chargeResult?.data?.authorization) {
    const authorization = chargeResult.data.authorization;
    await saveCardAuthorization(db, orgId, authorization);
    return {
      success: true,
      message: "Card added successfully",
      card: {
        authorization_code: authorization.authorization_code,
        last_four: authorization.last4,
        card_type: authorization.card_type,
        bank: authorization.bank,
      },
    };
  }

  const status = chargeResult?.data?.status;
  const stepMap = {
    send_pin: "pin",
    send_otp: "otp",
    send_phone: "phone",
    send_birthday: "birthday",
  };

  if (chargeResult?.status && status && stepMap[status]) {
    return {
      success: false,
      nextStep: stepMap[status],
      reference: chargeResult?.data?.reference,
      message:
        chargeResult?.data?.display_text ||
        chargeResult?.data?.message ||
        chargeResult?.message ||
        "Additional verification required.",
    };
  }

  return {
    success: false,
    message:
      chargeResult?.message ||
      chargeResult?.data?.message ||
      "Failed to add card. Please check your card details.",
  };
}

async function completeStripeRegistrationPayment(
  paymentIntent,
  registrationDetails,
  paymentContext
) {
  console.log("[Stripe][complete] start", {
    paymentIntentId: paymentIntent.id,
    sourceType: paymentIntent.type || "payment_intent",
    status: paymentIntent.status,
    amount_received: paymentIntent.amount_received,
    customer: paymentIntent.customer,
    org: registrationDetails.orgName,
    email: registrationDetails.email,
    planId: registrationDetails.planId,
  });
  await ensurePaymentProviderSchema(db);
  await ensureStripeProcessedIntentsSchema(db);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    console.log("[Stripe][complete] transaction begin");

    const processedIntentId = String(paymentIntent?.id || "").trim();
    if (!processedIntentId) {
      throw new Error("Stripe intent id is missing during registration completion.");
    }

    const lockResult = await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [processedIntentId]
    );
    if (!lockResult) {
      throw new Error("Unable to acquire registration payment lock.");
    }

    const existingProcessed = await client.query(
      `SELECT organization_id
         FROM stripe_processed_intents
        WHERE stripe_intent_id = $1
        LIMIT 1`,
      [processedIntentId]
    );

    if (existingProcessed.rows.length > 0) {
      const existingOrganizationId = Number(existingProcessed.rows[0].organization_id || 0) || null;
      await client.query("COMMIT");
      console.log("[Stripe][complete] duplicate intent ignored", {
        paymentIntentId: processedIntentId,
        organizationId: existingOrganizationId,
      });
      return {
        organizationId: existingOrganizationId,
        discountAmount: paymentContext.discountAmount,
        finalAmount: paymentContext.finalAmount,
        totalChargedAmount: paymentContext.totalChargedAmount,
        platformFeePercentage: paymentContext.platformFeePercentage,
        platformFeeAmount: paymentContext.platformFeeAmount,
        chargeCurrency: paymentContext.chargeCurrency,
        alreadyProcessed: true,
      };
    }

    const orgResult = await client.query(
      `INSERT INTO organizations (
        organization_name,
        nickname,
        nickname_display,
        organization_address,
        organization_country,
        organization_currency,
        organization_province,
        organization_phone,
        email,
        password,
        first_name,
        last_name,
        proof_of_existence_1,
        proof_of_existence_2,
        plan_id,
        stripe_customer_id,
        billing_provider,
        trial_start_at,
        trial_active_until,
        selected_student_tier_id,
        approx_student_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      ) RETURNING organization_id`,
      [
        registrationDetails.orgName,
        registrationDetails.orgNickName,
        registrationDetails.orgNickNameDisplay || registrationDetails.orgNickName,
        registrationDetails.orgAddress,
        registrationDetails.orgCountry,
        normalizeCurrencyCode(
          registrationDetails.organizationCurrency ||
          getCurrencyForCountry(registrationDetails.orgCountry)
        ) || null,
        registrationDetails.orgProvince,
        registrationDetails.orgPhone,
        registrationDetails.email,
        registrationDetails.passwordHash,
        registrationDetails.firstName,
        registrationDetails.lastName,
        registrationDetails.proof1Url,
        registrationDetails.proof2Url,
        registrationDetails.planId,
        paymentIntent.customer || null,
        "stripe",
        paymentContext.trialStartAt || null,
        paymentContext.trialActiveUntil || null,
        registrationDetails.selectedTierId || null,
        registrationDetails.approxStudentCount || null,
      ]
    );

    const organizationId = orgResult.rows[0].organization_id;
    console.log("[Stripe][complete] organization inserted", { organizationId });
    invalidateAdminOrganizationsCache();

    const nextPaymentEndDate = computeNextPaymentEndDate({
      trialActiveUntil: paymentContext.trialActiveUntil,
      chargedAmountMinor: paymentIntent.amount_received || paymentIntent.amount,
      billingPeriodMonths: paymentContext.billingPeriodMonths,
      billingInterval: paymentContext.billingInterval,
    });

    await client.query(
      `INSERT INTO payments (
        organization_id,
        paystack_subscription_code,
        paystack_reference,
        stripe_payment_intent_id,
        amount_paid,
        status,
        discount_applied,
        applies_once,
        is_trial,
        trial_starts_at,
        trial_ends_at,
        next_payment_end_date,
        billing_period_key,
        payment_provider
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )`,
      [
        organizationId,
        null,
        null,
        paymentIntent.type === "setup_intent" ? null : paymentIntent.id,
        (paymentIntent.amount_received || paymentIntent.amount) / 100,
        "active",
        paymentContext.discountAmount > 0 ? `${paymentContext.discountAmount}%` : null,
        paymentContext.applyDiscountOnce,
        Boolean(paymentContext.trialActiveUntil),
        paymentContext.trialStartAt || null,
        paymentContext.trialActiveUntil || null,
        nextPaymentEndDate,
        paymentContext.billingPeriodKey,
        "stripe",
      ]
    );
    console.log("[Stripe][complete] payments row inserted", {
      organizationId,
      stripe_payment_intent_id: paymentIntent.type === "setup_intent" ? null : paymentIntent.id,
      next_payment_end_date: nextPaymentEndDate,
    });

    const stripe = await getStripeClient(db);
    const paymentMethodId = typeof paymentIntent.payment_method === "string"
      ? paymentIntent.payment_method
      : paymentIntent.payment_method?.id;
    let paymentMethod = null;

    if (paymentMethodId) {
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (paymentIntent.customer) {
        await stripe.customers.update(paymentIntent.customer, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });
      }

      await saveStoredCardMethod(client, organizationId, {
        id: paymentMethodId,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
        expMonth: paymentMethod.card?.exp_month,
        expYear: paymentMethod.card?.exp_year,
        country_code: paymentMethod.card?.country,
      }, {
        provider: "stripe",
        authorizationCode: paymentMethodId,
      });
      console.log("[Stripe][complete] stored_cards row saved", {
        organizationId,
        paymentMethodId,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
      });
    } else {
      console.warn("[Stripe][complete] no payment method on intent; skipping stored_cards");
    }

    await client.query(
      `INSERT INTO stripe_processed_intents (
        stripe_intent_id,
        stripe_intent_type,
        organization_id
      ) VALUES ($1, $2, $3)
      ON CONFLICT (stripe_intent_id) DO NOTHING`,
      [
        processedIntentId,
        String(paymentIntent?.type || "payment_intent"),
        organizationId,
      ]
    );

    await client.query("COMMIT");
    console.log("[Stripe][complete] transaction committed", { organizationId });

    try {
      await sendRegistrationSuccessEmail(
        registrationDetails.email,
        registrationDetails.firstName,
        registrationDetails.lastName
      );
    } catch (_) {
    }

    if ((paymentIntent.amount_received || paymentIntent.amount || 0) > 0) {
      try {
        await sendReceiptEmail(
          registrationDetails.email,
          {
            amount: paymentIntent.amount_received || paymentIntent.amount,
            paymentReference: paymentIntent.id,
          },
          registrationDetails.orgName
        );
      } catch (_) {
      }
    }

    console.log("[Stripe][complete] done", { organizationId });
    return {
      organizationId,
      discountAmount: paymentContext.discountAmount,
      finalAmount: paymentContext.finalAmount,
      totalChargedAmount: paymentContext.totalChargedAmount,
      platformFeePercentage: paymentContext.platformFeePercentage,
      platformFeeAmount: paymentContext.platformFeeAmount,
      chargeCurrency: paymentContext.chargeCurrency,
    };
  } catch (error) {
    console.error("[Stripe][complete] failed; rolling back:", error);
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const accountController = {
  // Utility: List Paystack banks for UI dropdowns

  sendBrandedReceiptEmail,

  listPaystackBanks: async (req, res) => {
    try {
      const country = (req.query.country || "ghana").toLowerCase();
      const paystackSecretKey = await getActivePaystackSecretKey();
      const headers = {
        headers: { Authorization: `Bearer ${paystackSecretKey}` },
      };
      const response = await axios.get(
        `https://api.paystack.co/bank?country=${country}`,
        headers
      );
      return res.json({ success: true, banks: response.data?.data || [] });
    } catch (err) {
            return res
        .status(500)
        .json({ success: false, message: "Failed to list banks" });
    }
  },

  servicePlanGet: async (req, res) => {
    try {
      // Optional reset for a fresh signup flow
      if (req.query.new) {
        delete req.session.registrationDetails;
        delete req.session.planSelection;
      }

      // If a plan is preselected via query, keep it for highlighting
      const preselectedPlanId = req.session.planSelection?.planId || req.query.plan || null;
      const trialRequested = parseTruthyFlag(
        req.session.planSelection?.trialRequested || req.query.trial
      );

      const url = req.url;
      const orgId = Number(req.session?.organizationId || 0) || null;
      const currencyProfile = await getCurrencyProfileForRequest(req, { organizationId: orgId });

      const plansResult = await db.query(`
            SELECT p.id AS plan_id, p.plan_name, p.description, p.is_active, p.plan_name AS category,
            COALESCE(JSON_AGG(json_build_object('feature_name', f.feature_name) ORDER BY f.feature_name)
            FILTER (WHERE f.id IS NOT NULL), '[]') AS features,
            COALESCE(SUM(f.price_usd), 0) AS total_price
            FROM plans p
            LEFT JOIN plan_features pf ON p.id = pf.plan_id
            LEFT JOIN features f ON pf.feature_id = f.id
            WHERE p.is_active = TRUE
            GROUP BY p.id
            ORDER BY p.id;
            `);

      const plans = plansResult.rows
        .map((plan) => ({
          ...plan,
          total_price: parseFloat(plan.total_price) || 0,
        }))
        .map((plan) => {
          const localized = localizeUsdAmount(plan.total_price, currencyProfile);
          return {
            ...plan,
            priceUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
            localizedPriceDisplay: formatCurrencyAmount(
              localized.localizedAmount,
              localized.userCurrency,
              currencyProfile.locale
            ),
            localizedCurrencyCode: localized.userCurrency,
          };
        });

      const trialSettings = await getFreeTrialSettings(db);
      const freeTrialEnabled = Boolean(trialSettings.enabled);
      const freeTrialLengthLabel = formatFreeTrialLength(trialSettings.days);
      const premiumPlanId = null;
      const premiumPlanName = null;
      const trialEligible = true;

      // Use dynamic billing cycles on live service-plan.
      let billingPeriods = [];
      try {
        const cyclesResult = await db.query(
          "SELECT cycle_key AS period_key, label, months, discount_percentage, sort_order FROM dynamic_billing_cycles WHERE is_active = TRUE ORDER BY sort_order, months"
        );
        billingPeriods = cyclesResult.rows || [];
      } catch (err) {
      }
      if (!billingPeriods.length) {
        billingPeriods = [{ period_key: 'monthly', label: 'Monthly', months: 1, discount_percentage: 0 }];
      }

      const countryCode = currencyProfile?.countryCode || null;
      const dynamicRegion = await getRegionForCountry(db, countryCode).catch(() => null);
      const dynamicTermDivider = await getDynamicTermDivider(db);

      // Build student-size choices and default display from dynamic pricing rows.
      let studentTiersByPlan = {};
      const dynamicPriceMetaByPlan = {};
      const lowestTierPriceByPlan = new Map();
      const usedDynamicPricing = Boolean(dynamicRegion);

      if (dynamicRegion) {
        await Promise.all(
          plans.map(async (plan) => {
            const pricingMatch = await getBestPlanRegionPrice(db, Number(plan.plan_id), Number(dynamicRegion.id)).catch(() => null);
            const row = pricingMatch?.priceRow || null;
            const planRegion = pricingMatch?.region || dynamicRegion;
            if (!row) return;
            const threshold = Math.max(0, Number(row.free_student_threshold) || 0);
            const planRegionTermMonths = await getDynamicRegionTermMonths(
              db,
              Number(planRegion?.id || dynamicRegion.id),
              dynamicTermDivider
            );
            dynamicPriceMetaByPlan[plan.plan_id] = {
              basePriceUsd: Number(row.base_price_usd || 0),
              freeStudentThreshold: threshold,
              perStudentRateUsd: Number(row.per_student_rate_usd || 0),
              monthsPerTerm: planRegionTermMonths,
            };
            const makeTier = (idSuffix, minStudents, maxStudents, sampleCount) => {
              const monthly = computeDynamicMonthlyPrice(row, sampleCount, {
                termDivider: planRegionTermMonths,
              });
              const loc = localizeUsdAmount(monthly.monthlyTotal, currencyProfile);
              return {
                id: `dyn_${plan.plan_id}_${idSuffix}`,
                plan_id: plan.plan_id,
                min_students: minStudents,
                max_students: maxStudents,
                computed_price_usd: monthly.monthlyTotal,
                priceUsdDisplay: formatCurrencyAmount(loc.amountUsd, "USD"),
                localizedPriceDisplay: formatCurrencyAmount(loc.localizedAmount, loc.userCurrency, currencyProfile.locale),
              };
            };

            const tiers = [
              makeTier('a', 0, threshold, threshold),
              makeTier('b', threshold + 1, threshold + 100, threshold + 100),
              makeTier('c', threshold + 101, threshold + 300, threshold + 250),
              makeTier('d', threshold + 301, null, threshold + 500),
            ];

            studentTiersByPlan[plan.plan_id] = tiers;
            lowestTierPriceByPlan.set(String(plan.plan_id), Number(row.base_price_usd || 0));
          })
        );
      }

      const plansWithDefaultDisplayPrice = plans.map((plan) => {
        const defaultUsd = lowestTierPriceByPlan.has(String(plan.plan_id))
          ? Number(lowestTierPriceByPlan.get(String(plan.plan_id)))
          : Number(plan.total_price || 0);
        const localized = localizeUsdAmount(defaultUsd, currencyProfile);
        return {
          ...plan,
          defaultDisplayUsd: defaultUsd,
          defaultDisplayLocal: localized.localizedAmount,
          defaultPriceUsdDisplay: formatCurrencyAmount(localized.amountUsd, 'USD'),
          defaultLocalizedPriceDisplay: formatCurrencyAmount(localized.localizedAmount, localized.userCurrency, currencyProfile.locale),
        };
      });

      res.render("account/servicePlan", {
        title: "Choose Your Plan",

        plans: plansWithDefaultDisplayPrice,

        url,

        preselectedPlanId,
        preferredPlanId: preselectedPlanId,
        trialRequested,
        freeTrialEnabled,
        freeTrialLengthLabel,
        premiumPlanId,
        premiumPlanName,
        trialEligible,
        currencyProfile,
        billingPeriods,
        studentTiersByPlan,
        dynamicPriceMetaByPlan,
        dynamicPricingApplied: usedDynamicPricing,
        dynamicPricingRegion: dynamicRegion,
        paystackChargeCurrency: "GHS",

        showFooterTopSection: true,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to fetch service plans.");

      res.redirect("/account");
    }
  },

  servicePlanPost: async (req, res) => {
    const { plan, plan_id, billing_period, approx_student_count } = req.body;
    if (!plan || !plan_id) {
      req.flash("error", "Please select a plan.");

      return res.redirect("/account/service-plan");
    }
    // Fetch plan details from DB for fallback/base validation.
    const planQuery = await db.query(
      "SELECT id, total_cost FROM plans WHERE plan_name = $1 AND id = $2",
      [plan, plan_id]
    );

    if (planQuery.rows.length === 0) {
      req.flash("error", "Invalid plan selected.");

      return res.redirect("/account/service-plan");
    }

    let totalCost = Number(planQuery.rows[0].total_cost);
    let monthlyPrice = totalCost;
    let selectedTierId = null;
    let approxCount = null;
    let dynamicPricingApplied = false;
    let dynamicRegionId = null;
    let dynamicRegionName = null;
    let selectedCurrencyProfileSnapshot = null;

    const requestedCount = parseInt(approx_student_count, 10);
    approxCount = Number.isInteger(requestedCount) && requestedCount >= 0 ? requestedCount : null;

    // Dynamic pricing first: region + plan-region row + student count.
    try {
      const currencyProfile = await getCurrencyProfileForRequest(req);
      selectedCurrencyProfileSnapshot = sanitizeCurrencyProfileSnapshot(currencyProfile);
      const dynamicTermDivider = await getDynamicTermDivider(db);
      const region = await getRegionForCountry(db, currencyProfile?.countryCode || null);
      if (region) {
        const pricingMatch = await getBestPlanRegionPrice(db, Number(plan_id), Number(region.id));
        const row = pricingMatch?.priceRow || null;
        const resolvedRegion = pricingMatch?.region || region;
        if (row) {
          const dynamicRegionTermMonths = await getDynamicRegionTermMonths(db, Number(resolvedRegion?.id || region.id), dynamicTermDivider);
          const threshold = Math.max(0, Number(row.free_student_threshold) || 0);
          const effectiveCount = approxCount != null ? approxCount : threshold;
          const monthly = computeDynamicMonthlyPrice(row, effectiveCount, {
            termDivider: dynamicRegionTermMonths,
          });
          monthlyPrice = Number(monthly?.monthlyTotal || 0);
          dynamicPricingApplied = true;
          dynamicRegionId = resolvedRegion?.id || region.id;
          dynamicRegionName = resolvedRegion?.name || region.name;
          selectedTierId = null;
          approxCount = effectiveCount;
        }
      }
    } catch (err) {
      // Continue with flat base plan fallback.
    }

    // Validate and fetch the billing period from active dynamic cycles.
    const selectedPeriodKey = billing_period || 'monthly';
    let billingPeriodData = { period_key: 'monthly', months: 1, discount_percentage: 0, label: 'Monthly' };
    try {
      const dynamicCycle = await getActiveDynamicCycleByKey(db, selectedPeriodKey);
      if (dynamicCycle) {
        billingPeriodData = {
          period_key: dynamicCycle.cycle_key,
          label: dynamicCycle.label,
          months: dynamicCycle.months,
          discount_percentage: dynamicCycle.discount_percentage,
        };
      }
    } catch (err) {
      // fallback to monthly
    }

    // Calculate cycle total.
    const cycleBreakdown = applyCycle(monthlyPrice, billingPeriodData);
    const periodMonths = Number(cycleBreakdown.months) || 1;
    const discountPct = Number(cycleBreakdown.discountPercentage) || 0;
    const periodTotal = Number(cycleBreakdown.finalTotal) || monthlyPrice;

    // Store the plan choice until registration is completed
    req.session.planSelection = {
      plan,
      planId: plan_id,
      totalCost: periodTotal,
      monthlyPrice,
      billingPeriodKey: billingPeriodData.period_key,
      billingPeriodLabel: billingPeriodData.label,
      billingPeriodMonths: periodMonths,
      billingPeriodDiscount: discountPct,
      trialRequested: parseTruthyFlag(req.body.trialRequested),
      selectedTierId,
      approxStudentCount: approxCount,
      dynamicPricingApplied,
      dynamicRegionId,
      dynamicRegionName,
      currencyProfileSnapshot: selectedCurrencyProfileSnapshot,
    };

    req.flash("success", "Plan selected. Please complete registration.");

    return req.session.save((err) => {
      if (err) {
        req.flash("error", "Session error. Please try again.");
        return res.redirect("/account/service-plan");
      }
      return res.redirect("/account/register");
    });
  },

  registerGet: async (req, res) => {
    // If ?new=1 is present, clear any previous registration session
    if (req.query.new || req.query.clearRegisterDraft === "1") {
      delete req.session.registrationDetails;
      delete req.session.planSelection;
      delete req.session.formData;
      delete req.session.formMessages;
      delete req.session.registrationProofDraft;
    }

    // Require a plan selection before showing the registration form
    if (!req.session.planSelection) {
      req.flash("info", "Please choose a plan to begin registration.");
      return res.redirect("/account/service-plan");
    }

    // Check for sticky form data and error in session
    const formData = req.session.formData || {};
    let proofDraft = req.session.registrationProofDraft || {};
    const proofDraftUpdatedAt = Number(proofDraft.updatedAt || 0);
    if (proofDraftUpdatedAt && Date.now() - proofDraftUpdatedAt > REGISTER_PROOF_DRAFT_TTL_MS) {
      delete req.session.registrationProofDraft;
      proofDraft = {};
    }
    if (proofDraft.proof1Url && !formData.hasProof1) {
      formData.hasProof1 = true;
    }
    if (proofDraft.proof2Url && !formData.hasProof2) {
      formData.hasProof2 = true;
    }
    delete req.session.formData;
    const messages = req.session.formMessages || req.flash();
    delete req.session.formMessages;

    // Plan/trial info from selection
    const preferredPlanId = req.session.planSelection.planId || '';
    const preferredPlanName = req.session.planSelection.plan || '';
    const trialRequested = !!req.session.planSelection.trialRequested;
    const detectedCountryCode = String(
      (await getCurrencyProfileForRequest(req).catch(() => null))?.countryCode || ''
    ).toUpperCase();
    const registerCountryOptions = getSettingsCountryOptions();
    const registerDefaultCountry =
      (formData?.orgCountry && String(formData.orgCountry).trim().toUpperCase()) ||
      (COUNTRY_NAME_LOOKUP[detectedCountryCode] ? detectedCountryCode : '') ||
      'GH';

    res.render("account/register", {
      title: "Register Your Organization",
      showFooterTopSection: true,
      messages,
      formData,
      preferredPlanId,
      preferredPlanName,
      trialRequested,
      registerCountryOptions,
      registerDefaultCountry,
      proofDraft,
    });
  },

  registerPost: async (req, res) => {
    let proof1Url = "";
    let proof2Url = "";
    try {
      const planSelection = req.session.planSelection;

      if (!planSelection) {
        req.flash("error", "Please select a plan before registering.");
        return res.redirect("/account/service-plan");
      }
      const {
        firstName,

        lastName,

        email,

        password,

        confirmPassword,

        orgName,

        orgAddress,

        orgCountry,

        orgProvince,

        orgPhone,
      } = req.body;

      // `orgNickName` is mutated below (raw display text -> derived slug),
      // so destructure with `let` semantics via a separate binding.
      let orgNickName = req.body.orgNickName;
      const normalizedOrgCountry = String(orgCountry || '').trim().toUpperCase();
      const normalizedOrgPhone = String(orgPhone || '').trim();

      const existingProofDraft = req.session.registrationProofDraft || {};
      proof1Url = String(existingProofDraft.proof1Url || "");
      proof2Url = String(existingProofDraft.proof2Url || "");

      const { trialRequested = false, plan, planId, totalCost, billingPeriodKey, billingPeriodLabel, billingPeriodMonths, billingPeriodDiscount, monthlyPrice, selectedTierId, approxStudentCount } = planSelection;
      const currencyProfileSnapshot = sanitizeCurrencyProfileSnapshot(planSelection.currencyProfileSnapshot);

      const proof1 = req.files?.proof1?.[0] || null;

      const proof2 = req.files?.proof2?.[0] || null;

      // Preserve all form data including password fields for re-render

      const formData = {
        firstName,

        lastName,

        email,

        password,

        confirmPassword,

        orgName,

        orgNickName,

        orgAddress,

        orgCountry,

        orgProvince,

        orgPhone: normalizedOrgPhone,

        confirmEmail: req.body.confirmEmail,
        hasProof1: !!proof1Url,
        hasProof2: !!proof2Url,
      };

      // Helper: on error, store formData/messages in session and redirect
      // Uses session.save() to guarantee persistence before redirecting (avoids mobile race condition)
      function stickyError(message) {
        req.session.formData = formData;
        req.session.registrationProofDraft = {
          proof1Url,
          proof2Url,
          updatedAt: Date.now(),
        };
        req.session.formMessages = { error: [message] };
        req.session.save(() => res.redirect("/account/register"));
      }

      if (proof1) {
        try {
          const newlyUploadedProof1Url = await uploadToS3(proof1);
          if (proof1Url && proof1Url !== newlyUploadedProof1Url) {
            await deleteFromS3(proof1Url).catch(() => {});
          }
          proof1Url = newlyUploadedProof1Url;
          formData.hasProof1 = true;
        } catch (_) {
          return stickyError("Unable to upload the primary proof document. Please retry.");
        }
      }

      if (proof2) {
        try {
          const newlyUploadedProof2Url = await uploadToS3(proof2);
          if (proof2Url && proof2Url !== newlyUploadedProof2Url) {
            await deleteFromS3(proof2Url).catch(() => {});
          }
          proof2Url = newlyUploadedProof2Url;
          formData.hasProof2 = true;
        } catch (_) {
          return stickyError("Unable to upload the additional proof document. Please retry.");
        }
      }

      // Required fields check

      if (
        !firstName ||
        !lastName ||
        !email ||
        !password ||
        !confirmPassword ||
        !orgName ||
        !orgNickName ||
        !orgAddress ||
        !orgCountry ||
        !orgProvince ||
        !orgPhone
      ) {
        return stickyError("All fields are required.");
      }

      if (!/^[A-Z]{2}$/.test(normalizedOrgCountry) || !COUNTRY_NAME_LOOKUP[normalizedOrgCountry]) {
        return stickyError("Please select a valid country from the list.");
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim())) {
        return stickyError("Invalid email format.");
      }

      if (!isLikelyInternationalPhone(normalizedOrgPhone)) {
        return stickyError("Please enter a valid phone number with 6 to 15 digits (country code supported).");
      }

      // Passwords match check

      if (password !== confirmPassword) {
        return stickyError("Passwords do not match.");
      }

      // Nickname: accept free-text Display Name (e.g. "HJS School") and
      // derive the URL-safe subdomain slug (e.g. "hjs-school"). The slug is
      // what we persist in the existing `nickname` column (used for routing);
      // the verbatim value is stored separately in `nickname_display`.

      const derivedNickname = deriveOrgNickname(orgNickName);

      if (!derivedNickname.ok) {
        return stickyError(derivedNickname.error);
      }

      // Check that the derived subdomain slug is not already taken.
      const slugCheck = await db.query(
        "SELECT 1 FROM organizations WHERE nickname = $1 LIMIT 1",
        [derivedNickname.slug]
      );
      if (slugCheck.rows.length > 0) {
        return stickyError(
          `The subdomain "${derivedNickname.slug}.managira.com" is already taken. Try a different nickname.`
        );
      }

      // Replace the raw input with the normalised values for downstream use.
      orgNickName = derivedNickname.slug;
      const orgNickNameDisplay = derivedNickname.display;

      // Check if email already exists

      const emailCheckQuery = `

        SELECT email FROM users WHERE LOWER(email) = LOWER($1)

        UNION

        SELECT email FROM organizations WHERE LOWER(email) = LOWER($1)

      `;

      const emailCheckResult = await db.query(emailCheckQuery, [email]);

      if (emailCheckResult.rows.length > 0) {
        return stickyError(
          "This email address is already in use. Please use a different email."
        );
      }

      // Confirm email match check

      if (email !== req.body.confirmEmail) {
        return stickyError("Email and confirm email do not match.");
      }

      // Proof of existence validation

      if (!proof1Url) {
        return stickyError("Proof of existence is required.");
      }

      // Password security check

      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;

      if (!passwordRegex.test(password)) {
        return stickyError("Password must meet security standards.");
      }

      const hashedPassword = await bcryptjs.hash(password, 10);

      const wantsTrial = parseTruthyFlag(trialRequested);

      if (wantsTrial) {
        const { enabled: trialEnabled } = await getFreeTrialSettings(db);

        if (!trialEnabled) {
          return stickyError(
            "Free trials are currently unavailable. Please continue with a paid plan."
          );
        }

        const alreadyUsed = await hasEmailLockedTrial(email, db);

        if (alreadyUsed) {
          return stickyError(
            "This email has already redeemed a free trial. Please choose a paid plan to continue."
          );
        }
      }

      // Save registration details in session with selected plan

      req.session.registrationDetails = {
        firstName,

        lastName,

        email,

        passwordHash: hashedPassword,

        orgName,

        orgNickName,

        orgNickNameDisplay,

        orgAddress,

        orgCountry,

        organizationCurrency: normalizeCurrencyCode(getCurrencyForCountry(normalizedOrgCountry)),

        orgProvince,

        orgPhone: normalizedOrgPhone,

        proof1Url,

        proof2Url,

        plan,

        planId: Number(planId),

        totalCost,

        monthlyPrice: monthlyPrice || totalCost,

        billingPeriodKey: billingPeriodKey || 'monthly',

        billingPeriodLabel: billingPeriodLabel || 'Monthly',

        billingPeriodMonths: billingPeriodMonths || 1,

        billingPeriodDiscount: billingPeriodDiscount || 0,

        trialRequested: wantsTrial,

        selectedTierId: selectedTierId || null,

        approxStudentCount: approxStudentCount || null,

        currencyProfileSnapshot,
      };

      req.session.registrationDetails.orgCountry = normalizedOrgCountry;

      delete req.session.planSelection;
      delete req.session.registrationProofDraft;

      req.flash("success", "Registration details saved. Proceed to payment.");

      delete req.session.formData;
      delete req.session.formMessages;

      // Explicitly save session before redirect — prevents mobile race condition where
      // the browser follows the redirect before connect-pg-simple writes to Postgres.
      return req.session.save((err) => {
        if (err) {
          req.session.formData = formData;
          req.session.registrationProofDraft = {
            proof1Url,
            proof2Url,
            updatedAt: Date.now(),
          };
          req.session.formMessages = { error: ["Session error. Please try again."] };
          return req.session.save(() => res.redirect("/account/register"));
        }
        return res.redirect("/account/payment");
      });
    } catch (error) {
      req.session.formData = {
        ...req.body,
        orgPhone: String(req.body?.orgPhone || "").trim(),
        hasProof1: !!proof1Url,
        hasProof2: !!proof2Url,
      };
      req.session.registrationProofDraft = {
        proof1Url,
        proof2Url,
        updatedAt: Date.now(),
      };

      req.session.formMessages = {
        error: ["Registration failed. Please try again."],
      };

      return req.session.save(() => res.redirect("/account/register"));
    }
  },

  paymentGet: async (req, res) => {
    const registrationDetails = req.session.registrationDetails;

    // Only allow access if registration and plan selection are complete

    if (
      !registrationDetails ||
      !registrationDetails.plan ||
      !registrationDetails.planId
    ) {
      req.flash(
        "error",

        "Please complete registration and select a plan before proceeding to payment."
      );

      return res.redirect("/account/register");
    }

    let decodedPlan = registrationDetails.plan;
    try {
      decodedPlan = decodeURIComponent(String(registrationDetails.plan || ""));
    } catch (_) {
      decodedPlan = registrationDetails.plan;
    }

    try {
      await ensurePaymentProviderSchema(db);
      const paymentProvider = await getActivePaymentProvider();
      let currencyProfile = {
        userCurrency: "USD",
        locale: "en-US",
        usdToUserRate: 1,
        usdToGhsRate: null,
      };
      const sessionCurrencySnapshot = sanitizeCurrencyProfileSnapshot(
        registrationDetails?.currencyProfileSnapshot || req.session?.planSelection?.currencyProfileSnapshot
      );
      let detectedCurrencySnapshot = null;
      try {
        const detectedCurrencyProfile = await getCurrencyProfileForRequest(req);
        detectedCurrencySnapshot = sanitizeCurrencyProfileSnapshot(detectedCurrencyProfile);
      } catch (_) {
      }

      const highConfidenceSources = new Set(["request-header", "request-ip-geo"]);
      const useDetectedProfile =
        detectedCurrencySnapshot &&
        (highConfidenceSources.has(detectedCurrencySnapshot.source) || !sessionCurrencySnapshot);

      if (useDetectedProfile) {
        currencyProfile = {
          ...currencyProfile,
          ...detectedCurrencySnapshot,
        };
        if (registrationDetails) {
          registrationDetails.currencyProfileSnapshot = detectedCurrencySnapshot;
        }
      } else if (sessionCurrencySnapshot) {
        currencyProfile = {
          ...currencyProfile,
          ...sessionCurrencySnapshot,
        };
      } else if (detectedCurrencySnapshot) {
        currencyProfile = {
          ...currencyProfile,
          ...detectedCurrencySnapshot,
        };
      }

      const planResult = await db.query(
        `SELECT p.total_cost AS total_price

                 FROM plans p

                 WHERE p.plan_name = $1 AND p.is_active = TRUE`,

        [decodedPlan]
      );

      if (planResult.rows.length === 0) {
        req.flash(
          "error",

          "Selected plan not found or inactive. Please try again."
        );

        return res.redirect("/account/login");
      }

      // Fetch billing interval, free trial days, and free trial enabled from app_settings
      let billingInterval = "monthly";
      let freeTrialDays = null;
      let freeTrialEnabled = "false";
      let freeTrialLengthLabel = null;
      let billingIntervalLabel = null;
      let postTrialPriceDisplay = null;
      let isTrialCheckout = false;
      try {
        const intervalResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'billing_interval'"
        );
        if (intervalResult.rows.length > 0)
          billingInterval = intervalResult.rows[0].value;
        const trialResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'free_trial_days'"
        );
        if (trialResult.rows.length > 0)
          freeTrialDays = trialResult.rows[0].value;
        const enabledResult = await db.query(
          "SELECT value FROM app_settings WHERE key = 'free_trial_enabled'"
        );
        if (enabledResult.rows.length > 0)
          freeTrialEnabled = enabledResult.rows[0].value;
      } catch (err) {
              }

      // Labels for UI
      billingIntervalLabel = billingInterval;
      if (freeTrialDays) {
        freeTrialLengthLabel =
          freeTrialDays === "5_minutes"
            ? "5 minutes"
            : `${freeTrialDays} day${parseInt(freeTrialDays) === 1 ? "" : "s"}`;
      }
      isTrialCheckout = freeTrialEnabled === "true" && !!freeTrialDays;

      // Calculate amount based on the already selected plan pricing from session
      // (dynamic pricing and cycle discounts are resolved during servicePlanPost).
      const planMonthlyPrice = Number(registrationDetails.monthlyPrice || planResult.rows[0].total_price || 0);

      // Use billing period from session (set during plan selection)
      const billingPeriodKey = registrationDetails.billingPeriodKey || 'monthly';
      const billingPeriodMonths = Number(registrationDetails.billingPeriodMonths) || 1;
      const billingPeriodDiscount = Number(registrationDetails.billingPeriodDiscount) || 0;
      const billingPeriodLabel = registrationDetails.billingPeriodLabel || 'Monthly';

      // Use the persisted cycle total from selection to avoid any drift.
      const rawPeriodTotal = planMonthlyPrice * billingPeriodMonths;
      const computedPlanPrice = billingPeriodDiscount > 0
        ? rawPeriodTotal * (1 - billingPeriodDiscount / 100)
        : rawPeriodTotal;
      const planPrice = Number(registrationDetails.totalCost || computedPlanPrice || 0);

      const localizedPlan = localizeUsdAmount(planPrice, currencyProfile);
      const ghsChargeBase =
        localizedPlan.ghsAmount && localizedPlan.ghsAmount > 0
          ? localizedPlan.ghsAmount
          : planPrice;
      const stripeChargeCurrency = resolveStripeChargeCurrencyForCountry(
        registrationDetails.orgCountry,
        registrationDetails.organizationCurrency || null
      );
      const stripeChargeBase = isTrialCheckout
        ? 0
        : await convertUsdAmountToCurrency(planPrice, stripeChargeCurrency);
      const stripeChargeBreakdown = buildPlatformChargeBreakdown(stripeChargeBase, {
        platformFeePercentage: 0,
        bearer: "parent",
        applyPlatformFee: false,
      });

      let amountDue = Math.round(ghsChargeBase * 100);
      let stripeAmountDue = Math.round(stripeChargeBreakdown.totalChargedAmount * 100);

      let isTrialActive = false;

      let trialActiveUntil = null;
      let trialStartAt = null;
      const trialStartDateMin = formatDateForInput(startOfDayLocal(new Date()));
      const trialStartMaxDate = startOfDayLocal(new Date());
      trialStartMaxDate.setMonth(trialStartMaxDate.getMonth() + 3);
      const trialStartDateMax = formatDateForInput(trialStartMaxDate);
      let trialStartDateValue = trialStartDateMin;

      if (isTrialCheckout) {
        amountDue = 0;
        stripeAmountDue = 0;

        const sessionTrialDate = parseDateInput(registrationDetails.trialStartDate || "");
        if (
          sessionTrialDate &&
          sessionTrialDate >= startOfDayLocal(new Date()) &&
          sessionTrialDate <= trialStartMaxDate
        ) {
          trialStartAt = sessionTrialDate;
        } else {
          trialStartAt = startOfDayLocal(new Date());
        }
        trialStartDateValue = formatDateForInput(trialStartAt);

        trialActiveUntil = new Date(trialStartAt);
        if (freeTrialDays === "5_minutes") {
          trialActiveUntil.setMinutes(trialActiveUntil.getMinutes() + 5);
        } else {
          const days = parseInt(freeTrialDays);
          if (days > 0) {
            trialActiveUntil.setDate(trialActiveUntil.getDate() + days);
          }
        }
      } else {
        // If not free trial, check if org has a trial period (legacy logic)

        let orgId = req.session.organizationId;

        if (orgId) {
          const orgResult = await db.query(
            "SELECT trial_active_until FROM organizations WHERE organization_id = $1",
            [orgId]
          );
          if (
            orgResult.rows.length > 0 &&
            orgResult.rows[0].trial_active_until
          ) {
            trialActiveUntil = new Date(orgResult.rows[0].trial_active_until);

            const now = new Date();

            if (trialActiveUntil > now) {
              isTrialActive = true;

              amountDue = 100; // 1 cedi in pesewas
            }
          }
        }
      }

      const intervalLabel = billingPeriodMonths === 1 ? "per month"
        : billingPeriodMonths === 6 ? "per 6 months"
        : billingPeriodMonths === 12 ? "per year"
        : billingPeriodMonths === 24 ? "per 2 years"
        : `per ${billingPeriodMonths} months`;
      const usdPriceDisplay = formatCurrencyAmount(planPrice, "USD");
      const localizedPriceDisplay = formatCurrencyAmount(
        localizedPlan.localizedAmount,
        localizedPlan.userCurrency,
        currencyProfile.locale
      );
      const ghsChargeDisplay = formatCurrencyAmount(ghsChargeBase, "GHS");
      const stripePriceDisplay = formatCurrencyAmount(
        stripeChargeBase,
        stripeChargeCurrency,
        getLocaleForCurrency(stripeChargeCurrency)
      );
      const baseRenewalDisplay = stripeChargeCurrency !== "USD"
        ? `${stripePriceDisplay} (${usdPriceDisplay}) ${intervalLabel}`
        : `${usdPriceDisplay} ${intervalLabel}`;
      postTrialPriceDisplay = `${baseRenewalDisplay} (may increase as student count grows)`;

      let verificationChargeUsdDisplay = null;
      let verificationChargeLocalDisplay = null;
      if (isTrialCheckout) {
        const verificationGhsAmount = amountDue / 100;
        let usdPerGhs = null;

        if (currencyProfile.usdToGhsRate && Number(currencyProfile.usdToGhsRate) > 0) {
          usdPerGhs = 1 / Number(currencyProfile.usdToGhsRate);
        } else if (localizedPlan.ghsAmount && localizedPlan.ghsAmount > 0 && planPrice > 0) {
          usdPerGhs = planPrice / localizedPlan.ghsAmount;
        }

        const verificationUsdAmount = usdPerGhs && usdPerGhs > 0
          ? verificationGhsAmount * usdPerGhs
          : verificationGhsAmount;

        verificationChargeUsdDisplay = formatCurrencyAmount(verificationUsdAmount, "USD");

        if (
          currencyProfile.userCurrency &&
          currencyProfile.userCurrency !== "USD" &&
          currencyProfile.usdToUserRate &&
          Number(currencyProfile.usdToUserRate) > 0
        ) {
          const localAmount = verificationUsdAmount * Number(currencyProfile.usdToUserRate);
          verificationChargeLocalDisplay = formatCurrencyAmount(
            localAmount,
            currencyProfile.userCurrency,
            currencyProfile.locale
          );
        }
      }

      const trialEndDisplay =
        trialActiveUntil instanceof Date
          ? trialActiveUntil.toLocaleDateString("en-US", {
              weekday: "long",

              month: "long",

              day: "numeric",

              year: "numeric",
            })
          : null;

      // Generate a unique reference for this payment
      const paymentReference = `pay_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // Store payment reference in session for verification

      req.session.paymentReference = paymentReference;

      const stripeSettings = await getStripeSettings(db);
      const stripeConfigError = providerSupportsStripe(paymentProvider)
        ? getStripeConfigurationIssue(stripeSettings)
        : "";

      res.render("account/payment", {
        title: "Complete Payment",

        registrationDetails,

        paymentDetails: { amount: amountDue },
        stripePaymentDetails: {
          amount: stripeAmountDue,
          currency: stripeChargeCurrency,
          subtotalAmount: stripeChargeBreakdown.subtotalAmount,
          platformFeePercentage: stripeChargeBreakdown.platformFeePercentage,
          platformFeeAmount: stripeChargeBreakdown.platformFeeAmount,
          totalChargedAmount: stripeChargeBreakdown.totalChargedAmount,
        },

        paymentReference: paymentReference,

        publishableKey: await getActivePaystackPublicKey(),
        stripePublishableKey:
          providerSupportsStripe(paymentProvider) && !stripeConfigError
            ? stripeSettings.activePublicKey || ""
            : "",
        stripeConfigError,
        stripeMode: stripeSettings.mode,
        paymentProvider,
        // Stripe-only org billing checkout: keep Paystack rail hidden.
        supportsPaystack: false,
        supportsStripe: providerSupportsStripe(paymentProvider),

        orgEmail: registrationDetails.email || "",
        orgPhone: registrationDetails.orgPhone || "",
        showFooterTopSection: true,
        messages: req.flash(),

        promoCode: "", // Include promo code field

        billingInterval,

        freeTrialDays,

        isTrialActive,

        trialActiveUntil,

        freeTrialEnabled,

        billingIntervalLabel,

        freeTrialLengthLabel,

        trialEndDisplay,
        trialStartDateMin,
        trialStartDateMax,
        trialStartDateValue,

        postTrialPriceDisplay,

        isTrialCheckout,
        currencyProfile,
        paystackChargeCurrency: "GHS",
        usdPriceDisplay,
        localizedPriceDisplay,
        ghsChargeDisplay,
        verificationChargeUsdDisplay,
        verificationChargeLocalDisplay,
        stripeChargeCurrency,
        billingPeriodKey,
        billingPeriodLabel,
        billingPeriodMonths,
        billingPeriodDiscount,

        // layout: false // Use default layout for header and footer
      });
    } catch (error) {
            req.flash("error", "Unable to initialize payment. Please try again.");

      return res.redirect("/account/login");
    }
  },

  paymentPost: async (req, res) => {
    const { registrationDetails } = req.session;

    const { paymentReference } = req.body;

    if (!paymentReference) {
      req.flash("error", "Payment reference is missing. Please try again.");

      return res.redirect("/account/payment");
    }

    if (!registrationDetails) {
      req.flash(
        "error",

        "No registration details found. Please register again."
      );

      return res.redirect("/account/login");
    }

    // Retired path: organization registration checkout is Stripe-only.
    req.flash(
      "error",
      "Paystack registration checkout has been retired. Use Stripe card checkout."
    );
    return res.redirect("/account/payment");
  },

  createStripePaymentIntentPost: async (req, res) => {
    const registrationDetails = req.session.registrationDetails;

    if (!registrationDetails) {
      return res.status(400).json({
        success: false,
        message: "Registration session expired. Please register again.",
      });
    }

    try {
      console.log("[Stripe][intent] start", {
        email: registrationDetails.email,
        org: registrationDetails.orgName,
        planId: registrationDetails.planId,
        promoCode: req.body?.promoCode || null,
        trialStartDate: req.body?.trialStartDate || null,
      });
      await ensurePaymentProviderSchema(db);
      const paymentProvider = await getActivePaymentProvider();
      const selectedGateway = req.body?.selectedGateway;
      console.log("[Stripe][intent] provider", { paymentProvider, selectedGateway });
      if (!providerSupportsStripe(paymentProvider)) {
        return res.status(400).json({
          success: false,
          message: "Stripe is not the active payment provider.",
        });
      }

      if (paymentProvider === "smart" && selectedGateway && selectedGateway !== "stripe") {
        return res.status(400).json({
          success: false,
          message: "Stripe was not selected for this checkout.",
        });
      }

      const paymentContext = await buildRegistrationChargeContext(
        registrationDetails,
        req.body?.promoCode,
        req.body?.trialStartDate,
        {
          organizationCurrency: registrationDetails?.organizationCurrency || null,
        }
      );
      const stripeChargeCurrency = String(paymentContext.chargeCurrency || "USD").toLowerCase();
      console.log("[Stripe][intent] charge context", {
        amountDue: paymentContext.amountDue,
        finalAmount: paymentContext.finalAmount,
        discountAmount: paymentContext.discountAmount,
        billingPeriodKey: paymentContext.billingPeriodKey,
        billingPeriodMonths: paymentContext.billingPeriodMonths,
        isTrial: paymentContext.isTrialCheckout,
        currency: stripeChargeCurrency,
      });

      const stripeSettings = await getStripeSettings(db);
      const stripeConfigError = getStripeConfigurationIssue(stripeSettings);
      if (stripeConfigError) {
        return res.status(500).json({
          success: false,
          message: `${stripeConfigError} Update your Stripe mode or keys, then refresh this page and try again.`,
        });
      }

      const stripe = await getStripeClient(db);
      let customerId = req.session.stripePendingCustomerId;
      if (customerId) {
        try {
          const existing = await stripe.customers.retrieve(customerId);
          if (!existing || existing.deleted) {
            customerId = null;
          }
        } catch (lookupErr) {
          if (lookupErr && lookupErr.code === "resource_missing") {
            customerId = null;
          } else {
            throw lookupErr;
          }
        }
        if (!customerId) {
          console.log("[Stripe][intent] cached customer invalid; creating new one");
          req.session.stripePendingCustomerId = null;
        } else {
          console.log("[Stripe][intent] reusing customer", { customerId });
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: registrationDetails.email,
          name: registrationDetails.orgName,
          phone: registrationDetails.orgPhone || undefined,
          metadata: {
            organization_name: registrationDetails.orgName || "",
            plan_id: String(registrationDetails.planId || ""),
          },
        });
        customerId = customer.id;
        req.session.stripePendingCustomerId = customerId;
        console.log("[Stripe][intent] created customer", { customerId });
      }

      let stripeIntent = null;
      let stripeIntentType = "payment";
      const paymentIdempotencyKey = buildStripeRegistrationIdempotencyKey({
        registrationDetails,
        paymentContext,
        selectedGateway,
        flowType: paymentContext.isTrialCheckout ? "setup" : "payment",
      });
      if (paymentContext.isTrialCheckout) {
        stripeIntentType = "setup";
        stripeIntent = await stripe.setupIntents.create({
          customer: customerId,
          payment_method_types: ["card"],
          usage: "off_session",
          metadata: {
            flow: "organization_registration_trial_setup",
            organization_name: registrationDetails.orgName || "",
            plan_id: String(registrationDetails.planId || ""),
            billing_period_key: paymentContext.billingPeriodKey || "monthly",
            charge_currency: stripeChargeCurrency,
          },
        }, {
          idempotencyKey: paymentIdempotencyKey,
        });
        console.log("[Stripe][intent] created setup intent", {
          id: stripeIntent.id,
          status: stripeIntent.status,
          customer: stripeIntent.customer,
        });
      } else {
        stripeIntent = await stripe.paymentIntents.create({
          amount: paymentContext.amountDue,
          currency: stripeChargeCurrency,
          customer: customerId,
          receipt_email: registrationDetails.email,
          payment_method_types: ["card"],
          setup_future_usage: "off_session",
          metadata: {
            flow: "organization_registration",
            organization_name: registrationDetails.orgName || "",
            plan_id: String(registrationDetails.planId || ""),
            billing_period_key: paymentContext.billingPeriodKey || "monthly",
            charge_currency: stripeChargeCurrency,
          },
        }, {
          idempotencyKey: paymentIdempotencyKey,
        });
        console.log("[Stripe][intent] created", {
          id: stripeIntent.id,
          status: stripeIntent.status,
          amount: stripeIntent.amount,
          currency: stripeIntent.currency,
          customer: stripeIntent.customer,
        });
      }

      req.session.paymentIntentId = stripeIntent.id;
      req.session.stripeIntentType = stripeIntentType;
      req.session.stripePaymentContext = {
        promoCode: paymentContext.promoCode,
        discountAmount: paymentContext.discountAmount,
        applyDiscountOnce: paymentContext.applyDiscountOnce,
        finalAmount: paymentContext.finalAmount,
        subtotalAmount: paymentContext.subtotalAmount,
        amountDue: paymentContext.amountDue,
        platformFeePercentage: paymentContext.platformFeePercentage,
        platformFeeAmount: paymentContext.platformFeeAmount,
        taxAmount: paymentContext.taxAmount,
        totalChargedAmount: paymentContext.totalChargedAmount,
        chargeCurrency: stripeChargeCurrency,
        billingInterval: paymentContext.billingInterval,
        isTrialCheckout: paymentContext.isTrialCheckout,
        billingPeriodKey: paymentContext.billingPeriodKey,
        billingPeriodMonths: paymentContext.billingPeriodMonths,
        trialStartAt: paymentContext.trialStartAt
          ? paymentContext.trialStartAt.toISOString()
          : null,
        trialActiveUntil: paymentContext.trialActiveUntil
          ? paymentContext.trialActiveUntil.toISOString()
          : null,
        stripeIntentType,
      };

      return req.session.save(() => {
        res.json({
          success: true,
          clientSecret: stripeIntent.client_secret,
          paymentIntentId: stripeIntent.id,
          amountDue: paymentContext.amountDue,
          currency: stripeChargeCurrency,
          intentType: stripeIntentType,
        });
      });
    } catch (error) {
      console.error("[Stripe][intent] failed:", error);
      const statusCode =
        error.code === "INVALID_PROMO_CODE" || error.code === "INVALID_TRIAL_START_DATE"
          ? 400
          : 500;

      const rawMessage = String(error?.raw?.message || error?.message || "");
      const tlsDetailMessage = String(error?.raw?.detail?.message || error?.detail?.message || "");
      const isStripeTlsChainIssue =
        rawMessage.toLowerCase().includes("connection to stripe") &&
        (tlsDetailMessage.toLowerCase().includes("unable to get local issuer certificate") ||
          tlsDetailMessage.toLowerCase().includes("unable to verify the first certificate") ||
          tlsDetailMessage.toLowerCase().includes("self signed certificate"));

      const fallbackMessage = isStripeTlsChainIssue
        ? "Stripe TLS certificate validation failed in this environment. If this is local/dev, set STRIPE_ALLOW_INSECURE_TLS=true and restart the server, or install the missing CA certificate chain."
        : "Unable to initialize Stripe payment. Please try again.";
      const friendlyMessage = getPlainEnglishStripeError(
        error,
        isStripeTlsChainIssue
          ? fallbackMessage
          : "We could not start your card payment. Please check your card details and try again."
      );

      return res.status(statusCode).json({
        success: false,
        message:
          error.code === "INVALID_PROMO_CODE" || error.code === "INVALID_TRIAL_START_DATE"
            ? error.message
            : isStripeTlsChainIssue
              ? fallbackMessage
              : friendlyMessage,
        detail: isStripeTlsChainIssue ? fallbackMessage : undefined,
      });
    }
  },

  validatePromoGet: async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.json({ success: false, message: "Promo code is required." });
    }

    if (!db || !db.query) {
            return res.json({
        success: false,

        message: "Database connection error.",
      });
    }

    try {
      const result = await db.query(
        `SELECT discount_percentage
         FROM promo_codes
         WHERE UPPER(code) = UPPER($1)
           AND is_active = TRUE
           AND expiration_date > NOW()
         LIMIT 1`,
        [String(code).trim()]
      );

      if (result.rows.length === 0) {
        return res.json({ success: false, message: "Invalid or expired promo code." });
      }

      const discount = result.rows[0].discount_percentage;

      return res.json({ success: true, discount });
    } catch (error) {
            res.json({ success: false, message: "Error validating promo code." });
    }
  },

  paystackWebhookPost: async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});

      const hash = crypto
        .createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
                return res.status(400).send("Webhook signature verification failed");
      }

      const event = Buffer.isBuffer(req.body) ? JSON.parse(rawBody) : req.body;

            switch (event.event) {
        case "subscription.create": {
          const subscription = event.data;
                    // Subscription creation is handled in the payment flow

          break;
        }

        case "charge.success": {
          // Reliable catch-all settlement: even if the parent closes the browser
          // before the redirect callback runs, settle the school's share for
          // PayGira / public-registration charges that were not split at charge
          // time. Idempotent — safe alongside the inline callback settlement.
          try {
            const charge = event.data || {};
            const flow = String(charge.metadata?.flow || "");
            if (flow === "guardian_paygira" || flow === "public_registration_inline") {
              const secretKey = await getActivePaystackSecretKey().catch(
                () => process.env.PAYSTACK_SECRET_KEY || ""
              );
              await settleFromPaystackTransaction(db, {
                txn: charge,
                context: flow === "guardian_paygira" ? "guardian_paygira" : "public_registration",
                secretKey,
              });
            }
          } catch (settleErr) {
            console.error("[Paystack Webhook] charge.success auto-settle failed:", settleErr.message);
          }
          break;
        }

        // Legacy Paystack subscription invoice flow is intentionally ignored.
        // Subscription renewals are driven by in-app Stripe PaymentIntents.
        case "invoice.payment_failed": {
          break;
        }

        case "subscription.disable": {
          const subscription = event.data;

          const customerCode = subscription.customer?.customer_code;

          if (customerCode) {
            // Find and disable organization

            const orgResult = await db.query(
              "SELECT organization_id, organization_name FROM organizations WHERE paystack_customer_code = $1",

              [customerCode]
            );

            if (orgResult.rows.length > 0) {
              const { organization_id, organization_name } = orgResult.rows[0];

              await db.query(
                "UPDATE organizations SET on_hold = true WHERE organization_id = $1",

                [organization_id]
              );

              await db.query(
                "UPDATE payments SET status = 'cancelled' WHERE organization_id = $1",

                [organization_id]
              );

              // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
              await db.query(
                "UPDATE stored_cards SET is_active = false WHERE organization_id = $1",

                [organization_id]
              );

                                        }
          }

          break;
        }
      }

      res.json({ received: true });
    } catch (error) {
            res.status(500).send("Webhook processing error");
    }
  },

  webhookPost: async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    let stripe;

    try {
      stripe = await getStripeClient(db);
      const webhookSecrets = [
        process.env.STRIPE_WEBHOOK_SECRET,
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
      ].filter(Boolean);

      if (webhookSecrets.length === 0) {
        throw new Error("Stripe webhook secret is not configured");
      }

      let lastError;

      for (const webhookSecret of webhookSecrets) {
        try {
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!event) {
        throw lastError || new Error("Unable to verify Stripe webhook signature");
      }
    } catch (err) {
            return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        // Legacy Stripe subscription invoice flows are intentionally ignored.
        // Subscription renewals are driven by the in-app recurring job using
        // Stripe PaymentIntents with dynamic pricing.
        case "invoice.created":
        case "invoice.payment_succeeded":
        case "invoice.payment_failed":
        case "customer.subscription.deleted": {
          break;
        }
      }
    } catch (error) {
            return res.status(500).send("Webhook processing error");
    }

    res.json({ received: true });
  },

  processSuccessfulPayment: async (
    req,

    res,

    paymentIntent,

    registrationDetails,

    trialActiveUntil = null
  ) => {
    try {
      await completeStripeRegistrationPayment(paymentIntent, registrationDetails, {
        promoCode: "",
        discountAmount: 0,
        applyDiscountOnce: false,
        finalAmount: Number(registrationDetails.totalCost) || 0,
        amountDue: paymentIntent.amount_received || paymentIntent.amount,
        billingInterval: "monthly",
        isTrialCheckout: Boolean(trialActiveUntil),
        billingPeriodKey: registrationDetails.billingPeriodKey || "monthly",
        billingPeriodMonths: Number(registrationDetails.billingPeriodMonths) || 1,
        trialStartAt: null,
        trialActiveUntil,
      });

      req.session.registrationDetails = null;

      req.flash("success", "Registration and payment successful!");

      res.redirect("/account/login?clearRegisterDraft=1");
    } catch (error) {
      req.flash("error", "An error occurred. Please try again.");

      res.redirect("/account/payment");
    }
  },

  paymentConfirmPost: async (req, res) => {
    console.log("[Stripe][confirm] entered", {
      paymentIntentId: req.body?.paymentIntentId || null,
      hasSession: Boolean(req.session.registrationDetails),
    });
    const paymentProvider = await getActivePaymentProvider();

    if (!providerSupportsStripe(paymentProvider)) {
      console.warn("[Stripe][confirm] aborted: provider not stripe", { paymentProvider });
      req.flash("error", "Stripe is not the active payment provider.");
      return res.redirect("/account/payment");
    }

    const registrationDetails = req.session.registrationDetails;
    const paymentIntentId = req.body?.paymentIntentId || req.session.paymentIntentId;
    const rawPaymentContext = req.session.stripePaymentContext;
    const stripeIntentType =
      req.session.stripeIntentType || rawPaymentContext?.stripeIntentType || "payment";

    if (!registrationDetails || !paymentIntentId || !rawPaymentContext) {
      console.warn("[Stripe][confirm] missing session data", {
        hasRegistration: Boolean(registrationDetails),
        paymentIntentId,
        hasContext: Boolean(rawPaymentContext),
      });
      req.flash("error", "No payment session found. Please try again.");

      return res.redirect("/account/payment");
    }

    try {
      const stripe = await getStripeClient(db);
      let paymentIntent = null;
      if (stripeIntentType === "setup") {
        const setupIntent = await stripe.setupIntents.retrieve(paymentIntentId);
        console.log("[Stripe][confirm] retrieved setup intent", {
          id: setupIntent.id,
          status: setupIntent.status,
          customer: setupIntent.customer,
          payment_method: setupIntent.payment_method,
        });

        if (setupIntent.status !== "succeeded") {
          const setupFriendlyError = getPlainEnglishStripeError(
            setupIntent?.last_setup_error,
            "We could not verify your card setup. Please check your card details and try again."
          );
          req.flash(
            "error",
            `Payment confirmation failed: ${setupFriendlyError}`
          );

          return res.redirect("/account/payment");
        }

        paymentIntent = {
          id: setupIntent.id,
          type: "setup_intent",
          status: setupIntent.status,
          amount_received: 0,
          amount: 0,
          customer: setupIntent.customer,
          payment_method: setupIntent.payment_method,
        };
      } else {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log("[Stripe][confirm] retrieved intent", {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount_received: paymentIntent.amount_received,
          customer: paymentIntent.customer,
          payment_method: paymentIntent.payment_method,
        });

        if (paymentIntent.status !== "succeeded") {
          const paymentFriendlyError = getPlainEnglishStripeError(
            paymentIntent?.last_payment_error,
            "We could not confirm your card payment. Please check your card details and try again."
          );
          req.flash(
            "error",
            `Payment confirmation failed: ${paymentFriendlyError}`
          );

          return res.redirect("/account/payment");
        }
      }

      const paymentContext = {
        ...rawPaymentContext,
        trialStartAt: rawPaymentContext.trialStartAt
          ? new Date(rawPaymentContext.trialStartAt)
          : null,
        trialActiveUntil: rawPaymentContext.trialActiveUntil
          ? new Date(rawPaymentContext.trialActiveUntil)
          : null,
      };

      const result = await completeStripeRegistrationPayment(
        paymentIntent,
        registrationDetails,
        paymentContext
      );
      console.log("[Stripe][confirm] registration complete", result);

      req.session.registrationDetails = null;
      req.session.paymentIntentId = null;
      req.session.stripeIntentType = null;
      req.session.stripePendingCustomerId = null;
      req.session.stripePaymentContext = null;
      req.session.paymentReference = null;

      let message = "";
      if (result.discountAmount > 0) {
        const chargeLabel = `${result.chargeCurrency || 'USD'} ${Number(result.totalChargedAmount || result.finalAmount || 0).toFixed(2)}`;
        message += `Discount applied successfully. Your charge is ${chargeLabel}. `;
      }
      message += stripeIntentType === "setup"
        ? "Registration successful! Your free trial is now active and your card has been saved for future payments. You may now log in to your account."
        : "Registration and payment successful! Your subscription is now active and your card has been saved for future payments. You may now log in to your account.";
      req.flash("success", message);

      return req.session.save(() => {
        res.redirect("/account/login?clearRegisterDraft=1");
      });
    } catch (error) {
      console.error("[paymentConfirmPost] failed:", error);
      req.flash(
        "error",
        getPlainEnglishStripeError(
          error,
          "We could not confirm your card payment right now. Please try again."
        )
      );

      return res.redirect("/account/payment");
    }
  },

  updateCardGet: async (req, res) => {
    try {
      await ensurePaymentProviderSchema(db);
      if (!req.session.passwordVerified) {
        return res.redirect(
          "/account/confirm-password?redirect=/account/update-card"
        );
      }

      const orgId = req.session.organizationId;

      // Fetch Paystack customer and Flutterwave data

      const orgResult = await db.query(
        `SELECT paystack_customer_code, stripe_customer_id, billing_provider, email, organization_phone, organization_name, first_name, last_name, is_hub_member, hub_id
         FROM organizations
         WHERE organization_id = $1`,
        [orgId]
      );

      const orgRow = orgResult.rows[0] || {};
      let paystackCustomerCode = orgRow.paystack_customer_code;
      const stripeCustomerId = orgRow.stripe_customer_id;
      // PAYSTACK_DISABLED: when the kill switch is off, force Stripe regardless
      // of what the org row currently says. This keeps existing Paystack-only
      // organizations functional (they'll be prompted to add a Stripe card).
      const paystackEnabledFlag = isPaystackEnabled();
      const paymentProvider = paystackEnabledFlag
        ? (orgRow.billing_provider || "paystack")
        : "stripe";
      const isHubMember = Boolean(orgRow.is_hub_member && orgRow.hub_id);

      let hubContractEndDate = null;
      let hubName = null;

      if (isHubMember) {
        const hubResult = await db.query(
          `SELECT hub_name, contract_end_date
           FROM managira_hubs
           WHERE hub_id = $1 AND deleted = false`,
          [orgRow.hub_id]
        );

        if (hubResult.rows.length > 0) {
          hubName = hubResult.rows[0].hub_name;
          hubContractEndDate = hubResult.rows[0].contract_end_date;
        }
      }

      if (!paystackCustomerCode && !isHubMember && paystackEnabledFlag) {
        // PAYSTACK_DISABLED: only auto-create a Paystack customer when the kill
        // switch is on. Otherwise skip this entirely; the Stripe flow will
        // create/reuse a stripe_customer_id when the user adds a card.
        try {
          const customerData = {
            email: orgRow.email,
            first_name: orgRow.first_name || orgRow.organization_name || "Organization",
            last_name: orgRow.last_name || "Account",
          };

          const customerResponse = await axios.post(
            "https://api.paystack.co/customer",
            customerData,
            {
              headers: {
                Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
                "Content-Type": "application/json",
              },
            }
          );

          paystackCustomerCode = customerResponse.data.data.customer_code;

          await db.query(
            "UPDATE organizations SET paystack_customer_code = $1 WHERE organization_id = $2",
            [paystackCustomerCode, orgId]
          );
        } catch (error) {
                    req.flash("error", "Paystack customer not found.");
          return res.redirect("/account/update");
        }
      }

      // ✅ Fetch all saved Paystack cards (payment methods)

      let paymentMethods = [];

      let defaultPaymentMethod = null;
      let storedCardMethods = [];

      try {
        storedCardMethods = await getStoredCardPaymentMethods(db, orgId, paymentProvider);
      } catch (err) {
              }

      if (!isHubMember && paymentProvider === "stripe" && stripeCustomerId) {
        try {
          const stripe = await getStripeClient(db);
          const paymentMethodResult = await stripe.paymentMethods.list({
            customer: stripeCustomerId,
            type: "card",
          });

          const _rawStripe = (paymentMethodResult.data || []).map((method) => {
            const storedCardMeta = storedCardMethods.find(
              (storedCard) => storedCard.id === method.id
            );

            return {
              id: method.id,
              brand: method.card?.brand || "card",
              last4: method.card?.last4,
              expMonth: method.card?.exp_month,
              expYear: method.card?.exp_year,
              funding: method.card?.funding || null,
              fingerprint: method.card?.fingerprint || null,
              displayName: storedCardMeta?.displayName || null,
              isPrimary: Boolean(storedCardMeta?.isPrimary),
            };
          });
          _rawStripe.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
          const _seenFp = new Set();
          paymentMethods = _rawStripe
            .filter((m) => {
              if (!m.fingerprint) return true;
              if (_seenFp.has(m.fingerprint)) return false;
              _seenFp.add(m.fingerprint);
              return true;
            })
            .map(({ fingerprint, ...rest }) => rest);
        } catch (_) {
        }
      } else if (!isHubMember && paystackCustomerCode) {
        try {
          const customerResponse = await axios.get(
            `https://api.paystack.co/customer/${paystackCustomerCode}`,

            {
              headers: {
                Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
              },
            }
          );

          const customer = customerResponse.data.data;

          // Get saved cards from Paystack customer

          if (customer.authorizations && customer.authorizations.length > 0) {
            const _seenPs = new Set();
            paymentMethods = customer.authorizations
              .filter((auth) => auth.channel === "card" && auth.reusable)
              .filter((auth) => {
                const _k = `${auth.brand}:${auth.last4}:${auth.exp_month}:${auth.exp_year}`;
                if (_seenPs.has(_k)) return false;
                _seenPs.add(_k);
                return true;
              })
              .map((auth) => {
                const storedCardMeta = storedCardMethods.find(
                  (storedCard) => storedCard.id === auth.authorization_code
                );

                return {
                  id: auth.authorization_code,
                  brand: auth.brand,
                  last4: auth.last4,
                  expMonth: auth.exp_month,
                  expYear: auth.exp_year,
                  email: auth.email,
                  displayName: storedCardMeta?.displayName || null,
                  isPrimary: Boolean(storedCardMeta?.isPrimary),
                };
              });
          }
        } catch (paystackError) {
                  // Continue with empty payment methods if API fails
        }
      }

      if (!paymentMethods.length && storedCardMethods.length) {
        paymentMethods = storedCardMethods;
      }

      defaultPaymentMethod = pickDefaultCard(paymentMethods, storedCardMethods);

      let billingHistory = [];
      try {
        const billingHistoryResult = await db.query(
          `SELECT amount_paid, status, payment_provider, created_at, next_payment_end_date,
                  is_trial, billing_period_key, stripe_payment_intent_id, paystack_reference
           FROM payments
           WHERE organization_id = $1
           ORDER BY created_at DESC
           LIMIT 12`,
          [orgId]
        );
        billingHistory = billingHistoryResult.rows;
      } catch (_) {
      }

      let stripeInvoices = [];
      if (!isHubMember && paymentProvider === "stripe" && stripeCustomerId) {
        try {
          const stripe = await getStripeClient(db);
          const invoiceResult = await stripe.invoices.list({
            customer: stripeCustomerId,
            limit: 12,
          });
          stripeInvoices = (invoiceResult.data || []).map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            status: invoice.status,
            currency: (invoice.currency || "usd").toUpperCase(),
            amountPaid: Number(invoice.amount_paid || 0) / 100,
            amountDue: Number(invoice.amount_due || 0) / 100,
            hostedInvoiceUrl: invoice.hosted_invoice_url || null,
            invoicePdf: invoice.invoice_pdf || null,
            createdAt: invoice.created ? new Date(invoice.created * 1000) : null,
          }));
        } catch (_) {
        }
      }

      // ✅ Fetch all Paystack subaccounts

      const paystackSubaccountsResult = await db.query(
        `SELECT * FROM paystack_subaccounts 

         WHERE organization_id = $1

         ORDER BY account_type, is_primary DESC, created_at`,

        [orgId]
      );

      const paystackSubaccounts = paystackSubaccountsResult.rows;

      // ✅ Render the page

      res.render("account/updateCard", {
        title: "Update Payment Method",

        needsPassword: false,

        publishableKey: paystackEnabledFlag ? await getActivePaystackPublicKey() : await getActiveStripePublicKey(db),

        orgEmail: orgRow.email || "",
        orgPhone: orgRow.organization_phone || "",
        paystackCustomerCode,

        defaultPaymentMethod,

        paymentMethods,
        paymentProvider,
        paystackEnabled: paystackEnabledFlag,
        billingHistory,
        stripeInvoices,

        paystackSubaccounts,
        isHubMember,
        hubName,
        hubContractEndDate,

        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load payment settings.");

      res.redirect("/account/update");
    }
  },

  createStripeCardSetupIntentPost: async (req, res) => {
    try {
      const orgId = req.session.organizationId;

      if (!orgId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      const orgResult = await db.query(
        `SELECT organization_name, email, organization_phone, stripe_customer_id, billing_provider, is_hub_member
         FROM organizations
         WHERE organization_id = $1`,
        [orgId]
      );

      const orgRow = orgResult.rows[0];

      if (!orgRow) {
        return res.status(404).json({
          success: false,
          message: "Organization not found.",
        });
      }

      if (orgRow.is_hub_member) {
        return res.status(400).json({
          success: false,
          message: "Hub-managed billing accounts cannot add cards here.",
        });
      }

      const activeProvider = await getActivePaymentProvider();
      const effectiveProvider = orgRow.billing_provider || activeProvider || 'paystack';
      if (effectiveProvider !== "stripe" && activeProvider !== "stripe") {
        return res.status(400).json({
          success: false,
          message: "Stripe is not the active billing provider for this organization.",
        });
      }

      const stripeSettings = await getStripeSettings(db);
      const stripeConfigError = getStripeConfigurationIssue(stripeSettings);
      if (stripeConfigError) {
        return res.status(500).json({
          success: false,
          message: stripeConfigError,
        });
      }

      const stripe = await getStripeClient(db);
      let customerId = orgRow.stripe_customer_id || null;

      if (customerId) {
        try {
          const existingCustomer = await stripe.customers.retrieve(customerId);
          if (!existingCustomer || existingCustomer.deleted) {
            customerId = null;
          }
        } catch (lookupErr) {
          if (lookupErr && lookupErr.code === "resource_missing") {
            customerId = null;
          } else {
            throw lookupErr;
          }
        }
      }

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: orgRow.email || undefined,
          name: orgRow.organization_name || undefined,
          phone: orgRow.organization_phone || undefined,
          metadata: {
            organization_id: String(orgId),
            organization_name: orgRow.organization_name || "",
            flow: "settings_add_card",
          },
        });

        customerId = customer.id;

        await db.query(
          `UPDATE organizations
           SET stripe_customer_id = $2, updated_at = NOW()
           WHERE organization_id = $1`,
          [orgId, customerId]
        );
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: {
          flow: "settings_add_card",
          organization_id: String(orgId),
        },
      });

      return res.json({
        success: true,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to prepare Stripe card setup.",
        error: error.message,
      });
    }
  },

  completeStripeCardSetupPost: async (req, res) => {
    try {
      const orgId = req.session.organizationId;
      const setupIntentId = String(req.body?.setupIntentId || "").trim();

      if (!orgId || !setupIntentId) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters.",
        });
      }

      const orgResult = await db.query(
        `SELECT stripe_customer_id, billing_provider, is_hub_member
         FROM organizations
         WHERE organization_id = $1`,
        [orgId]
      );

      const orgRow = orgResult.rows[0];

      if (!orgRow) {
        return res.status(404).json({
          success: false,
          message: "Organization not found.",
        });
      }

      if (orgRow.is_hub_member) {
        return res.status(400).json({
          success: false,
          message: "Hub-managed billing accounts cannot add cards here.",
        });
      }

      const activeProvider = await getActivePaymentProvider();
      const effectiveProvider = orgRow.billing_provider || activeProvider || 'paystack';
      if (effectiveProvider !== "stripe" && activeProvider !== "stripe") {
        return res.status(400).json({
          success: false,
          message: "Stripe is not the active billing provider for this organization.",
        });
      }

      const stripe = await getStripeClient(db);
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

      if (setupIntent.status !== "succeeded") {
        return res.status(400).json({
          success: false,
          message:
            setupIntent.last_setup_error?.message || "Stripe card setup is not complete yet.",
        });
      }

      if (!setupIntent.customer || String(setupIntent.customer) !== String(orgRow.stripe_customer_id)) {
        return res.status(400).json({
          success: false,
          message: "This Stripe setup attempt does not belong to this organization.",
        });
      }

      const paymentMethodId =
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;

      if (!paymentMethodId) {
        return res.status(400).json({
          success: false,
          message: "Stripe did not return a saved card.",
        });
      }

      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

      await saveStoredCardMethod(
        db,
        orgId,
        {
          id: paymentMethodId,
          brand: paymentMethod.card?.brand,
          last4: paymentMethod.card?.last4,
          expMonth: paymentMethod.card?.exp_month,
          expYear: paymentMethod.card?.exp_year,
          country_code: paymentMethod.card?.country,
        },
        {
          provider: "stripe",
          authorizationCode: paymentMethodId,
        }
      );

      const storedCardResult = await db.query(
        `SELECT is_primary
         FROM stored_cards
         WHERE organization_id = $1 AND authorization_code = $2 AND provider = 'stripe' AND is_active = true
         LIMIT 1`,
        [orgId, paymentMethodId]
      );

      if (storedCardResult.rows[0]?.is_primary) {
        await stripe.customers.update(orgRow.stripe_customer_id, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });
      }

      return res.json({
        success: true,
        message: "Card saved successfully.",
        card: {
          id: paymentMethodId,
          brand: paymentMethod.card?.brand || "card",
          last4: paymentMethod.card?.last4,
          expMonth: paymentMethod.card?.exp_month,
          expYear: paymentMethod.card?.exp_year,
          isPrimary: Boolean(storedCardResult.rows[0]?.is_primary),
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to save Stripe card.",
        error: error.message,
      });
    }
  },

  addCardPost: async (req, res) => {
    try {
      // For Paystack, cards are automatically saved during payment transactions

      // This endpoint will handle manual card tokenization if needed

      const { authorizationCode } = req.body;

      const orgId = req.session.organizationId;

      if (!authorizationCode) {
        return res.status(400).json({
          success: false,
          message:
            "Authorization code is required. Please complete a payment first to save your card.",
        });
      }

      // Retrieve Paystack customer code

      const result = await db.query(
        "SELECT paystack_customer_code FROM organizations WHERE organization_id = $1",

        [orgId]
      );

      if (result.rows.length === 0) {
                return res.status(404).json({
          success: false,

          message: "Paystack customer not found. Please contact support.",
        });
      }

      const paystackCustomerCode = result.rows[0].paystack_customer_code;

      // Fetch updated customer data with saved cards

      const customerResponse = await axios.get(
        `https://api.paystack.co/customer/${paystackCustomerCode}`,

        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
          },
        }
      );

      const customer = customerResponse.data.data;

      let paymentMethods = [];

      let defaultPaymentMethod = null;

      if (customer.authorizations && customer.authorizations.length > 0) {
        paymentMethods = customer.authorizations
          .filter((auth) => auth.channel === "card" && auth.reusable)
          .map((auth) => ({
            id: auth.authorization_code,

            brand: auth.brand,

            last4: auth.last4,

            expMonth: auth.exp_month,

            expYear: auth.exp_year,

            email: auth.email,
          }));

        defaultPaymentMethod = paymentMethods[0] || null;
      }

      res.json({
        success: true,

        message: "Card information updated successfully.",

        paymentMethods,

        defaultPaymentMethod,
      });
    } catch (error) {
            res.status(500).json({
        success: false,

        message: "An error occurred while updating the card. Please try again.",

        error: error.message,
      });
    }
  },

  setPrimaryCardPost: async (req, res) => {
    try {
      const { authorizationCode } = req.body;

      const orgId = req.session.organizationId;
      const orgResult = await db.query(
        "SELECT billing_provider, stripe_customer_id FROM organizations WHERE organization_id = $1",
        [orgId]
      );
      const orgRow = orgResult.rows[0] || {};

      if (!orgId || !authorizationCode) {
        return res

          .status(400)

          .json({ success: false, message: "Missing required parameters." });
      }

      await db.query(
        "UPDATE stored_cards SET is_primary = false WHERE organization_id = $1",
        [orgId]
      );

      const updateResult = await db.query(
        "UPDATE stored_cards SET is_primary = true WHERE organization_id = $1 AND authorization_code = $2 RETURNING authorization_code",
        [orgId, authorizationCode]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Card not found for this organization.',
        });
      }

      if (orgRow.billing_provider === "stripe" && orgRow.stripe_customer_id) {
        const stripe = await getStripeClient(db);
        await stripe.customers.update(orgRow.stripe_customer_id, {
          invoice_settings: {
            default_payment_method: authorizationCode,
          },
        });
      }

      res.json({ success: true, message: 'Primary card updated.' });
    } catch (error) {
            return res.status(500).json({
        success: false,

        message: "Internal server error.",

        error: error.message,
      });
    }
  },

  // Set/clear the fallback-chain position for a saved card. Cards are tried by
  // the Managira recurring-billing job in order: primary first, then by
  // fallback_order ASC NULLS LAST. Pass fallbackOrder=null (or empty string) to
  // remove a card from the chain.
  setCardFallbackOrderPost: async (req, res) => {
    try {
      const orgId = req.session.organizationId;
      const { authorizationCode } = req.body || {};
      let fallbackOrderRaw = req.body && req.body.fallbackOrder;
      if (fallbackOrderRaw === undefined) fallbackOrderRaw = req.body && req.body.fallback_order;

      if (!orgId || !authorizationCode) {
        return res.status(400).json({ success: false, message: "Missing required parameters." });
      }

      let fallbackOrder = null;
      if (fallbackOrderRaw !== null && fallbackOrderRaw !== undefined && String(fallbackOrderRaw).trim() !== "") {
        const parsed = parseInt(fallbackOrderRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999) {
          return res.status(400).json({ success: false, message: "fallbackOrder must be an integer between 0 and 999." });
        }
        fallbackOrder = parsed;
      }

      const result = await db.query(
        `UPDATE stored_cards
            SET fallback_order = $1
          WHERE organization_id = $2
            AND authorization_code = $3
            AND is_active = true
        RETURNING authorization_code, fallback_order`,
        [fallbackOrder, orgId, authorizationCode]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Card not found for this organization." });
      }

      return res.json({
        success: true,
        message: "Fallback order updated.",
        card: result.rows[0],
      });
    } catch (error) {
      console.error("[setCardFallbackOrderPost]", error);
      return res.status(500).json({ success: false, message: "Internal server error." });
    }
  },

  setCardDisplayNamePost: async (req, res) => {
    try {
      const orgId = req.session.organizationId;
      const { authorizationCode } = req.body || {};
      let displayNameRaw = req.body && req.body.displayName;
      if (displayNameRaw === undefined) displayNameRaw = req.body && req.body.display_name;

      if (!orgId || !authorizationCode) {
        return res.status(400).json({ success: false, message: "Missing required parameters." });
      }

      await ensurePaymentProviderSchema(db);

      const displayName = String(displayNameRaw || "").trim();
      if (displayName.length > 120) {
        return res.status(400).json({ success: false, message: "Display name must be 120 characters or fewer." });
      }

      const result = await db.query(
        `UPDATE stored_cards
            SET display_name = $1
          WHERE organization_id = $2
            AND authorization_code = $3
            AND is_active = true
        RETURNING authorization_code, display_name`,
        [displayName || null, orgId, authorizationCode]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Card not found for this organization." });
      }

      return res.json({
        success: true,
        message: displayName ? "Card payout name updated." : "Card payout name reset to default.",
        card: result.rows[0],
      });
    } catch (error) {
      console.error("[setCardDisplayNamePost]", error);
      return res.status(500).json({ success: false, message: "Internal server error." });
    }
  },

  removeCardPost: async (req, res) => {
    try {
      const { authorizationCode } = req.body;

      const orgId = req.session.organizationId;

      const orgResult = await db.query(
        `SELECT paystack_customer_code, stripe_customer_id, billing_provider
         FROM organizations
         WHERE organization_id = $1`,
        [orgId]
      );
      const orgRow = orgResult.rows[0] || {};
      const activeSystemProvider = await getActivePaymentProvider();
      const paymentProvider = orgRow.billing_provider || activeSystemProvider || "paystack";
      // Also treat as stripe when no billing_provider is set but org already has a stripe customer
      const isStripeOrg = paymentProvider === "stripe" || (!orgRow.billing_provider && orgRow.stripe_customer_id);

      if (!orgId || !authorizationCode) {
        return res.status(400).json({
          success: false,

          message: "Missing required parameters.",
        });
      }

      if (isStripeOrg) {
        const removableCardsResult = await db.query(
          `SELECT authorization_code, is_primary
           FROM stored_cards
           WHERE organization_id = $1 AND provider = 'stripe' AND is_active = true
           ORDER BY is_primary DESC, updated_at DESC, created_at DESC`,
          [orgId]
        );

        if ((removableCardsResult.rows || []).length <= 1) {
          return res.status(400).json({
            success: false,
            message: "You must keep at least one saved card on file.",
          });
        }

        const targetCard = removableCardsResult.rows.find(
          (card) => card.authorization_code === authorizationCode
        );
        if (!targetCard) {
          return res.status(404).json({
            success: false,
            message: "Card not found for this organization.",
          });
        }

        const stripe = await getStripeClient(db);
        await stripe.paymentMethods.detach(authorizationCode);

        await db.query(
          `UPDATE stored_cards
           SET is_active = false, is_primary = false, updated_at = NOW()
           WHERE organization_id = $1 AND authorization_code = $2`,
          [orgId, authorizationCode]
        );

        const nextCardResult = await db.query(
          `SELECT authorization_code
           FROM stored_cards
           WHERE organization_id = $1 AND provider = 'stripe' AND is_active = true
           ORDER BY is_primary DESC, updated_at DESC, created_at DESC
           LIMIT 1`,
          [orgId]
        );

        const nextCardCode = nextCardResult.rows[0]?.authorization_code || null;
        if (nextCardCode) {
          await db.query(
            `UPDATE stored_cards
             SET is_primary = CASE WHEN authorization_code = $2 THEN true ELSE false END
             WHERE organization_id = $1 AND provider = 'stripe' AND is_active = true`,
            [orgId, nextCardCode]
          );
        }

        if (orgRow.stripe_customer_id) {
          await stripe.customers.update(orgRow.stripe_customer_id, {
            invoice_settings: {
              default_payment_method: nextCardCode,
            },
          });
        }

        return res.json({
          success: true,
          message: "Card removed successfully.",
        });
      }

      // Step 1: Retrieve Paystack customer code

      const paystackCustomerCode = orgRow.paystack_customer_code;

      if (!paystackCustomerCode) {
        return res.status(404).json({
          success: false,

          message: "Paystack customer not found. Please contact support.",
        });
      }

      const customerBeforeResponse = await axios.get(
        `https://api.paystack.co/customer/${paystackCustomerCode}`,
        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
          },
        }
      );

      const customerBefore = customerBeforeResponse.data.data;
      const removableCards = (customerBefore.authorizations || []).filter(
        (auth) => auth.channel === "card" && auth.reusable
      );

      if (removableCards.length <= 1) {
        return res.status(400).json({
          success: false,
          message: "You must keep at least one saved card on file.",
        });
      }

      const selectedCardExists = removableCards.some(
        (auth) => auth.authorization_code === authorizationCode
      );

      if (!selectedCardExists) {
        return res.status(404).json({
          success: false,
          message: "Card not found for this organization.",
        });
      }

      // Step 2: Deactivate the authorization on Paystack

      try {
        await axios.post(
          "https://api.paystack.co/customer/deactivate_authorization",

          {
            authorization_code: authorizationCode,
          },

          {
            headers: {
              Authorization: `Bearer ${await getActivePaystackSecretKey()}`,

              "Content-Type": "application/json",
            },
          }
        );
      } catch (deactivateError) {
                return res.status(500).json({
          success: false,

          message: "Failed to remove card from Paystack.",
        });
      }

      // Step 3: Fetch updated customer data

      const customerResponse = await axios.get(
        `https://api.paystack.co/customer/${paystackCustomerCode}`,

        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
          },
        }
      );

      const customer = customerResponse.data.data;

      let paymentMethods = [];

      let defaultPaymentMethod = null;

      if (customer.authorizations && customer.authorizations.length > 0) {
        paymentMethods = customer.authorizations
          .filter((auth) => auth.channel === "card" && auth.reusable)
          .map((auth) => ({
            id: auth.authorization_code,

            brand: auth.brand,

            last4: auth.last4,

            expMonth: auth.exp_month,

            expYear: auth.exp_year,

            email: auth.email,
          }));

        defaultPaymentMethod = paymentMethods[0] || null;
      }

      await db.query(
        "UPDATE stored_cards SET is_active = false, is_primary = false WHERE organization_id = $1 AND authorization_code = $2",
        [orgId, authorizationCode]
      );

      if (defaultPaymentMethod?.id) {
        await db.query(
          "UPDATE stored_cards SET is_primary = false WHERE organization_id = $1",
          [orgId]
        );

        await db.query(
          "UPDATE stored_cards SET is_active = true, is_primary = true WHERE organization_id = $1 AND authorization_code = $2",
          [orgId, defaultPaymentMethod.id]
        );
      }

      res.json({
        success: true,

        message: "Card removed successfully.",

        paymentMethods,

        defaultPaymentMethod,
      });
    } catch (error) {
            res.status(500).json({
        success: false,

        message: "An error occurred while removing the card. Please try again.",
      });
    }
  },

  confirmPasswordGet: (req, res) => {
    const redirectUrl = req.query.redirect || "/account/update";

    res.render("account/confirmPassword", {
      title: "Confirm Password",

      redirectUrl,

      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  confirmPasswordPost: async (req, res) => {
    const { password, redirectUrl } = req.body;

    const orgId = req.session.organizationId;

    try {
      const result = await db.query(
        "SELECT password FROM organizations WHERE organization_id = $1",

        [orgId]
      );

      if (result.rows.length === 0) {
        req.flash("error", "Organization not found. Please log in again.");

        return res.redirect("/account/login");
      }

      const storedHashedPassword = result.rows[0].password;

      const match = await bcryptjs.compare(password, storedHashedPassword);

      if (!match) {
        req.flash("error", "Incorrect password. Please try again.");

        return res.redirect(
          `/account/confirm-password?redirect=${encodeURIComponent(
            redirectUrl
          )}`
        );
      }

      // ✅ Set password verification flag

      req.session.passwordVerified = true;

      await req.session.save();

      // ✅ Redirect user to their intended page (Update Card Page)

      return res.redirect(redirectUrl || "/account/update-card");
    } catch (error) {
            req.flash("error", "An unexpected error occurred. Please try again.");

      return res.redirect(
        `/account/confirm-password?redirect=${encodeURIComponent(redirectUrl)}`
      );
    }
  },

  confirmPasswordJson: async (req, res) => {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required.',
      });
    }
    const orgId = req.session.organizationId;

    try {
      if (!orgId) {
        return res.status(401).json({
          success: false,
          message: 'Organization not found. Please log in again.',
        });
      }

      const result = await db.query(
        'SELECT password FROM organizations WHERE organization_id = $1',
        [orgId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found. Please log in again.',
        });
      }

      const storedHashedPassword = result.rows[0].password;
      const match = await bcryptjs.compare(password, storedHashedPassword);

      if (!match) {
        return res.status(401).json({
          success: false,
          message: 'Incorrect password. Please try again.',
        });
      }

      req.session.passwordVerified = true;
      await req.session.save();

      return res.json({ success: true });
    } catch (error) {
            return res.status(500).json({
        success: false,
        message: 'An unexpected error occurred. Please try again.',
      });
    }
  },

  loginGet: (req, res) => {
    const url = req.url;

    res.render("account/login", {
      title: "Login",

      url,

      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  loginPost: async (req, res, db) => {
    const { email, password } = req.body;

    try {
      // Store the requested URL if not already stored

      if (
        !req.session.returnTo &&
        req.headers.referer &&
        !req.headers.referer.includes("/account/login")
      ) {
        req.session.returnTo = req.headers.referer;
      }

      // ✅ Step 1: Check if it's an Admin or Mini Admin
      // ...removed log for clean background operation...
      const adminResult = await db.query(
        `SELECT * FROM users WHERE LOWER(email) = LOWER($1) 

         AND (account_type = 'Admin' OR account_type = 'Mini Admin' OR account_type = 'Internal Worker') 

         AND organization_id IS NULL`,

        [email]
      );
      // ...removed log for clean background operation...

      if (adminResult.rows.length > 0) {
        const admin = adminResult.rows[0];

        if (!admin.password) {
                    req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }

        const match = await bcrypt.compare(password, admin.password);

        if (!match) {
                    req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }

        req.session.regenerate((err) => {
          if (err) {
                        req.flash("error", "Login failed. Please try again.");

            return res.redirect("/account/login");
          }

          // Set session variables

          req.session.userId = admin.user_id;

          req.session.firstName = admin.first_name;

          req.session.lastName = admin.last_name;

          req.session.accountType = admin.account_type;

          req.session.userRole = admin.account_type;

          req.session.save((err) => {
            if (err) {
                            req.flash("error", "Login failed. Please try again.");

              return res.redirect("/account/login");
            }

            const redirectUrl =
              process.env.NODE_ENV === "production" ? "/admin" : "/admin";

            return res.redirect(req.session.returnTo || redirectUrl);
          });
        });

        return;
      }

      // ✅ Step 2: Check if it's a Regular User login (Teachers, Supervisors, etc.)

      const userResult = await db.query(
        `SELECT * FROM users WHERE LOWER(email) = LOWER($1) 

           AND account_type NOT IN ('Admin', 'Mini Admin', 'Internal Worker') 

           AND organization_id IS NOT NULL`,

        [email]
      );

            if (userResult.rows.length > 0) {
        const user = userResult.rows[0];

                // Check if password has been set
        if (!user.password) {
          req.flash("error", "Your account password has not been set up yet. Please contact your administrator to receive a password setup email.");
          return res.redirect("/account/login");
        }

        const match = await bcrypt.compare(password, user.password);

        req.session.userId = user.user_id;

        if (match) {
          const orgResult = await db.query(
            `SELECT o.*, 
                    CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END as hub_name,
                    CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END as hub_logo
             FROM organizations o
             LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
             WHERE o.organization_id = $1`,

            [user.organization_id]
          );

          if (orgResult.rows.length > 0) {
            const organization = orgResult.rows[0];

            if (
              user.email &&
              organization.email &&
              String(user.email).trim().toLowerCase() === String(organization.email).trim().toLowerCase() &&
              String(user.account_type || '').trim().toLowerCase() !== 'manager'
            ) {
              await db.query(
                `UPDATE users
                 SET account_type = 'Manager', updated_at = NOW()
                 WHERE user_id = $1 AND organization_id = $2`,
                [user.user_id, user.organization_id]
              );
              user.account_type = 'Manager';
            }

            if (organization.deleted) {
              req.flash(
                "error",

                "Your organization account has been deleted. Please contact support."
              );

              return res.redirect("/account/login");
            }

            if (organization.on_hold) {
              req.flash(
                "error",

                "Your organization account is currently on hold. Please contact support."
              );

              return res.redirect("/account/login");
            }

            req.session.regenerate(async (err) => {
              if (err) {
                                req.flash("error", "Login failed. Please try again.");

                return res.redirect("/account/login");
              }

              try {

              req.session.user = {
                user_id: user.user_id,

                first_name: user.first_name,

                last_name: user.last_name,

                email: user.email,

                phone: user.phone,

                account_type: user.account_type,
              };

              req.session.userRole = user.account_type;

              req.session.organizationId = user.organization_id;

              req.session.firstName = user.first_name;

              req.session.lastName = user.last_name;

              req.session.organizationName = organization.organization_name;

              req.session.logo = organization.logo;

              req.session.fontStyle = organization.font_style;

              req.session.accountType = user.account_type;

              req.session.orgNickName = organization.nickname;

              req.session.orgNickNameDisplay = (organization.nickname_display && String(organization.nickname_display).trim()) || organization.nickname;


              // Add hub information if organization is part of a hub
              if (organization.is_hub_member && organization.hub_id) {
                req.session.hubName = organization.hub_name;
                req.session.hubLogo = organization.hub_logo;
              }

              const redirectUrl =
                process.env.NODE_ENV === "production"
                  ? `https://${req.session.orgNickName}.managira.com/common/orgDashboard`
                  : "/common/orgDashboard?organizationId=" +
                    req.session.organizationId;
              const requestedReturnTo = req.session.returnTo;
              delete req.session.returnTo;
              const finalRedirectUrl = await resolveSafeLoginRedirect(
                db,
                {
                  userId: user.user_id,
                  userRole: user.account_type,
                  organizationId: user.organization_id,
                  accountType: user.account_type,
                  userEmail: user.email,
                },
                requestedReturnTo,
                redirectUrl
              );

              req.session.save((err) => {
                if (err) {
                                    req.flash("error", "Login failed. Please try again.");

                  return res.redirect("/account/login");
                }

                logOrganizationActivity({
                  organizationId: req.session.organizationId,
                  userId: user.user_id,
                  userName: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email,
                  userRole: user.account_type,
                  actionType: "Login",
                  moduleName: "Authentication",
                  pagePath: "/account/login",
                  recordType: "Session",
                  recordLabel: `${organization.organization_name} login`,
                  description: `${user.first_name || user.email} signed in.`,
                  changedFields: [],
                  ipAddress: req.ip,
                }).catch(() => {});

                return res.redirect(finalRedirectUrl);
              });
              } catch (error) {
                req.flash("error", "Login failed. Please try again.");
                return res.redirect("/account/login");
              }
            });

            return;
          }
        } else {
          req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }
      }

      // ✅ Step 3: Check if it's an Organization login (Managers)

      const orgResult = await db.query(
        `SELECT o.*, 
                CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END as hub_name,
                CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END as hub_logo
         FROM organizations o
         LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
         WHERE LOWER(o.email) = LOWER($1)`,

        [email]
      );

      if (orgResult.rows.length > 0) {
        const organization = orgResult.rows[0];

        const match = await bcrypt.compare(password, organization.password);

        if (match) {
          if (organization.deleted) {
            req.flash(
              "error",

              "Your organization account has been deleted. Please contact support."
            );

            return res.redirect("/account/login");
          }

          if (organization.on_hold) {
            req.flash(
              "error",

              "Your organization account is currently on hold. Please contact support."
            );

            return res.redirect("/account/login");
          }

          req.session.regenerate(async (err) => {
            if (err) {
                            req.flash("error", "Login failed. Please try again.");

              return res.redirect("/account/login");
            }

            try {

            req.session.user = {
              user_id: organization.organization_id,

              first_name: organization.first_name,

              last_name: organization.last_name,

              email: organization.email,

              account_type: "Manager",
            };

            req.session.organizationId = organization.organization_id;

            req.session.organizationName = organization.organization_name;

            req.session.firstName = organization.first_name;

            req.session.lastName = organization.last_name;

            req.session.logo = organization.logo;

            req.session.fontStyle = organization.font_style;

            req.session.accountType = "Organization";

            req.session.userRole = "Manager";

            req.session.orgNickName = organization.nickname;

            req.session.orgNickNameDisplay = (organization.nickname_display && String(organization.nickname_display).trim()) || organization.nickname;

            // Add hub information if organization is part of a hub
            if (organization.is_hub_member && organization.hub_id) {
              req.session.hubName = organization.hub_name;
              req.session.hubLogo = organization.hub_logo;
            }

            // Do NOT fetch or store features here; handled by setAllowedFeatures middleware

            const redirectUrl =
              process.env.NODE_ENV === "production"
                ? `https://${req.session.orgNickName}.managira.com/common/orgDashboard`
                : "/common/orgDashboard?organizationId=" +
                  req.session.organizationId;
            const requestedReturnTo = req.session.returnTo;
            delete req.session.returnTo;
            const finalRedirectUrl = await resolveSafeLoginRedirect(
              db,
              {
                userId: organization.organization_id,
                userRole: "Manager",
                organizationId: organization.organization_id,
                accountType: "Organization",
                userEmail: organization.email,
              },
              requestedReturnTo,
              redirectUrl
            );

            req.session.save((err) => {
              if (err) {
                                req.flash("error", "Login failed. Please try again.");

                return res.redirect("/account/login");
              }

              req.flash(
                "success",

                `Successfully signed in ${organization.organization_name}!`
              );

              logOrganizationActivity({
                organizationId: organization.organization_id,
                userId: organization.organization_id,
                userName: `${organization.first_name || ""} ${organization.last_name || ""}`.trim() || organization.email,
                userRole: "Manager",
                actionType: "Login",
                moduleName: "Authentication",
                pagePath: "/account/login",
                recordType: "Session",
                recordLabel: `${organization.organization_name} login`,
                description: `${organization.organization_name} manager signed in.`,
                changedFields: [],
                ipAddress: req.ip,
              }).catch(() => {});

              return res.redirect(finalRedirectUrl);
            });
            } catch (error) {
              req.flash("error", "Login failed. Please try again.");
              return res.redirect("/account/login");
            }
          });

          return;
        } else {
          req.flash("error", "Invalid email or password.");

          return res.redirect("/account/login");
        }
      }

      // ❌ No match found

      req.flash(
        "error",

        "No account found with that email. Please register first"
      );

      res.redirect("/account/login");
    } catch (error) {
            req.flash("error", "Login failed. Please try again.");

      res.redirect("/account/login");
    }
  },

  guardianLoginGet: (req, res) => {
    const url = req.url;

    return res.render("account/guardianLogin", {
      title: "Parent Portal Login",
      url,
      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  guardianLoginPost: async (req, res, db) => {
    const { identifier, password } = req.body;

    try {
      // Normalise to digits + leading '+' only so stored phones like "024-412-3456"
      // match typed inputs like "0244123456" regardless of formatting.
      const cleanedPhone = String(identifier || "").replace(/[^\d+]/g, "");

      const guardianAcc = await db.query(
        `
        SELECT ga.*, gp.first_name, gp.last_name,
               o.organization_id, o.organization_name, o.nickname, o.nickname_display, o.logo, o.font_style, o.theme_color, o.deleted, o.on_hold
        FROM guardian_accounts ga
        JOIN guardian_profiles gp ON gp.guardian_id = ga.guardian_id
        JOIN organizations o ON o.organization_id = ga.organization_id
        WHERE
          (ga.login_email IS NOT NULL AND LOWER(ga.login_email) = LOWER($1))
          OR
          (ga.login_phone IS NOT NULL
            AND regexp_replace(ga.login_phone, '[^\\d+]', '', 'g') = $2
            AND $2 <> '')
        ORDER BY (ga.password_hash IS NOT NULL) DESC
        LIMIT 1
        `,
        [identifier, cleanedPhone]
      );

      if (!guardianAcc.rows.length) {
        req.flash("error", "Invalid email/phone or password.");
        return res.redirect("/account/guardian-login");
      }

      const ga = guardianAcc.rows[0];

      if (!ga.password_hash) {
        req.flash(
          "error",
          "Your account password has not been set up yet. Please contact your school administrator to receive a password setup email."
        );
        return res.redirect("/account/guardian-login");
      }

      const match = await bcrypt.compare(password, ga.password_hash);
      if (!match) {
        req.flash("error", "Invalid email/phone or password.");
        return res.redirect("/account/guardian-login");
      }

      if (ga.deleted || ga.on_hold) {
        req.flash(
          "error",
          "Organization account is suspended. Please contact support."
        );
        return res.redirect("/account/guardian-login");
      }

      const guardianPortalEnabled = await hasGuardianPortalFeature(
        db,
        ga.organization_id
      );
      if (!guardianPortalEnabled) {
        req.flash("error", "Parent portal access is not enabled for this school.");
        return res.redirect("/account/guardian-login");
      }

      req.session.regenerate((err) => {
        if (err) {
          req.flash("error", "Login failed. Please try again.");
          return res.redirect("/account/guardian-login");
        }

        req.session.user = {
          user_id: null,
          first_name: ga.first_name,
          last_name: ga.last_name,
          email: ga.login_email || null,
          account_type: "Guardian",
        };

        req.session.userRole = "Guardian";
        req.session.accountType = "Guardian";
        req.session.guardianId = ga.guardian_id;

        req.session.organizationId = ga.organization_id;
        req.session.organizationName = ga.organization_name;
        req.session.orgNickName = ga.nickname;
        req.session.orgNickNameDisplay = (ga.nickname_display && String(ga.nickname_display).trim()) || ga.nickname;
        req.session.logo = ga.logo;
        req.session.fontStyle = ga.font_style;
        req.session.themeColor = ga.theme_color || 'teal';

        req.session.firstName = ga.first_name;
        req.session.lastName = ga.last_name;

        logOrganizationActivity({
          organizationId: ga.organization_id,
          userId: ga.guardian_id,
          userName: `${ga.first_name || ""} ${ga.last_name || ""}`.trim() || ga.login_email || ga.login_phone,
          userRole: "Guardian",
          actionType: "Login",
          moduleName: "Authentication",
          pagePath: "/account/guardian-login",
          recordType: "Session",
          recordLabel: `${ga.organization_name} guardian login`,
          description: `${ga.first_name || "Guardian"} signed in to the guardian portal.`,
          changedFields: [],
          ipAddress: req.ip,
        }).catch((error) => {
          console.error("[ActivityLog] Failed to log guardian login:", error.message || error);
        });

        req.session.save(() => {
          const redirectUrl =
            process.env.NODE_ENV === "production"
              ? `https://${req.session.orgNickName}.managira.com/guardian/dashboard`
              : "/guardian/dashboard";

          return res.redirect(redirectUrl);
        });
      });
    } catch (error) {
            req.flash("error", "Login failed. Please try again.");
      return res.redirect("/account/guardian-login");
    }
  },

  studentLoginGet: (req, res) => {
    const url = req.url;
    const reason = String(req.query.reason || "").trim();
    const loginReasonMessages = {
      portal_inactive:
        "Student Portal is currently deactivated for this school. Please contact your school administrator.",
      school_inactive:
        "This school account is not active right now. Please contact your school administrator.",
      student_not_found:
        "Your student account could not be found for this school. Please contact your school administrator.",
      session_invalid:
        "Your student session is missing school information. Please sign in again.",
      auth_error:
        "We could not verify your student access right now. Please sign in again.",
    };

    return res.render("account/studentLogin", {
      title: "Student Portal Login",
      url,
      showFooterTopSection: true,
      messages: req.flash(),
      accessReasonMessage: loginReasonMessages[reason] || "",
    });
  },

  studentLoginPost: async (req, res, db) => {
    const email = normalizeStudentEmail(req.body.email);
    const { password } = req.body;
    const clearStudentAuthSession = () => {
      if (!req.session) return;
      req.session.user = null;
      req.session.userRole = null;
      req.session.accountType = null;
      req.session.studentId = null;
      req.session.userId = null;
      req.session.guardianId = null;
    };

    try {
      await ensureStudentPortalSchema(db);

      const studentAccountsResult = await db.query(
        `SELECT sa.*, s.first_name, s.last_name, s.student_id,
                o.organization_id, o.organization_name, o.nickname, o.nickname_display,
                o.logo, o.font_style, o.theme_color, o.deleted, o.on_hold
         FROM student_accounts sa
         JOIN students s ON s.student_id = sa.student_id AND s.organization_id = sa.organization_id
         JOIN organizations o ON o.organization_id = sa.organization_id
         WHERE LOWER(sa.login_email) = LOWER($1)
         ORDER BY sa.updated_at DESC`,
        [email]
      );

      if (!studentAccountsResult.rows.length) {
        clearStudentAuthSession();
        req.flash("error", "Invalid student email or password.");
        return res.redirect("/account/student-login");
      }

      const candidateAccounts = studentAccountsResult.rows;
      const anyWithPasswordSet = candidateAccounts.some(
        (account) => account.password_hash && String(account.password_hash).trim()
      );
      if (!anyWithPasswordSet) {
        clearStudentAuthSession();
        req.flash(
          "error",
          "Your account password has not been set yet. Ask your school to send you a password setup email."
        );
        return res.redirect("/account/student-login");
      }

      const passwordMatchedAccounts = [];
      for (const account of candidateAccounts) {
        if (!account.password_hash || !String(account.password_hash).trim()) continue;
        const match = await bcrypt.compare(password, account.password_hash);
        if (match) passwordMatchedAccounts.push(account);
      }

      if (!passwordMatchedAccounts.length) {
        clearStudentAuthSession();
        req.flash("error", "Invalid student email or password.");
        return res.redirect("/account/student-login");
      }

      let studentAccount = null;
      let matchedSuspended = false;
      let matchedPortalInactive = false;
      for (const account of passwordMatchedAccounts) {
        if (account.deleted || account.on_hold) {
          matchedSuspended = true;
          continue;
        }
        const studentPortalIntegration = await getStudentPortalIntegrationStatus(
          db,
          account.organization_id
        );
        if (!studentPortalIntegration.activated) {
          matchedPortalInactive = true;
          continue;
        }
        studentAccount = account;
        break;
      }

      if (!studentAccount && matchedSuspended) {
        clearStudentAuthSession();
        req.flash("error", "School account is suspended. Please contact support.");
        return res.redirect("/account/student-login");
      }

      if (!studentAccount && matchedPortalInactive) {
        clearStudentAuthSession();
        req.flash(
          "error",
          "Student portal is deactivated for this organization. Please contact your school administrator."
        );
        return res.redirect("/account/student-login");
      }

      if (!studentAccount) {
        clearStudentAuthSession();
        req.flash("error", "Invalid student email or password.");
        return res.redirect("/account/student-login");
      }

      req.session.regenerate((err) => {
        if (err) {
          req.flash("error", "Login failed. Please try again.");
          return res.redirect("/account/student-login");
        }

        req.session.user = {
          user_id: studentAccount.student_id,
          first_name: studentAccount.first_name,
          last_name: studentAccount.last_name,
          email,
          account_type: "Student",
        };

        req.session.userRole = "Student";
        req.session.accountType = "Student";
        req.session.studentId = studentAccount.student_id;
        req.session.userId = null;
        req.session.guardianId = null;

        req.session.organizationId = studentAccount.organization_id;
        req.session.organizationName = studentAccount.organization_name;
        req.session.orgNickName = studentAccount.nickname;
        req.session.orgNickNameDisplay = (studentAccount.nickname_display && String(studentAccount.nickname_display).trim()) || studentAccount.nickname;
        req.session.logo = studentAccount.logo;
        req.session.fontStyle = studentAccount.font_style;
        req.session.themeColor = studentAccount.theme_color || 'teal';

        req.session.firstName = studentAccount.first_name;
        req.session.lastName = studentAccount.last_name;

        logOrganizationActivity({
          organizationId: studentAccount.organization_id,
          userId: studentAccount.student_id,
          userName: `${studentAccount.first_name || ""} ${studentAccount.last_name || ""}`.trim() || email,
          userRole: "Student",
          actionType: "Login",
          moduleName: "Authentication",
          pagePath: "/account/student-login",
          recordType: "Session",
          recordLabel: `${studentAccount.organization_name} student login`,
          description: `${studentAccount.first_name || "Student"} signed in to the student portal.`,
          changedFields: [],
          ipAddress: req.ip,
        }).catch((error) => {
          console.error("[ActivityLog] Failed to log student login:", error.message || error);
        });

        req.session.save(() => {
          const redirectUrl =
            process.env.NODE_ENV === "production"
              ? `https://${req.session.orgNickName}.managira.com/student/dashboard`
              : "/student/dashboard";

          return res.redirect(redirectUrl);
        });
      });
    } catch (error) {
      clearStudentAuthSession();
      req.flash("error", "Login failed. Please try again.");
      return res.redirect("/account/student-login");
    }
  },

  logoutGet: async (req, res) => {
    const organizationId = req.session?.organizationId;
    const userId = req.session?.user?.user_id || req.session?.userId || null;
    const userName = `${req.session?.firstName || ""} ${req.session?.lastName || ""}`.trim() || req.session?.organizationName || req.session?.user?.email || "Unknown User";
    const userRole = req.session?.userRole || req.session?.accountType || null;

    if (
      organizationId &&
      String(req.session?.accountType || "").toLowerCase() !== "admin"
    ) {
      await logOrganizationActivity({
        organizationId,
        userId: String(req.session?.userRole || "").toLowerCase() === "guardian"
          ? req.session?.guardianId || userId
          : userId,
        userName,
        userRole,
        actionType: "Logout",
        moduleName: "Authentication",
        pagePath: "/account/logout",
        recordType: "Session",
        recordLabel: `${userName} session`,
        description: `${userName} signed out.`,
        changedFields: [],
        ipAddress: req.ip,
      }).catch((error) => {
        console.error("[ActivityLog] Failed to log logout:", error.message || error);
      });
    }

    req.session.destroy((err) => {
      if (err) {
                req.flash("error", "Failed to log out. Please try again.");

        return res.redirect("/account/login");
      }

      // Clear client-side cookies

      res.clearCookie("connect.sid", { path: "/" });

      // Redirect based on environment

      const isProduction = process.env.NODE_ENV === "production";

      const redirectUrl = isProduction
        ? "https://managira.com"
        : "/account/login";

      res.redirect(redirectUrl);
    });
  },

  accountGet: (req, res) => {
    res.render("account/account", {
      title: "Account Management",

      messages: req.flash(),
    });
  },

  updateGet: async (req, res) => {
    // Log entire session object

    if (!req.session.user || !req.session.user.user_id) {
      req.flash("error", "You must be logged in.");

      return res.redirect("/account/login");
    }

    try {
      let userDetails;

      let orgDetails;

      if (req.session.user.account_type === "Manager") {
        const orgQuery = await db.query(
          `SELECT organization_id, first_name, last_name, email, scheduled_hold_date, on_hold,
                   organization_address, organization_country, organization_province
                   FROM organizations WHERE organization_id = $1`,

          [req.session.organizationId]
        );

        if (orgQuery.rows.length === 0) {
          req.flash("error", "Organization not found.");

          return res.redirect("/account/login");
        }

        userDetails = {
          first_name: orgQuery.rows[0].first_name,

          last_name: orgQuery.rows[0].last_name,

          email: orgQuery.rows[0].email,

          organization_address: orgQuery.rows[0].organization_address,

          organization_country: orgQuery.rows[0].organization_country,

          organization_province: orgQuery.rows[0].organization_province,
        };

        orgDetails = orgQuery.rows[0];
      } else {
        const userQuery = await db.query(
          `SELECT first_name, last_name, email FROM users WHERE user_id = $1`,

          [req.session.user.user_id]
        );

        if (userQuery.rows.length === 0) {
          req.flash("error", "User not found.");

          return res.redirect("/account/login");
        }

        userDetails = userQuery.rows[0];

        const orgQuery = await db.query(
          `SELECT organization_id, scheduled_hold_date, on_hold FROM organizations WHERE organization_id = $1`,

          [req.session.organizationId]
        );

        orgDetails = orgQuery.rows.length > 0 ? orgQuery.rows[0] : {};
      }

      res.render("account/update", {
        title: "Update Account Information",

        userDetails,

        orgDetails,

        isManager: req.session.user.account_type === "Manager",

        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load account details.");

      res.redirect("/account");
    }
  },

  updatePost: async (req, res) => {
    if (!req.session.user || !req.session.user.user_id) {
      req.flash("error", "You must be logged in.");

      return res.redirect("/account/login");
    }

    const { firstName, lastName, email, password, confirmPassword, orgAddress, orgCountry, orgProvince } = req.body;

    const userId = req.session.user.user_id;

    const orgId = req.session.organizationId;

    if (password && password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");

      return res.redirect("/account/update");
    }

    try {
      // Check if the new email already exists in other users or organizations

      const emailCheckQuery = `

        SELECT email FROM users WHERE LOWER(email) = LOWER($1) AND user_id != $2

        UNION

        SELECT email FROM organizations WHERE LOWER(email) = LOWER($1) AND organization_id != $3

      `;

      const emailCheckResult = await db.query(emailCheckQuery, [
        email,

        userId,

        orgId,
      ]);

      if (emailCheckResult.rows.length > 0) {
        req.flash("error", "Email is already in use by another account.");

        return res.redirect("/account/update");
      }

      // Determine if updating a user (employee) or an organization

      if (req.session.user.account_type === "Manager") {
        // Update organization

        let updateQuery = `UPDATE organizations SET first_name = $1, last_name = $2, email = $3, organization_address = $4, organization_country = $5, organization_province = $6`;

        let params = [firstName, lastName, email, orgAddress || null, orgCountry || null, orgProvince || null];

        if (password) {
          const hashedPassword = await bcrypt.hash(password, 10);

          updateQuery += ", password = $7 WHERE organization_id = $8";

          params.push(hashedPassword, orgId);
        } else {
          updateQuery += " WHERE organization_id = $7";

          params.push(orgId);
        }

        await db.query(updateQuery, params);

        // Auto-geocode updated address for local SEO (fire-and-forget)
        autoGeocodeOrg(db, orgId, orgAddress, orgProvince, orgCountry);

        // Notify Google/Bing that the school page has been updated
        try {
          const nickRow = await db.query(
            "SELECT nickname FROM organizations WHERE organization_id = $1",
            [orgId]
          );
          if (nickRow.rows.length > 0 && nickRow.rows[0].nickname) {
            pingSchoolUrl(nickRow.rows[0].nickname);
          }
        } catch (_) { /* non-critical */ }

        // ✅ Update session

        req.session.user.first_name = firstName;

        req.session.user.last_name = lastName;

        req.session.user.email = email;

        req.session.save();
      } else {
        // Update user

        let updateQuery = `UPDATE users SET first_name = $1, last_name = $2, email = $3`;

        let params = [firstName, lastName, email];

        if (password) {
          const hashedPassword = await bcrypt.hash(password, 10);

          updateQuery += ", password = $4 WHERE user_id = $5";

          params.push(hashedPassword, userId);
        } else {
          updateQuery += " WHERE user_id = $4";

          params.push(userId);
        }

        await db.query(updateQuery, params);

        // ✅ Update session

        req.session.user.first_name = firstName;

        req.session.user.last_name = lastName;

        req.session.user.email = email;

        req.session.save();
      }

      req.flash("success", "Account information updated successfully.");

      res.redirect("/account/update");
    } catch (error) {
            req.flash(
        "error",

        "Failed to update account information. Please try again."
      );

      res.redirect("/account/update");
    }
  },

  updateNotificationPreferencesPost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const userId = req.session.user.user_id;
    const orgId = req.session.organizationId;

    try {
      await ensureEmailPreferencesSchema(db);

      const userResult = await db.query(
        `SELECT account_type FROM users WHERE user_id = $1 AND organization_id = $2`,
        [userId, orgId]
      );
      const accountType = userResult.rows[0]?.account_type
        || req.session.accountType
        || null;

      const allowed = getStaffPreferencesForRole(accountType).map(p => p.key);
      if (!allowed.length) {
        req.flash("error", "No notification preferences are available for your role.");
        return res.redirect("/account/settings?section=notifications");
      }

      const submittedRaw = req.body.preferences;
      const submitted = Array.isArray(submittedRaw)
        ? submittedRaw
        : (submittedRaw ? [submittedRaw] : []);

      await setUserPreferences(db, userId, allowed, submitted);

      req.flash("success", "Notification preferences saved.");
      return res.redirect("/account/settings?section=notifications");
    } catch (error) {
      req.flash("error", "Failed to save notification preferences.");
      return res.redirect("/account/settings?section=notifications");
    }
  },

  updatePlatformFeeBearerPost: async (req, res, db) => {
    const orgId = req.session.organizationId;
    if (!orgId) {
      req.flash("error", "You must be signed in as a school administrator.");
      return res.redirect("/account/settings");
    }

    try {
      const bearer = normalizePlatformFeeBearer(req.body?.platform_fee_bearer);
      await upsertOrgPlatformFeeBearer(orgId, bearer, db);

      req.flash(
        "success",
        bearer === "parent"
          ? "Saved. Platform service fees will be charged to parents on top of tuition."
          : "Saved. Platform service fees will be absorbed from the school's portion."
      );
      return res.redirect("/account/settings#platform-fee-bearer-card");
    } catch (error) {
      console.error("[updatePlatformFeeBearerPost]", error);
      req.flash("error", "Failed to update platform fee preference. Please try again.");
      return res.redirect("/account/settings#platform-fee-bearer-card");
    }
  },

  updateProfileNamePost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { firstName, lastName, orgAddress, orgCountry, orgProvince, redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";
    const normalizedFirstName = String(firstName || '').trim();
    const normalizedLastName = String(lastName || '').trim();
    const normalizedAddress = String(orgAddress || '').trim() || null;
    const normalizedProvince = String(orgProvince || '').trim() || null;
    const normalizedCountry = String(orgCountry || '').trim().toUpperCase();

    if (!normalizedFirstName || !normalizedLastName) {
      req.flash("error", "First name and last name are required.");
      return res.redirect(redirectTo || "/account/settings");
    }

    if (isOrgAccount && normalizedCountry && !/^[A-Z]{2}$/.test(normalizedCountry)) {
      req.flash("error", "Organization country must be a valid 2-letter country code.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      if (isOrgAccount) {
        await db.query(
          `UPDATE organizations
              SET first_name = $1,
                  last_name = $2,
                  organization_address = $3,
                  organization_country = $4,
                  organization_province = $5
            WHERE organization_id = $6`,
          [
            normalizedFirstName,
            normalizedLastName,
            normalizedAddress,
            normalizedCountry || null,
            normalizedProvince,
            orgId,
          ]
        );

        autoGeocodeOrg(db, orgId, normalizedAddress, normalizedProvince, normalizedCountry || null);
      } else {
        await db.query(
          "UPDATE users SET first_name = $1, last_name = $2 WHERE user_id = $3 AND organization_id = $4",
          [normalizedFirstName, normalizedLastName, userId, orgId]
        );
      }

      req.session.firstName = normalizedFirstName;
      req.session.lastName = normalizedLastName;
      if (req.session.user) {
        req.session.user.first_name = normalizedFirstName;
        req.session.user.last_name = normalizedLastName;
      }
      req.session.save();

      req.flash("success", "Profile updated successfully.");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
            req.flash("error", "Failed to update profile.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  updateProfileImagePost: async (req, res, db) => {
    if (!req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const sessionUserId = req.session.user?.user_id || req.session.userId;

    if (!req.file) {
      req.flash("error", "Please select an image to upload.");
      return res.redirect(redirectTo || "/account/settings");
    }

    if (!sessionUserId) {
      req.flash("error", "Unable to identify user for profile image update.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      await ensureProfileImageColumns(db);

      const currentUserResult = await db.query(
        "SELECT image_url FROM users WHERE user_id = $1 AND organization_id = $2",
        [sessionUserId, orgId]
      );

      const isUserRow = currentUserResult.rows.length > 0;
      let previousImageUrl = null;

      if (isUserRow) {
        previousImageUrl = currentUserResult.rows[0].image_url;
      } else {
        const currentOrgResult = await db.query(
          "SELECT image_url FROM organizations WHERE organization_id = $1",
          [orgId]
        );
        if (currentOrgResult.rows.length > 0) {
          previousImageUrl = currentOrgResult.rows[0].image_url;
        }
      }

      // Upload image to S3
      const s3Key = `images/profiles/${orgId}/${Date.now()}_${req.file.originalname}`;
      const imageUrl = await uploadToS3(req.file, s3Key);

      if (isUserRow) {
        await db.query(
          "UPDATE users SET image_url = $1 WHERE user_id = $2 AND organization_id = $3",
          [imageUrl, sessionUserId, orgId]
        );
      } else {
        await db.query(
          "UPDATE organizations SET image_url = $1 WHERE organization_id = $2",
          [imageUrl, orgId]
        );
      }

      // Delete old profile image from S3 if present
      const oldImageKey = extractS3KeyFromUrl(previousImageUrl);
      if (oldImageKey && oldImageKey !== s3Key) {
        try {
          await deleteFromS3(oldImageKey);
        } catch (cleanupError) {
          // Ignore cleanup failure to avoid blocking successful update
        }
      }

      // Update session
      if (req.session.user) {
        req.session.user.image_url = imageUrl;
      }
      req.session.save();

      req.flash("success", "Profile picture updated successfully!");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
            req.flash("error", "Failed to update profile picture.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

        deleteProfileImagePost: async (req, res, db) => {
          if (!req.session.organizationId) {
            req.flash("error", "You must be logged in.");
            return res.redirect("/account/login");
          }

          const { redirectTo } = req.body;
          const orgId = req.session.organizationId;
          const sessionUserId = req.session.user?.user_id || req.session.userId;
          

          if (!sessionUserId) {
            req.flash("error", "Unable to identify user for image deletion.");
            return res.redirect(redirectTo || "/account/settings");
          }

          try {
            await ensureProfileImageColumns(db);

            const currentUserResult = await db.query(
              "SELECT image_url FROM users WHERE user_id = $1 AND organization_id = $2",
              [sessionUserId, orgId]
            );

            const isUserRow = currentUserResult.rows.length > 0;
            let previousImageUrl = null;

            if (isUserRow) {
              previousImageUrl = currentUserResult.rows[0].image_url;
            } else {
              const currentOrgResult = await db.query(
                "SELECT image_url FROM organizations WHERE organization_id = $1",
                [orgId]
              );
              if (currentOrgResult.rows.length > 0) {
                previousImageUrl = currentOrgResult.rows[0].image_url;
              }
            }

            const placeholderImage = "profilePlaceholder.png";

            if (isUserRow) {
              await db.query(
                "UPDATE users SET image_url = $1 WHERE user_id = $2 AND organization_id = $3",
                [placeholderImage, sessionUserId, orgId]
              );
            } else {
              await db.query(
                "UPDATE organizations SET image_url = $1 WHERE organization_id = $2",
                [placeholderImage, orgId]
              );
            }

            const oldImageKey = extractS3KeyFromUrl(previousImageUrl);
            if (oldImageKey) {
              try {
                await deleteFromS3(oldImageKey);
              } catch (cleanupError) {
                // Ignore cleanup failure to avoid blocking successful delete
              }
            }

            if (req.session.user) {
              req.session.user.image_url = placeholderImage;
            }
            req.session.save();

            req.flash("success", "Profile picture removed successfully.");
            return res.redirect(redirectTo || "/account/settings");
          } catch (error) {
            req.flash("error", "Failed to remove profile picture.");
            return res.redirect(redirectTo || "/account/settings");
          }
        },

  updateSecurityEmailPost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { email, redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";

    if (!email) {
      req.flash("error", "Email is required.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      const emailCheckQuery = `
        SELECT email FROM users WHERE LOWER(email) = LOWER($1) AND user_id != $2
        UNION
        SELECT email FROM organizations WHERE LOWER(email) = LOWER($1) AND organization_id != $3
      `;

      const emailCheckResult = await db.query(emailCheckQuery, [
        email,
        userId || 0,
        orgId || 0,
      ]);

      if (emailCheckResult.rows.length > 0) {
        req.flash("error", "Email is already in use by another account.");
        return res.redirect(redirectTo || "/account/settings");
      }

      if (isOrgAccount) {
        await db.query(
          "UPDATE organizations SET email = $1 WHERE organization_id = $2",
          [email, orgId]
        );
      } else {
        await db.query(
          "UPDATE users SET email = $1 WHERE user_id = $2 AND organization_id = $3",
          [email, userId, orgId]
        );
      }

      if (req.session.user) {
        req.session.user.email = email;
      }
      req.session.save();

      req.flash("success", "Email updated successfully.");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
            req.flash("error", "Failed to update email.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  updateSecurityPasswordPost: async (req, res, db) => {
    if (!req.session.user || !req.session.organizationId) {
      req.flash("error", "You must be logged in.");
      return res.redirect("/account/login");
    }

    const { password, confirmPassword, redirectTo } = req.body;
    const orgId = req.session.organizationId;
    const userId = req.session.user.user_id;
    const isOrgAccount = req.session.accountType === "Organization";

    if (!password || !confirmPassword) {
      req.flash("error", "Password and confirmation are required.");
      return res.redirect(redirectTo || "/account/settings");
    }

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect(redirectTo || "/account/settings");
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      if (isOrgAccount) {
        await db.query(
          "UPDATE organizations SET password = $1 WHERE organization_id = $2",
          [hashedPassword, orgId]
        );
      } else {
        await db.query(
          "UPDATE users SET password = $1 WHERE user_id = $2 AND organization_id = $3",
          [hashedPassword, userId, orgId]
        );
      }

      req.flash("success", "Password updated successfully.");
      return res.redirect(redirectTo || "/account/settings");
    } catch (error) {
            req.flash("error", "Failed to update password.");
      return res.redirect(redirectTo || "/account/settings");
    }
  },

  personalizationGet: async (req, res) => {
    try {
      const { organizationId } = req.session;

      const result = await db.query(
        "SELECT * FROM organizations WHERE organization_id = $1",

        [organizationId]
      );

      const orgDetails = result.rows[0];

      if (req.session && orgDetails) {
        req.session.orgNickNameDisplay = (orgDetails.nickname_display && String(orgDetails.nickname_display).trim()) || orgDetails.nickname;
      }

      const heroImageResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "hero"]
      );

      const heroImage = heroImageResult.rows[0];

      const slideshowImagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "slideshow"]
      );

      const slideshowImages = slideshowImagesResult.rows;

      res.render("account/accountPersonalization", {
        title: "Account Personalization",

        organizationId,

        orgDetails,

        heroImage,

        slideshowImages,

        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load personalization page.");

      res.redirect("/");
    }
  },

  personalizationPost: async (req, res) => {
    try {
      const { orgName, font } = req.body;

      const updateQuery = `

                UPDATE organizations

                SET organization_name = $1, font_style = $2

                WHERE organization_id = $3

            `;

      await db.query(updateQuery, [orgName, font, req.session.organizationId]);

      req.session.organizationName = orgName;

      req.session.fontStyle = font;

      req.flash("success", "Personalization updated successfully.");

      res.redirect("/account/personalization");
    } catch (err) {
            req.flash(
        "error",

        "An error occurred while updating personalization. Please try again."
      );

      res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateOrgNamePost: async (req, res, db) => {
    try {
      const { orgName, orgAddress, orgCountry, orgProvince, redirectTo } = req.body;
      const orgId = req.session.organizationId;
      const normalizedOrgName = String(orgName || '').trim();
      const normalizedOrgAddress = String(orgAddress || '').trim() || null;
      const normalizedOrgProvince = String(orgProvince || '').trim() || null;
      const normalizedOrgCountry = String(orgCountry || '').trim().toUpperCase();
      const normalizedOrgCurrency = normalizeCurrencyCode(getCurrencyForCountry(normalizedOrgCountry));

      if (!normalizedOrgName || !orgId) {
        req.flash("error", "Organization name is required.");
        return res.redirect(redirectTo || "/account/personalization");
      }

      if (!normalizedOrgCountry) {
        req.flash("error", "Organization country is required.");
        return res.redirect(redirectTo || "/account/personalization");
      }

      if (!/^[A-Z]{2}$/.test(normalizedOrgCountry) || !COUNTRY_NAME_LOOKUP[normalizedOrgCountry]) {
        req.flash("error", "Please select a valid country from the list.");
        return res.redirect(redirectTo || "/account/personalization");
      }

      await ensureOrganizationCurrencySchema(db);

      await db.query(
        `UPDATE organizations
            SET organization_name = $1,
                organization_address = $2,
                organization_country = $3,
                organization_province = $4,
                organization_currency = $5
          WHERE organization_id = $6`,
        [
          normalizedOrgName,
          normalizedOrgAddress,
          normalizedOrgCountry,
          normalizedOrgProvince,
          normalizedOrgCurrency || null,
          orgId,
        ]
      );

      autoGeocodeOrg(db, orgId, normalizedOrgAddress, normalizedOrgProvince, normalizedOrgCountry);

      // Notify Google/Bing of the updated page content via IndexNow
      try {
        const nickRow = await db.query(
          "SELECT nickname FROM organizations WHERE organization_id = $1",
          [orgId]
        );
        if (nickRow.rows.length > 0 && nickRow.rows[0].nickname) {
          pingSchoolUrl(nickRow.rows[0].nickname);
        }
      } catch (_) { /* non-critical — ignore */ }

      req.session.organizationName = normalizedOrgName;
      req.flash("success", "Organization name, location, and currency updated successfully.");
      return res.redirect(redirectTo || "/account/personalization");
    } catch (err) {
            req.flash("error", "Failed to update organization name.");
      return res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateFontPost: async (req, res, db) => {
    try {
      const { font, redirectTo } = req.body;
      const orgId = req.session.organizationId;

      if (!font || !orgId) {
        req.flash("error", "Font selection is required.");
        return res.redirect(redirectTo || "/account/personalization");
      }

      await db.query(
        "UPDATE organizations SET font_style = $1 WHERE organization_id = $2",
        [font, orgId]
      );

      req.session.fontStyle = font;
      req.flash("success", "Font updated successfully.");
      return res.redirect(redirectTo || "/account/personalization");
    } catch (err) {
            req.flash("error", "Failed to update font.");
      return res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateDisplayPreferencesPost: async (req, res, db) => {
    try {
      const orgId = req.session.organizationId;
      const redirectTo = req.body.redirectTo || "/account/settings?section=customize";

      if (!orgId) {
        req.flash("error", "Unauthorized.");
        return res.redirect("/account/login");
      }

      const nameDisplayFormat = normalizeNameDisplayFormat(req.body.nameDisplayFormat);
      const dateDisplayFormat = normalizeDateDisplayFormat(req.body.dateDisplayFormat);

      const updateResult = await db.query(
        `UPDATE organizations
            SET name_display_format = $1,
                date_display_format = $2
          WHERE organization_id = $3
          RETURNING name_display_format, date_display_format`,
        [nameDisplayFormat, dateDisplayFormat, orgId]
      );

      if (updateResult.rows.length > 0) {
        applyDisplayPreferencesToSession(req.session, updateResult.rows[0]);
      } else {
        req.session.nameDisplayFormat = nameDisplayFormat;
        req.session.dateDisplayFormat = dateDisplayFormat;
      }

      req.flash("success", "Name and date display settings updated.");
      return res.redirect(redirectTo);
    } catch (error) {
      req.flash("error", "Failed to update display settings.");
      return res.redirect(req.body.redirectTo || "/account/settings?section=customize");
    }
  },

  updateStudentIdSettingsPost: async (req, res, db) => {
    try {
      const orgId = req.session.organizationId;
      if (!orgId) {
        req.flash("error", "Unauthorized.");
        return res.redirect("/account/login");
      }

      await ensureStudentIdSettingsSchema(db);

      const useCustom = req.body.useCustomStudentId === "on";
      const autoGenerate = req.body.studentIdAutoGenerate === "on";

      // Sanitize prefix: only alphanumeric, dash, underscore — max 10 chars
      const rawPrefix = (req.body.studentIdPrefix || "").trim();
      const safePrefix = rawPrefix.replace(/[^A-Za-z0-9\-_]/g, "").toUpperCase().slice(0, 10) || null;

      // Starting number: school can set the floor the auto-number search should respect.
      const rawStarting = parseInt(req.body.startingNumber, 10);
      const safeStartingNumber = Number.isInteger(rawStarting) && rawStarting >= 1 ? rawStarting : null;

      await db.query(
        `UPDATE organizations
         SET use_custom_student_id   = $1,
             student_id_prefix        = $2,
             student_id_auto_generate = $3,
             student_id_start_number  = $5
             ${safeStartingNumber !== null ? ', student_id_counter = GREATEST(COALESCE(student_id_counter, 0), $5 - 1)' : ''}
         WHERE organization_id = $4`,
        [useCustom, safePrefix, autoGenerate, orgId, safeStartingNumber]
      );

      const redirectTo = req.body.redirectTo || "/account/settings";
      req.flash("success", "Student ID settings updated.");
      return res.redirect(redirectTo);
    } catch (err) {
      req.flash("error", "Failed to update student ID settings.");
      return res.redirect(req.body.redirectTo || "/account/settings");
    }
  },

  personalizationLogoPost: async (req, res) => {
    const { file } = req;

    const { organizationId } = req.session;

    if (!file) {
      req.flash("error", "No file uploaded. Please select a file to upload.");

      return res.redirect(req.body.redirectTo || "/account/personalization");
    }

    try {
      const result = await db.query(
        "SELECT logo FROM organizations WHERE organization_id = $1",

        [organizationId]
      );

      const previousLogo = result.rows[0].logo;

      // Upload the new logo to S3 under images/logos/{organizationId}/ using a safe unique filename
      const originalExt = path.extname(file.originalname || "").toLowerCase();
      const safeExt = /^[a-z0-9.]+$/.test(originalExt) && originalExt ? originalExt : "";
      const baseName = path.basename(file.originalname || "logo", originalExt);
      const safeBaseName = baseName
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "logo";
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const logoKey = `images/logos/${organizationId}/${uniqueSuffix}-${safeBaseName}${safeExt}`;

      const logoUrl = await uploadToS3(file, logoKey);

      // Update the organization record with the new logo URL

      await db.query(
        "UPDATE organizations SET logo = $1 WHERE organization_id = $2",

        [logoUrl, organizationId]
      );

      // Update the session with the new logo URL

      req.session.logo = logoUrl;

      req.session.save();

      // Delete the old logo from S3 if it exists and is not the same key
      const oldLogoKey = extractS3KeyFromUrl(previousLogo);
      if (oldLogoKey && oldLogoKey !== logoKey) {
        try {
          await deleteFromS3(oldLogoKey);
        } catch (deleteErr) {
          console.warn("Failed to delete previous logo from S3:", deleteErr.message);
        }
      }

      req.flash("success", "Logo updated successfully.");

      res.redirect(req.body.redirectTo || "/account/personalization");
    } catch (err) {
            req.flash(
        "error",

        "An error occurred while updating the logo. Please try again."
      );

      res.redirect(req.body.redirectTo || "/account/personalization");
    }
  },

  updateNicknamePost: async (req, res) => {
    // After registration the subdomain (organizations.nickname) is LOCKED.
    // This endpoint only updates the human-readable display label stored in
    // organizations.nickname_display. We deliberately do NOT touch the slug,
    // do NOT clear sessions, and do NOT post a URL-change announcement.
    const { orgNickName } = req.body;
    const orgId = req.session?.organizationId;
    const redirectTo = req.body.redirectTo || "/account/personalization";

    const display = normalizeDisplayName(orgNickName);

    if (!display || display.length < 3) {
      if (req.session) {
        req.flash(
          "error",
          "Please enter a display name with at least 3 characters."
        );
      }
      return res.redirect(redirectTo);
    }

    if (display.length > 60) {
      if (req.session) {
        req.flash(
          "error",
          "Display name must be 60 characters or fewer."
        );
      }
      return res.redirect(redirectTo);
    }

    if (!orgId) {
      if (req.session) {
        req.flash("error", "You must be signed in to update your nickname.");
      }
      return res.redirect("/account/login");
    }

    try {
      await db.query(
        "UPDATE organizations SET nickname_display = $1 WHERE organization_id = $2",
        [display, orgId]
      );

      if (req.session) {
        req.session.orgNickNameDisplay = display;
        req.flash("success", "Display name updated successfully.");
        req.session.save(() => {});
      }
      return res.redirect(redirectTo);
    } catch (error) {
      console.error("[updateNicknamePost] failed:", error.message || error);
      if (req.session) {
        req.flash(
          "error",
          "Failed to update display name. Please try again."
        );
      }
      return res.redirect(redirectTo);
    }
  },

  getSubjectsByClass: async (req, res) => {
    const { classId } = req.query;
    const organizationId = req.session.organizationId;

    if (!classId) {
      return res.status(400).json({ message: "Class ID is required" });
    }
    if (!organizationId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    try {
      // Tenant boundary: only list subjects of the caller's organization.
      const result = await db.query(
        "SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2",
        [classId, organizationId]
      );

      res.json(result.rows);
    } catch (error) {
            res.status(500).json({ message: "Failed to fetch subjects." });
    }
  },

  uploadSlideshowImages: async (req, res) => {
    try {
      const { contentType } = req.body;

      const files = req.files; // Assuming multer is set up properly to use `req.files`

      const captions = Array.isArray(req.body["fileTexts"])
        ? req.body["fileTexts"]
        : [req.body["fileTexts"]]; // Ensure `captions` is always an array

      const orgId = req.session.organizationId;

      if (!files || files.length === 0) {
        req.flash("error", "No files selected for upload.");

        return res.redirect("/account/managePublicContent");
      }

      // Generate a unique `slideshow_id` for this set of images

      let slideshowId = null;

      if (contentType === "slideshow") {
        const slideshowIdResult = await db.query(
          "INSERT INTO slideshows (organization_id) VALUES ($1) RETURNING slideshow_id",

          [orgId]
        );

        slideshowId = slideshowIdResult.rows[0].slideshow_id;
      }

      // Loop over files and upload them to S3, save to DB with `slideshow_id`

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const caption = captions[i] || ""; // Match the caption to the file by index

        // Upload to S3 under images/publicdashboard/{orgId}/

        const imageKey = `images/publicdashboard/${orgId}/${file.originalname}`;

        const imageUrl = await uploadToS3(file, imageKey);

        // Save the file data to the database

        await db.query(
          "INSERT INTO organization_images (organization_id, slideshow_id, image_url, caption, allocation) VALUES ($1, $2, $3, $4, $5)",

          [orgId, slideshowId, imageUrl, caption, contentType]
        );
      }

      req.flash("success", "Content uploaded successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to upload content. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  addTextSection: async (req, res) => {
    const { heading, paragraph } = req.body;

    const orgId = req.session.organizationId;

    try {
      await db.query(
        "INSERT INTO organization_texts (organization_id, heading, paragraph) VALUES ($1, $2, $3)",

        [orgId, heading, paragraph]
      );

      req.flash("success", "Text section added successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to add text section. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateAboutUsSection: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { aboutUs } = req.body;

    if (!organizationId) {
      return res.status(403).send("Unauthorized.");
    }

    const toList = (value) => {
      const values = Array.isArray(value) ? value : [value];
      return values
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    };

    const mottoInput = String(req.body?.motto || "").trim();
    const mottos = mottoInput
      ? [mottoInput]
      : toList(req.body?.mottos).slice(0, 1);
    const emails = toList(req.body?.contactEmails);
    const phones = toList(req.body?.contactPhones);
    const primaryMotto = mottos[0] || "";

    try {
      await db.query(
        `UPDATE organizations SET aboutUs = $1, motto = $2 WHERE organization_id = $3`,

        [aboutUs, primaryMotto, organizationId]
      );

      const existingDash = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let order = [];
      let theme = "classic";
      let layout = "wireframe1";

      if (existingDash.rows.length > 0) {
        let raw = existingDash.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw.order)) order = raw.order;
            if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
            if (typeof raw.layout === "string" && raw.layout.trim()) layout = raw.layout.trim();
          }
        } catch (e) {
          order = [];
          theme = "classic";
          layout = "wireframe1";
        }
      }

      const payload = {
        order,
        theme,
        layout,
        aboutDetails: { mottos, emails, phones },
      };

      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organizationId, payload]
      );

      res.redirect("/account/managePublicContent"); // Replace with the actual page route
    } catch (error) {
            res.status(500).send("Server Error updating about us");
    }
  },

  managePublicContentGet: async (req, res) => {
    const { organizationId } = req.session;

    const url = req.url;

    try {
      const imagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1",

        [organizationId]
      );

      const textsResult = await db.query(
        "SELECT * FROM organization_texts WHERE organization_id = $1",

        [organizationId]
      );

      const result = await db.query(
        "SELECT * FROM organizations WHERE organization_id = $1",

        [organizationId]
      );

      const orgDetails = result.rows[0];

      const heroImageResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "hero"]
      );

      const heroImage = heroImageResult.rows[0];

      const slideshowImagesResult = await db.query(
        "SELECT * FROM organization_images WHERE organization_id = $1 AND allocation = $2",

        [organizationId, "slideshow"]
      );

      const slideshowImages = slideshowImagesResult.rows;

      const currentSchoolYearTerm = await db.query(
        `

                SELECT sy.id as school_year_id, t.term_id

                FROM school_years sy

                JOIN terms t ON sy.id = t.school_year_id

                WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE

            `,

        [organizationId]
      );

      if (currentSchoolYearTerm.rows.length === 0) {
        req.flash(
          "error",

          "No current school year or term found. Create one to be able to edit organization dashboards"
        );

        return res.redirect("/common/manageRecords");
      }

      const { school_year_id, term_id } = currentSchoolYearTerm.rows[0];

      // Fetch events and announcements tied to the current school year and term

      const events = await db.query(
        "SELECT * FROM school_events WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",

        [organizationId, school_year_id, term_id]
      );

      const formattedEvents = events.rows.map((event) => ({
        ...event,

        event_date: new Date(event.event_date).toISOString().split("T")[0], // Convert to YYYY-MM-DD
      }));

      const announcements = await db.query(
        "SELECT * FROM announcements WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3",

        [organizationId, school_year_id, term_id]
      );

      // Load current school website theme/layout from organization_dashboard
      let publicDashboardTheme = "classic";
      let publicDashboardLayout = "wireframe1";
      let aboutDetails = {
        mottos: orgDetails?.motto ? [orgDetails.motto] : [],
        emails: orgDetails?.email ? [orgDetails.email] : [],
        phones: orgDetails?.organization_phone ? [orgDetails.organization_phone] : [],
      };
      try {
        const dashRow = await db.query(
          "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
          [organizationId]
        );
        if (dashRow.rows.length > 0) {
          let raw = dashRow.rows[0].order_data;
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            if (typeof raw.theme === "string" && raw.theme.trim()) {
              publicDashboardTheme = raw.theme.trim();
            }
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              publicDashboardLayout = raw.layout.trim();
            }
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              const toList = (value) => {
                const values = Array.isArray(value) ? value : [value];
                return values
                  .map((item) => String(item || "").trim())
                  .filter(Boolean);
              };

              aboutDetails = {
                mottos: toList(raw.aboutDetails.mottos),
                emails: toList(raw.aboutDetails.emails),
                phones: toList(raw.aboutDetails.phones),
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
        }
      } catch (e) {
        publicDashboardTheme = "classic";
        publicDashboardLayout = "wireframe1";
      }

      res.render("account/managePublicContent", {
        title: "Manage Public Content",

        images: imagesResult.rows,

        texts: textsResult.rows,

        organizationId,

        orgDetails,

        heroImage,

        slideshowImages,

        url,

        events: formattedEvents,

        announcements: announcements.rows,

        publicDashboardTheme,
        publicDashboardLayout,
        aboutDetails,

        messages: {
          error: req.flash("error"),

          success: req.flash("success"),
        },
      });
    } catch (error) {
            req.flash("error", "Failed to load public content.");

      res.redirect("/account");
    }
  },

  updatePublicDashboardLayoutPost: async (req, res) => {
    const organizationId = req.session.organizationId;
    const layout = (req.body?.publicDashboardLayout || "").trim();
    const allowedLayouts = new Set(["wireframe1", "wireframe2", "wireframe3", "wireframe4"]);

    if (!organizationId) {
      req.flash("error", "Missing organization.");
      return res.redirect("/account/managePublicContent");
    }

    if (!allowedLayouts.has(layout)) {
      req.flash("error", "Invalid website layout selected.");
      return res.redirect("/account/managePublicContent");
    }

    try {
      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let order = [];
      let theme = "classic";
      let aboutDetails = {};

      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw.order)) order = raw.order;
            if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          }
        } catch (e) {
          order = [];
          theme = "classic";
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

      req.flash("success", "Website layout updated successfully.");
      return res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to update website layout.");
      return res.redirect("/account/managePublicContent");
    }
  },

  updatePublicDashboardThemePost: async (req, res) => {
    const organizationId = req.session.organizationId;
    const theme = (req.body?.publicDashboardTheme || "").trim();
    const redirectTo = (req.body?.redirectTo || "").trim();
    const safeRedirect = redirectTo.startsWith("/account/")
      ? redirectTo
      : "/account/managePublicContent";
    const withThemeApplied = `${safeRedirect}${safeRedirect.includes("?") ? "&" : "?"}themeApplied=1`;
    
    // Map public theme values to organization button theme values
    const themeMapping = {
      'classic': 'teal',
      'modern': 'blue',
      'green': 'green',
      'minimal': 'purple',
      'indigo': 'indigo',
      'rose': 'rose',
      'amber': 'amber',
      'yellow': 'yellow',
      'slate': 'slate',
      'cyan': 'cyan',
      'orange': 'orange',
      'charcoal': 'charcoal'
    };
    
    const allowedThemes = new Set(Object.keys(themeMapping));

    if (!organizationId) {
      req.flash("error", "Missing organization.");
      return res.redirect(safeRedirect);
    }

    if (!allowedThemes.has(theme)) {
      req.flash("error", "Invalid website style selected.");
      return res.redirect(safeRedirect);
    }

    try {
      const existing = await db.query(
        "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
        [organizationId]
      );

      let order = [];
      let layout = "wireframe1";
      let aboutDetails = {};
      if (existing.rows.length > 0) {
        let raw = existing.rows[0].order_data;
        try {
          if (typeof raw === "string") raw = JSON.parse(raw);
          if (Array.isArray(raw)) {
            order = raw;
          } else if (raw && typeof raw === "object" && Array.isArray(raw.order)) {
            order = raw.order;
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              layout = raw.layout.trim();
            }
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          } else if (raw && typeof raw === "object") {
            if (typeof raw.layout === "string" && raw.layout.trim()) {
              layout = raw.layout.trim();
            }
            if (raw.aboutDetails && typeof raw.aboutDetails === "object") {
              aboutDetails = raw.aboutDetails;
            }
          }
        } catch (e) {
          order = [];
          layout = "wireframe1";
          aboutDetails = {};
        }
      }

      const payload = { order, theme, layout, aboutDetails };

      // Update school website theme
      await db.query(
        `INSERT INTO organization_dashboard (organization_id, order_data)
         VALUES ($1, $2)
         ON CONFLICT (organization_id)
         DO UPDATE SET order_data = EXCLUDED.order_data`,
        [organizationId, payload]
      );

      // Update organization button theme color
      const orgThemeColor = themeMapping[theme];
      await db.query(
        "UPDATE organizations SET theme_color = $1 WHERE organization_id = $2",
        [orgThemeColor, organizationId]
      );

      // Update session with new theme color
      req.session.themeColor = orgThemeColor;

      req.flash("success", "Website style updated successfully.");
      return res.redirect(withThemeApplied);
    } catch (error) {
            req.flash("error", "Failed to update website style.");
      return res.redirect(safeRedirect);
    }
  },

  updatePublicRegistration: async (req, res) => {
    const { enabled, startDate, endDate, price, currency } = req.body;

    const organizationId = req.session.organizationId;

    try {
      await db.query(
        `UPDATE organizations 

         SET public_registration_enabled = $1,

             registration_start_date = $2,

             registration_end_date = $3,

             public_registration_price = $4,

             public_registration_currency = $5

         WHERE organization_id = $6`,

        [
          enabled === "on",

          startDate || null,

          endDate || null,

          price || 0,

          currency || "USD",

          organizationId,
        ]
      );

      req.flash("success", "Public registration settings updated!");

      // ✅ Instead of manually rendering with empty data, redirect:

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Could not update registration settings.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateImagePost: async (req, res) => {
    const { imageId, caption, allocation } = req.body;

    const { organizationId } = req.session;

    try {
      await db.query(
        "UPDATE organization_images SET caption = $1, allocation = $2 WHERE image_id = $3 AND organization_id = $4",

        [caption, allocation, imageId, organizationId]
      );

      req.flash("success", "Image updated successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to update image. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  deleteImageGet: async (req, res) => {
    const { imageId } = req.params;

    const { organizationId } = req.session;

    try {
      // Fetch the image URL first

      const imageResult = await db.query(
        "SELECT image_url FROM organization_images WHERE image_id = $1 AND organization_id = $2",

        [imageId, organizationId]
      );

      if (imageResult.rows.length === 0) {
        req.flash("error", "Image not found.");

        return res.redirect("/account/managePublicContent");
      }

      const imageUrl = imageResult.rows[0].image_url;

      // Delete image from DB

      await db.query(
        "DELETE FROM organization_images WHERE image_id = $1 AND organization_id = $2",

        [imageId, organizationId]
      );

      // Delete image from S3

      if (imageUrl) {
        // Remove the S3 URL prefix to get the key

        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;

        let imageKey = imageUrl;

        if (imageUrl.startsWith(s3Prefix)) {
          imageKey = imageUrl.substring(s3Prefix.length);
        }

        await deleteFromS3(imageKey);
      }

      req.flash("success", "Image deleted successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to delete image. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  updateTextPost: async (req, res) => {
    const { textId, heading, paragraph } = req.body;

    const { organizationId } = req.session;

    try {
      await db.query(
        "UPDATE organization_texts SET heading = $1, paragraph = $2 WHERE text_id = $3 AND organization_id = $4",

        [heading, paragraph, textId, organizationId]
      );

      req.flash("success", "Text updated successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to update text. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  deleteTextGet: async (req, res) => {
    const { textId } = req.params;

    const { organizationId } = req.session;

    try {
      await db.query(
        "DELETE FROM organization_texts WHERE text_id = $1 AND organization_id = $2",

        [textId, organizationId]
      );

      req.flash("success", "Text deleted successfully.");

      res.redirect("/account/managePublicContent");
    } catch (error) {
            req.flash("error", "Failed to delete text. Please try again.");

      res.redirect("/account/managePublicContent");
    }
  },

  forgetPasswordGet: (req, res) => {
    res.render("account/forgetPassword", {
      title: "Forget Password",

      showFooterTopSection: true,
      messages: req.flash(),
    });
  },

  forgetPasswordPost: async (req, res) => {
    const { email } = req.body;
    const baseUrl = res.locals.BASE_URL;

    try {
      await ensureStudentPortalSchema(db);

      // Parent/Student portal passwords are school-managed.
      const portalAccountResult = await db.query(
        `SELECT 'guardian_accounts' AS source
           FROM guardian_accounts
          WHERE LOWER(login_email) = LOWER($1)
         UNION
         SELECT 'student_accounts' AS source
           FROM student_accounts
          WHERE LOWER(login_email) = LOWER($1)`,
        [email]
      );

      if (portalAccountResult.rows.length > 0) {
        const hasParent = portalAccountResult.rows.some((row) => row.source === 'guardian_accounts');
        const hasStudent = portalAccountResult.rows.some((row) => row.source === 'student_accounts');

        let portalActor = "a student or a parent";
        if (hasParent && !hasStudent) portalActor = "a parent";
        if (hasStudent && !hasParent) portalActor = "a student";

        req.flash(
          "error",
          `If you're ${portalActor}, please contact the school for help on setting up a new password.`
        );
        return res.redirect("/account/forget-password");
      }

      // Search staff/admin/hub login tables for this email
      const userResult = await db.query(
        `SELECT email, 'users' AS source FROM users WHERE LOWER(email) = LOWER($1)
         UNION
         SELECT email, 'organizations' AS source FROM organizations WHERE LOWER(email) = LOWER($1)
         UNION
         SELECT hub_email AS email, 'managira_hubs' AS source FROM managira_hubs WHERE LOWER(hub_email) = LOWER($1) AND deleted = false`,
        [email]
      );

      if (userResult.rows.length === 0) {
        req.flash("error", "No account found with that email address.");
        return res.redirect("/account/forget-password");
      }

      const token = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const tokenExpiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Store reset token in ALL matching tables (user could exist in multiple)
      for (const row of userResult.rows) {
        if (row.source === "users") {
          await db.query(
            `UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE LOWER(email) = LOWER($3)`,
            [hashedToken, tokenExpiration, email]
          );
        } else if (row.source === "organizations") {
          await db.query(
            `UPDATE organizations SET reset_password_token = $1, reset_password_expires = $2 WHERE LOWER(email) = LOWER($3)`,
            [hashedToken, tokenExpiration, email]
          );
        } else if (row.source === "managira_hubs") {
          await db.query(
            `UPDATE managira_hubs SET reset_password_token = $1, reset_password_expires = $2 WHERE LOWER(hub_email) = LOWER($3)`,
            [hashedToken, tokenExpiration, email]
          );
        }
      }

      sendPasswordResetEmail(email, token, baseUrl);

      req.flash(
        "success",
        "A password reset link has been sent to your email. The link will expire in 15 minutes."
      );

      res.redirect("/account/login");
    } catch (error) {
      console.error("[forgetPasswordPost] Error:", error.message);
      req.flash("error", "An error occurred. Please try again.");
      res.redirect("/account/forget-password");
    }
  },

  resetPasswordGet: async (req, res) => {
    const { token } = req.query;

    if (!token) {
      req.flash("error", "Invalid reset link.");
      return res.render("account/resetPassword", {
        title: "Reset Password",
        token: null,
        email: null,
        showFooterTopSection: true,
        messages: { error: req.flash("error"), success: [] },
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    try {
      // Search all tables for the token
      const userResult = await db.query(
        `SELECT email, 'users' AS source FROM users WHERE reset_password_token = $1
         UNION
         SELECT email, 'organizations' AS source FROM organizations WHERE reset_password_token = $1
         UNION
         SELECT login_email AS email, 'guardian_accounts' AS source FROM guardian_accounts WHERE reset_password_token = $1
         UNION
         SELECT hub_email AS email, 'managira_hubs' AS source FROM managira_hubs WHERE reset_password_token = $1`,
        [hashedToken]
      );

      if (userResult.rows.length === 0) {
        req.flash("error", "Invalid reset link.");
        return res.render("account/resetPassword", {
          title: "Reset Password",
          token: null,
          email: null,
          showFooterTopSection: true,
          messages: { error: req.flash("error"), success: [] },
        });
      }

      const email = userResult.rows[0].email;

      res.render("account/resetPassword", {
        title: "Reset Password",
        token,
        email,
        showFooterTopSection: true,
        messages: { error: req.flash("error"), success: [] },
      });
    } catch (error) {
      console.error("[resetPasswordGet] Error:", error.message);
      req.flash("error", "An error occurred. Please try again.");
      res.render("account/resetPassword", {
        title: "Reset Password",
        token: null,
        email: null,
        showFooterTopSection: true,
        messages: { error: req.flash("error"), success: [] },
      });
    }
  },

  resetPasswordPost: async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.render("account/resetPassword", {
        title: "Reset Password",
        token,
        showFooterTopSection: true,
        messages: req.flash(),
      });
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;

    if (!passwordRegex.test(password)) {
      req.flash(
        "error",
        "Password must be at least 6 characters long, contain uppercase, lowercase, a number, and a special character."
      );
      return res.render("account/resetPassword", {
        title: "Reset Password",
        token,
        showFooterTopSection: true,
        messages: req.flash(),
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      let email = null;
      let updated = false;

      // Try users table
      const userResult = await db.query(
        `UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expires = NULL
         WHERE reset_password_token = $2
         RETURNING email`,
        [hashedPassword, hashedToken]
      );
      if (userResult.rows.length > 0) {
        email = userResult.rows[0].email;
        updated = true;
      }

      // Try organizations table
      if (!updated) {
        const orgResult = await db.query(
          `UPDATE organizations SET password = $1, reset_password_token = NULL, reset_password_expires = NULL
           WHERE reset_password_token = $2
           RETURNING email`,
          [hashedPassword, hashedToken]
        );
        if (orgResult.rows.length > 0) {
          email = orgResult.rows[0].email;
          updated = true;
        }
      }

      // Try guardian_accounts table
      if (!updated) {
        const guardianResult = await db.query(
          `UPDATE guardian_accounts SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL, must_reset_password = false
           WHERE reset_password_token = $2
           RETURNING login_email AS email`,
          [hashedPassword, hashedToken]
        );
        if (guardianResult.rows.length > 0) {
          email = guardianResult.rows[0].email;
          updated = true;
        }
      }

      // Try managira_hubs table
      if (!updated) {
        const hubResult = await db.query(
          `UPDATE managira_hubs SET hub_password = $1, reset_password_token = NULL, reset_password_expires = NULL
           WHERE reset_password_token = $2
           RETURNING hub_email AS email`,
          [hashedPassword, hashedToken]
        );
        if (hubResult.rows.length > 0) {
          email = hubResult.rows[0].email;
          updated = true;
        }
      }

      if (!updated) {
        req.flash("error", "Invalid or expired reset link.");
        return res.render("account/resetPassword", {
          title: "Reset Password",
          token: null,
          showFooterTopSection: true,
          messages: req.flash(),
        });
      }

      // Notify user about the password reset (fire-and-forget)
      sendPasswordResetConfirmationEmail(email);

      req.flash(
        "success",
        "Password reset successful. A confirmation email has been sent to you."
      );

      res.redirect("/account/login");
    } catch (error) {
      console.error("[resetPasswordPost] Error:", error.message);
      req.flash("error", "An error occurred. Please try again.");
      res.render("account/resetPassword", {
        title: "Reset Password",
        token,
        showFooterTopSection: true,
        messages: req.flash(),
      });
    }
  },

  settingsGet: async (req, res, db) => {
    try {
      await Promise.all([
        ensureProfileImageColumns(db),
        ensureAttendanceCalendarSchema(db),
        ensureOrganizationDisplayPreferencesSchema(db),
        ensureOrganizationCurrencySchema(db),
      ]);

      const activeSettingsSection = String(req.query.section || "").trim().toLowerCase();

      const sessionUserId = req.session.user?.user_id || req.session.userId;
      const userId = req.query.userId || sessionUserId;
      let orgId = req.session.organizationId;

      if (!orgId && userId) {
        const orgLookup = await db.query(
          "SELECT organization_id FROM users WHERE user_id = $1",
          [userId]
        );
        if (orgLookup.rows.length > 0) {
          orgId = orgLookup.rows[0].organization_id;
        }
      }

      const stripeSettings = await getStripeSettings(db).catch(() => ({ mode: 'test' }));
      const platformFeeSettings = await getPlatformFeeSettings(db).catch(() => ({ percentage: 0 }));
      await ensureStripeConnectAccountSchema(db);

      const orgResult = orgId
        ? await db.query(
            `SELECT organization_name, logo, logo_path, image_url, font_style, nickname, nickname_display, role, email, paystack_customer_code, stripe_customer_id, billing_provider, first_name, last_name, organization_phone, organization_address, organization_country, organization_province, organization_currency, is_hub_member, hub_id, stripe_connect_account_id, stripe_connect_account_id_test, stripe_connect_account_id_live, platform_fee_bearer, name_display_format, date_display_format
             FROM organizations 
             WHERE organization_id = $1`,
            [orgId]
          )
        : { rows: [] };

      if (req.session && orgResult.rows.length > 0) {
        req.session.orgNickNameDisplay = (orgResult.rows[0].nickname_display && String(orgResult.rows[0].nickname_display).trim()) || orgResult.rows[0].nickname;
        applyDisplayPreferencesToSession(req.session, orgResult.rows[0]);
      }

      const planDetailsResult = orgId
        ? await db.query(
            `SELECT o.plan_id, p.plan_name, o.pending_plan_id, o.pending_plan_effective_date, p2.plan_name AS pending_plan_name
             FROM organizations o
             JOIN plans p ON o.plan_id = p.id
             LEFT JOIN plans p2 ON o.pending_plan_id = p2.id
             WHERE o.organization_id = $1`,
            [orgId]
          )
        : { rows: [] };

      const currentPlan = planDetailsResult.rows.length
        ? {
            plan_id: planDetailsResult.rows[0].plan_id,
            plan_name: planDetailsResult.rows[0].plan_name,
          }
        : null;

      const pendingPlan = planDetailsResult.rows[0]?.pending_plan_id
        ? {
            plan_id: planDetailsResult.rows[0].pending_plan_id,
            plan_name: planDetailsResult.rows[0].pending_plan_name,
            effective_date: planDetailsResult.rows[0].pending_plan_effective_date,
          }
        : null;

      const orgRowForCurrency = orgResult.rows[0] || null;
      const orgCountryRaw = String(orgRowForCurrency?.organization_country || '').trim().toUpperCase();
      const orgCountryCode = COUNTRY_NAME_LOOKUP[orgCountryRaw] ? orgCountryRaw : null;
      const orgCurrencyOverride = normalizeCurrencyCode(orgRowForCurrency?.organization_currency || '');
      const settingsCurrencyCacheSignature = [
        String(orgId || ''),
        String(orgCountryCode || ''),
        String(orgCurrencyOverride || ''),
      ].join(':');

      let currencyProfile = null;
      try {
        const cachedCurrency = req.session?.settingsCurrencyProfile || null;
        const cacheAgeMs = cachedCurrency && Number(cachedCurrency.cachedAt || 0)
          ? Date.now() - Number(cachedCurrency.cachedAt || 0)
          : Number.POSITIVE_INFINITY;

        if (
          cachedCurrency &&
          cacheAgeMs >= 0 &&
          cacheAgeMs < 1000 * 60 * 15 &&
          cachedCurrency.profile &&
          cachedCurrency.signature === settingsCurrencyCacheSignature
        ) {
          currencyProfile = cachedCurrency.profile;
        } else {
          if (orgCountryCode || orgCurrencyOverride) {
            const userCurrency = orgCurrencyOverride || normalizeCurrencyCode(getCurrencyForCountry(orgCountryCode)) || 'USD';
            const usdToUserRate = (await getUsdRate(userCurrency)) || 1;
            const usdToGhsRate = (await getUsdRate('GHS')) || null;

            currencyProfile = {
              userCurrency,
              countryCode: orgCountryCode,
              detectionSource: orgCurrencyOverride ? 'organization-currency-override' : 'organization-country-fallback',
              usdToUserRate,
              usdToGhsRate,
              locale: getLocaleForCurrency(userCurrency),
              updatedAt: new Date(),
            };
          } else {
            currencyProfile = await getCurrencyProfileForRequest(req, { organizationId: orgId });
          }

          if (req.session) {
            req.session.settingsCurrencyProfile = {
              cachedAt: Date.now(),
              signature: settingsCurrencyCacheSignature,
              profile: currencyProfile,
            };
          }
        }
      } catch (_) {
        if (orgCountryCode || orgCurrencyOverride) {
          const userCurrency = orgCurrencyOverride || normalizeCurrencyCode(getCurrencyForCountry(orgCountryCode)) || 'USD';
          const usdToUserRate = (await getUsdRate(userCurrency)) || 1;
          const usdToGhsRate = (await getUsdRate('GHS')) || null;
          currencyProfile = {
            userCurrency,
            countryCode: orgCountryCode,
            detectionSource: orgCurrencyOverride ? 'organization-currency-override' : 'organization-country-fallback',
            usdToUserRate,
            usdToGhsRate,
            locale: getLocaleForCurrency(userCurrency),
            updatedAt: new Date(),
          };
        } else {
          currencyProfile = await getCurrencyProfileForRequest(req, { organizationId: orgId });
        }
      }

      const plansResult = orgId
        ? await db.query(`
            SELECT p.id AS plan_id, p.plan_name, p.description,
            COALESCE(
              JSON_AGG(
                json_build_object('feature_name', f.feature_name)
                ORDER BY f.feature_name
              ) FILTER (WHERE f.id IS NOT NULL), '[]'
            ) AS features,
            COALESCE(SUM(f.price_usd), 0) AS total_price
            FROM plans p
            LEFT JOIN plan_features pf ON p.id = pf.plan_id
            LEFT JOIN features f ON pf.feature_id = f.id
            WHERE p.is_active = TRUE
            GROUP BY p.id, p.plan_name, p.description
            ORDER BY p.id;
          `)
        : { rows: [] };

      const organizationStudentCount = await getOrganizationStudentCount(db, orgId);
      const billingPeriods = await getActivePlanBillingPeriods(db);

      const plans = await Promise.all(
        (plansResult.rows || []).map(async (plan) => {
          const fallbackMonthlyUsd = Number(plan.total_price || 0);
          const pricing = await computeOrganizationPlanMonthlyPrice(db, {
            planId: plan.plan_id,
            fallbackMonthlyUsd,
            studentCount: organizationStudentCount,
            countryCode: currencyProfile?.countryCode || null,
          });

          const localized = localizeUsdAmount(pricing.monthlyPriceUsd, currencyProfile);
          const withinFreeRange = pricing.pricingMode === 'dynamic' ? pricing.extraStudents <= 0 : null;
          const statusTitle = pricing.pricingMode === 'dynamic'
            ? (withinFreeRange
                ? `Within free range (${organizationStudentCount}/${pricing.threshold} students)`
                : `Exceeded by ${pricing.extraStudents} student${pricing.extraStudents === 1 ? '' : 's'}`)
            : 'Flat plan pricing';
          const statusDetail = pricing.pricingMode === 'dynamic'
            ? (withinFreeRange
                ? `Your current student count is still covered by the ${pricing.threshold} free students on this plan.`
                : `First ${pricing.threshold} students are free. ${pricing.extraStudents} extra student${pricing.extraStudents === 1 ? '' : 's'} add ${formatCurrencyAmount(pricing.termStudentCostUsd, 'USD')} per term (~${formatCurrencyAmount(pricing.studentMonthlyCostUsd, 'USD')}/mo).`)
            : 'Dynamic student pricing is not configured for your region yet, so this plan uses flat monthly pricing.';

          return {
            ...plan,
            total_price: fallbackMonthlyUsd,
            modalBaseUsd: pricing.monthlyPriceUsd,
            modalBaseUsdDisplay: formatCurrencyAmount(pricing.monthlyPriceUsd, 'USD'),
            modalLocalizedPriceDisplay: formatCurrencyAmount(
              localized.localizedAmount,
              localized.userCurrency,
              currencyProfile.locale
            ),
            pricingMode: pricing.pricingMode,
            pricingRegionName: pricing.region?.name || 'Default Region',
            freeStudentThreshold: pricing.threshold,
            organizationStudentCount,
            extraStudents: pricing.extraStudents,
            withinFreeRange,
            perStudentRateUsd: pricing.perStudentRateUsd,
            perStudentRateUsdDisplay: formatCurrencyAmount(pricing.perStudentRateUsd, 'USD'),
            termStudentCostUsd: pricing.termStudentCostUsd,
            termStudentCostUsdDisplay: formatCurrencyAmount(pricing.termStudentCostUsd, 'USD'),
            studentMonthlyCostUsd: pricing.studentMonthlyCostUsd,
            studentMonthlyCostUsdDisplay: formatCurrencyAmount(pricing.studentMonthlyCostUsd, 'USD'),
            monthsPerTerm: pricing.monthsPerTerm,
            pricingStatusTitle: statusTitle,
            pricingStatusDetail: statusDetail,
          };
        })
      );

      let user = null;
      if (userId && orgId) {
        const userResult = await db.query(
          `SELECT first_name, last_name, email, account_type, image_url
           FROM users 
           WHERE user_id = $1 AND organization_id = $2`,
          [userId, orgId]
        );
        if (userResult.rows.length > 0) {
          user = userResult.rows[0];
        }
      }

      if (!user && orgId) {
        const orgUserResult = await db.query(
          `SELECT first_name, last_name, email, 'Manager' AS account_type, image_url
           FROM organizations
           WHERE organization_id = $1`,
          [orgId]
        );
        if (orgUserResult.rows.length > 0) {
          user = {
            ...orgUserResult.rows[0],
            image_url: orgUserResult.rows[0]?.image_url || req.session?.user?.image_url || "profilePlaceholder.png",
          };
        }
      }

      const orgRow = orgResult.rows[0] || {};
      orgRow.name_display_format = normalizeNameDisplayFormat(
        orgRow.name_display_format || req.session?.nameDisplayFormat || DEFAULT_NAME_DISPLAY_FORMAT
      );
      orgRow.date_display_format = normalizeDateDisplayFormat(
        orgRow.date_display_format || req.session?.dateDisplayFormat || DEFAULT_DATE_DISPLAY_FORMAT
      );
      const isHubMember = Boolean(orgRow.is_hub_member && orgRow.hub_id);

      // Fetch student ID settings for the Student ID Settings card
      let studentIdSettings = {};
      if (orgId) {
        await ensureStudentIdSettingsSchema(db);
        const sidResult = await db.query(
          `SELECT use_custom_student_id, student_id_prefix, student_id_auto_generate, student_id_counter, student_id_start_number
           FROM organizations WHERE organization_id = $1`,
          [orgId]
        );
        studentIdSettings = sidResult.rows[0] || {};
      }
      const nextAvailableStudentIdNumber = orgId
        ? await getNextSuggestedStudentIdNumber(
            db,
            orgId,
            studentIdSettings.student_id_counter || 0,
            studentIdSettings.student_id_start_number || null
          )
        : null;

      let paystackCustomerCode = orgRow.paystack_customer_code || '';
      const stripeCustomerId = orgRow.stripe_customer_id || null;
      const activeSystemProvider = await getActivePaymentProvider();
      const paymentProvider = orgRow.billing_provider || activeSystemProvider || 'paystack';
      let paymentMethods = [];
      let defaultPaymentMethod = null;
      let paystackSubaccounts = [];
      let storedCardMethods = [];
      let stripeInvoices = [];
      let appInvoices = [];

      if (orgId) {
        try {
          const paystackSubaccountsResult = await db.query(
            `SELECT * FROM paystack_subaccounts` +
              ` WHERE organization_id = $1` +
              ` ORDER BY account_type, is_primary DESC, created_at`,
            [orgId]
          );
          paystackSubaccounts = paystackSubaccountsResult.rows;
        } catch (err) {
                  }

        try {
          storedCardMethods = await getStoredCardPaymentMethods(db, orgId, null);
        } catch (err) {
                  }
      }

      if (orgId && !isHubMember && stripeCustomerId) {
        try {
          const stripe = await getStripeClient(db);
          const paymentMethodResult = await stripe.paymentMethods.list({
            customer: stripeCustomerId,
            type: 'card',
          });

          const _rawStripe2 = (paymentMethodResult.data || []).map((method) => {
            const storedCardMeta = storedCardMethods.find(
              (storedCard) => storedCard.id === method.id
            );

            return {
              id: method.id,
              brand: method.card?.brand || 'card',
              last4: method.card?.last4,
              expMonth: method.card?.exp_month,
              expYear: method.card?.exp_year,
              funding: method.card?.funding || null,
              fingerprint: method.card?.fingerprint || null,
              displayName: storedCardMeta?.displayName || null,
              isPrimary: Boolean(storedCardMeta?.isPrimary),
            };
          });
          _rawStripe2.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
          const _seenFp2 = new Set();
          paymentMethods = _rawStripe2
            .filter((m) => {
              if (!m.fingerprint) return true;
              if (_seenFp2.has(m.fingerprint)) return false;
              _seenFp2.add(m.fingerprint);
              return true;
            })
            .map(({ fingerprint, ...rest }) => rest);

          stripeInvoices = await listStripeInvoices(stripe, stripeCustomerId, 12);
        } catch (_) {
        }
      }

      if (orgId && !isHubMember) {
        try {
          appInvoices = await listAppInvoices(db, orgId, 12);
        } catch (_) {
          appInvoices = [];
        }
      }

      if (
        paymentProvider !== 'stripe' &&
        !paymentMethods.length &&
        orgId &&
        (await getActivePaystackSecretKey()) &&
        orgRow.email &&
        !isHubMember
      ) {
        if (!paystackCustomerCode) {
          try {
            const customerData = {
              email: orgRow.email,
              first_name: orgRow.first_name || orgRow.organization_name || 'Organization',
              last_name: orgRow.last_name || 'Account',
            };

            const customerResponse = await axios.post(
              'https://api.paystack.co/customer',
              customerData,
              {
                headers: {
                  Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
                  'Content-Type': 'application/json',
                },
              }
            );

            paystackCustomerCode = customerResponse.data.data.customer_code;
            await db.query(
              'UPDATE organizations SET paystack_customer_code = $1 WHERE organization_id = $2',
              [paystackCustomerCode, orgId]
            );
          } catch (error) {
                      }
        }

        if (paystackCustomerCode) {
          try {
            const customerResponse = await axios.get(
              `https://api.paystack.co/customer/${paystackCustomerCode}`,
              {
                headers: {
                  Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
                },
              }
            );

            const customer = customerResponse.data.data;
            if (customer.authorizations && customer.authorizations.length > 0) {
              const _seenPs2 = new Set();
              paymentMethods = customer.authorizations
                .filter((auth) => auth.channel === 'card' && auth.reusable)
                .filter((auth) => {
                  const _k = `${auth.brand}:${auth.last4}:${auth.exp_month}:${auth.exp_year}`;
                  if (_seenPs2.has(_k)) return false;
                  _seenPs2.add(_k);
                  return true;
                })
                .map((auth) => {
                  const storedCardMeta = storedCardMethods.find(
                    (storedCard) => storedCard.id === auth.authorization_code
                  );

                  return {
                    id: auth.authorization_code,
                    brand: auth.brand,
                    last4: auth.last4,
                    expMonth: auth.exp_month,
                    expYear: auth.exp_year,
                    email: auth.email,
                    displayName: storedCardMeta?.displayName || null,
                    isPrimary: Boolean(storedCardMeta?.isPrimary),
                  };
                });
            }
          } catch (paystackError) {
                      }
        }
      }

      if (!paymentMethods.length && storedCardMethods.length) {
        paymentMethods = storedCardMethods;
      }

      defaultPaymentMethod = pickDefaultCard(paymentMethods, storedCardMethods);

      let orgTermDateBounds = null;
      let attendanceCalendarProfile = null;
      let attendanceCalendarDays = [];
      let publicDashboardTheme = "classic";

      if (orgId) {
        const orgTermBoundsResult = await db.query(
          `
            SELECT MIN(start_date) AS min_start_date, MAX(end_date) AS max_end_date
            FROM terms
            WHERE organization_id = $1
          `,
          [orgId]
        );
        orgTermDateBounds = orgTermBoundsResult.rows[0] || null;

        attendanceCalendarProfile = await getAttendanceCalendarProfile(db, orgId, null);

        if (attendanceCalendarProfile) {
          const shouldRefreshHolidays = activeSettingsSection === "attendance";
          if (shouldRefreshHolidays && attendanceCalendarProfile.include_public_holidays) {
            const now = new Date();
            const holidayStartDate = `${now.getUTCFullYear()}-01-01`;
            const holidayEndDate = `${now.getUTCFullYear() + 2}-12-31`;
            const userIdForSync = req.session.userId || req.session.user?.user_id || null;
            const orgCountryCode = String(orgRow?.organization_country || "").trim().toUpperCase();
            const detectedCountryCode = String(currencyProfile?.countryCode || "").trim().toUpperCase();
            const defaultHolidayCountryCode = COUNTRY_NAME_LOOKUP[orgCountryCode]
              ? orgCountryCode
              : (COUNTRY_NAME_LOOKUP[detectedCountryCode] ? detectedCountryCode : "US");
            const syncCountryCode = COUNTRY_NAME_LOOKUP[String(attendanceCalendarProfile.country_code || "").trim().toUpperCase()]
              ? String(attendanceCalendarProfile.country_code || "").trim().toUpperCase()
              : defaultHolidayCountryCode;

            await syncPublicHolidayDays(db, {
              calendarId: attendanceCalendarProfile.calendar_id,
              organizationId: orgId,
              countryCode: syncCountryCode,
              startDate: holidayStartDate,
              endDate: holidayEndDate,
              userId: userIdForSync,
            });
          }

          attendanceCalendarDays = await getAttendanceCalendarDays(
            db,
            attendanceCalendarProfile.calendar_id
          );
        }

        try {
          const dashRow = await db.query(
            "SELECT order_data FROM organization_dashboard WHERE organization_id = $1",
            [orgId]
          );

          if (dashRow.rows.length > 0) {
            let raw = dashRow.rows[0].order_data;
            if (typeof raw === "string") raw = JSON.parse(raw);

            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              if (typeof raw.theme === "string" && raw.theme.trim()) {
                publicDashboardTheme = raw.theme.trim();
              }
            }
          }
        } catch (e) {
          publicDashboardTheme = "classic";
        }
      }

      const holidayCountries = getHolidayCountryOptions();
      const settingsCountryOptions = getSettingsCountryOptions();
      const settingsCurrencyOptions = getSupportedCurrencyOptions();
      const currencyNameByCode = new Map(
        (settingsCurrencyOptions || []).map((option) => [String(option.code || '').toUpperCase(), option.name])
      );
      const settingsCountryOptionsWithCurrency = (settingsCountryOptions || []).map((country) => {
        const currencyCode = getCurrencyForCountry(country.code);
        return {
          ...country,
          currencyCode: currencyCode || null,
          currencyName: currencyCode ? (currencyNameByCode.get(currencyCode) || currencyCode) : null,
        };
      });

      // Fetch latest payment + billing period info for the current plan card.
      // Include failed rows so the UI can show failure state/details without
      // falling back to Monthly.
      let billingInfo = null;
      let billingFailureInfo = null;
      let billingRetryHistory = [];
      if (orgId) {
        try {
          const billingResult = await db.query(
            `SELECT p.billing_period_key, p.amount_paid, p.status, p.created_at,
                    p.is_trial, p.trial_starts_at, p.trial_ends_at, p.next_payment_end_date,
                    p.failed_attempts, p.last_failed_payment,
                    dbc.label AS period_label, dbc.months AS period_months, dbc.discount_percentage
             FROM payments p
             LEFT JOIN dynamic_billing_cycles dbc ON dbc.cycle_key = p.billing_period_key
             WHERE p.organization_id = $1 AND p.status IN ('active', 'completed', 'failed')
             ORDER BY p.created_at DESC
             LIMIT 1`,
            [orgId]
          );
          if (billingResult.rows.length > 0) {
            billingInfo = billingResult.rows[0];

            if (String(billingInfo.status || '').toLowerCase() === 'failed') {
              const fallbackAttemptNumber = Number(billingInfo.failed_attempts || 0) || null;
              const fallbackRetryDelayDays = fallbackAttemptNumber
                ? (fallbackAttemptNumber <= 1 ? 1 : (fallbackAttemptNumber < 4 ? 2 : null))
                : null;
              let fallbackNextRetryAt = null;
              if (billingInfo.last_failed_payment && fallbackRetryDelayDays) {
                const retryDate = new Date(billingInfo.last_failed_payment);
                if (!Number.isNaN(retryDate.getTime())) {
                  retryDate.setDate(retryDate.getDate() + fallbackRetryDelayDays);
                  fallbackNextRetryAt = retryDate;
                }
              }

              const retryResult = await db.query(
                `SELECT attempt_number,
                        max_attempts,
                        charge_status,
                        amount_due,
                        currency,
                        failure_reason,
                        email_to_school_sent,
                        email_to_admin_sent,
                        next_retry_at,
                        created_at
                 FROM billing_retry_attempts
                 WHERE organization_id = $1
                 ORDER BY created_at DESC
                 LIMIT 5`,
                [orgId]
              ).catch(() => ({ rows: [] }));

              billingRetryHistory = retryResult.rows || [];

              if (billingRetryHistory.length > 0) {
                const latestRetry = billingRetryHistory[0];
                billingFailureInfo = {
                  missingAudit: false,
                  attemptNumber: Number(latestRetry.attempt_number || 0),
                  maxAttempts: Number(latestRetry.max_attempts || 4),
                  amountDue: Number(latestRetry.amount_due || 0),
                  currency: String(latestRetry.currency || 'USD').toUpperCase(),
                  reason: latestRetry.failure_reason || '',
                  nextRetryAt: latestRetry.next_retry_at || null,
                  failedAt: latestRetry.created_at || null,
                  emailToSchoolSent: latestRetry.email_to_school_sent,
                  emailToAdminSent: latestRetry.email_to_admin_sent,
                };
              } else {
                billingFailureInfo = {
                  missingAudit: true,
                  attemptNumber: fallbackAttemptNumber,
                  maxAttempts: 4,
                  amountDue: null,
                  currency: 'USD',
                  reason: '',
                  nextRetryAt: fallbackNextRetryAt,
                  failedAt: billingInfo.last_failed_payment || null,
                  emailToSchoolSent: null,
                  emailToAdminSent: null,
                };
              }
            }
          }
        } catch (e) {
          // Dynamic cycle lookup can fail in partial environments.
          billingInfo = null;
          billingFailureInfo = null;
          billingRetryHistory = [];
        }
      }

      // ── Email notification preferences ─────────────────────────────
      // Build the per-role list of toggleable email keys for this user, plus
      // their currently saved choices. Defaults to all-enabled when no row
      // exists in user_email_preferences.
      let notificationPrefs = [];
      let savedNotificationPrefs = {};
      try {
        await ensureEmailPreferencesSchema(db);
        const accountType = (user && user.account_type) || null;
        notificationPrefs = getStaffPreferencesForRole(accountType);
        if (notificationPrefs.length && userId) {
          savedNotificationPrefs = await getUserPreferenceMap(db, userId);
        }
      } catch (_) {
        notificationPrefs = [];
        savedNotificationPrefs = {};
      }

      const permissionContext = {
        userId,
        userRole: req.session.userRole || user?.account_type || null,
        organizationId: orgId,
        accountType: req.session.accountType || user?.account_type || null,
        userEmail: user?.email || req.session.email || null,
      };
      const localPermissionSet = new Set(
        (Array.isArray(res.locals?.userPermissions) ? res.locals.userPermissions : [])
          .map((permissionKey) => String(permissionKey || "").trim().toLowerCase())
      );

      let canAccessCustomizeSettings = false;
      let canAccessBillingSettings = false;
      let canAccessPaygiraSettings = false;
      let googleIntegration = {
        activated: false,
        configured: false,
        connected: false,
        shouldShowFeatures: false,
      };
      let whatsappIntegration = {
        activated: false,
        configured: false,
        connected: false,
        shouldShowFeatures: false,
        displayPhoneNumber: "",
        businessName: "",
        lastError: "",
      };
      let studentPortalIntegration = {
        activated: false,
        configured: false,
        connected: false,
        shouldShowFeatures: false,
      };
      const [settingsPermission, billingPermission, paygiraPermission] = await Promise.all([
        userHasPermission(db, permissionContext, PERMISSIONS.MANAGE_SETTINGS).catch(() => false),
        userHasPermission(db, permissionContext, PERMISSIONS.MANAGE_BILLING).catch(() => false),
        userHasPermission(db, permissionContext, PERMISSIONS.MANAGE_PAYGIRA).catch(() => false),
      ]);

      canAccessCustomizeSettings = settingsPermission || localPermissionSet.has(PERMISSIONS.MANAGE_SETTINGS);
      canAccessBillingSettings = billingPermission || localPermissionSet.has(PERMISSIONS.MANAGE_BILLING);
      canAccessPaygiraSettings =
        canAccessBillingSettings ||
        paygiraPermission ||
        localPermissionSet.has(PERMISSIONS.MANAGE_PAYGIRA);

      if (canAccessCustomizeSettings && orgId) {
        const [resolvedGoogleIntegration, initialWhatsappIntegration, resolvedStudentPortalIntegration] = await Promise.all([
          getGoogleIntegrationStatus(db, orgId),
          getWhatsappIntegrationStatus(db, orgId),
          getStudentPortalIntegrationStatus(db, orgId),
        ]);
        googleIntegration = resolvedGoogleIntegration;
        whatsappIntegration = initialWhatsappIntegration;
        studentPortalIntegration = resolvedStudentPortalIntegration;

        if (
          whatsappIntegration &&
          whatsappIntegration.lastError &&
          isTransientWhatsappErrorMessage(whatsappIntegration.lastError)
        ) {
          await clearWhatsappConnectionError(db, orgId).catch(() => {});
          whatsappIntegration = await getWhatsappIntegrationStatus(db, orgId).catch(() => whatsappIntegration);
        }
      }

      const metaConfig = getMetaConfig();
      const whatsappFrontendConfig = {
        appId: metaConfig.appId || "",
        embeddedSignupConfigId: metaConfig.embeddedSignupConfigId || "",
        graphApiVersion: metaConfig.graphApiVersion || "v21.0",
      };
      const resolvedServerTestAccessToken =
        String(process.env.WHATSAPP_TEST_ACCESS_TOKEN || "").trim() || WHATSAPP_SERVER_TEST_DEFAULTS.accessToken;
      const resolvedServerTestPhoneNumberId =
        String(process.env.WHATSAPP_TEST_PHONE_NUMBER_ID || "").trim() || WHATSAPP_SERVER_TEST_DEFAULTS.phoneNumberId;
      const whatsappServerTestConfig = {
        enabled: Boolean(
          resolvedServerTestAccessToken &&
          resolvedServerTestPhoneNumberId
        ),
        defaultRecipient:
          String(process.env.WHATSAPP_TEST_RECIPIENT || "").trim() || WHATSAPP_SERVER_TEST_DEFAULTS.recipient,
      };

      const payoutDestinationUtils = require("../utils/payoutDestination");
      const [payoutContext, paystackCountries] = await Promise.all([
        orgId
          ? payoutDestinationUtils
              .resolveSchoolPayoutDestination(orgId, db, { fresh: true })
              .catch(() => null)
          : Promise.resolve(null),
        getCachedPaystackCountries().catch(() => []),
      ]);

      res.render("account/settings", {
        title: "Settings",
        org: orgRow,
        user: user || {},
        planName: currentPlan ? currentPlan.plan_name : "",
        currentPlan,
        pendingPlan,
        billingInfo,
        billingFailureInfo,
        billingRetryHistory,
        plans,
        billingPeriods,
        currencyProfile,
        organizationStudentCount,
        paymentMethods,
        paymentProvider,
        defaultPaymentMethod,
        stripePublishableKey: await getActiveStripePublicKey(),
        stripeInvoices,
        appInvoices,
        paystackSubaccounts,
        paystackCustomerCode,
        isHubMember,
        stripeConnectAccountId: getStripeConnectAccountId(orgRow, stripeSettings.mode) || null,
        passwordVerified: req.session.passwordVerified || false,
        userId,
        orgTermDateBounds,
        attendanceCalendarProfile,
        attendanceCalendarDays,
        weekdayOptions: WEEKDAY_OPTIONS,
        holidayCountries,
        settingsCountryOptions,
        settingsCountryOptionsWithCurrency,
        settingsCurrencyOptions,
        publicDashboardTheme,
        notificationPrefs,
        savedNotificationPrefs,
        canAccessCustomizeSettings,
        canAccessBillingSettings,
        canAccessPaygiraSettings,
        googleIntegration,
        whatsappIntegration,
        whatsappFrontendConfig,
        whatsappServerTestConfig,
        studentPortalIntegration,
        feedbackTypeOptions: FEEDBACK_TYPE_OPTIONS,
        feedbackAreaOptions: FEEDBACK_AREA_OPTIONS,
        feedbackPriorityOptions: FEEDBACK_PRIORITY_OPTIONS,
        studentIdSettings,
        nextAvailableStudentIdNumber,
        payoutContext,
        platformFeePercentage: Number(platformFeeSettings.percentage || 0),
        paystackCountries,
        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Unable to load settings page.");
      res.redirect("/common/orgDashboard");
    }
  },

  appInvoicePdfGet: async (req, res, dbClient = db) => {
    try {
      await ensureBillingInvoicesSchema(dbClient);

      const organizationId = req.session.organizationId;
      const invoiceId = Number(req.params.invoiceId);
      if (!organizationId || !Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.status(400).send("Invalid invoice request.");
      }

      const invoiceResult = await dbClient.query(
        `SELECT bi.*, o.organization_name, o.email, o.organization_phone, o.organization_address,
                o.organization_country, o.plan_id AS organization_plan_id,
                p.plan_name, dbc.label AS billing_cycle_label
         FROM billing_invoices bi
         JOIN organizations o ON o.organization_id = bi.organization_id
         LEFT JOIN plans p ON p.id = o.plan_id
         LEFT JOIN dynamic_billing_cycles dbc ON dbc.cycle_key = bi.billing_period_key
         WHERE bi.id = $1
           AND bi.organization_id = $2
         LIMIT 1`,
        [invoiceId, organizationId]
      );

      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        return res.status(404).send("Invoice not found.");
      }

      let studentPricingSummary = null;
      try {
        const organizationStudentCount = await getOrganizationStudentCount(dbClient, organizationId);
        const planPricing = await computeOrganizationPlanMonthlyPrice(dbClient, {
          planId: Number(invoice.organization_plan_id || 0),
          fallbackMonthlyUsd: Number(invoice.amount_due || 0),
          studentCount: organizationStudentCount,
          countryCode: invoice.organization_country || null,
        });

        studentPricingSummary = buildStudentPricingBasisSummary({
          studentCount: organizationStudentCount,
          freeThreshold: Number(planPricing?.threshold || 0),
          extraStudents: Number(planPricing?.extraStudents || 0),
        });
      } catch (_) {
        studentPricingSummary = null;
      }

      const pdfBuffer = await generateAppInvoicePdfBuffer({
        invoice,
        organization: {
          organization_name: invoice.organization_name,
          email: invoice.email,
          organization_phone: invoice.organization_phone,
          organization_address: invoice.organization_address,
        },
        planName: invoice.plan_name || "Managira Platform",
        cycleLabel: invoice.billing_cycle_label || invoice.billing_period_key || "Monthly",
        supportEmail: process.env.NOTIFY_EMAIL_USER || "support@managira.com",
        studentPricingSummary,
      });

      const publicReference = buildPublicInvoiceReference(invoice, organizationId);
      const safeReference = String(publicReference)
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .slice(0, 80);
      const filename = `Managira_Invoice_SCREATE_LLC_${safeReference}.pdf`;
      const shouldDownload = String(req.query.download || "") === "1";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${shouldDownload ? "attachment" : "inline"}; filename="${filename}"`
      );
      res.setHeader("Content-Length", String(pdfBuffer.length));
      return res.send(pdfBuffer);
    } catch (error) {
      console.error("[appInvoicePdfGet] failed:", error?.message || error);
      return res.status(500).send("Unable to generate invoice PDF.");
    }
  },

  saveAttendanceCalendarProfilePost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const redirectBase = "/account/settings?section=customize";

    try {
      await ensureAttendanceCalendarSchema(db);

      const orgCountryResult = await db.query(
        `SELECT organization_country FROM organizations WHERE organization_id = $1 LIMIT 1`,
        [organizationId]
      );
      const orgCountryCode = String(orgCountryResult.rows?.[0]?.organization_country || "")
        .trim()
        .toUpperCase();
      const detectedCountryCode = String(
        (await getCurrencyProfileForRequest(req, { organizationId }).catch(() => null))?.countryCode || ""
      )
        .trim()
        .toUpperCase();
      const requestedCountryCode = String(req.body.countryCode || "")
        .trim()
        .toUpperCase();
      const fallbackCountryCode = COUNTRY_NAME_LOOKUP[orgCountryCode]
        ? orgCountryCode
        : (COUNTRY_NAME_LOOKUP[detectedCountryCode] ? detectedCountryCode : "US");
      const countryCode = COUNTRY_NAME_LOOKUP[requestedCountryCode]
        ? requestedCountryCode
        : fallbackCountryCode;
      const includePublicHolidays = parseBoolean(req.body.includePublicHolidays);
      const requestedWeekendDays = normalizeWeekendDaysInput(req.body.weekendDays || []);
      const weekendDays = requestedWeekendDays.length > 0 ? requestedWeekendDays : [0, 6];

      const fallbackTermResult = await db.query(
        `
          SELECT t.term_id, t.school_year_id
          FROM terms t
          JOIN school_years sy ON sy.id = t.school_year_id
          WHERE sy.organization_id = $1
          ORDER BY sy.current DESC, t.current DESC, t.start_date DESC
          LIMIT 1
        `,
        [organizationId]
      );

      if (fallbackTermResult.rows.length === 0) {
        req.flash("error", "Please create at least one term before saving calendar rules.");
        return res.redirect(redirectBase);
      }

      const fallbackTerm = fallbackTermResult.rows[0];

      const userId = req.session.userId || req.session.user?.user_id || null;

      const profile = await upsertAttendanceCalendarProfile(db, {
        organizationId,
        schoolYearId: fallbackTerm.school_year_id,
        termId: fallbackTerm.term_id,
        countryCode,
        weekendDays,
        includePublicHolidays,
        userId,
      });

      const now = new Date();
      const holidayStartDate = `${now.getUTCFullYear()}-01-01`;
      const holidayEndDate = `${now.getUTCFullYear() + 2}-12-31`;

      if (includePublicHolidays) {
        await syncPublicHolidayDays(db, {
          calendarId: profile.calendar_id,
          organizationId,
          countryCode,
          startDate: holidayStartDate,
          endDate: holidayEndDate,
          userId,
        });
      } else {
        await db.query(
          `DELETE FROM organization_attendance_calendar_days WHERE calendar_id = $1 AND source = 'public_holiday'`,
          [profile.calendar_id]
        );
      }

      req.flash("success", "School calendar rules saved for this organization.");
      return res.redirect(redirectBase);
    } catch (error) {
      req.flash("error", "Failed to save attendance calendar rules.");
      return res.redirect(redirectBase);
    }
  },

  addAttendanceCalendarDayPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const redirectBase = "/account/settings?section=customize";

    try {
      await ensureAttendanceCalendarSchema(db);

      const calendarDate = req.body.calendarDate;
      const label = (req.body.label || "").trim();
      const countsForAttendance = parseBoolean(req.body.countsForAttendance);

      if (!calendarDate) {
        req.flash("error", "Date is required to add a calendar day.");
        return res.redirect(redirectBase);
      }

      const userId = req.session.userId || req.session.user?.user_id || null;
      let profile = await getAttendanceCalendarProfile(db, organizationId, null);

      if (!profile) {
        const orgCountryResult = await db.query(
          `SELECT organization_country FROM organizations WHERE organization_id = $1 LIMIT 1`,
          [organizationId]
        );
        const orgCountryCode = String(orgCountryResult.rows?.[0]?.organization_country || "")
          .trim()
          .toUpperCase();
        const detectedCountryCode = String(
          (await getCurrencyProfileForRequest(req, { organizationId }).catch(() => null))?.countryCode || ""
        )
          .trim()
          .toUpperCase();
        const fallbackCountryCode = COUNTRY_NAME_LOOKUP[orgCountryCode]
          ? orgCountryCode
          : (COUNTRY_NAME_LOOKUP[detectedCountryCode] ? detectedCountryCode : "US");

        const fallbackTermResult = await db.query(
          `
            SELECT t.term_id, t.school_year_id
            FROM terms t
            JOIN school_years sy ON sy.id = t.school_year_id
            WHERE sy.organization_id = $1
            ORDER BY sy.current DESC, t.current DESC, t.start_date DESC
            LIMIT 1
          `,
          [organizationId]
        );

        if (fallbackTermResult.rows.length === 0) {
          req.flash("error", "Please create at least one term before adding calendar day overrides.");
          return res.redirect(redirectBase);
        }

        const fallbackTerm = fallbackTermResult.rows[0];

        profile = await upsertAttendanceCalendarProfile(db, {
          organizationId,
          schoolYearId: fallbackTerm.school_year_id,
          termId: fallbackTerm.term_id,
          countryCode: fallbackCountryCode,
          weekendDays: [0, 6],
          includePublicHolidays: true,
          userId,
        });

        await syncPublicHolidayDays(db, {
          calendarId: profile.calendar_id,
          organizationId,
          countryCode: profile.country_code,
          startDate: `${new Date().getUTCFullYear()}-01-01`,
          endDate: `${new Date().getUTCFullYear() + 2}-12-31`,
          userId,
        });
      }

      await upsertManualCalendarDay(db, {
        calendarId: profile.calendar_id,
        organizationId,
        calendarDate,
        label,
        countsForAttendance,
        userId,
      });

      req.flash("success", "Calendar day rule saved.");
      return res.redirect(redirectBase);
    } catch (error) {
      req.flash("error", "Failed to save calendar day rule.");
      return res.redirect(redirectBase);
    }
  },

  deleteAttendanceCalendarDayPost: async (req, res, db) => {
    const organizationId = req.session.organizationId;
    const calendarDayId = Number(req.body.calendarDayId);
    const redirectBase = "/account/settings?section=customize";

    try {
      await ensureAttendanceCalendarSchema(db);

      if (!calendarDayId) {
        req.flash("error", "Invalid calendar day selected.");
        return res.redirect(redirectBase);
      }

      const deleted = await deleteManualCalendarDay(db, {
        calendarDayId,
        organizationId,
      });

      if (!deleted) {
        req.flash("info", "Only manual calendar rules can be deleted.");
      } else {
        req.flash("success", "Manual calendar day removed.");
      }

      return res.redirect(redirectBase);
    } catch (error) {
      req.flash("error", "Failed to remove calendar day.");
      return res.redirect(redirectBase);
    }
  },

  cancelSubscriptionGet: (req, res) => {
    res.render("account/cancelSubscription", {
      title: "Cancel Subscription",

      messages: req.flash(),
    });
  },

  cancelSubscriptionPost: async (req, res) => {
    const { password, orgName } = req.body;

    const orgId = req.session.organizationId;

    try {
      // Step 1: Fetch organization details (trial status, name, email)

      const orgResult = await db.query(
        `SELECT trial_active_until, organization_name, email FROM organizations WHERE organization_id = $1`,

        [orgId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect("/account/update");
      }
      const { trial_active_until, organization_name, email } =
        orgResult.rows[0];

      // Step 2: Check for next_payment_end_date in latest payment

      const paymentResult = await db.query(
        `SELECT next_payment_end_date FROM payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,

        [orgId]
      );

      const now = new Date();

      let scheduledHoldDate = null;

      let immediateHold = false;

      if (trial_active_until && new Date(trial_active_until) > now) {
        // Free trial is active, put org on hold immediately

        await db.query(
          `UPDATE organizations SET on_hold = true, hold_by = 'User', trial_active_until = NULL, scheduled_hold_date = NOW() WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
        await db.query(
          `UPDATE stored_cards SET is_active = false WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Set payment status to cancelled
        await db.query(
          `UPDATE payments SET status = 'cancelled' WHERE organization_id = $1`,

          [orgId]
        );

        scheduledHoldDate = now;

        immediateHold = true;
      } else if (
        paymentResult.rows.length > 0 &&
        paymentResult.rows[0].next_payment_end_date
      ) {
        // Schedule hold for the end of the current paid period
        scheduledHoldDate = new Date(
          paymentResult.rows[0].next_payment_end_date
        );
        await db.query(
          `UPDATE organizations SET scheduled_hold_date = $1, hold_by = 'User' WHERE organization_id = $2`,

          [scheduledHoldDate, orgId]
        );

        // ✅ CRITICAL FIX: Set payment status to cancelled (will take effect after billing period)
        await db.query(
          `UPDATE payments SET status = 'cancelled' WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
        await db.query(
          `UPDATE stored_cards SET is_active = false WHERE organization_id = $1`,

          [orgId]
        );

        immediateHold = false;
      } else {
        // No payment info, put org on hold immediately

        await db.query(
          `UPDATE organizations SET on_hold = true, hold_by = 'User', scheduled_hold_date = NOW() WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Deactivate all stored cards to prevent future charges
        await db.query(
          `UPDATE stored_cards SET is_active = false WHERE organization_id = $1`,

          [orgId]
        );

        // ✅ CRITICAL FIX: Set payment status to cancelled
        await db.query(
          `UPDATE payments SET status = 'cancelled' WHERE organization_id = $1`,

          [orgId]
        );

        scheduledHoldDate = now;

        immediateHold = true;
      }

      try {
        await sendCancellationEmail(
          organization_name,

          req.session.firstName,

          email,

          scheduledHoldDate
        );
      } catch (e) {
        // Ignore email errors
      }

      if (immediateHold) {
        // Log user out and show cancellation message

        req.session.destroy((err) => {
          res.clearCookie("connect.sid", { path: "/" });

          req.flash(
            "error",

            "Your account has been cancelled and placed on hold. If you need further assistance, please contact support."
          );

          return res.redirect("/account/login");
        });
      } else {
        // Do not log out, just redirect to update page

        req.flash(
          "success",

          "Your subscription has been cancelled. You will retain access until the end of your current billing period."
        );

        return res.redirect("/account/update");
      }
    } catch (error) {
            req.flash("error", "An unexpected error occurred. Please try again.");

      res.redirect("/account/cancel-subscription");
    }
  },

  resumeOrCancelCancellationPost: async (req, res) => {
    const orgId = req.session.organizationId;

    try {
      // Only update the org's scheduled_hold_date and hold_by fields

      const orgResult = await db.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1`,

        [orgId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect("/account/update");
      }

      await db.query(
        `UPDATE organizations 
                 SET scheduled_hold_date = NULL, hold_by = NULL, on_hold = false 
                 WHERE organization_id = $1`,
        [orgId]
      );

      // Reactivate stored cards so recurring billing can charge again
      await db.query(
        `UPDATE stored_cards SET is_active = true WHERE organization_id = $1`,
        [orgId]
      );

      // Reactivate payment status so recurring billing picks them up
      await db.query(
        `UPDATE payments SET status = 'active' WHERE organization_id = $1 AND status = 'cancelled'`,
        [orgId]
      );

      req.flash(
        "success",
        "Your organization has been resumed successfully. Payments will continue via Paystack."
      );
      return res.redirect("/account/update");
    } catch (error) {
            req.flash("error", "Failed to resume organization. Please try again.");

      return res.redirect("/account/update");
    }
  },

  updatePlanGet: async (req, res) => {
    try {
      const orgId = req.session.organizationId;
      const currencyProfile = await getCurrencyProfileForRequest(req);

      // Fetch the organization's current and pending plan

      const orgResult = await db.query(
        `SELECT o.plan_id, p.plan_name, o.pending_plan_id, o.pending_plan_effective_date, p2.plan_name AS pending_plan_name

                 FROM organizations o 

                 JOIN plans p ON o.plan_id = p.id 

                 LEFT JOIN plans p2 ON o.pending_plan_id = p2.id

                 WHERE o.organization_id = $1`,

        [orgId]
      );

      if (orgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");

        return res.redirect("/account");
      }

      const orgData = orgResult.rows[0];
      const currentPlan = {
        plan_id: orgData.plan_id,
        plan_name: orgData.plan_name,
      };
      const pendingPlan = orgData.pending_plan_id
        ? {
            plan_id: orgData.pending_plan_id,
            plan_name: orgData.pending_plan_name,
            effective_date: orgData.pending_plan_effective_date,
          }
        : null;

      // Fetch available plans

      const plansResult = await db.query(`

                SELECT p.id AS plan_id, p.plan_name, p.description, 

                COALESCE(

                  JSON_AGG(

                    json_build_object('feature_name', f.feature_name)

                    ORDER BY f.feature_name

                  ) FILTER (WHERE f.id IS NOT NULL), '[]'

                ) AS features,

                COALESCE(SUM(f.price_usd), 0) AS total_price

                FROM plans p

                LEFT JOIN plan_features pf ON p.id = pf.plan_id

                LEFT JOIN features f ON pf.feature_id = f.id

                WHERE p.is_active = TRUE

                GROUP BY p.id, p.plan_name, p.description

                ORDER BY p.id;

            `);

      const plans = plansResult.rows
        .map((plan) => ({
          ...plan,
          total_price: parseFloat(plan.total_price) || 0,
        }))
        .map((plan) => {
          const localized = localizeUsdAmount(plan.total_price, currencyProfile);
          return {
            ...plan,
            priceUsdDisplay: formatCurrencyAmount(localized.amountUsd, "USD"),
            localizedPriceDisplay: formatCurrencyAmount(
              localized.localizedAmount,
              localized.userCurrency,
              currencyProfile.locale
            ),
            localizedCurrencyCode: localized.userCurrency,
          };
        });

      res.render("account/updatePlan", {
        title: "Update Subscription Plan",

        currentPlan,

        pendingPlan,

        plans,
        currencyProfile,

        messages: req.flash(),
      });
    } catch (error) {
            req.flash("error", "Failed to load plans.");

      res.redirect("/account");
    }
  },

  updatePlanPost: async (req, res) => {
    try {
      const { newPlanId, newBillingPeriod, redirectTo } = req.body;
      const safeRedirect = redirectTo || "/account/update-plan";

      const orgId = req.session.organizationId;
      const actorUserId = Number(req.session?.user?.user_id || req.session?.userId || 0) || null;
      const isNonProduction =
        String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";

      await ensureOrganizationPlanChangeEventsSchema(db);

      // Fetch the current plan and trial status of the organization
      const currentOrgResult = await db.query(
        `SELECT o.plan_id, o.trial_active_until, o.email, o.organization_name
         FROM organizations o WHERE o.organization_id = $1`,
        [orgId]
      );

      if (currentOrgResult.rows.length === 0) {
        req.flash("error", "Organization not found.");
        return res.redirect(safeRedirect);
      }

      const recordPlanEventSafe = async (eventPayload) => {
        try {
          await recordOrganizationPlanChangeEvent(db, {
            organizationId: orgId,
            actorUserId,
            ...eventPayload,
          });
        } catch (eventErr) {
          console.warn("[Billing][updatePlanPost] failed to record plan change event:", eventErr?.message || eventErr);
        }
      };

      const parsedNewPlanId = Number.parseInt(newPlanId, 10);
      if (!Number.isInteger(parsedNewPlanId) || parsedNewPlanId <= 0) {
        req.flash("error", "Please select a valid plan.");
        return res.redirect(safeRedirect);
      }

      const currentPlanId = currentOrgResult.rows[0].plan_id;
      const orgEmail = currentOrgResult.rows[0].email;
      const isOnTrial = currentOrgResult.rows[0].trial_active_until &&
        new Date(currentOrgResult.rows[0].trial_active_until) > new Date();
      const currencyProfile = await getCurrencyProfileForRequest(req);
      const organizationStudentCount = await getOrganizationStudentCount(db, orgId);

      // Check if user is changing billing period only (same plan)
      const billingPeriodChanged = !!newBillingPeriod;
      const planChanged = parsedNewPlanId !== Number.parseInt(currentPlanId, 10);

      if (!planChanged && !billingPeriodChanged) {
        req.flash(
          "error",
          "⚠️ Please select a different plan or billing cycle."
        );
        return res.redirect(safeRedirect);
      }

      // If only billing period changed, update it and redirect
      if (!planChanged && billingPeriodChanged) {
        await db.query(
          `UPDATE payments SET billing_period_key = $1 WHERE organization_id = $2 AND status = 'active'`,
          [newBillingPeriod, orgId]
        );
        await recordPlanEventSafe({
          fromPlanId: currentPlanId,
          toPlanId: currentPlanId,
          changeType: "billing_cycle",
          eventStage: "applied",
          billingPeriodKey: newBillingPeriod,
          chargeRequired: false,
          chargeApplied: false,
          note: "Billing cycle updated without plan change.",
        });
        req.flash(
          "success",
          "Your billing cycle has been updated. The change will take effect at your next renewal."
        );
        return res.redirect(safeRedirect);
      }

      // Fetch the plan names and fallback base prices, then resolve dynamic monthly pricing.
      const planPrices = await db.query(
        `SELECT p.id, p.plan_name, COALESCE(SUM(f.price_usd), 0) AS total_price
         FROM plans p
         LEFT JOIN plan_features pf ON p.id = pf.plan_id
         LEFT JOIN features f ON pf.feature_id = f.id
         WHERE p.id = $1 OR p.id = $2
         GROUP BY p.id`,
        [currentPlanId, parsedNewPlanId]
      );
      let currentPrice = 0, newPrice = 0, newPlanName = '';
      for (const row of planPrices.rows) {
        if (parseInt(row.id) === parseInt(currentPlanId)) {
          const pricing = await computeOrganizationPlanMonthlyPrice(db, {
            planId: currentPlanId,
            fallbackMonthlyUsd: parseFloat(row.total_price),
            studentCount: organizationStudentCount,
            countryCode: currencyProfile?.countryCode || null,
          });
          currentPrice = Number(pricing.monthlyPriceUsd || 0);
        }
        if (parseInt(row.id) === parseInt(parsedNewPlanId)) {
          const pricing = await computeOrganizationPlanMonthlyPrice(db, {
            planId: parsedNewPlanId,
            fallbackMonthlyUsd: parseFloat(row.total_price),
            studentCount: organizationStudentCount,
            countryCode: currencyProfile?.countryCode || null,
          });
          newPrice = Number(pricing.monthlyPriceUsd || 0);
          newPlanName = row.plan_name;
        }
      }

      if (!newPlanName) {
        req.flash("error", "Selected plan is not available.");
        return res.redirect(safeRedirect);
      }

      // Also update billing period if changed
      const updateBillingPeriod = billingPeriodChanged
        ? db.query(
            `UPDATE payments SET billing_period_key = $1 WHERE organization_id = $2 AND status = 'active'`,
            [newBillingPeriod, orgId]
          )
        : Promise.resolve();

      // ── DOWNGRADE (new plan is cheaper) ──
      if (newPrice < currentPrice) {
        const latestUpgradeEvent = await getLatestAppliedUpgradePlanChangeEvent(db, orgId).catch(() => null);
        let daysSinceLatestUpgrade = null;
        if (latestUpgradeEvent && Number(latestUpgradeEvent.to_plan_id || 0) === Number(currentPlanId || 0)) {
          const anchorDate = new Date(latestUpgradeEvent.effective_at || latestUpgradeEvent.requested_at);
          if (!Number.isNaN(anchorDate.getTime())) {
            daysSinceLatestUpgrade = Math.floor((Date.now() - anchorDate.getTime()) / (1000 * 60 * 60 * 24));
          }
        }

        const shouldApplyDowngradeUsageCharge =
          Number.isInteger(daysSinceLatestUpgrade) &&
          daysSinceLatestUpgrade >= DOWNGRADE_USAGE_CHARGE_THRESHOLD_DAYS &&
          daysSinceLatestUpgrade < DOWNGRADE_USAGE_CHARGE_WINDOW_DAYS;
        const downgradeUsageChargeUsd = shouldApplyDowngradeUsageCharge
          ? Math.max(0, Number(currentPrice || 0))
          : 0;

        let downgradeChargeApplied = false;
        let downgradeChargeCurrency = null;
        let downgradeChargeAmount = null;
        let downgradeChargeReference = null;
        let downgradeChargeSkippedInNonProduction = false;

        if (downgradeUsageChargeUsd > 0) {
          const downgradeChargeResult = await chargeOrganizationPlanChangeAmount(db, {
            organizationId: orgId,
            amountUsd: downgradeUsageChargeUsd,
            fromPlanId: currentPlanId,
            toPlanId: parsedNewPlanId,
            reason: "Plan downgrade usage charge",
            metadata: {
              charge_rule: "downgrade_usage_after_20_days",
              days_since_latest_upgrade: String(daysSinceLatestUpgrade),
            },
            missingCardMessage: "No payment card on file. Please add a payment method before downgrading.",
            missingStripeCardMessage: "Payment failed: please add a Stripe card before downgrading your plan.",
            defaultFailureMessage: "Unable to charge your card for this downgrade request.",
          });

          if (!downgradeChargeResult.success) {
            if (isNonProduction && downgradeChargeResult.isConnectionIssue) {
              downgradeChargeSkippedInNonProduction = true;
            } else {
              await recordPlanEventSafe({
                fromPlanId: currentPlanId,
                toPlanId: parsedNewPlanId,
                changeType: "downgrade",
                eventStage: "failed",
                billingPeriodKey: newBillingPeriod || null,
                chargeRequired: true,
                chargeApplied: false,
                chargeAmountUsd: downgradeUsageChargeUsd,
                chargeReason: "downgrade_usage_after_20_days",
                note: `Downgrade blocked because usage charge failed: ${downgradeChargeResult.userMessage}`,
              });
              req.flash("error", "Payment failed: " + downgradeChargeResult.userMessage);
              return res.redirect(safeRedirect);
            }
          } else {
            downgradeChargeApplied = true;
            downgradeChargeCurrency = downgradeChargeResult.chargeCurrency || "USD";
            downgradeChargeAmount = Number(downgradeChargeResult.chargedAmount || 0);
            downgradeChargeReference = downgradeChargeResult.paymentIntentId || null;
          }
        }

        const paymentResult = await db.query(
          `SELECT next_payment_end_date FROM payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [orgId]
        );

        let effectiveDate = null;
        if (paymentResult.rows.length > 0 && paymentResult.rows[0].next_payment_end_date) {
          effectiveDate = paymentResult.rows[0].next_payment_end_date;
        }

        const downgradeMessages = [];
        if (downgradeChargeApplied) {
          downgradeMessages.push(
            `A monthly usage charge of ${downgradeChargeCurrency || "USD"} ${Number(downgradeChargeAmount || 0).toFixed(2)} was applied because this downgrade was requested ${daysSinceLatestUpgrade} day${daysSinceLatestUpgrade === 1 ? "" : "s"} after your latest upgrade.`
          );
        }

        if (effectiveDate) {
          await db.query(
            `UPDATE organizations SET pending_plan_id = $1, pending_plan_effective_date = $2 WHERE organization_id = $3`,
            [parsedNewPlanId, effectiveDate, orgId]
          );
          await updateBillingPeriod;
          const msgs = [`Your plan will be downgraded to ${newPlanName} on ${new Date(effectiveDate).toLocaleDateString()}. You will retain your current plan features until then.`];
          if (downgradeMessages.length) msgs.push(...downgradeMessages);
          if (billingPeriodChanged) msgs.push('Your billing cycle update will take effect at the next renewal.');
          req.flash("success", msgs.join(' '));
          await recordPlanEventSafe({
            fromPlanId: currentPlanId,
            toPlanId: parsedNewPlanId,
            changeType: "downgrade",
            eventStage: "requested",
            effectiveAt: effectiveDate,
            billingPeriodKey: newBillingPeriod || null,
            chargeRequired: downgradeUsageChargeUsd > 0,
            chargeApplied: downgradeChargeApplied,
            chargeAmountUsd: downgradeUsageChargeUsd,
            chargeCurrency: downgradeChargeCurrency,
            chargeAmount: downgradeChargeAmount,
            chargeReference: downgradeChargeReference,
            chargeReason: downgradeUsageChargeUsd > 0 ? "downgrade_usage_after_20_days" : null,
            note: downgradeChargeSkippedInNonProduction
              ? "Downgrade usage charge skipped in non-production because Stripe connection was unavailable."
              : `Downgrade requested${Number.isInteger(daysSinceLatestUpgrade) ? ` ${daysSinceLatestUpgrade} days after latest upgrade` : ""}.`,
          });
        } else {
          await db.query(
            `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,
            [parsedNewPlanId, orgId]
          );
          await updateBillingPeriod;
          invalidateOrganizationAccessCache(orgId);
          req.session.allowedFeatures = [];
          req.flash("success", `Your plan has been changed to ${newPlanName}.` + (downgradeMessages.length ? ` ${downgradeMessages.join(" ")}` : "") + (billingPeriodChanged ? ' Billing cycle updated.' : ''));
          await recordPlanEventSafe({
            fromPlanId: currentPlanId,
            toPlanId: parsedNewPlanId,
            changeType: "downgrade",
            eventStage: "applied",
            effectiveAt: new Date(),
            billingPeriodKey: newBillingPeriod || null,
            chargeRequired: downgradeUsageChargeUsd > 0,
            chargeApplied: downgradeChargeApplied,
            chargeAmountUsd: downgradeUsageChargeUsd,
            chargeCurrency: downgradeChargeCurrency,
            chargeAmount: downgradeChargeAmount,
            chargeReference: downgradeChargeReference,
            chargeReason: downgradeUsageChargeUsd > 0 ? "downgrade_usage_after_20_days" : null,
            note: downgradeChargeSkippedInNonProduction
              ? "Downgrade usage charge skipped in non-production because Stripe connection was unavailable."
              : `Downgrade applied immediately${Number.isInteger(daysSinceLatestUpgrade) ? ` (${daysSinceLatestUpgrade} days after latest upgrade)` : ""}.`,
          });
        }

        if (downgradeChargeSkippedInNonProduction) {
          req.flash(
            "warning",
            "Stripe connection was unavailable in this non-production environment, so the downgrade usage charge was skipped."
          );
        }

        return res.redirect(safeRedirect);
      }

      // ── UPGRADE (new plan is more expensive) ──

      // If on free trial, upgrade immediately without charging
      if (isOnTrial) {
        await db.query(
          `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,
          [parsedNewPlanId, orgId]
        );
        await updateBillingPeriod;
        invalidateOrganizationAccessCache(orgId);
        req.session.allowedFeatures = [];
        await recordPlanEventSafe({
          fromPlanId: currentPlanId,
          toPlanId: parsedNewPlanId,
          changeType: "upgrade",
          eventStage: "applied",
          effectiveAt: new Date(),
          billingPeriodKey: newBillingPeriod || null,
          chargeRequired: false,
          chargeApplied: false,
          chargeReason: "trial_upgrade",
          note: "Upgraded while trial was still active.",
        });
        req.flash("success", `Your plan has been upgraded to ${newPlanName}. Since you are on a free trial, you will be charged the new plan rate when your trial ends.` + (billingPeriodChanged ? ' Billing cycle updated.' : ''));
        return res.redirect(safeRedirect);
      }

      // Not on trial — calculate prorated upgrade charge
      const paymentResult = await db.query(
        `SELECT next_payment_end_date, billing_period_key, created_at FROM payments
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [orgId]
      );

      if (paymentResult.rows.length === 0) {
        // No payment record — just switch immediately
        await db.query(
          `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,
          [parsedNewPlanId, orgId]
        );
        await updateBillingPeriod;
        invalidateOrganizationAccessCache(orgId);
        req.session.allowedFeatures = [];
        await recordPlanEventSafe({
          fromPlanId: currentPlanId,
          toPlanId: parsedNewPlanId,
          changeType: "upgrade",
          eventStage: "applied",
          effectiveAt: new Date(),
          billingPeriodKey: newBillingPeriod || null,
          chargeRequired: false,
          chargeApplied: false,
          chargeReason: "no_active_payment_record",
          note: "Upgraded immediately because no active payment record was found.",
        });
        req.flash("success", `Your plan has been upgraded to ${newPlanName}.` + (billingPeriodChanged ? ' Billing cycle updated.' : ''));
        return res.redirect(safeRedirect);
      }

      const payment = paymentResult.rows[0];
      const nextPaymentDate = new Date(payment.next_payment_end_date);
      const now = new Date();

      // Calculate remaining days in current billing period
      const periodKey = payment.billing_period_key || 'monthly';
      let periodMonths = 1;
      try {
        const dynamicCycle = await getActiveDynamicCycleByKey(db, periodKey);
        if (dynamicCycle) {
          periodMonths = Number(dynamicCycle.months) || 1;
        }
      } catch (e) { /* fallback to 1 */ }

      const totalPeriodDays = periodMonths * 30; // approximate
      const remainingMs = nextPaymentDate.getTime() - now.getTime();
      const remainingDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));

      // Prorated difference: (newMonthlyPrice - currentMonthlyPrice) * remainingDays / 30
      const monthlyDifference = newPrice - currentPrice;
      const proratedAmount = Math.max(0, (monthlyDifference * remainingDays) / 30);
      const proratedCurrency = 'USD';
      let proratedAmountInChargeCurrency = 0;
      let proratedChargeReference = null;

      if (proratedAmount > 0) {
        const proratedChargeResult = await chargeOrganizationPlanChangeAmount(db, {
          organizationId: orgId,
          amountUsd: proratedAmount,
          fromPlanId: currentPlanId,
          toPlanId: parsedNewPlanId,
          reason: "Plan upgrade proration",
          metadata: {
            prorated_days: String(remainingDays),
          },
          missingCardMessage: "No payment card on file. Please add a payment method before upgrading.",
          missingStripeCardMessage: "Payment failed: please add a Stripe card before upgrading your plan.",
          defaultFailureMessage: "Unable to charge your card for the upgrade.",
        });

        if (!proratedChargeResult.success) {
          if (isNonProduction && proratedChargeResult.isConnectionIssue) {
            await db.query(
              `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,
              [parsedNewPlanId, orgId]
            );
            await updateBillingPeriod;
            invalidateOrganizationAccessCache(orgId);
            req.session.allowedFeatures = [];
            await recordPlanEventSafe({
              fromPlanId: currentPlanId,
              toPlanId: parsedNewPlanId,
              changeType: "upgrade",
              eventStage: "applied",
              effectiveAt: new Date(),
              billingPeriodKey: newBillingPeriod || null,
              chargeRequired: true,
              chargeApplied: false,
              chargeAmountUsd: proratedAmount,
              chargeReason: "upgrade_proration",
              note: "Upgrade proration charge skipped in non-production because Stripe connection was unavailable.",
            });

            const connectivity = getStripeConnectivityFlags(proratedChargeResult.error);
            const fallbackReason = connectivity.isTlsIssue
              ? "Stripe TLS verification failed in this environment"
              : "Stripe connection is unavailable in this environment";
            req.flash(
              "warning",
              `${fallbackReason}. Applied ${newPlanName} immediately without prorated upgrade charge because this is a non-production environment.` +
                (billingPeriodChanged ? " Billing cycle updated." : "")
            );
            return res.redirect(safeRedirect);
          }

          await recordPlanEventSafe({
            fromPlanId: currentPlanId,
            toPlanId: parsedNewPlanId,
            changeType: "upgrade",
            eventStage: "failed",
            billingPeriodKey: newBillingPeriod || null,
            chargeRequired: true,
            chargeApplied: false,
            chargeAmountUsd: proratedAmount,
            chargeReason: "upgrade_proration",
            note: `Upgrade blocked because prorated charge failed: ${proratedChargeResult.userMessage}`,
          });
          req.flash("error", "Payment failed: " + proratedChargeResult.userMessage);
          return res.redirect(safeRedirect);
        }

        proratedAmountInChargeCurrency = Number(proratedChargeResult.chargedAmount || 0);
        proratedChargeReference = proratedChargeResult.paymentIntentId || null;
      }

      // Payment succeeded (or no charge needed) — apply the upgrade immediately
      await db.query(
        `UPDATE organizations SET plan_id = $1, pending_plan_id = NULL, pending_plan_effective_date = NULL WHERE organization_id = $2`,
        [parsedNewPlanId, orgId]
      );
      await updateBillingPeriod;
      invalidateOrganizationAccessCache(orgId);
      req.session.allowedFeatures = [];

      await recordPlanEventSafe({
        fromPlanId: currentPlanId,
        toPlanId: parsedNewPlanId,
        changeType: "upgrade",
        eventStage: "applied",
        effectiveAt: new Date(),
        billingPeriodKey: newBillingPeriod || null,
        chargeRequired: proratedAmount > 0,
        chargeApplied: proratedAmount > 0,
        chargeAmountUsd: proratedAmount > 0 ? proratedAmount : 0,
        chargeCurrency: proratedAmount > 0 ? proratedCurrency : null,
        chargeAmount: proratedAmount > 0 ? proratedAmountInChargeCurrency : null,
        chargeReference: proratedChargeReference,
        chargeReason: proratedAmount > 0 ? "upgrade_proration" : null,
        note: proratedAmount > 0
          ? `Prorated upgrade charge applied for ${remainingDays} remaining day${remainingDays === 1 ? "" : "s"}.`
          : "Upgrade applied without proration charge.",
      });

      const proratedMsg = proratedAmount > 0
        ? ` A prorated charge of ${proratedCurrency} ${Number(proratedAmountInChargeCurrency || 0).toFixed(2)} has been applied for the remaining ${remainingDays} day${remainingDays !== 1 ? 's' : ''} in your current billing period.`
        : '';
      req.flash("success", `Your plan has been upgraded to ${newPlanName}.${proratedMsg}` + (billingPeriodChanged ? ' Billing cycle updated.' : ''));

      return res.redirect(safeRedirect);
    } catch (error) {
      console.error("[Billing][updatePlanPost] failed:", error);
      req.flash("error", "❌ Failed to update plan.");
      return res.redirect(req.body.redirectTo || "/account/update-plan");
    }
  },

  addFlutterwaveAccountPost: async (req, res) => {
    const { organizationId, organizationName } = req.session;

    const {
      account_number,

      account_name,

      bank_or_provider,

      country,

      account_type,

      makePrimary,
    } = req.body;

    const safeAccountNumber = String(account_number || "").trim();

    const safeAccountName = String(account_name || "").trim();

    const safeBankOrProvider = String(bank_or_provider || "").trim();

    const safeCountry = country || "GH";

    const safePaymentType = account_type || "bank";

    const isPrimary = makePrimary === "on";

    try {
      // Enforce max 1 subaccount per type (bank/momo) per org

      const existingAccounts = await db.query(
        `SELECT * FROM flutterwave_accounts WHERE organization_id = $1 AND account_type = $2`,

        [organizationId, safePaymentType]
      );

      if (existingAccounts.rows.length > 0) {
        const message = `Only one ${safePaymentType.toUpperCase()} subaccount is allowed.`;

        if (req.headers["content-type"] === "application/json") {
          return res.status(400).json({ success: false, message });
        } else {
          req.flash("error", message);

          return res.redirect("/account/update-card");
        }
      }

      // Create subaccount in Flutterwave

      const response = await axios.post(
        "https://api.flutterwave.com/v3/subaccounts",

        {
          account_bank: safeBankOrProvider,

          account_number: safeAccountNumber,

          business_name: `${organizationName}-${organizationId}`,

          business_email: `${organizationName

            .replace(/\s+/g, "")

            .toLowerCase()}@managira.com`,

          business_contact: safeAccountName,

          business_contact_mobile: "0000000000",

          country: safeCountry,

          split_type: "percentage",

          split_value: 0.9,
        },

        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          },
        }
      );

      const subaccountId = response.data?.data?.subaccount_id;

      if (!subaccountId)
        throw new Error("No subaccount ID returned from Flutterwave.");

      // Set as primary (unset others)

      if (isPrimary) {
        await db.query(
          `UPDATE flutterwave_accounts SET is_primary = FALSE

           WHERE organization_id = $1 AND account_type = $2`,

          [organizationId, safePaymentType]
        );
      }

      // Insert into DB

      await db.query(
        `INSERT INTO flutterwave_accounts (

          organization_id, account_type, account_name, account_number,

          bank_or_provider, country, subaccount_id, is_primary

        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,

        [
          organizationId,

          safePaymentType,

          safeAccountName,

          safeAccountNumber,

          safeBankOrProvider,

          safeCountry,

          subaccountId,

          isPrimary,
        ]
      );

      if (req.headers["content-type"] === "application/json") {
        return res.status(200).json({ success: true });
      } else {
        req.flash("success", "🎉 Flutterwave account connected successfully.");

        return res.redirect("/account/update-card");
      }
    } catch (error) {
      const message =
        error.response?.data?.message || error.message || "Unknown error";

            if (req.headers["content-type"] === "application/json") {
        return res.status(500).json({ success: false, message });
      } else {
        req.flash("error", `Failed to connect Flutterwave account: ${message}`);

        return res.redirect("/account/update-card");
      }
    }
  },

  deleteFlutterwaveAccount: async (req, res) => {
    const { id } = req.body;

    try {
      await db.query(`DELETE FROM flutterwave_accounts WHERE id = $1`, [id]);

      res.json({ success: true });
    } catch (err) {
            res.json({ success: false, message: "Delete failed." });
    }
  },

  getFlutterwaveAccountById: async (req, res) => {
    const { id } = req.params;

    const { organizationId } = req.session;

    if (!organizationId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      const result = await db.query(
        `SELECT id, account_type, account_name, account_number, bank_or_provider, country

         FROM flutterwave_accounts

         WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res

          .status(404)

          .json({ success: false, message: "Account not found" });
      }

      return res.json({ success: true, account: result.rows[0] });
    } catch (error) {
            res.status(500).json({ success: false, message: "Server error" });
    }
  },

  updateFlutterwaveAccount: async (req, res) => {
    const {
      id,

      account_name,

      account_number,

      bank_or_provider,

      country,

      account_type,
    } = req.body;

    const { organizationId } = req.session;

    try {
      const safeAccountName = String(account_name || "").trim();

      const safeAccountNumber = String(account_number || "").trim();

      const safeBankOrProvider = String(bank_or_provider || "").trim();

      const safeCountry = country || "GH";

      const safeAccountType = account_type || "bank";

      const result = await db.query(
        `UPDATE flutterwave_accounts

         SET account_name = $1, account_number = $2,

             bank_or_provider = $3, country = $4

         WHERE id = $5 AND organization_id = $6 AND account_type = $7`,

        [
          safeAccountName,

          safeAccountNumber,

          safeBankOrProvider,

          safeCountry,

          id,

          organizationId,

          safeAccountType,
        ]
      );

      res.json({ success: true, message: "Account updated successfully" });
    } catch (error) {
            res

        .status(500)

        .json({ success: false, message: "Failed to update account" });
    }
  },

  deleteFlutterwaveAccount: async (req, res) => {
    const { id } = req.params;

    const { organizationId } = req.session;

    try {
      // Step 1: Get the subaccount_id from DB

      const result = await db.query(
        `SELECT subaccount_id FROM flutterwave_accounts

         WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res

          .status(404)

          .json({ success: false, message: "Account not found" });
      }

      const subaccountId = result.rows[0].subaccount_id;

      // Step 2: Delete from Flutterwave (optional – Flutterwave might not fully delete)

      try {
        await axios.delete(
          `https://api.flutterwave.com/v3/subaccounts/${subaccountId}`,

          {
            headers: {
              Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            },
          }
        );
      } catch (flwErr) {
        // Optionally ignore if subaccount is already gone
      }

      // Step 3: Delete locally

      await db.query(
        `DELETE FROM flutterwave_accounts WHERE id = $1 AND organization_id = $2`,

        [id, organizationId]
      );

      res.json({ success: true });
    } catch (err) {
            res.status(500).json({ success: false, message: "Delete failed." });
    }
  },

  // ✅ Card tokenization without payment

  tokenizeCard: async (req, res) => {
    try {
      const { cardNumber, expiryMonth, expiryYear, cvv } = req.body;
      const orgId = req.session.organizationId;

      if (!cardNumber || !expiryMonth || !expiryYear || !cvv) {
        return res.status(400).json({
          success: false,
          message: "All card details are required",
        });
      }

      // Get organization details

      const orgResult = await db.query(
        "SELECT email AS organization_email, paystack_customer_code FROM organizations WHERE organization_id = $1",
        [orgId]
      );

      if (orgResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Organization not found",
        });
      }

      const { organization_email, paystack_customer_code } = orgResult.rows[0];
      let customerCode = paystack_customer_code;

      // Create customer if doesn't exist

      if (!customerCode) {
        const customerData = {
          email: organization_email,
          first_name: "Organization",
          last_name: "Account",
        };

        const customerResponse = await axios.post(
          "https://api.paystack.co/customer",
          customerData,
          {
            headers: {
              Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
              "Content-Type": "application/json",
            },
          }
        );

        customerCode = customerResponse.data.data.customer_code;

        // Update organization with customer code

        await db.query(
          "UPDATE organizations SET paystack_customer_code = $1 WHERE organization_id = $2",
          [customerCode, orgId]
        );
      }

      // Use Paystack's charge endpoint with a minimal amount for tokenization

      const chargeData = {
        email: organization_email,
        amount: 50,
        card: {
          number: cardNumber,
          cvv: cvv,
          expiry_month: expiryMonth,
          expiry_year: expiryYear,
        },
        customer: customerCode,
        metadata: {
          tokenization_only: true,
          purpose: "Card tokenization",
        },
      };

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge",
        chargeData,
        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

            return res.status(400).json(payload);
    } catch (error) {
            if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to add card. Please try again.",
      });
    }
  },

  tokenizeCardSubmitPin: async (req, res) => {
    try {
      const { reference, pin } = req.body;
      const orgId = req.session.organizationId;

      if (!reference || !pin) {
        return res.status(400).json({
          success: false,
          message: "Reference and PIN are required",
        });
      }

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge/submit_pin",
        { reference, pin },
        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      return res.status(400).json(payload);
    } catch (error) {
            if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit PIN. Please try again.",
      });
    }
  },

  tokenizeCardSubmitOtp: async (req, res) => {
    try {
      const { reference, otp } = req.body;
      const orgId = req.session.organizationId;

      if (!reference || !otp) {
        return res.status(400).json({
          success: false,
          message: "Reference and OTP are required",
        });
      }

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge/submit_otp",
        { reference, otp },
        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      return res.status(400).json(payload);
    } catch (error) {
            if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit OTP. Please try again.",
      });
    }
  },

  tokenizeCardSubmitPhone: async (req, res) => {
    try {
      const { reference, phone } = req.body;
      const orgId = req.session.organizationId;

      if (!reference || !phone) {
        return res.status(400).json({
          success: false,
          message: "Reference and phone number are required",
        });
      }

      const chargeResponse = await axios.post(
        "https://api.paystack.co/charge/submit_phone",
        { reference, phone },
        {
          headers: {
            Authorization: `Bearer ${await getActivePaystackSecretKey()}`,
            "Content-Type": "application/json",
          },
        }
      );

      const payload = await buildChargeResponse(db, orgId, chargeResponse.data);

      if (payload.success || payload.nextStep) {
        return res.json(payload);
      }

      return res.status(400).json(payload);
    } catch (error) {
            if (error.response?.data?.message) {
        return res.status(400).json({
          success: false,
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit phone number. Please try again.",
      });
    }
  },

  // ✅ Paystack Subaccount Management

  addPaystackSubaccountPost: async (req, res) => {
    const {
      account_type,
      business_name,
      account_number,
      bank_code,
      bank_name,
      momo_number,
      momo_provider,
      account_holder_name,
    } = req.body;
    const orgId = req.session.organizationId;

    try {
      if (!account_type || !business_name) {
        return res.status(400).json({ success: false, message: "Account type and business name are required." });
      }

      // Validate required fields per type
      if (account_type === "bank" && (!account_number || !bank_name)) {
        return res.status(400).json({ success: false, message: "Account number and bank name are required for bank accounts." });
      }
      if (account_type === "mobile_money" && (!momo_number || !momo_provider)) {
        return res.status(400).json({ success: false, message: "Mobile money number and provider are required." });
      }

      // Allow multiple accounts of the same type but prevent exact duplicates
      const dupCheck = account_type === "bank"
        ? await db.query(`SELECT id FROM paystack_subaccounts WHERE organization_id=$1 AND account_type='bank' AND account_number=$2`, [orgId, account_number])
        : account_type === "mobile_money"
          ? await db.query(`SELECT id FROM paystack_subaccounts WHERE organization_id=$1 AND account_type='mobile_money' AND momo_number=$2`, [orgId, momo_number])
          : { rows: [] };
      if (dupCheck.rows.length > 0) {
        return res.status(400).json({ success: false, message: "This account is already saved. Edit the existing entry instead." });
      }

      // Determine if this will be the first account (→ set as primary)
      const existingCount = (await db.query(`SELECT COUNT(*) FROM paystack_subaccounts WHERE organization_id=$1`, [orgId])).rows[0].count;
      const isPrimary = Number(existingCount) === 0;

      // Get org details for dynamic currency
      const orgRow = (await db.query(
        `SELECT organization_country, organization_name, organization_address, organization_province
           FROM organizations
          WHERE organization_id=$1`,
        [orgId]
      )).rows[0] || {};
      const explicitCountryCode = String(orgRow.organization_country || '').trim().toUpperCase();
      const inferredCountryCode = inferCountryCodeFromLocationParts(
        orgRow.organization_address,
        orgRow.organization_province
      );
      const orgCountryCode = /^[A-Z]{2}$/.test(explicitCountryCode)
        ? explicitCountryCode
        : (inferredCountryCode || 'GH');
      const currency = getCurrencyForCountry(orgCountryCode) || 'USD';

      // Try to get Paystack secret key — if unavailable, save locally
      const secretKey = await getActivePaystackSecretKey().catch(() => null);
      const paystackHeaders = secretKey
        ? { headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' } }
        : null;

      if (account_type === "bank") {
        let subaccountCode = null;
        let resolvedBankCode = bank_code || '';

        if (paystackHeaders) {
          // Resolve bank code from Paystack bank list
          try {
            const countryParam = { GHS: 'ghana', NGN: 'nigeria', KES: 'kenya', ZAR: 'south africa', XOF: 'ivory coast' }[currency] || 'ghana';
            const banksResp = await axios.get(`https://api.paystack.co/bank?country=${encodeURIComponent(countryParam)}&perPage=200`, paystackHeaders);
            const banks = banksResp.data?.data || [];
            const match = banks.find(b => String(b.code).toLowerCase() === String(bank_code || '').toLowerCase())
              || banks.find(b => String(bank_name || '').toLowerCase().includes(String(b.name || '').toLowerCase().slice(0, 5)));
            if (match) resolvedBankCode = match.code;
          } catch (_) { /* use provided code */ }

          // Try Paystack Subaccount (for split payments — best option)
          try {
            const subResp = await axios.post('https://api.paystack.co/subaccount', {
              business_name,
              settlement_bank: resolvedBankCode,
              account_number,
              percentage_charge: 100,
              currency,
            }, paystackHeaders);
            if (subResp.data?.status && subResp.data?.data?.subaccount_code) {
              subaccountCode = subResp.data.data.subaccount_code;
            }
          } catch (_) { /* fall through to Transfer Recipient */ }

          // Fallback: Transfer Recipient (for payout-only, not split payments)
          if (!subaccountCode) {
            try {
              const rcpResp = await axios.post('https://api.paystack.co/transferrecipient', {
                type: 'ghipss',
                name: business_name,
                account_number,
                bank_code: resolvedBankCode,
                currency,
              }, paystackHeaders);
              if (rcpResp.data?.status && rcpResp.data?.data?.recipient_code) {
                subaccountCode = rcpResp.data.data.recipient_code;
              }
            } catch (_) { /* fall through to local */ }
          }
        }

        // Final fallback: local code
        if (!subaccountCode) {
          subaccountCode = `LOCAL_bank_${orgId}_${Date.now()}`;
        }

        await db.query(
          `INSERT INTO paystack_subaccounts
            (organization_id, account_type, business_name, account_number, bank_code, bank_name, subaccount_code, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [orgId, 'bank', business_name, account_number, resolvedBankCode, bank_name, subaccountCode, isPrimary]
        );
        return res.json({ success: true, message: "Bank account saved.", subaccount_code: subaccountCode });
      }

      if (account_type === "mobile_money") {
        let subaccountCode = null;

        if (paystackHeaders) {
          // Map provider to Paystack bank_code
          const prov = String(momo_provider || '').toLowerCase();
          let provCode = 'MTN';
          if (prov.includes('vod')) provCode = 'VODAFONE';
          else if (prov.includes('airtel') || prov.includes('tigo')) provCode = 'AIRTEL_TIGO';
          else if (prov.includes('orange')) provCode = 'ORANGE';

          try {
            const rcpResp = await axios.post('https://api.paystack.co/transferrecipient', {
              type: 'mobile_money',
              name: account_holder_name || business_name,
              account_number: momo_number,
              bank_code: provCode,
              currency,
            }, paystackHeaders);
            if (rcpResp.data?.status && rcpResp.data?.data?.recipient_code) {
              subaccountCode = rcpResp.data.data.recipient_code;
            }
          } catch (_) { /* fall through to local */ }
        }

        if (!subaccountCode) {
          subaccountCode = `LOCAL_momo_${orgId}_${Date.now()}`;
        }

        await db.query(
          `INSERT INTO paystack_subaccounts
            (organization_id, account_type, business_name, momo_number, momo_provider, account_holder_name, subaccount_code, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [orgId, 'mobile_money', business_name, momo_number, momo_provider, account_holder_name || '', subaccountCode, isPrimary]
        );
        return res.json({ success: true, message: "Mobile Money account saved.", subaccount_code: subaccountCode });
      }

      return res.status(400).json({ success: false, message: `Account type "${account_type}" is not supported.` });
    } catch (error) {
      console.error('[addPaystackSubaccountPost]', error.response?.data || error.message);
      return res.status(500).json({ success: false, message: error.response?.data?.message || error.message || 'Failed to save account.' });
    }
  },

  deletePaystackSubaccount: async (req, res) => {
    try {
      const { id } = req.params;
      const orgId = req.session.organizationId;

      if (!orgId) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
      }

      const result = await db.query(
        `DELETE FROM paystack_subaccounts WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Account not found." });
      }

      res.json({ success: true });
    } catch (err) {
            res.status(500).json({ success: false, message: "Delete failed." });
    }
  },

  getPaystackSubaccountById: async (req, res) => {
    try {
      const { id } = req.params;
      const orgId = req.session.organizationId;

      if (!orgId) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
      }

      const result = await db.query(
        `SELECT id, organization_id, account_type, business_name, 

                account_number, bank_code, bank_name, 

                momo_number, momo_provider, account_holder_name,

                subaccount_code, is_primary, created_at

         FROM paystack_subaccounts

         WHERE id = $1 AND organization_id = $2`,

        [id, orgId]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Account not found." });
      }

      res.json({ success: true, account: result.rows[0] });
    } catch (err) {
            res.status(500).json({ success: false, message: "Fetch failed." });
    }
  },

  updatePaystackSubaccount: async (req, res) => {
    try {
      const id = req.params.id || req.body.id;
      const {
        business_name,

        account_type,

        // Bank fields

        account_number,

        bank_code,

        bank_name,

        // Mobile money fields

        momo_number,

        momo_provider,
        account_holder_name,
      } = req.body;

      const orgId = req.session.organizationId;

      // Validate required fields based on account type
      if (account_type === "bank") {
        if (!business_name || !account_number || !bank_code || !bank_name) {
          return res.status(400).json({
            success: false,
            message:
              "Business name, account number, bank code, and bank name are required for bank accounts.",
          });
        }
      } else if (account_type === "mobile_money") {
        if (
          !business_name ||
          !momo_number ||
          !momo_provider ||
          !account_holder_name
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Business name, mobile money number, provider, and account holder name are required for mobile money accounts.",
          });
        }
      }

      // First check if account exists

      const existingAccount = await db.query(
        "SELECT id, subaccount_code FROM paystack_subaccounts WHERE id = $1 AND organization_id = $2",
        [id, orgId]
      );

      if (existingAccount.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Account not found." });
      }

      const subaccountCode = existingAccount.rows[0].subaccount_code;
      let updateSuccess = false; // We no longer update Paystack here; create a new recipient instead if bank details change

      // Update local database

      const updateQuery = `

        UPDATE paystack_subaccounts 

        SET business_name = $1,

            account_type = $2,

            account_number = $3,

            bank_code = $4,

            bank_name = $5,

            momo_number = $6,

            momo_provider = $7,

            account_holder_name = $8,

            updated_at = CURRENT_TIMESTAMP

        WHERE id = $9 AND organization_id = $10

        RETURNING *

      `;

      const result = await db.query(updateQuery, [
        business_name,

        account_type,
        account_type === "bank" ? account_number : null,
        account_type === "bank" ? bank_code : null,
        account_type === "bank" ? bank_name : null,
        account_type === "mobile_money" ? momo_number : null,
        account_type === "mobile_money" ? momo_provider : null,
        account_type === "mobile_money" ? account_holder_name : null,
        id,
        orgId,
      ]);

            res.json({
        success: true,

        message: "Account updated successfully.",

        account: result.rows[0],
        paystack_updated: updateSuccess,
      });
    } catch (err) {
            res.status(500).json({ success: false, message: "Update failed." });
    }
  },

  setPaystackSubaccountPrimary: async (req, res) => {
    try {
      const { id, account_type } = req.body;

      const orgId = req.session.organizationId;

      // Set all accounts of this type to non-primary

      await db.query(
        `UPDATE paystack_subaccounts SET is_primary = FALSE

         WHERE organization_id = $1 AND account_type = $2`,

        [orgId, account_type]
      );

      // Set selected account as primary

      await db.query(
        `UPDATE paystack_subaccounts SET is_primary = TRUE

         WHERE id = $1 AND organization_id = $2`,

        [id, orgId]
      );

      res.json({ success: true });
    } catch (err) {
            res.status(500).json({ success: false, message: "Update failed." });
    }
  },

  /**
   * POST /account/paystack/stripe-card
   * Saves a Stripe PaymentMethod (from a completed SetupIntent) as a
   * paystack_subaccounts row with account_type = 'stripe_card'.
   * The subaccount_code column stores the pm_xxx PaymentMethod ID.
   * account_number stores last4, bank_name stores the card brand.
   */
  saveStripeCardAsSubaccountPost: async (req, res) => {
    try {
      await ensureStripeSubaccountSchema(db);
      const orgId = req.session.organizationId;
      const setupIntentId = String(req.body?.setupIntentId || "").trim();
      const business_name = String(req.body?.business_name || "").trim();

      if (!orgId || !setupIntentId || !business_name) {
        return res.status(400).json({ success: false, message: "Missing required parameters." });
      }

      const orgResult = await db.query(
        `SELECT stripe_customer_id FROM organizations WHERE organization_id = $1`,
        [orgId]
      );
      const orgRow = orgResult.rows[0];
      if (!orgRow) {
        return res.status(404).json({ success: false, message: "Organization not found." });
      }

      const stripe = await getStripeClient(db);
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

      if (setupIntent.status !== "succeeded") {
        return res.status(400).json({
          success: false,
          message: setupIntent.last_setup_error?.message || "Stripe card setup is not complete.",
        });
      }

      if (!setupIntent.customer || String(setupIntent.customer) !== String(orgRow.stripe_customer_id)) {
        return res.status(400).json({
          success: false,
          message: "This setup attempt does not belong to this organization.",
        });
      }

      const paymentMethodId =
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;

      if (!paymentMethodId) {
        return res.status(400).json({ success: false, message: "Stripe did not return a saved card." });
      }

      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      const brand = pm.card?.brand || "card";
      const last4 = pm.card?.last4 || "";

      // Check for duplicates
      const dupCheck = await db.query(
        `SELECT id FROM paystack_subaccounts
         WHERE organization_id = $1 AND subaccount_code = $2`,
        [orgId, paymentMethodId]
      );
      if (dupCheck.rows.length > 0) {
        return res.json({ success: true, message: "Card already saved." });
      }

      // Determine whether this is the first account overall (make it primary)
      const countResult = await db.query(
        `SELECT COUNT(*) AS count FROM paystack_subaccounts
         WHERE organization_id = $1 AND is_primary = true`,
        [orgId]
      );
      const isPrimary = Number(countResult.rows[0].count) === 0;

      await db.query(
        `INSERT INTO paystack_subaccounts
           (organization_id, account_type, business_name, account_number, bank_name, subaccount_code, is_primary)
         VALUES ($1, 'stripe_card', $2, $3, $4, $5, $6)`,
        [orgId, business_name, last4, brand, paymentMethodId, isPrimary]
      );

      return res.json({ success: true, message: "Stripe card saved as transaction account." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message || "Save failed." });
    }
  },

  /**
   * POST /account/paystack/stripe-bank-account
   * Tokenizes a bank account via Stripe (bank_account token from Stripe.js),
   * attaches it to the org's Stripe customer as a source, and saves to
   * paystack_subaccounts with account_type = 'bank', subaccount_code = ba_xxx.
   */
  saveStripeBankAccountAsSubaccountPost: async (req, res) => {
    try {
      await ensureStripeSubaccountSchema(db);
      const orgId = req.session.organizationId;
      const bankToken = String(req.body?.bankToken || "").trim();
      const business_name = String(req.body?.business_name || "").trim();
      const bank_name_input = String(req.body?.bank_name || "").trim();
      const bank_country = String(req.body?.bank_country || "US").trim().toUpperCase();

      if (!orgId || !bankToken || !business_name) {
        return res.status(400).json({ success: false, message: "Missing required parameters." });
      }

      const orgResult = await db.query(
        `SELECT stripe_customer_id, organization_name, email, organization_phone
         FROM organizations WHERE organization_id = $1`,
        [orgId]
      );
      const orgRow = orgResult.rows[0];
      if (!orgRow) {
        return res.status(404).json({ success: false, message: "Organization not found." });
      }

      const stripe = await getStripeClient(db);

      // Ensure Stripe customer exists
      let customerId = orgRow.stripe_customer_id || null;
      if (customerId) {
        try {
          const existing = await stripe.customers.retrieve(customerId);
          if (!existing || existing.deleted) customerId = null;
        } catch (e) {
          if (e.code === "resource_missing") customerId = null;
          else throw e;
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: orgRow.email || undefined,
          name: orgRow.organization_name || undefined,
          phone: orgRow.organization_phone || undefined,
          metadata: { organization_id: String(orgId) },
        });
        customerId = customer.id;
        await db.query(
          `UPDATE organizations SET stripe_customer_id = $2, updated_at = NOW() WHERE organization_id = $1`,
          [orgId, customerId]
        );
      }

      // Attach bank account token to Stripe customer
      const bankSource = await stripe.customers.createSource(customerId, { source: bankToken });

      const last4 = bankSource.last4 || "";
      const resolvedBankName = bank_name_input || bankSource.bank_name || "Bank";
      const sourceId = bankSource.id; // ba_xxx

      // Dedup check
      const dupCheck = await db.query(
        `SELECT id FROM paystack_subaccounts WHERE organization_id = $1 AND subaccount_code = $2`,
        [orgId, sourceId]
      );
      if (dupCheck.rows.length > 0) {
        return res.json({ success: true, message: "Bank account already saved." });
      }

      // Make primary if no primary exists yet
      const countResult = await db.query(
        `SELECT COUNT(*) AS count FROM paystack_subaccounts WHERE organization_id = $1 AND is_primary = true`,
        [orgId]
      );
      const isPrimary = Number(countResult.rows[0].count) === 0;

      await db.query(
        `INSERT INTO paystack_subaccounts
           (organization_id, account_type, business_name, account_number, bank_code, bank_name, subaccount_code, is_primary)
         VALUES ($1, 'bank', $2, $3, $4, $5, $6, $7)`,
        [orgId, business_name, last4, bank_country, resolvedBankName, sourceId, isPrimary]
      );

      return res.json({ success: true, message: "Bank account saved via Stripe." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message || "Save failed." });
    }
  },

  // ───────────────────────────────────────────────────────────────────────
  // STRIPE CONNECT ONBOARDING
  // Schools connect their Stripe account so registration payments flow to them.
  // Flow: school clicks “Connect with Stripe” → we create an Express account (once),
  //       generate an Account Link, redirect to Stripe’s hosted onboarding, then
  //       Stripe redirects back to /account/stripe-connect/return when done.
  // ───────────────────────────────────────────────────────────────────────

  stripeConnectOnboardGet: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect('/account/login');

    try {
      const stripeSettings = await getStripeSettings(db);
      const stripe = await getStripePlatformClient(db);
      const mode = stripeSettings.mode;
      const BASE_URL = getStripeConnectBaseUrl(req, mode);
      const activeConnectColumn = getStripeConnectAccountColumn(mode);

      await ensureStripeConnectAccountSchema(db);

      // Fetch current connected account id (if any)
      const orgRow = await db.query(
        `SELECT stripe_connect_account_id, stripe_connect_account_id_test, stripe_connect_account_id_live, organization_name, email
           FROM organizations WHERE organization_id = $1`,
        [orgId]
      ).then(r => r.rows[0] || {});

      const legacyConnectAccountId = String(orgRow.stripe_connect_account_id || '').trim() || null;
      const scopedConnectAccountId = String(orgRow[activeConnectColumn] || '').trim() || null;
      let connectAccountId = getStripeConnectAccountId(orgRow, mode) || null;

      if (connectAccountId) {
        try {
          await stripe.accounts.retrieve(connectAccountId);
        } catch (error) {
          if (!isMissingStripeConnectAccountError(error)) {
            throw error;
          }
          if (!scopedConnectAccountId && legacyConnectAccountId === connectAccountId) {
            await preserveStripeConnectAccountForOtherMode(orgId, legacyConnectAccountId, db, mode);
          }
          connectAccountId = null;
        }
      }

      // If not yet created, create a Stripe Express account for this school
      if (!connectAccountId) {
        const account = await stripe.accounts.create({
          type:         'express',
          email:        orgRow.email       || undefined,
          business_profile: {
            name:       orgRow.organization_name || undefined,
          },
          metadata: { organization_id: String(orgId) },
        });
        connectAccountId = account.id;
        await saveOrganizationStripeConnectAccountId(orgId, connectAccountId, db, mode);
      }

      // Create a one-time Account Link for onboarding
      const link = await stripe.accountLinks.create({
        account:     connectAccountId,
        refresh_url: `${BASE_URL}/account/stripe-connect/refresh`,
        return_url:  `${BASE_URL}/account/stripe-connect/return`,
        type:        'account_onboarding',
      });

      return res.redirect(link.url);
    } catch (err) {
      console.error('[StripeConnect] Onboard error:', err.message);
      req.flash('error', getStripeConnectOnboardingErrorMessage(err));
      return res.redirect('/account/settings?section=billing');
    }
  },

  // Stripe redirects here after the school finishes onboarding
  stripeConnectReturnGet: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect('/account/login');

    try {
      const stripeSettings = await getStripeSettings(db);
      const stripe = await getStripePlatformClient(db);
      await ensureStripeConnectAccountSchema(db);
      const orgRow = await db.query(
        `SELECT stripe_connect_account_id, stripe_connect_account_id_test, stripe_connect_account_id_live FROM organizations WHERE organization_id = $1`,
        [orgId]
      ).then(r => r.rows[0] || {});

      const connectAccountId = getStripeConnectAccountId(orgRow, stripeSettings.mode) || null;
      let isComplete = false;

      if (connectAccountId) {
        const account = await stripe.accounts.retrieve(connectAccountId).catch(() => null);
        isComplete = Boolean(account?.charges_enabled);
      }

      if (isComplete) {
        req.flash('success', 'Your Stripe account is connected! Payments from parents will now be sent to your school.');
      } else {
        req.flash('info', 'Almost there — Stripe may still need a few more details from you. You can complete setup from the Payout Accounts tab anytime.');
      }
      return res.redirect('/account/settings?section=billing&tab=payout');
    } catch (err) {
      console.error('[StripeConnect] Return error:', err.message);
      req.flash('info', 'Stripe onboarding step completed. Check your Payout Accounts tab.');
      return res.redirect('/account/settings?section=billing&tab=payout');
    }
  },

  // Stripe redirects here if the Account Link expired before the school finished
  stripeConnectRefreshGet: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect('/account/login');
    // Just restart onboarding — creates a fresh Account Link
    return res.redirect('/account/stripe-connect/onboard');
  },

  googleClassroomActivationPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      await ensureGoogleIntegrationSchema(db);
      const shouldActivate = String(req.body.activate || "").trim() === "1";

      const integrationPassword = String(
        req.body.integrationPassword || req.body.deactivationPassword || ""
      );
      if (!integrationPassword.trim()) {
        req.flash(
          "error",
          shouldActivate
            ? "Enter your password to activate Google Classroom integration."
            : "Enter your password to deactivate Google Classroom integration."
        );
        return res.redirect("/account/settings?section=integrations");
      }

      const isPasswordValid = await verifySessionPassword(integrationPassword, req);
      if (!isPasswordValid) {
        req.flash(
          "error",
          shouldActivate
            ? "Incorrect password. Google Classroom integration was not activated."
            : "Incorrect password. Google Classroom integration was not deactivated."
        );
        return res.redirect("/account/settings?section=integrations");
      }

      await setGoogleIntegrationActivation(db, orgId, shouldActivate);

      if (shouldActivate) {
        req.flash("success", "Google Classroom integration is now activated. Connect your Google account to finish setup.");
      } else {
        const actorId = req.session.user?.user_id || req.session.userId || orgId;
        const actorName =
          `${req.session.firstName || req.session.user?.first_name || ""} ${req.session.lastName || req.session.user?.last_name || ""}`.trim() ||
          req.session.email ||
          req.session.user?.email ||
          "Unknown";
        const actorRole = req.session.userRole || req.session.accountType || req.session.user?.account_type || "User";

        logOrganizationActivity({
          organizationId: orgId,
          userId: actorId,
          userName: actorName,
          userRole: actorRole,
          actionType: "Google Classroom Deactivated",
          moduleName: "Integrations",
          pagePath: "/account/settings?section=integrations",
          recordType: "Integration",
          recordLabel: "Google Classroom",
          description: `${actorName} deactivated Google Classroom integration after password confirmation.`,
          changedFields: [{ field: "google_classroom_activated", oldValue: "true", newValue: "false" }],
          ipAddress: req.ip,
        }).catch(() => {});

        req.flash("success", "Google Classroom integration has been deactivated.");
      }
      return res.redirect("/account/settings?section=integrations");
    } catch (error) {
      req.flash("error", "Unable to update Google Classroom activation right now.");
      return res.redirect("/account/settings?section=integrations");
    }
  },

  whatsappActivationPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    const acceptsHeader = String(req.get("accept") || "").toLowerCase();
    const wantsJson =
      req.xhr ||
      acceptsHeader.includes("application/json") ||
      String(req.get("x-requested-with") || "").toLowerCase() === "xmlhttprequest";

    const respond = (statusCode, payload) => {
      if (wantsJson) {
        return res.status(statusCode).json(payload);
      }

      if (!payload.success && payload.message) {
        req.flash("error", payload.message);
      } else if (payload.success && payload.message) {
        req.flash("success", payload.message);
      }

      return res.redirect("/account/settings?section=integrations");
    };

    try {
      await ensureWhatsappIntegrationSchema(db);
      const shouldActivate = String(req.body.activate || "").trim() === "1";

      const integrationPassword = String(
        req.body.integrationPassword || req.body.deactivationPassword || ""
      );
      if (!integrationPassword.trim()) {
        return respond(400, {
          success: false,
          activated: !shouldActivate,
          message: shouldActivate
            ? "Enter your password to activate WhatsApp integration."
            : "Enter your password to deactivate WhatsApp integration.",
        });
      }

      const isPasswordValid = await verifySessionPassword(integrationPassword, req);
      if (!isPasswordValid) {
        return respond(401, {
          success: false,
          activated: !shouldActivate,
          message: shouldActivate
            ? "Incorrect password. WhatsApp integration was not activated."
            : "Incorrect password. WhatsApp integration was not deactivated.",
        });
      }

      await setWhatsappIntegrationActivation(db, orgId, shouldActivate);

      return respond(200, {
        success: true,
        activated: shouldActivate,
        message: shouldActivate
          ? "WhatsApp integration is now activated. Connect your WhatsApp Business account to finish setup."
          : "WhatsApp integration has been deactivated.",
      });
    } catch (error) {
      return respond(500, {
        success: false,
        message: "Unable to update WhatsApp activation right now.",
      });
    }
  },

  whatsappConnectPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    try {
      await ensureWhatsappIntegrationSchema(db);

      const integrationStatus = await getWhatsappIntegrationStatus(db, orgId);
      if (!integrationStatus.activated) {
        return res.status(400).json({
          success: false,
          message: "Activate WhatsApp integration before connecting an account.",
        });
      }

      const authCode = String(req.body.code || "").trim();
      const wabaId = String(req.body.wabaId || req.body.waba_id || "").trim();
      const phoneNumberId = String(req.body.phoneNumberId || req.body.phone_number_id || "").trim();
      const businessName = String(req.body.businessName || req.body.business_name || "").trim();
      const displayPhoneNumber = String(req.body.displayPhoneNumber || req.body.display_phone_number || "").trim();
      const timezone = String(req.body.timezone || "").trim();
      const registrationPin = String(req.body.registrationPin || req.body.pin || "").trim();

      if (!authCode) {
        return res.status(400).json({ success: false, message: "Meta authorization code is required." });
      }

      if (!wabaId || !phoneNumberId) {
        return res.status(400).json({
          success: false,
          message: "Missing WhatsApp business identifiers from Meta. Please try Connect WhatsApp again.",
        });
      }

      const tokenResult = await exchangeEmbeddedSignupCodeForToken(authCode);

      await registerPhoneNumberForCloudApi(tokenResult.accessToken, phoneNumberId, registrationPin || null);
      await subscribeAppToWaba(tokenResult.accessToken, wabaId);

      await saveWhatsappConnection(db, orgId, {
        wabaId,
        phoneNumberId,
        businessName,
        displayPhoneNumber,
        timezone,
        accessToken: tokenResult.accessToken,
        expiresIn: tokenResult.expiresIn,
      });

      const refreshedStatus = await getWhatsappIntegrationStatus(db, orgId);

      return res.json({
        success: true,
        message: "WhatsApp Business connected successfully.",
        integration: refreshedStatus,
      });
    } catch (error) {
      const reason = error?.response?.data?.error?.message || error?.message || "Unknown WhatsApp setup error.";
      await markWhatsappConnectionError(db, orgId, reason).catch(() => {});
      return res.status(500).json({
        success: false,
        message: `Unable to complete WhatsApp setup: ${reason}`,
      });
    }
  },

  whatsappDisconnectPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    const acceptsHeader = String(req.get("accept") || "").toLowerCase();
    const wantsJson =
      req.xhr ||
      acceptsHeader.includes("application/json") ||
      String(req.get("x-requested-with") || "").toLowerCase() === "xmlhttprequest";

    try {
      await disconnectWhatsappIntegration(db, orgId);
      if (wantsJson) {
        return res.json({ success: true, message: "WhatsApp disconnected." });
      }
      req.flash("success", "WhatsApp disconnected.");
      return res.redirect("/account/settings?section=integrations");
    } catch (error) {
      if (wantsJson) {
        return res.status(500).json({ success: false, message: "Unable to disconnect WhatsApp right now." });
      }
      req.flash("error", "Unable to disconnect WhatsApp right now.");
      return res.redirect("/account/settings?section=integrations");
    }
  },

  whatsappTestMessagePost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    try {
      await ensureWhatsappIntegrationSchema(db);
      const useServerTestCredentials =
        String(req.body.useServerTestCredentials || "").trim() === "1" ||
        req.body.useServerTestCredentials === true;

      let accessToken = "";
      let phoneNumberId = "";

      if (useServerTestCredentials) {
        accessToken =
          String(process.env.WHATSAPP_TEST_ACCESS_TOKEN || "").trim() || WHATSAPP_SERVER_TEST_DEFAULTS.accessToken;
        phoneNumberId =
          String(process.env.WHATSAPP_TEST_PHONE_NUMBER_ID || "").trim() || WHATSAPP_SERVER_TEST_DEFAULTS.phoneNumberId;

        if (!accessToken || !phoneNumberId) {
          return res.status(400).json({
            success: false,
            message: "Server test credentials are missing. Set WHATSAPP_TEST_ACCESS_TOKEN and WHATSAPP_TEST_PHONE_NUMBER_ID.",
          });
        }
      } else {
        const integrationStatus = await getWhatsappIntegrationStatus(db, orgId);
        if (!integrationStatus.activated || !integrationStatus.connected) {
          return res.status(400).json({
            success: false,
            message: "Activate and connect WhatsApp before sending a test template.",
          });
        }

        const credentials = await getWhatsappMessagingCredentials(db, orgId);
        if (!credentials.configured || !credentials.phoneNumberId || !credentials.accessToken) {
          return res.status(400).json({
            success: false,
            message: "WhatsApp access credentials are incomplete. Reconnect WhatsApp and try again.",
          });
        }

        if (
          credentials.tokenExpiresAt &&
          Number(new Date(credentials.tokenExpiresAt).getTime()) > 0 &&
          Number(new Date(credentials.tokenExpiresAt).getTime()) <= Date.now()
        ) {
          return res.status(400).json({
            success: false,
            message: "The stored WhatsApp access token has expired. Reconnect WhatsApp to refresh it, then send the template again.",
          });
        }

        accessToken = credentials.accessToken;
        phoneNumberId = credentials.phoneNumberId;
      }

      const recipient = normalizePhoneDigits(req.body.recipient || req.body.to || "");
      const templateName = String(req.body.templateName || "").trim();
      const languageCode = String(req.body.languageCode || "en_US").trim() || "en_US";
      const rawBodyParameters = req.body.bodyParameters;
      const bodyParameters = Array.isArray(rawBodyParameters)
        ? rawBodyParameters
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        : [
            req.body.bodyParameter,
            req.body.bodyText,
            req.body.bodyParameter1,
            req.body.bodyParameter2,
            req.body.bodyParameter3,
          ]
            .map((value) => String(value || "").trim())
            .filter(Boolean);

      if (!recipient) {
        return res.status(400).json({ success: false, message: "Enter the recipient number in international format digits only." });
      }

      if (!templateName) {
        return res.status(400).json({ success: false, message: "Enter the approved WhatsApp template name to send." });
      }

      const sendResult = await sendWhatsappTemplateMessage(
        accessToken,
        phoneNumberId,
        {
          to: recipient,
          templateName,
          languageCode,
          bodyParameters,
        }
      );

      return res.json({
        success: true,
        message: "Template sent. Capture the WhatsApp delivery and the returned message ID for App Review.",
        recipient,
        messageId: sendResult?.messages?.[0]?.id || "",
        raw: sendResult,
      });
    } catch (error) {
      const apiMessage = error?.response?.data?.error?.message || "";
      const apiCode = error?.response?.data?.error?.code;
      const fallbackMessage = error?.message || "Unable to send the WhatsApp template right now.";
      const resolvedMessage = apiCode === 131030
        ? "This recipient is not an approved WhatsApp test number yet. In Meta API Setup, open the recipient list, add the number, and complete verification in WhatsApp before sending again."
        : (apiMessage || fallbackMessage);

      await markWhatsappConnectionError(db, orgId, resolvedMessage).catch(() => {});

      return res.status(500).json({
        success: false,
        message: resolvedMessage,
        errorCode: apiCode || null,
      });
    }
  },

  studentPortalActivationPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    const acceptsHeader = String(req.get("accept") || "").toLowerCase();
    const wantsJson =
      req.xhr ||
      acceptsHeader.includes("application/json") ||
      String(req.get("x-requested-with") || "").toLowerCase() === "xmlhttprequest";

    const respond = (statusCode, payload) => {
      if (wantsJson) {
        return res.status(statusCode).json(payload);
      }

      if (!payload.success && payload.message) {
        req.flash("error", payload.message);
      } else if (payload.success && payload.message) {
        req.flash("success", payload.message);
      }

      return res.redirect("/account/settings?section=integrations");
    };

    try {
      await ensureStudentPortalSchema(db);
      const shouldActivate = String(req.body.activate || "").trim() === "1";

      const integrationPassword = String(
        req.body.integrationPassword || req.body.deactivationPassword || ""
      );
      if (!integrationPassword.trim()) {
        return respond(400, {
          success: false,
          activated: !shouldActivate,
          message: shouldActivate
            ? "Enter your password to activate Student Portal integration."
            : "Enter your password to deactivate Student Portal integration.",
        });
      }

      const isPasswordValid = await verifySessionPassword(integrationPassword, req);
      if (!isPasswordValid) {
        return respond(401, {
          success: false,
          activated: !shouldActivate,
          message: shouldActivate
            ? "Incorrect password. Student Portal integration was not activated."
            : "Incorrect password. Student Portal integration was not deactivated.",
        });
      }

      await setStudentPortalActivation(db, orgId, shouldActivate);

      return respond(200, {
        success: true,
        activated: shouldActivate,
        message: shouldActivate
          ? "Student Portal integration is now activated."
          : "Student Portal integration has been deactivated.",
      });
    } catch (error) {
      return respond(500, {
        success: false,
        message: "Unable to update Student Portal activation right now.",
      });
    }
  },

  googleClassroomConnectGet: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      if (!hasGoogleOauthConfig()) {
        req.flash("error", "Google OAuth is not configured on this server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
        return res.redirect("/account/settings?section=integrations");
      }

      const integrationStatus = await getGoogleIntegrationStatus(db, orgId);
      if (!integrationStatus.activated) {
        req.flash("error", "Activate Google Classroom integration before connecting an account.");
        return res.redirect("/account/settings?section=integrations");
      }

      const oauthClient = buildGoogleOauthClient(req);
      const state = createOauthState({
        organizationId: Number(orgId),
        redirectTo: "/account/settings?section=integrations",
      });
      req.session.googleOauthState = state;

      const authUrl = oauthClient.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: GOOGLE_CLASSROOM_SCOPES,
        state,
      });

      return res.redirect(authUrl);
    } catch (error) {
      req.flash("error", "Unable to start Google Classroom connection.");
      return res.redirect("/account/settings?section=integrations");
    }
  },

  googleClassroomCallbackGet: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      const expectedState = req.session.googleOauthState || null;
      const stateFromQuery = String(req.query.state || "").trim();
      if (!expectedState || !stateFromQuery || expectedState !== stateFromQuery) {
        req.flash("error", "Google authorization state mismatch. Please try connecting again.");
        return res.redirect("/account/settings?section=integrations");
      }

      const parsedState = parseOauthState(stateFromQuery);
      if (!parsedState || Number(parsedState.organizationId) !== Number(orgId)) {
        req.flash("error", "Google authorization could not be validated for this organization.");
        return res.redirect("/account/settings?section=integrations");
      }

      const authCode = String(req.query.code || "").trim();
      if (!authCode) {
        req.flash("error", "Google did not return an authorization code.");
        return res.redirect("/account/settings?section=integrations");
      }

      const oauthClient = buildGoogleOauthClient(req);
      const tokenResponse = await oauthClient.getToken(authCode);
      oauthClient.setCredentials(tokenResponse.tokens || {});

      let clientEmail = "";
      let resolvedScopes = [];
      try {
        const oauth2Api = google.oauth2({ version: "v2", auth: oauthClient });
        const profile = await oauth2Api.userinfo.get();
        clientEmail = String(profile.data?.email || "").trim();
      } catch (_) {
        clientEmail = "";
      }

      try {
        const tokenInfo = await oauthClient.getTokenInfo(tokenResponse.tokens.access_token);
        resolvedScopes = Array.isArray(tokenInfo.scopes) ? tokenInfo.scopes : [];
      } catch (_) {
        resolvedScopes = GOOGLE_CLASSROOM_SCOPES;
      }

      await storeGoogleOauthTokens(db, orgId, {
        clientEmail,
        scopes: resolvedScopes,
        accessToken: tokenResponse.tokens.access_token || null,
        refreshToken: tokenResponse.tokens.refresh_token || null,
        expiryDate: tokenResponse.tokens.expiry_date ? new Date(tokenResponse.tokens.expiry_date) : null,
      });

      req.session.googleOauthState = null;
      req.flash("success", "Google Classroom connected successfully.");
      return res.redirect("/account/settings?section=integrations");
    } catch (error) {
      req.flash("error", "Google Classroom connection failed. Please try again.");
      return res.redirect("/account/settings?section=integrations");
    }
  },

  googleClassroomResyncPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");
    const wantsJson = String(req.get("accept") || "").includes("application/json");

    try {
      const integrationStatus = await getGoogleIntegrationStatus(db, orgId);
      if (!integrationStatus.shouldShowFeatures) {
        if (wantsJson) {
          return res.status(400).json({ success: false, error: "Google Classroom is not fully activated and connected yet." });
        }
        req.flash("error", "Google Classroom is not fully activated and connected yet.");
        return res.redirect("/account/settings?section=integrations");
      }

      await markGoogleSync(
        db,
        orgId,
        "queued",
        "Manual sync queued. Course and roster reconciliation will run in the background."
      );

      try {
        await syncGoogleClassroomForOrganization(orgId, { dbClient: db });
        await pushPendingAssessmentsForOrganization(orgId, { dbClient: db, limit: 500, includeExisting: true });
      } catch (_) {
      }

      if (wantsJson) {
        return res.json({ success: true, message: "Google Classroom sync queued successfully." });
      }
      req.flash("success", "Google Classroom sync queued successfully.");
      return res.redirect("/account/settings?section=integrations");
    } catch (error) {
      if (wantsJson) {
        return res.status(500).json({ success: false, error: "Unable to queue Google Classroom sync right now." });
      }
      req.flash("error", "Unable to queue Google Classroom sync right now.");
      return res.redirect("/account/settings?section=integrations");
    }
  },

  googleClassroomDisconnectPost: async (req, res) => {
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      await disconnectGoogleIntegration(db, orgId);
      req.flash("success", "Google Classroom disconnected.");
      return res.redirect("/account/settings?section=integrations");
    } catch (error) {
      req.flash("error", "Unable to disconnect Google Classroom right now.");
      return res.redirect("/account/settings?section=integrations");
    }
  },

  // GET - Display hub invitation acceptance page
  hubInvitationAcceptGet: async (req, res) => {
    try {
      const { token } = req.params;

      // Validate token
      const invitationResult = await db.query(
        `SELECT hoi.*, mh.hub_name, mh.hub_nickname, mh.hub_email, mh.plan_id, p.plan_name
         FROM hub_organization_invitations hoi
         JOIN managira_hubs mh ON hoi.hub_id = mh.hub_id
         LEFT JOIN plans p ON mh.plan_id = p.id
         WHERE hoi.invitation_token = $1 AND hoi.status = 'pending'`,
        [token]
      );

      if (invitationResult.rows.length === 0) {
        req.flash('error', 'Invalid or expired invitation link.');
        return res.redirect('/account/login');
      }

      const invitation = invitationResult.rows[0];

      // Check if invitation has expired
      if (new Date(invitation.expires_at) < new Date()) {
        req.flash('error', 'This invitation has expired. Please contact the hub for a new invitation.');
        return res.redirect('/account/login');
      }

      res.render('account/hubInvitation', {
        title: 'Accept Hub Invitation',
        invitation,
        token,
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'An error occurred while loading the invitation.');
      res.redirect('/account/login');
    }
  },

  // POST - Process hub invitation acceptance
  hubInvitationAcceptPost: async (req, res) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
            const { token } = req.params;
            
      const {
        organization_nickname,
        admin_email,
        admin_password,
        admin_first_name,
        admin_last_name,
        admin_phone,
        accept_terms
      } = req.body;

            // Validate required fields
      if (!organization_nickname || !admin_email || !admin_password || !admin_first_name || !admin_last_name) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

      if (!accept_terms) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'You must accept the terms and conditions.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

            // Get invitation details
            const invitationResult = await client.query(
        `SELECT hoi.*, mh.hub_name, mh.hub_nickname, mh.hub_email, mh.hub_id, mh.plan_id
         FROM hub_organization_invitations hoi
         JOIN managira_hubs mh ON hoi.hub_id = mh.hub_id
         WHERE hoi.invitation_token = $1 AND hoi.status = 'pending'`,
        [token]
      );

      if (invitationResult.rows.length === 0) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'Invalid or expired invitation.');
        return res.redirect('/account/login');
      }

      const invitation = invitationResult.rows[0];
      
      // Check expiration
      if (new Date(invitation.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'This invitation has expired.');
        return res.redirect('/account/login');
      }

      // Check if nickname is available — derive the slug from the free-text
      // nickname the user typed in the invitation acceptance form.
      const derivedHubMemberNickname = deriveOrgNickname(organization_nickname);
      if (!derivedHubMemberNickname.ok) {
        await client.query('ROLLBACK');
        client.release();
        req.flash('error', derivedHubMemberNickname.error);
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }
      const hubMemberSlug = derivedHubMemberNickname.slug;
      const hubMemberDisplay = derivedHubMemberNickname.display;

      const nicknameCheck = await client.query(
        'SELECT organization_id FROM organizations WHERE nickname = $1',
        [hubMemberSlug]
      );

      if (nicknameCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'This subdomain is already taken. Please choose another.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

            // Check if admin email exists
            const emailCheck = await client.query(
        'SELECT user_id FROM users WHERE email = $1',
        [admin_email]
      );

      if (emailCheck.rows.length > 0) {
                await client.query('ROLLBACK');
        client.release();
        req.flash('error', 'This email is already registered. Please use a different email.');
        return res.redirect(`/account/accept-hub-invitation/${token}`);
      }

            // Hash password
            const hashedPassword = await bcrypt.hash(admin_password, 10);
            // Create organization with proper password and fields
            const orgParams = [
        invitation.organization_name,
        hubMemberSlug,
        hubMemberDisplay,
        admin_email,
        admin_first_name,
        admin_last_name,
        admin_phone || '',
        invitation.hub_id,
        invitation.plan_id,
        hashedPassword
      ];
            const orgResult = await client.query(
        `INSERT INTO organizations 
         (organization_name, nickname, nickname_display, email, first_name, last_name, 
          organization_phone, organization_address, hub_id, is_hub_member, joined_hub_at, plan_id, created_at, 
          approved, password, proof_of_existence_1, proof_of_existence_2)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '', $8, true, CURRENT_TIMESTAMP, $9, CURRENT_TIMESTAMP, true, $10, '', '')
         RETURNING organization_id`,
        orgParams
      );

      const organizationId = orgResult.rows[0].organization_id;
      invalidateAdminOrganizationsCache();
            // Create admin user
            const userParams = [organizationId, admin_email, admin_first_name, admin_last_name, admin_phone || '', hashedPassword];
            await client.query(
        `INSERT INTO users 
         (organization_id, email, first_name, last_name, phone, password, role, isActive, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, CURRENT_TIMESTAMP)`,
        userParams
      );

            // Update invitation status
            await client.query(
        `UPDATE hub_organization_invitations 
         SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
         WHERE invitation_id = $1`,
        [invitation.invitation_id]
      );
            // Log hub activity
            await client.query(
        `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
         VALUES ($1, 'invitation_accepted', $2, $3, $4, $5)`,
        [
          invitation.hub_id,
          organizationId,
          `Organization ${invitation.organization_name} accepted invitation`,
          admin_email,
          req.ip
        ]
      );
                  // Send welcome email to organization admin
      const welcomeEmailHtml = renderCleanEmail({
        title: 'Welcome to Managira SMS',
        greeting: `Dear ${admin_first_name},`,
        intro: `Your organization ${invitation.organization_name} has successfully joined the ${invitation.hub_name} hub.`,
        message: 'You can now log in and start using your dashboard.',
        actionUrl: `${process.env.APP_URL || 'http://localhost:4000'}/account/login`,
        actionText: 'Go to Dashboard',
        details: [
          `Organization: ${invitation.organization_name}`,
          `Subdomain: ${hubMemberSlug}.${invitation.hub_nickname}.managira.com`,
          `Admin Email: ${admin_email}`,
          `Hub: ${invitation.hub_name}`,
        ],
        note: `If you have questions, contact your hub administrator at ${invitation.hub_email}.`,
        closing: 'Welcome aboard!',
      });

      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.ADMIN_NOTIFY_EMAIL_USER,
          pass: process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
        },
      };

      sendEmailInBackground({
        to: admin_email,
        subject: `Your ${invitation.hub_name} Hub account is ready`,
        html: welcomeEmailHtml,
      }, 'HubWelcomeEmail');

      // Notify hub
      const hubNotificationHtml = renderCleanEmail({
        title: 'New Organization Joined',
        greeting: 'Good news,',
        intro: `${invitation.organization_name} has accepted your invitation and joined your hub.`,
        details: [
          `Name: ${invitation.organization_name}`,
          `Subdomain: ${hubMemberSlug}.${invitation.hub_nickname}.managira.com`,
          `Admin: ${admin_first_name} ${admin_last_name}`,
          `Email: ${admin_email}`,
          `Joined: ${new Date().toLocaleDateString()}`,
        ],
        closing: 'You can now manage this organization from your hub dashboard.',
      });

      sendEmailInBackground({
        to: invitation.hub_email,
        subject: `${invitation.organization_name} Joined Your Hub`,
        html: hubNotificationHtml,
      }, 'HubJoinNotification');

                  
      await client.query('COMMIT');
      client.release();
      
            req.flash('success', `Welcome! Your organization has been set up successfully. Please log in with your credentials.`);
      res.redirect('/account/login');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      
                                                      
      // More specific error messages
      let errorMessage = 'An error occurred while processing your invitation.';
      if (error.code === '23505') { // PostgreSQL unique violation
                if (error.constraint && error.constraint.includes('nickname')) {
          errorMessage = 'This subdomain is already taken. Please choose another.';
                  } else if (error.constraint && error.constraint.includes('email')) {
          errorMessage = 'This email is already registered. Please use a different email.';
                  }
      }
      
      req.flash('error', errorMessage);
      return res.redirect(`/account/accept-hub-invitation/${req.params.token}`);
    }
  },

  // POST - Request detachment from hub
  requestHubDetachmentPost: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { reason } = req.body;

                        if (!reason || reason.trim().length < 10) {
        req.flash('error', 'Please provide a detailed reason for detachment (at least 10 characters).');
        return res.redirect('/account/update');
      }

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/account/update');
      }

      const organization = orgResult.rows[0];

      if (!organization.hub_id || !organization.is_hub_member) {
        req.flash('error', 'Your organization is not part of a hub.');
        return res.redirect('/account/update');
      }

            // Check for existing pending request
      const existingRequest = await db.query(
        `SELECT * FROM hub_detachment_requests 
         WHERE organization_id = $1 AND status = 'pending'`,
        [organizationId]
      );

      if (existingRequest.rows.length > 0) {
                req.flash('warning', 'You already have a pending detachment request. Please wait for hub review.');
        return res.redirect('/account/update');
      }

      // Create detachment request
      await db.query(
        `INSERT INTO hub_detachment_requests 
         (organization_id, hub_id, reason, requested_by)
         VALUES ($1, $2, $3, $4)`,
        [organizationId, organization.hub_id, reason, req.session.email]
      );

            // Get hub details for notification
      const hubResult = await db.query(
        'SELECT * FROM managira_hubs WHERE hub_id = $1',
        [organization.hub_id]
      );

      if (hubResult.rows.length > 0) {
        const hub = hubResult.rows[0];

        const emailHtml = renderCleanEmail({
          title: "Detachment Request",
          greeting: `Dear <strong>${he.encode(hub.hub_name)} Administrator</strong>,`,
          paragraphs: [
            `<strong>${he.encode(organization.organization_name)}</strong> has requested to detach from your hub.`,
            "Please log in to your hub dashboard to review and approve/reject this request.",
          ],
          details: [
            { label: "Organization", value: he.encode(organization.organization_name) },
            { label: "Subdomain", value: `${he.encode(organization.nickname)}.${he.encode(hub.hub_nickname)}.managira.com` },
            { label: "Contact", value: he.encode(organization.email) },
            { label: "Requested by", value: he.encode(req.session.email || '') },
            { label: "Date", value: new Date().toLocaleDateString() },
            { label: "Reason", value: he.encode(reason) },
          ],
          cta: {
            text: "Review Request",
            url: `${process.env.APP_URL || 'http://localhost:4000'}/hub/dashboard`,
          },
        });

        await sendEmail({
          to: hub.hub_email,
          subject: `Detachment Request from ${organization.organization_name}`,
          html: emailHtml
        });

              }

      // Log activity
      await db.query(
        `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
         VALUES ($1, 'detachment_requested', $2, $3, $4, $5)`,
        [
          organization.hub_id,
          organizationId,
          `Detachment request from ${organization.organization_name}`,
          req.session.email,
          req.ip
        ]
      );

            req.flash('success', 'Your detachment request has been submitted. The hub will review your request and respond accordingly.');
      res.redirect('/account/update');
    } catch (error) {
            req.flash('error', 'Error submitting detachment request.');
      res.redirect('/account/update');
    }
  },

  // GET - Accept hub invitation for existing organization
  hubInvitationAcceptExistingGet: async (req, res) => {
    try {
      const { token } = req.params;

      // Find invitation
      const inviteResult = await db.query(
        `SELECT hi.*, h.hub_name, h.hub_nickname, h.hub_email
         FROM hub_organization_invitations hi
         JOIN managira_hubs h ON hi.hub_id = h.hub_id
         WHERE hi.invitation_token = $1 AND hi.status = 'pending' AND hi.expires_at > NOW()`,
        [token]
      );

      if (inviteResult.rows.length === 0) {
                req.flash('error', 'Invalid or expired invitation link.');
        return res.redirect('/account/login');
      }

      const invitation = inviteResult.rows[0];

            res.render('account/acceptHubInvitationExisting', {
        invitation,
        token,
        title: 'Accept Hub Invitation',
        req
      });
    } catch (error) {
            req.flash('error', 'Error loading invitation.');
      res.redirect('/account/login');
    }
  },

  // POST - Accept hub invitation for existing organization
  hubInvitationAcceptExistingPost: async (req, res) => {
    const client = await db.connect();
    
    try {
      const { token } = req.params;
      const { confirm } = req.body;

      if (confirm !== 'yes') {
        req.flash('error', 'You must confirm to accept the invitation.');
        return res.redirect(`/account/accept-hub-invitation-existing/${token}`);
      }

      await client.query('BEGIN');

      // Get invitation details
      const inviteResult = await client.query(
        `SELECT hi.*, h.hub_id, h.hub_name, h.hub_nickname, h.hub_email
         FROM hub_organization_invitations hi
         JOIN managira_hubs h ON hi.hub_id = h.hub_id
         WHERE hi.invitation_token = $1 AND hi.status = 'pending' AND hi.expires_at > NOW()`,
        [token]
      );

      if (inviteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        req.flash('error', 'Invalid or expired invitation.');
        return res.redirect('/account/login');
      }

      const invitation = inviteResult.rows[0];

            // Verify organization exists and is not in a hub
      const orgResult = await client.query(
        `SELECT * FROM organizations WHERE organization_id = $1 AND deleted = false`,
        [invitation.existing_org_id]
      );

      if (orgResult.rows.length === 0) {
        await client.query('ROLLBACK');
        req.flash('error', 'Organization not found.');
        return res.redirect('/account/login');
      }

      const organization = orgResult.rows[0];

      if (organization.is_hub_member && organization.hub_id) {
        await client.query('ROLLBACK');
        req.flash('error', 'This organization is already part of a hub.');
        return res.redirect('/account/login');
      }

            // Update organization to join hub
      await client.query(
        `UPDATE organizations 
         SET hub_id = $1, is_hub_member = true, joined_hub_at = CURRENT_TIMESTAMP
         WHERE organization_id = $2`,
        [invitation.hub_id, invitation.existing_org_id]
      );

            // Update invitation status
      await client.query(
        `UPDATE hub_organization_invitations 
         SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP 
         WHERE invitation_id = $1`,
        [invitation.invitation_id]
      );

            // Log activity
      await client.query(
        `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          invitation.hub_id,
          'organization_joined',
          invitation.existing_org_id,
          `${organization.organization_name} accepted invitation and joined hub`,
          organization.email,
          req.ip
        ]
      );

            await client.query('COMMIT');
      client.release();

            // Send confirmation emails
      const hubEmailHtml = renderCleanEmail({
        title: "Organization Joined Your Hub",
        greeting: `Good news, <strong>${he.encode(invitation.hub_name)} Team</strong>,`,
        paragraphs: [
          `<strong>${he.encode(organization.organization_name)}</strong> accepted your invitation and is now part of your hub.`,
        ],
        details: [
          { label: "Organization", value: he.encode(organization.organization_name) },
          { label: "Email", value: he.encode(organization.email) },
          { label: "Subdomain", value: `${he.encode(organization.nickname)}.${he.encode(invitation.hub_nickname)}.managira.com` },
        ],
      });

      const orgEmailHtml = renderCleanEmail({
        title: `Welcome to ${he.encode(invitation.hub_name)}`,
        greeting: `Dear <strong>${he.encode(organization.organization_name)} Team</strong>,`,
        paragraphs: [
          `Your organization is now part of <strong>${he.encode(invitation.hub_name)}</strong>.`,
          `You can continue using Managira as usual. For questions, contact ${he.encode(invitation.hub_name)} at ${he.encode(invitation.hub_email)}.`,
        ],
        details: [
          { label: "New Subdomain", value: `${he.encode(organization.nickname)}.${he.encode(invitation.hub_nickname)}.managira.com` },
          { label: "Subscription", value: `Managed by ${he.encode(invitation.hub_name)}` },
          { label: "Data", value: "All your data remains intact" },
        ],
      });

      // Send emails
      sendEmailInBackground({
        to: invitation.hub_email,
        subject: `${organization.organization_name} Joined Your Hub`,
        html: hubEmailHtml,
        attachments: [{
          filename: 'managira.png',
          path: path.join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo'
        }]
      }, 'HubJoinConfirmation');

      sendEmailInBackground({
        to: organization.email,
        subject: `Your ${invitation.hub_name} Hub access is ready`,
        html: orgEmailHtml,
        attachments: [{
          filename: 'managira.png',
          path: path.join(__dirname, '../public/images/managira.png'),
          cid: 'managira_logo'
        }]
      }, 'OrgWelcomeToHub');

      req.flash('success', `Successfully joined ${invitation.hub_name}! You can now log in with your existing credentials.`);
      res.redirect('/account/login');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
            req.flash('error', 'Error accepting invitation.');
      res.redirect('/account/login');
    }
  },
};

// ─── Unified Payout Destination (Stripe Connect + Paystack) ───────────────
const {
  resolveSchoolPayoutDestination,
  invalidatePayoutCache,
  fetchPaystackCountries,
} = require("../utils/payoutDestination");

accountController.getPayoutContextJson = async (req, res) => {
  const orgId = req.session.organizationId;
  if (!orgId) return res.status(401).json({ success: false });
  try {
    const [ctx, paystackCountries] = await Promise.all([
      resolveSchoolPayoutDestination(orgId, db, { fresh: true }),
      fetchPaystackCountries(),
    ]);
    return res.json({ success: true, payout: ctx, paystackCountries });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

accountController.updatePayoutPreferencePost = async (req, res) => {
  const orgId = req.session.organizationId;
  if (!orgId) return res.status(401).json({ success: false });
  const raw = String(req.body?.preference || "").trim().toLowerCase();
  const allowed = ["stripe", "paystack"];
  if (!allowed.includes(raw)) {
    return res.status(400).json({ success: false, message: "Select exactly one payout provider: Stripe or Paystack." });
  }
  try {
    const ctx = await resolveSchoolPayoutDestination(orgId, db, { fresh: true });
    if (raw === "stripe" && !ctx?.stripe?.available) {
      return res.status(400).json({ success: false, message: "Stripe is not ready for this school yet." });
    }
    if (raw === "paystack" && !ctx?.paystack?.available) {
      return res.status(400).json({ success: false, message: "Paystack is not ready for this school yet." });
    }

    await db.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payout_provider_pref VARCHAR(16)`
    );
    await db.query(
      `UPDATE organizations SET payout_provider_pref = $1 WHERE organization_id = $2`,
      [raw, orgId]
    );
    invalidatePayoutCache(orgId);
    const nextCtx = await resolveSchoolPayoutDestination(orgId, db, { fresh: true });
    return res.json({ success: true, payout: nextCtx });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

accountController.sendBrandedReceiptEmail = sendBrandedReceiptEmail;
accountController.sendRegistrationSuccessEmail = sendRegistrationSuccessEmail;
accountController.sendInvoiceEmail = sendInvoiceEmail;
accountController.sendCancellationEmail = sendCancellationEmail;

module.exports = accountController;













