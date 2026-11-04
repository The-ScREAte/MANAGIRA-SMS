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
  max: parseInt(process.env.MIRA_DB_POOL_MAX || (process.env.NODE_ENV === "production" ? "4" : "2"), 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
});

pool.on("error", (err) => {
  console.error("[mira/db] unexpected pool error", err);
});

// Brief database blips (Render's "service temporarily unavailable", too many
// connections, a dropped connection): wait and try again. A refused
// connection never ran the query, so any query is safe to repeat; after a
// drop, only reads are repeated.
const RETRY_DELAYS_MS = [300, 1000, 2500, 4500];
const refused = (e) => ["08004", "08001", "53300", "57P03", "ECONNREFUSED", "EAI_AGAIN"].includes(String(e?.code || "").toUpperCase())
  || /service temporarily unavailable|too many connections|remaining connection slots|timeout exceeded when trying to connect/i.test(String(e?.message || ""));
const dropped = (e) => /connection terminated unexpectedly|server closed the connection|connection reset|ECONNRESET|ETIMEDOUT/i.test(String(e?.message || "") + " " + String(e?.code || ""));
const readOnly = (args) => /^\s*(select|with|show)\b/i.test(typeof args[0] === "string" ? args[0] : String(args[0]?.text || ""));
const originalQuery = pool.query.bind(pool);
pool.query = async (...args) => {
  if (typeof args[args.length - 1] === "function") return originalQuery(...args);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalQuery(...args);
    } catch (error) {
      const retry = refused(error) || (dropped(error) && readOnly(args));
      if (!retry || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
};

module.exports = pool;
