const Stripe = require("stripe");
const defaultDb = require("../config/db");

const STRIPE_MODE_KEY = "stripe_mode";
const DEFAULT_STRIPE_CHARGE_CURRENCY = "usd";
const STRIPE_CONNECT_ACCOUNT_ID_LEGACY_COLUMN = "stripe_connect_account_id";
const STRIPE_CONNECT_ACCOUNT_ID_TEST_COLUMN = "stripe_connect_account_id_test";
const STRIPE_CONNECT_ACCOUNT_ID_LIVE_COLUMN = "stripe_connect_account_id_live";

let stripeConnectAccountSchemaReady = false;

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

function getModeSecretPrefix(mode) {
  return normalizeMode(mode) === "live" ? "sk_live_" : "sk_test_";
}

function getModePublicPrefix(mode) {
  return normalizeMode(mode) === "live" ? "pk_live_" : "pk_test_";
}

function isFullSecretKeyForMode(value, mode) {
  const key = String(value || "").trim();
  return Boolean(key) && key.startsWith(getModeSecretPrefix(mode));
}

function isPublicKeyForMode(value, mode) {
  const key = String(value || "").trim();
  return Boolean(key) && key.startsWith(getModePublicPrefix(mode));
}

function normalizeConnectAccountId(value) {
  const accountId = String(value || "").trim();
  return accountId.startsWith("acct_") ? accountId : "";
}

function getStripeConnectAccountColumn(mode) {
  return normalizeMode(mode) === "live"
    ? STRIPE_CONNECT_ACCOUNT_ID_LIVE_COLUMN
    : STRIPE_CONNECT_ACCOUNT_ID_TEST_COLUMN;
}

function getOppositeStripeConnectAccountColumn(mode) {
  return normalizeMode(mode) === "live"
    ? STRIPE_CONNECT_ACCOUNT_ID_TEST_COLUMN
    : STRIPE_CONNECT_ACCOUNT_ID_LIVE_COLUMN;
}

function getStripeConnectAccountId(record = {}, mode) {
  const activeColumn = getStripeConnectAccountColumn(mode);
  return normalizeConnectAccountId(record?.[activeColumn]) ||
    normalizeConnectAccountId(record?.[STRIPE_CONNECT_ACCOUNT_ID_LEGACY_COLUMN]) ||
    "";
}

async function ensureStripeConnectAccountSchema(dbClient = defaultDb) {
  if (stripeConnectAccountSchemaReady) return;

  await dbClient.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS stripe_connect_account_id_test VARCHAR(255),
      ADD COLUMN IF NOT EXISTS stripe_connect_account_id_live VARCHAR(255)
  `).catch(() => {});

  stripeConnectAccountSchemaReady = true;
}

async function saveOrganizationStripeConnectAccountId(orgId, accountId, dbClient = defaultDb, mode) {
  const resolvedMode = normalizeMode(mode);
  const activeColumn = getStripeConnectAccountColumn(resolvedMode);
  const normalizedId = normalizeConnectAccountId(accountId);

  if (!orgId || !normalizedId) return;
  await ensureStripeConnectAccountSchema(dbClient);

  await dbClient.query(
    `UPDATE organizations
        SET ${STRIPE_CONNECT_ACCOUNT_ID_LEGACY_COLUMN} = $1,
            ${activeColumn} = $1
      WHERE organization_id = $2`,
    [normalizedId, orgId]
  );
}

async function preserveStripeConnectAccountForOtherMode(orgId, accountId, dbClient = defaultDb, mode) {
  const resolvedMode = normalizeMode(mode);
  const oppositeColumn = getOppositeStripeConnectAccountColumn(resolvedMode);
  const normalizedId = normalizeConnectAccountId(accountId);

  if (!orgId || !normalizedId) return;
  await ensureStripeConnectAccountSchema(dbClient);

  await dbClient.query(
    `UPDATE organizations
        SET ${oppositeColumn} = CASE
          WHEN COALESCE(NULLIF(BTRIM(${oppositeColumn}), ''), '') = '' THEN $1
          ELSE ${oppositeColumn}
        END
      WHERE organization_id = $2`,
    [normalizedId, orgId]
  );
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

async function getStripePlatformCredentials(dbClient = defaultDb) {
  const settings = await getStripeSettings(dbClient);
  const mode = normalizeMode(settings.mode);
  const connectKey = normalizeMode(mode) === "live"
    ? String(process.env.STRIPE_CONNECT_LIVE_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || "").trim()
    : String(process.env.STRIPE_CONNECT_TEST_SECRET_KEY || process.env.STRIPE_CONNECT_SECRET_KEY || "").trim();
  const modeSecretKey = String(mode === "live" ? settings.liveSecretKey : settings.testSecretKey).trim();
  const publicKey = String(mode === "live" ? settings.livePublicKey : settings.testPublicKey).trim();
  const secretKey = [connectKey, modeSecretKey].find((value) => isFullSecretKeyForMode(value, mode)) || "";

  let issue = "";
  if (!secretKey) {
    issue = `Stripe ${mode} platform secret key is not configured for Connect and destination-charge flows.`;
  } else if (!publicKey) {
    issue = `Stripe ${mode} publishable key is not configured.`;
  } else if (!isPublicKeyForMode(publicKey, mode)) {
    issue = `Stripe is set to ${mode} mode, but the ${mode} publishable key does not match that mode.`;
  }

  return {
    mode,
    secretKey,
    publicKey,
    issue,
  };
}

async function getStripeClient(dbClient = defaultDb) {
  const secretKey = await getActiveStripeSecretKey(dbClient);
  if (!secretKey) {
    throw new Error("Stripe secret key is not configured.");
  }
  return new Stripe(secretKey);
}

// Platform-level client for Stripe Connect operations (account creation, account links).
// Stripe Connect requires a FULL secret key (sk_live_... or sk_test_...).
// Restricted keys (rk_live_...) do NOT have the needed permissions.
// Creates a Stripe client for platform/Connect flows using a full platform
// secret that matches the active admin Stripe mode.
// Dedicated test/live Connect keys are preferred, then the mode-specific
// primary secret if it is a full sk_ key.
async function getStripePlatformClient(dbClient = defaultDb) {
  const platform = await getStripePlatformCredentials(dbClient);
  const secretKey = String(platform.secretKey || "").trim();
  if (!secretKey) {
    throw new Error(platform.issue || `Stripe ${platform.mode || "active"} platform secret key is not configured.`);
  }
  return new Stripe(secretKey);
}

module.exports = {
  STRIPE_MODE_KEY,
  DEFAULT_STRIPE_CHARGE_CURRENCY,
  normalizeMode,
  normalizeStripeChargeCurrency,
  getStripeConnectAccountColumn,
  getStripeConnectAccountId,
  getStripeConfigurationIssue,
  getStripeSettings,
  upsertStripeSettings,
  getActiveStripeSecretKey,
  getActiveStripePublicKey,
  ensureStripeConnectAccountSchema,
  saveOrganizationStripeConnectAccountId,
  preserveStripeConnectAccountForOtherMode,
  getStripePlatformCredentials,
  getStripeChargeCurrency,
  getStripeClient,
  getStripePlatformClient,
};