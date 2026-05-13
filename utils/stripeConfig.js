const Stripe = require("stripe");
const defaultDb = require("../config/db");

const STRIPE_MODE_KEY = "stripe_mode";
const DEFAULT_STRIPE_CHARGE_CURRENCY = "usd";

function normalizeMode(value) {
  const mode = String(value || "test").trim().toLowerCase();
  return mode === "live" ? "live" : "test";
}

function maskKey(value = "") {
  const key = String(value || "").trim();
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

function normalizeStripeChargeCurrency(value) {
  const currency = String(value || DEFAULT_STRIPE_CHARGE_CURRENCY)
    .trim()
    .toLowerCase();
  return currency || DEFAULT_STRIPE_CHARGE_CURRENCY;
}

function getStripeChargeCurrency() {
  return normalizeStripeChargeCurrency(process.env.STRIPE_CHARGE_CURRENCY);
}

function getStripeConfigurationIssue(settings = {}) {
  const mode = normalizeMode(settings.mode);
  const activeSecretKey = String(settings.activeSecretKey || "").trim();
  const activePublicKey = String(settings.activePublicKey || "").trim();

  if (!activeSecretKey) {
    return `Stripe ${mode} secret key is not configured.`;
  }

  if (!activePublicKey) {
    return `Stripe ${mode} publishable key is not configured.`;
  }

  const validLiveSecretPrefixes = ["sk_live_", "rk_live_"];
  const expectedSecretPrefix = mode === "live" ? validLiveSecretPrefixes : ["sk_test_"];
  const expectedPublicPrefix = mode === "live" ? "pk_live_" : "pk_test_";

  if (!expectedSecretPrefix.some((prefix) => activeSecretKey.startsWith(prefix))) {
    return `Stripe is set to ${mode} mode, but the active secret key does not match that mode.`;
  }

  if (!activePublicKey.startsWith(expectedPublicPrefix)) {
    return `Stripe is set to ${mode} mode, but the active publishable key does not match that mode.`;
  }

  return "";
}

async function getStripeSettings(dbClient = defaultDb) {
  const result = await dbClient.query(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [STRIPE_MODE_KEY]
  );

  const mode = normalizeMode(result.rows[0]?.value);

  const testSecretKey = process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "";
  const testPublicKey = process.env.STRIPE_TEST_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || "";
  const liveSecretKey = process.env.STRIPE_LIVE_SECRET_KEY || "";
  const livePublicKey = process.env.STRIPE_LIVE_PUBLISHABLE_KEY || "";

  const activeSecretKey = mode === "live" ? liveSecretKey : testSecretKey;
  const activePublicKey = mode === "live" ? livePublicKey : testPublicKey;

  return {
    mode,
    testSecretKey,
    testPublicKey,
    liveSecretKey,
    livePublicKey,
    activeSecretKey,
    activePublicKey,
    masked: {
      testSecretKey: maskKey(testSecretKey),
      testPublicKey: maskKey(testPublicKey),
      liveSecretKey: maskKey(liveSecretKey),
      livePublicKey: maskKey(livePublicKey),
    },
  };
}

async function upsertStripeSettings(values, dbClient = defaultDb) {
  const mode = normalizeMode(values?.stripe_mode);
  await dbClient.query(
    `INSERT INTO app_settings(key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [STRIPE_MODE_KEY, mode]
  );
}

async function getActiveStripeSecretKey(dbClient = defaultDb) {
  const settings = await getStripeSettings(dbClient);
  return settings.activeSecretKey || "";
}

async function getActiveStripePublicKey(dbClient = defaultDb) {
  const settings = await getStripeSettings(dbClient);
  return settings.activePublicKey || "";
}

async function getStripeClient(dbClient = defaultDb) {
  const secretKey = await getActiveStripeSecretKey(dbClient);
  if (!secretKey) {
    throw new Error("Stripe secret key is not configured.");
  }
  return new Stripe(secretKey);
}

module.exports = {
  STRIPE_MODE_KEY,
  DEFAULT_STRIPE_CHARGE_CURRENCY,
  normalizeMode,
  normalizeStripeChargeCurrency,
  getStripeConfigurationIssue,
  getStripeSettings,
  upsertStripeSettings,
  getActiveStripeSecretKey,
  getActiveStripePublicKey,
  getStripeChargeCurrency,
  getStripeClient,
};