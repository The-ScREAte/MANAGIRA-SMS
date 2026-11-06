// Who sees a new feature. Code reaches a whole shard at once; a feature named here can
// also be limited to chosen schools and hubs from the admin page. Reading it costs nothing:
// each server keeps a copy and refreshes it in the background.
const registry = require("./registry");

// Add a new feature here, then wrap it: isOn("key", { organizationId }).
const FEATURES = {
  transport_report_builder: { label: "Transportation reports", access: "everyone" },
};

const ACCESS = new Set(["off", "selected", "everyone"]);
const REFRESH_MS = Number(process.env.SHARD_CACHE_MS || 30000);

let saved = new Map();
let loading = null;

function refresh() {
  if (!loading) {
    loading = registry.controlDb().query(`
      SELECT a.feature_key, a.access, a.organization_ids, a.hub_ids,
             ARRAY(SELECT s.organization_id FROM shard_schools s WHERE s.hub_id = ANY(a.hub_ids)) AS hub_schools
        FROM shard_feature_access a`)
      .then(({ rows }) => {
        saved = new Map(rows.map((row) => [row.feature_key, {
          access: row.access,
          schools: new Set([...row.organization_ids, ...row.hub_schools].map(Number)),
          hubs: new Set(row.hub_ids.map(Number)),
        }]));
      })
      .catch(() => {}) // Keeps the last known answer. Before the migration: the defaults.
      .finally(() => { loading = null; });
  }
  return loading;
}

// Kept fresh on a timer, so a server that has been quiet never answers from an old copy.
let timer = null;
function keepFresh() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  timer.unref();
}

function isOn(key, { organizationId = null, hubId = null } = {}) {
  keepFresh();
  const entry = saved.get(key);
  const access = entry?.access || FEATURES[key]?.access || "everyone";
  if (access === "everyone") return true;
  if (access === "off" || !entry) return false;
  return entry.schools.has(Number(organizationId)) || entry.hubs.has(Number(hubId));
}

async function featureList() {
  const control = registry.controlDb();
  const [access, schools, hubs] = await Promise.all([
    control.query("SELECT * FROM shard_feature_access").then(({ rows }) => rows).catch(() => []),
    control.query("SELECT d.organization_id, d.name, d.hub_id, s.name AS shard FROM shard_schools d JOIN shards s ON s.shard_id = d.shard_id ORDER BY LOWER(d.name)").then(({ rows }) => rows).catch(() => []),
    control.query("SELECT d.hub_id, d.name, s.name AS shard FROM shard_hubs d JOIN shards s ON s.shard_id = d.shard_id ORDER BY LOWER(d.name)").then(({ rows }) => rows).catch(() => []),
  ]);
  const byKey = new Map(access.map((row) => [row.feature_key, row]));
  return {
    schools,
    hubs,
    features: Object.entries(FEATURES).map(([key, feature]) => ({
      key,
      label: feature.label,
      access: byKey.get(key)?.access || feature.access,
      organizationIds: byKey.get(key)?.organization_ids || [],
      hubIds: byKey.get(key)?.hub_ids || [],
    })),
  };
}

const toIds = (value) => [...new Set([].concat(value || []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);

async function saveFeature(key, { access, organizationIds, hubIds }, actor) {
  if (!Object.hasOwn(FEATURES, key)) throw new Error("That feature doesn't exist.");
  if (!ACCESS.has(access)) throw new Error("Choose who sees it.");
  await registry.controlDb().query(
    `INSERT INTO shard_feature_access (feature_key, access, organization_ids, hub_ids, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (feature_key) DO UPDATE SET access = EXCLUDED.access, organization_ids = EXCLUDED.organization_ids,
       hub_ids = EXCLUDED.hub_ids, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, access, toIds(organizationIds), toIds(hubIds), actor]
  );
  await refresh();
}

module.exports = { FEATURES, isOn, featureList, saveFeature, refresh };
