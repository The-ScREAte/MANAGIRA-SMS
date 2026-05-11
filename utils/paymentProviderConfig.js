const defaultDb = require("../config/db");

const PAYMENT_PROVIDER_KEY = "payment_provider";

function normalizePaymentProvider(value) {
  const provider = String(value || "paystack").trim().toLowerCase();
  if (provider === "stripe") return "stripe";
  if (provider === "smart" || provider === "both") return "smart";
  return "paystack";
}

function providerSupportsStripe(provider) {
  return normalizePaymentProvider(provider) !== "paystack";
}

function providerSupportsPaystack(provider) {
  return normalizePaymentProvider(provider) !== "stripe";
}

async function getPaymentProvider(dbClient = defaultDb) {
  const result = await dbClient.query(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [PAYMENT_PROVIDER_KEY]
  );

  return normalizePaymentProvider(result.rows[0]?.value);
}

async function upsertPaymentProvider(value, dbClient = defaultDb) {
  const provider = normalizePaymentProvider(value);
  await dbClient.query(
    `INSERT INTO app_settings(key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [PAYMENT_PROVIDER_KEY, provider]
  );
}

module.exports = {
  PAYMENT_PROVIDER_KEY,
  normalizePaymentProvider,
  providerSupportsStripe,
  providerSupportsPaystack,
  getPaymentProvider,
  upsertPaymentProvider,
};