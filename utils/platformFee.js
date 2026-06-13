const defaultDb = require("../config/db");

const PLATFORM_FEE_PERCENTAGE_KEY = "platform_fee_percentage";
const DEFAULT_PLATFORM_FEE_PERCENTAGE = 2;
const PLATFORM_FEE_BEARER_VALUES = ["parent", "school"];
const DEFAULT_PLATFORM_FEE_BEARER = "parent";

function roundMoneyAmount(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function normalizePlatformFeePercentage(value, fallback = DEFAULT_PLATFORM_FEE_PERCENTAGE) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return roundMoneyAmount(Math.min(100, Math.max(0, parsed)));
}

function normalizePlatformFeeBearer(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PLATFORM_FEE_BEARER_VALUES.includes(normalized)
    ? normalized
    : DEFAULT_PLATFORM_FEE_BEARER;
}

async function getPlatformFeeSettings(dbClient = defaultDb) {
  const result = await dbClient.query(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [PLATFORM_FEE_PERCENTAGE_KEY]
  );

  return {
    percentage: normalizePlatformFeePercentage(
      result.rows[0]?.value,
      DEFAULT_PLATFORM_FEE_PERCENTAGE
    ),
  };
}

async function upsertPlatformFeeSettings(values, dbClient = defaultDb) {
  const percentage = normalizePlatformFeePercentage(
    values?.platform_fee_percentage,
    DEFAULT_PLATFORM_FEE_PERCENTAGE
  );

  await dbClient.query(
    `INSERT INTO app_settings(key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [PLATFORM_FEE_PERCENTAGE_KEY, String(percentage)]
  );

  return { percentage };
}

async function getOrgPlatformFeeBearer(orgId, dbClient = defaultDb) {
  if (!orgId) return DEFAULT_PLATFORM_FEE_BEARER;
  try {
    const result = await dbClient.query(
      `SELECT platform_fee_bearer FROM organizations WHERE organization_id = $1 LIMIT 1`,
      [orgId]
    );
    return normalizePlatformFeeBearer(result.rows[0]?.platform_fee_bearer);
  } catch (_) {
    return DEFAULT_PLATFORM_FEE_BEARER;
  }
}

async function upsertOrgPlatformFeeBearer(orgId, bearer, dbClient = defaultDb) {
  const normalized = normalizePlatformFeeBearer(bearer);
  await dbClient.query(
    `UPDATE organizations SET platform_fee_bearer = $1 WHERE organization_id = $2`,
    [normalized, orgId]
  );
  return normalized;
}

function isPlatformFeeMethod(method) {
  const normalized = String(method || "").trim().toLowerCase();
  return [
    "card",
    "stripe",
    "apple_pay",
    "google_pay",
    "link",
    "cashapp",
    "us_bank_account",
    "sepa_debit",
    "bacs_debit",
    "klarna",
    "afterpay_clearpay",
    "ideal",
  ].includes(normalized);
}

function buildPlatformChargeBreakdown(baseAmount, options = {}) {
  const subtotalAmount = Math.max(0, roundMoneyAmount(baseAmount));
  const applyPlatformFee = options.applyPlatformFee !== false;
  const platformFeePercentage = applyPlatformFee
    ? normalizePlatformFeePercentage(options.platformFeePercentage, 0)
    : 0;
  const platformFeeBearer = normalizePlatformFeeBearer(options.bearer);
  const platformFeeAmount = platformFeePercentage > 0
    ? roundMoneyAmount(subtotalAmount * (platformFeePercentage / 100))
    : 0;
  const taxAmount = Math.max(0, roundMoneyAmount(options.taxAmount || 0));
  const totalChargedAmount = platformFeeBearer === "parent"
    ? roundMoneyAmount(subtotalAmount + platformFeeAmount + taxAmount)
    : roundMoneyAmount(subtotalAmount + taxAmount);
  const schoolReceivesAmount = platformFeeBearer === "parent"
    ? subtotalAmount
    : roundMoneyAmount(Math.max(subtotalAmount - platformFeeAmount, 0));

  return {
    subtotalAmount,
    platformFeePercentage,
    platformFeeAmount,
    platformFeeBearer,
    taxAmount,
    totalChargedAmount,
    schoolReceivesAmount,
  };
}

module.exports = {
  PLATFORM_FEE_PERCENTAGE_KEY,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  PLATFORM_FEE_BEARER_VALUES,
  DEFAULT_PLATFORM_FEE_BEARER,
  roundMoneyAmount,
  normalizePlatformFeePercentage,
  normalizePlatformFeeBearer,
  getPlatformFeeSettings,
  upsertPlatformFeeSettings,
  getOrgPlatformFeeBearer,
  upsertOrgPlatformFeeBearer,
  isPlatformFeeMethod,
  buildPlatformChargeBreakdown,
};