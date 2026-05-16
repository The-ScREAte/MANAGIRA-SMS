// controllers/financeController.js
// PayGira — Finance & Billing Management — multi-tenant scoped by organization_id.
// All queries filter by req.session.organizationId. The page is admin-only.

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const db = require("../config/db");
const { userHasPermission } = require("../middleware/permissionMiddleware");
const { logOrganizationActivity } = require("../utils/activityLog");
const { getHolidayCountryOptions } = require("../utils/attendanceCalendar");
const { sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");
const {
  getCurrencyProfileForRequest,
  getLocaleForCurrency,
  getUsdRate,
  normalizeCurrencyCode,
  formatCurrencyAmount,
} = require("../utils/currencyLocalization");
const { getOrgChargeCards } = require("../utils/orgChargeCards");
const { ensurePaymentProviderSchema } = require("../utils/paymentProviderSchema");

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
    const result = await db.query(
      `SELECT organization_name, organization_country
         FROM organizations
        WHERE organization_id = $1
        LIMIT 1`,
      [orgId]
    );
    return result.rows[0] || {};
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

// Given a school's PSP settings, return the methods parents/staff are allowed to use.
function computeAllowedMethods(pspSettings) {
  const s = pspSettings || {};
  const stripeOn = !!(s.stripe_publishable_key && s.stripe_secret_key);
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

  const totals = await db.query(
    `SELECT
       COALESCE(SUM(a.amount),0)::numeric                                                 AS total_billed,
       COALESCE(SUM(a.amount_paid),0)::numeric                                            AS total_collected,
       COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0)::numeric AS outstanding,
       COUNT(*) FILTER (WHERE a.status = 'overdue')::int                                  AS overdue_count,
       COUNT(*)::int                                                                      AS total_assignments
     FROM finance_bill_assignments a
     JOIN finance_bills b ON b.bill_id = a.bill_id
     WHERE ${whereSql}`,
    params
  );

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
    totals: totals.rows[0] || {},
    overpayments: credits.rows[0]?.overpayments || 0,
    recent: recent.rows,
    filters: { school_year_id: yr, term_id: tm },
  };
}

async function loadBills(orgId) {
  const r = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS assigned_count,
            (SELECT COALESCE(SUM(a.amount),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id)      AS total_amount,
            (SELECT COALESCE(SUM(a.amount_paid),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS total_paid,
            u.first_name AS assignee_first_name,
            u.last_name  AS assignee_last_name,
            u.account_type AS assignee_role,
            sy.year_label,
            tm.term_name
       FROM finance_bills b
       LEFT JOIN users        u  ON u.user_id  = b.assignee_id
       LEFT JOIN school_years sy ON sy.id      = b.school_year_id
       LEFT JOIN terms        tm ON tm.term_id = b.term_id
      WHERE b.organization_id = $1
      ORDER BY b.created_at DESC LIMIT 200`,
    [orgId]
  ).catch(async () => {
    // Fallback if year/term columns are missing on legacy schemas
    return db.query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS assigned_count,
              (SELECT COALESCE(SUM(a.amount),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id)      AS total_amount,
              (SELECT COALESCE(SUM(a.amount_paid),0) FROM finance_bill_assignments a WHERE a.bill_id = b.bill_id) AS total_paid,
              u.first_name AS assignee_first_name,
              u.last_name  AS assignee_last_name,
              u.account_type AS assignee_role
         FROM finance_bills b
         LEFT JOIN users u ON u.user_id = b.assignee_id
        WHERE b.organization_id = $1
        ORDER BY b.created_at DESC LIMIT 200`,
      [orgId]
    );
  });
  return r.rows;
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

async function loadStudentBilling(orgId) {
  const r = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id,
            c.class_name,
            COALESCE(SUM(a.amount),0)        AS total_billed,
            COALESCE(SUM(a.amount_paid),0)   AS total_paid,
            COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0) AS outstanding
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN finance_bill_assignments a ON a.student_id = s.student_id AND a.organization_id = s.organization_id
      WHERE s.organization_id = $1
      GROUP BY s.student_id, c.class_name
      ORDER BY s.last_name, s.first_name
      LIMIT 500`,
    [orgId]
  );
  return r.rows;
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
    `SELECT term_id, term_name AS name, school_year_id, current
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
  const employees = await db.query(
    `SELECT user_id, first_name, last_name, account_type
       FROM users
      WHERE organization_id = $1
        AND account_type IN ('Manager','Supervisor','Teacher')
        AND (on_hold IS NULL OR on_hold = false)
      ORDER BY last_name, first_name`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const classMap = new Map();
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
  const hydratedClasses = classes.rows.map((row) => {
    const linked = classMap.get(String(row.class_id || ''));
    return {
      ...row,
      school_year_ids: linked ? Array.from(linked.schoolYearIds) : [],
      term_ids: linked ? Array.from(linked.termIds) : [],
    };
  });
  return { classes: hydratedClasses, students: students.rows, years: years.rows, terms: terms.rows, employees: employees.rows };
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

function recalcAssignmentStatus(amount, late, paid, dueDate) {
  const total = Number(amount) + Number(late || 0);
  const p = Number(paid || 0);
  if (p >= total && total > 0) return "paid";
  if (p > 0) return "partial";
  if (dueDate && new Date(dueDate) < new Date()) return "overdue";
  return "pending";
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
        const ok = await sendEmailSafely({ to: recipientEmail, subject, html }, "Fee Recovery");
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
      const [bills, studentBilling, templates, refs, pspSettings, orgProfile] = await Promise.all([
        loadBills(orgId),
        loadStudentBilling(orgId),
        loadTemplates(orgId),
        loadClassesAndStudents(orgId),
        loadPspSettings(orgId),
        loadOrganizationProfile(orgId),
      ]);
      const chargeCards = await getOrgChargeCards(db, orgId, orgProfile.billing_provider || null);
      const currentAcademic = getCurrentAcademicContext(refs);
      const overviewFilters = {
        school_year_id: req.query.year || currentAcademic.schoolYearId || null,
        term_id: req.query.term || ((!req.query.year && !req.query.term) ? (currentAcademic.termId || null) : null),
      };
      const overview = await loadOverviewStats(orgId, overviewFilters);

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
      const allowedMethods = computeAllowedMethods(pspSettings);
      allowedMethods.currency = display.financeCurrency.code;
      safePsp.currency = safePsp.currency || display.financeCurrency.code;

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
        arrearsData,
        arrearsReports,
        arrearsPresets,
        chargeCards,
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
    try {
      await ensureFinanceSchema();
      const {
        title, description, amount, bill_type, recurrence,
        late_fee_amount, late_fee_after_days,
        applies_to, school_year_id, term_id, due_date,
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
      const destination = ['stripe','cash','bank','momo'].includes(String(payment_destination))
        ? payment_destination : 'stripe';

      const amt = Number(amount || 0);
      const insert = await db.query(
        `INSERT INTO finance_bills
         (organization_id, title, description, amount, bill_type, recurrence,
          late_fee_amount, late_fee_after_days, applies_to, school_year_id, term_id, due_date,
          accepts_card, accepts_cash, accepts_transfer, notify_email, notify_sms, status, created_by, assignee_id, payment_destination)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING bill_id`,
        [orgId, title, description || null, amt, bill_type || 'one_time', recurrence || null,
          Number(late_fee_amount || 0), Number(late_fee_after_days || 7),
          applies_to || 'school',
          school_year_id || null, term_id || null,
          due_date || null,
          !!accepts_card, !!accepts_cash, !!accepts_transfer,
          !!notify_email, !!notify_sms,
          status === 'draft' ? 'draft' : 'active',
          req.session.user?.user_id || null, assignee_id, destination]
      );
      const billId = insert.rows[0].bill_id;

      // Sync collectors junction table
      if (assigneeList.length > 0) {
        await db.query(
          `INSERT INTO finance_bill_collectors (bill_id, user_id, organization_id)
           SELECT $1, unnest($2::int[]), $3
           ON CONFLICT (bill_id, user_id) DO NOTHING`,
          [billId, assigneeList, orgId]
        );
      }

      // Resolve student set
      let studentRows = [];
      if (applies_to === 'students' && target_student_ids) {
        const ids = (Array.isArray(target_student_ids) ? target_student_ids : [target_student_ids])
          .map(x => parseInt(x, 10)).filter(Boolean);
        if (ids.length) {
          const r = await db.query(`SELECT student_id FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])`, [orgId, ids]);
          studentRows = r.rows;
        }
      } else if (applies_to === 'classes' && target_class_ids) {
        const ids = (Array.isArray(target_class_ids) ? target_class_ids : [target_class_ids])
          .map(x => parseInt(x, 10)).filter(Boolean);
        if (ids.length) {
          const r = await db.query(`SELECT student_id FROM students WHERE organization_id = $1 AND class_id = ANY($2::int[])`, [orgId, ids]);
          studentRows = r.rows;
        }
      } else {
        const r = await db.query(`SELECT student_id FROM students WHERE organization_id = $1`, [orgId]);
        studentRows = r.rows;
      }

      if (studentRows.length && status !== 'draft') {
        const values = [];
        const params = [];
        studentRows.forEach((s, i) => {
          const baseIdx = i * 4;
          values.push(`($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4})`);
          params.push(billId, orgId, s.student_id, amt);
        });
        await db.query(
          `INSERT INTO finance_bill_assignments (bill_id, organization_id, student_id, amount)
           VALUES ${values.join(",")}
           ON CONFLICT (bill_id, student_id) DO NOTHING`,
          params
        );
      }

      req.flash("success", `Bill created and assigned to ${studentRows.length} student(s).`);
      await logPaygira(req, {
        actionType: "Created",
        recordType: "Bill",
        recordId: billId,
        recordLabel: title,
        description: `Created bill "${title}" ($${amt.toFixed(2)}) — type: ${bill_type || 'one_time'}, applies to ${applies_to || 'school'}, ${studentRows.length} student(s) assigned, destination: ${destination}.`,
        changedFields: [
          { field: "Amount", value: `$${amt.toFixed(2)}` },
          { field: "Bill Type", value: bill_type || 'one_time' },
          { field: "Audience", value: applies_to || 'school' },
          { field: "Assignments", value: String(studentRows.length) },
          { field: "Destination", value: destination },
          { field: "Status", value: status === 'draft' ? 'draft' : 'active' },
        ],
      });
    } catch (e) {
      console.error("[billCreate]", e);
      req.flash("error", "Could not create bill: " + e.message);
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

      await db.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          method || 'cash', reference || null, notes || null,
          req.session.user?.user_id || null]
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
      req.flash("success", credit > 0 ? `Payment recorded. ${display.formatMoney(credit)} added as credit.` : "Payment recorded.");
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
    const {
      title, description, amount, due_date,
      late_fee_amount, late_fee_after_days,
      assignee_ids: rawAids,
      assignee_id: rawAid,
      bill_type, recurrence,
      school_year_id, term_id,
      payment_destination,
      accepts_card, accepts_cash, accepts_transfer,
      notify_email, notify_sms,
      status,
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
    const validDest = ['stripe','cash','bank','momo'].includes(String(payment_destination)) ? payment_destination : null;
    const validType = ['one_time','recurring','installment'].includes(String(bill_type)) ? bill_type : null;
    const validRec = ['daily','weekly','monthly','term','year'].includes(String(recurrence)) ? recurrence : null;
    const validStatus = ['active','draft','scheduled','cancelled'].includes(String(status)) ? status : null;
    try {
      // Snapshot existing for diff
      const before = (await db.query(
        `SELECT * FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`,
        [billId, orgId]
      )).rows[0];
      if (!before) {
        req.flash("error", "Bill not found.");
        return res.redirect("/account/settings/finance?section=bills");
      }

      const next = {
        title: title ?? before.title,
        description: description ?? before.description,
        amount: newAmount,
        due_date: due_date || null,
        late_fee_amount: Number(late_fee_amount || 0),
        late_fee_after_days: Number(late_fee_after_days || 7),
        assignee_id: edit_assignee_id,
        bill_type: validType || before.bill_type,
        recurrence: validRec, // null clears
        school_year_id: school_year_id ? Number(school_year_id) : null,
        term_id: term_id ? Number(term_id) : null,
        payment_destination: validDest || before.payment_destination || 'stripe',
        accepts_card: !!accepts_card,
        accepts_cash: !!accepts_cash,
        accepts_transfer: !!accepts_transfer,
        notify_email: !!notify_email,
        notify_sms: !!notify_sms,
        status: validStatus || before.status,
      };

      await db.query(
        `UPDATE finance_bills SET
           title=$1, description=$2, amount=$3, due_date=$4,
           late_fee_amount=$5, late_fee_after_days=$6,
           assignee_id=$7,
           bill_type=$8, recurrence=$9,
           school_year_id=$10, term_id=$11,
           payment_destination=$12,
           accepts_card=$13, accepts_cash=$14, accepts_transfer=$15,
           notify_email=$16, notify_sms=$17,
           status=$18,
           updated_at=now()
         WHERE bill_id=$19 AND organization_id=$20`,
        [
          next.title, next.description, next.amount, next.due_date,
          next.late_fee_amount, next.late_fee_after_days,
          next.assignee_id,
          next.bill_type, next.recurrence,
          next.school_year_id, next.term_id,
          next.payment_destination,
          next.accepts_card, next.accepts_cash, next.accepts_transfer,
          next.notify_email, next.notify_sms,
          next.status,
          billId, orgId,
        ]
      );

      // Sync amount on pending/overdue assignments only (don't disturb paid)
      await db.query(
        `UPDATE finance_bill_assignments SET amount=$1, updated_at=now()
         WHERE bill_id=$2 AND organization_id=$3 AND status IN ('pending','overdue')`,
        [newAmount, billId, orgId]
      );

      // Sync collectors junction table
      if (assigneeList.length > 0) {
        await db.query(`DELETE FROM finance_bill_collectors WHERE bill_id=$1`, [billId]);
        await db.query(
          `INSERT INTO finance_bill_collectors (bill_id, user_id, organization_id)
           SELECT $1, unnest($2::int[]), $3
           ON CONFLICT (bill_id, user_id) DO NOTHING`,
          [billId, assigneeList, orgId]
        );
      }

      // Cancel-propagate if status changed to cancelled
      if (next.status === 'cancelled' && before.status !== 'cancelled') {
        await db.query(
          `UPDATE finance_bill_assignments SET status='cancelled', updated_at=now()
           WHERE bill_id=$1 AND organization_id=$2 AND status NOT IN ('paid')`,
          [billId, orgId]
        );
      }

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
      cmp('due_date','Due Date'); cmp('late_fee_amount','Late Fee'); cmp('late_fee_after_days','Late Fee Days');
      cmp('assignee_id','Assignee'); cmp('bill_type','Bill Type'); cmp('recurrence','Recurrence');
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
    } catch (e) { console.error("[billEdit]", e); req.flash("error", "Could not update bill: " + e.message); }
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
        db.query(
          `SELECT a.assignment_id, a.amount, a.amount_paid, a.late_fee_applied, a.status,
                  b.title, b.bill_type, b.due_date, b.recurrence
             FROM finance_bill_assignments a
             JOIN finance_bills b ON b.bill_id=a.bill_id
            WHERE a.student_id=$1 AND a.organization_id=$2
            ORDER BY b.due_date DESC NULLS LAST`,
          [studentId, orgId]
        ),
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
      await ensureFinanceSchema();
      await ensureAssigneeColumn();

      // All bills assigned to me as collector/overseer (via junction table OR legacy assignee_id)
      const billsR = await db.query(
        `SELECT b.*,
                (SELECT COUNT(*) FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id)               AS assigned_count,
                (SELECT COALESCE(SUM(a.amount),0)      FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id) AS total_amount,
                (SELECT COALESCE(SUM(a.amount_paid),0) FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id) AS total_paid,
                (SELECT COALESCE(SUM(GREATEST(a.amount + a.late_fee_applied - a.amount_paid, 0)),0)
                   FROM finance_bill_assignments a WHERE a.bill_id=b.bill_id)                            AS total_outstanding
           FROM finance_bills b
          WHERE b.organization_id = $1
            AND (b.assignee_id = $2
                 OR EXISTS (SELECT 1 FROM finance_bill_collectors c WHERE c.bill_id = b.bill_id AND c.user_id = $2))
          ORDER BY b.due_date NULLS LAST, b.created_at DESC`,
        [orgId, userId]
      );

      // All outstanding per-student assignments under my bills
      const assignmentsR = await db.query(
        `SELECT a.*, b.title AS bill_title, b.due_date,
                s.first_name, s.last_name, s.image_url, c.class_name
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
           JOIN students s ON s.student_id = a.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
          WHERE a.organization_id = $1
            AND (b.assignee_id = $2
                 OR EXISTS (SELECT 1 FROM finance_bill_collectors c WHERE c.bill_id = b.bill_id AND c.user_id = $2))
          ORDER BY a.status DESC, b.due_date NULLS LAST, s.last_name`,
        [orgId, userId]
      );

      // Aggregate totals across my assigned bills
      const stats = {
        bills:        billsR.rows.length,
        students:     assignmentsR.rows.length,
        billed:       assignmentsR.rows.reduce((s, a) => s + Number(a.amount || 0), 0),
        collected:    assignmentsR.rows.reduce((s, a) => s + Number(a.amount_paid || 0), 0),
        outstanding:  assignmentsR.rows.reduce((s, a) =>
                          s + Math.max(Number(a.amount || 0) + Number(a.late_fee_applied || 0) - Number(a.amount_paid || 0), 0), 0),
      };

      const pspSettings = await loadPspSettings(orgId);
      const allowedMethods = computeAllowedMethods(pspSettings);
      const orgProfile = await loadOrganizationProfile(orgId);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country);
      allowedMethods.currency = display.financeCurrency.code;

      res.render("account/myPaygira", {
        title: "My PayGira",
        bills: billsR.rows,
        assignments: assignmentsR.rows,
        stats,
        allowedMethods,
        financeCurrency: display.financeCurrency,
        formatMoney: display.formatMoney,
        money,
        messages: req.flash ? req.flash() : {},
        isEmbedded,
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
    if (!orgId || !userId) return res.redirect("/account/login");
    const { assignment_id, amount, method, reference, notes } = req.body;
    const isEmbedded = String((req.query && req.query.embed) || req.body.embedMode || '').toLowerCase() === 'workspace';
    const paygiraRedirectPath = isEmbedded ? "/account/settings/my-paygira?embed=workspace" : "/account/settings/my-paygira";
    try {
      // Verify the assignment belongs to a bill where this user is a collector
      const a = await db.query(
        `SELECT a.*, b.due_date, b.assignee_id,
                b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2`,
        [assignment_id, orgId]
      );
      if (!a.rows.length) {
        req.flash && req.flash("error", "Not authorized to collect for this bill.");
        return res.redirect(paygiraRedirectPath);
      }
      const row = a.rows[0];
      // Check: user is primary assignee OR in the collectors junction table
      const isCollector = row.assignee_id === userId ||
        (await db.query(
          `SELECT 1 FROM finance_bill_collectors WHERE bill_id=$1 AND user_id=$2`,
          [row.bill_id, userId]
        )).rows.length > 0;
      if (!isCollector) {
        req.flash && req.flash("error", "Not authorized to collect for this bill.");
        return res.redirect(paygiraRedirectPath);
      }
      const amt = Number(amount || 0);
      if (amt <= 0) {
        req.flash && req.flash("error", "Enter a valid amount.");
        return res.redirect(paygiraRedirectPath);
      }

      // Validate the method against what the school has enabled + what the bill accepts
      const psp = await loadPspSettings(orgId);
      const allow = computeAllowedMethods(psp);
      const requested = String(method || 'cash').toLowerCase();
      const ok =
        (requested === 'cash'          && row.accepts_cash)     ||
        (requested === 'bank_transfer' && row.accepts_transfer && allow.bankOn) ||
        (requested === 'mobile_money'  && allow.momoOn)         ||
        (requested === 'card'          && row.accepts_card && allow.stripeOn) ||
        (requested === 'stripe'        && row.accepts_card && allow.stripeOn) ||
        (requested === 'other');
      if (!ok) {
        req.flash && req.flash("error", `Method "${requested}" is not enabled on this bill / school. Update Payment Settings.`);
        return res.redirect(paygiraRedirectPath);
      }

      // Parse occurrence_date from the submitted form value (hidden field)
      const rawOccDate = req.body.occurrence_date || null;
      let occDateVal = null;
      if (rawOccDate) {
        const d = new Date(rawOccDate);
        occDateVal = isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }

      const payInsert = await db.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_by, occurrence_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING payment_id`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          requested, reference || null, notes || null, userId, occDateVal]
      );

      const newPaid = Number(row.amount_paid) + amt;
      const total = Number(row.amount) + Number(row.late_fee_applied || 0);
      let credit = 0;
      let appliedToAssignment = newPaid;
      if (newPaid > total) { credit = newPaid - total; appliedToAssignment = total; }
      const newStatus = recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await db.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (credit > 0) {
        await db.query(
          `INSERT INTO finance_student_credits (organization_id, student_id, amount)
             VALUES ($1,$2,$3)
           ON CONFLICT (student_id) DO UPDATE
              SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
          [orgId, row.student_id, credit]
        );
      }
      const display = await buildFinanceDisplayContext(req, orgId);
      req.flash && req.flash("success", credit > 0
        ? `Collected ${display.formatMoney(amt)}. ${display.formatMoney(credit)} added as student credit.`
        : `Collected ${display.formatMoney(amt)} from this student.`);

      // ── Email guardian/parent ──────────────────────────────────────────────
      try {
        const billRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1`, [row.bill_id])).rows[0];
        const orgRow  = (await db.query(`SELECT organization_name, logo_url FROM organizations WHERE organization_id=$1`, [orgId])).rows[0];
        const studentRow = (await db.query(`SELECT first_name, last_name FROM students WHERE student_id=$1`, [row.student_id])).rows[0];
        // Find guardian email(s) linked to this student
        const guardians = (await db.query(
          `SELECT gp.email, gp.first_name FROM guardian_profiles gp
             JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
            WHERE gs.student_id=$1 AND gp.organization_id=$2 AND gp.email IS NOT NULL AND gp.email <> ''`,
          [row.student_id, orgId]
        )).rows;
        if (guardians.length > 0 && billRow && studentRow) {
          const orgName    = orgRow?.organization_name || 'Your School';
          const studentName = `${studentRow.first_name} ${studentRow.last_name}`;
          const billName   = billRow.title;
          const amtFmt     = display.formatMoney(amt);
          const occText    = occDateVal ? ` for ${new Date(occDateVal + 'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}` : '';
          const statusText = newStatus === 'paid' ? 'fully paid' : `partially paid (${display.formatMoney(appliedToAssignment)} of ${display.formatMoney(total)})`;
          for (const g of guardians) {
            const html = renderCleanEmail({
              title: `Payment Recorded — ${billName}`,
              greeting: `Hello ${g.first_name},`,
              paragraphs: [
                `A payment of <strong>${amtFmt}</strong> has been recorded for <strong>${studentName}</strong> on the bill <strong>${billName}</strong>${occText}.`,
                `This bill is now <strong>${statusText}</strong>.`,
              ],
              details: [
                { label: 'Student',   value: studentName },
                { label: 'Bill',      value: billName },
                ...(occDateVal ? [{ label: 'For date', value: new Date(occDateVal + 'T00:00:00').toLocaleDateString() }] : []),
                { label: 'Amount paid', value: amtFmt },
                { label: 'Method',    value: requested },
                { label: 'Status',    value: newStatus },
              ],
              note: `This is an automated notification from ${orgName}. You can log in to the guardian portal to view your ward's full payment history.`,
            });
            await sendEmailSafely({
              from: process.env.ADMIN_NOTIFY_EMAIL_USER,
              to: g.email,
              subject: `[${orgName}] Payment Recorded — ${billName}`,
              html,
            }, 'PayGira guardian notification');
          }
        }
      } catch (emailErr) {
        console.warn('[staffMyPaygiraCollectPost] guardian email failed:', emailErr.message);
      }
      // Audit log
      try {
        const sRow = (await db.query(`SELECT first_name, last_name FROM students WHERE student_id=$1 AND organization_id=$2`, [row.student_id, orgId])).rows[0];
        const bRow = (await db.query(`SELECT title FROM finance_bills WHERE bill_id=$1 AND organization_id=$2`, [row.bill_id, orgId])).rows[0];
        const studentLabel = sRow ? `${sRow.first_name} ${sRow.last_name}` : `Student #${row.student_id}`;
        await logPaygira(req, {
          actionType: "Collected",
          recordType: "Payment",
          recordId: row.assignment_id,
          recordLabel: `${studentLabel} — ${bRow?.title || 'Bill'}`,
          description: `Collector recorded $${amt.toFixed(2)} (${requested}) for ${studentLabel} on bill "${bRow?.title || row.bill_id}". New status: ${newStatus}${credit > 0 ? `; $${credit.toFixed(2)} credited.` : ''}.`,
          changedFields: [
            { field: "Amount", value: `$${amt.toFixed(2)}` },
            { field: "Method", value: requested },
            { field: "Reference", value: reference || '—' },
            { field: "New Status", value: newStatus },
          ],
        });
      } catch (_) {}
    } catch (e) {
      console.error("[staffMyPaygiraCollectPost]", e);
      req.flash && req.flash("error", "Could not record collection: " + e.message);
    }
    res.redirect(paygiraRedirectPath);
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
                COALESCE(SUM(p.amount) FILTER (WHERE p.occurrence_date=$2::date), 0) AS paid_this_day,
                COALESCE(SUM(p.amount), 0) AS paid_total
           FROM finance_bill_assignments a
           LEFT JOIN finance_payments p ON p.assignment_id = a.assignment_id AND p.organization_id=$1
          WHERE a.bill_id=$3 AND a.organization_id=$1
          GROUP BY a.assignment_id`,
        [orgId, dateStr, billId]
      );
      const rows = assignments.rows;
      const totalStudents   = rows.length;
      // For a recurring bill each occurrence is one period amount; per-occurrence expected = bill.amount per student
      const perOccAmount    = Number(bill.amount || 0);
      const totalExpected   = perOccAmount * totalStudents;
      const totalPaidDay    = rows.reduce((s, r) => s + Number(r.paid_this_day || 0), 0);
      const totalOutstanding = Math.max(totalExpected - totalPaidDay, 0);
      const paidCount       = rows.filter(r => Number(r.paid_this_day) >= perOccAmount).length;

      res.json({
        students:        totalStudents,
        per_student:     perOccAmount,
        total_expected:  totalExpected,
        paid_today:      totalPaidDay,
        outstanding:     totalOutstanding,
        paid_count:      paidCount,
        unpaid_count:    totalStudents - paidCount,
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

      // All bill assignments for those children
      let assignments = [];
      let payments = [];
      if (studentIds.length) {
        const r = await database.query(
          `SELECT a.*, b.title AS bill_title, b.description AS bill_description,
                  b.due_date, b.bill_type, b.accepts_card, b.accepts_cash, b.accepts_transfer,
                  b.payment_destination,
                  s.first_name, s.last_name, s.image_url, s.student_id
             FROM finance_bill_assignments a
             JOIN finance_bills b ON b.bill_id = a.bill_id
             JOIN students s ON s.student_id = a.student_id
            WHERE a.organization_id = $1 AND a.student_id = ANY($2::int[])
            ORDER BY a.status, b.due_date NULLS LAST`,
          [orgId, studentIds]
        );
        assignments = r.rows;

        const p = await database.query(
          `SELECT p.payment_id, p.amount, p.method, p.received_at, p.reference,
                  s.first_name, s.last_name, b.title AS bill_title
             FROM finance_payments p
             LEFT JOIN students s ON s.student_id = p.student_id
             LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
            WHERE p.organization_id=$1 AND p.student_id = ANY($2::int[])
            ORDER BY p.received_at DESC LIMIT 30`,
          [orgId, studentIds]
        );
        payments = p.rows;
      }

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
        billed:      assignments.reduce((s, a) => s + Number(a.amount || 0), 0),
        paid:        assignments.reduce((s, a) => s + Number(a.amount_paid || 0), 0),
        outstanding: assignments.reduce((s, a) =>
                        s + Math.max(Number(a.amount || 0) + Number(a.late_fee_applied || 0) - Number(a.amount_paid || 0), 0), 0),
      };

      // Guardian profile for header
      const gp = await database.query(
        `SELECT first_name, last_name, image_url FROM guardian_profiles WHERE guardian_id=$1 AND organization_id=$2`,
        [guardianId, orgId]
      );

      // Payment options available to this guardian (set by the school)
      const pspSettings = await loadPspSettings(orgId);
      const maskedPsp = maskPspSecrets(pspSettings);
      const allowedMethods = computeAllowedMethods(pspSettings);
      const orgProfile = await loadOrganizationProfile(orgId);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, orgProfile.organization_country);
      allowedMethods.currency = display.financeCurrency.code;
      maskedPsp.currency = maskedPsp.currency || display.financeCurrency.code;

      res.render("guardian/paygira", {
        title: "PayGira — Pay Bills",
        guardian: gp.rows[0] || {},
        children,
        assignments,
        payments,
        cards: cardsR.rows,
        totals,
        pspSettings: maskedPsp,
        allowedMethods,
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

  // Guardian pays a bill (one assignment). Uses saved card metadata or generic.
  guardianPaygiraPayPost: async (req, res, dbArg) => {
    const database = dbArg || db;
    const orgId = req.session.organizationId;
    const guardianId = req.session.guardianId;
    if (!orgId || !guardianId) return res.redirect("/account/login");
    const { assignment_id, amount, card_id, method } = req.body;
    try {
      // Verify this assignment belongs to a student linked to this guardian
      const verify = await database.query(
        `SELECT a.*, b.due_date, b.accepts_card, b.accepts_cash, b.accepts_transfer, b.payment_destination
           FROM finance_bill_assignments a
           JOIN finance_bills b ON b.bill_id = a.bill_id
          WHERE a.assignment_id=$1 AND a.organization_id=$2
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
      const amt = Number(amount || 0);
      if (amt <= 0) {
        req.flash && req.flash("error", "Enter a valid amount.");
        return res.redirect("/guardian/paygira");
      }

      // Validate the chosen method against what the school has enabled + bill's accepted methods
      const psp = await loadPspSettings(orgId);
      const allow = computeAllowedMethods(psp);
      const requested = String(method || "card").toLowerCase();
      const ok =
        (requested === 'card'          && row.accepts_card && allow.stripeOn) ||
        (requested === 'stripe'        && row.accepts_card && allow.stripeOn) ||
        (requested === 'bank_transfer' && row.accepts_transfer && allow.bankOn) ||
        (requested === 'mobile_money'  && allow.momoOn) ||
        (requested === 'other');
      if (!ok) {
        req.flash && req.flash("error", `This bill does not accept "${requested}". Choose a method the school has enabled.`);
        return res.redirect("/guardian/paygira");
      }

      // Build a reference label from saved card if used
      let reference = `GUARDIAN-${guardianId}`;
      let payMethod = requested;
      if (card_id && (requested === 'card' || requested === 'stripe')) {
        const c = await database.query(
          `SELECT brand, last4 FROM guardian_payment_methods
            WHERE card_id=$1 AND guardian_id=$2 AND organization_id=$3`,
          [parseInt(card_id, 10) || 0, guardianId, orgId]
        );
        if (c.rows.length) {
          reference = `${c.rows[0].brand || "CARD"} •••• ${c.rows[0].last4}`;
          payMethod = "card";
        }
      }

      await database.query(
        `INSERT INTO finance_payments
          (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId, row.assignment_id, row.bill_id, row.student_id, amt,
          payMethod, reference, `Guardian portal payment by guardian #${guardianId}`]
      );

      const newPaid = Number(row.amount_paid) + amt;
      const total = Number(row.amount) + Number(row.late_fee_applied || 0);
      let credit = 0;
      let appliedToAssignment = newPaid;
      if (newPaid > total) { credit = newPaid - total; appliedToAssignment = total; }
      const newStatus = recalcAssignmentStatus(row.amount, row.late_fee_applied, appliedToAssignment, row.due_date);
      await database.query(
        `UPDATE finance_bill_assignments SET amount_paid=$1, status=$2, updated_at=now() WHERE assignment_id=$3`,
        [appliedToAssignment, newStatus, row.assignment_id]
      );
      if (credit > 0) {
        await database.query(
          `INSERT INTO finance_student_credits (organization_id, student_id, amount)
             VALUES ($1,$2,$3)
           ON CONFLICT (student_id) DO UPDATE
              SET amount = finance_student_credits.amount + EXCLUDED.amount, updated_at=now()`,
          [orgId, row.student_id, credit]
        );
      }
      const display = await buildFinanceDisplayContext(req, orgId);
      req.flash && req.flash("success", credit > 0
        ? `Payment recorded. ${display.formatMoney(credit)} added as student credit.`
        : "Payment recorded successfully.");
      req.flash && req.flash("success", credit > 0
        ? `Payment of $${amt.toFixed(2)} received. $${credit.toFixed(2)} kept as credit.`
        : `Payment of $${amt.toFixed(2)} received. Thank you.`);
      // Audit log (guardian-initiated)
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
          description: `Guardian ${guardianName} paid $${amt.toFixed(2)} (${payMethod}) for ${studentLabel} on bill "${bRow?.title || row.bill_id}". New status: ${newStatus}${credit > 0 ? `; $${credit.toFixed(2)} credited.` : ''}.`,
          changedFields: [
            { field: "Amount", value: `$${amt.toFixed(2)}` },
            { field: "Method", value: payMethod },
            { field: "Reference", value: reference || '—' },
            { field: "New Status", value: newStatus },
          ],
        });
      } catch (_) {}
    } catch (e) {
      console.error("[guardianPaygiraPayPost]", e);
      req.flash && req.flash("error", "Payment could not be processed: " + e.message);
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
            UNION SELECT 1 FROM guardian_students WHERE student_id=$1 AND guardian_id=$2 LIMIT 1`,
          [row.student_id, guardianId, orgId]
        );
        if (g.rows.length) authorized = true;
      }
      if (!authorized) return res.status(403).send("Not authorized to view this invoice.");

      const pspSettings = await loadPspSettings(orgId);
      const display = await buildFinanceDisplayContext(req, orgId, pspSettings, row.organization_country);

      // Payment history for this assignment
      const pays = await database.query(
        `SELECT amount, method, reference, received_at
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
                u.first_name AS recv_first, u.last_name AS recv_last
           FROM finance_payments p
           LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
           LEFT JOIN finance_bill_assignments a ON a.assignment_id = p.assignment_id
           LEFT JOIN students s ON s.student_id = p.student_id
           LEFT JOIN classes c ON c.class_id = s.class_id
           LEFT JOIN organizations o ON o.organization_id = p.organization_id
           LEFT JOIN users u ON u.user_id = p.received_by
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
            UNION SELECT 1 FROM guardian_students WHERE student_id=$1 AND guardian_id=$2 LIMIT 1`,
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
  } catch (e) { console.error("[ensureGuardianCardsSchema]", e.message); }
  _gCardsReady = true;
}

function inferCardBrand(digits) {
  if (/^4/.test(digits))                return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits))  return "Mastercard";
  if (/^3[47]/.test(digits))            return "Amex";
  if (/^6(011|5)/.test(digits))         return "Discover";
  if (/^(50|56|57|58|6\d)/.test(digits)) return "Verve";
  return "Card";
}

