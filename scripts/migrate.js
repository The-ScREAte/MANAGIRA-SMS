// Applies database/migrations/*.sql once each, in name order, and records them in
// schema_migrations. Run it once per deploy: `npm run migrate` as Render's
// pre-deploy command. Statements run one at a time and outside a transaction,
// because CREATE INDEX CONCURRENTLY can't run inside one, so write each to be safe
// to repeat (IF NOT EXISTS). Render runs this while the old version is still live, so
// migrations should only add things, never remove or rename them.
const fs = require("fs");
const path = require("path");

const DEFAULT_DIR = path.join(__dirname, "..", "database", "migrations");

function splitStatements(sql) {
  // A DO block or function has semicolons inside it: such a file runs as one statement.
  if (sql.includes("$$")) return [sql.trim()];
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

async function runMigrations(db, { dir = DEFAULT_DIR, log = console.log } = {}) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const done = new Set((await db.query("SELECT name FROM schema_migrations")).rows.map((row) => row.name));
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    log(`[migrate] ${file}`);
    for (const statement of splitStatements(fs.readFileSync(path.join(dir, file), "utf8"))) {
      await db.query(statement);
    }
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
    applied.push(file);
  }
  log(applied.length ? `[migrate] Applied ${applied.length}.` : "[migrate] Nothing to do.");
  // A failed CREATE INDEX CONCURRENTLY leaves a broken index that IF NOT EXISTS would skip forever.
  const broken = (await db.query("SELECT indexrelid::regclass::text AS name FROM pg_index WHERE NOT indisvalid")).rows;
  if (broken.length) log(`[migrate] WARNING: broken indexes, drop and re-run: ${broken.map((row) => row.name).join(", ")}`);
  return applied;
}

if (require.main === module) {
  require("dotenv").config();
  process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || "2";
  process.env.DB_POOL_MIN = "0";
  const db = require("../config/db");
  const { withAdvisoryLock } = require("../utils/dbLock");
  withAdvisoryLock("schema-migrations", async () => {
    // Index builds can outlast the app's 30-second query limit.
    const client = await db.connect();
    try {
      await client.query("SET statement_timeout = 0");
      return await runMigrations(client);
    } finally {
      client.release(true);
    }
  })
    .then(({ ran }) => {
      if (!ran) console.log("[migrate] Another copy is already running.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("[migrate] Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { runMigrations, splitStatements };
