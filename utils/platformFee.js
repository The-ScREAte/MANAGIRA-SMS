const defaultDb = require("../config/db");

const PLATFORM_FEE_PERCENTAGE_KEY = "platform_fee_percentage";
const DEFAULT_PLATFORM_FEE_PERCENTAGE = 2;

function roundMoneyAmount(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function normalizePlatformFeePercentage(value, fallback = DEFAULT_PLATFORM_FEE_PERCENTAGE) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return roundMoneyAmount(Math.min(100, Math.max(0, parsed)));
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
  const platformFeeAmount = platformFeePercentage > 0
    ? roundMoneyAmount(subtotalAmount * (platformFeePercentage / 100))
    : 0;
  const taxAmount = Math.max(0, roundMoneyAmount(options.taxAmount || 0));
  const totalChargedAmount = roundMoneyAmount(subtotalAmount + platformFeeAmount + taxAmount);

  return {
    subtotalAmount,
    platformFeePercentage,
    platformFeeAmount,
    taxAmount,
    totalChargedAmount,
  };
}

module.exports = {
  PLATFORM_FEE_PERCENTAGE_KEY,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  roundMoneyAmount,
  normalizePlatformFeePercentage,
  getPlatformFeeSettings,
  upsertPlatformFeeSettings,
  isPlatformFeeMethod,
  buildPlatformChargeBreakdown,
};