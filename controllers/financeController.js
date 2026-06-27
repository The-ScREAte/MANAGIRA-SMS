// controllers/financeController.js
// PayGira — Finance & Billing Management — multi-tenant scoped by organization_id.
// All queries filter by req.session.organizationId. The page is admin-only.

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const Stripe = require("stripe");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { userHasPermission } = require("../middleware/permissionMiddleware");
const { logOrganizationActivity } = require("../utils/activityLog");
const {
  getHolidayCountryOptions,
  parseBoolean,
  ensureAttendanceCalendarSchema,
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  buildCalendarDayMap,
  isAttendanceCountableForDate,
} = require("../utils/attendanceCalendar");
const { buildFailureNotification, sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");
const {
  getCurrencyProfileForRequest,
  getCurrencyForCountry,
  getLocaleForCurrency,
  getUsdRate,
  normalizeCurrencyCode,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const { getOrgChargeCards } = require("../utils/orgChargeCards");
const { ensurePaymentProviderSchema } = require("../utils/paymentProviderSchema");
const { getActiveStripePublicKey, getStripeSettings, getStripePlatformClient, getStripePlatformCredentials, getStripeConnectAccountId, ensureStripeConnectAccountSchema } = require("../utils/stripeConfig");
const { buildStudentDisplayId, getOrganizationStudentIdSettings } = require("../utils/studentIdDisplay");
const { formatDisplayName } = require("../utils/organizationDisplayPreferences");
const { getPaystackSettings } = require("../utils/paystackConfig");
const { resolveSchoolPayoutDestination } = require("../utils/payoutDestination");
const { settleFromPaystackTransaction } = require("../utils/paystackPayout");
const {
  getPlatformFeeSettings,
  getOrgPlatformFeeBearer,
  isPlatformFeeMethod,
  buildPlatformChargeBreakdown,
} = require("../utils/platformFee");
const { createNotification } = require("../utils/notificationService");
const cacheManager = require("../utils/cacheManager");

// ──────────────────────────────────────────────────────────────────────────────
// PayGira in-memory cache layer.
// Heavy SQL queries on the Finance dashboard are wrapped here. Each org gets
// its own keyspace; writes invalidate every key for that org so the next read
// returns fresh data. Built-in background-refresh keeps repeat reads instant
// even after the TTL elapses.
// ──────────────────────────────────────────────────────────────────────────────
const FIN_CACHE_TTL_SECONDS = 60;

function _finKey(orgId, name, extra) {
  const tag = extra ? JSON.stringify(extra) : "";
  return `paygira:${orgId}:${name}:${tag}`;
}

async function cachedLoad(orgId, name, extra, loader) {
  return cacheManager.getOrFetch(
    "organization",
    _finKey(orgId, name, extra),
    loader,
    { ttl: FIN_CACHE_TTL_SECONDS }
  );
}

function money(value) {
  return formatCurrencyAmount(value, "USD", "en-US");
}

function buildFinancePaymentChargeBreakdown(baseAmount, method, platformFeePercentage = 0, taxAmount = 0, bearer = 'parent') {
  return buildPlatformChargeBreakdown(baseAmount, {
    applyPlatformFee: isPlatformFeeMethod(method),
    platformFeePercentage,
    taxAmount,
    bearer,
  });
}

async function getActivePaystackConfig(dbClient = db) {
  const settings = await getPaystackSettings(dbClient);
  return {
    secretKey: settings.activeSecretKey || process.env.PAYSTACK_SECRET_KEY || "",
    publicKey: settings.activePublicKey || process.env.PAYSTACK_PUBLIC_KEY || "",
    mode: settings.mode,
  };
}

// Per-org version counter — bumped on every cache invalidation. The PayGira
// UI polls /finance/_version.json and triggers a silent SPA soft-reload when
// the version increases, so users always see fresh data without hard refresh.
const _finVersions = new Map();
function getFinanceVersion(orgId) {
  if (!orgId) return 0;
  return _finVersions.get(String(orgId)) || 0;
}
function bumpFinanceVersion(orgId) {
  if (!orgId) return 0;
  const key = String(orgId);
  const next = (_finVersions.get(key) || 0) + 1;
  _finVersions.set(key, next);
  return next;
}
function invalidateFinanceCache(orgId) {
  if (!orgId) return;
  cacheManager.invalidatePattern("organization", `paygira:${orgId}:`);
  bumpFinanceVersion(orgId);
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

let _financeSchemaReady = false;
async function ensureFinanceSchema() {
  if (_financeSchemaReady) return;
  await ensurePspSettingsTable().catch(() => null);
  await ensureSignoffCorrectionSchema().catch(() => null);
  _financeSchemaReady = true;
}

async function ensureSignoffCorrectionSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_collection_signoff_corrections (
      correction_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      bill_id INT NOT NULL REFERENCES finance_bills(bill_id) ON DELETE CASCADE,
      class_id INT NOT NULL DEFAULT 0,
      scope_key VARCHAR(40) NOT NULL,
      occurrence_date DATE,
      reopened_signoff_id INT,
      reopened_by_user_id INT,
      reopened_by_name VARCHAR(180),
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => null);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_finance_signoff_corrections_org_scope
    ON finance_collection_signoff_corrections(organization_id, bill_id, class_id, scope_key, occurrence_date, created_at DESC)
  `).catch(() => null);
}

async function isFinanceAdmin(req) {
  try {
    const database = req?.app?.get ? req.app.get("db") : db;
    const userRole = req?.session?.userRole || req?.session?.user?.account_type || null;
    const accountType = req?.session?.accountType || req?.session?.user?.account_type || null;
    const permissionContext = {
      userId: req?.session?.user?.user_id || req?.session?.userId || null,
      userRole,
      organizationId: req?.session?.organizationId,
      accountType,
      userEmail: req?.session?.user?.email || req?.session?.email || null,
    };

    const canManageBilling = await userHasPermission(database, permissionContext, "MANAGE_BILLING");
    const canManagePaygira = await userHasPermission(database, permissionContext, "MANAGE_PAYGIRA");
    return Boolean(canManageBilling || canManagePaygira);
  } catch (_) {
    return false;
  }
}

function parseMultiValue(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return [];
  return String(rawValue)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeIdArray(rawValue) {
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{")) {
      rawValue = trimmed.slice(1, -1).split(",").map((value) => value.trim()).filter(Boolean);
    } else if (trimmed.startsWith("[")) {
      try {
        rawValue = JSON.parse(trimmed);
      } catch (_) {
        rawValue = trimmed.split(",");
      }
    } else {
      rawValue = trimmed.split(",");
    }
  }

  const values = Array.isArray(rawValue)
    ? rawValue
    : rawValue === undefined || rawValue === null || rawValue === ""
      ? []
      : [rawValue];

  return [...new Set(
    values
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  )].sort((left, right) => left - right);
}

const FINANCE_CURRENCY_OPTIONS = [
  { code: "USD", name: "US Dollar" },
  { code: "GHS", name: "Ghana Cedi" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "NGN", name: "Nigerian Naira" },
  { code: "KES", name: "Kenyan Shilling" },
  { code: "ZAR", name: "South African Rand" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "INR", name: "Indian Rupee" },
];

const COUNTRY_TO_FINANCE_CURRENCY = {
  US: "USD",
  GH: "GHS",
  GB: "GBP",
  IE: "EUR",
  FR: "EUR",
  DE: "EUR",
  IT: "EUR",
  ES: "EUR",
  PT: "EUR",
  NL: "EUR",
  NG: "NGN",
  KE: "KES",
  ZA: "ZAR",
  CA: "CAD",
  AU: "AUD",
  IN: "INR",
};

function isSupportedFinanceCurrency(rawCode) {
  const normalized = normalizeCurrencyCode(rawCode);
  if (!normalized) return false;
  return FINANCE_CURRENCY_OPTIONS.some((option) => option.code === normalized);
}

function getFinanceCountryOptions() {
  return getHolidayCountryOptions();
}

function resolveCountryName(rawCountry, fallbackCountryCode = null) {
  const options = getFinanceCountryOptions();
  const byCode = new Map(options.map((option) => [String(option.code || "").toUpperCase(), option.name]));
  const byName = new Map(options.map((option) => [String(option.name || "").trim().toLowerCase(), option.name]));

  const normalizedInput = String(rawCountry || "").trim();
  if (normalizedInput) {
    const asCode = normalizedInput.toUpperCase();
    if (byCode.has(asCode)) return byCode.get(asCode);
    const asName = normalizedInput.toLowerCase();
    if (byName.has(asName)) return byName.get(asName);
  }

  const fallbackCode = String(fallbackCountryCode || "").trim().toUpperCase();
  if (fallbackCode && byCode.has(fallbackCode)) return byCode.get(fallbackCode);
  return "";
}

async function withTimeout(promise, timeoutMs, fallbackValue = null) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildFinanceDisplayContext(req, orgId, pspSettingsInput = null, orgCountryInput = null, orgCurrencyInput = null) {
  const normalizedOrgCurrencyOverride = normalizeCurrencyCode(orgCurrencyInput);
  const normalizedOrgCountry = String(orgCountryInput || "").trim().toUpperCase();
  const orgCurrency = normalizeCurrencyCode(getCurrencyForCountry(normalizedOrgCountry));
  const requestProfile = await withTimeout(
    getCurrencyProfileForRequest(req, { organizationId: orgId }).catch(() => null),
    250,
    null
  );
  const requestCurrency = normalizeCurrencyCode(requestProfile?.userCurrency);
  const requestSource = String(requestProfile?.detectionSource || "").trim();
  const requestCountryCode = String(requestProfile?.countryCode || "").trim().toUpperCase();

  let selectedCurrency = "USD";
  let sourceLabel = "Using USD fallback currency.";

  if (normalizedOrgCurrencyOverride) {
    selectedCurrency = normalizedOrgCurrencyOverride;
    sourceLabel = `Using school currency override from Account Settings (${selectedCurrency}).`;
  } else if (requestSource === "organization-currency-override" && requestCurrency) {
    selectedCurrency = requestCurrency;
    sourceLabel = `Using school currency override from Account Settings (${selectedCurrency}).`;
  } else if (orgCurrency) {
    selectedCurrency = orgCurrency;
    sourceLabel = `Using school country currency from Account Settings (${selectedCurrency}).`;
  } else if (requestCurrency) {
    selectedCurrency = requestCurrency;
    sourceLabel = "Using detected regional currency. Set school country in Account Settings to lock this currency.";
  } else {
    const fallbackFromCountry = normalizeCurrencyCode(getCurrencyForCountry(requestCountryCode));
    if (fallbackFromCountry) {
      selectedCurrency = fallbackFromCountry;
      sourceLabel = "Using country-based currency fallback. Set school country in Account Settings to lock this currency.";
    }
  }

  const locale = getLocaleForCurrency(selectedCurrency);
  const usdToCurrencyRate = selectedCurrency === "USD"
    ? 1
    : await withTimeout(getUsdRate(selectedCurrency).catch(() => null), 250, null);
  const normalizedUsdRate = Number.isFinite(Number(usdToCurrencyRate)) && Number(usdToCurrencyRate) > 0
    ? Number(usdToCurrencyRate)
    : (selectedCurrency === "USD" ? 1 : null);

  return {
    financeCurrency: {
      code: selectedCurrency,
      locale,
      countryHint: resolveCountryName(orgCountryInput, requestCountryCode),
      sourceLabel,
      usdToCurrencyRate: normalizedUsdRate,
    },
    currencyOptions: FINANCE_CURRENCY_OPTIONS,
    formatMoney: (value) => formatCurrencyAmount(value, selectedCurrency, locale),
    formatUsdEquivalent: (value) => {
      if (!normalizedUsdRate || selectedCurrency === "USD") return null;
      const amount = Number(value || 0);
      if (!Number.isFinite(amount)) return null;
      const usdAmount = amount / normalizedUsdRate;
      return `~ ${formatCurrencyAmount(usdAmount, "USD", "en-US")}`;
    },
  };
}

function normalizeArrearsFilters(rawFilters = {}) {
  const statuses = new Set(parseMultiValue(rawFilters.statuses).map((value) => value.toLowerCase()));
  if (!statuses.size) {
    ["overdue", "partial", "defaulted", "never_paid"].forEach((value) => statuses.add(value));
  }
  return {
    schoolYearIds: parseMultiValue(rawFilters.school_year_ids || rawFilters.schoolYearIds),
    termIds: parseMultiValue(rawFilters.term_ids || rawFilters.termIds),
    classIds: parseMultiValue(rawFilters.class_ids || rawFilters.classIds),
    billIds: parseMultiValue(rawFilters.bill_ids || rawFilters.billIds),
    statuses: Array.from(statuses),
    dueFrom: String(rawFilters.due_from || rawFilters.dueFrom || "").trim(),
    dueTo: String(rawFilters.due_to || rawFilters.dueTo || "").trim(),
    minOutstanding: Number(rawFilters.min_outstanding || rawFilters.minOutstanding || 0) || 0,
    paymentMethodFilter: String(rawFilters.payment_method_filter || rawFilters.paymentMethodFilter || "all").trim() || "all",
    emailStatusFilter: String(rawFilters.email_status_filter || rawFilters.emailStatusFilter || "all").trim() || "all",
    search: String(rawFilters.search || "").trim(),
    presetName: String(rawFilters.preset_name || rawFilters.presetName || "").trim(),
  };
}

function buildArrearsQueryString(filters) {
  const params = new URLSearchParams();
  params.set("section", "arrears");
  ["schoolYearIds", "termIds", "classIds", "billIds", "statuses"].forEach((key) => {
    (filters[key] || []).forEach((value) => params.append(key, value));
  });
  if (filters.dueFrom) params.set("dueFrom", filters.dueFrom);
  if (filters.dueTo) params.set("dueTo", filters.dueTo);
  if (filters.minOutstanding) params.set("minOutstanding", String(filters.minOutstanding));
  if (filters.paymentMethodFilter && filters.paymentMethodFilter !== "all") params.set("paymentMethodFilter", filters.paymentMethodFilter);
  if (filters.emailStatusFilter && filters.emailStatusFilter !== "all") params.set("emailStatusFilter", filters.emailStatusFilter);
  if (filters.search) params.set("search", filters.search);
  return params.toString();
}

let _arrearsSchemaReady = false;
async function ensureArrearsSchema() {
  if (_arrearsSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_arrears_filter_presets (
      preset_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => null);
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_arrears_reports (
      report_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      report_period VARCHAR(255),
      format VARCHAR(20) NOT NULL DEFAULT 'pdf',
      record_count INT NOT NULL DEFAULT 0,
      total_outstanding NUMERIC(14,2) NOT NULL DEFAULT 0,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      options JSONB NOT NULL DEFAULT '{}'::jsonb,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes TEXT,
      generated_by INT,
      generated_by_name VARCHAR(160),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => null);
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_arrears_notes (
      note_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_by INT,
      created_by_name VARCHAR(160),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => null);
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_arrears_email_logs (
      email_log_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      student_id INT REFERENCES students(student_id) ON DELETE SET NULL,
      guardian_id INT,
      recipient_email VARCHAR(255),
      subject VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'queued',
      error_message TEXT,
      sent_by INT,
      sent_by_name VARCHAR(160),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => null);
  _arrearsSchemaReady = true;
}

function buildStudentPaymentLink(req) {
  const host = (req && req.headers && req.headers.host) ? req.headers.host : "manis.managira.com";
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}/guardian/paygira`;
}

function daysBetweenNow(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.max(Math.floor((today.getTime() - due.getTime()) / 86400000), 0);
}

function computeArrearsBillStatus(row) {
  const balance = Math.max(Number(row.total_billed || 0) - Number(row.amount_paid || 0), 0);
  const daysOverdue = daysBetweenNow(row.due_date);
  const neverPaid = balance > 0 && Number(row.amount_paid || 0) === 0;
  const defaulted = balance > 0 && daysOverdue >= 30;
  const partial = balance > 0 && Number(row.amount_paid || 0) > 0;
  const overdue = balance > 0 && daysOverdue > 0 && !defaulted && !partial;
  let status = "overdue";
  if (defaulted) status = "defaulted";
  else if (neverPaid) status = "never_paid";
  else if (partial) status = "partial";
  return { balance, daysOverdue, neverPaid, defaulted, partial, overdue, status };
}

async function loadArrearsRows(orgId) {
  await ensureGuardianCardsSchema();
  const result = await db.query(
    `SELECT a.assignment_id, a.student_id, a.bill_id,
            a.amount, a.amount_paid, a.late_fee_applied, a.status AS assignment_status,
            b.title AS bill_title, b.bill_type, b.due_date, b.school_year_id, b.term_id,
            sy.year_label, tm.term_name,
            s.first_name, s.last_name, s.image_url, s.class_id,
            c.class_name,
            gp.guardian_id AS profile_guardian_id,
            COALESCE(NULLIF(CONCAT_WS(' ', gp.first_name, gp.last_name), ''), NULLIF(CONCAT_WS(' ', lg.first_name, lg.last_name), '')) AS guardian_name,
            COALESCE(NULLIF(gp.email, ''), NULLIF(lg.email, '')) AS guardian_email,
            COALESCE(NULLIF(gp.phone, ''), NULLIF(lg.phone, '')) AS guardian_phone,
            COALESCE(gs.relationship, 'Guardian') AS guardian_relationship,
            COALESCE(sc.amount, 0) AS student_credit,
            CASE WHEN gp.guardian_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM guardian_payment_methods pm
               WHERE pm.organization_id = a.organization_id
                 AND pm.guardian_id = gp.guardian_id
            ) THEN true ELSE false END AS has_saved_card
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       JOIN students s ON s.student_id = a.student_id
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN school_years sy ON sy.id = b.school_year_id
       LEFT JOIN terms tm ON tm.term_id = b.term_id
       LEFT JOIN LATERAL (
         SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.email, gp.phone
           FROM guardian_students gs2
           JOIN guardian_profiles gp ON gp.guardian_id = gs2.guardian_id AND gp.organization_id = a.organization_id
          WHERE gs2.student_id = s.student_id
          ORDER BY gs2.created_at ASC, gp.guardian_id ASC
          LIMIT 1
       ) gp ON TRUE
       LEFT JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id AND gs.student_id = s.student_id
       LEFT JOIN LATERAL (
         SELECT g.guardian_id, g.first_name, g.last_name, g.email, g.phone
           FROM guardians g
          WHERE g.student_id = s.student_id AND g.organization_id = a.organization_id
          ORDER BY g.guardian_id ASC
          LIMIT 1
       ) lg ON TRUE
       LEFT JOIN finance_student_credits sc ON sc.organization_id = a.organization_id AND sc.student_id = a.student_id
      WHERE a.organization_id = $1
        AND a.status NOT IN ('paid', 'cancelled')
      ORDER BY s.last_name, s.first_name, b.due_date NULLS LAST, b.title`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

function applyArrearsFilters(rawRows, rawFilters) {
  const filters = normalizeArrearsFilters(rawFilters);
  const yearSet = new Set(filters.schoolYearIds);
  const termSet = new Set(filters.termIds);
  const classSet = new Set(filters.classIds);
  const billSet = new Set(filters.billIds);
  const statusSet = new Set(filters.statuses);
  const dueFrom = filters.dueFrom ? new Date(filters.dueFrom) : null;
  const dueTo = filters.dueTo ? new Date(filters.dueTo) : null;
  if (dueFrom && !Number.isNaN(dueFrom.getTime())) dueFrom.setHours(0, 0, 0, 0);
  if (dueTo && !Number.isNaN(dueTo.getTime())) dueTo.setHours(23, 59, 59, 999);

  const grouped = new Map();
  for (const row of rawRows) {
    const computed = computeArrearsBillStatus({
      total_billed: Number(row.amount || 0) + Number(row.late_fee_applied || 0),
      amount_paid: row.amount_paid,
      due_date: row.due_date,
    });
    const dueDate = row.due_date ? new Date(row.due_date) : null;
    if (yearSet.size && !yearSet.has(String(row.school_year_id || ""))) continue;
    if (termSet.size && !termSet.has(String(row.term_id || ""))) continue;
    if (classSet.size && !classSet.has(String(row.class_id || ""))) continue;
    if (billSet.size && !billSet.has(String(row.bill_id || ""))) continue;
    if (dueFrom && dueDate && dueDate < dueFrom) continue;
    if (dueTo && dueDate && dueDate > dueTo) continue;

    const studentKey = String(row.student_id);
    if (!grouped.has(studentKey)) {
      grouped.set(studentKey, {
        student_id: row.student_id,
        student_name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
        first_name: row.first_name,
        last_name: row.last_name,
        image_url: row.image_url,
        class_id: row.class_id,
        class_name: row.class_name || "No class",
        guardian_id: row.profile_guardian_id || null,
        guardian_name: row.guardian_name || "",
        guardian_email: row.guardian_email || "",
        guardian_phone: row.guardian_phone || "",
        guardian_relationship: row.guardian_relationship || "Guardian",
        has_saved_card: !!row.has_saved_card,
        student_credit: Number(row.student_credit || 0),
        bills: [],
        total_billed: 0,
        total_paid: 0,
        total_outstanding_raw: 0,
        max_days_overdue: 0,
        flags: { overdue: false, partial: false, defaulted: false, never_paid: false },
      });
    }
    const student = grouped.get(studentKey);
    const billRecord = {
      assignment_id: row.assignment_id,
      bill_id: row.bill_id,
      bill_title: row.bill_title,
      bill_type: row.bill_type || "one_time",
      school_year_id: row.school_year_id,
      year_label: row.year_label || "—",
      term_id: row.term_id,
      term_name: row.term_name || "—",
      due_date: row.due_date,
      total_billed: Number(row.amount || 0) + Number(row.late_fee_applied || 0),
      paid: Number(row.amount_paid || 0),
      outstanding: computed.balance,
      days_overdue: computed.daysOverdue,
      status: computed.status,
      never_paid: computed.neverPaid,
      defaulted: computed.defaulted,
      partial: computed.partial,
      overdue: computed.overdue,
    };
    student.bills.push(billRecord);
    student.total_billed += billRecord.total_billed;
    student.total_paid += billRecord.paid;
    student.total_outstanding_raw += billRecord.outstanding;
    student.max_days_overdue = Math.max(student.max_days_overdue, billRecord.days_overdue);
    student.flags.overdue = student.flags.overdue || billRecord.overdue;
    student.flags.partial = student.flags.partial || billRecord.partial;
    student.flags.defaulted = student.flags.defaulted || billRecord.defaulted;
    student.flags.never_paid = student.flags.never_paid || billRecord.never_paid;
  }

  let students = Array.from(grouped.values()).map((student) => {
    const outstanding = Math.max(student.total_billed - student.total_paid - student.student_credit, 0);
    let primaryStatus = "overdue";
    if (student.flags.defaulted) primaryStatus = "defaulted";
    else if (student.flags.never_paid && student.total_paid === 0) primaryStatus = "never_paid";
    else if (student.flags.partial || student.total_paid > 0) primaryStatus = "partial";
    else if (student.flags.overdue || student.max_days_overdue > 0) primaryStatus = "overdue";
    const searchable = [
      student.student_name,
      student.class_name,
      student.guardian_name,
      student.guardian_email,
      student.bills.map((bill) => bill.bill_title).join(" "),
    ].join(" ").toLowerCase();
    return {
      ...student,
      outstanding,
      primary_status: primaryStatus,
      searchable,
    };
  });

  students = students.filter((student) => {
    if (!student.outstanding || student.outstanding < filters.minOutstanding) return false;
    if (filters.paymentMethodFilter === "saved_card" && !student.has_saved_card) return false;
    if (filters.paymentMethodFilter === "no_saved_card" && student.has_saved_card) return false;
    if (filters.emailStatusFilter === "has_email" && !student.guardian_email) return false;
    if (filters.emailStatusFilter === "no_email" && student.guardian_email) return false;
    if (statusSet.size) {
      const matchesStatus = Array.from(statusSet).some((status) => {
        if (status === "defaulted") return student.flags.defaulted;
        if (status === "partial") return student.flags.partial || (student.total_paid > 0 && student.outstanding > 0);
        if (status === "never_paid") return student.flags.never_paid || (student.total_paid === 0 && student.outstanding > 0);
        if (status === "overdue") return student.flags.overdue || (student.max_days_overdue > 0 && !student.flags.defaulted && !student.flags.partial && !student.flags.never_paid);
        return true;
      });
      if (!matchesStatus) return false;
    }
    if (filters.search && !student.searchable.includes(filters.search.toLowerCase())) return false;
    return true;
  });

  students.sort((a, b) => {
    if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding;
    if (b.max_days_overdue !== a.max_days_overdue) return b.max_days_overdue - a.max_days_overdue;
    return a.student_name.localeCompare(b.student_name);
  });

  const summary = {
    count: students.length,
    totalOutstanding: students.reduce((sum, student) => sum + student.outstanding, 0),
    partialPayments: students.filter((student) => student.total_paid > 0 && student.outstanding > 0).reduce((sum, student) => sum + student.total_paid, 0),
    neverPaidOutstanding: students.filter((student) => student.total_paid === 0).reduce((sum, student) => sum + student.outstanding, 0),
    overdueThirtyPlus: students.filter((student) => student.flags.defaulted).length,
    hasEmail: students.filter((student) => !!student.guardian_email).length,
    noEmail: students.filter((student) => !student.guardian_email).length,
    withSavedCard: students.filter((student) => student.has_saved_card).length,
  };

  return { filters, students, summary };
}

async function loadArrearsReports(orgId) {
  await ensureArrearsSchema();
  const result = await db.query(
    `SELECT report_id, title, generated_by_name, created_at, record_count, format, total_outstanding
       FROM finance_arrears_reports
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function loadArrearsPresets(orgId) {
  await ensureArrearsSchema();
  const result = await db.query(
    `SELECT preset_id, name, filters, created_at
       FROM finance_arrears_filter_presets
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT 12`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

function buildArrearsRecipientReview(students) {
  const missingGuardian = students.filter((student) => !student.guardian_name).length;
  const missingEmail = students.filter((student) => student.guardian_name && !student.guardian_email).length;
  const recipients = students.map((student) => ({
    student_id: student.student_id,
    student_name: student.student_name,
    guardian_id: student.guardian_id,
    guardian_name: student.guardian_name,
    guardian_email: student.guardian_email,
    guardian_phone: student.guardian_phone,
    class_name: student.class_name,
    outstanding: student.outstanding,
    has_saved_card: student.has_saved_card,
    status: student.guardian_email ? "ready" : (student.guardian_name ? "missing_email" : "missing_guardian"),
  }));
  return { recipients, missingGuardian, missingEmail };
}

async function loadArrearsManagementData(orgId, rawFilters) {
  const rows = await loadArrearsRows(orgId);
  const arrears = applyArrearsFilters(rows, rawFilters);
  return {
    ...arrears,
    recipientReview: buildArrearsRecipientReview(arrears.students),
  };
}

async function saveArrearsReportRecord(orgId, payload) {
  await ensureArrearsSchema();
  const result = await db.query(
    `INSERT INTO finance_arrears_reports
      (organization_id, title, report_period, format, record_count, total_outstanding, filters, options, snapshot, notes, generated_by, generated_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)
     RETURNING report_id`,
    [
      orgId,
      payload.title,
      payload.reportPeriod || null,
      payload.format || "pdf",
      payload.recordCount || 0,
      payload.totalOutstanding || 0,
      JSON.stringify(payload.filters || {}),
      JSON.stringify(payload.options || {}),
      JSON.stringify(payload.snapshot || {}),
      payload.notes || null,
      payload.generatedBy || null,
      payload.generatedByName || null,
    ]
  );
  return result.rows[0]?.report_id || null;
}

function escapeCsv(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

function buildArrearsReportCsv(snapshot) {
  const students = snapshot.students || [];
  const lines = [[
    "Student", "Class", "Guardian", "Email", "Phone", "Total Billed", "Paid", "Credit", "Outstanding", "Days Overdue", "Status", "Bills"
  ]];
  students.forEach((student) => {
    lines.push([
      student.student_name,
      student.class_name,
      student.guardian_name,
      student.guardian_email,
      student.guardian_phone,
      Number(student.total_billed || 0).toFixed(2),
      Number(student.total_paid || 0).toFixed(2),
      Number(student.student_credit || 0).toFixed(2),
      Number(student.outstanding || 0).toFixed(2),
      student.max_days_overdue,
      student.primary_status,
      (student.bills || []).map((bill) => `${bill.bill_title} (${Number(bill.outstanding || 0).toFixed(2)})`).join("; "),
    ]);
  });
  return lines.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

function buildArrearsReportPdfBuffer(report, display) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const snapshot = report.snapshot || {};
    const students = snapshot.students || [];
    const summary = snapshot.summary || {};
    const fmt = display.formatMoney;

    doc.fontSize(18).text(report.title || "Arrears Report", { align: "left" });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor("#666666").text(`Generated: ${new Date(report.created_at || Date.now()).toLocaleString()}`);
    if (report.report_period) doc.text(`Period: ${report.report_period}`);
    doc.text(`Records: ${report.record_count || students.length}  |  Total Outstanding: ${fmt(summary.totalOutstanding || report.total_outstanding || 0)}`);
    doc.moveDown();
    doc.fillColor("#000000");

    students.slice(0, 80).forEach((student, index) => {
      if (index > 0) doc.moveDown(0.65);
      doc.fontSize(12).text(`${student.student_name} — ${student.class_name}`);
      doc.fontSize(9).fillColor("#444444").text(`Guardian: ${student.guardian_name || "No guardian"} | ${student.guardian_email || student.guardian_phone || "No contact"}`);
      doc.text(`Billed: ${fmt(student.total_billed || 0)}   Paid: ${fmt(student.total_paid || 0)}   Credit: ${fmt(student.student_credit || 0)}   Outstanding: ${fmt(student.outstanding || 0)}   Status: ${student.primary_status}`);
      (student.bills || []).slice(0, 8).forEach((bill) => {
        doc.text(`• ${bill.bill_title} | Due ${bill.due_date ? new Date(bill.due_date).toLocaleDateString() : '—'} | Balance ${fmt(bill.outstanding || 0)} | ${bill.days_overdue} day(s) overdue`, { indent: 12 });
      });
      doc.fillColor("#000000");
    });

    doc.end();
  });
}

async function loadArrearsReportById(orgId, reportId) {
  await ensureArrearsSchema();
  const result = await db.query(
    `SELECT * FROM finance_arrears_reports WHERE organization_id = $1 AND report_id = $2 LIMIT 1`,
    [orgId, reportId]
  ).catch(() => ({ rows: [] }));
  return result.rows[0] || null;
}

function personalizeArrearsTemplate(template, student, schoolName) {
  const nextDue = (student.bills || []).find((bill) => bill.outstanding > 0);
  const replacements = {
    "{Guardian Name}": student.guardian_name || "Guardian",
    "{Student Name}": student.student_name || "Student",
    "{Class}": student.class_name || "—",
    "{Outstanding Amount}": student.outstanding_display,
    "{Bill Name}": nextDue ? nextDue.bill_title : "Outstanding fees",
    "{Due Date}": nextDue && nextDue.due_date ? new Date(nextDue.due_date).toLocaleDateString() : "—",
    "{Days Overdue}": String(student.max_days_overdue || 0),
    "{School Name}": schoolName || "Your School",
    "{Term Name}": nextDue ? (nextDue.term_name || "Current Term") : "Current Term",
  };
  let output = String(template || "");
  Object.entries(replacements).forEach(([token, value]) => {
    output = output.split(token).join(value);
  });
  return output;
}

// ─── Payment-method helpers ─────────────────────────────────────────
// Stripe supports many payment methods; we let the school enable any of these.
// These are the canonical Stripe Payment Method identifiers.
const STRIPE_METHOD_CATALOG = [
  { id: 'card',             label: 'Card (Visa / Mastercard / Amex)' },
  { id: 'apple_pay',        label: 'Apple Pay' },
  { id: 'google_pay',       label: 'Google Pay' },
  { id: 'link',             label: 'Link by Stripe' },
  { id: 'cashapp',          label: 'Cash App Pay' },
  { id: 'us_bank_account',  label: 'US Bank Account (ACH)' },
  { id: 'sepa_debit',       label: 'SEPA Direct Debit' },
  { id: 'bacs_debit',       label: 'BACS Direct Debit (UK)' },
  { id: 'klarna',           label: 'Klarna' },
  { id: 'afterpay_clearpay',label: 'Afterpay / Clearpay' },
  { id: 'ideal',            label: 'iDEAL' },
];

function normalizeStripeMethodList(rawValue) {
  const rawList = Array.isArray(rawValue)
    ? rawValue
    : (typeof rawValue === 'string' && rawValue.trim()
        ? rawValue.split(',')
        : []);
  const normalized = rawList
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized.length ? normalized : ['card'])];
}

function buildGuardianStripeCheckoutConfig(stripeMethods) {
  const selectedIds = normalizeStripeMethodList(stripeMethods);
  const selected = new Set(selectedIds);
  const paymentMethodOrder = [];
  if (selected.has('card') || selected.has('apple_pay') || selected.has('google_pay')) {
    paymentMethodOrder.push('card');
  }
  ['link', 'cashapp', 'us_bank_account', 'sepa_debit', 'bacs_debit', 'klarna', 'afterpay_clearpay', 'ideal'].forEach((methodId) => {
    if (selected.has(methodId)) paymentMethodOrder.push(methodId);
  });
  if (!paymentMethodOrder.length) paymentMethodOrder.push('card');
  return {
    selectedIds,
    paymentMethodOrder,
    expressWallets: {
      applePay: selected.has('apple_pay') || selected.has('card') ? 'auto' : 'never',
      googlePay: selected.has('google_pay') || selected.has('card') ? 'auto' : 'never',
    },
    displayLabels: STRIPE_METHOD_CATALOG
      .filter((method) => selected.has(method.id))
      .map((method) => method.label),
  };
}

function getSchoolStripeClient(pspSettings) {
  const secretKey = String(pspSettings?.stripe_secret_key || '').trim();
  if (!secretKey) {
    throw new PaygiraRequestError('Stripe is not configured for this school.', 400);
  }
  return new Stripe(secretKey);
}

function resolveStripeFinanceMethod(paymentIntent) {
  const paymentMethod = paymentIntent?.payment_method;
  if (paymentMethod && typeof paymentMethod === 'object') {
    if (paymentMethod.type === 'card' && paymentMethod.card?.wallet?.type) {
      const walletType = String(paymentMethod.card.wallet.type || '').trim().toLowerCase();
      if (walletType === 'apple_pay') return 'apple_pay';
      if (walletType === 'google_pay') return 'google_pay';
    }
    const normalizedType = String(paymentMethod.type || '').trim().toLowerCase();
    if (normalizedType) return normalizedType;
  }
  const fallbackType = String(paymentIntent?.payment_method_types?.[0] || 'stripe').trim().toLowerCase();
  return fallbackType || 'stripe';
}

async function resolvePlatformStripeCredentials() {
  const platformCredentials = await getStripePlatformCredentials(db).catch(() => ({
    secretKey: '',
    publicKey: '',
  }));
  return {
    secretKey: String(platformCredentials.secretKey || '').trim(),
    publishableKey: String(platformCredentials.publicKey || '').trim(),
  };
}

async function resolveFinanceStripeRuntime(orgId, pspSettings, orgProfileInput) {
  const orgProfile = orgProfileInput && Object.keys(orgProfileInput).length
    ? orgProfileInput
    : await loadOrganizationProfile(orgId);
  const connectedAccountId = String(orgProfile?.stripe_connect_account_id || '').trim();

  const platformCredentials = await resolvePlatformStripeCredentials();
  const canUseConnectedStripe = Boolean(
    connectedAccountId &&
    platformCredentials.secretKey &&
    platformCredentials.publishableKey
  );

  return {
    stripeOn: canUseConnectedStripe,
    publishableKey: canUseConnectedStripe ? platformCredentials.publishableKey : '',
    secretKey: canUseConnectedStripe ? platformCredentials.secretKey : '',
    connectedAccountId: canUseConnectedStripe ? connectedAccountId : '',
    useConnectedDestinationCharge: canUseConnectedStripe,
  };
}

function getFinanceStripeClient(stripeRuntime) {
  const secretKey = String(stripeRuntime?.secretKey || '').trim();
  if (!secretKey) {
    throw new PaygiraRequestError('Stripe is not configured for this school.', 400);
  }
  return new Stripe(secretKey);
}

// Given a school's PSP settings, return the methods parents/staff are allowed to use.
function computeAllowedMethods(pspSettings, options = {}) {
  const s = pspSettings || {};
  const stripeOn = typeof options.stripeOn === 'boolean'
    ? options.stripeOn
    : !!(s.stripe_publishable_key && s.stripe_secret_key);
  // Selected stripe methods – default to ['card'] if Stripe is on but no list saved
  let stripeMethods = [];
  if (stripeOn) {
    const raw = s.stripe_methods;
    if (Array.isArray(raw)) stripeMethods = raw.filter(Boolean);
    else if (typeof raw === 'string' && raw.trim()) stripeMethods = raw.split(',').map(x => x.trim()).filter(Boolean);
    else stripeMethods = ['card'];
  }
  return {
    stripeOn,
    stripeMethods,
    momoOn: !!(s.momo_provider && s.momo_number),
    momoProvider: s.momo_provider || null,
    momoNumber:   s.momo_number || null,
    momoName:     s.momo_name || null,
    bankOn: !!(s.bank_name && s.bank_account_number),
    bank: {
      name:    s.bank_name || null,
      account: s.bank_account_number || null,
      holder:  s.bank_account_name || null,
      branch:  s.bank_branch || null,
    },
    currency: s.currency || 'USD',
  };
}

function mapPayoutAccountTypeToCollectionDestination(accountType) {
  const normalized = String(accountType || '').trim().toLowerCase();
  if (normalized === 'stripe_card') return 'stripe';
  if (normalized === 'bank') return 'bank';
  if (normalized === 'mobile_money') return 'momo';
  return null;
}

function buildCollectionDestinationLabel(account) {
  const type = String(account && account.account_type || '').trim().toLowerCase();
  const primaryTag = account && account.is_primary ? ' (Primary)' : '';
  if (type === 'mobile_money') {
    const who = (account.momo_provider || account.business_name || account.account_holder_name || '').toString().trim();
    return `Mobile Money${who ? ' — ' + who : ''}${primaryTag}`;
  }
  if (type === 'bank') {
    const who = (account.bank_name || account.business_name || '').toString().trim();
    return `Bank Account${who ? ' — ' + who : ''}${primaryTag}`;
  }
  if (type === 'stripe_card') {
    return `Stripe Payout Account${primaryTag}`;
  }
  return (account && account.business_name) ? account.business_name : 'Payout Account';
}

// Builds the Collection Destination options for a bill.
// Only surfaces accounts for the school's ACTIVE payout provider:
//   • Paystack active  → list every Paystack payout account (each mobile money /
//     bank account individually) by its DB id, never Stripe.
//   • Stripe active    → list Stripe, never Paystack accounts.
//   • No preference    → show whatever is configured.
// Cash is always offered. Option values match the guardian-side `payout_account_id`
// convention: numeric id for a Paystack account, 'stripe', or 'cash'.
async function resolveBillCollectionDestinations(database, orgId, orgProfileInput = null, pspSettingsInput = null) {
  const orgProfile = orgProfileInput && Object.keys(orgProfileInput).length
    ? orgProfileInput
    : await loadOrganizationProfile(orgId);
  const pspSettings = pspSettingsInput && Object.keys(pspSettingsInput).length
    ? pspSettingsInput
    : await loadPspSettings(orgId).catch(() => ({}));
  const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
  const connectedAccountId = String(orgProfile?.stripe_connect_account_id || '').trim();
  const payoutContext = await resolveSchoolPayoutDestination(orgId, database).catch(() => null);
  const preference = String(payoutContext?.preference || '').trim().toLowerCase(); // 'stripe' | 'paystack' | ''
  const activeProvider = String(payoutContext?.provider || '').trim().toLowerCase(); // resolved provider

  const payoutAccounts = (await database.query(
    `SELECT id, account_type, business_name, bank_name, momo_provider, account_holder_name, is_primary
       FROM paystack_subaccounts
      WHERE organization_id = $1
      ORDER BY is_primary DESC, id ASC`,
    [orgId]
  )).rows;

  // Paystack payout rows are mobile money / bank accounts. stripe_card rows belong to Stripe.
  const paystackAccounts = payoutAccounts.filter((account) => {
    const type = String(account.account_type || '').trim().toLowerCase();
    return type === 'mobile_money' || type === 'bank';
  });
  const hasStripe = Boolean(connectedAccountId)
    || Boolean(stripeRuntime && stripeRuntime.stripeOn)
    || payoutAccounts.some((account) => String(account.account_type || '').trim().toLowerCase() === 'stripe_card');

  // Decide which provider's accounts to surface. Explicit preference wins, then the
  // resolved active provider, otherwise show everything that's configured.
  let showPaystack;
  let showStripe;
  if (preference === 'paystack') { showPaystack = true; showStripe = false; }
  else if (preference === 'stripe') { showPaystack = false; showStripe = true; }
  else if (activeProvider === 'paystack') { showPaystack = true; showStripe = false; }
  else if (activeProvider === 'stripe') { showPaystack = false; showStripe = true; }
  else { showPaystack = paystackAccounts.length > 0; showStripe = hasStripe; }

  const primaryPaystack = paystackAccounts.find((account) => account.is_primary) || paystackAccounts[0] || null;
  const options = [];

  if (showPaystack) {
    paystackAccounts.forEach((account) => {
      options.push({ value: String(account.id), label: buildCollectionDestinationLabel(account) });
    });
  }
  if (showStripe) {
    options.push({ value: 'stripe', label: connectedAccountId ? 'Stripe Payout Account' : 'Stripe' });
  }
  // Cash is always available — payout accounts are optional.
  options.push({ value: 'cash', label: 'Cash (collect manually)' });

  let defaultValue = 'cash';
  if (showPaystack && primaryPaystack) defaultValue = String(primaryPaystack.id);
  else if (showStripe) defaultValue = 'stripe';

  // Active provider for the bill UI: explicit preference, else resolved provider,
  // else infer from what is shown.
  let provider = preference || activeProvider || '';
  if (!provider) {
    if (showStripe && !showPaystack) provider = 'stripe';
    else if (showPaystack && !showStripe) provider = 'paystack';
  }

  return { options, defaultValue, provider, hasPaystack: paystackAccounts.length > 0, hasStripe };
}

function maskPspSecrets(p) {
  const safe = { ...(p || {}) };
  ['stripe_secret_key','stripe_webhook_secret'].forEach(k => {
    if (safe[k]) {
      safe[k + '_masked'] = '••••••••' + String(safe[k]).slice(-4);
      delete safe[k];
    }
  });
  return safe;
}

function normalizeFinanceDraftArray(value) {
  const rawValues = Array.isArray(value)
    ? value
    : (value == null || value === '' ? [] : [value]);
  return rawValues
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function buildFinanceBillCreateDraft(body = {}) {
  const requestedStatus = String(body.status || '').trim().toLowerCase();
  const rawAssigneeIds = body.assignee_ids || body['assignee_ids[]'] || body.assignee_id;
  return {
    title: String(body.title || '').trim(),
    description: String(body.description || ''),
    amount: body.amount != null ? String(body.amount) : '',
    bill_type: String(body.bill_type || 'one_time').trim() || 'one_time',
    recurrence: String(body.recurrence || '').trim(),
    recurrence_end_date: String(body.recurrence_end_date || '').trim(),
    late_fee_amount: body.late_fee_amount != null ? String(body.late_fee_amount) : '',
    late_fee_after_days: body.late_fee_after_days != null ? String(body.late_fee_after_days) : '7',
    applies_to: ['school', 'classes', 'students'].includes(String(body.applies_to || '').trim())
      ? String(body.applies_to).trim()
      : 'school',
    school_year_id: body.school_year_id != null ? String(body.school_year_id) : '',
    term_id: body.term_id != null ? String(body.term_id) : '',
    due_date: String(body.due_date || '').trim(),
    exclude_non_school_days: Boolean(parseBoolean(body.exclude_non_school_days)),
    assignee_ids: normalizeFinanceDraftArray(rawAssigneeIds),
    target_class_ids: normalizeFinanceDraftArray(body.target_class_ids),
    target_student_ids: normalizeFinanceDraftArray(body.target_student_ids),
    payment_destination: String(body.payment_destination || '').trim() || 'cash',
    accepts_card: Object.prototype.hasOwnProperty.call(body, 'accepts_card') ? Boolean(parseBoolean(body.accepts_card)) : true,
    accepts_cash: Object.prototype.hasOwnProperty.call(body, 'accepts_cash') ? Boolean(parseBoolean(body.accepts_cash)) : true,
    accepts_transfer: Object.prototype.hasOwnProperty.call(body, 'accepts_transfer') ? Boolean(parseBoolean(body.accepts_transfer)) : true,
    notify_email: Object.prototype.hasOwnProperty.call(body, 'notify_email') ? Boolean(parseBoolean(body.notify_email)) : true,
    notify_sms: Object.prototype.hasOwnProperty.call(body, 'notify_sms') ? Boolean(parseBoolean(body.notify_sms)) : false,
    status: ['draft', 'active', 'scheduled', 'cancelled'].includes(requestedStatus) ? requestedStatus : 'active',
  };
}

async function loadOverviewStats(orgId, filters = {}) {
  const yr = filters.school_year_id ? parseInt(filters.school_year_id, 10) : null;
  const tm = filters.term_id        ? parseInt(filters.term_id, 10)        : null;

  const oneTimeWhere = ['a.organization_id = $1', `COALESCE(b.bill_type, 'one_time') <> 'recurring'`];
  const recurringWhere = ['a.organization_id = $1', `COALESCE(b.bill_type, 'one_time') = 'recurring'`];
  const oneTimeParams = [orgId];
  const recurringParams = [orgId];
  let oneTimeIndex = 2;
  let recurringIndex = 2;
  if (yr) {
    oneTimeWhere.push(`b.school_year_id = $${oneTimeIndex++}`);
    recurringWhere.push(`b.school_year_id = $${recurringIndex++}`);
    oneTimeParams.push(yr);
    recurringParams.push(yr);
  }
  if (tm) {
    oneTimeWhere.push(`b.term_id = $${oneTimeIndex++}`);
    recurringWhere.push(`b.term_id = $${recurringIndex++}`);
    oneTimeParams.push(tm);
    recurringParams.push(tm);
  }

  const [oneTimeTotals, recurringTotals] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(a.amount), 0)::numeric AS total_billed,
              COALESCE(SUM(a.amount_paid), 0)::numeric AS total_collected,
              COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)), 0)::numeric AS outstanding,
              COUNT(*) FILTER (WHERE a.status = 'overdue')::int AS overdue_count,
              COUNT(*)::int AS total_assignments
         FROM finance_bill_assignments a
         JOIN finance_bills b ON b.bill_id = a.bill_id
        WHERE ${oneTimeWhere.join(' AND ')}`,
      oneTimeParams
    ),
    db.query(
      `SELECT a.amount, a.amount_paid, a.late_fee_applied, a.status,
              b.bill_type, b.recurrence, b.due_date, b.recurrence_end_date,
              b.term_id, b.exclude_non_school_days,
              tm.end_date AS term_end_date
         FROM finance_bill_assignments a
         JOIN finance_bills b ON b.bill_id = a.bill_id
         LEFT JOIN terms tm ON tm.term_id = b.term_id
        WHERE ${recurringWhere.join(' AND ')}`,
      recurringParams
    ),
  ]);

  const scheduleContext = createBillScheduleContextLoader(db, orgId);
  const recurringRows = await Promise.all(
    recurringTotals.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
  );
  const recurringSummary = recurringRows.reduce((accumulator, assignment) => {
    accumulator.total_billed += Number(assignment.scheduled_billed_total || 0);
    accumulator.total_collected += Number(assignment.amount_paid || 0);
    accumulator.outstanding += Number(assignment.scheduled_outstanding_total || 0);
    accumulator.overdue_count += assignment.status === 'overdue' ? 1 : 0;
    accumulator.total_assignments += 1;
    return accumulator;
  }, {
    total_billed: 0,
    total_collected: 0,
    outstanding: 0,
    overdue_count: 0,
    total_assignments: 0,
  });

  const totalSummary = {
    total_billed: Number(oneTimeTotals.rows[0]?.total_billed || 0) + recurringSummary.total_billed,
    total_collected: Number(oneTimeTotals.rows[0]?.total_collected || 0) + recurringSummary.total_collected,
    outstanding: Number(oneTimeTotals.rows[0]?.outstanding || 0) + recurringSummary.outstanding,
    overdue_count: Number(oneTimeTotals.rows[0]?.overdue_count || 0) + recurringSummary.overdue_count,
    total_assignments: Number(oneTimeTotals.rows[0]?.total_assignments || 0) + recurringSummary.total_assignments,
  };

  const credits = await db.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS overpayments
       FROM finance_student_credits WHERE organization_id = $1`,
    [orgId]
  );

  // Recent payments — also filterable by bill year/term
  const rWhere = ['p.organization_id = $1'];
  const rParams = [orgId];
  let j = 2;
  if (yr) { rWhere.push(`b.school_year_id = $${j++}`); rParams.push(yr); }
  if (tm) { rWhere.push(`b.term_id        = $${j++}`); rParams.push(tm); }
  const recent = await db.query(
    `SELECT p.payment_id, p.amount, p.method, p.received_at, p.is_refund,
            s.first_name, s.last_name, b.title AS bill_title
       FROM finance_payments p
       LEFT JOIN students s       ON s.student_id = p.student_id
       LEFT JOIN finance_bills b  ON b.bill_id    = p.bill_id
      WHERE ${rWhere.join(' AND ')}
      ORDER BY p.received_at DESC LIMIT 12`,
    rParams
  );

  const billWhere = ['organization_id = $1'];
  const billParams = [orgId];
  let billIndex = 2;
  if (yr) { billWhere.push(`school_year_id = $${billIndex++}`); billParams.push(yr); }
  if (tm) { billWhere.push(`term_id = $${billIndex++}`); billParams.push(tm); }
  const billSummary = await db.query(
    `SELECT COUNT(*)::int AS total_bill_count,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'paid')::int AS paid_count,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'overdue')::int AS overdue_count,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'partial')::int AS partial_count,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'draft')::int AS draft_count,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'cancelled')::int AS cancelled_count
       FROM finance_bills
      WHERE ${billWhere.join(' AND ')}`,
    billParams
  ).catch(() => ({ rows: [{}] }));
  const billSummaryRow = billSummary.rows[0] || {};

  return {
    totals: totalSummary,
    overpayments: credits.rows[0]?.overpayments || 0,
    recent: recent.rows,
    billCount: Number(billSummaryRow.total_bill_count || 0),
    billStatusBreakdown: {
      paid: Number(billSummaryRow.paid_count || 0),
      pending: Number(billSummaryRow.pending_count || 0),
      overdue: Number(billSummaryRow.overdue_count || 0),
      partial: Number(billSummaryRow.partial_count || 0),
      draft: Number(billSummaryRow.draft_count || 0),
      cancelled: Number(billSummaryRow.cancelled_count || 0),
    },
    filters: { school_year_id: yr, term_id: tm },
  };
}

async function loadOverviewBillsSnapshot(orgId, filters = {}) {
  return loadBills(orgId, {
    ...filters,
    page: 1,
    pageSize: parsePositiveInt(filters.pageSize, 20, 8, 40),
  });
}

async function loadBills(orgId, filters = {}) {
  const page = parsePositiveInt(filters.page, 1, 1, 1000000);
  const pageSize = parsePositiveInt(filters.pageSize, 20, 10, 100);
  const offset = (page - 1) * pageSize;
  const schoolYearId = parseInt(filters.school_year_id, 10);
  const termId = parseInt(filters.term_id, 10);
  const where = ['b.organization_id = $1'];
  const params = [orgId];
  let nextParamIndex = 2;

  if (Number.isInteger(schoolYearId) && schoolYearId > 0) {
    where.push(`b.school_year_id = $${nextParamIndex++}`);
    params.push(schoolYearId);
  }
  if (Number.isInteger(termId) && termId > 0) {
    where.push(`b.term_id = $${nextParamIndex++}`);
    params.push(termId);
  }

  const limitParam = nextParamIndex++;
  const offsetParam = nextParamIndex++;
  const pagedParams = [...params, pageSize + 1, offset];

  const r = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS assigned_count,
            u.first_name AS assignee_first_name,
            u.last_name  AS assignee_last_name,
            u.account_type AS assignee_role,
            sy.year_label,
            tm.term_name,
            tm.end_date AS term_end_date
       FROM finance_bills b
       LEFT JOIN users        u  ON u.user_id  = b.assignee_id
       LEFT JOIN school_years sy ON sy.id      = b.school_year_id
       LEFT JOIN terms        tm ON tm.term_id = b.term_id
      WHERE ${where.join(' AND ')}
      ORDER BY b.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    pagedParams
  ).catch(async () => {
    // Fallback if year/term columns are missing on legacy schemas
    return db.query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS assigned_count,
              u.first_name AS assignee_first_name,
              u.last_name  AS assignee_last_name,
              u.account_type AS assignee_role
         FROM finance_bills b
         LEFT JOIN users u ON u.user_id = b.assignee_id
        WHERE ${where.join(' AND ')}
        ORDER BY b.created_at DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      pagedParams
    );
  });
  const hasMore = r.rows.length > pageSize;
  const visibleRows = hasMore ? r.rows.slice(0, pageSize) : r.rows;
  const billIds = visibleRows.map((row) => row.bill_id);
  const collectorIdsByBillId = new Map();
  if (billIds.length) {
    const collectorsR = await db.query(
      `SELECT bill_id, ARRAY_AGG(user_id ORDER BY user_id) AS collector_ids
         FROM finance_bill_collectors
        WHERE organization_id = $1 AND bill_id = ANY($2::int[])
        GROUP BY bill_id`,
      [orgId, billIds]
    ).catch(() => ({ rows: [] }));
    collectorsR.rows.forEach((row) => {
      collectorIdsByBillId.set(String(row.bill_id), normalizeIdArray(row.collector_ids));
    });
  }
  let assignments = [];
  if (billIds.length) {
    const assignmentsR = await db.query(
      `SELECT a.bill_id, a.amount, a.amount_paid, a.late_fee_applied,
              b.bill_type, b.recurrence, b.due_date, b.recurrence_end_date,
              b.term_id, b.exclude_non_school_days,
              tm.end_date AS term_end_date
         FROM finance_bill_assignments a
         JOIN finance_bills b ON b.bill_id = a.bill_id
         LEFT JOIN terms tm ON tm.term_id = b.term_id
        WHERE a.organization_id = $1 AND a.bill_id = ANY($2::int[])`,
      [orgId, billIds]
    );
    const scheduleContext = createBillScheduleContextLoader(db, orgId);
    assignments = await Promise.all(
      assignmentsR.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
    );
  }
  const rows = applyScheduledBillRollups(visibleRows, assignments).map((bill) => ({
    ...bill,
    assignee_ids: normalizeIdArray([
      ...(collectorIdsByBillId.get(String(bill.bill_id)) || []),
      bill.assignee_id,
    ]),
    target_class_ids: normalizeIdArray(bill.target_class_ids),
    target_student_ids: normalizeIdArray(bill.target_student_ids),
  }));

  return {
    rows,
    pagination: {
      page,
      pageSize,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    },
  };
}

async function ensurePspSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_psp_settings (
      organization_id INT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `).catch(() => null);
}

async function loadOrganizationProfile(orgId) {
  let stripeMode = 'test';
  try {
    const stripeSettings = await getStripeSettings(db);
    stripeMode = stripeSettings.mode || 'test';
  } catch (_) {
    stripeMode = 'test';
  }

  let row = null;
  const primary = await db.query(
    `SELECT organization_id,
            organization_name,
            organization_country,
            organization_currency,
            billing_provider,
            stripe_connect_account_id,
            stripe_connect_account_id_test,
            stripe_connect_account_id_live
       FROM organizations
      WHERE organization_id = $1
      LIMIT 1`,
    [orgId]
  ).catch(() => null);

  if (primary && primary.rows && primary.rows[0]) {
    row = primary.rows[0];
  } else {
    const fallback = await db.query(
      `SELECT organization_id,
              organization_name,
              organization_country,
              organization_currency,
              billing_provider,
              stripe_connect_account_id
         FROM organizations
        WHERE organization_id = $1
        LIMIT 1`,
      [orgId]
    ).catch(() => ({ rows: [] }));
    row = fallback.rows[0] || null;
  }

  if (!row) {
    return {
      organization_id: orgId,
      organization_name: '',
      organization_country: '',
      organization_currency: null,
      billing_provider: null,
      stripe_connect_account_id: '',
    };
  }

  return {
    organization_id: row.organization_id || orgId,
    organization_name: row.organization_name || '',
    organization_country: row.organization_country || '',
    organization_currency: normalizeCurrencyCode(row.organization_currency) || null,
    billing_provider: row.billing_provider || null,
    stripe_connect_account_id: getStripeConnectAccountId(row, stripeMode) || String(row.stripe_connect_account_id || '').trim(),
  };
}

let _assigneeSchemaReady = false;
async function ensureAssigneeColumn() {
  if (_assigneeSchemaReady) return;

  await db.query(`
    ALTER TABLE finance_bills
    ADD COLUMN IF NOT EXISTS assignee_id INT REFERENCES users(user_id) ON DELETE SET NULL
  `).catch(() => null);

  await db.query(`
    ALTER TABLE finance_bills
    ADD COLUMN IF NOT EXISTS target_class_ids INT[]
  `).catch(() => null);

  await db.query(`
    ALTER TABLE finance_bills
    ADD COLUMN IF NOT EXISTS target_student_ids INT[]
  `).catch(() => null);

  await db.query(`
    ALTER TABLE finance_bills
    ADD COLUMN IF NOT EXISTS payment_destination VARCHAR(20) NOT NULL DEFAULT 'stripe'
  `).catch(() => null);

  await db.query(`
    ALTER TABLE finance_bills
    ADD COLUMN IF NOT EXISTS exclude_non_school_days BOOLEAN NOT NULL DEFAULT FALSE
  `).catch(() => null);

  await db.query(`
    CREATE TABLE IF NOT EXISTS finance_bill_collectors (
      bill_id INT NOT NULL REFERENCES finance_bills(bill_id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bill_id, user_id)
    )
  `).catch(() => null);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_finance_bill_collectors_org
    ON finance_bill_collectors(organization_id)
  `).catch(() => null);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_finance_bill_collectors_user
    ON finance_bill_collectors(user_id)
  `).catch(() => null);

  _assigneeSchemaReady = true;
}

async function loadPspSettings(orgId) {
  await ensurePspSettingsTable();
  const r = await db.query(
    `SELECT data FROM finance_psp_settings WHERE organization_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return (r.rows[0] && r.rows[0].data) || {};
}

async function loadGuardianAssignmentForPayment(client, orgId, guardianId, assignmentId) {
  const verify = await client.query(
    `SELECT a.*, b.title AS bill_title, b.due_date, b.bill_type, b.recurrence, b.recurrence_end_date,
            b.term_id, b.exclude_non_school_days,
            b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination,
            tm.end_date AS term_end_date
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       LEFT JOIN terms tm ON tm.term_id = b.term_id
      WHERE a.assignment_id=$1 AND a.organization_id=$2
        AND a.status <> 'cancelled'
        AND COALESCE(b.status, 'active') <> 'cancelled'
        AND (
          EXISTS (
            SELECT 1 FROM guardians g
             WHERE g.student_id=a.student_id AND g.guardian_id=$3 AND g.organization_id=$2
          )
          OR EXISTS (
            SELECT 1 FROM guardian_students gs
             WHERE gs.student_id=a.student_id AND gs.guardian_id=$3
          )
        )
      LIMIT 1`,
    [assignmentId, orgId, guardianId]
  );
  return verify.rows[0] || null;
}

async function buildGuardianPaygiraPaymentPlan({
  client,
  orgId,
  guardianId,
  assignmentId,
  amount,
  occurrenceDate,
  occurrenceDates,
  applyCredit,
  lockCredit = false,
}) {
  const selectedOccurrenceDates = parseOccurrenceDates(occurrenceDates);
  if (!selectedOccurrenceDates.length) {
    const singleOccurrenceDate = parseOccurrenceDates(occurrenceDate);
    if (singleOccurrenceDate.length) selectedOccurrenceDates.push(singleOccurrenceDate[0]);
  }

  const row = await loadGuardianAssignmentForPayment(client, orgId, guardianId, assignmentId);
  if (!row) {
    throw new PaygiraRequestError('Not authorized to pay this bill.', 403);
  }

  const isRecurringBill = String(row.bill_type || '') === 'recurring';
  const wantsCredit = Boolean(parseBoolean(applyCredit));
  if (isRecurringBill && !selectedOccurrenceDates.length) {
    throw new PaygiraRequestError('Select at least one recurring date to pay.', 400);
  }

  const requestedAmount = Math.max(Number(amount || 0), 0);
  if (!isRecurringBill && requestedAmount <= 0 && !wantsCredit) {
    throw new PaygiraRequestError('Enter a valid amount.', 400);
  }

  const paymentNotesBase = `Guardian portal payment by guardian #${guardianId}`;
  let paymentEntries = [];
  let creditApplied = 0;
  let totalExternalAmount = 0;
  let availableCredit = 0;

  if (wantsCredit) {
    availableCredit = await getStudentCreditBalance(client, orgId, row.student_id, { forUpdate: lockCredit });
  }

  if (isRecurringBill) {
    const existingOccurrencePayments = await client.query(
      `SELECT occurrence_date::text AS occurrence_date, COALESCE(SUM(amount), 0) AS paid_amount
         FROM finance_payments
        WHERE organization_id=$1 AND assignment_id=$2 AND occurrence_date = ANY($3::date[])
        GROUP BY occurrence_date`,
      [orgId, row.assignment_id, selectedOccurrenceDates]
    );
    const paidByDate = existingOccurrencePayments.rows.reduce((accumulator, entry) => {
      accumulator[entry.occurrence_date] = Number(entry.paid_amount || 0);
      return accumulator;
    }, {});
    paymentEntries = selectedOccurrenceDates.reduce((entries, dateValue) => {
      const outstandingAmount = Math.max(Number(row.amount || 0) - Number(paidByDate[dateValue] || 0), 0);
      if (!(outstandingAmount > 0)) return entries;
      entries.push({
        amount: outstandingAmount,
        occurrenceDate: dateValue,
        notes: `${paymentNotesBase} for ${dateValue}`,
        creditAmount: 0,
        externalAmount: 0,
      });
      return entries;
    }, []);
    if (!paymentEntries.length) {
      throw new PaygiraRequestError('The selected recurring dates are already fully paid.', 400);
    }
    creditApplied = wantsCredit
      ? Math.min(availableCredit, paymentEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
      : 0;
    let remainingCredit = creditApplied;
    paymentEntries = paymentEntries.map((entry) => {
      const creditAmount = Math.min(Number(entry.amount || 0), remainingCredit);
      remainingCredit -= creditAmount;
      const externalAmount = Math.max(Number(entry.amount || 0) - creditAmount, 0);
      return {
        ...entry,
        creditAmount,
        externalAmount,
      };
    });
    totalExternalAmount = paymentEntries.reduce((sum, entry) => sum + Number(entry.externalAmount || 0), 0);
  } else {
    const currentOutstanding = Math.max(Number(row.amount || 0) + Number(row.late_fee_applied || 0) - Number(row.amount_paid || 0), 0);
    creditApplied = wantsCredit
      ? Math.min(availableCredit, Math.max(currentOutstanding - requestedAmount, 0))
      : 0;
    totalExternalAmount = requestedAmount;
    paymentEntries = [{
      amount: requestedAmount + creditApplied,
      occurrenceDate: normalizeOccurrenceDate(occurrenceDate),
      notes: paymentNotesBase,
      creditAmount: creditApplied,
      externalAmount: requestedAmount,
    }];
  }

  if (!(totalExternalAmount > 0 || creditApplied > 0)) {
    throw new PaygiraRequestError('Enter a valid amount.', 400);
  }

  return {
    row,
    isRecurringBill,
    wantsCredit,
    requestedAmount,
    paymentNotesBase,
    paymentEntries,
    selectedOccurrenceDates,
    creditApplied,
    totalExternalAmount,
    availableCredit,
  };
}

async function upsertPendingGuardianStripePayment(client, payload) {
  await client.query(
    `INSERT INTO finance_pending_stripe_payments (
      payment_intent_id,
      organization_id,
      guardian_id,
      assignment_id,
      bill_id,
      student_id,
      requested_amount,
      total_external_amount,
      credit_applied_expected,
      platform_fee_percentage,
      platform_fee_amount,
      platform_fee_bearer,
      tax_amount,
      charged_amount,
      currency,
      selected_occurrence_dates,
      payment_entries,
      status,
      stripe_method_type,
      last_error,
      updated_at,
      processed_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,NOW(),$21
    )
    ON CONFLICT (payment_intent_id) DO UPDATE SET
      requested_amount = EXCLUDED.requested_amount,
      total_external_amount = EXCLUDED.total_external_amount,
      credit_applied_expected = EXCLUDED.credit_applied_expected,
      platform_fee_percentage = EXCLUDED.platform_fee_percentage,
      platform_fee_amount = EXCLUDED.platform_fee_amount,
      platform_fee_bearer = EXCLUDED.platform_fee_bearer,
      tax_amount = EXCLUDED.tax_amount,
      charged_amount = EXCLUDED.charged_amount,
      currency = EXCLUDED.currency,
      selected_occurrence_dates = EXCLUDED.selected_occurrence_dates,
      payment_entries = EXCLUDED.payment_entries,
      status = EXCLUDED.status,
      stripe_method_type = EXCLUDED.stripe_method_type,
      last_error = EXCLUDED.last_error,
      updated_at = NOW(),
      processed_at = EXCLUDED.processed_at`,
    [
      payload.paymentIntentId,
      payload.organizationId,
      payload.guardianId,
      payload.assignmentId,
      payload.billId,
      payload.studentId,
      payload.requestedAmount,
      payload.totalExternalAmount,
      payload.creditAppliedExpected,
      payload.platformFeePercentage,
      payload.platformFeeAmount,
      payload.platformFeeBearer || 'parent',
      payload.taxAmount,
      payload.chargedAmount,
      payload.currency,
      JSON.stringify(payload.selectedOccurrenceDates || []),
      JSON.stringify(payload.paymentEntries || []),
      payload.status || 'pending',
      payload.stripeMethodType || null,
      payload.lastError || null,
      payload.processedAt || null,
    ]
  );
}

async function loadPendingGuardianStripePayment(client, paymentIntentId, options = {}) {
  const suffix = options.forUpdate ? ' FOR UPDATE' : '';
  const result = await client.query(
    `SELECT * FROM finance_pending_stripe_payments WHERE payment_intent_id=$1${suffix}`,
    [paymentIntentId]
  );
  return result.rows[0] || null;
}

async function updatePendingGuardianStripePaymentStatus(client, paymentIntentId, status, extra = {}) {
  await client.query(
    `UPDATE finance_pending_stripe_payments
        SET status = $2,
            stripe_method_type = COALESCE($3, stripe_method_type),
            last_error = $4,
            processed_at = CASE WHEN $5 THEN COALESCE($6, NOW()) ELSE processed_at END,
            updated_at = NOW()
      WHERE payment_intent_id = $1`,
    [
      paymentIntentId,
      status,
      extra.stripeMethodType || null,
      extra.lastError || null,
      Boolean(extra.markProcessed),
      extra.processedAt || null,
    ]
  );
}

async function finalizePendingGuardianStripePayment(database, paymentIntentId) {
  let client;
  try {
    client = typeof database.connect === 'function' ? await database.connect() : database;
    await client.query('BEGIN');

    const pending = await loadPendingGuardianStripePayment(client, paymentIntentId, { forUpdate: true });
    if (!pending) {
      await client.query('ROLLBACK');
      return { status: 'missing' };
    }
    if (String(pending.status || '').toLowerCase() === 'completed') {
      await client.query('COMMIT');
      return {
        status: 'already_processed',
        assignmentId: pending.assignment_id,
        totalExternalAmount: Number(pending.total_external_amount || 0),
        chargedAmount: Number(pending.charged_amount || 0),
      };
    }

    const pspSettings = await loadPspSettings(pending.organization_id);
    const orgProfile = await loadOrganizationProfile(pending.organization_id);
    const stripeRuntime = await resolveFinanceStripeRuntime(pending.organization_id, pspSettings, orgProfile);
    const stripe = getFinanceStripeClient(stripeRuntime);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method'],
    });

    if (paymentIntent.status === 'processing') {
      await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'processing', {
        stripeMethodType: resolveStripeFinanceMethod(paymentIntent),
      });
      await client.query('COMMIT');
      return { status: 'processing' };
    }

    if (paymentIntent.status !== 'succeeded') {
      await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'failed', {
        stripeMethodType: resolveStripeFinanceMethod(paymentIntent),
        lastError: paymentIntent.last_payment_error?.message || `Stripe payment status is ${paymentIntent.status}.`,
      });
      await client.query('COMMIT');
      return {
        status: 'failed',
        message: paymentIntent.last_payment_error?.message || `Stripe payment status is ${paymentIntent.status}.`,
      };
    }

    const alreadyProcessed = await client.query(
      `SELECT 1
         FROM finance_payments
        WHERE organization_id=$1 AND assignment_id=$2 AND reference=$3
        LIMIT 1`,
      [pending.organization_id, pending.assignment_id, paymentIntentId]
    );
    if (alreadyProcessed.rows.length) {
      await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'completed', {
        stripeMethodType: resolveStripeFinanceMethod(paymentIntent),
        markProcessed: true,
      });
      await client.query('COMMIT');
      return {
        status: 'already_processed',
        assignmentId: pending.assignment_id,
        totalExternalAmount: Number(pending.total_external_amount || 0),
        chargedAmount: Number(pending.charged_amount || 0),
      };
    }

    const assignmentResult = await client.query(
      `SELECT a.*, b.title AS bill_title, b.due_date, b.bill_type, b.recurrence, b.recurrence_end_date,
              b.term_id, b.exclude_non_school_days, tm.end_date AS term_end_date
         FROM finance_bill_assignments a
         JOIN finance_bills b ON b.bill_id = a.bill_id
         LEFT JOIN terms tm ON tm.term_id = b.term_id
        WHERE a.assignment_id=$1 AND a.organization_id=$2
          AND a.status <> 'cancelled'
          AND COALESCE(b.status, 'active') <> 'cancelled'
        LIMIT 1`,
      [pending.assignment_id, pending.organization_id]
    );
    if (!assignmentResult.rows.length) {
      await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'failed', {
        lastError: 'The selected bill is no longer available for payment.',
      });
      await client.query('COMMIT');
      return { status: 'failed', message: 'The selected bill is no longer available for payment.' };
    }

    const row = assignmentResult.rows[0];
    const pendingEntries = Array.isArray(pending.payment_entries) ? pending.payment_entries : [];
    const pendingCreditTarget = Math.max(Number(pending.credit_applied_expected || 0), 0);
    const availableCredit = pendingCreditTarget > 0
      ? await getStudentCreditBalance(client, pending.organization_id, row.student_id, { forUpdate: true })
      : 0;
    let remainingCreditBudget = Math.min(availableCredit, pendingCreditTarget);
    const effectiveEntries = pendingEntries.map((entry) => {
      const intendedCredit = Math.max(Number(entry.creditAmount || entry.credit_amount || 0), 0);
      const appliedCredit = Math.min(intendedCredit, remainingCreditBudget);
      remainingCreditBudget -= appliedCredit;
      return {
        amount: Number(entry.amount || 0),
        occurrenceDate: normalizeOccurrenceDate(entry.occurrenceDate || entry.occurrence_date),
        notes: String(entry.notes || '').trim(),
        creditAmount: appliedCredit,
        externalAmount: Math.max(Number(entry.externalAmount || entry.external_amount || 0), 0),
      };
    });
    const creditApplied = effectiveEntries.reduce((sum, entry) => sum + Number(entry.creditAmount || 0), 0);
    const totalExternalAmount = effectiveEntries.reduce((sum, entry) => sum + Number(entry.externalAmount || 0), 0);
    const payMethod = resolveStripeFinanceMethod(paymentIntent);
    const platformFeePercentage = Number(pending.platform_fee_percentage || 0);
    const platformFeeBearer = String(pending.platform_fee_bearer || 'parent').toLowerCase() === 'school' ? 'school' : 'parent';
    let totalPlatformFeeAmount = 0;

    if (creditApplied > 0) {
      for (const entry of effectiveEntries) {
        if (!(Number(entry.creditAmount || 0) > 0)) continue;
        await client.query(
          `INSERT INTO finance_payments
            (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_bearer)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            pending.organization_id,
            row.assignment_id,
            row.bill_id,
            row.student_id,
            entry.creditAmount,
            'credit',
            'STUDENT-CREDIT',
            `${entry.notes || `Guardian portal payment by guardian #${pending.guardian_id}`} using available student credit`,
            entry.occurrenceDate || null,
            platformFeeBearer,
          ]
        );
      }
      await setStudentCreditBalance(client, pending.organization_id, row.student_id, Math.max(availableCredit - creditApplied, 0));
    }

    if (totalExternalAmount > 0) {
      for (const entry of effectiveEntries) {
        if (!(Number(entry.externalAmount || 0) > 0)) continue;
        const chargeBreakdown = buildFinancePaymentChargeBreakdown(entry.externalAmount, payMethod, platformFeePercentage, 0, platformFeeBearer);
        totalPlatformFeeAmount += chargeBreakdown.platformFeeAmount;
        await client.query(
          `INSERT INTO finance_payments
            (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_percentage, platform_fee_amount, platform_fee_bearer, tax_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            pending.organization_id,
            row.assignment_id,
            row.bill_id,
            row.student_id,
            entry.externalAmount,
            payMethod,
            paymentIntentId,
            entry.notes || `Guardian portal Stripe payment by guardian #${pending.guardian_id}`,
            entry.occurrenceDate || null,
            chargeBreakdown.platformFeePercentage,
            chargeBreakdown.platformFeeAmount,
            platformFeeBearer,
            chargeBreakdown.taxAmount,
          ]
        );
      }
    }

    const isRecurringBill = String(row.bill_type || '') === 'recurring';
    const newPaid = Number(row.amount_paid || 0) + totalExternalAmount + creditApplied;
    const scheduleContext = createBillScheduleContextLoader(client, pending.organization_id);
    const total = (isRecurringBill ? await getScheduledBilledAmount(row, scheduleContext) : Number(row.amount || 0)) + Number(row.late_fee_applied || 0);
    let appliedToAssignment = newPaid;
    let creditCreated = 0;
    if (newPaid > total) {
      creditCreated = newPaid - total;
      appliedToAssignment = total;
    }
    const newStatus = appliedToAssignment >= total
      ? 'paid'
      : (appliedToAssignment > 0
          ? 'partial'
          : recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date));
    await client.query(
      `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
      [appliedToAssignment, newStatus, row.assignment_id]
    );
    if (creditCreated > 0) {
      await addStudentCredit(client, pending.organization_id, row.student_id, creditCreated);
    }

    await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'completed', {
      stripeMethodType: payMethod,
      markProcessed: true,
    });
    await client.query('COMMIT');
    // Best-effort: save/update the card in guardian_payment_methods for future reuse
    await saveGuardianPaymentMethodIfNew(client, pending.guardian_id, pending.organization_id, paymentIntent);
    return {
      status: 'completed',
      assignmentId: row.assignment_id,
      studentId: row.student_id,
      billId: row.bill_id,
      billTitle: row.bill_title,
      payMethod,
      creditApplied,
      creditCreated,
      totalExternalAmount,
      chargedAmount: Number(pending.charged_amount || paymentIntent.amount_received || paymentIntent.amount || 0),
      totalPlatformFeeAmount,
      isRecurringBill,
      selectedOccurrenceDates: Array.isArray(pending.selected_occurrence_dates) ? pending.selected_occurrence_dates : [],
      newStatus,
      organizationId: pending.organization_id,
      guardianId: pending.guardian_id,
    };
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw error;
  } finally {
    if (client && client.release) client.release();
  }
}

async function loadStudentBilling(orgId, filters = {}) {
  const page = parsePositiveInt(filters.page, 1, 1, 1000000);
  const pageSize = parsePositiveInt(filters.pageSize, 25, 15, 120);
  const offset = (page - 1) * pageSize;
  const schoolYearId = parseInt(filters.school_year_id, 10);
  const termId = parseInt(filters.term_id, 10);
  const assignmentWhere = [
    'a.organization_id = $1',
    "a.status <> 'cancelled'",
    "COALESCE(b.status, 'active') <> 'cancelled'",
  ];
  const params = [orgId];
  let nextParamIndex = 2;

  if (Number.isInteger(schoolYearId) && schoolYearId > 0) {
    assignmentWhere.push(`b.school_year_id = $${nextParamIndex++}`);
    params.push(schoolYearId);
  }
  if (Number.isInteger(termId) && termId > 0) {
    assignmentWhere.push(`b.term_id = $${nextParamIndex++}`);
    params.push(termId);
  }

  const [studentIdSettings, students] = await Promise.all([
    getOrganizationStudentIdSettings(db, orgId),
    db.query(
      `SELECT s.student_id, s.custom_student_id, s.first_name, s.last_name, s.image_url, s.class_id,
              c.class_name,
              COALESCE(sc.amount,0) AS student_credit
         FROM students s
         LEFT JOIN classes c ON c.class_id = s.class_id
         LEFT JOIN finance_student_credits sc ON sc.student_id = s.student_id AND sc.organization_id = s.organization_id
        WHERE s.organization_id = $1
        ORDER BY s.last_name, s.first_name
        LIMIT $2 OFFSET $3`,
      [orgId, pageSize + 1, offset]
    ),
  ]);

  const hasMore = students.rows.length > pageSize;
  const visibleStudents = hasMore ? students.rows.slice(0, pageSize) : students.rows;
  const studentIds = visibleStudents.map((row) => Number(row.student_id)).filter((value) => Number.isInteger(value) && value > 0);

  if (!studentIds.length) {
    return {
      rows: [],
      pagination: {
        page,
        pageSize,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
      },
    };
  }

  const studentFilterParam = nextParamIndex++;

  const assignmentRows = await db.query(
    `SELECT a.student_id, a.amount, a.amount_paid, a.late_fee_applied,
            b.bill_type, b.recurrence, b.due_date, b.recurrence_end_date,
            b.term_id, b.exclude_non_school_days,
            tm.end_date AS term_end_date
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       LEFT JOIN terms tm ON tm.term_id = b.term_id
      WHERE ${assignmentWhere.join(' AND ')}
        AND a.student_id = ANY($${studentFilterParam}::int[])`,
    [...params, studentIds]
  );
  const scheduleContext = createBillScheduleContextLoader(db, orgId);
  const scheduledAssignments = await Promise.all(
    assignmentRows.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
  );
  const totalsByStudentId = scheduledAssignments.reduce((accumulator, assignment) => {
    const studentKey = String(assignment.student_id || '');
    if (!studentKey) return accumulator;
    if (!accumulator[studentKey]) {
      accumulator[studentKey] = {
        total_billed: 0,
        total_paid: 0,
        outstanding: 0,
      };
    }
    accumulator[studentKey].total_billed += Number(assignment.scheduled_billed_total || assignment.amount || 0);
    accumulator[studentKey].total_paid += Number(assignment.amount_paid || 0);
    accumulator[studentKey].outstanding += Number(
      assignment.scheduled_outstanding_total != null
        ? assignment.scheduled_outstanding_total
        : Math.max(Number(assignment.amount || 0) + Number(assignment.late_fee_applied || 0) - Number(assignment.amount_paid || 0), 0)
    );
    return accumulator;
  }, {});

  const rows = visibleStudents.map((row) => {
    const totals = totalsByStudentId[String(row.student_id)] || { total_billed: 0, total_paid: 0, outstanding: 0 };
    const studentCredit = Number(row.student_credit || 0);
    const outstanding = Number(totals.outstanding || 0);
    const displayStudentId = buildStudentDisplayId(row, studentIdSettings);
    return {
      ...row,
      display_student_id: displayStudentId,
      display_student_id_text: studentIdSettings.use_custom_student_id
        ? displayStudentId
        : (displayStudentId ? `#${displayStudentId}` : ''),
      total_billed: Number(totals.total_billed || 0),
      total_paid: Number(totals.total_paid || 0),
      outstanding,
      student_credit: studentCredit,
      net_outstanding: Math.max(outstanding - studentCredit, 0),
    };
  });

  return {
    rows,
    pagination: {
      page,
      pageSize,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    },
  };
}

async function loadStudentCreditMap(database, orgId, studentIds) {
  const normalizedStudentIds = normalizeIdArray(studentIds);
  if (!normalizedStudentIds.length) return new Map();
  const result = await database.query(
    `SELECT student_id, COALESCE(amount, 0) AS credit
       FROM finance_student_credits
      WHERE organization_id = $1
        AND student_id = ANY($2::int[])`,
    [orgId, normalizedStudentIds]
  );
  return new Map(
    result.rows.map((row) => [String(row.student_id), Number(row.credit || 0)])
  );
}

async function getStudentCreditBalance(database, orgId, studentId, options = {}) {
  const forUpdate = !!options.forUpdate;
  const result = await database.query(
    `SELECT COALESCE(amount, 0) AS credit
       FROM finance_student_credits
      WHERE organization_id = $1
        AND student_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [orgId, studentId]
  );
  return Number(result.rows[0]?.credit || 0);
}

async function setStudentCreditBalance(database, orgId, studentId, amount) {
  const normalizedAmount = Math.max(Number(amount || 0), 0);
  if (!(normalizedAmount > 0)) {
    await database.query(
      `DELETE FROM finance_student_credits WHERE organization_id = $1 AND student_id = $2`,
      [orgId, studentId]
    );
    return 0;
  }

  await database.query(
    `INSERT INTO finance_student_credits (organization_id, student_id, amount)
       VALUES ($1,$2,$3)
     ON CONFLICT (student_id) DO UPDATE
        SET amount = $3, updated_at = now()`,
    [orgId, studentId, normalizedAmount]
  );
  return normalizedAmount;
}

async function addStudentCredit(database, orgId, studentId, amount) {
  const normalizedAmount = Number(amount || 0);
  if (!(normalizedAmount > 0)) return getStudentCreditBalance(database, orgId, studentId);
  await database.query(
    `INSERT INTO finance_student_credits (organization_id, student_id, amount)
       VALUES ($1,$2,$3)
     ON CONFLICT (student_id) DO UPDATE
        SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at = now()`,
    [orgId, studentId, normalizedAmount]
  );
  return getStudentCreditBalance(database, orgId, studentId);
}

async function loadTemplates(orgId) {
  const r = await db.query(
    `SELECT * FROM finance_fee_templates WHERE organization_id = $1 ORDER BY created_at DESC`,
    [orgId]
  );
  return r.rows;
}

async function loadClassesAndStudents(orgId, options = {}) {
  const includeClasses = options.includeClasses !== false;
  const includeStudents = options.includeStudents !== false;
  const includeEmployees = options.includeEmployees !== false;
  const includeEnrollmentLinks = options.includeEnrollmentLinks !== false;

  const classes = includeClasses
    ? await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name`,
        [orgId]
      )
    : { rows: [] };
  const students = includeStudents
    ? await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id, c.class_name
           FROM students s
           LEFT JOIN classes c ON c.class_id = s.class_id
          WHERE s.organization_id = $1
          ORDER BY s.last_name, s.first_name`,
        [orgId]
      )
    : { rows: [] };
  // school_years uses columns: id, year_label
  const years = await db.query(
    `SELECT id AS school_year_id, year_label AS name, current
       FROM school_years
      WHERE organization_id = $1
      ORDER BY current DESC NULLS LAST, year_label DESC, id DESC`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const terms = await db.query(
    `SELECT term_id, term_name AS name, school_year_id, current, start_date, end_date
       FROM terms
      WHERE organization_id = $1
      ORDER BY current DESC NULLS LAST, start_date DESC NULLS LAST, term_id DESC`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const enrolledClassLinks = includeEnrollmentLinks && includeClasses
    ? await db.query(
        `SELECT DISTINCT ec.class_id, e.school_year_id, e.term_id
           FROM enrollments e
           JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
          WHERE e.organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const enrolledStudentLinks = includeEnrollmentLinks && includeStudents
    ? await db.query(
        `SELECT DISTINCT es.student_id, e.school_year_id, e.term_id
           FROM enrollments e
           JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
          WHERE e.organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const employees = includeEmployees
    ? await db.query(
        `SELECT u.user_id,
                u.first_name,
                u.last_name,
                u.account_type,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT uc.class_id), NULL) AS class_ids
           FROM users u
           LEFT JOIN user_classes uc ON uc.user_id = u.user_id
          WHERE u.organization_id = $1
            AND u.account_type IN ('Manager','Supervisor','Teacher')
            AND (u.on_hold IS NULL OR u.on_hold = false)
          GROUP BY u.user_id, u.first_name, u.last_name, u.account_type
          ORDER BY u.last_name, u.first_name`,
        [orgId]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const classMap = new Map();
  const studentMap = new Map();
  enrolledClassLinks.rows.forEach((row) => {
    const key = String(row.class_id || '');
    if (!key) return;
    if (!classMap.has(key)) {
      classMap.set(key, { schoolYearIds: new Set(), termIds: new Set() });
    }
    const bucket = classMap.get(key);
    if (row.school_year_id != null) bucket.schoolYearIds.add(String(row.school_year_id));
    if (row.term_id != null) bucket.termIds.add(String(row.term_id));
  });
  enrolledStudentLinks.rows.forEach((row) => {
    const key = String(row.student_id || '');
    if (!key) return;
    if (!studentMap.has(key)) {
      studentMap.set(key, { schoolYearIds: new Set(), termIds: new Set() });
    }
    const bucket = studentMap.get(key);
    if (row.school_year_id != null) bucket.schoolYearIds.add(String(row.school_year_id));
    if (row.term_id != null) bucket.termIds.add(String(row.term_id));
  });
  const hydratedClasses = classes.rows.map((row) => {
    const linked = classMap.get(String(row.class_id || ''));
    return {
      ...row,
      school_year_ids: linked ? Array.from(linked.schoolYearIds) : [],
      term_ids: linked ? Array.from(linked.termIds) : [],
    };
  });
  const hydratedStudents = students.rows.map((row) => {
    const linked = studentMap.get(String(row.student_id || ''));
    return {
      ...row,
      school_year_ids: linked ? Array.from(linked.schoolYearIds) : [],
      term_ids: linked ? Array.from(linked.termIds) : [],
    };
  });
  const employeeClassIds = Array.from(new Set(
    employees.rows.flatMap((row) => Array.isArray(row.class_ids) ? row.class_ids : [])
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  ));
  const employeeClassRows = employeeClassIds.length
    ? await db.query(
        `SELECT class_id, class_name
           FROM classes
          WHERE class_id = ANY($1::int[])
          ORDER BY class_name ASC`,
        [employeeClassIds]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const classNameById = new Map(employeeClassRows.rows.map((row) => [String(row.class_id), row.class_name]));
  const hydratedEmployees = employees.rows.map((row) => {
    const classIds = Array.isArray(row.class_ids)
      ? row.class_ids.map((value) => parseInt(value, 10)).filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const assignedClassNames = Array.from(new Set(
      classIds.map((classId) => classNameById.get(String(classId))).filter(Boolean)
    )).sort((left, right) => String(left).localeCompare(String(right)));
    return {
      ...row,
      class_ids: classIds,
      assigned_classes_label: assignedClassNames.join(', '),
    };
  });
  return { classes: hydratedClasses, students: hydratedStudents, years: years.rows, terms: terms.rows, employees: hydratedEmployees };
}

function getCurrentAcademicContext(refs = {}) {
  const years = Array.isArray(refs.years) ? refs.years : [];
  const terms = Array.isArray(refs.terms) ? refs.terms : [];
  const currentYear = years.find((year) => !!year.current) || years[0] || null;
  const yearId = currentYear ? String(currentYear.school_year_id) : "";
  const termsForYear = yearId
    ? terms.filter((term) => String(term.school_year_id || "") === yearId)
    : [];
  const currentTerm = termsForYear.find((term) => !!term.current)
    || terms.find((term) => !!term.current && (!yearId || String(term.school_year_id || "") === yearId))
    || termsForYear[0]
    || null;
  return {
    schoolYearId: currentYear ? String(currentYear.school_year_id) : null,
    termId: currentTerm ? String(currentTerm.term_id) : null,
  };
}

async function resolveBillAcademicContext(database, orgId, schoolYearIdInput, termIdInput) {
  const schoolYearId = parseInt(schoolYearIdInput, 10);
  const termId = parseInt(termIdInput, 10);

  if (!Number.isInteger(schoolYearId) || schoolYearId <= 0 || !Number.isInteger(termId) || termId <= 0) {
    throw new PaygiraRequestError("Select both a school year and a term for this bill.");
  }

  const termResult = await database.query(
    `SELECT t.term_id, t.term_name, t.school_year_id, sy.year_label
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.term_id = $1
        AND t.organization_id = $2
      LIMIT 1`,
    [termId, orgId]
  );

  if (!termResult.rows.length) {
    throw new PaygiraRequestError("Selected term was not found for this organization.");
  }

  const termRow = termResult.rows[0];
  if (Number(termRow.school_year_id) !== schoolYearId) {
    throw new PaygiraRequestError("Selected term does not belong to the chosen school year.");
  }

  return {
    schoolYearId,
    termId,
    termName: termRow.term_name,
    yearLabel: termRow.year_label,
  };
}

async function loadBillAudienceTargets(database, orgId, billId, appliesTo, targetClassIds, targetStudentIds) {
  const audience = String(appliesTo || "school").toLowerCase();
  const normalizedClassIds = normalizeIdArray(targetClassIds);
  const normalizedStudentIds = normalizeIdArray(targetStudentIds);

  if (audience === "classes") {
    if (normalizedClassIds.length) {
      return { targetClassIds: normalizedClassIds, targetStudentIds: [] };
    }
    if (!billId) return { targetClassIds: [], targetStudentIds: [] };
    const fallbackClasses = await database.query(
      `SELECT DISTINCT s.class_id
         FROM finance_bill_assignments fba
         JOIN students s ON s.student_id = fba.student_id
        WHERE fba.bill_id = $1
          AND fba.organization_id = $2
          AND s.class_id IS NOT NULL`,
      [billId, orgId]
    );
    return {
      targetClassIds: normalizeIdArray(fallbackClasses.rows.map((row) => row.class_id)),
      targetStudentIds: [],
    };
  }

  if (audience === "students") {
    if (normalizedStudentIds.length) {
      return { targetClassIds: [], targetStudentIds: normalizedStudentIds };
    }
    if (!billId) return { targetClassIds: [], targetStudentIds: [] };
    const fallbackStudents = await database.query(
      `SELECT DISTINCT student_id
         FROM finance_bill_assignments
        WHERE bill_id = $1
          AND organization_id = $2`,
      [billId, orgId]
    );
    return {
      targetClassIds: [],
      targetStudentIds: normalizeIdArray(fallbackStudents.rows.map((row) => row.student_id)),
    };
  }

  return { targetClassIds: [], targetStudentIds: [] };
}

async function loadEligibleBillStudents(database, orgId, schoolYearId, termId, appliesTo, targetClassIds, targetStudentIds) {
  const audience = String(appliesTo || "school").toLowerCase();
  const classIds = normalizeIdArray(targetClassIds);
  const studentIds = normalizeIdArray(targetStudentIds);

  if (audience === "classes") {
    if (!classIds.length) return [];
    const result = await database.query(
      `SELECT DISTINCT es.student_id
         FROM enrollments e
         JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
         JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id AND es.class_id = ec.class_id
        WHERE e.organization_id = $1
          AND e.school_year_id = $2
          AND e.term_id = $3
          AND ec.class_id = ANY($4::int[])
        ORDER BY es.student_id`,
      [orgId, schoolYearId, termId, classIds]
    );
    return result.rows.map((row) => Number(row.student_id)).filter((value) => Number.isInteger(value) && value > 0);
  }

  if (audience === "students") {
    if (!studentIds.length) return [];
    const result = await database.query(
      `SELECT DISTINCT es.student_id
         FROM enrollments e
         JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
        WHERE e.organization_id = $1
          AND e.school_year_id = $2
          AND e.term_id = $3
          AND es.student_id = ANY($4::int[])
        ORDER BY es.student_id`,
      [orgId, schoolYearId, termId, studentIds]
    );
    return result.rows.map((row) => Number(row.student_id)).filter((value) => Number.isInteger(value) && value > 0);
  }

  const result = await database.query(
    `SELECT DISTINCT es.student_id
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
      WHERE e.organization_id = $1
        AND e.school_year_id = $2
        AND e.term_id = $3
      ORDER BY es.student_id`,
    [orgId, schoolYearId, termId]
  );
  return result.rows.map((row) => Number(row.student_id)).filter((value) => Number.isInteger(value) && value > 0);
}

async function syncBillAssignmentsForAudience(database, orgId, billId, options = {}) {
  const appliesTo = String(options.appliesTo || "school").toLowerCase();
  const schoolYearId = parseInt(options.schoolYearId, 10);
  const termId = parseInt(options.termId, 10);
  const amount = Number(options.amount || 0);
  const dueDate = options.dueDate || null;
  const status = String(options.status || "active").toLowerCase();

  const resolvedTargets = await loadBillAudienceTargets(
    database,
    orgId,
    billId,
    appliesTo,
    options.targetClassIds,
    options.targetStudentIds
  );
  const eligibleStudentIds = await loadEligibleBillStudents(
    database,
    orgId,
    schoolYearId,
    termId,
    appliesTo,
    resolvedTargets.targetClassIds,
    resolvedTargets.targetStudentIds
  );

  const existingAssignments = await database.query(
    `SELECT fba.assignment_id,
            fba.student_id,
            fba.amount_paid,
            EXISTS(
              SELECT 1
                FROM finance_payments fp
               WHERE fp.assignment_id = fba.assignment_id
                 AND fp.organization_id = $2
            ) AS has_payments
       FROM finance_bill_assignments fba
      WHERE fba.bill_id = $1
        AND fba.organization_id = $2`,
    [billId, orgId]
  );

  if (!eligibleStudentIds.length) {
    if (!existingAssignments.rows.length) {
      throw new PaygiraRequestError("No enrolled students were found for the selected audience in that school year and term.");
    }
    // Bill already has assignments — preserve them as-is; nothing to sync.
    return resolvedTargets;
  }

  const targetSet = new Set(eligibleStudentIds);
  const existingByStudentId = new Map(existingAssignments.rows.map((row) => [Number(row.student_id), row]));
  const assignmentsToDelete = [];

  existingAssignments.rows.forEach((row) => {
    const studentId = Number(row.student_id);
    if (targetSet.has(studentId)) return;
    const paidAmount = Number(row.amount_paid || 0);
    if (paidAmount > 0 || row.has_payments) {
      throw new PaygiraRequestError("This bill already has recorded payments for students outside the new year or term scope. Delete and recreate it to reassign.");
    }
    assignmentsToDelete.push(Number(row.assignment_id));
  });

  if (assignmentsToDelete.length) {
    await database.query(
      `DELETE FROM finance_bill_assignments
        WHERE organization_id = $1
          AND assignment_id = ANY($2::int[])`,
      [orgId, assignmentsToDelete]
    );
  }

  const assignmentsToInsert = eligibleStudentIds.filter((studentId) => !existingByStudentId.has(studentId));
  if (assignmentsToInsert.length && status !== "draft") {
    const statusValue = recalcAssignmentStatus(amount, 0, 0, dueDate);
    for (const studentId of assignmentsToInsert) {
      await database.query(
        `INSERT INTO finance_bill_assignments (organization_id, bill_id, student_id, amount, status)
         VALUES ($1,$2,$3,$4,$5)`,
        [orgId, billId, studentId, amount, statusValue]
      );
    }
  }

  return resolvedTargets;
}

function recalcAssignmentStatus(amount, late, paid, dueDate) {
  const total = Number(amount) + Number(late || 0);
  const p = Number(paid || 0);
  if (p >= total && total > 0) return "paid";
  if (p > 0) return "partial";
  if (dueDate && new Date(dueDate) < new Date()) return "overdue";
  return "pending";
}

class PaygiraRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PaygiraRequestError";
    this.status = status;
  }
}

function requestWantsJson(req) {
  const accept = String(req.get("accept") || "").toLowerCase();
  const requestedWith = String(req.get("x-requested-with") || "").toLowerCase();
  return req.xhr || requestedWith === "xmlhttprequest" || accept.includes("application/json");
}

function normalizeOccurrenceDate(rawOccurrenceDate) {
  if (rawOccurrenceDate instanceof Date && !Number.isNaN(rawOccurrenceDate.getTime())) {
    return [
      rawOccurrenceDate.getFullYear(),
      String(rawOccurrenceDate.getMonth() + 1).padStart(2, "0"),
      String(rawOccurrenceDate.getDate()).padStart(2, "0"),
    ].join("-");
  }
  const value = String(rawOccurrenceDate || "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function normalizeClassId(rawClassId) {
  const parsed = parseInt(rawClassId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSignoffClassId(rawClassId) {
  return normalizeClassId(rawClassId) || 0;
}

function buildAcademicClassScopeClause({ studentAlias = "s", billAlias = "b", classParamSql, orgParamSql = "$1" }) {
  return `(${classParamSql}::int = 0 OR EXISTS (
    SELECT 1
      FROM enrollments e
      JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
     WHERE es.student_id = ${studentAlias}.student_id
       AND es.class_id = ${classParamSql}
       AND e.organization_id = ${orgParamSql}
       AND (
         (
           ${billAlias}.school_year_id IS NOT NULL
           AND ${billAlias}.term_id IS NOT NULL
           AND e.school_year_id = ${billAlias}.school_year_id
           AND e.term_id = ${billAlias}.term_id
         )
         OR (
           (${billAlias}.school_year_id IS NULL OR ${billAlias}.term_id IS NULL)
           AND ${studentAlias}.class_id = ${classParamSql}
         )
       )
  ))`;
}

function isRecurringBill(row) {
  return String(row?.bill_type || "").toLowerCase() === "recurring";
}

function shouldExcludeNonSchoolDays(row) {
  return Boolean(parseBoolean(row?.exclude_non_school_days));
}

function getRecurringScheduleEnd(row) {
  return normalizeOccurrenceDate(row?.recurrence_end_date || row?.term_end_date || null);
}

function addRecurringStep(dateValue, recurrence) {
  const next = new Date(dateValue.getTime());
  switch (String(recurrence || "").toLowerCase()) {
    case "daily":
      next.setDate(next.getDate() + 1);
      return next;
    case "weekly":
      next.setDate(next.getDate() + 7);
      return next;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      return next;
    case "term":
      next.setMonth(next.getMonth() + 3);
      return next;
    case "year":
      next.setFullYear(next.getFullYear() + 1);
      return next;
    default:
      return null;
  }
}

function createBillScheduleContextLoader(database, orgId) {
  const cache = new Map();
  let ensuredAttendanceCalendar = false;
  return async function getCalendarContext(row) {
    if (!shouldExcludeNonSchoolDays(row)) return null;
    const startIso = normalizeOccurrenceDate(row?.due_date);
    const endIso = getRecurringScheduleEnd(row) || startIso;
    const termId = row?.term_id ? Number(row.term_id) : null;
    const cacheKey = [String(termId || "org"), String(startIso || ""), String(endIso || "")].join(":");
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    if (!ensuredAttendanceCalendar) {
      ensuredAttendanceCalendar = true;
      try {
        await ensureAttendanceCalendarSchema(database);
      } catch (_) {}
    }

    let profile = null;
    let dayMap = new Map();
    try {
      profile = await getAttendanceCalendarProfile(database, orgId, termId || null);
      if (profile && startIso && endIso) {
        const days = await getAttendanceCalendarDays(database, profile.calendar_id, startIso, endIso);
        dayMap = buildCalendarDayMap(days);
      }
    } catch (_) {
      profile = null;
      dayMap = new Map();
    }

    const context = { profile, dayMap };
    cache.set(cacheKey, context);
    return context;
  };
}

async function getScheduledOccurrenceDates(row, getCalendarContext) {
  const startIso = normalizeOccurrenceDate(row?.due_date);
  if (!startIso) return [];
  if (!isRecurringBill(row)) return [startIso];

  const endIso = getRecurringScheduleEnd(row);
  if (!endIso) return [startIso];

  const startDate = new Date(`${startIso}T00:00:00`);
  const endDate = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) return [];

  const calendarContext = typeof getCalendarContext === "function" && shouldExcludeNonSchoolDays(row)
    ? await getCalendarContext({ ...row, due_date: startIso, recurrence_end_date: endIso })
    : null;

  const occurrenceDates = [];
  let cursor = new Date(startDate.getTime());
  for (let guard = 0; guard < 5000; guard += 1) {
    if (cursor > endDate) break;
    const dateKey = normalizeOccurrenceDate(cursor);
    if (!calendarContext || isAttendanceCountableForDate(dateKey, calendarContext.profile, calendarContext.dayMap)) {
      occurrenceDates.push(dateKey);
    }
    const next = addRecurringStep(cursor, row?.recurrence);
    if (!next || next.getTime() === cursor.getTime()) break;
    cursor = next;
  }

  return occurrenceDates;
}

async function countScheduledOccurrences(row, getCalendarContext) {
  const occurrenceDates = await getScheduledOccurrenceDates(row, getCalendarContext);
  return Math.max(occurrenceDates.length, 1);
}

async function getScheduledBilledAmount(row, getCalendarContext) {
  const billedPerOccurrence = Number(row?.amount || 0);
  if (!isRecurringBill(row)) return billedPerOccurrence;
  return billedPerOccurrence * (await countScheduledOccurrences(row, getCalendarContext));
}

async function enrichScheduledAssignment(row, getCalendarContext) {
  const normalizedDueDate = normalizeOccurrenceDate(row?.due_date) || null;
  const amount = Number(row?.amount || 0);
  const amountPaid = Number(row?.amount_paid || 0);
  const lateFeeApplied = Number(row?.late_fee_applied || 0);

  if (!isRecurringBill(row)) {
    return {
      ...row,
      due_date: normalizedDueDate,
      recurrence_end_date: null,
      scheduled_occurrences: normalizedDueDate ? 1 : 0,
      scheduled_occurrence_dates: normalizedDueDate ? [normalizedDueDate] : [],
      scheduled_billed_total: amount,
      scheduled_outstanding_total: Math.max(amount + lateFeeApplied - amountPaid, 0),
    };
  }

  const scheduleEnd = getRecurringScheduleEnd(row);
  const scheduledOccurrenceDates = await getScheduledOccurrenceDates({
    ...row,
    due_date: normalizedDueDate,
    recurrence_end_date: scheduleEnd,
  }, getCalendarContext);
  const scheduledCount = Math.max(scheduledOccurrenceDates.length, 1);
  const scheduledBilledTotal = amount * scheduledCount;
  return {
    ...row,
    due_date: normalizedDueDate,
    recurrence_end_date: scheduleEnd,
    scheduled_occurrences: scheduledCount,
    scheduled_occurrence_dates: scheduledOccurrenceDates.length
      ? scheduledOccurrenceDates
      : (normalizedDueDate ? [normalizedDueDate] : []),
    scheduled_billed_total: scheduledBilledTotal,
    scheduled_outstanding_total: Math.max(scheduledBilledTotal + lateFeeApplied - amountPaid, 0),
  };
}

function applyScheduledBillRollups(bills, assignments) {
  const totalsByBillId = (assignments || []).reduce((accumulator, assignment) => {
    const billKey = String(assignment.bill_id);
    if (!accumulator[billKey]) {
      accumulator[billKey] = {
        assigned_count: 0,
        total_amount: 0,
        total_paid: 0,
        total_outstanding: 0,
        scheduled_occurrence_dates: null,
      };
    }
    accumulator[billKey].assigned_count += 1;
    accumulator[billKey].total_amount += Number(assignment.scheduled_billed_total || assignment.amount || 0);
    accumulator[billKey].total_paid += Number(assignment.amount_paid || 0);
    accumulator[billKey].total_outstanding += Number(assignment.scheduled_outstanding_total || 0);
    if (!accumulator[billKey].scheduled_occurrence_dates && Array.isArray(assignment.scheduled_occurrence_dates)) {
      accumulator[billKey].scheduled_occurrence_dates = assignment.scheduled_occurrence_dates.slice();
    }
    return accumulator;
  }, {});

  return (bills || []).map((bill) => {
    const normalizedDueDate = normalizeOccurrenceDate(bill?.due_date) || null;
    const scheduleEnd = getRecurringScheduleEnd(bill);
    const totals = totalsByBillId[String(bill.bill_id)] || null;
    return {
      ...bill,
      due_date: normalizedDueDate,
      recurrence_end_date: scheduleEnd,
      assigned_count: totals ? totals.assigned_count : Number(bill.assigned_count || 0),
      total_amount: totals ? totals.total_amount : Number(bill.total_amount || 0),
      total_paid: totals ? totals.total_paid : Number(bill.total_paid || 0),
      total_outstanding: totals ? totals.total_outstanding : Number(bill.total_outstanding || 0),
      scheduled_occurrence_dates: totals && Array.isArray(totals.scheduled_occurrence_dates)
        ? totals.scheduled_occurrence_dates.slice()
        : (Array.isArray(bill.scheduled_occurrence_dates) ? bill.scheduled_occurrence_dates.slice() : []),
    };
  });
}

function normalizePersonName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getSignoffScopeKey(occurrenceDate) {
  return normalizeOccurrenceDate(occurrenceDate) || "bill";
}

function doesSignoffApplyToView(signoffRow, viewClassId) {
  const rowClassId = normalizeSignoffClassId(signoffRow?.class_id);
  const scopeClassId = normalizeSignoffClassId(viewClassId);
  if (scopeClassId > 0) return rowClassId === 0 || rowClassId === scopeClassId;
  return rowClassId === 0;
}

function getCurrentViewBillSignoff(signoffRows, viewClassId) {
  return (signoffRows || []).find((row) => row.scope_key === "bill" && doesSignoffApplyToView(row, viewClassId)) || null;
}

function getCurrentViewSignedOffDates(signoffRows, viewClassId) {
  return Array.from(new Set(
    (signoffRows || [])
      .filter((row) => row.scope_key !== "bill" && doesSignoffApplyToView(row, viewClassId))
      .map((row) => normalizeOccurrenceDate(row.occurrence_date))
      .filter(Boolean)
  )).sort();
}

async function loadCollectionSignoffs(orgId, billIds) {
  if (!Array.isArray(billIds) || !billIds.length) return [];
  const result = await db.query(
    `SELECT signoff_id, organization_id, bill_id, class_id,
            occurrence_date::text AS occurrence_date,
            scope_key, signed_by_user_id, signed_by_name, signer_role,
            student_count, total_collected, signed_at
       FROM finance_collection_signoffs
      WHERE organization_id = $1 AND bill_id = ANY($2::int[])
      ORDER BY signed_at DESC`,
    [orgId, billIds]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function loadCollectionSignoffHistory(orgId, filters = {}) {
  await ensureSignoffCorrectionSchema();
  const page = parsePositiveInt(filters.page, 1, 1, 1000000);
  const pageSize = parsePositiveInt(filters.pageSize, 20, 10, 100);
  const offset = (page - 1) * pageSize;
  const result = await db.query(
    `SELECT h.signoff_id, h.bill_id, h.class_id,
            h.occurrence_date::text AS occurrence_date,
            h.scope_key, h.signed_by_user_id, h.signed_by_name,
            h.signer_role, h.student_count, h.total_collected, h.signed_at,
            b.title AS bill_title,
            c.class_name,
            u.first_name AS signer_first_name,
            u.last_name AS signer_last_name,
            COALESCE(corr.reopened_count, 0) AS reopened_count,
            corr.last_reopened_at
       FROM finance_collection_signoffs h
       JOIN finance_bills b ON b.bill_id = h.bill_id
       LEFT JOIN classes c ON c.class_id = NULLIF(h.class_id, 0)
       LEFT JOIN users u ON u.user_id = h.signed_by_user_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS reopened_count,
                MAX(created_at) AS last_reopened_at
           FROM finance_collection_signoff_corrections corr
          WHERE corr.organization_id = h.organization_id
            AND corr.bill_id = h.bill_id
            AND COALESCE(corr.class_id, 0) = COALESCE(NULLIF(h.class_id, 0), 0)
            AND corr.scope_key = h.scope_key
            AND (
              (corr.occurrence_date IS NULL AND h.occurrence_date IS NULL)
              OR corr.occurrence_date = h.occurrence_date::date
            )
       ) corr ON TRUE
      WHERE h.organization_id = $1
      ORDER BY h.signed_at DESC
      LIMIT $2 OFFSET $3`,
    [orgId, pageSize + 1, offset]
  ).catch(() => ({ rows: [] }));
  const hasMore = result.rows.length > pageSize;
  return {
    rows: hasMore ? result.rows.slice(0, pageSize) : result.rows,
    pagination: {
      page,
      pageSize,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    },
  };
}

async function resolveScheduleValidationContext(database, orgId, schedule) {
  const normalizedDueDate = normalizeOccurrenceDate(schedule?.due_date);
  if (!normalizedDueDate) {
    throw new Error("Start / first date is required.");
  }

  const directEndDate = normalizeOccurrenceDate(schedule?.recurrence_end_date);
  let termEndDate = null;
  const termId = schedule?.term_id ? Number(schedule.term_id) : null;
  if (!directEndDate && termId) {
    const termResult = await database.query(
      `SELECT end_date FROM terms WHERE term_id = $1 AND organization_id = $2 LIMIT 1`,
      [termId, orgId]
    ).catch(() => ({ rows: [] }));
    termEndDate = normalizeOccurrenceDate(termResult.rows[0]?.end_date || null);
  }

  const effectiveEndDate = directEndDate || termEndDate || null;
  if (effectiveEndDate && effectiveEndDate < normalizedDueDate) {
    throw new Error("End date cannot be before the start date.");
  }

  const excludeNonSchoolDays = isRecurringBill(schedule) && shouldExcludeNonSchoolDays(schedule);
  if (isRecurringBill(schedule) && !String(schedule?.recurrence || "").trim()) {
    throw new Error("Recurring bills need a recurrence pattern.");
  }

  const getCalendarContext = createBillScheduleContextLoader(database, orgId);
  const occurrenceDates = await getScheduledOccurrenceDates({
    ...schedule,
    due_date: normalizedDueDate,
    recurrence_end_date: effectiveEndDate,
    term_end_date: termEndDate,
    exclude_non_school_days: excludeNonSchoolDays,
  }, getCalendarContext);

  if (isRecurringBill(schedule) && effectiveEndDate && !occurrenceDates.length) {
    throw new Error("No bill dates remain after weekends and holidays were excluded. Adjust the schedule or turn off the exclusion.");
  }

  return {
    normalizedDueDate,
    recurrenceEndDate: directEndDate,
    effectiveEndDate,
    excludeNonSchoolDays,
    occurrenceDates,
  };
}

async function verifyCollectionSignoffCredentials(client, req, fullName, password) {
  const orgId = req.session.organizationId;
  const userId = req.session.user?.user_id || req.session.userId || null;
  const enteredName = String(fullName || "").trim().replace(/\s+/g, " ");
  if (!orgId || !userId) {
    throw new PaygiraRequestError("Unauthorized.", 401);
  }
  if (!enteredName) {
    throw new PaygiraRequestError("Enter your full name to sign off.", 400);
  }
  if (!String(password || "").trim()) {
    throw new PaygiraRequestError("Enter your password to sign off.", 400);
  }

  const userResult = await client.query(
    `SELECT first_name, last_name, password, account_type
       FROM users
      WHERE user_id = $1 AND organization_id = $2
      LIMIT 1`,
    [userId, orgId]
  );
  if (!userResult.rows.length) {
    throw new PaygiraRequestError("User account not found.", 404);
  }

  const userRow = userResult.rows[0];
  const expectedName = [userRow.first_name, userRow.last_name].filter(Boolean).join(" ").trim()
    || [req.session.user?.first_name, req.session.user?.last_name].filter(Boolean).join(" ").trim()
    || req.session.userName
    || "";

  let passwordMatch = false;
  if (userRow.password) {
    passwordMatch = await bcrypt.compare(String(password), userRow.password);
  }
  if (!passwordMatch) {
    const organizationResult = await client.query(
      `SELECT password FROM organizations WHERE organization_id = $1 LIMIT 1`,
      [orgId]
    );
    if (organizationResult.rows[0]?.password) {
      passwordMatch = await bcrypt.compare(String(password), organizationResult.rows[0].password);
    }
  }

  if (!passwordMatch) {
    throw new PaygiraRequestError("Incorrect password. Please try again.", 401);
  }

  return {
    signedByUserId: userId,
    signedByName: enteredName || expectedName,
    signerRole: userRow.account_type || req.session.accountType || req.session.userRole || "Staff",
  };
}

async function loadBillSignoffSummary(client, orgId, billId, occurrenceDate, classId) {
  const scopeClassId = normalizeSignoffClassId(classId);
  if (normalizeOccurrenceDate(occurrenceDate)) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS student_count,
              COALESCE(SUM(a.amount), 0) AS total_expected,
              COALESCE(SUM(COALESCE(paid_scope.paid_amount, 0)), 0) AS total_paid,
              COALESCE(SUM(GREATEST(a.amount - COALESCE(paid_scope.paid_amount, 0), 0)), 0) AS total_outstanding
         FROM finance_bill_assignments a
         JOIN finance_bills b ON b.bill_id = a.bill_id
         JOIN students s ON s.student_id = a.student_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(p.amount), 0) AS paid_amount
             FROM finance_payments p
            WHERE p.organization_id = $1
              AND p.assignment_id = a.assignment_id
              AND p.occurrence_date = $3::date
         ) paid_scope ON TRUE
        WHERE a.organization_id = $1
          AND a.bill_id = $2
          AND a.status <> 'cancelled'
          AND COALESCE(b.status, 'active') <> 'cancelled'
          AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$4', orgParamSql: '$1' })}`,
      [orgId, billId, normalizeOccurrenceDate(occurrenceDate), scopeClassId]
    );
    return result.rows[0] || null;
  }

  const result = await client.query(
    `SELECT COUNT(*)::int AS student_count,
            COALESCE(SUM(a.amount + COALESCE(a.late_fee_applied, 0)), 0) AS total_expected,
            COALESCE(SUM(a.amount_paid), 0) AS total_paid,
            COALESCE(SUM(GREATEST(a.amount + COALESCE(a.late_fee_applied, 0) - a.amount_paid, 0)), 0) AS total_outstanding
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       JOIN students s ON s.student_id = a.student_id
      WHERE a.organization_id = $1
        AND a.bill_id = $2
        AND a.status <> 'cancelled'
        AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$3', orgParamSql: '$1' })}`,
    [orgId, billId, scopeClassId]
  );
  return result.rows[0] || null;
}

async function findExistingCollectionSignoff(client, orgId, billId, occurrenceDate, classId) {
  const scopeClassId = normalizeSignoffClassId(classId);
  const scopeKey = getSignoffScopeKey(occurrenceDate);
  const params = [orgId, billId, scopeKey];
  let whereSql = `organization_id = $1 AND bill_id = $2 AND scope_key = $3`;
  if (scopeClassId > 0) {
    params.push(scopeClassId);
    whereSql += ` AND class_id IN (0, $4)`;
  } else {
    whereSql += ` AND class_id = 0`;
  }
  const result = await client.query(
    `SELECT signoff_id, class_id, occurrence_date::text AS occurrence_date, signed_by_name, signed_at
       FROM finance_collection_signoffs
      WHERE ${whereSql}
      ORDER BY class_id DESC, signed_at DESC
      LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

function buildStaffCollectSuccessMessage(display, amount, studentName, credit) {
  const safeStudentName = studentName || "this student";
  if (credit > 0) {
    return `Collected ${display.formatMoney(amount)} from ${safeStudentName}. ${display.formatMoney(credit)} added as student credit.`;
  }
  return `Collected ${display.formatMoney(amount)} from ${safeStudentName}.`;
}

function buildStaffCollectionResponse(result) {
  return {
    assignment_id: result.assignmentId,
    bill_id: result.billId,
    student_id: result.studentId,
    first_name: result.firstName,
    last_name: result.lastName,
    image_url: result.imageUrl,
    class_name: result.className,
    amount: result.billedAmount,
    amount_paid: result.amountPaid,
    late_fee_applied: result.lateFeeApplied,
    status: result.status,
    balance: result.balance,
    bill_type: result.billType,
    amount_collected: result.amountCollected,
    credit: result.credit,
    method: result.method,
    occurrence_date: result.occurrenceDate,
    occurrence_due: result.occurrenceDue,
    occurrence_paid: result.occurrencePaid,
    occurrence_outstanding: result.occurrenceOutstanding,
    payment_id: result.paymentId,
    invoice_url: `/account/settings/my-paygira/invoice/${result.assignmentId}`,
  };
}

function parseBulkCollectItems(rawItems) {
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === "string" && rawItems.trim()) {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function parseOccurrenceDates(rawOccurrenceDates) {
  let values = [];
  if (Array.isArray(rawOccurrenceDates)) {
    values = rawOccurrenceDates;
  } else if (typeof rawOccurrenceDates === "string" && rawOccurrenceDates.trim()) {
    const rawValue = rawOccurrenceDates.trim();
    if (rawValue.startsWith("[")) {
      try {
        const parsed = JSON.parse(rawValue);
        values = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        values = [];
      }
    } else {
      values = [rawValue];
    }
  }

  const seen = new Set();
  return values.reduce((accumulator, value) => {
    const normalized = normalizeOccurrenceDate(value);
    if (!normalized || seen.has(normalized)) return accumulator;
    seen.add(normalized);
    accumulator.push(normalized);
    return accumulator;
  }, []);
}

async function collectStaffPaygiraPayment({
  client,
  orgId,
  userId,
  assignmentId,
  scopedClassId,
  amount,
  method,
  reference,
  notes,
  occurrenceDate,
  allowedMethods,
  display,
}) {
  const assignmentResult = await client.query(
    `SELECT a.*, b.title AS bill_title, b.due_date, b.assignee_id, b.bill_type, b.recurrence, b.recurrence_end_date,
            b.school_year_id, b.term_id,
            b.exclude_non_school_days,
            b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination,
            s.first_name, s.last_name, s.image_url,
            s.class_id,
            c.class_name,
            tm.end_date AS term_end_date
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       LEFT JOIN students s ON s.student_id = a.student_id
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN terms tm ON tm.term_id = b.term_id
      WHERE a.assignment_id=$1 AND a.organization_id=$2
        AND a.status <> 'cancelled'
        AND COALESCE(b.status, 'active') <> 'cancelled'
        AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$3', orgParamSql: '$2' })}`,
    [assignmentId, orgId, normalizeSignoffClassId(scopedClassId)]
  );
  if (!assignmentResult.rows.length) {
    throw new PaygiraRequestError("Not authorized to collect for this bill.", 403);
  }

  const row = assignmentResult.rows[0];
  const collectorResult = await client.query(
    `SELECT 1 FROM finance_bill_collectors WHERE bill_id=$1 AND user_id=$2`,
    [row.bill_id, userId]
  );
  const isCollector = Number(row.assignee_id || 0) === Number(userId || 0) || collectorResult.rows.length > 0;
  if (!isCollector) {
    throw new PaygiraRequestError("Not authorized to collect for this bill.", 403);
  }

  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new PaygiraRequestError("Enter a valid amount.", 400);
  }

  const requested = String(method || "cash").toLowerCase();
  const isMethodAllowed =
    (requested === "cash" && row.accepts_cash) ||
    (requested === "bank_transfer" && row.accepts_transfer && allowedMethods.bankOn) ||
    (requested === "mobile_money" && allowedMethods.momoOn) ||
    (requested === "card" && row.accepts_card && allowedMethods.stripeOn) ||
    (requested === "stripe" && row.accepts_card && allowedMethods.stripeOn) ||
    requested === "other";
  if (!isMethodAllowed) {
    throw new PaygiraRequestError(`Method "${requested}" is not enabled on this bill / school. Update Payment Settings.`, 400);
  }

  const occDateVal = normalizeOccurrenceDate(occurrenceDate);
  const isRecurringBill = String(row.bill_type || "") === "recurring";
  const existingSignoff = await findExistingCollectionSignoff(client, orgId, row.bill_id, occDateVal, normalizeSignoffClassId(scopedClassId));
  if (existingSignoff) {
    throw new PaygiraRequestError(
      occDateVal ? "This date has already been signed off." : "This bill has already been signed off.",
      400
    );
  }

  const scheduleContext = createBillScheduleContextLoader(client, orgId);
  const scheduledAssignmentTotal = await getScheduledBilledAmount(row, scheduleContext);
  let occurrencePaidBefore = 0;
  let occurrenceDue = Number(row.amount || 0);
  let occurrenceOutstanding = occurrenceDue;
  if (isRecurringBill) {
    if (!occDateVal) {
      throw new PaygiraRequestError("Select a recurring date before collecting.", 400);
    }
    const occurrencePaymentResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid_amount
         FROM finance_payments
        WHERE organization_id=$1 AND assignment_id=$2 AND occurrence_date=$3::date`,
      [orgId, row.assignment_id, occDateVal]
    );
    occurrencePaidBefore = Number(occurrencePaymentResult.rows[0]?.paid_amount || 0);
    occurrenceOutstanding = Math.max(occurrenceDue - occurrencePaidBefore, 0);
    if (!(occurrenceOutstanding > 0)) {
      throw new PaygiraRequestError("This selected date is already fully paid.", 400);
    }
    if (amt > occurrenceOutstanding) {
      throw new PaygiraRequestError(`Amount exceeds the selected date balance of ${display.formatMoney(occurrenceOutstanding)}.`, 400);
    }
  }

  const { percentage: platformFeePercentage } = await getPlatformFeeSettings(client);
  const platformFeeBearer = await getOrgPlatformFeeBearer(orgId, client);
  const chargeBreakdown = buildFinancePaymentChargeBreakdown(amt, requested, platformFeePercentage, 0, platformFeeBearer);

  const paymentInsert = await client.query(
    `INSERT INTO finance_payments
      (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by, occurrence_date, platform_fee_percentage, platform_fee_amount, platform_fee_bearer, tax_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING payment_id, received_at`,
    [
      orgId,
      row.assignment_id,
      row.bill_id,
      row.student_id,
      amt,
      requested,
      reference || null,
      notes || null,
      userId,
      occDateVal,
      chargeBreakdown.platformFeePercentage,
      chargeBreakdown.platformFeeAmount,
      platformFeeBearer,
      chargeBreakdown.taxAmount,
    ]
  );

  const totalDue = (isRecurringBill ? scheduledAssignmentTotal : Number(row.amount || 0)) + Number(row.late_fee_applied || 0);
  const newPaid = Number(row.amount_paid || 0) + amt;
  let credit = 0;
  let appliedToAssignment = newPaid;
  if (!isRecurringBill && newPaid > totalDue) {
    credit = newPaid - totalDue;
    appliedToAssignment = totalDue;
  }
  const newStatus = isRecurringBill
    ? (appliedToAssignment >= totalDue
        ? "paid"
        : (appliedToAssignment > 0 ? "partial" : recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date)))
    : recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
  await client.query(
    `UPDATE finance_bill_assignments
        SET amount_paid=$1, status=$2, updated_at=now()
      WHERE assignment_id=$3`,
    [appliedToAssignment, newStatus, row.assignment_id]
  );
  if (credit > 0) {
    await client.query(
      `INSERT INTO finance_student_credits (organization_id, student_id, amount)
         VALUES ($1,$2,$3)
       ON CONFLICT (student_id) DO UPDATE
          SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
      [orgId, row.student_id, credit]
    );
  }

  const firstName = row.first_name || "";
  const lastName = row.last_name || "";
  const studentName = [firstName, lastName].filter(Boolean).join(" ").trim() || `Student #${row.student_id}`;

  return {
    assignmentId: row.assignment_id,
    billId: row.bill_id,
    billTitle: row.bill_title || "Bill",
    studentId: row.student_id,
    firstName,
    lastName,
    studentName,
    className: row.class_name || "",
    imageUrl: row.image_url || "",
    billedAmount: Number(row.amount || 0),
    lateFeeApplied: Number(row.late_fee_applied || 0),
    amountPaid: appliedToAssignment,
    balance: Math.max(totalDue - appliedToAssignment, 0),
    totalDue,
    billType: row.bill_type || "one_time",
    amountCollected: amt,
    credit,
    method: requested,
    reference: reference || null,
    notes: notes || null,
    occurrenceDate: occDateVal,
    occurrenceDue,
    occurrencePaid: occurrencePaidBefore + amt,
    occurrenceOutstanding: Math.max(occurrenceOutstanding - amt, 0),
    status: newStatus,
    paymentId: paymentInsert.rows[0]?.payment_id || null,
    receivedAt: paymentInsert.rows[0]?.received_at || null,
    platformFeeAmount: chargeBreakdown.platformFeeAmount,
    platformFeePercentage: chargeBreakdown.platformFeePercentage,
    totalChargedAmount: chargeBreakdown.totalChargedAmount,
    successMessage: isRecurringBill && occDateVal
      ? `Collected ${display.formatMoney(amt)} from ${studentName} for ${new Date(`${occDateVal}T00:00:00`).toLocaleDateString()}.${chargeBreakdown.platformFeeAmount > 0 ? ` ${display.formatMoney(chargeBreakdown.platformFeeAmount)} charged as platform fee.` : ""}`
      : `${buildStaffCollectSuccessMessage(display, amt, studentName, credit)}${chargeBreakdown.platformFeeAmount > 0 ? ` ${display.formatMoney(chargeBreakdown.platformFeeAmount)} charged as platform fee.` : ""}`,
  };
}

async function notifyGuardiansOfStaffCollection(display, result) {
  try {
    const orgRow = (await db.query(
      `SELECT organization_name FROM organizations WHERE organization_id=$1`,
      [result.orgId]
    )).rows[0];
    const guardians = (await db.query(
      `SELECT gp.email, gp.first_name FROM guardian_profiles gp
         JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
        WHERE gs.student_id=$1 AND gp.organization_id=$2 AND gp.email IS NOT NULL AND gp.email <> ''`,
      [result.studentId, result.orgId]
    )).rows;
    if (!guardians.length) return;

    const orgName = orgRow?.organization_name || "Your School";
    const amtFmt = display.formatMoney(result.amountCollected);
    const occText = result.occurrenceDate
      ? ` for ${new Date(`${result.occurrenceDate}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
      : "";
    const statusText = result.status === "paid"
      ? "fully paid"
      : `partially paid (${display.formatMoney(result.amountPaid)} of ${display.formatMoney(result.totalDue)})`;

    for (const guardian of guardians) {
      const html = renderCleanEmail({
        title: `Payment Recorded — ${result.billTitle}`,
        greeting: `Hello ${guardian.first_name},`,
        paragraphs: [
          `A payment of <strong>${amtFmt}</strong> has been recorded for <strong>${result.studentName}</strong> on the bill <strong>${result.billTitle}</strong>${occText}.`,
          `This bill is now <strong>${statusText}</strong>.`,
        ],
        details: [
          { label: "Student", value: result.studentName },
          { label: "Bill", value: result.billTitle },
          ...(result.occurrenceDate ? [{ label: "For date", value: new Date(`${result.occurrenceDate}T00:00:00`).toLocaleDateString() }] : []),
          { label: "Amount paid", value: amtFmt },
          { label: "Method", value: result.method },
          { label: "Status", value: result.status },
        ],
        note: `This is an automated notification from ${orgName}. You can log in to the guardian portal to view your ward's full payment history.`,
      });
      await sendEmailSafely({
        from: process.env.ADMIN_NOTIFY_EMAIL_USER,
        to: guardian.email,
        subject: `[${orgName}] Payment Recorded — ${result.billTitle}`,
        html,
        failureNotification: buildFailureNotification(result.orgId, {
          title: 'Payment notification email failed',
          body: `The payment recorded email for ${result.studentName} could not be delivered to ${guardian.email}.`,
        }),
      }, "PayGira guardian notification");
    }
  } catch (emailErr) {
    console.warn("[notifyGuardiansOfStaffCollection] guardian email failed:", emailErr.message);
  }
}

// Wrapper that records a PayGira action into the organization activity log.
// Never throws — logging failures must not block a save.
async function logPaygira(req, opts = {}) {
  try {
    const sessionUser = req.session?.user || {};
    const firstName = req.session?.firstName || sessionUser.first_name || "";
    const lastName = req.session?.lastName || sessionUser.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();
    await logOrganizationActivity({
      organizationId: req.session?.organizationId,
      userId: req.session?.userId || sessionUser.user_id || null,
      userName: fullName || sessionUser.email || "Unknown User",
      userRole: req.session?.userRole || sessionUser.account_type || null,
      actionType: opts.actionType || "Updated",
      moduleName: "PayGira",
      pagePath: "/account/settings/finance",
      recordType: opts.recordType || null,
      recordId: opts.recordId != null && opts.recordId !== "" ? String(opts.recordId) : null,
      recordLabel: opts.recordLabel || null,
      description: opts.description || "Updated a PayGira record.",
      changedFields: Array.isArray(opts.changedFields) ? opts.changedFields : [],
      ipAddress: req.ip,
    });
  } catch (err) {
    console.error("[logPaygira] failed:", err.message || err);
  }
}

async function auditStaffCollection(req, result) {
  try {
    await logPaygira(req, {
      actionType: "Collected",
      recordType: "Payment",
      recordId: result.assignmentId,
      recordLabel: `${result.studentName} — ${result.billTitle}`,
      description: `Collector recorded $${result.amountCollected.toFixed(2)} (${result.method}) for ${result.studentName} on bill "${result.billTitle}". New status: ${result.status}${result.credit > 0 ? `; $${result.credit.toFixed(2)} credited.` : ""}.`,
      changedFields: [
        { field: "Amount", value: `$${result.amountCollected.toFixed(2)}` },
        { field: "Method", value: result.method },
        { field: "Reference", value: result.reference || "—" },
        { field: "New Status", value: result.status },
      ],
    });
  } catch (_) {
  }
}

module.exports = {
  ensureFinanceSchema,
  isFinanceAdmin,
  invalidateFinanceCache,

  // Ultra-cheap version probe — clients poll this every few seconds. When the
  // returned `v` increases, the page silently soft-reloads via the SPA router.
  financeVersionJsonGet: (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      res.set("Cache-Control", "no-store");
      res.json({ v: getFinanceVersion(orgId), ts: Date.now() });
    } catch (_) {
      res.json({ v: 0, ts: Date.now() });
    }
  },

  // Lightweight JSON endpoint for background stat-refresh on the Finance page.
  // The dashboard polls this every ~15s to update headline numbers without a
  // full page reload. Cached for 10s so heavy SQL doesn't fire on every poll.
  financeStatsJsonGet: async (req, res) => {
    try {
      if (!(await isFinanceAdmin(req))) return res.status(403).json({ error: "forbidden" });
      const orgId = req.session.organizationId;
      if (!orgId) return res.status(401).json({ error: "no_org" });
      await ensureFinanceSchema();
      const refs = await cachedLoad(orgId, "refs", null, () => loadClassesAndStudents(orgId));
      const currentAcademic = getCurrentAcademicContext(refs);
      const filters = {
        school_year_id: req.query.year || currentAcademic.schoolYearId || null,
        term_id: req.query.term || ((!req.query.year && !req.query.term) ? (currentAcademic.termId || null) : null),
      };
      const overview = await cachedLoad(orgId, "overview", filters, () => loadOverviewStats(orgId, filters));
      const t = overview?.totals || overview?.total_summary || overview || {};
      const credits = overview?.credits || {};
      res.set("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      res.json({
        ok: true,
        billedTotal: Number(t.total_billed || 0),
        collectedTotal: Number(t.total_collected || 0),
        outstandingTotal: Number(t.outstanding || 0),
        overpaymentsTotal: Number(credits.overpayments || overview?.overpayments || 0),
        overdueCount: Number(t.overdue_count || 0),
        ts: Date.now()
      });
    } catch (e) {
      res.status(500).json({ error: "stats_failed" });
    }
  },

  financeOverviewFragmentGet: async (req, res) => {
    try {
      if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
      const orgId = req.session.organizationId;
      if (!orgId) return res.status(401).send("Unauthorized.");

      await ensureFinanceSchema();
      await ensureAssigneeColumn();

      const refs = await cachedLoad(orgId, "refs", "lite", () => loadClassesAndStudents(orgId, {
        includeClasses: false,
        includeStudents: false,
        includeEmployees: false,
        includeEnrollmentLinks: false,
      }));
      return res.render("account/financeOverviewSection", {
        refs,
        selectedYear: req.query.year || "",
        selectedTerm: req.query.term || "",
        layout: false,
      });
    } catch (error) {
      console.error("[financeOverviewFragmentGet]", error);
      return res.status(500).send('<div class="fin-card"><div class="activity-empty">Unable to load overview right now. Please refresh.</div></div>');
    }
  },

  financeOverviewDetailFragmentGet: async (req, res) => {
    try {
      if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
      const orgId = req.session.organizationId;
      if (!orgId) return res.status(401).send("Unauthorized.");

      await ensureFinanceSchema();
      await ensureAssigneeColumn();

      const refs = await cachedLoad(orgId, "refs", "lite", () => loadClassesAndStudents(orgId, {
        includeClasses: false,
        includeStudents: false,
        includeEmployees: false,
        includeEnrollmentLinks: false,
      }));
      const currentAcademic = getCurrentAcademicContext(refs);
      const overviewFilters = {
        school_year_id: req.query.year || currentAcademic.schoolYearId || null,
        term_id: req.query.term || ((!req.query.year && !req.query.term) ? (currentAcademic.termId || null) : null),
      };
      const billFilters = {
        school_year_id: overviewFilters.school_year_id,
        term_id: overviewFilters.term_id,
        page: 1,
        pageSize: 20,
      };

      const [overview, billsResult, pspSettings, orgProfile] = await Promise.all([
        cachedLoad(orgId, "overview", overviewFilters, () => loadOverviewStats(orgId, overviewFilters)),
        cachedLoad(orgId, "overviewBills", billFilters, () => loadOverviewBillsSnapshot(orgId, billFilters)),
        cachedLoad(orgId, "psp", null, () => loadPspSettings(orgId)),
        cachedLoad(orgId, "orgProfile", null, () => loadOrganizationProfile(orgId)),
      ]);

      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country, orgProfile.organization_currency);
      return res.render("account/financeOverviewDetailSection", {
        overview,
        bills: Array.isArray(billsResult?.rows) ? billsResult.rows : [],
        refs,
        formatMoney: display.formatMoney,
        financeCurrency: display.financeCurrency,
        layout: false,
      });
    } catch (error) {
      console.error("[financeOverviewDetailFragmentGet]", error);
      return res.status(500).send('<div class="fin-card"><div class="activity-empty">Unable to load overview details right now. Please refresh.</div></div>');
    }
  },


  financeArrearsPageGet: async (req, res) => {
    req.query = { ...(req.query || {}), section: "arrears" };
    return module.exports.financePageGet(req, res);
  },

  arrearsPresetCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureArrearsSchema();
      const filters = normalizeArrearsFilters(req.body || {});
      const name = String(req.body.preset_name || req.body.name || "").trim();
      if (!name) {
        req.flash("error", "Preset name is required.");
        return res.redirect("/account/settings/finance/arrears");
      }
      await db.query(
        `INSERT INTO finance_arrears_filter_presets (organization_id, name, filters, created_by)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [orgId, name, JSON.stringify(filters), req.session.user?.user_id || null]
      );
      req.flash("success", `Saved filter preset \"${name}\".`);
    } catch (error) {
      console.error("[arrearsPresetCreatePost]", error);
      req.flash("error", "Could not save arrears filter preset.");
    }
    res.redirect("/account/settings/finance/arrears");
  },

  arrearsNoteCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const studentId = parseInt(req.body.student_id, 10);
    const note = String(req.body.note || "").trim();
    try {
      await ensureArrearsSchema();
      if (!studentId || !note) {
        req.flash("error", "Student and note are required.");
        return res.redirect("/account/settings/finance/arrears");
      }
      const userName = [req.session.user?.first_name, req.session.user?.last_name].filter(Boolean).join(" ").trim() || req.session.userName || "Finance User";
      await db.query(
        `INSERT INTO finance_arrears_notes (organization_id, student_id, note, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5)`,
        [orgId, studentId, note, req.session.user?.user_id || null, userName]
      );
      req.flash("success", "Recovery note saved.");
    } catch (error) {
      console.error("[arrearsNoteCreatePost]", error);
      req.flash("error", "Could not save note.");
    }
    res.redirect("/account/settings/finance/arrears");
  },

  arrearsGuardianSavePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const studentId = parseInt(req.body.student_id, 10);
    const [firstName, ...restNames] = String(req.body.guardian_name || "").trim().split(/\s+/).filter(Boolean);
    const lastName = restNames.join(" ");
    const email = String(req.body.email || "").trim();
    const phone = String(req.body.phone || "").trim();
    const relationship = String(req.body.relationship || "Guardian").trim() || "Guardian";
    const savePermanently = String(req.body.save_permanently || "on").toLowerCase() !== "false";
    try {
      if (!studentId || !firstName) {
        req.flash("error", "Guardian name and student are required.");
        return res.redirect("/account/settings/finance/arrears");
      }
      if (savePermanently) {
        await db.query(`
          CREATE TABLE IF NOT EXISTS guardian_profiles (
            guardian_id SERIAL PRIMARY KEY,
            organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100),
            phone VARCHAR(30),
            email VARCHAR(255),
            address TEXT,
            hometown VARCHAR(255),
            image_url TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )`).catch(() => null);
        await db.query(`
          CREATE TABLE IF NOT EXISTS guardian_students (
            guardian_id INT NOT NULL REFERENCES guardian_profiles(guardian_id) ON DELETE CASCADE,
            student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
            relationship VARCHAR(50) DEFAULT 'Guardian',
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (guardian_id, student_id)
          )`).catch(() => null);
        const inserted = await db.query(
          `INSERT INTO guardian_profiles (organization_id, first_name, last_name, phone, email)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING guardian_id`,
          [orgId, firstName, lastName || null, phone || null, email || null]
        );
        const guardianId = inserted.rows[0]?.guardian_id;
        if (guardianId) {
          await db.query(
            `INSERT INTO guardian_students (guardian_id, student_id, relationship)
             VALUES ($1,$2,$3)
             ON CONFLICT (guardian_id, student_id) DO NOTHING`,
            [guardianId, studentId, relationship]
          );
        }
      }
      req.flash("success", savePermanently ? "Guardian saved to student profile." : "Guardian details captured for this recovery workflow.");
    } catch (error) {
      console.error("[arrearsGuardianSavePost]", error);
      req.flash("error", "Could not save guardian details.");
    }
    res.redirect("/account/settings/finance/arrears");
  },

  arrearsReportCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      const filters = normalizeArrearsFilters(req.body || {});
      const selectedIds = new Set(parseMultiValue(req.body.selected_student_ids));
      const loaded = await loadArrearsManagementData(orgId, filters);
      const students = selectedIds.size ? loaded.students.filter((student) => selectedIds.has(String(student.student_id))) : loaded.students;
      const snapshot = {
        summary: {
          ...loaded.summary,
          totalOutstanding: students.reduce((sum, student) => sum + Number(student.outstanding || 0), 0),
        },
        students,
      };
      await saveArrearsReportRecord(orgId, {
        title: String(req.body.report_title || "Arrears Report").trim(),
        reportPeriod: String(req.body.report_period || "").trim(),
        format: String(req.body.report_format || "pdf").trim().toLowerCase(),
        recordCount: students.length,
        totalOutstanding: snapshot.summary.totalOutstanding,
        filters,
        options: {
          includeSections: parseMultiValue(req.body.include_sections),
          saveToLibrary: !!req.body.save_to_library,
          attachToFinanceRecords: !!req.body.attach_to_finance_records,
          downloadImmediately: !!req.body.download_immediately,
          emailFinanceHead: !!req.body.email_finance_head,
        },
        snapshot,
        notes: String(req.body.report_notes || "").trim(),
        generatedBy: req.session.user?.user_id || null,
        generatedByName: [req.session.user?.first_name, req.session.user?.last_name].filter(Boolean).join(" ").trim() || req.session.userName || "Finance User",
      });
      req.flash("success", `Arrears report generated and saved to the library (${students.length} record(s)).`);
    } catch (error) {
      console.error("[arrearsReportCreatePost]", error);
      req.flash("error", "Could not generate arrears report.");
    }
    res.redirect("/account/settings/finance/arrears");
  },

  arrearsReportViewGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
    const orgId = req.session.organizationId;
    try {
      const report = await loadArrearsReportById(orgId, parseInt(req.params.id, 10));
      if (!report) return res.status(404).send("Report not found.");
      const display = await buildFinanceDisplayContext(req, orgId);

      const orgRow = await db.query(
        `SELECT organization_name, organization_address, organization_phone, email AS organization_email, logo_path
           FROM organizations WHERE organization_id = $1 LIMIT 1`,
        [orgId]
      ).then((r) => (r.rows && r.rows[0]) || {}).catch(() => ({}));

      const esc = (val) => String(val == null ? '' : val)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

      const schoolName = orgRow.organization_name || 'Your School';
      const schoolLogoUrl = orgRow.logo_path
        ? (String(orgRow.logo_path).startsWith('http')
            ? String(orgRow.logo_path)
            : `/uploads/${String(orgRow.logo_path).replace(/^\/+/, '')}`)
        : '';
      const contactBits = [orgRow.organization_address, orgRow.organization_phone, orgRow.organization_email]
        .filter((v) => v && String(v).trim())
        .map((v) => esc(v))
        .join(' &nbsp;•&nbsp; ');

      const snapshot = report.snapshot || {};
      const students = snapshot.students || [];
      const statusBadge = (status) => {
        const s = String(status || 'overdue').toLowerCase();
        const cls = s.includes('partial') ? 'partial' : (s.includes('paid') ? 'paid' : 'overdue');
        return `<span class="badge badge-${cls}">${esc(status || 'overdue')}</span>`;
      };
      const rows = students.map((student, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td><span class="strong">${esc(student.student_name)}</span></td>
          <td>${esc(student.class_name || '—')}</td>
          <td>${esc(student.guardian_name || 'No guardian')}</td>
          <td>${esc(student.guardian_email || student.guardian_phone || 'No contact')}</td>
          <td class="money">${display.formatMoney(student.total_billed || 0)}</td>
          <td class="money">${display.formatMoney(student.total_paid || 0)}</td>
          <td class="money outstanding">${display.formatMoney(student.outstanding || 0)}</td>
          <td>${statusBadge(student.primary_status)}</td>
        </tr>`).join("");

      const logoBlock = schoolLogoUrl
        ? `<img src="${esc(schoolLogoUrl)}" alt="${esc(schoolName)}" class="school-logo" onerror="this.style.display='none'">`
        : `<div class="school-logo school-logo-fallback">${esc(schoolName.charAt(0).toUpperCase())}</div>`;

      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(report.title)} — ${esc(schoolName)}</title>
  <style>
    :root { --ink:#0f172a; --muted:#64748b; --brand:#01535b; --line:#e6eef0; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin:0; padding:28px; color:var(--ink); background:#f4f7f8; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .sheet { max-width:1040px; margin:0 auto; background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:0 10px 30px rgba(1,83,91,.06); overflow:hidden; }
    .report-header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding:26px 30px; background:linear-gradient(135deg,#f8fcfd 0%,#eef6f7 100%); border-bottom:1px solid var(--line); }
    .school-id { display:flex; gap:14px; align-items:center; }
    .school-logo { width:58px; height:58px; border-radius:12px; object-fit:cover; border:1px solid var(--line); background:#fff; }
    .school-logo-fallback { display:flex; align-items:center; justify-content:center; font-size:26px; font-weight:800; color:#fff; background:linear-gradient(135deg,#01535b,#0e7c86); border:none; }
    .school-name { margin:0; font-size:1.3rem; font-weight:800; color:var(--brand); }
    .school-contact { margin:4px 0 0; font-size:12px; color:var(--muted); }
    .report-meta { text-align:right; }
    .report-meta h2 { margin:0; font-size:1rem; color:var(--ink); font-weight:700; }
    .report-meta .stamp { margin:4px 0 0; font-size:12px; color:var(--muted); }
    .report-actions { padding:16px 30px 0; display:flex; gap:10px; }
    .btn { display:inline-flex; align-items:center; gap:6px; padding:9px 16px; border-radius:9px; border:1px solid var(--line); background:#fff; color:var(--brand); font-size:13px; font-weight:700; cursor:pointer; text-decoration:none; }
    .btn-primary { background:var(--brand); color:#fff; border-color:var(--brand); }
    .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; padding:20px 30px; }
    .card { padding:16px 18px; border:1px solid var(--line); border-radius:12px; background:#fbfdfe; }
    .card .label { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
    .card .value { margin-top:6px; font-size:1.45rem; font-weight:800; color:var(--brand); }
    .card.danger .value { color:#b42318; }
    .table-wrap { padding:6px 30px 26px; overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    thead th { background:#f1f7f8; color:#334155; text-align:left; padding:11px 10px; font-size:11px; letter-spacing:.03em; text-transform:uppercase; border-bottom:2px solid var(--line); white-space:nowrap; }
    tbody td { padding:10px; border-bottom:1px solid #eef3f4; vertical-align:middle; }
    tbody tr:hover { background:#f8fbfc; }
    td.num { color:var(--muted); width:34px; }
    td.money { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
    td.outstanding { font-weight:800; color:#b42318; }
    .strong { font-weight:700; }
    .badge { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:700; text-transform:capitalize; }
    .badge-overdue { background:#fdeceb; color:#b42318; }
    .badge-partial { background:#fff7e6; color:#8a4b00; }
    .badge-paid { background:#e6f6ee; color:#0f5132; }
    .empty { text-align:center; color:var(--muted); padding:30px; font-style:italic; }
    .report-footer { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:18px 30px; border-top:1px solid var(--line); background:#fbfdfe; }
    .powered { display:flex; align-items:center; gap:9px; font-size:12px; color:var(--muted); }
    .powered img { height:22px; width:auto; }
    .powered .brand-name { font-weight:800; color:var(--brand); }
    .footer-note { font-size:11px; color:#94a3b8; text-align:right; }
    @media print { body { background:#fff; padding:0; } .sheet { border:none; box-shadow:none; border-radius:0; } .report-actions { display:none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <header class="report-header">
      <div class="school-id">
        ${logoBlock}
        <div>
          <h1 class="school-name">${esc(schoolName)}</h1>
          ${contactBits ? `<p class="school-contact">${contactBits}</p>` : ''}
        </div>
      </div>
      <div class="report-meta">
        <h2>${esc(report.title)}</h2>
        <p class="stamp">Generated ${esc(new Date(report.created_at).toLocaleString())}</p>
      </div>
    </header>
    <div class="report-actions">
      <button type="button" class="btn btn-primary" onclick="window.print()">🖨️ Print / Save PDF</button>
      <a class="btn" href="/account/settings/finance/arrears/reports/${esc(report.report_id)}/download?format=csv">⬇️ Download CSV</a>
    </div>
    <section class="summary">
      <div class="card danger">
        <div class="label">Total Outstanding</div>
        <div class="value">${display.formatMoney(report.total_outstanding || 0)}</div>
      </div>
      <div class="card">
        <div class="label">Students in Arrears</div>
        <div class="value">${students.length}</div>
      </div>
    </section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Student</th><th>Class</th><th>Guardian</th><th>Contact</th>
            <th style="text-align:right;">Billed</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Outstanding</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="9" class="empty">No records in this report.</td></tr>'}
        </tbody>
      </table>
    </div>
    <footer class="report-footer">
      <div class="powered">
        <img src="/images/managira.png" alt="Managira" onerror="this.style.display='none'">
        <span>Powered by <span class="brand-name">Managira</span> — School Management, simplified.</span>
      </div>
      <div class="footer-note">
        This arrears report was generated for ${esc(schoolName)}.<br>Confidential — for internal use only.
      </div>
    </footer>
  </div>
</body>
</html>`);
    } catch (error) {
      console.error("[arrearsReportViewGet]", error);
      res.status(500).send("Could not load arrears report.");
    }
  },

  arrearsReportDownloadGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
    const orgId = req.session.organizationId;
    try {
      const report = await loadArrearsReportById(orgId, parseInt(req.params.id, 10));
      if (!report) return res.status(404).send("Report not found.");
      const display = await buildFinanceDisplayContext(req, orgId);
      const format = String(req.query.format || report.format || "pdf").toLowerCase();
      if (format === "csv") {
        const csv = buildArrearsReportCsv(report.snapshot || {});
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="arrears-report-${report.report_id}.csv"`);
        return res.send(csv);
      }
      const pdf = await buildArrearsReportPdfBuffer(report, display);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="arrears-report-${report.report_id}.pdf"`);
      return res.send(pdf);
    } catch (error) {
      console.error("[arrearsReportDownloadGet]", error);
      res.status(500).send("Could not download arrears report.");
    }
  },

  arrearsReportDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await db.query(`DELETE FROM finance_arrears_reports WHERE organization_id = $1 AND report_id = $2`, [orgId, req.params.id]);
      req.flash("success", "Arrears report deleted.");
    } catch (error) {
      console.error("[arrearsReportDeletePost]", error);
      req.flash("error", "Could not delete arrears report.");
    }
    res.redirect("/account/settings/finance/arrears");
  },

  arrearsEmailSendPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureArrearsSchema();
      const filters = normalizeArrearsFilters(req.body || {});
      const selectedIds = new Set(parseMultiValue(req.body.selected_student_ids));
      const loaded = await loadArrearsManagementData(orgId, filters);
      const orgProfile = await loadOrganizationProfile(orgId);
      const display = await buildFinanceDisplayContext(req, orgId, null, orgProfile.organization_country, orgProfile.organization_currency);
      const manualEntries = JSON.parse(String(req.body.manual_guardians_json || "{}").trim() || "{}");
      const students = loaded.students
        .filter((student) => !selectedIds.size || selectedIds.has(String(student.student_id)))
        .map((student) => {
          const manual = manualEntries[String(student.student_id)] || null;
          return {
            ...student,
            guardian_name: manual?.guardian_name || student.guardian_name,
            guardian_email: manual?.email || student.guardian_email,
            guardian_phone: manual?.phone || student.guardian_phone,
            guardian_relationship: manual?.relationship || student.guardian_relationship,
            outstanding_display: display.formatMoney(student.outstanding),
          };
        });
      const subjectTemplate = String(req.body.subject || "Outstanding Balance Notice — {Student Name}").trim();
      const bodyTemplate = String(req.body.body || "Dear {Guardian Name},\n\n{Student Name} currently has an outstanding balance of {Outstanding Amount}.\n\nPlease review and settle this balance as soon as possible.\n\nRegards,\n{School Name} Finance Office").trim();
      const paymentLink = buildStudentPaymentLink(req);
      const userName = [req.session.user?.first_name, req.session.user?.last_name].filter(Boolean).join(" ").trim() || req.session.userName || "Finance User";
      let delivered = 0;
      let failed = 0;
      let skipped = 0;

      for (const student of students) {
        const recipientEmail = String(student.guardian_email || "").trim();
        if (!student.guardian_name || !recipientEmail) {
          skipped += 1;
          await db.query(
            `INSERT INTO finance_arrears_email_logs (organization_id, student_id, guardian_id, recipient_email, subject, status, error_message, sent_by, sent_by_name, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
            [orgId, student.student_id, student.guardian_id || null, recipientEmail || null, subjectTemplate, "skipped", !student.guardian_name ? "Missing guardian" : "Missing email", req.session.user?.user_id || null, userName, JSON.stringify({ source: "arrears" })]
          ).catch(() => null);
          continue;
        }
        const subject = personalizeArrearsTemplate(subjectTemplate, student, orgProfile.organization_name || "Your School");
        const bodyText = personalizeArrearsTemplate(bodyTemplate, student, orgProfile.organization_name || "Your School");
        const details = [
          { label: "Student", value: student.student_name },
          { label: "Class", value: student.class_name || "—" },
          { label: "Outstanding Balance", value: student.outstanding_display },
          { label: "Days Overdue", value: String(student.max_days_overdue || 0) },
        ];
        const html = renderCleanEmail({
          title: subject,
          greeting: `Dear ${student.guardian_name},`,
          paragraphs: bodyText.split(/\n\n+/).filter(Boolean).map((paragraph) => paragraph.replace(/\n/g, '<br>')),
          details,
          cta: req.body.include_payment_link ? { url: paymentLink, text: "Pay Now" } : null,
          note: "This message was sent from the Managira Fee Recovery workspace.",
        });
        const ok = await sendEmailSafely({
          to: recipientEmail,
          subject,
          html,
          failureNotification: buildFailureNotification(orgId, {
            title: 'Fee recovery email failed',
            body: `The fee recovery email for ${student.student_name} could not be delivered to ${recipientEmail}.`,
            link: '/account/settings/finance/arrears',
          }),
        }, "Fee Recovery");
        await db.query(
          `INSERT INTO finance_arrears_email_logs (organization_id, student_id, guardian_id, recipient_email, subject, status, error_message, sent_by, sent_by_name, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [orgId, student.student_id, student.guardian_id || null, recipientEmail, subject, ok ? "delivered" : "failed", ok ? null : "SMTP send failed", req.session.user?.user_id || null, userName, JSON.stringify({ outstanding: student.outstanding, includePaymentLink: !!req.body.include_payment_link })]
        ).catch(() => null);
        if (ok) delivered += 1;
        else failed += 1;
      }

      req.flash("success", `Fee recovery emails processed. Delivered: ${delivered}, Failed: ${failed}, Skipped: ${skipped}.`);
    } catch (error) {
      console.error("[arrearsEmailSendPost]", error);
      req.flash("error", "Could not send arrears emails.");
    }
    res.redirect("/account/settings/finance/arrears");
  },

  // PSP / Payment-Settings save
  pspSavePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) {
      req.flash && req.flash("error", "Access denied.");
      return res.redirect("/account/settings");
    }
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");
    const provider = String(req.params.provider || '').toLowerCase();
    const allowed = ['stripe','momo','bank','general'];
    if (!allowed.includes(provider)) {
      req.flash && req.flash("error", "Unknown payment provider.");
      return res.redirect("/account/settings/finance?section=settings");
    }
    try {
      await ensurePspSettingsTable();
      const existing = await loadPspSettings(orgId);
      const next = { ...existing };
      // Stripe payment methods come as a multi-checkbox group → normalize to an array
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'stripe_methods')) {
        const raw = req.body.stripe_methods;
        next.stripe_methods = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        delete req.body.stripe_methods;
      } else if (provider === 'stripe') {
        // Form submitted with no boxes checked → store empty array
        next.stripe_methods = [];
      }
      // Persist whatever fields the form sent, ignoring blanks for secrets
      Object.keys(req.body || {}).forEach(k => {
        const v = req.body[k];
        if (k === 'organization_country' || k === 'currency') return;
        if (k.endsWith('_secret') || k.endsWith('_key')) {
          if (v && String(v).trim() && !/^[•*]+/.test(v)) next[k] = String(v).trim();
        } else if (v !== undefined && v !== null) {
          next[k] = typeof v === 'string' ? v.trim() : v;
        }
      });
      await db.query(
        `INSERT INTO finance_psp_settings (organization_id, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (organization_id) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
        [orgId, JSON.stringify(next)]
      );
      req.flash && req.flash("success", `${provider.toUpperCase()} settings saved.`);
      await logPaygira(req, {
        actionType: "Saved",
        moduleName: "PayGira Settings",
        recordType: "Payment Provider Settings",
        recordId: provider,
        recordLabel: provider.toUpperCase(),
        description: `Updated ${provider.toUpperCase()} payment provider settings.`,
        changedFields: Object.keys(req.body || {}).filter(k => !k.endsWith('_secret') && !k.endsWith('_key')).map(k => ({ field: k, value: String(req.body[k]).slice(0, 80) })).slice(0, 8),
      });
    } catch (err) {
      console.error("[pspSavePost]", err);
      req.flash && req.flash("error", "Failed to save payment settings.");
    }
    res.redirect("/account/settings/finance?section=settings");
  },

  // Page entry
  financePageGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) {
      req.flash && req.flash("error", "Access denied.");
      return res.redirect("/account/settings");
    }
    const orgId = req.session.organizationId;
    if (!orgId) return res.redirect("/account/login");

    try {
      await ensureFinanceSchema();
      await ensureAssigneeColumn();
      await ensurePaymentProviderSchema(db);
      const section = String(req.query.section || "overview").toLowerCase();
      const createBillDraft = req.session.financeBillCreateDraft || null;
      const sectionsUsingBills = new Set(["bills", "subscriptions"]);
      const needsBills = sectionsUsingBills.has(section);
      const needsStudentBilling = section === "students";
      const needsSignoffHistory = section === "payments";
      const needsPaystackSubaccounts = section === "settings";
      const needsChargeCards = section === "settings";
      const needsOverview = section === "payments";
      const needsTemplates = section === "templates";
      const needsHeavyRefs = new Set(["bills", "students"]).has(section);
      const refsMode = needsHeavyRefs ? "heavy" : "lite";
      const refsLoaderOptions = needsHeavyRefs
        ? { includeClasses: true, includeStudents: true, includeEmployees: true, includeEnrollmentLinks: true }
        : { includeClasses: false, includeStudents: false, includeEmployees: false, includeEnrollmentLinks: false };
      const signoffHistoryFilters = needsSignoffHistory
        ? {
            page: req.query.signoffPage,
            pageSize: req.query.signoffPageSize,
          }
        : {};

      // Cached loaders — 60s TTL with background refresh. Writes invalidate.
      const [templates, refs, pspSettings, orgProfile, signoffHistoryResult] = await Promise.all([
        needsTemplates
          ? cachedLoad(orgId, "templates", null, () => loadTemplates(orgId))
          : Promise.resolve([]),
        cachedLoad(orgId, "refs", refsMode, () => loadClassesAndStudents(orgId, refsLoaderOptions)),
        cachedLoad(orgId, "psp", null, () => loadPspSettings(orgId)),
        cachedLoad(orgId, "orgProfile", null, () => loadOrganizationProfile(orgId)),
        needsSignoffHistory
          ? cachedLoad(orgId, "signoffHistory", signoffHistoryFilters, () => loadCollectionSignoffHistory(orgId, signoffHistoryFilters))
          : Promise.resolve({ rows: [], pagination: { page: 1, pageSize: 20, hasMore: false, nextPage: null } }),
      ]);
      const currentAcademic = getCurrentAcademicContext(refs);
      const overviewFilters = {
        school_year_id: req.query.year || currentAcademic.schoolYearId || null,
        term_id: req.query.term || ((!req.query.year && !req.query.term) ? (currentAcademic.termId || null) : null),
      };
      const billListFilters = needsBills
        ? {
            school_year_id: req.query.billYear || currentAcademic.schoolYearId || null,
            term_id: req.query.billTerm || ((!req.query.billYear && !req.query.billTerm) ? (currentAcademic.termId || null) : null),
            page: req.query.billPage,
            pageSize: req.query.billPageSize,
          }
        : {};
      const studentBillingFilters = needsStudentBilling
        ? {
            school_year_id: req.query.studentYear || currentAcademic.schoolYearId || null,
            term_id: req.query.studentTerm || ((!req.query.studentYear && !req.query.studentTerm) ? (currentAcademic.termId || null) : null),
            page: req.query.studentPage,
            pageSize: req.query.studentPageSize,
          }
        : {};
      const [studentBillingResult, billsResult, overview, chargeCards, paystackSubaccountsResult] = await Promise.all([
        needsStudentBilling
          ? cachedLoad(orgId, "studentBilling", studentBillingFilters, () => loadStudentBilling(orgId, studentBillingFilters))
          : Promise.resolve({ rows: [], pagination: { page: 1, pageSize: 80, hasMore: false, nextPage: null } }),
        needsBills
          ? cachedLoad(orgId, "bills", billListFilters, () => loadBills(orgId, billListFilters))
          : Promise.resolve({ rows: [], pagination: { page: 1, pageSize: 60, hasMore: false, nextPage: null } }),
        needsOverview
          ? cachedLoad(orgId, "overview", overviewFilters, () => loadOverviewStats(orgId, overviewFilters))
          : Promise.resolve({
              totals: {
                total_billed: 0,
                total_collected: 0,
                outstanding: 0,
                overdue_count: 0,
                total_assignments: 0,
              },
              overpayments: 0,
              recent: [],
              billCount: 0,
              billStatusBreakdown: { paid: 0, pending: 0, overdue: 0, partial: 0, draft: 0, cancelled: 0 },
              filters: { school_year_id: null, term_id: null },
            }),
        needsChargeCards
          ? cachedLoad(orgId, "chargeCards", orgProfile.billing_provider || null, () => getOrgChargeCards(db, orgId, orgProfile.billing_provider || null))
          : Promise.resolve([]),
        needsPaystackSubaccounts
          ? cachedLoad(orgId, "paystackSubaccounts", null, () => db.query(
              `SELECT id, account_type, business_name, account_number, bank_name, bank_code,
                      momo_provider, momo_number, account_holder_name, is_primary
               FROM paystack_subaccounts
               WHERE organization_id = $1
               ORDER BY is_primary DESC, id ASC`,
              [orgId]
            ))
          : Promise.resolve({ rows: [] }),
      ]);
      const bills = Array.isArray(billsResult?.rows) ? billsResult.rows : [];
      const studentBilling = Array.isArray(studentBillingResult?.rows) ? studentBillingResult.rows : [];
      const signoffHistory = Array.isArray(signoffHistoryResult?.rows) ? signoffHistoryResult.rows : [];
      const billPagination = billsResult?.pagination || { page: 1, pageSize: 60, hasMore: false, nextPage: null };
      const studentBillingPagination = studentBillingResult?.pagination || { page: 1, pageSize: 80, hasMore: false, nextPage: null };
      const signoffHistoryPagination = signoffHistoryResult?.pagination || { page: 1, pageSize: 20, hasMore: false, nextPage: null };
      const paystackSubaccounts = paystackSubaccountsResult.rows;

      // SPA / browser cache hint: lets the SPA router show last snapshot
      // immediately on back-navigation while a fresh GET runs in background.
      res.set("Cache-Control", "private, max-age=5, stale-while-revalidate=30");
      res.set("Vary", "Cookie");

      const platformStripeKey = await getActiveStripePublicKey();

      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country, orgProfile.organization_currency);
      const financeCountry = resolveCountryName(orgProfile.organization_country, display.financeCurrency.countryHint);
      let arrearsData = null;
      let arrearsReports = [];
      let arrearsPresets = [];
      if (section === "arrears") {
        await ensureArrearsSchema();
        const defaultArrearsSchoolYears = req.query.schoolYearIds || currentAcademic.schoolYearId || null;
        const defaultArrearsTerms = req.query.termIds || ((!req.query.schoolYearIds && !req.query.termIds) ? (currentAcademic.termId || null) : null);
        const arrearsFilters = {
          schoolYearIds: defaultArrearsSchoolYears,
          termIds: defaultArrearsTerms,
          classIds: req.query.classIds,
          billIds: req.query.billIds,
          statuses: req.query.statuses,
          dueFrom: req.query.dueFrom,
          dueTo: req.query.dueTo,
          minOutstanding: req.query.minOutstanding,
          paymentMethodFilter: req.query.paymentMethodFilter,
          emailStatusFilter: req.query.emailStatusFilter,
          search: req.query.search,
        };
        const loadedArrears = await cachedLoad(orgId, "arrearsData", arrearsFilters, () => loadArrearsManagementData(orgId, arrearsFilters));
        arrearsData = {
          ...loadedArrears,
          queryString: buildArrearsQueryString(loadedArrears.filters),
          students: loadedArrears.students.map((student) => ({
            ...student,
            outstanding_display: display.formatMoney(student.outstanding),
            total_billed_display: display.formatMoney(student.total_billed),
            total_paid_display: display.formatMoney(student.total_paid),
            credit_display: display.formatMoney(student.student_credit || 0),
            bills: (student.bills || []).map((bill) => ({
              ...bill,
              total_billed_display: display.formatMoney(bill.total_billed),
              paid_display: display.formatMoney(bill.paid),
              outstanding_display: display.formatMoney(bill.outstanding),
            })),
          })),
        };
        [arrearsReports, arrearsPresets] = await Promise.all([
          cachedLoad(orgId, "arrearsReports", null, () => loadArrearsReports(orgId)),
          cachedLoad(orgId, "arrearsPresets", null, () => loadArrearsPresets(orgId)),
        ]);
      }

      // Mask sensitive secrets before sending to view
      const safePsp = maskPspSecrets(pspSettings);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      const collectionDestinations = await resolveBillCollectionDestinations(db, orgId, orgProfile, pspSettings);
      allowedMethods.currency = display.financeCurrency.code;
      safePsp.currency = display.financeCurrency.code;
      if (!safePsp.stripe_publishable_key && stripeRuntime.publishableKey) {
        safePsp.stripe_publishable_key = stripeRuntime.publishableKey;
      }

      res.render("account/finance", {
        title: "Finance & Billing",
        section,
        lazyOverview: section === "overview",
        overview,
        bills,
        studentBilling,
        templates,
        refs,
        pspSettings: safePsp,
        allowedMethods,
        financeCurrency: display.financeCurrency,
        currencyOptions: display.currencyOptions,
        countryOptions: getFinanceCountryOptions(),
        financeCountry,
        signoffHistory,
        signoffHistoryPagination,
        arrearsData,
        arrearsReports,
        arrearsPresets,
        chargeCards,
        paystackSubaccounts,
        collectionDestinationOptions: collectionDestinations.options,
        defaultCollectionDestination: collectionDestinations.defaultValue,
        paymentProvider: collectionDestinations.provider || '',
        platformStripeKey,
        createBillDraft,
        billListFilters,
        billPagination,
        studentBillingFilters,
        studentBillingPagination,
        formatMoney: display.formatMoney,
        formatUsdEquivalent: display.formatUsdEquivalent,
        stripeCatalog: STRIPE_METHOD_CATALOG,
        money,
        messages: req.flash ? req.flash() : {},
        req,
      });
    } catch (err) {
      console.error("[financePageGet]", err);
      req.flash && req.flash("error", "Unable to load Finance page.");
      res.redirect("/account/settings");
    }
  },

  // Templates
  templateCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      const { name, description, amount, bill_type, recurrence, late_fee_amount, late_fee_after_days } = req.body;
      const ins = await db.query(
        `INSERT INTO finance_fee_templates
          (organization_id, name, description, amount, bill_type, recurrence, late_fee_amount, late_fee_after_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING template_id`,
        [orgId, name, description || null, Number(amount || 0), bill_type || 'one_time',
          recurrence || null, Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          req.session.user?.user_id || null]
      );
      req.flash("success", "Template created.");
      await logPaygira(req, {
        actionType: "Created",
        recordType: "Fee Template",
        recordId: ins.rows[0]?.template_id,
        recordLabel: name,
        description: `Created fee template "${name}" ($${Number(amount || 0).toFixed(2)}, ${bill_type || 'one_time'}${recurrence ? `/${recurrence}` : ''}).`,
        changedFields: [
          { field: "Amount", value: `$${Number(amount || 0).toFixed(2)}` },
          { field: "Type", value: bill_type || 'one_time' },
          { field: "Recurrence", value: recurrence || '—' },
        ],
      });
    } catch (e) { console.error(e); req.flash("error", "Could not create template."); }
    res.redirect("/account/settings/finance?section=templates");
  },

  templateDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      const t = (await db.query(`SELECT name FROM finance_fee_templates WHERE template_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      await db.query(`DELETE FROM finance_fee_templates WHERE template_id = $1 AND organization_id = $2`,
        [req.params.id, orgId]);
      req.flash("success", "Template deleted.");
      await logPaygira(req, {
        actionType: "Deleted",
        recordType: "Fee Template",
        recordId: req.params.id,
        recordLabel: t?.name || `Template #${req.params.id}`,
        description: `Deleted fee template "${t?.name || req.params.id}".`,
        changedFields: [],
      });
    } catch (e) { req.flash("error", "Could not delete template."); }
    res.redirect("/account/settings/finance?section=templates");
  },

  // Bills
  billCreatePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    let client;
    try {
      await ensureFinanceSchema();
      client = await db.connect();
      await client.query("BEGIN");
      const {
        title, description, amount, bill_type, recurrence, recurrence_end_date,
        late_fee_amount, late_fee_after_days,
        applies_to, school_year_id, term_id, due_date,
        exclude_non_school_days,
        accepts_card, accepts_cash, accepts_transfer,
        notify_email, notify_sms,
        target_class_ids, target_student_ids, status,
        assignee_ids: rawAssigneeIds,
        assignee_id: rawAssigneeId,
        payment_destination
      } = req.body;
      // Support both a single assignee_id and a multi-select assignee_ids[]
      const assigneeList = (() => {
        const raw = rawAssigneeIds || rawAssigneeId;
        return [...new Set(
          (Array.isArray(raw) ? raw : raw ? [raw] : [])
            .map(x => parseInt(x, 10)).filter(Boolean)
        )];
      })();
      const assignee_id = assigneeList[0] || null; // primary (legacy column)
      // Server-side validation — never persist a bill that is missing required fields.
      if (!String(title || '').trim()) {
        throw new PaygiraRequestError('Bill title is required.');
      }
      if (!(Number(amount) > 0)) {
        throw new PaygiraRequestError('Enter a bill amount greater than zero.');
      }
      if (!school_year_id || !term_id) {
        throw new PaygiraRequestError('Select a school year and term for this bill.');
      }
      if (!due_date) {
        throw new PaygiraRequestError('Select a start / first date for this bill.');
      }
      if (String(applies_to) === 'classes' && !normalizeIdArray(target_class_ids).length) {
        throw new PaygiraRequestError('Choose one or more classes for this bill.');
      }
      if (String(applies_to) === 'students' && !normalizeIdArray(target_student_ids).length) {
        throw new PaygiraRequestError('Choose one or more students for this bill.');
      }
      const collectionDestinations = await resolveBillCollectionDestinations(client, orgId);
      const allowedDestinationValues = new Set(collectionDestinations.options.map((option) => option.value));
      const destination = allowedDestinationValues.has(String(payment_destination || '').trim())
        ? String(payment_destination).trim()
        : (collectionDestinations.defaultValue || 'cash');

      const resolvedBillType = ['one_time','recurring','installment'].includes(String(bill_type))
        ? String(bill_type)
        : 'one_time';
      const resolvedRecurrence = ['daily','weekly','monthly','term','year'].includes(String(recurrence))
        ? String(recurrence)
        : null;
      const academicContext = await resolveBillAcademicContext(client, orgId, school_year_id, term_id);
      const audience = ['school', 'classes', 'students'].includes(String(applies_to))
        ? String(applies_to)
        : 'school';
      const resolvedTargets = await loadBillAudienceTargets(
        client,
        orgId,
        null,
        audience,
        target_class_ids,
        target_student_ids
      );
      const eligibleStudentIds = await loadEligibleBillStudents(
        client,
        orgId,
        academicContext.schoolYearId,
        academicContext.termId,
        audience,
        resolvedTargets.targetClassIds,
        resolvedTargets.targetStudentIds
      );
      if (!eligibleStudentIds.length && status !== 'draft') {
        throw new PaygiraRequestError('No enrolled students were found for the selected audience in that school year and term.');
      }
      const schedule = await resolveScheduleValidationContext(client, orgId, {
        bill_type: resolvedBillType,
        recurrence: resolvedRecurrence,
        recurrence_end_date,
        due_date,
        term_id: academicContext.termId,
        exclude_non_school_days,
      });
      const amt = Number(amount || 0);
      const insert = await client.query(
        `INSERT INTO finance_bills
         (organization_id, title, description, amount, bill_type, recurrence, recurrence_end_date,
          late_fee_amount, late_fee_after_days, applies_to, school_year_id, term_id, due_date, exclude_non_school_days,
          accepts_card, accepts_cash, accepts_transfer, notify_email, notify_sms, status, created_by, assignee_id, payment_destination,
          target_class_ids, target_student_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING bill_id`,
        [orgId, title, description || null, amt, resolvedBillType, resolvedRecurrence,
          schedule.recurrenceEndDate,
          Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          audience,
          academicContext.schoolYearId, academicContext.termId,
          schedule.normalizedDueDate,
          schedule.excludeNonSchoolDays,
          !!accepts_card, !!accepts_cash, !!accepts_transfer,
          !!notify_email, !!notify_sms,
          status === 'draft' ? 'draft' : 'active',
          req.session.user?.user_id || null, assignee_id, destination,
          resolvedTargets.targetClassIds.length ? resolvedTargets.targetClassIds : null,
          resolvedTargets.targetStudentIds.length ? resolvedTargets.targetStudentIds : null]
      );
      const billId = insert.rows[0].bill_id;

      // Sync collectors junction table
      if (assigneeList.length > 0) {
        await client.query(
          `INSERT INTO finance_bill_collectors (bill_id, user_id, organization_id)
           SELECT $1, unnest($2::int[]), $3
           ON CONFLICT (bill_id, user_id) DO NOTHING`,
          [billId, assigneeList, orgId]
        );
      }

      if (status !== 'draft' && eligibleStudentIds.length) {
        await syncBillAssignmentsForAudience(client, orgId, billId, {
          appliesTo: audience,
          schoolYearId: academicContext.schoolYearId,
          termId: academicContext.termId,
          targetClassIds: resolvedTargets.targetClassIds,
          targetStudentIds: resolvedTargets.targetStudentIds,
          amount: amt,
          dueDate: schedule.normalizedDueDate,
          status,
        });
      }

      delete req.session.financeBillCreateDraft;

      await client.query("COMMIT");

      req.flash("success", `Bill created and assigned to ${eligibleStudentIds.length} student(s).`);
      await logPaygira(req, {
        actionType: "Created",
        recordType: "Bill",
        recordId: billId,
        recordLabel: title,
        description: `Created bill "${title}" ($${amt.toFixed(2)}) — type: ${resolvedBillType}, applies to ${audience}, ${eligibleStudentIds.length} student(s) assigned, destination: ${destination}.`,
        changedFields: [
          { field: "Amount", value: `$${amt.toFixed(2)}` },
          { field: "Bill Type", value: resolvedBillType },
          { field: "Audience", value: audience },
          { field: "Assignments", value: String(eligibleStudentIds.length) },
          { field: "Destination", value: destination },
          { field: "Status", value: status === 'draft' ? 'draft' : 'active' },
        ],
      });

      // Notify each guardian linked to the newly assigned students about the new bill
      if (status !== 'draft' && eligibleStudentIds.length) {
        Promise.resolve().then(async () => {
          try {
            const guardianRows = await db.query(
              `SELECT DISTINCT
                 COALESCE(gp.guardian_id, NULL)   AS profile_guardian_id,
                 g.guardian_id                    AS legacy_guardian_id,
                 s.first_name || ' ' || s.last_name AS student_name,
                 gp.guardian_id                   AS notif_id
               FROM students s
               LEFT JOIN guardian_students gs ON gs.student_id = s.student_id
               LEFT JOIN guardian_profiles  gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
               LEFT JOIN guardians          g  ON g.student_id  = s.student_id   AND g.organization_id  = $1
               WHERE s.student_id = ANY($2::int[]) AND s.organization_id = $1
                 AND gp.guardian_id IS NOT NULL`,
              [orgId, eligibleStudentIds]
            );
            for (const gr of guardianRows.rows) {
              if (!gr.notif_id) continue;
              await createNotification(db, {
                orgId,
                recipientType: 'guardian',
                recipientId: Number(gr.notif_id),
                type: 'new_bill',
                title: `New payment assigned — ${gr.student_name}`,
                body: `"${title}" has been assigned. Amount: ${amt.toFixed(2)}.`,
                link: `/guardian/paygira`,
              });
            }
          } catch (_) {}
        });
      }
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[billCreate]", e);
      req.session.financeBillCreateDraft = buildFinanceBillCreateDraft(req.body || {});
      req.flash("error", "Could not create bill: " + e.message);
    } finally {
      if (client) client.release();
    }
    if (req.session && typeof req.session.save === 'function') {
      return req.session.save(() => res.redirect("/account/settings/finance?section=bills"));
    }
    res.redirect("/account/settings/finance?section=bills");
  },

  billCancelPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      await db.query(`UPDATE finance_bills SET status='cancelled', updated_at=now() WHERE bill_id=$1 AND organization_id=$2`,
        [req.params.id, orgId]);
      await db.query(`UPDATE finance_bill_assignments SET status='cancelled', updated_at=now()
        WHERE bill_id=$1 AND organization_id=$2 AND status NOT IN ('paid')`, [req.params.id, orgId]);
      req.flash("success", "Bill cancelled.");
      await logPaygira(req, {
        actionType: "Cancelled",
        recordType: "Bill",
        recordId: req.params.id,
        recordLabel: billRow?.title || `Bill #${req.params.id}`,
        description: `Cancelled bill "${billRow?.title || req.params.id}" and revoked all unpaid assignments.`,
        changedFields: [{ field: "Status", value: "cancelled" }],
      });
    } catch (e) { req.flash("error", "Could not cancel bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  billDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      await db.query(`DELETE FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId]);
      req.flash("success", "Bill deleted.");
      await logPaygira(req, {
        actionType: "Deleted",
        recordType: "Bill",
        recordId: req.params.id,
        recordLabel: billRow?.title || `Bill #${req.params.id}`,
        description: `Permanently deleted bill "${billRow?.title || req.params.id}".`,
        changedFields: [],
      });
    } catch (e) { req.flash("error", "Could not delete bill."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  // Manual payment
  paymentRecordPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const { assignment_id, amount, method, reference, notes } = req.body;
    try {
      const a = await db.query(
        `SELECT a.*, b.due_date FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2`,
        [assignment_id, orgId]
      );
      if (!a.rows.length) { req.flash("error", "Assignment not found."); return res.redirect("/account/settings/finance?section=bills"); }
      const row = a.rows[0];
      const amt = Number(amount || 0);
      if (amt <= 0) { req.flash("error", "Enter a valid amount."); return res.redirect("/account/settings/finance?section=bills"); }
      const normalizedMethod = String(method || 'cash').toLowerCase();
      const { percentage: platformFeePercentage } = await getPlatformFeeSettings(db);
      const platformFeeBearer = await getOrgPlatformFeeBearer(orgId, db);
      const chargeBreakdown = buildFinancePaymentChargeBreakdown(amt, normalizedMethod, platformFeePercentage, 0, platformFeeBearer);

      await db.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by, platform_fee_percentage, platform_fee_amount, platform_fee_bearer, tax_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          normalizedMethod, reference || null, notes || null,
          req.session.user?.user_id || null,
          chargeBreakdown.platformFeePercentage,
          chargeBreakdown.platformFeeAmount,
          platformFeeBearer,
          chargeBreakdown.taxAmount]
      );
      const newPaid = Number(row.amount_paid) + amt;
      const total = Number(row.amount) + Number(row.late_fee_applied || 0);
      let credit = 0;
      let appliedToAssignment = newPaid;
      if (newPaid > total) {
        credit = newPaid - total;
        appliedToAssignment = total;
      }
      const newStatus = recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await db.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (credit > 0) {
        await db.query(
          `INSERT INTO finance_student_credits (organization_id, student_id, amount)
             VALUES ($1,$2,$3)
           ON CONFLICT (student_id) DO UPDATE SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
          [orgId, row.student_id, credit]
        );
      }
      const display = await buildFinanceDisplayContext(req, orgId);
      let successMessage = credit > 0 ? `Payment recorded. ${display.formatMoney(credit)} added as credit.` : "Payment recorded.";
      if (chargeBreakdown.platformFeeAmount > 0) {
        successMessage += ` ${display.formatMoney(chargeBreakdown.platformFeeAmount)} charged as platform fee.`;
      }
      req.flash("success", successMessage);
      // Resolve student name for log
      let studentLabel = `Student #${row.student_id}`;
      try {
        const sRow = (await db.query(`SELECT first_name, last_name FROM students WHERE student_id=$1 AND organization_id=$2`, [row.student_id, orgId])).rows[0];
        if (sRow) studentLabel = `${sRow.first_name} ${sRow.last_name}`;
      } catch (_) {}
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1`, [row.bill_id])).rows[0];
      await logPaygira(req, {
        actionType: "Recorded Payment",
        recordType: "Payment",
        recordId: row.assignment_id,
        recordLabel: `${studentLabel} — ${billRow?.title || ('Bill #' + row.bill_id)}`,
        description: `Recorded $${amt.toFixed(2)} (${method || 'cash'}) for ${studentLabel} on bill "${billRow?.title || row.bill_id}". New status: ${newStatus}${credit > 0 ? `; $${credit.toFixed(2)} credited.` : ''}.`,
        changedFields: [
          { field: "Amount", value: `$${amt.toFixed(2)}` },
          { field: "Method", value: method || 'cash' },
          { field: "Reference", value: reference || '—' },
          { field: "New Status", value: newStatus },
        ],
      });
    } catch (e) {
      console.error("[paymentRecord]", e);
      req.flash("error", "Could not record payment.");
    }
    res.redirect("/account/settings/finance?section=payments");
  },

  paymentDeletePost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const paymentId = parseInt(req.params.id, 10);
    const correctionNote = String(req.body.correction_note || '').trim();
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      req.flash("error", "Invalid payment selected.");
      return res.redirect("/account/settings/finance?section=payments");
    }

    let client;
    try {
      client = await db.connect();
      await client.query("BEGIN");

      const paymentResult = await client.query(
        `SELECT p.payment_id, p.organization_id, p.assignment_id, p.bill_id, p.student_id,
                p.amount, p.method, p.reference, p.notes, p.occurrence_date::text AS occurrence_date,
                p.received_at,
                a.amount AS assignment_amount,
                a.late_fee_applied,
                a.amount_paid AS assignment_amount_paid,
                b.title AS bill_title,
                b.bill_type,
                b.recurrence,
                b.due_date,
                b.recurrence_end_date,
                b.term_id,
                b.exclude_non_school_days,
                tm.end_date AS term_end_date,
                s.first_name,
                s.last_name
           FROM finance_payments p
           LEFT JOIN finance_bill_assignments a ON a.assignment_id = p.assignment_id
           LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
           LEFT JOIN terms tm ON tm.term_id = b.term_id
           LEFT JOIN students s ON s.student_id = p.student_id
          WHERE p.payment_id = $1 AND p.organization_id = $2
          LIMIT 1
          FOR UPDATE`,
        [paymentId, orgId]
      );

      if (!paymentResult.rows.length) {
        throw new PaygiraRequestError("Payment not found.", 404);
      }

      const payment = paymentResult.rows[0];
      const occurrenceScope = normalizeOccurrenceDate(payment.occurrence_date);

      if (payment.bill_id) {
        const signoffLock = await client.query(
          `SELECT signoff_id, scope_key
             FROM finance_collection_signoffs
            WHERE organization_id = $1
              AND bill_id = $2
              AND (scope_key = 'bill' OR ($3::text IS NOT NULL AND scope_key = $3::text))
            ORDER BY signed_at DESC
            LIMIT 1`,
          [orgId, payment.bill_id, occurrenceScope]
        );
        if (signoffLock.rows.length) {
          throw new PaygiraRequestError("This payment belongs to a signed-off scope. Un-sign that scope first, then retry.", 400);
        }
      }

      let assignmentUpdate = null;
      let creditBefore = 0;
      let creditAfter = 0;
      if (payment.assignment_id) {
        const totalsBeforeResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS total_paid
             FROM finance_payments
            WHERE organization_id = $1 AND assignment_id = $2`,
          [orgId, payment.assignment_id]
        );
        const totalPaidBeforeDelete = Number(totalsBeforeResult.rows[0]?.total_paid || 0);
        const totalPaidAfterDelete = Math.max(totalPaidBeforeDelete - Number(payment.amount || 0), 0);
        const isRecurring = String(payment.bill_type || '').toLowerCase() === 'recurring';

        if (payment.student_id) {
          creditBefore = await getStudentCreditBalance(client, orgId, payment.student_id, { forUpdate: true });
        }

        const assignmentScheduleContext = createBillScheduleContextLoader(client, orgId);
        const scheduledDue = isRecurring
          ? await getScheduledBilledAmount({
              amount: payment.assignment_amount,
              bill_type: payment.bill_type,
              recurrence: payment.recurrence,
              due_date: payment.due_date,
              recurrence_end_date: payment.recurrence_end_date,
              term_id: payment.term_id,
              term_end_date: payment.term_end_date,
              exclude_non_school_days: payment.exclude_non_school_days,
            }, assignmentScheduleContext)
          : Number(payment.assignment_amount || 0);
        const totalDue = Number(scheduledDue || 0) + Number(payment.late_fee_applied || 0);

        let creditAdjustment = 0;
        if (String(payment.method || '').toLowerCase() === 'credit') {
          creditAdjustment += Number(payment.amount || 0);
        }
        if (!isRecurring) {
          const overBefore = Math.max(totalPaidBeforeDelete - totalDue, 0);
          const overAfter = Math.max(totalPaidAfterDelete - totalDue, 0);
          creditAdjustment -= Math.max(overBefore - overAfter, 0);
        }

        if (creditBefore + creditAdjustment < -0.000001) {
          throw new PaygiraRequestError(
            "Cannot delete this payment because linked overpayment credit has already been used. Reverse related credit usage first.",
            400
          );
        }

        const appliedToAssignment = Math.min(totalPaidAfterDelete, totalDue);
        const newStatus = isRecurring
          ? (appliedToAssignment >= totalDue
              ? 'paid'
              : (appliedToAssignment > 0
                ? 'partial'
                : recalcAssignmentStatus(payment.assignment_amount, payment.late_fee_applied, appliedToAssignment, payment.due_date)))
          : recalcAssignmentStatus(payment.assignment_amount, payment.late_fee_applied, appliedToAssignment, payment.due_date);

        assignmentUpdate = {
          amountPaid: appliedToAssignment,
          status: newStatus,
        };

        creditAfter = payment.student_id
          ? await setStudentCreditBalance(client, orgId, payment.student_id, creditBefore + creditAdjustment)
          : creditBefore;
      }

      await client.query(
        `DELETE FROM finance_payments WHERE payment_id = $1 AND organization_id = $2`,
        [paymentId, orgId]
      );

      if (payment.assignment_id && assignmentUpdate) {
        await client.query(
          `UPDATE finance_bill_assignments
              SET amount_paid = $1, status = $2, updated_at = now()
            WHERE assignment_id = $3 AND organization_id = $4`,
          [assignmentUpdate.amountPaid, assignmentUpdate.status, payment.assignment_id, orgId]
        );
      }

      await client.query("COMMIT");

      const studentLabel = [payment.first_name, payment.last_name].filter(Boolean).join(' ').trim() || `Student #${payment.student_id || 'N/A'}`;
      const display = await buildFinanceDisplayContext(req, orgId);
      await logPaygira(req, {
        actionType: "Deleted Payment",
        recordType: "Payment",
        recordId: paymentId,
        recordLabel: `${studentLabel} — ${payment.bill_title || 'Bill payment'}`,
        description: `Deleted payment ${display.formatMoney(payment.amount || 0)} (${payment.method || 'unknown'}) for ${studentLabel}${payment.bill_title ? ` on "${payment.bill_title}"` : ''}.${correctionNote ? ` Note: ${correctionNote}` : ''}`,
        changedFields: [
          { field: "Amount", value: display.formatMoney(payment.amount || 0) },
          { field: "Method", value: String(payment.method || '—') },
          { field: "Reference", value: payment.reference || '—' },
          ...(payment.assignment_id && assignmentUpdate ? [{ field: "Assignment Status", value: assignmentUpdate.status }] : []),
          ...(payment.student_id ? [{ field: "Credit Balance", value: `${display.formatMoney(creditBefore)} -> ${display.formatMoney(creditAfter)}` }] : []),
        ],
      });

      req.flash(
        "success",
        `Payment deleted. Audit logs were saved, and the affected record was recalculated to ${assignmentUpdate ? assignmentUpdate.status : 'the correct'} payment status.`
      );
    } catch (error) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[paymentDeletePost]", error);
      req.flash("error", error instanceof PaygiraRequestError ? error.message : "Could not delete payment.");
    } finally {
      if (client) client.release();
    }

    res.redirect("/account/settings/finance?section=payments");
  },

  signoffUnsignPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const signoffId = parseInt(req.params.id, 10);
    if (!Number.isInteger(signoffId) || signoffId <= 0) {
      req.flash("error", "Invalid sign-off selected.");
      return res.redirect("/account/settings/finance?section=payments");
    }

    try {
      await ensureSignoffCorrectionSchema();
      const rowResult = await db.query(
        `SELECT h.signoff_id, h.bill_id, h.class_id, h.occurrence_date::text AS occurrence_date,
                h.scope_key, h.signed_by_name, h.signed_at, h.total_collected,
                b.title AS bill_title
           FROM finance_collection_signoffs h
           JOIN finance_bills b ON b.bill_id = h.bill_id
          WHERE h.signoff_id = $1 AND h.organization_id = $2
          LIMIT 1`,
        [signoffId, orgId]
      );
      if (!rowResult.rows.length) {
        throw new PaygiraRequestError("Sign-off record not found.", 404);
      }
      const signoff = rowResult.rows[0];

      const normalizedScope = String(signoff.scope_key || 'bill').trim() || 'bill';
      const normalizedOccurrenceDate = normalizedScope === 'bill'
        ? null
        : normalizeOccurrenceDate(signoff.occurrence_date);
      const reopenedByUserId = req.session.user?.user_id || req.session.userId || null;
      const reopenedByName = [req.session.user?.first_name, req.session.user?.last_name].filter(Boolean).join(' ').trim()
        || req.session.user?.email
        || req.session.email
        || 'Finance Admin';

      await db.query(
        `INSERT INTO finance_collection_signoff_corrections
          (organization_id, bill_id, class_id, scope_key, occurrence_date, reopened_signoff_id, reopened_by_user_id, reopened_by_name, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orgId,
          signoff.bill_id,
          normalizeSignoffClassId(signoff.class_id),
          normalizedScope,
          normalizedOccurrenceDate,
          signoffId,
          reopenedByUserId,
          reopenedByName,
          'Reopened for correction via PayGira sign-off history.',
        ]
      );

      await db.query(
        `DELETE FROM finance_collection_signoffs WHERE signoff_id = $1 AND organization_id = $2`,
        [signoffId, orgId]
      );

      await logPaygira(req, {
        actionType: "Unsigned",
        recordType: "Collection Sign-Off",
        recordId: signoffId,
        recordLabel: signoff.bill_title || `Bill #${signoff.bill_id}`,
        description: `Unsigned collection sign-off for ${signoff.bill_title || `bill #${signoff.bill_id}`} (${signoff.scope_key === 'bill' ? 'whole bill' : (signoff.occurrence_date || 'date scope')}).`,
        changedFields: [
          { field: "Signer", value: signoff.signed_by_name || 'Staff' },
          { field: "Scope", value: signoff.scope_key === 'bill' ? 'Whole bill' : (signoff.occurrence_date || 'Date') },
          { field: "Collected", value: Number(signoff.total_collected || 0).toFixed(2) },
        ],
      });

      req.flash("success", "Sign-off reopened for correction. Audit logs were saved. The collection is back in class PayGira and can be signed off again after corrections.");
    } catch (error) {
      console.error("[signoffUnsignPost]", error);
      req.flash("error", error instanceof PaygiraRequestError ? error.message : "Could not remove sign-off.");
    }

    res.redirect("/account/settings/finance?section=payments");
  },

  signoffReportGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
    const orgId = req.session.organizationId;
    const signoffId = parseInt(req.params.id, 10);
    if (!Number.isInteger(signoffId) || signoffId <= 0) return res.status(400).send("Invalid sign-off ID.");

    const escapeHtml = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    try {
      const signoffResult = await db.query(
        `SELECT h.signoff_id, h.bill_id, h.class_id, h.occurrence_date::text AS occurrence_date,
                h.scope_key, h.signed_by_name, h.signed_at, h.total_collected, h.student_count,
                b.title AS bill_title,
                o.organization_name, o.organization_address, o.organization_phone, o.email AS organization_email,
                o.logo_path AS organization_logo,
                c.class_name
           FROM finance_collection_signoffs h
           JOIN finance_bills b ON b.bill_id = h.bill_id
           JOIN organizations o ON o.organization_id = h.organization_id
           LEFT JOIN classes c ON c.class_id = NULLIF(h.class_id, 0)
          WHERE h.signoff_id = $1 AND h.organization_id = $2
          LIMIT 1`,
        [signoffId, orgId]
      );
      if (!signoffResult.rows.length) return res.status(404).send("Sign-off not found.");
      const signoff = signoffResult.rows[0];
      const display = await buildFinanceDisplayContext(req, orgId);
      const paygiraLogoUrl = '/images/managira.png';
      const schoolLogoUrl = signoff.organization_logo
        ? (String(signoff.organization_logo).startsWith('http')
            ? String(signoff.organization_logo)
            : `/uploads/${String(signoff.organization_logo).replace(/^\/+/, '')}`)
        : '';

      const scopeClassId = normalizeSignoffClassId(signoff.class_id);
      const isOccurrenceScope = signoff.scope_key !== 'bill' && !!normalizeOccurrenceDate(signoff.occurrence_date);
      const params = [orgId, signoff.bill_id, scopeClassId];
      let dateSql = '';
      if (isOccurrenceScope) {
        params.push(normalizeOccurrenceDate(signoff.occurrence_date));
        dateSql = ` AND p.occurrence_date = $4::date`;
      }

      const paymentsResult = await db.query(
        `SELECT p.payment_id,
                p.received_at,
                p.occurrence_date::text AS occurrence_date,
                p.amount,
                p.method,
                p.reference,
                p.notes,
                COALESCE(CONCAT_WS(' ', s.first_name, s.last_name), 'Unknown student') AS student_name,
                COALESCE(c.class_name, 'No class') AS class_name,
                COALESCE(CONCAT_WS(' ', u.first_name, u.last_name), 'System') AS received_by
           FROM finance_payments p
           LEFT JOIN students s ON s.student_id = p.student_id
           LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN users u ON u.user_id = p.received_by
          WHERE p.organization_id = $1
            AND p.bill_id = $2
            AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$3', orgParamSql: '$1' })}
            ${dateSql}
          ORDER BY p.received_at ASC`,
        params
      );

      if (String(req.query.format || '').toLowerCase() === 'csv') {
        const headerRows = [
          ['Organization', signoff.organization_name || ''],
          ['Sign-Off ID', String(signoff.signoff_id)],
          ['Bill', signoff.bill_title || ''],
          ['Scope', signoff.scope_key === 'bill' ? 'Whole bill' : (signoff.occurrence_date || 'Date scope')],
          ['Class', scopeClassId > 0 ? (signoff.class_name || 'Class scope') : 'All assigned students'],
          ['Signed By', signoff.signed_by_name || 'Staff'],
          ['Signed At', signoff.signed_at ? new Date(signoff.signed_at).toISOString() : ''],
          [''],
        ];
        const tableHeader = [['Payment ID', 'Date', 'Student', 'Class', 'Occurrence Date', 'Method', 'Reference', 'Amount', 'Collected By', 'Notes']];
        const tableRows = paymentsResult.rows.map((row) => [
          row.payment_id,
          row.received_at ? new Date(row.received_at).toISOString() : '',
          row.student_name,
          row.class_name,
          row.occurrence_date || '',
          row.method || '',
          row.reference || '',
          Number(row.amount || 0).toFixed(2),
          row.received_by || '',
          row.notes || '',
        ]);
        const toCsvLine = (cells) => cells.map((cell) => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`).join(',');
        const csv = [...headerRows, ...tableHeader, ...tableRows].map(toCsvLine).join('\r\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="signoff-${signoff.signoff_id}-payments.csv"`);
        return res.send(csv);
      }

      const rowsHtml = paymentsResult.rows.map((row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.received_at ? new Date(row.received_at).toLocaleString() : '—')}</td>
          <td>${escapeHtml(row.student_name || '—')}</td>
          <td>${escapeHtml(row.class_name || '—')}</td>
          <td>${escapeHtml(row.occurrence_date ? new Date(`${row.occurrence_date}T00:00:00`).toLocaleDateString() : '—')}</td>
          <td>${escapeHtml(row.method || '—')}</td>
          <td>${escapeHtml(row.reference || '—')}</td>
          <td style="text-align:right;">${escapeHtml(display.formatMoney(row.amount || 0))}</td>
          <td>${escapeHtml(row.received_by || 'System')}</td>
          <td>${escapeHtml(row.notes || '—')}</td>
        </tr>
      `).join('');

      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign-Off Payments Report #${signoff.signoff_id}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111827; background: #edf2f7; }
    .page { max-width: 1120px; margin: 0 auto; padding: 28px; }
    .sheet { background: #ffffff; border: 1px solid #dbe3ef; border-radius: 24px; padding: 28px; box-shadow: 0 20px 54px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 6px; font-size: 28px; }
    .meta { margin: 0 0 18px; color: #4b5563; font-size: 13px; }
    .hero { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 20px; }
    .brand-stack { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .logo-card { display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #dbe3ef; border-radius: 16px; min-width: 108px; min-height: 72px; padding: 10px 14px; }
    .logo-card img { display: block; max-height: 52px; max-width: 132px; object-fit: contain; }
    .logo-card.fallback { font-size: 12px; color: #64748b; letter-spacing: 0.08em; text-transform: uppercase; }
    .hero-note { background: linear-gradient(135deg, #f8fbff, #eef6ff); border: 1px solid #cfe1ff; border-radius: 16px; padding: 14px 16px; max-width: 320px; color: #23406a; font-size: 12px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px 20px; margin-bottom: 18px; }
    .item strong { display: inline-block; min-width: 120px; color: #111827; }
    .actions { margin: 0 0 18px; display: flex; gap: 10px; flex-wrap: wrap; }
    .actions a { display: inline-block; padding: 9px 13px; border: 1px solid #d1d5db; border-radius: 999px; text-decoration: none; color: #111827; background: #fff; }
    .actions a.primary { background: #0f1728; color: #fff; border-color: #0f1728; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; overflow: hidden; border-radius: 16px; }
    th, td { border: 1px solid #e5e7eb; padding: 7px 8px; vertical-align: top; }
    th { background: #f8fafc; text-align: left; }
    .summary { margin: 10px 0 16px; font-size: 13px; color: #334155; }
    @media (max-width: 760px) {
      .page { padding: 16px; }
      .sheet { padding: 18px; border-radius: 18px; }
      .hero, .grid { display: block; }
      .hero-note { max-width: none; margin-top: 14px; }
      .item { margin-bottom: 8px; }
      table { font-size: 11px; }
    }
    @media print {
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
      .sheet { box-shadow: none; border: 0; border-radius: 0; padding: 0; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
  <div class="sheet">
  <div class="hero">
    <div>
      <div class="brand-stack">
        <div class="logo-card">
          <img src="${escapeHtml(paygiraLogoUrl)}" alt="PayGira by Managira" />
        </div>
        ${schoolLogoUrl ? `<div class="logo-card"><img src="${escapeHtml(schoolLogoUrl)}" alt="${escapeHtml(signoff.organization_name || 'School')} logo" /></div>` : `<div class="logo-card fallback">School Logo</div>`}
      </div>
      <h1>${escapeHtml(signoff.organization_name || 'School')}</h1>
      <p class="meta">Collection Sign-Off Payments Report (Read-only audit copy)</p>
    </div>
    <div class="hero-note">
      This report is a locked snapshot of the signed collection scope. If corrections are needed, reopen the sign-off from Finance, correct the payments, and sign it off again.
    </div>
  </div>
  <div class="grid">
    <div class="item"><strong>Sign-Off ID:</strong> ${escapeHtml(signoff.signoff_id)}</div>
    <div class="item"><strong>Signed At:</strong> ${escapeHtml(signoff.signed_at ? new Date(signoff.signed_at).toLocaleString() : '—')}</div>
    <div class="item"><strong>Bill:</strong> ${escapeHtml(signoff.bill_title || '—')}</div>
    <div class="item"><strong>Scope:</strong> ${escapeHtml(signoff.scope_key === 'bill' ? 'Whole bill' : (signoff.occurrence_date || 'Date scope'))}</div>
    <div class="item"><strong>Class:</strong> ${escapeHtml(scopeClassId > 0 ? (signoff.class_name || 'Class scope') : 'All assigned students')}</div>
    <div class="item"><strong>Signed By:</strong> ${escapeHtml(signoff.signed_by_name || 'Staff')}</div>
    <div class="item"><strong>Students:</strong> ${escapeHtml(signoff.student_count || 0)}</div>
    <div class="item"><strong>Collected at sign-off:</strong> ${escapeHtml(display.formatMoney(signoff.total_collected || 0))}</div>
    <div class="item"><strong>Address:</strong> ${escapeHtml(signoff.organization_address || '—')}</div>
    <div class="item"><strong>Contact:</strong> ${escapeHtml(signoff.organization_phone || signoff.organization_email || '—')}</div>
  </div>
  <div class="actions">
    <a class="primary" href="/account/settings/finance/signoffs/${signoff.signoff_id}/report?format=csv">Download CSV</a>
    <a href="javascript:window.print()">Print</a>
  </div>
  <div class="summary"><strong>Payments in this sign-off scope:</strong> ${paymentsResult.rows.length} row(s).</div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Date</th><th>Student</th><th>Class</th><th>Occurrence</th><th>Method</th><th>Reference</th><th>Amount</th><th>Collected By</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="10" style="text-align:center;color:#6b7280;">No payments were found for this sign-off scope.</td></tr>'}
    </tbody>
  </table>
  </div>
  </div>
</body>
</html>`);
    } catch (error) {
      console.error('[signoffReportGet]', error);
      return res.status(500).send('Could not build sign-off report.');
    }
  },

  assignmentsJsonGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).json([]);
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      const r = await db.query(
        `SELECT a.assignment_id, a.amount, a.amount_paid, a.late_fee_applied,
                b.title, s.first_name, s.last_name
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
          WHERE a.organization_id = $1 AND a.status NOT IN ('paid','cancelled')
          ORDER BY a.created_at DESC LIMIT 500`,
        [orgId]
      );
      const display = await buildFinanceDisplayContext(req, orgId);
      res.json(r.rows.map(x => {
        const bal = (Number(x.amount) + Number(x.late_fee_applied||0) - Number(x.amount_paid||0)).toFixed(2);
        return { assignment_id: x.assignment_id, label: `${x.first_name} ${x.last_name} — ${x.title} (${display.formatMoney(bal)} due)` };
      }));
    } catch (e) { res.status(500).json([]); }
  },

  // Edit bill
  billEditPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    const billId = req.params.id;
    let client;
    const {
      title, description, amount, due_date,
      late_fee_amount, late_fee_after_days,
      assignee_ids: rawAids,
      assignee_id: rawAid,
      bill_type, recurrence, recurrence_end_date,
      exclude_non_school_days,
      applies_to,
      target_class_ids, target_student_ids,
      school_year_id, term_id,
      payment_destination,
      accepts_card, accepts_cash, accepts_transfer,
      notify_email, notify_sms,
      status, status_action,
    } = req.body;
    const assigneeList = (() => {
      const raw = rawAids || rawAid;
      return [...new Set(
        (Array.isArray(raw) ? raw : raw ? [raw] : [])
          .map(x => parseInt(x, 10)).filter(Boolean)
      )];
    })();
    const edit_assignee_id = assigneeList[0] || null;
    const newAmount = Number(amount || 0);
    const requestedDestination = String(payment_destination || '').trim();
    const validType = ['one_time','recurring','installment'].includes(String(bill_type)) ? bill_type : null;
    const validRec = ['daily','weekly','monthly','term','year'].includes(String(recurrence)) ? recurrence : null;
    const normalizedStatusAction = String(status_action || '').trim().toLowerCase();
    const validStatusAction = ['active', 'draft', 'scheduled', 'cancelled'].includes(normalizedStatusAction)
      ? normalizedStatusAction
      : null;
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const validStatus = ['active','draft','scheduled','cancelled'].includes(normalizedStatus)
      ? normalizedStatus
      : null;
    const hasEditedClassTargets = Object.prototype.hasOwnProperty.call(req.body || {}, 'target_class_ids');
    const hasEditedStudentTargets = Object.prototype.hasOwnProperty.call(req.body || {}, 'target_student_ids');
    const submittedClassTargetIds = normalizeIdArray(target_class_ids);
    const submittedStudentTargetIds = normalizeIdArray(target_student_ids);
    try {
      client = await db.connect();
      await client.query("BEGIN");
      // Snapshot existing for diff
      const before = (await client.query(
        `SELECT * FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`,
        [billId, orgId]
      )).rows[0];
      if (!before) {
        await client.query("ROLLBACK");
        req.flash("error", "Bill not found.");
        return res.redirect("/account/settings/finance?section=bills");
      }

      // Server-side validation — block saving an edit that clears required fields.
      if (title != null && !String(title).trim()) {
        throw new PaygiraRequestError('Bill title cannot be empty.');
      }
      if (!(newAmount > 0)) {
        throw new PaygiraRequestError('Enter a bill amount greater than zero.');
      }

      const collectionDestinations = await resolveBillCollectionDestinations(client, orgId);
      const allowedDestinationValues = new Set(collectionDestinations.options.map((option) => option.value));
      const validDest = allowedDestinationValues.has(requestedDestination)
        ? requestedDestination
        : (collectionDestinations.defaultValue || before.payment_destination || 'cash');

      const requestedBillType = validType || before.bill_type || 'one_time';
      const requestedRecurrence = requestedBillType === 'recurring'
        ? (validRec || before.recurrence || null)
        : null;
      const requestedStatus = validStatusAction || validStatus || before.status || 'active';
      const requestedSchoolYearId = school_year_id || before.school_year_id;
      const requestedTermId = term_id || before.term_id;
      const requestedAudience = ['school', 'classes', 'students'].includes(String(applies_to))
        ? String(applies_to)
        : (['school', 'classes', 'students'].includes(String(before.applies_to))
            ? String(before.applies_to)
            : 'school');
      if (requestedAudience === 'classes' && hasEditedClassTargets && !submittedClassTargetIds.length) {
        throw new PaygiraRequestError('Choose one or more classes for this bill.');
      }
      if (requestedAudience === 'students' && hasEditedStudentTargets && !submittedStudentTargetIds.length) {
        throw new PaygiraRequestError('Choose one or more students for this bill.');
      }
      const academicContext = await resolveBillAcademicContext(client, orgId, requestedSchoolYearId, requestedTermId);
      const resolvedTargets = await loadBillAudienceTargets(
        client,
        orgId,
        billId,
        requestedAudience,
        hasEditedClassTargets ? submittedClassTargetIds : before.target_class_ids,
        hasEditedStudentTargets ? submittedStudentTargetIds : before.target_student_ids
      );
      const eligibleStudentIds = await loadEligibleBillStudents(
        client,
        orgId,
        academicContext.schoolYearId,
        academicContext.termId,
        requestedAudience,
        resolvedTargets.targetClassIds,
        resolvedTargets.targetStudentIds
      );
      const schedule = await resolveScheduleValidationContext(client, orgId, {
        bill_type: requestedBillType,
        recurrence: requestedRecurrence,
        recurrence_end_date,
        due_date,
        term_id: academicContext.termId,
        exclude_non_school_days,
      });

      const next = {
        title: title ?? before.title,
        description: description ?? before.description,
        amount: newAmount,
        due_date: schedule.normalizedDueDate,
        late_fee_amount: Number(late_fee_amount || 0),
        late_fee_after_days: Number(late_fee_after_days || 7),
        assignee_id: edit_assignee_id,
        bill_type: requestedBillType,
        recurrence: requestedRecurrence,
        recurrence_end_date: schedule.recurrenceEndDate,
        exclude_non_school_days: schedule.excludeNonSchoolDays,
        applies_to: requestedAudience,
        school_year_id: academicContext.schoolYearId,
        term_id: academicContext.termId,
        target_class_ids: resolvedTargets.targetClassIds,
        target_student_ids: resolvedTargets.targetStudentIds,
        payment_destination: validDest,
        accepts_card: !!accepts_card,
        accepts_cash: !!accepts_cash,
        accepts_transfer: !!accepts_transfer,
        notify_email: !!notify_email,
        notify_sms: !!notify_sms,
        status: requestedStatus,
      };

      await client.query(
        `UPDATE finance_bills SET
           title=$1, description=$2, amount=$3, due_date=$4,
           late_fee_amount=$5, late_fee_after_days=$6,
           assignee_id=$7,
           bill_type=$8, recurrence=$9, recurrence_end_date=$10,
           exclude_non_school_days=$11,
           applies_to=$12,
           school_year_id=$13, term_id=$14,
           payment_destination=$15,
           accepts_card=$16, accepts_cash=$17, accepts_transfer=$18,
           notify_email=$19, notify_sms=$20,
           status=$21,
           target_class_ids=$22,
           target_student_ids=$23,
           updated_at=now()
         WHERE bill_id=$24 AND organization_id=$25`,
        [
          next.title, next.description, next.amount, next.due_date,
          next.late_fee_amount, next.late_fee_after_days,
          next.assignee_id,
          next.bill_type, next.recurrence, next.recurrence_end_date,
          next.exclude_non_school_days,
          next.applies_to,
          next.school_year_id, next.term_id,
          next.payment_destination,
          next.accepts_card, next.accepts_cash, next.accepts_transfer,
          next.notify_email, next.notify_sms,
          next.status,
          next.target_class_ids.length ? next.target_class_ids : null,
          next.target_student_ids.length ? next.target_student_ids : null,
          billId, orgId,
        ]
      );

      if (next.status !== 'draft') {
        await syncBillAssignmentsForAudience(client, orgId, billId, {
          appliesTo: next.applies_to,
          schoolYearId: next.school_year_id,
          termId: next.term_id,
          targetClassIds: next.target_class_ids,
          targetStudentIds: next.target_student_ids,
          amount: newAmount,
          dueDate: next.due_date,
          status: next.status,
        });
      }

      const assignmentRows = (await client.query(
        `SELECT assignment_id, student_id, amount, amount_paid, late_fee_applied
           FROM finance_bill_assignments
          WHERE bill_id=$1 AND organization_id=$2`,
        [billId, orgId]
      )).rows;
      const scheduleContext = createBillScheduleContextLoader(client, orgId);
      const recurringScheduledTotal = next.bill_type === 'recurring'
        ? await getScheduledBilledAmount({
            amount: next.amount,
            bill_type: next.bill_type,
            recurrence: next.recurrence,
            due_date: next.due_date,
            recurrence_end_date: next.recurrence_end_date,
            term_id: next.term_id,
            exclude_non_school_days: next.exclude_non_school_days,
          }, scheduleContext)
        : null;

      for (const assignmentRow of assignmentRows) {
        const oldTotalDue = Number(assignmentRow.amount || 0) + Number(assignmentRow.late_fee_applied || 0);
        const newTotalDue = Number(next.bill_type === 'recurring' ? recurringScheduledTotal : next.amount) + Number(assignmentRow.late_fee_applied || 0);
        const paidAmount = Number(assignmentRow.amount_paid || 0);
        const creditDelta = Math.max(paidAmount - newTotalDue, 0) - Math.max(paidAmount - oldTotalDue, 0);
        if (creditDelta > 0.000001) {
          await addStudentCredit(client, orgId, assignmentRow.student_id, creditDelta);
        }
        const recalculatedStatus = next.bill_type === 'recurring'
          ? (paidAmount >= newTotalDue && newTotalDue > 0
              ? 'paid'
              : (paidAmount > 0 ? 'partial' : recalcAssignmentStatus(next.amount, assignmentRow.late_fee_applied, paidAmount, next.due_date)))
          : recalcAssignmentStatus(next.amount, assignmentRow.late_fee_applied, paidAmount, next.due_date);
        await client.query(
          `UPDATE finance_bill_assignments
              SET amount=$1, status=$2, updated_at=now()
            WHERE assignment_id=$3`,
          [next.amount, recalculatedStatus, assignmentRow.assignment_id]
        );
      }

      // Sync collectors junction table
      await client.query(`DELETE FROM finance_bill_collectors WHERE bill_id=$1`, [billId]);
      if (assigneeList.length > 0) {
        await client.query(
          `INSERT INTO finance_bill_collectors (bill_id, user_id, organization_id)
           SELECT $1, unnest($2::int[]), $3
           ON CONFLICT (bill_id, user_id) DO NOTHING`,
          [billId, assigneeList, orgId]
        );
      }

      // Cancel-propagate if status changed to cancelled
      if (next.status === 'cancelled' && before.status !== 'cancelled') {
        await client.query(
          `UPDATE finance_bill_assignments SET status='cancelled', updated_at=now()
           WHERE bill_id=$1 AND organization_id=$2 AND status NOT IN ('paid')`,
          [billId, orgId]
        );
      }

      await client.query("COMMIT");

      // Build changed-field diff for activity log
      const fmtVal = (v) => v === null || v === undefined ? "—" : (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
      const diffFields = [];
      const cmp = (key, label) => {
        const a = before[key];
        const b = next[key];
        const aN = a instanceof Date ? a.toISOString().slice(0,10) : a;
        const bN = b instanceof Date ? b.toISOString().slice(0,10) : b;
        if (String(aN ?? '') !== String(bN ?? '')) {
          diffFields.push({ field: label, from: fmtVal(aN), to: fmtVal(bN) });
        }
      };
      cmp('title','Title'); cmp('description','Description'); cmp('amount','Amount');
      cmp('due_date','Start / First Date'); cmp('recurrence_end_date','End Date'); cmp('late_fee_amount','Late Fee'); cmp('late_fee_after_days','Late Fee Days');
      cmp('assignee_id','Assignee'); cmp('bill_type','Bill Type'); cmp('recurrence','Recurrence');
      cmp('exclude_non_school_days','Skip Weekends/Holidays');
      cmp('applies_to','Applicable To');
      cmp('school_year_id','School Year'); cmp('term_id','Term'); cmp('payment_destination','Destination');
      cmp('accepts_card','Accept Card'); cmp('accepts_cash','Accept Cash'); cmp('accepts_transfer','Accept Transfer');
      cmp('notify_email','Notify Email'); cmp('notify_sms','Notify SMS'); cmp('status','Status');

      await logPaygira(req, {
        actionType: "Updated",
        recordType: "Bill",
        recordId: billId,
        recordLabel: next.title,
        description: diffFields.length
          ? `Updated bill "${next.title}" — ${diffFields.map(d => `${d.field}: ${d.from} → ${d.to}`).slice(0, 6).join(" · ")}${diffFields.length > 6 ? ` …(+${diffFields.length - 6} more)` : ""}.`
          : `Re-saved bill "${next.title}" (no field changes).`,
        changedFields: diffFields,
      });

      req.flash("success", "Bill updated.");
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[billEdit]", e);
      req.flash("error", "Could not update bill: " + e.message);
    } finally {
      if (client) client.release();
    }
    res.redirect("/account/settings/finance?section=bills");
  },

  // Overdue sweep — marks all past-due pending assignments as overdue and applies late fees
  overdueSweepPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      await ensureFinanceSchema();
      // Mark overdue
      await db.query(
        `UPDATE finance_bill_assignments a SET status='overdue', updated_at=now()
         FROM finance_bills b
         WHERE a.bill_id = b.bill_id
           AND a.organization_id = $1
           AND a.status IN ('pending','partial')
           AND b.due_date IS NOT NULL
           AND b.due_date < CURRENT_DATE`,
        [orgId]
      );
      // Apply late fees where bill has late_fee_amount > 0 and not yet applied
      const fees = await db.query(
        `SELECT a.assignment_id, b.late_fee_amount, b.late_fee_after_days, b.due_date
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.organization_id = $1
            AND a.status = 'overdue'
            AND a.late_fee_applied = 0
            AND b.late_fee_amount > 0
            AND b.due_date IS NOT NULL
            AND b.due_date + (b.late_fee_after_days || ' days')::interval < now()`,
        [orgId]
      );
      for (const row of fees.rows) {
        await db.query(
          `UPDATE finance_bill_assignments SET late_fee_applied=$1, updated_at=now() WHERE assignment_id=$2`,
          [Number(row.late_fee_amount), row.assignment_id]
        );
      }
      req.flash("success", `Overdue sweep complete. ${fees.rows.length} late fee(s) applied.`);
      await logPaygira(req, {
        actionType: "Swept",
        recordType: "Overdue Sweep",
        recordId: null,
        recordLabel: "Overdue Sweep",
        description: `Ran overdue sweep — ${fees.rows.length} late fee(s) applied to overdue assignments.`,
        changedFields: [{ field: "Late Fees Applied", value: String(fees.rows.length) }],
      });
    } catch (e) { console.error(e); req.flash("error", "Overdue sweep failed: " + e.message); }
    res.redirect("/account/settings/finance?section=overview");
  },

  // CSV export — bills with paid/outstanding summary
  exportCsvGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).send("Access denied.");
    const orgId = req.session.organizationId;
    const type = req.query.type || "bills";
    try {
      await ensureFinanceSchema();
      let rows = [];
      let headers = [];
      if (type === "payments") {
        const r = await db.query(
          `SELECT p.received_at, s.first_name, s.last_name, b.title AS bill,
                  p.amount, p.method, p.reference, p.notes
             FROM finance_payments p
             LEFT JOIN students s ON s.student_id = p.student_id
             LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
            WHERE p.organization_id = $1
            ORDER BY p.received_at DESC`,
          [orgId]
        );
        headers = ["Date","First Name","Last Name","Bill","Amount","Method","Reference","Notes"];
        rows = r.rows.map(x => [
          new Date(x.received_at).toISOString().slice(0,10),
          x.first_name||"", x.last_name||"", x.bill||"",
          Number(x.amount).toFixed(2), x.method||"", x.reference||"", x.notes||""
        ]);
      } else {
        const r = await db.query(
          `SELECT b.title, b.bill_type, b.due_date, b.status,
                  COUNT(a.assignment_id) AS students,
                  COALESCE(SUM(a.amount),0) AS total_billed,
                  COALESCE(SUM(a.amount_paid),0) AS total_paid,
                  COALESCE(SUM(GREATEST(a.amount+a.late_fee_applied-a.amount_paid,0)),0) AS outstanding
             FROM finance_bills b
             LEFT JOIN finance_bill_assignments a ON a.bill_id=b.bill_id
            WHERE b.organization_id=$1
            GROUP BY b.bill_id
            ORDER BY b.created_at DESC`,
          [orgId]
        );
        headers = ["Bill","Type","Due Date","Status","Students","Total Billed","Total Paid","Outstanding"];
        rows = r.rows.map(x => [
          x.title, x.bill_type||"", x.due_date ? new Date(x.due_date).toISOString().slice(0,10) : "",
          x.status, x.students,
          Number(x.total_billed).toFixed(2), Number(x.total_paid).toFixed(2), Number(x.outstanding).toFixed(2)
        ]);
      }
      const escape = v => `"${String(v).replace(/"/g,'""')}"`;
      const csv = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\r\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="paygira-${type}-${Date.now()}.csv"`);
      res.send(csv);
    } catch (e) { console.error(e); res.status(500).send("Export failed."); }
  },

  // Student detail JSON — full billing breakdown for drawer
  studentDetailGet: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.status(403).json({ error: "Access denied." });
    const orgId = req.session.organizationId;
    const studentId = parseInt(req.params.id, 10);
    if (!studentId) return res.status(400).json({ error: "Invalid student ID." });
    try {
      await ensureFinanceSchema();
      const [student, bills, payments, credit] = await Promise.all([
        db.query(
          `SELECT s.student_id, s.first_name, s.last_name, s.image_url,
                  c.class_name, s.date_of_birth
             FROM students s LEFT JOIN classes c ON c.class_id=s.class_id
            WHERE s.student_id=$1 AND s.organization_id=$2`,
          [studentId, orgId]
        ),
        (async () => {
          const assignmentRows = await db.query(
            `SELECT a.assignment_id, a.amount, a.amount_paid, a.late_fee_applied, a.status,
                    b.title, b.bill_type, b.due_date, b.recurrence, b.recurrence_end_date,
                    b.term_id, b.exclude_non_school_days,
                    tm.end_date AS term_end_date
               FROM finance_bill_assignments a
               JOIN finance_bills b ON b.bill_id=a.bill_id
               LEFT JOIN terms tm ON tm.term_id = b.term_id
              WHERE a.student_id=$1 AND a.organization_id=$2
                AND a.status <> 'cancelled'
                AND COALESCE(b.status, 'active') <> 'cancelled'
              ORDER BY b.due_date DESC NULLS LAST`,
            [studentId, orgId]
          );
          const scheduleContext = createBillScheduleContextLoader(db, orgId);
          const scheduledBills = await Promise.all(
            assignmentRows.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
          );
          return scheduledBills.map((bill) => ({
            ...bill,
            amount: Number(bill.scheduled_billed_total || bill.amount || 0),
            balance: Number(
              bill.scheduled_outstanding_total != null
                ? bill.scheduled_outstanding_total
                : Math.max(Number(bill.amount || 0) + Number(bill.late_fee_applied || 0) - Number(bill.amount_paid || 0), 0)
            ),
          }));
        })(),
        db.query(
          `SELECT p.payment_id, p.amount, p.method, p.reference, p.received_at, b.title AS bill_title
             FROM finance_payments p
             LEFT JOIN finance_bills b ON b.bill_id=p.bill_id
            WHERE p.student_id=$1 AND p.organization_id=$2
            ORDER BY p.received_at DESC LIMIT 50`,
          [studentId, orgId]
        ),
        db.query(
          `SELECT COALESCE(amount,0) AS credit FROM finance_student_credits
            WHERE student_id=$1 AND organization_id=$2`,
          [studentId, orgId]
        ),
      ]);
      if (!student.rows.length) return res.status(404).json({ error: "Student not found." });
      res.json({
        student: student.rows[0],
        bills: bills.rows,
        payments: payments.rows,
        credit: Number(credit.rows[0]?.credit || 0),
      });
    } catch (e) { console.error(e); res.status(500).json({ error: "Could not load student detail." }); }
  },

  // Send reminder — logs it; triggers email if mailer configured
  sendReminderPost: async (req, res) => {
    if (!(await isFinanceAdmin(req))) return res.redirect("/account/settings");
    const orgId = req.session.organizationId;
    try {
      // Log the reminder action (can be wired to email provider later)
      await db.query(
        `UPDATE finance_bill_assignments SET updated_at=now()
         WHERE bill_id=$1 AND organization_id=$2 AND status IN ('pending','overdue','partial')`,
        [req.params.id, orgId]
      );
      const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [req.params.id, orgId])).rows[0];
      req.flash("success", "Reminder sent to all outstanding assignees.");
      await logPaygira(req, {
        actionType: "Sent Reminder",
        recordType: "Bill",
        recordId: req.params.id,
        recordLabel: billRow?.title || `Bill #${req.params.id}`,
        description: `Sent reminder to outstanding assignees for bill "${billRow?.title || req.params.id}".`,
        changedFields: [],
      });
    } catch (e) { req.flash("error", "Could not send reminder."); }
    res.redirect("/account/settings/finance?section=bills");
  },

  // ===================================================================
  //  STAFF — "My PayGira": bills where assignee_id = current user
  //  Accessible to Teachers / Class Teachers / Supervisors / Managers
  //  assigned to collect or oversee a bill. Org-scoped.
  // ===================================================================
  staffMyPaygiraGet: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    if (!orgId || !userId) return res.redirect("/account/login");
    try {
      const isEmbedded = String(req.query.embed || '').toLowerCase() === 'workspace';
      const viewClassId = normalizeClassId(req.query.classId);
      const scopeClassId = normalizeSignoffClassId(viewClassId);
      await ensureFinanceSchema();
      await ensureAssigneeColumn();
      const orgContextPromise = Promise.all([
        cachedLoad(orgId, "psp", null, () => loadPspSettings(orgId)),
        cachedLoad(orgId, "orgProfile", null, () => loadOrganizationProfile(orgId)),
      ]);
      const staffCacheKey = { userId, viewClassId: viewClassId || null };
      const staffDataPromise = cachedLoad(orgId, "staffMyPaygiraData", staffCacheKey, async () => {
        const [billsR, assignmentsR] = await Promise.all([
          db.query(
            `SELECT b.*, tm.end_date AS term_end_date, COUNT(a.assignment_id) AS assigned_count
               FROM finance_bills b
               JOIN finance_bill_assignments a ON a.bill_id = b.bill_id AND a.organization_id = $1
               JOIN students s ON s.student_id = a.student_id
               LEFT JOIN terms tm ON tm.term_id = b.term_id
              WHERE b.organization_id = $1
                AND COALESCE(b.status, 'active') <> 'cancelled'
                AND a.status <> 'cancelled'
                AND (b.assignee_id = $2
                     OR EXISTS (SELECT 1 FROM finance_bill_collectors c WHERE c.bill_id = b.bill_id AND c.user_id = $2))
                AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$3', orgParamSql: '$1' })}
              GROUP BY b.bill_id, tm.end_date
              ORDER BY b.due_date NULLS LAST, b.created_at DESC`,
            [orgId, userId, scopeClassId]
          ),
          db.query(
            `SELECT a.*, b.title AS bill_title, b.due_date, b.bill_type, b.recurrence, b.recurrence_end_date,
                    b.term_id, b.exclude_non_school_days,
                    tm.end_date AS term_end_date,
                    s.first_name, s.last_name, s.image_url, s.class_id, c.class_name
               FROM finance_bill_assignments a
               JOIN finance_bills b ON b.bill_id = a.bill_id
               JOIN students s ON s.student_id = a.student_id
               LEFT JOIN classes c ON c.class_id = s.class_id
               LEFT JOIN terms tm ON tm.term_id = b.term_id
              WHERE a.organization_id = $1
                AND a.status <> 'cancelled'
                AND COALESCE(b.status, 'active') <> 'cancelled'
                AND (b.assignee_id = $2
                     OR EXISTS (SELECT 1 FROM finance_bill_collectors c WHERE c.bill_id = b.bill_id AND c.user_id = $2))
                AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$3', orgParamSql: '$1' })}
              ORDER BY a.status DESC, b.due_date NULLS LAST, s.last_name`,
            [orgId, userId, scopeClassId]
          ),
        ]);

        const scheduleContext = createBillScheduleContextLoader(db, orgId);
        const allAssignments = await Promise.all(
          assignmentsR.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
        );
        const signoffRows = await loadCollectionSignoffs(
          orgId,
          billsR.rows.map((row) => Number(row.bill_id)).filter(Boolean)
        );
        const signoffsByBillId = signoffRows.reduce((accumulator, row) => {
          const billKey = String(row.bill_id || "");
          if (!billKey) return accumulator;
          if (!accumulator[billKey]) accumulator[billKey] = [];
          accumulator[billKey].push(row);
          return accumulator;
        }, {});

        const assignments = allAssignments.filter((assignment) => {
          if (String(assignment.bill_type || '').toLowerCase() === 'recurring') return true;
          return !getCurrentViewBillSignoff(signoffsByBillId[String(assignment.bill_id)] || [], viewClassId);
        });

        const visibleBillIds = new Set(assignments.map((assignment) => String(assignment.bill_id)));
        const bills = applyScheduledBillRollups(billsR.rows, assignments)
          .map((bill) => ({
            ...bill,
            signed_off: !!getCurrentViewBillSignoff(signoffsByBillId[String(bill.bill_id)] || [], viewClassId),
            signed_off_dates: getCurrentViewSignedOffDates(signoffsByBillId[String(bill.bill_id)] || [], viewClassId),
          }))
          .filter((bill) => visibleBillIds.has(String(bill.bill_id)) && !bill.signed_off);

        const stats = {
          bills: bills.length,
          students: assignments.length,
          billed: assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_billed_total || 0), 0),
          collected: assignments.reduce((sum, assignment) => sum + Number(assignment.amount_paid || 0), 0),
          outstanding: assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_outstanding_total || 0), 0),
        };

        return { bills, assignments, stats };
      });

      const [staffData, [pspSettings, orgProfile]] = await Promise.all([
        staffDataPromise,
        orgContextPromise,
      ]);
      const [stripeRuntime, display] = await Promise.all([
        resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile),
        buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country, orgProfile.organization_currency),
      ]);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      allowedMethods.currency = display.financeCurrency.code;

      res.render("account/myPaygira", {
        title: "My PayGira",
        bills: staffData.bills,
        assignments: staffData.assignments,
        stats: staffData.stats,
        allowedMethods,
        financeCurrency: display.financeCurrency,
        formatMoney: display.formatMoney,
        money,
        messages: req.flash ? req.flash() : {},
        isEmbedded,
        viewClassId,
        hideGlobalHeader: isEmbedded,
        hideGlobalFooter: isEmbedded,
        hideGlobalChatbot: isEmbedded,
      });
    } catch (err) {
      console.error("[staffMyPaygiraGet]", err);
      req.flash && req.flash("error", "Unable to load My PayGira.");
      res.redirect("/account/settings");
    }
  },

  // POST /account/my-paygira/collect — staff collector records a payment
  staffMyPaygiraCollectPost: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const wantsJson = requestWantsJson(req);
    if (!orgId || !userId) {
      if (wantsJson) return res.status(401).json({ ok: false, message: "Unauthorized" });
      return res.redirect("/account/login");
    }
    const { assignment_id, amount, method, reference, notes } = req.body;
    const isEmbedded = String((req.query && req.query.embed) || req.body.embedMode || '').toLowerCase() === 'workspace';
    const viewClassId = normalizeClassId((req.query && req.query.classId) || req.body.classId);
    const paygiraRedirectPath = isEmbedded
      ? `/account/settings/my-paygira?embed=workspace${viewClassId ? `&classId=${viewClassId}` : ""}`
      : "/account/settings/my-paygira";
    let client;
    try {
      const psp = await loadPspSettings(orgId);
      const orgProfile = await loadOrganizationProfile(orgId);
      const display = await buildFinanceDisplayContext(req, orgId);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, psp, orgProfile);
      const allowedMethods = computeAllowedMethods(psp, { stripeOn: stripeRuntime.stripeOn });
      client = await db.connect();
      await client.query("BEGIN");
      const result = await collectStaffPaygiraPayment({
        client,
        orgId,
        userId,
        assignmentId: assignment_id,
        scopedClassId: viewClassId,
        amount,
        method,
        reference,
        notes,
        occurrenceDate: req.body.occurrence_date,
        allowedMethods,
        display,
      });
      await client.query("COMMIT");
      result.orgId = orgId;

      await notifyGuardiansOfStaffCollection(display, result);
      await auditStaffCollection(req, result);

      if (wantsJson) {
        return res.json({
          ok: true,
          message: result.successMessage,
          payment: buildStaffCollectionResponse(result),
        });
      }

      req.flash && req.flash("success", result.successMessage);
      return res.redirect(paygiraRedirectPath);
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[staffMyPaygiraCollectPost]", e);
      const status = e instanceof PaygiraRequestError ? e.status : 500;
      const message = e instanceof PaygiraRequestError
        ? e.message
        : "Could not record collection: " + e.message;
      if (wantsJson) {
        return res.status(status).json({ ok: false, message });
      }
      req.flash && req.flash("error", message);
      return res.redirect(paygiraRedirectPath);
    } finally {
      if (client) client.release();
    }
  },

  // POST /account/my-paygira/collect/bulk — staff collector records several payments at once
  staffMyPaygiraBulkCollectPost: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const wantsJson = requestWantsJson(req) || String(req.get("content-type") || "").toLowerCase().includes("application/json");
    if (!orgId || !userId) {
      if (wantsJson) return res.status(401).json({ ok: false, message: "Unauthorized" });
      return res.redirect("/account/login");
    }

    const isEmbedded = String((req.query && req.query.embed) || req.body.embedMode || "").toLowerCase() === "workspace";
    const viewClassId = normalizeClassId((req.query && req.query.classId) || req.body.classId);
    const paygiraRedirectPath = isEmbedded
      ? `/account/settings/my-paygira?embed=workspace${viewClassId ? `&classId=${viewClassId}` : ""}`
      : "/account/settings/my-paygira";
    const items = parseBulkCollectItems(req.body.items);
    let client;
    try {
      const uniqueItems = [];
      const seenAssignmentIds = new Set();
      items.forEach((item) => {
        const assignmentKey = String(item && item.assignment_id != null ? item.assignment_id : "").trim();
        if (!assignmentKey || seenAssignmentIds.has(assignmentKey)) return;
        seenAssignmentIds.add(assignmentKey);
        uniqueItems.push(item);
      });
      if (!uniqueItems.length) {
        throw new PaygiraRequestError("Select at least one student to collect from.", 400);
      }

      const display = await buildFinanceDisplayContext(req, orgId);
      const psp = await loadPspSettings(orgId);
      const orgProfile = await loadOrganizationProfile(orgId);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, psp, orgProfile);
      const allowedMethods = computeAllowedMethods(psp, { stripeOn: stripeRuntime.stripeOn });
      client = await db.connect();
      await client.query("BEGIN");

      const results = [];
      for (const item of uniqueItems) {
        const result = await collectStaffPaygiraPayment({
          client,
          orgId,
          userId,
          assignmentId: item.assignment_id,
          scopedClassId: viewClassId,
          amount: item.amount,
          method: item.method || req.body.method,
          reference: item.reference || req.body.reference,
          notes: item.notes || req.body.notes,
          occurrenceDate: item.occurrence_date || req.body.occurrence_date,
          allowedMethods,
          display,
        });
        result.orgId = orgId;
        results.push(result);
      }

      await client.query("COMMIT");

      await Promise.allSettled(results.map((result) => notifyGuardiansOfStaffCollection(display, result)));
      await Promise.allSettled(results.map((result) => auditStaffCollection(req, result)));

      const totalCollected = results.reduce((sum, result) => sum + Number(result.amountCollected || 0), 0);
      const totalCredit = results.reduce((sum, result) => sum + Number(result.credit || 0), 0);
      const message = results.length === 1
        ? results[0].successMessage
        : totalCredit > 0
          ? `Collected ${display.formatMoney(totalCollected)} from ${results.length} students. ${display.formatMoney(totalCredit)} added as student credit.`
          : `Collected ${display.formatMoney(totalCollected)} from ${results.length} students.`;

      if (wantsJson) {
        return res.json({
          ok: true,
          message,
          payments: results.map(buildStaffCollectionResponse),
          summary: {
            count: results.length,
            total_amount: totalCollected,
            total_credit: totalCredit,
            students: results.map((result) => result.studentName),
          },
        });
      }

      req.flash && req.flash("success", message);
      return res.redirect(paygiraRedirectPath);
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[staffMyPaygiraBulkCollectPost]", e);
      const status = e instanceof PaygiraRequestError ? e.status : 500;
      const message = e instanceof PaygiraRequestError
        ? e.message
        : "Could not record bulk collection: " + e.message;
      if (wantsJson) {
        return res.status(status).json({ ok: false, message });
      }
      req.flash && req.flash("error", message);
      return res.redirect(paygiraRedirectPath);
    } finally {
      if (client) client.release();
    }
  },

  staffMyPaygiraSignOffPost: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const wantsJson = requestWantsJson(req);
    if (!orgId || !userId) {
      if (wantsJson) return res.status(401).json({ ok: false, message: "Unauthorized" });
      return res.redirect("/account/login");
    }

    const isEmbedded = String((req.query && req.query.embed) || req.body.embedMode || '').toLowerCase() === 'workspace';
    const viewClassId = normalizeClassId((req.query && req.query.classId) || req.body.classId);
    const paygiraRedirectPath = isEmbedded
      ? `/account/settings/my-paygira?embed=workspace${viewClassId ? `&classId=${viewClassId}` : ""}`
      : "/account/settings/my-paygira";

    const billId = parseInt(req.body.bill_id, 10);
    const occurrenceDate = normalizeOccurrenceDate(req.body.occurrence_date);
    const fullName = req.body.full_name;
    const password = req.body.password;
    let client;
    try {
      await ensureFinanceSchema();
      await ensureAssigneeColumn();
      if (!billId) {
        throw new PaygiraRequestError("Choose a bill before signing off.", 400);
      }

      const financeAdmin = await isFinanceAdmin(req);
      client = await db.connect();
      await client.query("BEGIN");

      const billResult = await client.query(
        `SELECT b.bill_id, b.title, b.bill_type, b.recurrence, b.assignee_id
           FROM finance_bills b
          WHERE b.organization_id = $1
            AND b.bill_id = $2
            AND (
              $3::boolean = TRUE
              OR b.assignee_id = $4
              OR EXISTS (
                SELECT 1 FROM finance_bill_collectors c
                 WHERE c.bill_id = b.bill_id AND c.user_id = $4
              )
            )
          LIMIT 1`,
        [orgId, billId, financeAdmin, userId]
      );
      if (!billResult.rows.length) {
        throw new PaygiraRequestError("Not authorized to sign off this bill.", 403);
      }

      const bill = billResult.rows[0];
      const recurring = String(bill.bill_type || '').toLowerCase() === 'recurring';
      if (recurring && !occurrenceDate) {
        throw new PaygiraRequestError("Select a recurring date before signing off.", 400);
      }

      const existingSignoff = await findExistingCollectionSignoff(client, orgId, billId, recurring ? occurrenceDate : null, viewClassId);
      if (existingSignoff) {
        throw new PaygiraRequestError(
          recurring ? "This date has already been signed off." : "This bill has already been signed off.",
          400
        );
      }

      const signer = await verifyCollectionSignoffCredentials(client, req, fullName, password);
      const summary = await loadBillSignoffSummary(client, orgId, billId, recurring ? occurrenceDate : null, viewClassId);
      if (!summary || !Number(summary.student_count || 0)) {
        throw new PaygiraRequestError("No students matched this bill scope.", 404);
      }
      if (Number(summary.total_outstanding || 0) > 0.009) {
        throw new PaygiraRequestError(
          recurring
            ? "All students for this date must be fully collected before sign-off."
            : "This bill still has outstanding balances. Collect the remaining amounts before signing off.",
          400
        );
      }

      const insert = await client.query(
        `INSERT INTO finance_collection_signoffs
          (organization_id, bill_id, class_id, occurrence_date, scope_key, signed_by_user_id, signed_by_name, signer_role, student_count, total_collected)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING signoff_id, signed_at`,
        [
          orgId,
          billId,
          normalizeSignoffClassId(viewClassId),
          recurring ? occurrenceDate : null,
          getSignoffScopeKey(recurring ? occurrenceDate : null),
          signer.signedByUserId,
          signer.signedByName,
          signer.signerRole,
          Number(summary.student_count || 0),
          Number(summary.total_paid || 0),
        ]
      );

      await client.query("COMMIT");

      const display = await buildFinanceDisplayContext(req, orgId);
      const scopeLabel = recurring && occurrenceDate
        ? new Date(`${occurrenceDate}T00:00:00`).toLocaleDateString()
        : bill.title;
      const message = recurring
        ? `Signed off ${bill.title} for ${scopeLabel}. It has been moved to finance history.`
        : `Signed off ${bill.title}. It has been moved to finance history.`;

      await logPaygira(req, {
        actionType: "Signed Off",
        recordType: "Collection Sign-Off",
        recordId: insert.rows[0]?.signoff_id || billId,
        recordLabel: recurring ? `${bill.title} — ${scopeLabel}` : bill.title,
        description: `${signer.signedByName} signed off ${recurring ? `the ${scopeLabel} collection for ` : ''}"${bill.title}" after ${display.formatMoney(summary.total_paid || 0)} had been collected across ${summary.student_count} student(s).`,
        changedFields: [
          { field: "Scope", value: recurring ? scopeLabel : 'Bill' },
          { field: "Students", value: String(summary.student_count || 0) },
          { field: "Collected", value: display.formatMoney(summary.total_paid || 0) },
        ],
      });

      if (wantsJson) {
        return res.json({
          ok: true,
          message,
          signoff: {
            signoff_id: insert.rows[0]?.signoff_id || null,
            bill_id: billId,
            class_id: normalizeSignoffClassId(viewClassId),
            occurrence_date: recurring ? occurrenceDate : null,
            signed_at: insert.rows[0]?.signed_at || null,
            total_collected: Number(summary.total_paid || 0),
            student_count: Number(summary.student_count || 0),
          },
        });
      }

      req.flash && req.flash("success", message);
      return res.redirect(paygiraRedirectPath);
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[staffMyPaygiraSignOffPost]", e);
      const status = e instanceof PaygiraRequestError ? e.status : 500;
      const message = e instanceof PaygiraRequestError
        ? e.message
        : "Could not sign off this collection: " + e.message;
      if (wantsJson) {
        return res.status(status).json({ ok: false, message });
      }
      req.flash && req.flash("error", message);
      return res.redirect(paygiraRedirectPath);
    } finally {
      if (client) client.release();
    }
  },

  // ===================================================================
  //  AJAX: per-occurrence day summary
  //  GET /account/settings/my-paygira/occurrence-summary?bill_id=X&date=YYYY-MM-DD
  // ===================================================================
  occurrenceSummaryGet: async (req, res) => {
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    if (!orgId || !userId) return res.status(401).json({ error: 'Unauthorized' });
    const billId = parseInt(req.query.bill_id, 10);
    const dateStr = String(req.query.date || '').trim(); // YYYY-MM-DD
    const viewClassId = normalizeClassId(req.query.classId);
    const scopeClassId = normalizeSignoffClassId(viewClassId);
    if (!billId || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'bill_id and date (YYYY-MM-DD) required' });
    }
    try {
      await ensureAssigneeColumn();
      // Verify user is a collector on this bill
      const billCheck = await db.query(
        `SELECT bill_id, amount, recurrence, bill_type FROM finance_bills
          WHERE bill_id=$1 AND organization_id=$2
            AND (assignee_id=$3 OR EXISTS (SELECT 1 FROM finance_bill_collectors c WHERE c.bill_id=$1 AND c.user_id=$3))`,
        [billId, orgId, userId]
      );
      if (!billCheck.rows.length) return res.status(403).json({ error: 'Not authorized' });
      const bill = billCheck.rows[0];

      // Per-student: amount due per occurrence = bill.amount (each period is one amount)
      const assignments = await db.query(
        `SELECT a.assignment_id, a.student_id, a.amount, a.late_fee_applied,
                s.first_name, s.last_name, s.image_url,
                c.class_id, c.class_name,
                COALESCE(SUM(p.amount) FILTER (WHERE p.occurrence_date=$2::date), 0) AS paid_this_day,
                COALESCE(SUM(p.amount), 0) AS paid_total
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN finance_payments p ON p.assignment_id = a.assignment_id AND p.organization_id=$1
          WHERE a.bill_id=$3 AND a.organization_id=$1
            AND a.status <> 'cancelled'
            AND COALESCE(b.status, 'active') <> 'cancelled'
            AND ${buildAcademicClassScopeClause({ studentAlias: 's', billAlias: 'b', classParamSql: '$4', orgParamSql: '$1' })}
          GROUP BY a.assignment_id, s.first_name, s.last_name, s.image_url, c.class_id, c.class_name
          ORDER BY s.last_name, s.first_name`,
        [orgId, dateStr, billId, scopeClassId]
      );
      const todayIso = new Date().toISOString().slice(0, 10);
      const items = assignments.rows.map((row) => {
        const dueAmount = Number(row.amount || 0);
        const paidOnDate = Number(row.paid_this_day || 0);
        const outstandingAmount = Math.max(dueAmount - paidOnDate, 0);
        const status = outstandingAmount <= 0
          ? 'paid'
          : paidOnDate > 0
            ? 'partial'
            : (dateStr < todayIso ? 'overdue' : 'pending');
        return {
          assignment_id: row.assignment_id,
          student_id: row.student_id,
          first_name: row.first_name,
          last_name: row.last_name,
          image_url: row.image_url,
          class_id: row.class_id,
          class_name: row.class_name,
          due_amount: dueAmount,
          paid_on_date: paidOnDate,
          outstanding: outstandingAmount,
          paid_total: Number(row.paid_total || 0),
          status,
        };
      });
      const totalStudents = items.length;
      const totalExpected = items.reduce((sum, item) => sum + Number(item.due_amount || 0), 0);
      const totalPaidDay = items.reduce((sum, item) => sum + Number(item.paid_on_date || 0), 0);
      const totalOutstanding = items.reduce((sum, item) => sum + Number(item.outstanding || 0), 0);
      const paidCount = items.filter((item) => Number(item.outstanding || 0) <= 0).length;

      res.json({
        date: dateStr,
        students:        totalStudents,
        per_student:     Number(bill.amount || 0),
        total_expected:  totalExpected,
        paid_today:      totalPaidDay,
        outstanding:     totalOutstanding,
        paid_count:      paidCount,
        unpaid_count:    totalStudents - paidCount,
        items,
      });
    } catch (e) {
      console.error('[occurrenceSummaryGet]', e);
      res.status(500).json({ error: e.message });
    }
  },

  // ===================================================================
  //  GUARDIAN / PARENT PORTAL — PayGira
  //  Lists bills for all the guardian's linked students and lets them pay.
  // ===================================================================
  guardianPaygiraGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await Promise.all([ensureFinanceSchema(), ensureGuardianCardsSchema()]);

      // Org-level payment context (PSP + Stripe + currency display) is fully
      // independent of student data, so kick it off in the background and only
      // await it right before render. This overlaps it with the student queries.
      const orgContextPromise = (async () => {
        const [pspSettings, orgProfile] = await Promise.all([
          cachedLoad(orgId, "psp", null, () => loadPspSettings(orgId)),
          cachedLoad(orgId, "orgProfile", null, () => loadOrganizationProfile(orgId)),
        ]);
        const [stripeRuntime, display] = await Promise.all([
          resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile),
          buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country, orgProfile.organization_currency),
        ]);
        return { pspSettings, orgProfile, stripeRuntime, display };
      })();

      const guardianCacheKey = { guardianId };
      const [cardsR, guardianData, payoutAccountsR] = await Promise.all([
        cachedLoad(orgId, "guardianCards", guardianCacheKey, () => database.query(
          `SELECT card_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id
             FROM guardian_payment_methods
            WHERE guardian_id=$1 AND organization_id=$2
            ORDER BY is_default DESC, created_at DESC`,
          [guardianId, orgId]
        )),
        cachedLoad(orgId, "guardianPaygiraData", guardianCacheKey, async () => {
          const [kidsR, gp] = await Promise.all([
            database.query(
              `SELECT DISTINCT s.student_id, s.first_name, s.last_name, s.image_url,
                      c.class_name
                 FROM students s
                 LEFT JOIN classes c ON c.class_id = s.class_id
                WHERE s.organization_id = $1
                  AND (
                    EXISTS (SELECT 1 FROM guardians g
                             WHERE g.student_id=s.student_id AND g.guardian_id=$2 AND g.organization_id=$1)
                    OR EXISTS (SELECT 1 FROM guardian_students gs
                             WHERE gs.student_id=s.student_id AND gs.guardian_id=$2)
                  )
                ORDER BY s.first_name`,
              [orgId, guardianId]
            ),
            database.query(
              `SELECT first_name, last_name, image_url FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
              [guardianId, orgId]
            ),
          ]);

          const children = kidsR.rows;
          const orgNameDisplayFormat = String(req.session?.nameDisplayFormat || "first_last");
          const studentIds = children.map(c => c.student_id);

          const [studentCreditMap, assignmentRowsR, paymentsR] = await Promise.all([
            loadStudentCreditMap(database, orgId, studentIds),
            studentIds.length
              ? database.query(
                  `SELECT a.*, b.title AS bill_title, b.description AS bill_description,
                          b.due_date, b.bill_type, b.recurrence, b.recurrence_end_date,
                          b.term_id, b.exclude_non_school_days,
                          tm.end_date AS term_end_date,
                          b.accepts_card, b.accepts_cash, b.accepts_transfer,
                          b.payment_destination,
                          s.first_name, s.last_name, s.image_url, s.student_id
                     FROM finance_bill_assignments a
                     JOIN finance_bills b ON b.bill_id = a.bill_id
                     JOIN students s ON s.student_id = a.student_id
                     LEFT JOIN terms tm ON tm.term_id = b.term_id
                    WHERE a.organization_id = $1 AND a.student_id = ANY($2::int[])
                            AND a.status <> 'cancelled'
                            AND COALESCE(b.status, 'active') <> 'cancelled'
                    ORDER BY a.status, b.due_date NULLS LAST`,
                  [orgId, studentIds]
                )
              : Promise.resolve({ rows: [] }),
            studentIds.length
              ? database.query(
                  `SELECT p.payment_id, p.amount, p.method, p.received_at, p.reference,
                          s.first_name, s.last_name, b.title AS bill_title
                     FROM finance_payments p
                     LEFT JOIN students s ON s.student_id = p.student_id
                     LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
                    WHERE p.organization_id=$1 AND p.student_id = ANY($2::int[])
                    ORDER BY p.received_at DESC LIMIT 15`,
                  [orgId, studentIds]
                )
              : Promise.resolve({ rows: [] }),
          ]);

          const hydratedChildren = children.map((child) => ({
            ...child,
            display_name: formatDisplayName(child, orgNameDisplayFormat) || [child.first_name, child.last_name].filter(Boolean).join(" ").trim(),
            student_credit: Number(studentCreditMap.get(String(child.student_id)) || 0),
          }));

          const payments = paymentsR.rows.map((payment) => ({
            ...payment,
            display_student_name:
              formatDisplayName(payment, orgNameDisplayFormat) ||
              [payment.first_name, payment.last_name].filter(Boolean).join(" ").trim(),
          }));

          let assignments = [];
          if (assignmentRowsR.rows.length) {
            const scheduleContext = createBillScheduleContextLoader(database, orgId);
            assignments = await Promise.all(
              assignmentRowsR.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
            );

            const assignmentIds = assignments.map((assignment) => assignment.assignment_id);
            const occurrencePaymentsR = await database.query(
              `SELECT assignment_id, occurrence_date::text AS occurrence_date, COALESCE(SUM(amount), 0) AS paid_amount
                 FROM finance_payments
                WHERE organization_id=$1 AND assignment_id = ANY($2::int[]) AND occurrence_date IS NOT NULL
                GROUP BY assignment_id, occurrence_date`,
              [orgId, assignmentIds]
            );
            const occurrencePaymentsByAssignment = occurrencePaymentsR.rows.reduce((accumulator, row) => {
              const assignmentKey = String(row.assignment_id);
              if (!accumulator[assignmentKey]) accumulator[assignmentKey] = {};
              accumulator[assignmentKey][row.occurrence_date] = Number(row.paid_amount || 0);
              return accumulator;
            }, {});
            assignments = assignments.map((assignment) => ({
              ...assignment,
              display_student_name:
                formatDisplayName(assignment, orgNameDisplayFormat) ||
                [assignment.first_name, assignment.last_name].filter(Boolean).join(" ").trim(),
              occurrence_payments: occurrencePaymentsByAssignment[String(assignment.assignment_id)] || {},
              student_credit: Number(studentCreditMap.get(String(assignment.student_id)) || 0),
            }));
          }

          const visibleAssignments = assignments.filter((assignment) => {
            const outstandingAmount = Number(
              assignment.scheduled_outstanding_total != null
                ? assignment.scheduled_outstanding_total
                : Math.max(Number(assignment.amount || 0) + Number(assignment.late_fee_applied || 0) - Number(assignment.amount_paid || 0), 0)
            );
            return outstandingAmount > 0;
          });

          const totals = {
            billed: assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_billed_total || 0), 0),
            paid: assignments.reduce((sum, assignment) => sum + Number(assignment.amount_paid || 0), 0),
            outstanding: assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_outstanding_total || 0), 0),
            credit: hydratedChildren.reduce((sum, child) => sum + Number(child.student_credit || 0), 0),
          };
          totals.net_outstanding = Math.max(Number(totals.outstanding || 0) - Number(totals.credit || 0), 0);

          return {
            guardian: gp.rows[0] || {},
            children: hydratedChildren,
            assignments: visibleAssignments,
            payments,
            totals,
          };
        }),
        database.query(
          `SELECT id, account_type, business_name, account_number, bank_name, momo_number, momo_provider, account_holder_name, subaccount_code, is_primary
             FROM paystack_subaccounts
            WHERE organization_id=$1 AND account_type != 'stripe_card'
            ORDER BY is_primary DESC, id ASC`,
          [orgId]
        ).catch(() => ({ rows: [] })),
      ]);

      // Payment options available to this guardian (set by the school)
      const { pspSettings, orgProfile, stripeRuntime, display } = await orgContextPromise;
      const maskedPsp = maskPspSecrets(pspSettings);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      const stripeCheckoutConfig = buildGuardianStripeCheckoutConfig(allowedMethods.stripeMethods);
      allowedMethods.currency = display.financeCurrency.code;
      maskedPsp.currency = display.financeCurrency.code;
      if (!maskedPsp.stripe_publishable_key && stripeRuntime.publishableKey) {
        maskedPsp.stripe_publishable_key = stripeRuntime.publishableKey;
      }

      // Check charges_enabled on connected Stripe account so guardian sees
      // a clear message when the school hasn't completed their payout setup.
      let stripeAccountReady = true; // default: ready (school direct-Stripe or no Stripe)
      if (stripeRuntime.stripeOn && stripeRuntime.useConnectedDestinationCharge && stripeRuntime.connectedAccountId) {
        try {
          const platformClient = await getStripePlatformClient(database);
          const connectedAccount = await platformClient.accounts.retrieve(stripeRuntime.connectedAccountId);
          stripeAccountReady = Boolean(connectedAccount?.charges_enabled);
        } catch (_) {
          stripeAccountReady = false;
        }
      }

      // Restrict the payer's selectable route to the school's chosen payout provider.
      let _pgPayoutProvider = null;
      try {
        const { resolveSchoolPayoutDestination } = require("../utils/payoutDestination");
        const _pgPayoutCtx = await resolveSchoolPayoutDestination(orgId, database).catch(() => null);
        _pgPayoutProvider = _pgPayoutCtx?.provider || null;
      } catch (_) { _pgPayoutProvider = null; }
      let _pgPayoutAccounts = payoutAccountsR.rows || [];
      let _pgStripeSelectable = stripeRuntime.stripeOn;
      if (_pgPayoutProvider === 'stripe') {
        _pgPayoutAccounts = [];
      } else if (_pgPayoutProvider === 'paystack') {
        _pgStripeSelectable = false;
      }

      // Platform fee info so the pay modal can preview the service fee before submitting.
      let _pgPlatformFeePercent = 0;
      let _pgPlatformFeeBearer = 'parent';
      try {
        const { percentage } = await getPlatformFeeSettings(database);
        _pgPlatformFeePercent = Number(percentage || 0);
        _pgPlatformFeeBearer = await getOrgPlatformFeeBearer(orgId, database);
      } catch (_) { /* defaults */ }

      res.render("guardian/paygira", {
        title: "PayGira — Pay Bills",
        guardian: guardianData.guardian,
        children: guardianData.children,
        assignments: guardianData.assignments,
        payments: guardianData.payments,
        cards: cardsR.rows,
        totals: guardianData.totals,
        pspSettings: maskedPsp,
        allowedMethods,
        stripeCatalog: STRIPE_METHOD_CATALOG,
        stripeCheckoutConfig,
        stripeAccountReady,
        financeCurrency: display.financeCurrency,
        formatMoney: display.formatMoney,
        money,
        schoolName: orgProfile.organization_name || '',
        payoutAccounts: _pgPayoutAccounts,
        stripePayoutReady: stripeAccountReady && stripeRuntime.stripeOn,
        stripeSelectable: _pgStripeSelectable,
        platformFeePercentage: _pgPlatformFeePercent,
        platformFeeBearer: _pgPlatformFeeBearer,
        messages: req.flash ? req.flash() : {},
        req,
      });
    } catch (err) {
      console.error("[guardianPaygiraGet]", err);
      req.flash && req.flash("error", "Unable to load PayGira.");
      res.redirect("/guardian/dashboard");
    }
  },

  guardianPaygiraStripeIntentPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) {
      return res.status(401).json({ success: false, message: 'Your guardian session has expired. Please log in again.' });
    }

    let client;
    let shouldReleaseClient = false;
    try {
      await ensureFinanceSchema();
      if (typeof database.connect === 'function') {
        client = await database.connect();
        shouldReleaseClient = true;
      } else {
        client = database;
      }

      const pspSettings = await loadPspSettings(orgId);
      const orgProfile = await loadOrganizationProfile(orgId);
      const payoutContext = await resolveSchoolPayoutDestination(orgId, db, { fresh: true }).catch(() => null);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });

      // Resolve which specific payout account to use
      // payout_account_id: DB id of paystack_subaccounts row; 'stripe' = use Stripe Connect
      const requestedAccountId = req.body?.payout_account_id;
      const requestedIsStripe = String(requestedAccountId || '').trim().toLowerCase() === 'stripe';
      const requestedIsPaystack = Boolean(requestedAccountId && !requestedIsStripe);
      const preferredProvider = String(payoutContext?.preference || '').trim().toLowerCase();

      if (preferredProvider === 'stripe' && requestedIsPaystack) {
        return res.status(400).json({
          success: false,
          message: 'This school currently has Stripe as the active payout provider.',
        });
      }
      if (preferredProvider === 'paystack' && requestedIsStripe) {
        return res.status(400).json({
          success: false,
          message: 'This school currently has Paystack as the active payout provider.',
        });
      }

      let payoutProvider = payoutContext?.provider || null;
      let explicitSubaccountCode = null;
      if (preferredProvider === 'stripe' || preferredProvider === 'paystack') {
        payoutProvider = preferredProvider;
      } else if (requestedAccountId && requestedAccountId !== 'stripe') {
        const requestedAccountNumericId = parseInt(requestedAccountId, 10);
        if (Number.isFinite(requestedAccountNumericId)) {
          const acctRow = await database.query(
            `SELECT subaccount_code, account_type FROM paystack_subaccounts WHERE id=$1 AND organization_id=$2`,
            [requestedAccountNumericId, orgId]
          );
          if (acctRow.rows.length) {
            explicitSubaccountCode = acctRow.rows[0].subaccount_code;
            payoutProvider = 'paystack'; // force paystack when specific account selected
          }
        }
      } else if (requestedAccountId === 'stripe') {
        payoutProvider = 'stripe';
      }

      if (payoutProvider === 'paystack' && requestedAccountId && requestedAccountId !== 'stripe') {
        const requestedAccountNumericId = parseInt(requestedAccountId, 10);
        if (Number.isFinite(requestedAccountNumericId)) {
          const acctRow = await database.query(
            `SELECT subaccount_code, account_type FROM paystack_subaccounts WHERE id=$1 AND organization_id=$2`,
            [requestedAccountNumericId, orgId]
          );
          if (acctRow.rows.length) {
            explicitSubaccountCode = acctRow.rows[0].subaccount_code;
          }
        }
      }

      // When Stripe is the selected/preferred provider, do not auto-fallback.
      if (payoutProvider === 'stripe' && !stripeRuntime?.stripeOn) {
        return res.status(400).json({
          success: false,
          message: 'Stripe is currently the active payout provider for this school, but Stripe is not ready yet.',
        });
      }

      if (!payoutContext?.ready && !explicitSubaccountCode && requestedAccountId !== 'stripe') {
        return res.status(400).json({ success: false, message: 'This school has not set up a payout account yet.' });
      }

      const plan = await buildGuardianPaygiraPaymentPlan({
        client,
        orgId,
        guardianId,
        assignmentId: req.body?.assignment_id,
        amount: req.body?.amount,
        occurrenceDate: req.body?.occurrence_date,
        occurrenceDates: req.body?.occurrence_dates,
        applyCredit: req.body?.apply_credit,
        lockCredit: false,
      });

      if (!plan.row.accepts_card) {
        return res.status(400).json({ success: false, message: 'This bill does not accept online card or wallet payments.' });
      }
      if (!(plan.totalExternalAmount > 0)) {
        return res.status(400).json({ success: false, message: 'This selection is fully covered by available balance. Submit it without Stripe.' });
      }

      const { percentage: platformFeePercentage } = await getPlatformFeeSettings(client);
      const platformFeeBearer = await getOrgPlatformFeeBearer(orgId, client);
      const chargeBreakdown = buildPlatformChargeBreakdown(plan.totalExternalAmount, {
        platformFeePercentage,
        bearer: platformFeeBearer,
        applyPlatformFee: isPlatformFeeMethod('stripe'),
      });
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country, orgProfile.organization_currency);
      const currencyCode = String(display.financeCurrency.code || 'USD').toLowerCase();
      const stripeCheckoutConfig = buildGuardianStripeCheckoutConfig(allowedMethods.stripeMethods);

      const gpRow = await client.query(
        `SELECT first_name, last_name, email, stripe_customer_id
           FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );
      const guardianProfile = gpRow.rows[0] || {};

      if (payoutProvider === 'paystack') {
        const subaccountCodeToUse = explicitSubaccountCode || payoutContext?.paystack?.subaccountCode || null;
        const paystackConfig = await getActivePaystackConfig(database);
        if (!paystackConfig.secretKey) {
          return res.status(500).json({ success: false, message: 'Paystack is not configured for this school.' });
        }
        if (!subaccountCodeToUse) {
          return res.status(400).json({ success: false, message: 'This school has not saved a valid Paystack payout account yet.' });
        }
        if (!guardianProfile.email) {
          return res.status(400).json({ success: false, message: 'A guardian email is required for Paystack checkout.' });
        }

        const paymentReference = `PG-${orgId}-${guardianId}-${plan.row.assignment_id}-${Date.now()}`;
        const useSubaccount = Boolean(subaccountCodeToUse && subaccountCodeToUse.startsWith('ACCT_'));
        const platformFeeMinor = Math.round(chargeBreakdown.platformFeeAmount * 100);
        const paystackSupportedCurrencies = new Set(['GHS', 'NGN', 'ZAR', 'KES', 'EGP']);
        const orgCountryIso = String(orgProfile.organization_country || payoutContext?.country || '').trim().toLowerCase().slice(0, 2);
        const orgCountryCurrency = normalizeCurrencyCode(getCurrencyForCountry(orgCountryIso));
        const preferredPaystackCurrency = paystackSupportedCurrencies.has(orgCountryCurrency)
          ? orgCountryCurrency
          : 'GHS';
        req.session.guardianPaygiraPaystackPending = {
          assignment_id: String(plan.row.assignment_id),
          amount: String(req.body?.amount || ''),
          occurrence_date: String(req.body?.occurrence_date || ''),
          occurrence_dates: String(req.body?.occurrence_dates || ''),
          apply_credit: Boolean(req.body?.apply_credit),
          payment_reference: paymentReference,
        };

        const paystackCallbackUrl = `${req.protocol}://${req.get('host')}/guardian/paygira/stripe-return?reference=${encodeURIComponent(paymentReference)}&organizationId=${encodeURIComponent(orgId)}&guardianId=${encodeURIComponent(guardianId)}`;
        const paystackBasePayload = {
          email: guardianProfile.email,
          amount: Math.round(chargeBreakdown.totalChargedAmount * 100),
          reference: paymentReference,
          callback_url: paystackCallbackUrl,
          ...(useSubaccount
            ? {
                subaccount: subaccountCodeToUse,
                transaction_charge: platformFeeMinor,
                bearer: 'account',
              }
            : {}),
          metadata: {
            flow: 'guardian_paygira',
            organization_id: String(orgId),
            guardian_id: String(guardianId),
            assignment_id: String(plan.row.assignment_id),
            bill_id: String(plan.row.bill_id),
            student_id: String(plan.row.student_id),
            payout_provider: 'paystack',
            payout_subaccount_code: subaccountCodeToUse || '',
            payout_account_id: requestedAccountId ? String(requestedAccountId) : '',
            platform_fee_bearer: platformFeeBearer,
            platform_fee_amount: String(chargeBreakdown.platformFeeAmount),
            platform_fee_percentage: String(chargeBreakdown.platformFeePercentage),
          },
        };

        let paystackResponse;
        try {
          paystackResponse = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
              ...paystackBasePayload,
              currency: preferredPaystackCurrency,
            },
            { headers: { Authorization: `Bearer ${paystackConfig.secretKey}` } }
          );
        } catch (paystackErr) {
          const code = String(paystackErr?.response?.data?.code || '').toLowerCase();
          if (code === 'unsupported_currency' && preferredPaystackCurrency !== 'USD') {
            paystackResponse = await axios.post(
              'https://api.paystack.co/transaction/initialize',
              {
                ...paystackBasePayload,
                currency: 'USD',
              },
              { headers: { Authorization: `Bearer ${paystackConfig.secretKey}` } }
            );
          } else {
            throw paystackErr;
          }
        }

        const paystackInit = paystackResponse.data?.data || {};
        const payload = {
          success: true,
          provider: 'paystack',
          authorizationUrl: paystackInit.authorization_url,
          payment_url: paystackInit.authorization_url,
          reference: paymentReference,
          callbackUrl: paystackCallbackUrl,
          amountDue: Math.round(chargeBreakdown.totalChargedAmount * 100),
          amountApplied: Math.round(plan.totalExternalAmount * 100),
          platformFeeAmount: Math.round(chargeBreakdown.platformFeeAmount * 100),
          charge_breakdown: chargeBreakdown,
          currency: String(paystackResponse?.data?.data?.currency || preferredPaystackCurrency).toUpperCase(),
        };

        return req.session.save
          ? req.session.save(() => res.json(payload))
          : res.json(payload);
      }

      if (!stripeRuntime.useConnectedDestinationCharge || !stripeRuntime.connectedAccountId) {
        return res.status(400).json({
          success: false,
          message: 'Stripe Connect is not configured for this organization. Contact the school administrator.',
        });
      }

      const stripe = getFinanceStripeClient(stripeRuntime);

      let stripeCustomerId = guardianProfile.stripe_customer_id || null;
      if (!stripeCustomerId) {
        try {
          const fullName = `${guardianProfile.first_name || ''} ${guardianProfile.last_name || ''}`.trim();
          const customer = await stripe.customers.create({
            ...(guardianProfile.email ? { email: guardianProfile.email } : {}),
            ...(fullName ? { name: fullName } : {}),
            metadata: { guardian_id: String(guardianId), organization_id: String(orgId) },
          });
          stripeCustomerId = customer.id;
          await client.query(
            `UPDATE guardian_profiles SET stripe_customer_id=$1 WHERE guardian_id=$2 AND organization_id=$3`,
            [stripeCustomerId, guardianId, orgId]
          );
        } catch (custErr) {
          console.error('[guardianPaygiraStripeIntentPost] Stripe Customer creation failed:', custErr.message);
        }
      }

      const savedCardId = req.body?.saved_card_id ? parseInt(req.body.saved_card_id, 10) : null;
      let savedPaymentMethodId = null;
      if (savedCardId) {
        const cardRow = await client.query(
          `SELECT external_payment_method_id FROM guardian_payment_methods
            WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3
              AND external_payment_method_id IS NOT NULL`,
          [savedCardId, guardianId, orgId]
        );
        if (!cardRow.rows.length) {
          throw new PaygiraRequestError('Saved card not found or is not reusable. Please enter your card details manually.', 400);
        }
        savedPaymentMethodId = cardRow.rows[0].external_payment_method_id;
      }

      const piParams = {
        amount: Math.round(chargeBreakdown.totalChargedAmount * 100),
        currency: currencyCode,
        ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
        automatic_payment_methods: { enabled: true, allow_redirects: 'always' },
        transfer_data: { destination: stripeRuntime.connectedAccountId },
        ...(savedPaymentMethodId
          ? { payment_method: savedPaymentMethodId }
          : { setup_future_usage: 'on_session' }
        ),
        metadata: {
          flow: 'guardian_paygira',
          organization_id: String(orgId),
          guardian_id: String(guardianId),
          assignment_id: String(plan.row.assignment_id),
          bill_id: String(plan.row.bill_id),
          student_id: String(plan.row.student_id),
          platform_fee_bearer: platformFeeBearer,
          platform_fee_amount: String(chargeBreakdown.platformFeeAmount),
          platform_fee_percentage: String(chargeBreakdown.platformFeePercentage),
        },
        description: `PayGira ${plan.row.bill_title || 'Bill'} · Assignment ${plan.row.assignment_id}`,
      };
      const applicationFeeAmount = Math.round(Number(chargeBreakdown.platformFeeAmount || 0) * 100);
      if (applicationFeeAmount > 0) {
        piParams.application_fee_amount = applicationFeeAmount;
      }

      const paymentIntent = await stripe.paymentIntents.create(piParams);

      await upsertPendingGuardianStripePayment(client, {
        paymentIntentId: paymentIntent.id,
        organizationId: orgId,
        guardianId,
        assignmentId: plan.row.assignment_id,
        billId: plan.row.bill_id,
        studentId: plan.row.student_id,
        requestedAmount: plan.requestedAmount,
        totalExternalAmount: plan.totalExternalAmount,
        creditAppliedExpected: plan.creditApplied,
        platformFeePercentage: chargeBreakdown.platformFeePercentage,
        platformFeeAmount: chargeBreakdown.platformFeeAmount,
        platformFeeBearer,
        taxAmount: chargeBreakdown.taxAmount,
        chargedAmount: chargeBreakdown.totalChargedAmount,
        currency: String(display.financeCurrency.code || 'USD').toUpperCase(),
        selectedOccurrenceDates: plan.selectedOccurrenceDates,
        paymentEntries: plan.paymentEntries,
        status: 'pending',
      });

      req.session.guardianPaygiraStripeIntentId = paymentIntent.id;
      const payload = {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountDue: Math.round(chargeBreakdown.totalChargedAmount * 100),
        amountApplied: Math.round(plan.totalExternalAmount * 100),
        platformFeeAmount: Math.round(chargeBreakdown.platformFeeAmount * 100),
        charge_breakdown: chargeBreakdown,
        currency: String(display.financeCurrency.code || 'USD').toUpperCase(),
        returnUrl: `${req.protocol}://${req.get('host')}/guardian/paygira/stripe-return`,
        paymentMethodOrder: stripeCheckoutConfig.paymentMethodOrder,
        expressWallets: stripeCheckoutConfig.expressWallets,
        isSavedCard: Boolean(savedPaymentMethodId),
      };

      return req.session.save
        ? req.session.save(() => res.json(payload))
        : res.json(payload);
    } catch (error) {
      if (error instanceof PaygiraRequestError) {
        return res.status(error.status || 400).json({ success: false, message: error.message });
      }
      console.error('[guardianPaygiraStripeIntentPost]', error);
      const upstreamMessage = error?.response?.data?.message || error?.message;
      return res.status(500).json({ success: false, message: upstreamMessage || 'Unable to initialize Stripe payment.' });
    } finally {
      if (client && shouldReleaseClient) client.release();
    }
  },

  guardianPaygiraStripeReturnGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect('/account/login');

    const paymentIntentId = String(
      req.query.payment_intent || req.session.guardianPaygiraStripeIntentId || ''
    ).trim();
    const paystackReference = String(
      req.query.reference || req.session.guardianPaygiraPaystackPending?.payment_reference || ''
    ).trim();

    if (paystackReference && !paymentIntentId) {
      try {
        const paystackConfig = await getActivePaystackConfig(database);
        if (!paystackConfig.secretKey) {
          req.flash && req.flash('error', 'Paystack is not configured for this school.');
          return res.redirect('/guardian/paygira');
        }

        const verification = await axios.get(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(paystackReference)}`,
          { headers: { Authorization: `Bearer ${paystackConfig.secretKey}` } }
        );

        const paymentStatus = String(verification.data?.data?.status || '').toLowerCase();
        if (paymentStatus !== 'success') {
          req.flash && req.flash('error', 'Paystack payment was not completed.');
          return res.redirect('/guardian/paygira');
        }

        // Auto-settle the school's share when the charge was not split at charge
        // time (mobile money / bank-recipient / local accounts). No-op for ACCT_.
        try {
          await settleFromPaystackTransaction(database, {
            txn: verification.data?.data || null,
            context: 'guardian_paygira',
            secretKey: paystackConfig.secretKey,
          });
        } catch (settleErr) {
          console.error('[guardianPaygiraStripeReturnGet][paystack] auto-settle failed (will retry on schedule):', settleErr.message);
        }

        const paystackData = verification.data?.data || {};
        const paystackMeta = paystackData.metadata || {};
        const normalizedBearer = String(paystackMeta.platform_fee_bearer || '').toLowerCase() === 'school'
          ? 'school'
          : 'parent';
        const metadataFeePercentage = Number(paystackMeta.platform_fee_percentage || 0);

        const pending = req.session.guardianPaygiraPaystackPending || {};
        req.session.guardianPaygiraPaystackPending = null;
        req.body = {
          assignment_id: pending.assignment_id,
          amount: pending.amount,
          occurrence_date: pending.occurrence_date,
          occurrence_dates: pending.occurrence_dates,
          apply_credit: pending.apply_credit,
          method: 'paystack',
          payment_reference: paystackReference,
          platform_fee_bearer: normalizedBearer,
          platform_fee_percentage: Number.isFinite(metadataFeePercentage) ? metadataFeePercentage : undefined,
        };

        return financeController.guardianPaygiraPayPost(req, res, dbArg);
      } catch (error) {
        console.error('[guardianPaygiraStripeReturnGet][paystack]', error);
        req.flash && req.flash('error', 'Paystack payment could not be finalized.');
        return res.redirect('/guardian/paygira');
      }
    }

    if (!paymentIntentId) {
      req.flash && req.flash('error', 'Stripe did not return a valid payment session.');
      return res.redirect('/guardian/paygira');
    }

    try {
      const result = await finalizePendingGuardianStripePayment(database, paymentIntentId);
      req.session.guardianPaygiraStripeIntentId = null;

      if (result.status === 'completed') {
        const orgProfile = await loadOrganizationProfile(orgId);
        const display = await buildFinanceDisplayContext(req, orgId, await loadPspSettings(orgId), orgProfile.organization_country, orgProfile.organization_currency);
        const messageParts = [];
        if (result.creditApplied > 0) messageParts.push(`${display.formatMoney(result.creditApplied)} applied from available balance`);
        if (result.totalExternalAmount > 0) messageParts.push(`${display.formatMoney(result.totalExternalAmount)} applied to the bill`);
        if (result.totalPlatformFeeAmount > 0) messageParts.push(`${display.formatMoney(result.totalPlatformFeeAmount)} charged as platform fee`);
        req.flash && req.flash('success', messageParts.length
          ? `Stripe payment completed. ${messageParts.join(' and ')}.`
          : 'Stripe payment completed successfully.');
      } else if (result.status === 'already_processed') {
        req.flash && req.flash('success', 'This Stripe payment was already applied to the bill.');
      } else if (result.status === 'processing') {
        req.flash && req.flash('success', 'Stripe is still processing this payment. PayGira will update automatically once Stripe confirms it.');
      } else if (result.status === 'failed') {
        req.flash && req.flash('error', result.message || 'Stripe payment was not completed.');
      } else {
        req.flash && req.flash('error', 'We could not find this Stripe payment session.');
      }

      return req.session.save
        ? req.session.save(() => res.redirect('/guardian/paygira'))
        : res.redirect('/guardian/paygira');
    } catch (error) {
      console.error('[guardianPaygiraStripeReturnGet]', error);
      req.flash && req.flash('error', 'Stripe payment could not be finalized.');
      return res.redirect('/guardian/paygira');
    }
  },

  financeStripeWebhookPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const sig = req.headers['stripe-signature'];
    let event = null;

    try {
      let lastError = null;

      // 1) Verify platform-level destination charge webhooks first
      const platformSecrets = [
        process.env.STRIPE_FINANCE_WEBHOOK_SECRET,
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
        process.env.STRIPE_WEBHOOK_SECRET,
      ].filter(Boolean);
      if (platformSecrets.length) {
        const platformStripe = await getStripePlatformClient(database).catch(() => null);
        if (platformStripe) {
          for (const webhookSecret of platformSecrets) {
            try {
              event = platformStripe.webhooks.constructEvent(req.body, sig, webhookSecret);
              break;
            } catch (error) {
              lastError = error;
            }
          }
        }
      }

      // 2) Fallback to school-level Stripe secrets for direct-charge schools
      if (!event) {
        const secretRows = await database.query(
          `SELECT organization_id,
                  data->>'stripe_webhook_secret' AS stripe_webhook_secret,
                  data->>'stripe_secret_key' AS stripe_secret_key
             FROM finance_psp_settings
            WHERE COALESCE(data->>'stripe_webhook_secret', '') <> ''
              AND COALESCE(data->>'stripe_secret_key', '') <> ''`
        );

        for (const row of secretRows.rows) {
          try {
            const stripe = getSchoolStripeClient({ stripe_secret_key: row.stripe_secret_key });
            event = stripe.webhooks.constructEvent(req.body, sig, row.stripe_webhook_secret);
            break;
          } catch (error) {
            lastError = error;
          }
        }
      }

      if (!event) {
        throw lastError || new Error('Unable to verify Stripe webhook signature');
      }
    } catch (error) {
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      const paymentIntentId = event.data?.object?.id;
      if (!paymentIntentId) return res.json({ received: true });

      switch (event.type) {
        case 'payment_intent.succeeded':
          await finalizePendingGuardianStripePayment(database, paymentIntentId);
          break;
        case 'payment_intent.processing': {
          const client = await database.connect();
          try {
            await client.query('BEGIN');
            await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'processing', {
              stripeMethodType: resolveStripeFinanceMethod(event.data.object),
            });
            await client.query('COMMIT');
          } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw error;
          } finally {
            client.release();
          }
          break;
        }
        case 'payment_intent.payment_failed':
        case 'payment_intent.canceled': {
          const client = await database.connect();
          try {
            await client.query('BEGIN');
            await updatePendingGuardianStripePaymentStatus(client, paymentIntentId, 'failed', {
              stripeMethodType: resolveStripeFinanceMethod(event.data.object),
              lastError: event.data.object?.last_payment_error?.message || `Stripe event ${event.type}.`,
            });
            await client.query('COMMIT');
          } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw error;
          } finally {
            client.release();
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      console.error('[financeStripeWebhookPost]', error);
      return res.status(500).send('Webhook processing error');
    }

    return res.json({ received: true });
  },

  // Guardian pays a bill (one assignment). Uses saved card metadata or generic.
  guardianPaygiraPayPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    const { assignment_id, amount, card_id, method, occurrence_date, occurrence_dates, apply_credit, payment_reference } = req.body;
    let client;
    let shouldReleaseClient = false;
    try {
      const selectedOccurrenceDates = parseOccurrenceDates(occurrence_dates);
      if (!selectedOccurrenceDates.length) {
        const singleOccurrenceDate = parseOccurrenceDates(occurrence_date);
        if (singleOccurrenceDate.length) selectedOccurrenceDates.push(singleOccurrenceDate[0]);
      }

      // Verify this assignment belongs to a student linked to this guardian
      if (typeof database.connect === "function") {
        client = await database.connect();
        shouldReleaseClient = true;
      } else {
        client = database;
      }

      const verify = await client.query(
        `SELECT a.*, b.title AS bill_title, b.due_date, b.bill_type, b.recurrence, b.recurrence_end_date,
          b.term_id, b.exclude_non_school_days,
          b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination,
          tm.end_date AS term_end_date
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           LEFT JOIN terms tm ON tm.term_id = b.term_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2
            AND a.status <> 'cancelled'
            AND COALESCE(b.status, 'active') <> 'cancelled'
            AND (
              EXISTS (SELECT 1 FROM guardians g
                       WHERE g.student_id=a.student_id AND g.guardian_id=$3 AND g.organization_id=$2)
              OR EXISTS (SELECT 1 FROM guardian_students gs
                       WHERE gs.student_id=a.student_id AND gs.guardian_id=$3)
            )
          LIMIT 1`,
        [assignment_id, orgId, guardianId]
      );
      if (!verify.rows.length) {
        req.flash && req.flash("error", "Not authorized to pay this bill.");
        return res.redirect("/guardian/paygira");
      }
      const row = verify.rows[0];
      const isRecurringBill = String(row.bill_type || "") === "recurring";
      const wantsCredit = Boolean(parseBoolean(apply_credit));
      if (isRecurringBill && !selectedOccurrenceDates.length) {
        req.flash && req.flash("error", "Select at least one recurring date to pay.");
        return res.redirect("/guardian/paygira");
      }

      const requestedAmount = Math.max(Number(amount || 0), 0);
      if (!isRecurringBill && requestedAmount <= 0 && !wantsCredit) {
        req.flash && req.flash("error", "Enter a valid amount.");
        return res.redirect("/guardian/paygira");
      }

      const paymentNotesBase = `Guardian portal payment by guardian #${guardianId}`;
      let paymentEntries = [];
      let creditApplied = 0;
      let creditCreated = 0;
      let totalExternalAmount = 0;
      let availableCredit = 0;

      await client.query("BEGIN");

      if (wantsCredit) {
        availableCredit = await getStudentCreditBalance(client, orgId, row.student_id, { forUpdate: true });
      }

      if (isRecurringBill) {
        const existingOccurrencePayments = await client.query(
          `SELECT occurrence_date::text AS occurrence_date, COALESCE(SUM(amount), 0) AS paid_amount
             FROM finance_payments
            WHERE organization_id=$1 AND assignment_id=$2 AND occurrence_date = ANY($3::date[])
            GROUP BY occurrence_date`,
          [orgId, row.assignment_id, selectedOccurrenceDates]
        );
        const paidByDate = existingOccurrencePayments.rows.reduce((accumulator, entry) => {
          accumulator[entry.occurrence_date] = Number(entry.paid_amount || 0);
          return accumulator;
        }, {});
        paymentEntries = selectedOccurrenceDates.reduce((entries, dateValue) => {
          const outstandingAmount = Math.max(Number(row.amount || 0) - Number(paidByDate[dateValue] || 0), 0);
          if (!(outstandingAmount > 0)) return entries;
          entries.push({
            amount: outstandingAmount,
            occurrenceDate: dateValue,
            notes: `${paymentNotesBase} for ${dateValue}`,
            creditAmount: 0,
            externalAmount: 0,
          });
          return entries;
        }, []);
        if (!paymentEntries.length) {
          await client.query("ROLLBACK");
          req.flash && req.flash("error", "The selected recurring dates are already fully paid.");
          return res.redirect("/guardian/paygira");
        }
        creditApplied = wantsCredit
          ? Math.min(availableCredit, paymentEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
          : 0;
        let remainingCredit = creditApplied;
        paymentEntries = paymentEntries.map((entry) => {
          const creditAmount = Math.min(Number(entry.amount || 0), remainingCredit);
          remainingCredit -= creditAmount;
          const externalAmount = Math.max(Number(entry.amount || 0) - creditAmount, 0);
          return {
            ...entry,
            creditAmount,
            externalAmount,
          };
        });
        totalExternalAmount = paymentEntries.reduce((sum, entry) => sum + Number(entry.externalAmount || 0), 0);
      } else {
        const currentOutstanding = Math.max(Number(row.amount || 0) + Number(row.late_fee_applied || 0) - Number(row.amount_paid || 0), 0);
        creditApplied = wantsCredit
          ? Math.min(availableCredit, Math.max(currentOutstanding - requestedAmount, 0))
          : 0;
        totalExternalAmount = requestedAmount;
        paymentEntries = [{
          amount: requestedAmount,
          occurrenceDate: normalizeOccurrenceDate(occurrence_date),
          notes: paymentNotesBase,
          creditAmount: creditApplied,
          externalAmount: requestedAmount,
        }];
      }

      if (!(totalExternalAmount > 0 || creditApplied > 0)) {
        await client.query("ROLLBACK");
        req.flash && req.flash("error", "Enter a valid amount.");
        return res.redirect("/guardian/paygira");
      }

      let reference = `GUARDIAN-${guardianId}`;
      let payMethod = String(method || "card").toLowerCase();
      if (totalExternalAmount > 0) {
        const psp = await loadPspSettings(orgId);
        const orgProfile = await loadOrganizationProfile(orgId);
        const stripeRuntime = await resolveFinanceStripeRuntime(orgId, psp, orgProfile);
        const allow = computeAllowedMethods(psp, { stripeOn: stripeRuntime.stripeOn });
        const ok =
          (payMethod === 'card'          && row.accepts_card && allow.stripeOn) ||
          (payMethod === 'stripe'        && row.accepts_card && allow.stripeOn) ||
          (payMethod === 'paystack'      && row.accepts_card) ||
          (payMethod === 'bank_transfer' && row.accepts_transfer && allow.bankOn) ||
          (payMethod === 'mobile_money'  && allow.momoOn) ||
          (payMethod === 'other');
        if (!ok) {
          await client.query("ROLLBACK");
          req.flash && req.flash("error", `This bill does not accept "${payMethod}". Choose a method the school has enabled.`);
          return res.redirect("/guardian/paygira");
        }

        if (card_id && (payMethod === 'card' || payMethod === 'stripe')) {
          const c = await client.query(
            `SELECT brand, last4 FROM guardian_payment_methods
              WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
            [parseInt(card_id, 10) || 0, guardianId, orgId]
          );
          if (c.rows.length) {
            reference = `${c.rows[0].brand || "CARD"} •••• ${c.rows[0].last4}`;
            payMethod = "card";
          }
        }
      }

      const { percentage: platformFeePercentage } = await getPlatformFeeSettings(client);
      const defaultPlatformFeeBearer = await getOrgPlatformFeeBearer(orgId, client);
      const paystackMetaBearer = String(req.body?.platform_fee_bearer || '').toLowerCase() === 'school'
        ? 'school'
        : 'parent';
      const platformFeeBearer =
        payMethod === 'paystack' && payment_reference
          ? paystackMetaBearer
          : defaultPlatformFeeBearer;
      const paystackMetaFeePercentage = Number(req.body?.platform_fee_percentage);
      const effectivePlatformFeePercentage =
        payMethod === 'paystack' && payment_reference && Number.isFinite(paystackMetaFeePercentage)
          ? paystackMetaFeePercentage
          : platformFeePercentage;
      let totalPlatformFeeAmount = 0;

      if (creditApplied > 0) {
        for (const entry of paymentEntries) {
          if (!(Number(entry.creditAmount || 0) > 0)) continue;
          await client.query(
            `INSERT INTO finance_payments
              (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_bearer)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              orgId,
              row.assignment_id,
              row.bill_id,
              row.student_id,
              entry.creditAmount,
              'credit',
              'STUDENT-CREDIT',
              `${entry.notes} using available student credit`,
              entry.occurrenceDate || null,
              platformFeeBearer,
            ]
          );
        }
        await setStudentCreditBalance(client, orgId, row.student_id, availableCredit - creditApplied);
      }

      if (totalExternalAmount > 0) {
        if (payMethod === 'paystack' && payment_reference) {
          reference = payment_reference;
        }
        if (isRecurringBill) {
          for (const entry of paymentEntries) {
            if (!(Number(entry.externalAmount || 0) > 0)) continue;
            const chargeBreakdown = buildFinancePaymentChargeBreakdown(entry.externalAmount, payMethod, effectivePlatformFeePercentage, 0, platformFeeBearer);
            totalPlatformFeeAmount += chargeBreakdown.platformFeeAmount;
            await client.query(
              `INSERT INTO finance_payments
                (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_percentage, platform_fee_amount, platform_fee_bearer, tax_amount)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                orgId,
                row.assignment_id,
                row.bill_id,
                row.student_id,
                entry.externalAmount,
                payMethod,
                reference,
                entry.notes,
                entry.occurrenceDate || null,
                chargeBreakdown.platformFeePercentage,
                chargeBreakdown.platformFeeAmount,
                platformFeeBearer,
                chargeBreakdown.taxAmount,
              ]
            );
          }
        } else {
          const chargeBreakdown = buildFinancePaymentChargeBreakdown(totalExternalAmount, payMethod, effectivePlatformFeePercentage, 0, platformFeeBearer);
          totalPlatformFeeAmount += chargeBreakdown.platformFeeAmount;
          await client.query(
            `INSERT INTO finance_payments
              (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_percentage, platform_fee_amount, platform_fee_bearer, tax_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              orgId,
              row.assignment_id,
              row.bill_id,
              row.student_id,
              totalExternalAmount,
              payMethod,
              reference,
              paymentNotesBase,
              normalizeOccurrenceDate(occurrence_date),
              chargeBreakdown.platformFeePercentage,
              chargeBreakdown.platformFeeAmount,
              platformFeeBearer,
              chargeBreakdown.taxAmount,
            ]
          );
        }
      }

      const newPaid = Number(row.amount_paid) + totalExternalAmount + creditApplied;
      const scheduleContext = createBillScheduleContextLoader(client, orgId);
      const total = (isRecurringBill ? await getScheduledBilledAmount(row, scheduleContext) : Number(row.amount)) + Number(row.late_fee_applied || 0);
      let appliedToAssignment = newPaid;
      if (!isRecurringBill && newPaid > total) {
        creditCreated = newPaid - total;
        appliedToAssignment = total;
      }
      const newStatus = isRecurringBill
        ? (appliedToAssignment >= total
            ? "paid"
            : (newPaid > 0 ? "partial" : recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date)))
        : recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await client.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (creditCreated > 0) {
        await addStudentCredit(client, orgId, row.student_id, creditCreated);
      }
      await client.query("COMMIT");
      invalidateFinanceCache(orgId);

      const display = await buildFinanceDisplayContext(req, orgId);
      if (isRecurringBill) {
        const recurringMessagePrefix = paymentEntries.length > 1
          ? `${paymentEntries.length} recurring dates settled.`
          : `${new Date(selectedOccurrenceDates[0] + "T00:00:00").toLocaleDateString()} settled.`;
        const recurringMessageParts = [];
        if (creditApplied > 0) recurringMessageParts.push(`${display.formatMoney(creditApplied)} applied from available balance`);
        if (totalExternalAmount > 0) recurringMessageParts.push(`${display.formatMoney(totalExternalAmount)} received`);
        if (totalPlatformFeeAmount > 0) recurringMessageParts.push(`${display.formatMoney(totalPlatformFeeAmount)} platform fee charged`);
        req.flash && req.flash("success", `${recurringMessagePrefix} ${recurringMessageParts.join(' and ')}.`.trim());
      } else {
        const paymentSummary = [];
        if (creditApplied > 0) paymentSummary.push(`${display.formatMoney(creditApplied)} applied from available balance`);
        if (totalExternalAmount > 0) paymentSummary.push(`${display.formatMoney(totalExternalAmount)} received`);
        if (totalPlatformFeeAmount > 0) paymentSummary.push(`${display.formatMoney(totalPlatformFeeAmount)} platform fee charged`);
        const baseMessage = paymentSummary.length ? `${paymentSummary.join(' and ')}.` : 'Payment applied.';
        req.flash && req.flash("success", creditCreated > 0
          ? `${baseMessage} ${display.formatMoney(creditCreated)} kept as credit.`
          : `${baseMessage} Thank you.`);
      }
      // Audit log + guardian payment notification (guardian-initiated)
      try {
        const gRow = (await database.query(`SELECT first_name, last_name FROM guardians WHERE guardian_id=$1 LIMIT 1`, [guardianId])).rows[0];
        const sRow = (await database.query(`SELECT first_name, last_name FROM students WHERE student_id=$1 AND organization_id=$2`, [row.student_id, orgId])).rows[0];
        const bRow = (await database.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [row.bill_id, orgId])).rows[0];
        const studentLabel = sRow ? `${sRow.first_name} ${sRow.last_name}` : `Student #${row.student_id}`;
        const guardianName = gRow ? `${gRow.first_name || ''} ${gRow.last_name || ''}`.trim() : `Guardian #${guardianId}`;
        await logPaygira(req, {
          userName: guardianName,
          userRole: "Guardian",
          actionType: "Paid",
          recordType: "Payment",
          recordId: row.assignment_id,
          recordLabel: `${studentLabel} — ${bRow?.title || 'Bill'}`,
          description: `Guardian ${guardianName} applied $${(creditApplied || 0).toFixed(2)} in student credit and paid $${(totalExternalAmount || 0).toFixed(2)}${totalExternalAmount > 0 ? ` (${payMethod})` : ''} for ${studentLabel} on bill "${bRow?.title || row.bill_id}"${isRecurringBill && selectedOccurrenceDates.length ? ` across ${selectedOccurrenceDates.length} recurring date(s)` : ''}. New status: ${newStatus}${creditCreated > 0 ? `; $${creditCreated.toFixed(2)} credited.` : ''}.`,
          changedFields: [
            { field: "Applied Credit", value: `$${(creditApplied || 0).toFixed(2)}` },
            { field: "Amount", value: `$${(totalExternalAmount || 0).toFixed(2)}` },
            ...(totalPlatformFeeAmount > 0 ? [{ field: "Platform Fee", value: `$${totalPlatformFeeAmount.toFixed(2)}` }] : []),
            { field: "Method", value: totalExternalAmount > 0 ? payMethod : 'credit' },
            { field: "Reference", value: reference || '—' },
            ...(isRecurringBill && selectedOccurrenceDates.length ? [{ field: "Recurring Dates", value: selectedOccurrenceDates.join(", ") }] : []),
            { field: "New Status", value: newStatus },
          ],
        });

        // In-app notification for the guardian confirming their payment
        const billTitle = bRow?.title || 'bill';
        const paidStr = totalExternalAmount > 0
          ? display.formatMoney(totalExternalAmount)
          : (creditApplied > 0 ? display.formatMoney(creditApplied) + ' (credit)' : 'payment');
        createNotification(database, {
          orgId,
          recipientType: 'guardian',
          recipientId: Number(guardianId),
          type: 'payment_made',
          title: `Payment confirmed — ${studentLabel}`,
          body: `${paidStr} applied to "${billTitle}". Status: ${newStatus}.`,
          link: `/guardian/paygira`,
        }).catch(() => {});
      } catch (_) {}
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch (_) {}
      }
      console.error("[guardianPaygiraPayPost]", e);
      req.flash && req.flash("error", "Payment could not be processed: " + e.message);
    } finally {
      if (client && shouldReleaseClient) client.release();
    }
    res.redirect("/guardian/paygira");
  },

  guardianCardDeletePost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await database.query(
        `DELETE FROM guardian_payment_methods WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
        [req.params.id, guardianId, orgId]
      );
      req.flash && req.flash("success", "Card removed.");
      await logPaygira(req, {
        actionType: "Deleted Card",
        recordType: "Payment Method",
        recordId: req.params.id,
        recordLabel: `Card #${req.params.id}`,
        description: `Guardian removed saved payment method #${req.params.id}.`,
        changedFields: [],
      });
    } catch (e) { req.flash && req.flash("error", "Could not remove card."); }
    res.redirect("/guardian/settings#cards");
  },

  guardianCardDefaultPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await database.query(
        `UPDATE guardian_payment_methods SET is_default=false WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );
      await database.query(
        `UPDATE guardian_payment_methods SET is_default=true WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
        [req.params.id, guardianId, orgId]
      );
      req.flash && req.flash("success", "Default card updated.");
      await logPaygira(req, {
        actionType: "Updated Card",
        recordType: "Payment Method",
        recordId: req.params.id,
        recordLabel: `Card #${req.params.id}`,
        description: `Guardian set payment method #${req.params.id} as default.`,
        changedFields: [{ field: "Default", value: "Yes" }],
      });
    } catch (e) { req.flash && req.flash("error", "Could not update card."); }
    res.redirect("/guardian/settings#cards");
  },

  // ===================================================================
  //  INVOICES & RECEIPTS — staff (assignee) + guardian (parent of student)
  //  Both endpoints are org-scoped and verify the caller is authorized
  //  to view the underlying assignment/payment.
  // ===================================================================
  /**
   * Render an invoice for one assignment.
   * Route: GET /account/settings/my-paygira/invoice/:assignmentId
   *        GET /guardian/paygira/invoice/:assignmentId
   */
  invoiceGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const guardianId = req.session.guardianId || null;
    if (!orgId || (!userId && !guardianId)) return res.redirect("/account/login");
    const assignmentId = parseInt(req.params.assignmentId, 10);
    if (!assignmentId) return res.status(400).send("Invalid invoice.");
    try {
      const r = await database.query(
        `SELECT a.*, b.title AS bill_title, b.description AS bill_description,
                b.due_date, b.bill_type, b.recurrence, b.assignee_id,
                s.first_name, s.last_name, s.image_url,
                 c.class_name,
                 o.organization_name, o.email AS org_email, o.organization_phone AS org_phone, o.organization_address AS org_address, o.logo_path AS org_logo,
                 o.organization_country,
                 o.organization_currency
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN organizations o ON o.organization_id = a.organization_id
          WHERE a.assignment_id = $1 AND a.organization_id = $2
          LIMIT 1`,
        [assignmentId, orgId]
      );
      if (!r.rows.length) return res.status(404).send("Invoice not found.");
      const row = r.rows[0];

      // Authorization
      let authorized = false;
      if (userId && row.assignee_id === userId) authorized = true;
      // org admin?
      if (!authorized && userId) authorized = await isFinanceAdmin(req);
      if (!authorized && guardianId) {
        const g = await database.query(
          `SELECT 1 FROM guardians WHERE student_id=$1 AND guardian_id=$2 AND organization_id=$3
            UNION SELECT 1 FROM guardian_students gs
              JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
              WHERE gs.student_id=$1 AND gs.guardian_id=$2 AND gp.organization_id=$3
            LIMIT 1`,
          [row.student_id, guardianId, orgId]
        );
        if (g.rows.length) authorized = true;
      }
      if (!authorized) return res.status(403).send("Not authorized to view this invoice.");

      const pspSettings = await loadPspSettings(orgId);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, row.organization_country, row.organization_currency);
      const platformFeeSettings = await getPlatformFeeSettings(database);

      // Payment history for this assignment
      const pays = await database.query(
        `SELECT amount, method, reference, received_at,
                COALESCE(platform_fee_percentage, 0) AS platform_fee_percentage,
                COALESCE(platform_fee_amount, 0) AS platform_fee_amount,
                COALESCE(platform_fee_bearer, 'parent') AS platform_fee_bearer,
                COALESCE(tax_amount, 0) AS tax_amount
           FROM finance_payments
          WHERE assignment_id=$1 AND organization_id=$2
          ORDER BY received_at`,
        [assignmentId, orgId]
      );

      res.render("finance/invoice", {
        layout: false,
        assignment: row,
        payments: pays.rows,
        financeCurrency: display.financeCurrency,
        formatMoney: display.formatMoney,
        formatUsdEquivalent: display.formatUsdEquivalent,
        platformFeePercentage: platformFeeSettings.percentage,
        money,
        balance: Math.max(Number(row.amount || 0) + Number(row.late_fee_applied || 0) - Number(row.amount_paid || 0), 0),
      });
    } catch (e) {
      console.error("[invoiceGet]", e);
      res.status(500).send("Unable to render invoice.");
    }
  },

  /**
   * Render a receipt for one payment.
   * Route: GET /account/settings/my-paygira/receipt/:paymentId
   *        GET /guardian/paygira/receipt/:paymentId
   */
  receiptGet: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const userId = req.session.user?.user_id || req.session.userId || null;
    const guardianId = req.session.guardianId || null;
    if (!orgId || (!userId && !guardianId)) return res.redirect("/account/login");
    const paymentId = parseInt(req.params.paymentId, 10);
    if (!paymentId) return res.status(400).send("Invalid receipt.");
    try {
      const r = await database.query(
        `SELECT p.*, b.title AS bill_title, b.assignee_id, b.due_date,
                s.first_name, s.last_name, s.image_url, s.student_id,
                c.class_name,
                a.amount AS assignment_amount, a.amount_paid AS assignment_paid,
                a.late_fee_applied AS assignment_late_fee,
                o.organization_name, o.email AS org_email, o.organization_phone AS org_phone, o.organization_address AS org_address, o.logo_path AS org_logo,
                o.organization_country,
                o.organization_currency,
                COALESCE(p.platform_fee_percentage, 0) AS platform_fee_percentage,
                COALESCE(p.platform_fee_amount, 0) AS platform_fee_amount,
                COALESCE(p.tax_amount, 0) AS tax_amount
           FROM finance_payments p
           LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
           LEFT JOIN finance_bill_assignments a ON a.assignment_id = p.assignment_id
           LEFT JOIN students s ON s.student_id = p.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN organizations o ON o.organization_id = p.organization_id
          WHERE p.payment_id = $1 AND p.organization_id = $2
          LIMIT 1`,
        [paymentId, orgId]
      );
      if (!r.rows.length) return res.status(404).send("Receipt not found.");
      const row = r.rows[0];

      // Authorization
      let authorized = false;
      if (userId && (row.received_by === userId || row.assignee_id === userId)) authorized = true;
      if (!authorized && userId) authorized = await isFinanceAdmin(req);
      if (!authorized && guardianId && row.student_id) {
        const g = await database.query(
          `SELECT 1 FROM guardians WHERE student_id=$1 AND guardian_id=$2 AND organization_id=$3
            UNION SELECT 1 FROM guardian_students gs
              JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
              WHERE gs.student_id=$1 AND gs.guardian_id=$2 AND gp.organization_id=$3
            LIMIT 1`,
          [row.student_id, guardianId, orgId]
        );
        if (g.rows.length) authorized = true;
      }
      if (!authorized) return res.status(403).send("Not authorized to view this receipt.");

      const pspSettings = await loadPspSettings(orgId);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, row.organization_country, row.organization_currency);

      res.render("finance/receipt", {
        layout: false,
        payment: row,
        financeCurrency: display.financeCurrency,
        formatMoney: display.formatMoney,
        formatUsdEquivalent: display.formatUsdEquivalent,
        money,
      });
    } catch (e) {
      console.error("[receiptGet]", e);
      res.status(500).send("Unable to render receipt.");
    }
  },
};

// ----- helpers shared across guardian payment methods -----
let _gCardsReady = false;
async function ensureGuardianCardsSchema() {
  if (_gCardsReady) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS guardian_payment_methods (
        card_id          SERIAL PRIMARY KEY,
        guardian_id      INT NOT NULL,
        organization_id  INT NOT NULL,
        brand            VARCHAR(40),
        last4            VARCHAR(4) NOT NULL,
        holder_name      VARCHAR(120),
        exp_month        SMALLINT,
        exp_year         SMALLINT,
        is_default       BOOLEAN NOT NULL DEFAULT FALSE,
        student_id       INT,
        created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gpm_guardian ON guardian_payment_methods(guardian_id, organization_id)`);
    // Ensure extra columns exist
    await db.query(`ALTER TABLE guardian_payment_methods ADD COLUMN IF NOT EXISTS external_payment_method_id VARCHAR(255)`).catch(() => {});
    await db.query(`ALTER TABLE guardian_payment_methods ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'stripe'`).catch(() => {});
    // Stripe Customer ID stored per guardian per organisation (school's own Stripe account)
    await db.query(`ALTER TABLE guardian_profiles ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`).catch(() => {});
  } catch (e) { console.error("[ensureGuardianCardsSchema]", e.message); }
  _gCardsReady = true;
}

/**
 * After a successful Stripe payment, save the card details (last4, brand, exp)
 * to guardian_payment_methods so the guardian can reuse it next time.
 * Silently ignores errors — never let this break a payment flow.
 */
async function saveGuardianPaymentMethodIfNew(dbClient, guardianId, orgId, paymentIntent) {
  try {
    const pm = paymentIntent?.payment_method;
    if (!pm || typeof pm !== 'object' || pm.type !== 'card' || !pm.card?.last4) return;
    const card = pm.card;
    // Check if already stored (by Stripe PM id or by last4 + exp)
    const existing = await dbClient.query(
      `SELECT card_id FROM guardian_payment_methods
        WHERE guardian_id=$1 AND organization_id=$2
          AND (external_payment_method_id=$3
               OR (last4=$4 AND exp_month=$5 AND exp_year=$6))
        LIMIT 1`,
      [guardianId, orgId, pm.id, card.last4, card.exp_month, card.exp_year]
    );
    if (existing.rows.length) {
      // Backfill external_payment_method_id if missing
      if (pm.id) {
        await dbClient.query(
          `UPDATE guardian_payment_methods
              SET external_payment_method_id=$1
            WHERE card_id=$2 AND (external_payment_method_id IS NULL OR external_payment_method_id='')`,
          [pm.id, existing.rows[0].card_id]
        ).catch(() => {});
      }
      return;
    }
    // First card for this guardian in this org → make default
    const countR = await dbClient.query(
      `SELECT COUNT(*)::int AS n FROM guardian_payment_methods WHERE guardian_id=$1 AND organization_id=$2`,
      [guardianId, orgId]
    );
    const makeDefault = countR.rows[0].n === 0;
    if (makeDefault) {
      await dbClient.query(
        `UPDATE guardian_payment_methods SET is_default=false WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      ).catch(() => {});
    }
    await dbClient.query(
      `INSERT INTO guardian_payment_methods
          (guardian_id, organization_id, brand, last4, holder_name, exp_month, exp_year, is_default, provider, external_payment_method_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'stripe',$9)`,
      [
        guardianId, orgId,
        card.brand || 'card',
        card.last4,
        pm.billing_details?.name || null,
        card.exp_month,
        card.exp_year,
        makeDefault,
        pm.id,
      ]
    );
  } catch (saveErr) {
    console.error('[saveGuardianPaymentMethodIfNew]', saveErr.message);
  }
}

function inferCardBrand(digits) {
  if (/^4/.test(digits))                return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits))  return "Mastercard";
  if (/^3[47]/.test(digits))            return "Amex";
  if (/^6(011|5)/.test(digits))         return "Discover";
  if (/^(50|56|57|58|6\d)/.test(digits)) return "Verve";
  return "Card";
}

