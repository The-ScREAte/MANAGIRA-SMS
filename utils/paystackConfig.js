const defaultDb = require("../config/db");

const PAYSTACK_MODE_KEY = "paystack_mode";

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

async function getPaystackSettings(dbClient = defaultDb) {
  const result = await dbClient.query(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [PAYSTACK_MODE_KEY]
  );

  const mode = normalizeMode(result.rows[0]?.value);

  const testSecretKey = process.env.PAYSTACK_SECRET_KEY || "";
  const testPublicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
  const liveSecretKey = process.env.PAYSTACK_LIVE_SECRET_KEY || "";
  const livePublicKey = process.env.PAYSTACK_LIVE_PUBLIC_KEY || "";

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

async function upsertPaystackSettings(values, dbClient = defaultDb) {
  const mode = normalizeMode(values?.paystack_mode);
  await dbClient.query(
    `INSERT INTO app_settings(key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [PAYSTACK_MODE_KEY, mode]
  );
}

module.exports = {
  getPaystackSettings,
  upsertPaystackSettings,
  normalizeMode,
};
