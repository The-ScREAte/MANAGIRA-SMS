// The shard registry and school directory. They live in the control database, which is
// this shard's own database until CONTROL_DB_URL says otherwise. With one shard, every
// answer here is "stay where you are", at the cost of one small query every 30 seconds.
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const localDb = require("../../config/db");
const { decryptSecretOrThrow, encryptSecret } = require("../encryption");
const { signCall, testShardSecret } = require("./signing");

const REGIONS = {
  us: ["US", "CA", "MX", "PR"],
  af: ["GH", "NG", "KE", "TZ", "UG", "ZA", "RW", "ET", "SN", "CI", "CM", "ZM", "ZW", "BW", "SL", "LR", "GM", "BJ", "TG", "BF", "ML", "NE", "MW", "MZ", "AO", "NA", "EG", "MA", "DZ", "TN"],
};
const SHARD_CACHE_MS = Number(process.env.SHARD_CACHE_MS || 30000);
const CALL_TIMEOUT_MS = 4000;

const CONTROL_SHARD_NAME = "us-shard-01";
const thisShardName = () => process.env.SHARD_NAME || CONTROL_SHARD_NAME;
const regionForCountry = (country) => {
  const code = String(country || "").trim().toUpperCase();
  return Object.keys(REGIONS).find((region) => REGIONS[region].includes(code)) || null;
};

let controlPool = null;
function controlDb() {
  const url = process.env.CONTROL_DB_URL;
  if (!url) return localDb;
  if (!controlPool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    controlPool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 30000, application_name: "managira-control" });
    controlPool.on("error", (error) => console.error("[shards] control database:", error.message));
  }
  return controlPool;
}

let cached = { at: 0, shards: [] };
let loading = null;

// Every shard, from a short-lived copy. Before the migration runs: just an empty list.
async function listShards({ fresh = false } = {}) {
  if (!fresh && Date.now() - cached.at < SHARD_CACHE_MS) return cached.shards;
  if (!loading) {
    loading = controlDb().query("SELECT * FROM shards ORDER BY status = 'retired', is_control DESC, environment = 'production' DESC, name")
      .then(({ rows }) => { cached = { at: Date.now(), shards: rows }; return rows; })
      .catch(() => { cached = { at: Date.now(), shards: [] }; return []; })
      .finally(() => { loading = null; });
  }
  return loading;
}
const forgetShards = () => { cached = { at: 0, shards: [] }; };

const isLive = (shard) => shard.status === "active";
// The sandbox shard and the main shard are one database: nothing is ever copied between them.
const sharesDatabase = (a, b) => Boolean((a.same_database || a.is_control) && (b.same_database || b.is_control) && (a.same_database || b.same_database));
const isProduction = (shard) => shard.environment === "production";

async function thisShard() {
  return (await listShards()).find((shard) => shard.name === thisShardName()) || null;
}

async function otherLiveShards() {
  const me = thisShardName();
  return (await listShards()).filter((shard) => isLive(shard) && isProduction(shard) && shard.name !== me && shard.app_url);
}

// Where a new school goes: a production shard that serves its country, accepts new
// schools and has room. The least full wins. Nothing fits: the control shard.
async function pickShardForCountry(country) {
  const shards = (await listShards()).filter(isLive).filter(isProduction);
  if (!shards.length) return null;
  const code = String(country || "").trim().toUpperCase();
  const region = regionForCountry(code);
  const { rows: counts } = await controlDb().query("SELECT shard_id, COUNT(*)::int AS schools FROM shard_schools GROUP BY shard_id").catch(() => ({ rows: [] }));
  const schoolsOn = new Map(counts.map((row) => [row.shard_id, row.schools]));
  const fits = shards.filter((shard) => {
    if (!shard.accepts_new || (schoolsOn.get(shard.shard_id) || 0) >= shard.capacity_schools) return false;
    if (shard.countries.length) return shard.countries.includes(code);
    return shard.region === region;
  });
  const byRoom = (a, b) => (schoolsOn.get(a.shard_id) || 0) / a.capacity_schools - (schoolsOn.get(b.shard_id) || 0) / b.capacity_schools;
  // A shard named for this country beats one that covers the whole region.
  const named = fits.filter((shard) => shard.countries.includes(code)).sort(byRoom);
  const regional = fits.filter((shard) => !shard.countries.length).sort(byRoom);
  return named[0] || regional[0] || shards.find((shard) => shard.is_control) || shards[0];
}

// ---- Calling another shard ------------------------------------------------------------
async function callShard(shard, path, payload = {}) {
  const body = JSON.stringify(payload);
  const response = await fetch(`${String(shard.app_url).replace(/\/$/, "")}/internal/shard${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...signCall(body, shard.environment === "production" || !shard.environment ? undefined : testShardSecret()) },
    body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${shard.name} answered ${response.status}`);
  return response.json();
}

// Which other shard this person signs in on. Asked only when this shard doesn't know them.
async function findLoginElsewhere(login, password) {
  const others = await otherLiveShards();
  if (!others.length) return null;
  const answers = await Promise.allSettled(others.map((shard) => callShard(shard, "/who", { login, password }).then((answer) => (answer.found ? shard : null))));
  return answers.map((answer) => (answer.status === "fulfilled" ? answer.value : null)).find(Boolean) || null;
}

// A record of who did what. Never blocks the action itself.
function audit(req, action, target = null, detail = null) {
  const actor = req?.shardActor || "unknown";
  return controlDb().query(
    "INSERT INTO shard_audit (actor, action, target, detail, ip) VALUES ($1, $2, $3, $4, $5)",
    [actor, action, target, detail ? JSON.stringify(detail) : null, req?.ip || null]
  ).catch((error) => console.error("[shards] audit:", error.message));
}

// ---- This shard's own facts -----------------------------------------------------------
const LOGIN_HASHES = `
  SELECT password AS hash FROM users WHERE LOWER(email) = LOWER($1)
  UNION ALL SELECT password FROM organizations WHERE LOWER(email) = LOWER($1)
  UNION ALL SELECT password_hash FROM guardian_accounts WHERE LOWER(login_email) = LOWER($1) OR login_phone = $1
  UNION ALL SELECT password_hash FROM student_accounts WHERE LOWER(login_email) = LOWER($1)
  UNION ALL SELECT password FROM hub_users WHERE LOWER(email) = LOWER($1)
  UNION ALL SELECT hub_password FROM managira_hubs WHERE LOWER(hub_email) = LOWER($1)`;

async function knowsLogin(login, db = localDb) {
  if (!login) return false;
  return (await db.query(LOGIN_HASHES, [String(login).trim()])).rows.length > 0;
}

// Yes only for the right password, so a sign-in form can't be used to find out which
// emails exist on other shards.
async function credentialsMatch(login, password, db = localDb) {
  if (!login || !password) return false;
  const { rows } = await db.query(LOGIN_HASHES, [String(login).trim()]);
  for (const { hash } of rows) {
    if (hash && await bcrypt.compare(String(password), hash)) return true;
  }
  return false;
}

async function shardStats(db = localDb) {
  const [schools, sessions, database] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS schools,
        (SELECT COUNT(*)::int FROM users WHERE organization_id IS NOT NULL) AS staff,
        (SELECT COUNT(*)::int FROM students) AS students,
        (SELECT COUNT(*)::int FROM guardian_accounts) AS parents
      FROM organizations WHERE COALESCE(deleted, FALSE) = FALSE`),
    db.query("SELECT COUNT(*)::int AS active FROM user_sessions WHERE expire > NOW()").catch(() => ({ rows: [{ active: null }] })),
    db.query(`SELECT pg_database_size(current_database())::bigint AS bytes,
        (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
        current_setting('max_connections')::int AS max_connections`),
  ]);
  const memory = process.memoryUsage();
  return {
    name: thisShardName(),
    commit: process.env.RENDER_GIT_COMMIT || null,
    ...schools.rows[0],
    activeSessions: sessions.rows[0].active,
    databaseBytes: Number(database.rows[0].bytes),
    connections: database.rows[0].connections,
    maxConnections: database.rows[0].max_connections,
    memoryBytes: memory.rss,
    uptimeSeconds: Math.round(process.uptime()),
    healthy: true,
  };
}

// Live facts from one shard. A shard that doesn't answer is reported, never fatal.
async function statsFor(shard) {
  if (shard.name === thisShardName()) return shardStats().catch((error) => ({ healthy: false, error: error.message }));
  if (shard.same_database && !shard.app_url) return { healthy: true, sharedServer: true };
  if (!shard.app_url) return { healthy: false, error: "No server connected yet." };
  return callShard(shard, "/stats").catch((error) => ({ healthy: false, error: error.message }));
}

// ---- The directory --------------------------------------------------------------------
// Each shard reports its schools to the control database. A school that has moved is
// only ever updated by the shard it now lives on.
async function syncDirectory(db = localDb) {
  const me = await thisShard();
  if (!me || me.same_database) return 0; // Its schools are in the main shard's database.
  const { rows } = await db.query(`
    SELECT o.organization_id, o.nickname AS subdomain, o.organization_name AS name, o.organization_country AS country, o.hub_id,
           (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.organization_id) AS staff,
           (SELECT COUNT(*)::int FROM students s WHERE s.organization_id = o.organization_id) AS students,
           (SELECT COUNT(*)::int FROM guardian_accounts g WHERE g.organization_id = o.organization_id) AS parents
      FROM organizations o
     WHERE COALESCE(o.deleted, FALSE) = FALSE AND o.shard_move_state IS NULL`);
  const control = controlDb();
  if (rows.length) {
    await control.query(`
      INSERT INTO shard_schools (organization_id, shard_id, subdomain, name, country, hub_id, staff_count, student_count, parent_count, updated_at)
      SELECT r.organization_id, $2, r.subdomain, r.name, r.country, r.hub_id, r.staff, r.students, r.parents, NOW()
        FROM JSON_TO_RECORDSET($1::json) AS r(organization_id INT, subdomain TEXT, name TEXT, country TEXT, hub_id INT, staff INT, students INT, parents INT)
      ON CONFLICT (organization_id) DO UPDATE SET
        subdomain = EXCLUDED.subdomain, name = EXCLUDED.name, country = EXCLUDED.country, hub_id = EXCLUDED.hub_id,
        staff_count = EXCLUDED.staff_count, student_count = EXCLUDED.student_count, parent_count = EXCLUDED.parent_count, updated_at = NOW()
      WHERE shard_schools.shard_id = EXCLUDED.shard_id OR shard_schools.shard_id IN (SELECT shard_id FROM shards WHERE same_database)`, [JSON.stringify(rows), me.shard_id]);
  }
  // A hub keeps its row while it moves; only the shard it lives on can change the details.
  const { rows: hubs } = await db.query("SELECT hub_id, hub_nickname AS subdomain, hub_name AS name FROM managira_hubs");
  if (hubs.length) {
    await control.query(`
      INSERT INTO shard_hubs (hub_id, shard_id, subdomain, name, updated_at)
      SELECT r.hub_id, $2, r.subdomain, r.name, NOW() FROM JSON_TO_RECORDSET($1::json) AS r(hub_id INT, subdomain TEXT, name TEXT)
      ON CONFLICT (hub_id) DO UPDATE SET subdomain = EXCLUDED.subdomain, name = EXCLUDED.name, updated_at = NOW()
      WHERE shard_hubs.shard_id = EXCLUDED.shard_id OR shard_hubs.shard_id IN (SELECT shard_id FROM shards WHERE same_database)`, [JSON.stringify(hubs), me.shard_id]);
  }
  await control.query("DELETE FROM shard_hubs WHERE (shard_id = $1 OR shard_id IN (SELECT shard_id FROM shards WHERE same_database)) AND NOT (hub_id = ANY($2::int[]))", [me.shard_id, hubs.map((hub) => hub.hub_id)]);
  // Schools that no longer exist on this shard leave the directory.
  await control.query(
    "DELETE FROM shard_schools WHERE (shard_id = $1 OR shard_id IN (SELECT shard_id FROM shards WHERE same_database)) AND status = 'active' AND NOT (organization_id = ANY($2::int[]))",
    [me.shard_id, rows.map((row) => row.organization_id)]
  );
  return rows.length;
}

const shardDatabaseUrl = (shard) => {
  if (shard.db_url_encrypted) return decryptSecretOrThrow(shard.db_url_encrypted);
  if (shard.name === thisShardName()) return process.env.DB_CONNECTION_STRING;
  throw new Error(`${shard.name} has no database connected yet.`);
};
const encryptDatabaseUrl = (url) => encryptSecret(url);

module.exports = {
  REGIONS,
  CONTROL_SHARD_NAME,
  thisShardName,
  regionForCountry,
  controlDb,
  listShards,
  forgetShards,
  thisShard,
  sharesDatabase,
  otherLiveShards,
  pickShardForCountry,
  callShard,
  findLoginElsewhere,
  knowsLogin,
  credentialsMatch,
  audit,
  shardStats,
  statsFor,
  syncDirectory,
  shardDatabaseUrl,
  encryptDatabaseUrl,
};
