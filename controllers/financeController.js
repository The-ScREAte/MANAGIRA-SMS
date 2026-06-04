// controllers/financeController.js
// PayGira — Finance & Billing Management — multi-tenant scoped by organization_id.
// All queries filter by req.session.organizationId. The page is admin-only.

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const Stripe = require("stripe");
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
  getLocaleForCurrency,
  getUsdRate,
  normalizeCurrencyCode,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const { getOrgChargeCards } = require("../utils/orgChargeCards");
const { ensurePaymentProviderSchema } = require("../utils/paymentProviderSchema");
const { getActiveStripePublicKey, getStripeSettings, getStripePlatformCredentials, getStripeConnectAccountId, ensureStripeConnectAccountSchema } = require("../utils/stripeConfig");
const {
  getPlatformFeeSettings,
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
const FIN_CACHE_TTL_SECONDS = 30;

function _finKey(orgId, name, extra) {
  const tag = extra ? JSON.stringify(extra) : "";
  return `paygira:${orgId}:${name}:${tag}`;
}

async function cachedLoad(orgId, name, extra, fetchFn) {
  if (!orgId) return fetchFn();
  return cacheManager.getOrFetch(
    "organization",
    _finKey(orgId, name, extra),
    fetchFn,
    { ttl: FIN_CACHE_TTL_SECONDS }
  );
}

function invalidateFinanceCache(orgId) {
  if (!orgId) return;
  // Wipe every PayGira key for this org. Cheap O(n) over a small node-cache.
  cacheManager.invalidatePattern("organization", `paygira:${orgId}:`);
}

// PayGira audit logger — captures Admin/Mini-Admin actions that the
// auto-middleware skips, with precise descriptions and field diffs.
async function logPaygira(req, payload) {
  try {
    const organizationId = req.session?.organizationId;
    if (!organizationId) return;
    const sess = req.session || {};
    const user = sess.user || {};
    const guardian = sess.guardian || {};
    const userId =
      user.user_id || sess.userId ||
      guardian.guardian_id || sess.guardianId || null;
    const userName =
      payload.userName ||
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      [guardian.first_name, guardian.last_name].filter(Boolean).join(" ").trim() ||
      sess.userName || sess.email || "PayGira User";
    const userRole =
      payload.userRole ||
      sess.accountType || sess.userRole ||
      (sess.guardianId || guardian.guardian_id ? "Guardian" : "Staff");
    await logOrganizationActivity({
      organizationId,
      userId,
      userName,
      userRole,
      actionType: payload.actionType || "Updated",
      moduleName: payload.moduleName || "PayGira",
      pagePath: req.originalUrl || req.path,
      recordType: payload.recordType || "Bill",
      recordId: payload.recordId != null ? String(payload.recordId) : null,
      recordLabel: payload.recordLabel || null,
      description: payload.description || "PayGira action.",
      changedFields: Array.isArray(payload.changedFields) ? payload.changedFields : [],
      ipAddress: req.ip,
    });
  } catch (err) {
    console.error("[paygira-log]", err.message || err);
  }
}

let _schemaReady = false;
async function ensureFinanceSchema() {
  if (_schemaReady) return;
  const sqlPath = path.join(__dirname, "..", "database", "migrations", "2026-05-14_create_finance_billing_system.sql");
  try {
    const sql = fs.readFileSync(sqlPath, "utf8");
    await db.query(sql);
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS recurrence_end_date DATE`);
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS exclude_non_school_days BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS target_class_ids INT[]`);
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS target_student_ids INT[]`);
    await db.query(`ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS occurrence_date DATE`);
    await db.query(`ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS platform_fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 0`);
    await db.query(`ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.query(`ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS finance_pending_stripe_payments (
        payment_intent_id VARCHAR(255) PRIMARY KEY,
        organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        guardian_id INT NOT NULL,
        assignment_id INT NOT NULL REFERENCES finance_bill_assignments(assignment_id) ON DELETE CASCADE,
        bill_id INT REFERENCES finance_bills(bill_id) ON DELETE SET NULL,
        student_id INT REFERENCES students(student_id) ON DELETE SET NULL,
        requested_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_external_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        credit_applied_expected NUMERIC(14,2) NOT NULL DEFAULT 0,
        platform_fee_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
        platform_fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        charged_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(12) NOT NULL DEFAULT 'USD',
        selected_occurrence_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
        payment_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(24) NOT NULL DEFAULT 'pending',
        stripe_method_type VARCHAR(80),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      )
    `);
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_pending_stripe_org_status ON finance_pending_stripe_payments (organization_id, status, created_at DESC)`
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS finance_collection_signoffs (
        signoff_id SERIAL PRIMARY KEY,
        organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        bill_id INT NOT NULL REFERENCES finance_bills(bill_id) ON DELETE CASCADE,
        class_id INT NOT NULL DEFAULT 0,
        occurrence_date DATE,
        scope_key VARCHAR(40) NOT NULL,
        signed_by_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
        signed_by_name VARCHAR(160) NOT NULL,
        signer_role VARCHAR(80),
        student_count INT NOT NULL DEFAULT 0,
        total_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
        signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, bill_id, class_id, scope_key)
      )
    `);
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_collection_signoffs_bill_scope ON finance_collection_signoffs (organization_id, bill_id, class_id, scope_key)`
    );
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_finance_collection_signoffs_signed_at ON finance_collection_signoffs (organization_id, signed_at DESC)`
    );
  } catch (e) {
    console.error("[financeSchema]", e.message);
  }
  _schemaReady = true;
}

let _assigneeColReady = false;
async function ensureAssigneeColumn() {
  if (_assigneeColReady) return;
  try {
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS assignee_id INT REFERENCES users(user_id) ON DELETE SET NULL`);
    await db.query(`ALTER TABLE finance_bills ADD COLUMN IF NOT EXISTS payment_destination VARCHAR(20) DEFAULT 'stripe'`);
    // Junction table for multiple collectors per bill
    await db.query(`
      CREATE TABLE IF NOT EXISTS finance_bill_collectors (
        id              SERIAL PRIMARY KEY,
        bill_id         INT NOT NULL REFERENCES finance_bills(bill_id) ON DELETE CASCADE,
        user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        organization_id INT NOT NULL,
        created_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE(bill_id, user_id)
      )
    `);
    // Backfill existing single assignees into the junction table
    await db.query(`
      INSERT INTO finance_bill_collectors (bill_id, user_id, organization_id)
      SELECT bill_id, assignee_id, organization_id
      FROM finance_bills
      WHERE assignee_id IS NOT NULL
      ON CONFLICT (bill_id, user_id) DO NOTHING
    `);
    // Add occurrence_date to finance_payments if not already present
    await db.query(`ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS occurrence_date DATE`);
  } catch (_) { /* already exists */ }
  _assigneeColReady = true;
}

async function isFinanceAdmin(req) {
  const t = String(req.session?.userRole || req.session?.accountType || req.session?.user?.account_type || "").trim().toLowerCase();
  // Org owner + platform admins always have access.
  if (["organization", "admin", "mini admin", "super admin"].includes(t)) return true;
  // Manager, Supervisor, Teacher — allowed if explicitly granted the PayGira permission.
  if (["manager", "supervisor", "teacher"].includes(t)) {
    return userHasPermission(db, {
      userId: req.session.user?.user_id || req.session.userId || null,
      userRole: req.session.userRole || null,
      organizationId: req.session.organizationId || null,
      accountType: req.session.accountType || req.session.user?.account_type || null,
      userEmail: req.session.user?.email || null,
    }, "manage_paygira");
  }
  return false;
}

function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}

function buildFinancePaymentChargeBreakdown(amount, method, platformFeePercentage, taxAmount = 0) {
  return buildPlatformChargeBreakdown(amount, {
    platformFeePercentage,
    applyPlatformFee: isPlatformFeeMethod(method),
    taxAmount,
  });
}

const DEFAULT_FINANCE_CURRENCY = "USD";
const FALLBACK_FINANCE_CURRENCIES = [
  "USD", "EUR", "GBP", "GHS", "NGN", "KES", "ZAR", "UGX", "TZS", "RWF",
  "XAF", "XOF", "EGP", "MAD", "BWP", "ZMW", "CAD", "AUD", "NZD", "JPY",
  "CNY", "INR", "AED", "SAR", "BRL", "MXN", "CHF", "SEK", "NOK", "DKK",
];
const COUNTRY_TO_CURRENCY = {
  GH: "GHS", GHANA: "GHS",
  NG: "NGN", NIGERIA: "NGN",
  KE: "KES", KENYA: "KES",
  ZA: "ZAR", "SOUTH AFRICA": "ZAR",
  UG: "UGX", UGANDA: "UGX",
  TZ: "TZS", TANZANIA: "TZS",
  RW: "RWF", RWANDA: "RWF",
  CM: "XAF", CAMEROON: "XAF",
  SN: "XOF", SENEGAL: "XOF",
  CI: "XOF", "COTE DIVOIRE": "XOF", "COTE D'IVOIRE": "XOF", "IVORY COAST": "XOF",
  EG: "EGP", EGYPT: "EGP",
  MA: "MAD", MOROCCO: "MAD",
  BW: "BWP", BOTSWANA: "BWP",
  ZM: "ZMW", ZAMBIA: "ZMW",
  US: "USD", USA: "USD", "UNITED STATES": "USD",
  GB: "GBP", UK: "GBP", "UNITED KINGDOM": "GBP", ENGLAND: "GBP",
  EU: "EUR", FRANCE: "EUR", GERMANY: "EUR", ITALY: "EUR", SPAIN: "EUR",
  IE: "EUR", IRELAND: "EUR", NL: "EUR", NETHERLANDS: "EUR",
  CA: "CAD", CANADA: "CAD",
  AU: "AUD", AUSTRALIA: "AUD",
  NZ: "NZD", "NEW ZEALAND": "NZD",
  IN: "INR", INDIA: "INR",
  CN: "CNY", CHINA: "CNY",
  JP: "JPY", JAPAN: "JPY",
  AE: "AED", UAE: "AED", "UNITED ARAB EMIRATES": "AED",
  SA: "SAR", "SAUDI ARABIA": "SAR",
  BR: "BRL", BRAZIL: "BRL",
  MX: "MXN", MEXICO: "MXN",
  CH: "CHF", SWITZERLAND: "CHF",
  SE: "SEK", SWEDEN: "SEK",
  NO: "NOK", NORWAY: "NOK",
  DK: "DKK", DENMARK: "DKK",
};

let _financeCurrencyOptions = null;
let _financeCountryOptions = null;

function getCurrencyDisplayName(code) {
  try {
    const label = new Intl.DisplayNames(["en"], { type: "currency" }).of(code);
    return label || code;
  } catch (_) {
    return code;
  }
}

function getFinanceCurrencyOptions() {
  if (_financeCurrencyOptions) return _financeCurrencyOptions;
  let codes = [];
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      codes = Intl.supportedValuesOf("currency");
    }
  } catch (_) {
  }
  if (!Array.isArray(codes) || !codes.length) codes = FALLBACK_FINANCE_CURRENCIES.slice();
  const unique = Array.from(new Set(codes.map(normalizeCurrencyCode).filter(Boolean)));
  _financeCurrencyOptions = unique
    .map((code) => ({ code, name: getCurrencyDisplayName(code) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return _financeCurrencyOptions;
}

function getFinanceCountryOptions() {
  if (_financeCountryOptions) return _financeCountryOptions;
  _financeCountryOptions = getHolidayCountryOptions();
  return _financeCountryOptions;
}

function normalizeCountryValue(rawCountry) {
  return String(rawCountry || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCountryName(rawCountry, fallbackCode) {
  const options = getFinanceCountryOptions();
  const normalizedCountry = normalizeCountryValue(rawCountry);
  if (normalizedCountry) {
    const byName = options.find((option) => normalizeCountryValue(option.name) === normalizedCountry);
    if (byName) return byName.name;
  }
  const normalizedCode = String(fallbackCode || "").trim().toUpperCase();
  if (normalizedCode) {
    const byCode = options.find((option) => String(option.code || "").trim().toUpperCase() === normalizedCode);
    if (byCode) return byCode.name;
  }
  if (rawCountry) return String(rawCountry).trim();
  return "";
}

function isSupportedFinanceCurrency(code) {
  const normalized = normalizeCurrencyCode(code);
  if (!normalized) return false;
  return getFinanceCurrencyOptions().some((option) => option.code === normalized);
}

function resolveCurrencyFromCountry(rawCountry) {
  const normalized = String(rawCountry || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return COUNTRY_TO_CURRENCY[normalized] || null;
}

async function loadOrganizationProfile(orgId) {
  if (!orgId) return {};
  try {
    await ensureStripeConnectAccountSchema(db);
    const stripeSettings = await getStripeSettings(db).catch(() => ({ mode: 'test' }));
    const result = await db.query(
      `SELECT organization_name, organization_country, billing_provider, stripe_customer_id, stripe_connect_account_id, stripe_connect_account_id_test, stripe_connect_account_id_live
         FROM organizations
        WHERE organization_id = $1
        LIMIT 1`,
      [orgId]
    );
    const row = result.rows[0] || {};
    return {
      ...row,
      stripe_connect_account_id: getStripeConnectAccountId(row, stripeSettings.mode) || "",
    };
  } catch (_) {
    return {};
  }
}

async function resolveFinanceCurrency(req, orgId, pspSettings, orgCountry) {
  const savedCurrency = normalizeCurrencyCode(pspSettings && pspSettings.currency);
  if (savedCurrency && isSupportedFinanceCurrency(savedCurrency)) {
    const usdToCurrencyRate = await getUsdRate(savedCurrency);
    return {
      code: savedCurrency,
      locale: getLocaleForCurrency(savedCurrency),
      source: "saved",
      sourceLabel: "Saved organization currency",
      autoSelected: false,
      countryHint: orgCountry || null,
      usdToCurrencyRate: usdToCurrencyRate && usdToCurrencyRate > 0 ? usdToCurrencyRate : null,
    };
  }

  try {
    const detected = await getCurrencyProfileForRequest(req);
    const detectedCurrency = normalizeCurrencyCode(detected && detected.userCurrency);
    const usableDetection = detectedCurrency && isSupportedFinanceCurrency(detectedCurrency)
      && !(detected.detectionSource === "fallback" && detectedCurrency === DEFAULT_FINANCE_CURRENCY);
    if (usableDetection) {
      const usdToCurrencyRate = await getUsdRate(detectedCurrency);
      return {
        code: detectedCurrency,
        locale: getLocaleForCurrency(detectedCurrency),
        source: "location",
        sourceLabel: detected.countryCode
          ? `Auto-selected from your detected country (${detected.countryCode})`
          : "Auto-selected from your current location",
        autoSelected: true,
        countryHint: detected.countryCode || null,
        usdToCurrencyRate: usdToCurrencyRate && usdToCurrencyRate > 0 ? usdToCurrencyRate : null,
      };
    }
  } catch (_) {
  }

  const fallbackOrgCountry = orgCountry || (await loadOrganizationProfile(orgId)).organization_country || null;
  const orgCurrency = resolveCurrencyFromCountry(fallbackOrgCountry);
  if (orgCurrency && isSupportedFinanceCurrency(orgCurrency)) {
    const usdToCurrencyRate = await getUsdRate(orgCurrency);
    return {
      code: orgCurrency,
      locale: getLocaleForCurrency(orgCurrency),
      source: "organization-country",
      sourceLabel: fallbackOrgCountry
        ? `Auto-selected from your organization country (${fallbackOrgCountry})`
        : "Auto-selected from organization country",
      autoSelected: true,
      countryHint: fallbackOrgCountry,
      usdToCurrencyRate: usdToCurrencyRate && usdToCurrencyRate > 0 ? usdToCurrencyRate : null,
    };
  }

  return {
    code: DEFAULT_FINANCE_CURRENCY,
    locale: getLocaleForCurrency(DEFAULT_FINANCE_CURRENCY),
    source: "fallback",
    sourceLabel: "Defaulted to USD",
    autoSelected: true,
    countryHint: null,
    usdToCurrencyRate: 1,
  };
}

async function buildFinanceDisplayContext(req, orgId, pspSettingsArg, orgCountryArg) {
  const pspSettings = pspSettingsArg || await loadPspSettings(orgId);
  const financeCurrency = await resolveFinanceCurrency(req, orgId, pspSettings, orgCountryArg);
  const formatMoney = (value) => formatCurrencyAmount(value, financeCurrency.code, financeCurrency.locale);
  const formatUsdEquivalent = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (financeCurrency.code === DEFAULT_FINANCE_CURRENCY) return null;
    const rate = Number(financeCurrency.usdToCurrencyRate || 0);
    if (!rate || rate <= 0) return null;
    return formatCurrencyAmount(amount / rate, DEFAULT_FINANCE_CURRENCY, getLocaleForCurrency(DEFAULT_FINANCE_CURRENCY));
  };
  return {
    financeCurrency,
    currencyOptions: getFinanceCurrencyOptions(),
    formatMoney,
    formatUsdEquivalent,
  };
}

function parseMultiValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => String(value || "").trim()).filter(Boolean);
  }
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
  const schoolPublishableKey = String(pspSettings?.stripe_publishable_key || '').trim();
  const schoolSecretKey = String(pspSettings?.stripe_secret_key || '').trim();
  const connectedAccountId = String(orgProfile?.stripe_connect_account_id || '').trim();
  const hasSchoolStripeConfig = Boolean(schoolPublishableKey && schoolSecretKey);

  if (hasSchoolStripeConfig) {
    return {
      stripeOn: true,
      publishableKey: schoolPublishableKey,
      secretKey: schoolSecretKey,
      connectedAccountId,
      useConnectedDestinationCharge: false,
    };
  }

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
  const stripeOn = !!(s.stripe_publishable_key && s.stripe_secret_key) || !!options.stripeOn;
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

function buildCollectionDestinationLabel(account, stripeRuntime) {
  const destination = mapPayoutAccountTypeToCollectionDestination(account && account.account_type);
  if (destination === 'stripe') {
    if (stripeRuntime && stripeRuntime.connectedAccountId) return 'Stripe Payout Account';
    return 'Stripe';
  }
  if (destination === 'bank') {
    return account && (account.bank_name || account.business_name)
      ? `Bank Account — ${account.bank_name || account.business_name}`
      : 'Bank Account';
  }
  if (destination === 'momo') {
    return account && (account.momo_provider || account.business_name)
      ? `Mobile Money — ${account.momo_provider || account.business_name}`
      : 'Mobile Money';
  }
  return '';
}

async function resolveBillCollectionDestinations(database, orgId, orgProfileInput = null, pspSettingsInput = null) {
  const orgProfile = orgProfileInput && Object.keys(orgProfileInput).length
    ? orgProfileInput
    : await loadOrganizationProfile(orgId);
  const pspSettings = pspSettingsInput && Object.keys(pspSettingsInput).length
    ? pspSettingsInput
    : await loadPspSettings(orgId).catch(() => ({}));
  const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
  const connectedAccountId = String(orgProfile?.stripe_connect_account_id || '').trim();
  const payoutAccounts = (await database.query(
    `SELECT id, account_type, business_name, bank_name, momo_provider, is_primary
       FROM paystack_subaccounts
      WHERE organization_id = $1
      ORDER BY is_primary DESC, id ASC`,
    [orgId]
  )).rows;

  const primaryPayoutAccount = payoutAccounts.find((account) => account.is_primary) || payoutAccounts[0] || null;
  const options = [];

  if (primaryPayoutAccount) {
    const value = mapPayoutAccountTypeToCollectionDestination(primaryPayoutAccount.account_type);
    if (value) {
      options.push({
        value,
        label: buildCollectionDestinationLabel(primaryPayoutAccount, stripeRuntime),
      });
    }
  } else if (connectedAccountId || (stripeRuntime && stripeRuntime.stripeOn)) {
    options.push({
      value: 'stripe',
      label: connectedAccountId ? 'Stripe Payout Account' : 'Stripe',
    });
  }

  return {
    options,
    defaultValue: options[0] ? options[0].value : '',
  };
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
    payment_destination: ['stripe', 'cash', 'bank', 'momo'].includes(String(body.payment_destination || '').trim())
      ? String(body.payment_destination).trim()
      : 'stripe',
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

  // We must join through finance_bills to filter by year/term (those live on bill, not assignment).
  const where = ['a.organization_id = $1'];
  const params = [orgId];
  let i = 2;
  if (yr) { where.push(`b.school_year_id = $${i++}`); params.push(yr); }
  if (tm) { where.push(`b.term_id        = $${i++}`); params.push(tm); }
  const whereSql = where.join(' AND ');

  const totalsRows = await db.query(
    `SELECT a.amount, a.amount_paid, a.late_fee_applied, a.status,
            b.bill_type, b.recurrence, b.due_date, b.recurrence_end_date,
            b.term_id, b.exclude_non_school_days,
            tm.end_date AS term_end_date
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       LEFT JOIN terms tm ON tm.term_id = b.term_id
      WHERE ${whereSql}`,
    params
  );
  const scheduleContext = createBillScheduleContextLoader(db, orgId);
  const scheduledRows = await Promise.all(
    totalsRows.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
  );
  const totalSummary = scheduledRows.reduce((accumulator, assignment) => {
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

  return {
    totals: totalSummary,
    overpayments: credits.rows[0]?.overpayments || 0,
    recent: recent.rows,
    filters: { school_year_id: yr, term_id: tm },
  };
}

async function loadBills(orgId, filters = {}) {
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
      ORDER BY b.created_at DESC LIMIT 200`,
    params
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
        ORDER BY b.created_at DESC LIMIT 200`,
      params
    );
  });
  const billIds = r.rows.map((row) => row.bill_id);
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
  return applyScheduledBillRollups(r.rows, assignments).map((bill) => ({
    ...bill,
    assignee_ids: normalizeIdArray([
      ...(collectorIdsByBillId.get(String(bill.bill_id)) || []),
      bill.assignee_id,
    ]),
    target_class_ids: normalizeIdArray(bill.target_class_ids),
    target_student_ids: normalizeIdArray(bill.target_student_ids),
  }));
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
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,NOW(),$20
    )
    ON CONFLICT (payment_intent_id) DO UPDATE SET
      requested_amount = EXCLUDED.requested_amount,
      total_external_amount = EXCLUDED.total_external_amount,
      credit_applied_expected = EXCLUDED.credit_applied_expected,
      platform_fee_percentage = EXCLUDED.platform_fee_percentage,
      platform_fee_amount = EXCLUDED.platform_fee_amount,
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
    let totalPlatformFeeAmount = 0;

    if (creditApplied > 0) {
      for (const entry of effectiveEntries) {
        if (!(Number(entry.creditAmount || 0) > 0)) continue;
        await client.query(
          `INSERT INTO finance_payments
            (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
          ]
        );
      }
      await setStudentCreditBalance(client, pending.organization_id, row.student_id, Math.max(availableCredit - creditApplied, 0));
    }

    if (totalExternalAmount > 0) {
      for (const entry of effectiveEntries) {
        if (!(Number(entry.externalAmount || 0) > 0)) continue;
        const chargeBreakdown = buildFinancePaymentChargeBreakdown(entry.externalAmount, payMethod, platformFeePercentage);
        totalPlatformFeeAmount += chargeBreakdown.platformFeeAmount;
        await client.query(
          `INSERT INTO finance_payments
            (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_percentage, platform_fee_amount, tax_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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

  const assignmentRows = await db.query(
    `SELECT a.student_id, a.amount, a.amount_paid, a.late_fee_applied,
            b.bill_type, b.recurrence, b.due_date, b.recurrence_end_date,
            b.term_id, b.exclude_non_school_days,
            tm.end_date AS term_end_date
       FROM finance_bill_assignments a
       JOIN finance_bills b ON b.bill_id = a.bill_id
       LEFT JOIN terms tm ON tm.term_id = b.term_id
      WHERE ${assignmentWhere.join(' AND ')}`,
    params
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

  const students = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id,
            c.class_name,
            COALESCE(sc.amount,0) AS student_credit
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN finance_student_credits sc ON sc.student_id = s.student_id AND sc.organization_id = s.organization_id
      WHERE s.organization_id = $1
      ORDER BY s.last_name, s.first_name
      LIMIT 500`,
    [orgId]
  );
  return students.rows.map((row) => {
    const totals = totalsByStudentId[String(row.student_id)] || { total_billed: 0, total_paid: 0, outstanding: 0 };
    const studentCredit = Number(row.student_credit || 0);
    const outstanding = Number(totals.outstanding || 0);
    return {
      ...row,
      total_billed: Number(totals.total_billed || 0),
      total_paid: Number(totals.total_paid || 0),
      outstanding,
      student_credit: studentCredit,
      net_outstanding: Math.max(outstanding - studentCredit, 0),
    };
  });
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

async function loadClassesAndStudents(orgId) {
  const classes = await db.query(
    `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name`,
    [orgId]
  );
  const students = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
      WHERE s.organization_id = $1
      ORDER BY s.last_name, s.first_name`,
    [orgId]
  );
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
  const enrolledClassLinks = await db.query(
    `SELECT DISTINCT ec.class_id, e.school_year_id, e.term_id
       FROM enrollments e
       JOIN enrolled_classes ec ON ec.enrollment_id = e.enrollment_id
      WHERE e.organization_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const enrolledStudentLinks = await db.query(
    `SELECT DISTINCT es.student_id, e.school_year_id, e.term_id
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
      WHERE e.organization_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const employees = await db.query(
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
  ).catch(() => ({ rows: [] }));
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
  const scheduleEnd = getRecurringScheduleEnd(row);
  const scheduledOccurrenceDates = await getScheduledOccurrenceDates({
    ...row,
    due_date: normalizedDueDate,
    recurrence_end_date: scheduleEnd,
  }, getCalendarContext);
  const scheduledCount = Math.max(scheduledOccurrenceDates.length, 1);
  const scheduledBilledTotal = Number(row?.amount || 0) * scheduledCount;
  const amountPaid = Number(row?.amount_paid || 0);
  const lateFeeApplied = Number(row?.late_fee_applied || 0);
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

async function loadCollectionSignoffHistory(orgId) {
  const result = await db.query(
    `SELECT h.signoff_id, h.bill_id, h.class_id,
            h.occurrence_date::text AS occurrence_date,
            h.scope_key, h.signed_by_user_id, h.signed_by_name,
            h.signer_role, h.student_count, h.total_collected, h.signed_at,
            b.title AS bill_title,
            c.class_name,
            u.first_name AS signer_first_name,
            u.last_name AS signer_last_name
       FROM finance_collection_signoffs h
       JOIN finance_bills b ON b.bill_id = h.bill_id
       LEFT JOIN classes c ON c.class_id = NULLIF(h.class_id, 0)
       LEFT JOIN users u ON u.user_id = h.signed_by_user_id
      WHERE h.organization_id = $1
      ORDER BY h.signed_at DESC
      LIMIT 200`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
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
  const chargeBreakdown = buildFinancePaymentChargeBreakdown(amt, requested, platformFeePercentage);

  const paymentInsert = await client.query(
    `INSERT INTO finance_payments
      (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by, occurrence_date, platform_fee_percentage, platform_fee_amount, tax_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
      const snapshot = report.snapshot || {};
      const students = snapshot.students || [];
      const rows = students.map((student) => `
        <tr>
          <td>${student.student_name}</td>
          <td>${student.class_name || '—'}</td>
          <td>${student.guardian_name || 'No guardian'}</td>
          <td>${student.guardian_email || student.guardian_phone || 'No contact'}</td>
          <td>${display.formatMoney(student.total_billed || 0)}</td>
          <td>${display.formatMoney(student.total_paid || 0)}</td>
          <td>${display.formatMoney(student.outstanding || 0)}</td>
          <td>${student.primary_status || 'overdue'}</td>
        </tr>`).join("");
      res.send(`<!DOCTYPE html><html><head><title>${report.title}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;font-size:12px}th{background:#f5f5f5;text-align:left}</style></head><body><h1>${report.title}</h1><p>Generated ${new Date(report.created_at).toLocaleString()}</p><p>Total Outstanding: ${display.formatMoney(report.total_outstanding || 0)}</p><table><thead><tr><th>Student</th><th>Class</th><th>Guardian</th><th>Contact</th><th>Billed</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No records.</td></tr>'}</tbody></table></body></html>`);
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
      const display = await buildFinanceDisplayContext(req, orgId, null, orgProfile.organization_country);
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
      const orgProfile = await loadOrganizationProfile(orgId);
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
        if (k === 'organization_country') return;
        if (k === 'currency') {
          const normalized = normalizeCurrencyCode(v);
          if (normalized && isSupportedFinanceCurrency(normalized)) next[k] = normalized;
          return;
        }
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
      if (provider === 'general') {
        const selectedCountry = resolveCountryName(req.body && req.body.organization_country, null);
        if (selectedCountry && selectedCountry !== String(orgProfile.organization_country || '').trim()) {
          await db.query(
            `UPDATE organizations SET organization_country = $1 WHERE organization_id = $2`,
            [selectedCountry, orgId]
          ).catch(() => null);
        }
      }
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
      // Cached loaders — 30s TTL with background refresh. Writes invalidate.
      const [templates, refs, pspSettings, orgProfile, signoffHistory] = await Promise.all([
        cachedLoad(orgId, "templates", null, () => loadTemplates(orgId)),
        cachedLoad(orgId, "refs", null, () => loadClassesAndStudents(orgId)),
        cachedLoad(orgId, "psp", null, () => loadPspSettings(orgId)),
        cachedLoad(orgId, "orgProfile", null, () => loadOrganizationProfile(orgId)),
        cachedLoad(orgId, "signoffHistory", null, () => loadCollectionSignoffHistory(orgId)),
      ]);
      const currentAcademic = getCurrentAcademicContext(refs);
      const overviewFilters = {
        school_year_id: req.query.year || currentAcademic.schoolYearId || null,
        term_id: req.query.term || ((!req.query.year && !req.query.term) ? (currentAcademic.termId || null) : null),
      };
      const billListFilters = section === "bills"
        ? {
            school_year_id: req.query.billYear || currentAcademic.schoolYearId || null,
            term_id: req.query.billTerm || ((!req.query.billYear && !req.query.billTerm) ? (currentAcademic.termId || null) : null),
          }
        : {};
      const studentBillingFilters = section === "students"
        ? {
            school_year_id: req.query.studentYear || currentAcademic.schoolYearId || null,
            term_id: req.query.studentTerm || ((!req.query.studentYear && !req.query.studentTerm) ? (currentAcademic.termId || null) : null),
          }
        : {};
      const [studentBilling, bills, overview, chargeCards, paystackSubaccountsResult] = await Promise.all([
        cachedLoad(orgId, "studentBilling", studentBillingFilters, () => loadStudentBilling(orgId, studentBillingFilters)),
        cachedLoad(orgId, "bills", billListFilters, () => loadBills(orgId, billListFilters)),
        cachedLoad(orgId, "overview", overviewFilters, () => loadOverviewStats(orgId, overviewFilters)),
        cachedLoad(orgId, "chargeCards", orgProfile.billing_provider || null, () => getOrgChargeCards(db, orgId, orgProfile.billing_provider || null)),
        cachedLoad(orgId, "paystackSubaccounts", null, () => db.query(
          `SELECT id, account_type, business_name, account_number, bank_name, bank_code,
                  momo_provider, momo_number, account_holder_name, is_primary
           FROM paystack_subaccounts
           WHERE organization_id = $1
           ORDER BY is_primary DESC, id ASC`,
          [orgId]
        )),
      ]);
      const paystackSubaccounts = paystackSubaccountsResult.rows;

      // SPA / browser cache hint: lets the SPA router show last snapshot
      // immediately on back-navigation while a fresh GET runs in background.
      res.set("Cache-Control", "private, max-age=5, stale-while-revalidate=30");
      res.set("Vary", "Cookie");

      const platformStripeKey = await getActiveStripePublicKey();

      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country);
      const financeCountry = resolveCountryName(orgProfile.organization_country, display.financeCurrency.countryHint);
      let arrearsData = null;
      let arrearsReports = [];
      let arrearsPresets = [];
      if (section === "arrears") {
        await ensureArrearsSchema();
        const defaultArrearsSchoolYears = req.query.schoolYearIds || currentAcademic.schoolYearId || null;
        const defaultArrearsTerms = req.query.termIds || ((!req.query.schoolYearIds && !req.query.termIds) ? (currentAcademic.termId || null) : null);
        const loadedArrears = await loadArrearsManagementData(orgId, {
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
        });
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
        arrearsReports = await loadArrearsReports(orgId);
        arrearsPresets = await loadArrearsPresets(orgId);
      }

      // Mask sensitive secrets before sending to view
      const safePsp = maskPspSecrets(pspSettings);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      const collectionDestinations = await resolveBillCollectionDestinations(db, orgId, orgProfile, pspSettings);
      allowedMethods.currency = display.financeCurrency.code;
      safePsp.currency = safePsp.currency || display.financeCurrency.code;
      if (!safePsp.stripe_publishable_key && stripeRuntime.publishableKey) {
        safePsp.stripe_publishable_key = stripeRuntime.publishableKey;
      }

      res.render("account/finance", {
        title: "Finance & Billing",
        section,
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
        arrearsData,
        arrearsReports,
        arrearsPresets,
        chargeCards,
        paystackSubaccounts,
        collectionDestinationOptions: collectionDestinations.options,
        defaultCollectionDestination: collectionDestinations.defaultValue,
        platformStripeKey,
        createBillDraft,
        billListFilters,
        studentBillingFilters,
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
      const collectionDestinations = await resolveBillCollectionDestinations(client, orgId);
      const allowedDestinationValues = new Set(collectionDestinations.options.map((option) => option.value));
      const destination = allowedDestinationValues.has(String(payment_destination || '').trim())
        ? String(payment_destination).trim()
        : collectionDestinations.defaultValue;
      if (!destination) {
        throw new PaygiraRequestError('Set a primary payout account in Account Settings before creating a bill.');
      }

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
      const chargeBreakdown = buildFinancePaymentChargeBreakdown(amt, normalizedMethod, platformFeePercentage);

      await db.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by, platform_fee_percentage, platform_fee_amount, tax_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          normalizedMethod, reference || null, notes || null,
          req.session.user?.user_id || null,
          chargeBreakdown.platformFeePercentage,
          chargeBreakdown.platformFeeAmount,
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

      const collectionDestinations = await resolveBillCollectionDestinations(client, orgId);
      const allowedDestinationValues = new Set(collectionDestinations.options.map((option) => option.value));
      const validDest = allowedDestinationValues.has(requestedDestination)
        ? requestedDestination
        : collectionDestinations.defaultValue;
      if (!validDest) {
        throw new PaygiraRequestError('Set a primary payout account in Account Settings before updating this bill.');
      }

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

      // All bills assigned to me as collector/overseer (via junction table OR legacy assignee_id)
      const billsR = await db.query(
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
      );

      // All outstanding per-student assignments under my bills
      const assignmentsR = await db.query(
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
      );
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

      // Aggregate totals across my assigned bills
      const stats = {
        bills:        bills.length,
        students:     assignments.length,
        billed:       assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_billed_total || 0), 0),
        collected:    assignments.reduce((sum, assignment) => sum + Number(assignment.amount_paid || 0), 0),
        outstanding:  assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_outstanding_total || 0), 0),
      };

      const pspSettings = await loadPspSettings(orgId);
      const orgProfile = await loadOrganizationProfile(orgId);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country);
      allowedMethods.currency = display.financeCurrency.code;

      res.render("account/myPaygira", {
        title: "My PayGira",
        bills,
        assignments,
        stats,
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
      await ensureFinanceSchema();
      await ensureGuardianCardsSchema();

      // Children linked to this guardian (covers both legacy guardians + guardian_students)
      const kidsR = await database.query(
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
      );
      const children = kidsR.rows;
      const studentIds = children.map(c => c.student_id);
      const studentCreditMap = await loadStudentCreditMap(database, orgId, studentIds);
      const hydratedChildren = children.map((child) => ({
        ...child,
        student_credit: Number(studentCreditMap.get(String(child.student_id)) || 0),
      }));

      // All bill assignments for those children
      let assignments = [];
      let payments = [];
      let occurrencePaymentsByAssignment = {};
      if (studentIds.length) {
        const r = await database.query(
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
        );
        const scheduleContext = createBillScheduleContextLoader(database, orgId);
        assignments = await Promise.all(
          r.rows.map((row) => enrichScheduledAssignment(row, scheduleContext))
        );

        if (assignments.length) {
          const assignmentIds = assignments.map((assignment) => assignment.assignment_id);
          const occurrencePaymentsR = await database.query(
            `SELECT assignment_id, occurrence_date::text AS occurrence_date, COALESCE(SUM(amount), 0) AS paid_amount
               FROM finance_payments
              WHERE organization_id=$1 AND assignment_id = ANY($2::int[]) AND occurrence_date IS NOT NULL
              GROUP BY assignment_id, occurrence_date`,
            [orgId, assignmentIds]
          );
          occurrencePaymentsByAssignment = occurrencePaymentsR.rows.reduce((accumulator, row) => {
            const assignmentKey = String(row.assignment_id);
            if (!accumulator[assignmentKey]) accumulator[assignmentKey] = {};
            accumulator[assignmentKey][row.occurrence_date] = Number(row.paid_amount || 0);
            return accumulator;
          }, {});
          assignments = assignments.map((assignment) => ({
            ...assignment,
            occurrence_payments: occurrencePaymentsByAssignment[String(assignment.assignment_id)] || {},
            student_credit: Number(studentCreditMap.get(String(assignment.student_id)) || 0),
          }));
        }

        const p = await database.query(
          `SELECT p.payment_id, p.amount, p.method, p.received_at, p.reference,
                  s.first_name, s.last_name, b.title AS bill_title
             FROM finance_payments p
             LEFT JOIN students s ON s.student_id = p.student_id
             LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
            WHERE p.organization_id=$1 AND p.student_id = ANY($2::int[])
            ORDER BY p.received_at DESC LIMIT 15`,
          [orgId, studentIds]
        );
        payments = p.rows;
      }

      const visibleAssignments = assignments.filter((assignment) => {
        const outstandingAmount = Number(
          assignment.scheduled_outstanding_total != null
            ? assignment.scheduled_outstanding_total
            : Math.max(Number(assignment.amount || 0) + Number(assignment.late_fee_applied || 0) - Number(assignment.amount_paid || 0), 0)
        );
        return outstandingAmount > 0;
      });

      // Saved payment cards on file (last 4 only — never PAN)
      const cardsR = await database.query(
        `SELECT card_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id
           FROM guardian_payment_methods
          WHERE guardian_id=$1 AND organization_id=$2
          ORDER BY is_default DESC, created_at DESC`,
        [guardianId, orgId]
      );

      // Aggregate per-student totals
      const totals = {
        billed:      assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_billed_total || 0), 0),
        paid:        assignments.reduce((sum, assignment) => sum + Number(assignment.amount_paid || 0), 0),
        outstanding: assignments.reduce((sum, assignment) => sum + Number(assignment.scheduled_outstanding_total || 0), 0),
        credit:      hydratedChildren.reduce((sum, child) => sum + Number(child.student_credit || 0), 0),
      };
      totals.net_outstanding = Math.max(Number(totals.outstanding || 0) - Number(totals.credit || 0), 0);

      // Guardian profile for header
      const gp = await database.query(
        `SELECT first_name, last_name, image_url FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );

      // Payment options available to this guardian (set by the school)
      const pspSettings = await loadPspSettings(orgId);
      const maskedPsp = maskPspSecrets(pspSettings);
      const orgProfile = await loadOrganizationProfile(orgId);
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      const stripeCheckoutConfig = buildGuardianStripeCheckoutConfig(allowedMethods.stripeMethods);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country);
      allowedMethods.currency = display.financeCurrency.code;
      maskedPsp.currency = maskedPsp.currency || display.financeCurrency.code;
      if (!maskedPsp.stripe_publishable_key && stripeRuntime.publishableKey) {
        maskedPsp.stripe_publishable_key = stripeRuntime.publishableKey;
      }

      res.render("guardian/paygira", {
        title: "PayGira — Pay Bills",
        guardian: gp.rows[0] || {},
        children: hydratedChildren,
        assignments: visibleAssignments,
        payments,
        cards: cardsR.rows,
        totals,
        pspSettings: maskedPsp,
        allowedMethods,
        stripeCatalog: STRIPE_METHOD_CATALOG,
        stripeCheckoutConfig,
        financeCurrency: display.financeCurrency,
        formatMoney: display.formatMoney,
        money,
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
      const stripeRuntime = await resolveFinanceStripeRuntime(orgId, pspSettings, orgProfile);
      const allowedMethods = computeAllowedMethods(pspSettings, { stripeOn: stripeRuntime.stripeOn });
      if (!allowedMethods.stripeOn) {
        return res.status(400).json({ success: false, message: 'Stripe is not configured for this school.' });
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
      const chargeBreakdown = buildFinancePaymentChargeBreakdown(plan.totalExternalAmount, 'stripe', platformFeePercentage);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country);
      const currencyCode = String(display.financeCurrency.code || 'USD').toLowerCase();
      const stripeCheckoutConfig = buildGuardianStripeCheckoutConfig(allowedMethods.stripeMethods);
      const stripe = getFinanceStripeClient(stripeRuntime);

      // ── Stripe Customer: get or create so we can attach payment methods ────
      const gpRow = await client.query(
        `SELECT first_name, last_name, email, stripe_customer_id
           FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );
      const guardianProfile = gpRow.rows[0] || {};
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
          // Non-fatal — continue without customer (card won't be saved for reuse)
        }
      }

      // ── Saved card: look up Stripe PM id if the guardian chose a saved card ─
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
        },
        description: `PayGira ${plan.row.bill_title || 'Bill'} · Assignment ${plan.row.assignment_id}`,
      };
      if (stripeRuntime.useConnectedDestinationCharge && stripeRuntime.connectedAccountId) {
        piParams.transfer_data = { destination: stripeRuntime.connectedAccountId };
        const applicationFeeAmount = Math.round(Number(chargeBreakdown.platformFeeAmount || 0) * 100);
        if (applicationFeeAmount > 0) {
          piParams.application_fee_amount = applicationFeeAmount;
        }
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
      return res.status(500).json({ success: false, message: 'Unable to initialize Stripe payment.' });
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

    if (!paymentIntentId) {
      req.flash && req.flash('error', 'Stripe did not return a valid payment session.');
      return res.redirect('/guardian/paygira');
    }

    try {
      const result = await finalizePendingGuardianStripePayment(database, paymentIntentId);
      req.session.guardianPaygiraStripeIntentId = null;

      if (result.status === 'completed') {
        const orgProfile = await loadOrganizationProfile(orgId);
        const display = await buildFinanceDisplayContext(req, orgId, await loadPspSettings(orgId), orgProfile.organization_country);
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
      const secretRows = await database.query(
        `SELECT organization_id,
                data->>'stripe_webhook_secret' AS stripe_webhook_secret,
                data->>'stripe_secret_key' AS stripe_secret_key
           FROM finance_psp_settings
          WHERE COALESCE(data->>'stripe_webhook_secret', '') <> ''
            AND COALESCE(data->>'stripe_secret_key', '') <> ''`
      );

      let lastError = null;
      for (const row of secretRows.rows) {
        try {
          const stripe = getSchoolStripeClient({ stripe_secret_key: row.stripe_secret_key });
          event = stripe.webhooks.constructEvent(req.body, sig, row.stripe_webhook_secret);
          break;
        } catch (error) {
          lastError = error;
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
    const { assignment_id, amount, card_id, method, occurrence_date, occurrence_dates, apply_credit } = req.body;
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
      let totalPlatformFeeAmount = 0;

      if (creditApplied > 0) {
        for (const entry of paymentEntries) {
          if (!(Number(entry.creditAmount || 0) > 0)) continue;
          await client.query(
            `INSERT INTO finance_payments
              (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
            ]
          );
        }
        await setStudentCreditBalance(client, orgId, row.student_id, availableCredit - creditApplied);
      }

      if (totalExternalAmount > 0) {
        if (isRecurringBill) {
          for (const entry of paymentEntries) {
            if (!(Number(entry.externalAmount || 0) > 0)) continue;
            const chargeBreakdown = buildFinancePaymentChargeBreakdown(entry.externalAmount, payMethod, platformFeePercentage);
            totalPlatformFeeAmount += chargeBreakdown.platformFeeAmount;
            await client.query(
              `INSERT INTO finance_payments
                (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_percentage, platform_fee_amount, tax_amount)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
                chargeBreakdown.taxAmount,
              ]
            );
          }
        } else {
          const chargeBreakdown = buildFinancePaymentChargeBreakdown(totalExternalAmount, payMethod, platformFeePercentage);
          totalPlatformFeeAmount += chargeBreakdown.platformFeeAmount;
          await client.query(
            `INSERT INTO finance_payments
              (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, occurrence_date, platform_fee_percentage, platform_fee_amount, tax_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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

  // ===================================================================
  //  GUARDIAN — Saved Payment Cards (PayGira wallet)
  //  IMPORTANT: we never store a raw PAN. Only brand, last4, holder, exp.
  //  Replace the storage layer with a tokenized PSP (Stripe) in prod.
  // ===================================================================
  guardianCardAddPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    try {
      await ensureGuardianCardsSchema();
      const { card_number, holder_name, exp_month, exp_year, brand, child_student_id, set_default } = req.body;
      const digits = String(card_number || "").replace(/\D/g, "");
      if (digits.length < 12 || digits.length > 19) {
        req.flash && req.flash("error", "Invalid card number.");
        return res.redirect("/guardian/settings#cards");
      }
      const last4 = digits.slice(-4);
      const inferredBrand = (brand && String(brand).trim()) || inferCardBrand(digits);
      const mm = parseInt(exp_month, 10) || null;
      const yy = parseInt(exp_year, 10) || null;
      const childId = parseInt(child_student_id, 10) || null;

      // If child specified, verify this guardian is linked to that student
      if (childId) {
        const own = await database.query(
          `SELECT 1 FROM students s
            WHERE s.student_id=$1 AND s.organization_id=$2
              AND (
                EXISTS (SELECT 1 FROM guardians g
                         WHERE g.student_id=s.student_id AND g.guardian_id=$3 AND g.organization_id=$2)
                OR EXISTS (SELECT 1 FROM guardian_students gs
                         WHERE gs.student_id=s.student_id AND gs.guardian_id=$3)
              )
            LIMIT 1`,
          [childId, orgId, guardianId]
        );
        if (!own.rows.length) {
          req.flash && req.flash("error", "Selected child is not linked to your account.");
          return res.redirect("/guardian/settings#cards");
        }
      }

      // Make this card default if it's the first one or user asked for it
      const existing = await database.query(
        `SELECT COUNT(*)::int AS n FROM guardian_payment_methods WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );
      const makeDefault = !!set_default || existing.rows[0].n === 0;
      if (makeDefault) {
        await database.query(
          `UPDATE guardian_payment_methods SET is_default=false
            WHERE guardian_id=$1 AND organization_id=$2`,
          [guardianId, orgId]
        );
      }
      await database.query(
        `INSERT INTO guardian_payment_methods
          (guardian_id, organization_id, brand, last4, holder_name, exp_month, exp_year, is_default, student_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [guardianId, orgId, inferredBrand, last4, holder_name || null, mm, yy, makeDefault, childId]
      );
      req.flash && req.flash("success", `Card •••• ${last4} added securely.`);
      await logPaygira(req, {
        actionType: "Saved Card",
        recordType: "Payment Method",
        recordId: null,
        recordLabel: `${inferredBrand} •••• ${last4}`,
        description: `Guardian added saved card ${inferredBrand} •••• ${last4}${makeDefault ? ' (default)' : ''}.`,
        changedFields: [
          { field: "Brand", value: inferredBrand },
          { field: "Last 4", value: last4 },
          { field: "Default", value: makeDefault ? 'Yes' : 'No' },
        ],
      });
    } catch (e) {
      console.error("[guardianCardAddPost]", e);
      req.flash && req.flash("error", "Could not save card: " + e.message);
    }
    res.redirect("/guardian/settings#cards");
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
                 o.organization_country
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
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, row.organization_country);
      const platformFeeSettings = await getPlatformFeeSettings(database);

      // Payment history for this assignment
      const pays = await database.query(
        `SELECT amount, method, reference, received_at,
                COALESCE(platform_fee_percentage, 0) AS platform_fee_percentage,
                COALESCE(platform_fee_amount, 0) AS platform_fee_amount,
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
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, row.organization_country);

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

