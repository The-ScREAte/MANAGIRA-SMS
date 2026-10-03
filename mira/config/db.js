// Mira owns its own tables (chat history, tool-call audit log, usage
// ledger, tenant limits, vector embeddings) - all prefixed `mira_`. It
// never queries the main app's operational tables (students, fees,
// attendance, etc.) directly; that data is only ever reached through the
// internal API (see internalApiClient.js).
//
// MIRA_DB_CONNECTION_STRING defaults to DB_CONNECTION_STRING so this
// deploys today with zero new infra, but can be pointed at a dedicated
// Postgres instance later with no code change - just set the env var.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { Pool } = require("pg");

const rawConnectionString = process.env.MIRA_DB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;

if (!rawConnectionString) {
  throw new Error(
    "MIRA_DB_CONNECTION_STRING (or DB_CONNECTION_STRING as a fallback) is not set. Mira cannot start without a database."
  );
}

const shouldUseSsl =
  String(process.env.MIRA_DB_SSL || "").toLowerCase() === "true" || /sslmode=(require|prefer|verify-ca|verify-full)\b/.test(rawConnectionString);

// The pg driver already treats sslmode=require/prefer/verify-ca as
// verify-full and prints a SECURITY WARNING on every start; saying
// verify-full explicitly keeps exactly the same behaviour without the noise.
const connectionString = rawConnectionString.replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full");

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.MIRA_DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
});

pool.on("error", (err) => {
  console.error("[mira/db] unexpected pool error", err);
});

module.exports = pool;
