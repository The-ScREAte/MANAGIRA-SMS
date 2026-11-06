// Creating a shard. With a Render API key it builds the database and the server itself.
// Without one, you create them on Render and connect them here. Either way a shard only
// becomes active once its database is ready and its server has answered.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { connectTo, schemaStatements, applySchema, assignIdBlock } = require("./catalog");
const { syncReferenceData } = require("./referenceData");
const { isSettingsEncryptionKeyConfigured } = require("../encryption");
const registry = require("./registry");
const render = require("./renderApi");
const { testShardSecret } = require("./signing");

const NAME_PATTERN = /^[a-z]+-shard-\d{2}$/;
const ENVIRONMENTS = new Set(["production", "testing", "staging"]);
const REGIONS = new Set(["us", "af", "eu", "as", "testing"]);
const HOSTS = new Set(["oregon", "ohio", "virginia", "frankfurt", "singapore"]);
const SERVER_PLANS = new Set(["starter", "standard", "pro", "pro_plus"]);
const DATABASE_PLANS = new Set(["basic_256mb", "basic_1gb", "basic_4gb", "pro_4gb", "pro_8gb", "pro_16gb", "pro_32gb"]);
const POLL_MS = Number(process.env.SHARD_POLL_MS || 15000);
const WAIT_MS = 30 * 60 * 1000;
const NEVER_COPIED = /^(RENDER|DB_|DATABASE_|CONTROL_DB|SHARD_NAME|SHARD_ENVIRONMENT|SESSION_COOKIE_DOMAIN|PORT$|HOME$|PATH$|PWD$|SHLVL$|HOSTNAME$|TERM$|_$|NODE_VERSION|NPM_|npm_|LANG$|LC_|USER$|LOGNAME$|TMPDIR$|SHELL$|OLDPWD$)/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validateShard(input) {
  const name = String(input.name || "").trim().toLowerCase();
  const environment = String(input.environment || "production");
  const region = String(input.region || "us");
  const hosting = String(input.hostingLocation || "oregon");
  const countries = String(input.countries || "").split(/[\s,]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
  const errors = [];
  if (!NAME_PATTERN.test(name)) errors.push("Name it like us-shard-02 or af-shard-01.");
  if (!ENVIRONMENTS.has(environment)) errors.push("Choose production, testing or staging.");
  if (!REGIONS.has(region)) errors.push("Choose a region.");
  if (!HOSTS.has(hosting)) errors.push("Choose where it is hosted.");
  if (countries.some((code) => !/^[A-Z]{2}$/.test(code))) errors.push("Countries are two-letter codes, like GH, NG.");
  const capacitySchools = Number(input.capacitySchools || 200);
  const capacityUsers = Number(input.capacityUsers || 1000);
  if (!Number.isInteger(capacitySchools) || capacitySchools < 1) errors.push("Capacity must be a whole number.");
  if (!Number.isInteger(capacityUsers) || capacityUsers < 1) errors.push("Capacity must be a whole number.");
  return { errors, values: { name, environment, region, hostingLocation: hosting, countries, capacitySchools, capacityUsers, acceptsNew: input.acceptsNew === "on" || input.acceptsNew === true } };
}

// Every block is used once, so ids can never collide. Testing shards count down from the top.
async function nextIdBlock(control, environment) {
  const { rows } = await control.query("SELECT id_block FROM shards ORDER BY id_block");
  const used = new Set(rows.map((row) => row.id_block));
  const candidates = environment === "production" ? [...Array(18).keys()].map((n) => n + 1) : [20, 19];
  const block = candidates.find((value) => !used.has(value));
  if (!block) throw new Error("No id block is free. Ids need widening before another shard can be added.");
  return block;
}

async function log(control, shardId, text) {
  await control.query(
    "UPDATE shards SET provision_log = provision_log || $2::jsonb, updated_at = NOW() WHERE shard_id = $1",
    [shardId, JSON.stringify([{ at: new Date().toISOString(), text }])]
  );
}

// An empty database gets the same structure as the control shard, its own ids and the
// platform's plans and prices. It refuses a database that already has anything in it.
async function prepareDatabase({ sourceUrl, destinationUrl, block, environment, schemaOptions = {} }) {
  const source = connectTo(sourceUrl);
  const destination = connectTo(destinationUrl);
  await source.connect();
  await destination.connect();
  try {
    await source.query("SET statement_timeout = 0");
    await destination.query("SET statement_timeout = 0");
    await emptyDatabase(destination);
    await applySchema(destination, await schemaStatements(source, schemaOptions));
    await assignIdBlock(destination, block);
    const copied = await syncReferenceData(source, destination, { environment });
    await markMigrationsDone(destination);
    return { copied };
  } finally {
    await source.end().catch(() => {});
    await destination.end().catch(() => {});
  }
}

// A new server creates a few tables of its own the moment it starts, so "empty" means no
// school data. A database with any school or person in it is refused, never touched.
async function emptyDatabase(client) {
  const { rows } = await client.query("SELECT to_regclass('public.organizations') IS NOT NULL AS schools, to_regclass('public.users') IS NOT NULL AS people");
  for (const [exists, table] of [[rows[0].schools, "organizations"], [rows[0].people, "users"]]) {
    if (!exists) continue;
    const { rows: found } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${table}) AS any`);
    if (found[0].any) throw new Error(`That database already has data in ${table}. A new shard needs an empty one.`);
  }
  const { rows: tables } = await client.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
  if (tables[0].n) {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  }
}

// The structure already matches, so nothing needs re-running on its first deploy.
async function markMigrationsDone(client) {
  const dir = path.join(__dirname, "..", "..", "database", "migrations");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql"));
  await client.query("INSERT INTO schema_migrations (name) SELECT UNNEST($1::text[]) ON CONFLICT DO NOTHING", [files]);
}

function environmentFor(shard, { databaseUrl, controlUrl }) {
  const base = {
    NODE_ENV: "production",
    DB_CONNECTION_STRING: databaseUrl,
    DB_SSL: "true",
    SHARD_NAME: shard.name,
    SHARD_ENVIRONMENT: shard.environment,
  };
  if (shard.environment !== "production") {
    // Isolated: nothing of production's. No control database, email, texts, payments or
    // storage of real schools, and secrets of its own.
    return { ...base, SHARD_SECRET: testShardSecret(), SESSION_SECRET: crypto.randomBytes(32).toString("hex"), SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"), SESSION_COOKIE_DOMAIN: "" };
  }
  base.CONTROL_DB_URL = controlUrl;
  base.SHARD_SECRET = process.env.SHARD_SECRET;
  const shared = {};
  Object.entries(process.env).forEach(([key, value]) => {
    if (!NEVER_COPIED.test(key) && value !== undefined && value !== "") shared[key] = value;
  });
  return { ...shared, ...base };
}

async function waitFor(check, what) {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const answer = await check();
    if (answer) return answer;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(POLL_MS);
  }
}

// A shard is ready when its server answers, knows its name, and accepts our signature.
async function verifyServer(shard) {
  const base = String(shard.app_url).replace(/\/$/, "");
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
  if (!health.ok) throw new Error(`The server answered ${health.status}.`);
  const stats = await registry.callShard(shard, "/stats");
  if (stats.name !== shard.name) throw new Error(`That server calls itself ${stats.name}. Set SHARD_NAME to ${shard.name}.`);
  return stats;
}

async function runProvision(shardId, { databaseUrl = null, plans = {}, branch = "main", schemaOptions } = {}) {
  const control = registry.controlDb();
  const shard = (await control.query("SELECT * FROM shards WHERE shard_id = $1", [shardId])).rows[0];
  const controlShard = (await control.query("SELECT * FROM shards WHERE is_control LIMIT 1")).rows[0];
  const sourceUrl = registry.shardDatabaseUrl(controlShard);
  const controlUrl = process.env.CONTROL_DB_EXTERNAL_URL || process.env.CONTROL_DB_URL || sourceUrl;
  try {
    let externalUrl = databaseUrl;
    let internalUrl = databaseUrl;
    if (!externalUrl) {
      await log(control, shardId, "Creating the database");
      const database = await render.createPostgres({ name: `managira-${shard.name}`, plan: plans.database || "basic_1gb", region: shard.hosting_location });
      await control.query("UPDATE shards SET render_postgres_id = $2 WHERE shard_id = $1", [shardId, database.id]);
      await waitFor(async () => (await render.getPostgres(database.id)).status === "available", "the database");
      const connection = await render.postgresConnection(database.id);
      externalUrl = connection.externalConnectionString;
      internalUrl = connection.internalConnectionString;
    }
    await control.query("UPDATE shards SET db_url_encrypted = $2 WHERE shard_id = $1", [shardId, registry.encryptDatabaseUrl(externalUrl)]);

    await log(control, shardId, "Building the database");
    const { copied } = await prepareDatabase({ sourceUrl, destinationUrl: externalUrl, block: shard.id_block, environment: shard.environment, schemaOptions });
    await log(control, shardId, `Database ready, with its own ids and ${copied} platform records`);

    let current = shard;
    if (!shard.app_url) {
      await log(control, shardId, "Creating the server");
      const created = await render.createService({
        name: `managira-${shard.name}`,
        plan: plans.server || "standard",
        region: shard.hosting_location,
        branch,
        deployOnPush: shard.environment !== "production",
        envVars: Object.entries(environmentFor(shard, { databaseUrl: internalUrl, controlUrl })).map(([key, value]) => ({ key, value: String(value) })),
      });
      const url = created.service?.serviceDetails?.url;
      await control.query("UPDATE shards SET render_service_id = $2, app_url = $3 WHERE shard_id = $1", [shardId, created.service?.id, url]);
      current = { ...shard, app_url: url };
      await log(control, shardId, "Waiting for the server's first deploy");
      if (created.deployId) {
        await waitFor(async () => {
          const deploy = await render.getDeploy(created.service.id, created.deployId);
          if (render.DEPLOY_FAILED.has(deploy.status)) throw new Error(`The first deploy failed: ${deploy.status}.`);
          return deploy.status === "live";
        }, "the first deploy");
      }
    }

    await log(control, shardId, "Checking the server");
    await waitFor(() => verifyServer(current).then(() => true).catch(() => false), "the server to answer");
    await control.query("UPDATE shards SET status = 'active', updated_at = NOW() WHERE shard_id = $1", [shardId]);
    await log(control, shardId, "Ready");
  } catch (error) {
    await control.query("UPDATE shards SET status = 'failed', updated_at = NOW() WHERE shard_id = $1", [shardId]).catch(() => {});
    await log(control, shardId, `Stopped: ${error.message}`).catch(() => {});
  }
  registry.forgetShards();
}

async function createShard(input) {
  const { errors, values } = validateShard(input);
  const appUrl = String(input.appUrl || "").trim().replace(/\/$/, "");
  const databaseUrl = String(input.databaseUrl || "").trim();
  if (appUrl && !/^https?:\/\//.test(appUrl)) errors.push("The server address starts with https://.");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push("The database address starts with postgres://.");
  if (Boolean(appUrl) !== Boolean(databaseUrl)) errors.push("To connect existing servers, give both the server and the database address.");
  if (!appUrl && !render.isConfigured()) errors.push("Automatic creation needs RENDER_API_KEY, RENDER_OWNER_ID and SHARD_REPO_URL. Or create them on Render and enter both addresses.");
  if (!process.env.SHARD_SECRET) errors.push("Set SHARD_SECRET first.");
  if (!isSettingsEncryptionKeyConfigured()) errors.push("Set SETTINGS_ENCRYPTION_KEY first.");
  if (input.serverPlan && !SERVER_PLANS.has(input.serverPlan)) errors.push("Choose a server size.");
  if (input.databasePlan && !DATABASE_PLANS.has(input.databasePlan)) errors.push("Choose a database size.");
  if (errors.length) return { errors };

  const control = registry.controlDb();
  const block = await nextIdBlock(control, values.environment);
  let shard;
  try {
    shard = (await control.query(
      `INSERT INTO shards (name, environment, region, countries, hosting_location, status, accepts_new, capacity_schools, capacity_users, id_block, app_url)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', $6, $7, $8, $9, $10) RETURNING *`,
      [values.name, values.environment, values.region, values.countries, values.hostingLocation, values.environment === "production" && values.acceptsNew, values.capacitySchools, values.capacityUsers, block, appUrl || null]
    )).rows[0];
  } catch (error) {
    if (error.code === "23505") return { errors: [`There is already a shard called ${values.name}.`] };
    throw error;
  }
  registry.forgetShards();
  runProvision(shard.shard_id, {
    databaseUrl: databaseUrl || null,
    plans: { server: input.serverPlan, database: input.databasePlan },
    branch: values.environment === "production" ? "main" : (process.env.SHARD_TEST_BRANCH || "main"),
    schemaOptions: input.schemaOptions,
  });
  return { shard };
}

module.exports = { validateShard, nextIdBlock, prepareDatabase, createShard, runProvision, verifyServer, environmentFor, NAME_PATTERN };
