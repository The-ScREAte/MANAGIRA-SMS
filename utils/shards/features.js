// Who sees a new feature. A new feature starts on the sandbox shard only. From the admin
// page it can then go to other shards, hubs and schools, or to everyone. Reading it costs
// nothing: each server keeps a copy and refreshes it in the background.
const registry = require("./registry");

// Add a new feature here with access "selected", then wrap it: isOn("key", { organizationId }).
const FEATURES = {
  transport_report_builder: { label: "Transportation reports", access: "everyone" },
  bus_boarding: { label: "Bus boarding and not coming", access: "everyone" },
  class_activities: { label: "Activities and calendars", access: "everyone" },
  parent_student_hub: { label: "Parent tiles and homework help", access: "everyone" },
  sso: { label: "Single sign-on (SAML and OpenID Connect)", access: "everyone" },
  // The login page has one email box for everyone and no links to the other portals, so taking
  // parents, students and hubs to their own portal is on for everyone. Each portal still checks
  // its own password.
  smart_login: { label: "Main login takes parents, students and hubs to their portal", access: "everyone" },
  login_code: { label: "Verification code by email at sign-in", access: "everyone" },
  new_landing: { label: "New managira.com homepage and Mira page (release to everyone to show it)", access: "everyone" },
  mira_outreach: { label: "Mira: students below an attendance level, and a message draft for each family", access: "everyone" },
  tenant_config: { label: "Tenant configuration: sign-in rules in Settings, and signing out after 24 hours unless a school changes it", access: "everyone" },
  family_sharing: { label: "Emergency & pickup details shared with parents (who can update them), students, teachers and drivers", access: "everyone" },
  website_designs: { label: "School website: 3D designs that move as visitors scroll, emblem designs with the school's mascot as a watermark, and photos always shown whole", access: "everyone" },
};

const ACCESS = new Set(["off", "selected", "everyone"]);
const REFRESH_MS = Number(process.env.SHARD_CACHE_MS || 30000);

let saved = new Map();
let sandbox = { schools: new Set(), hubs: new Set() };
let loading = null;

function refresh() {
  if (!loading) {
    const control = registry.controlDb();
    loading = Promise.all([
      control.query(`
        SELECT a.feature_key, a.access, a.organization_ids, a.hub_ids,
               ARRAY(SELECT s.organization_id FROM shard_schools s WHERE s.hub_id = ANY(a.hub_ids) OR s.shard_id = ANY(a.shard_ids)) AS reached_schools,
               ARRAY(SELECT h.hub_id FROM shard_hubs h WHERE h.shard_id = ANY(a.shard_ids)) AS reached_hubs
          FROM shard_feature_access a`)
        .then(({ rows }) => {
          saved = new Map(rows.map((row) => [row.feature_key, {
            access: row.access,
            schools: new Set([...row.organization_ids, ...row.reached_schools].map(Number)),
            hubs: new Set([...row.hub_ids, ...row.reached_hubs].map(Number)),
          }]));
        }),
      control.query(`
        SELECT d.organization_id, NULL::int AS hub_id FROM shard_schools d JOIN shards s ON s.shard_id = d.shard_id WHERE s.environment = 'sandbox'
        UNION ALL
        SELECT NULL, h.hub_id FROM shard_hubs h JOIN shards s ON s.shard_id = h.shard_id WHERE s.environment = 'sandbox'`)
        .then(({ rows }) => {
          sandbox = {
            schools: new Set(rows.filter((row) => row.organization_id).map((row) => Number(row.organization_id))),
            hubs: new Set(rows.filter((row) => row.hub_id).map((row) => Number(row.hub_id))),
          };
        }),
    ])
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
  if (access === "off") return false;
  if (sandbox.schools.has(Number(organizationId)) || sandbox.hubs.has(Number(hubId))) return true;
  if (!entry) return false;
  return entry.schools.has(Number(organizationId)) || entry.hubs.has(Number(hubId));
}

async function featureList() {
  const control = registry.controlDb();
  const [access, schools, hubs, shards] = await Promise.all([
    control.query("SELECT * FROM shard_feature_access").then(({ rows }) => rows).catch(() => []),
    control.query("SELECT d.organization_id, d.name, d.hub_id, s.name AS shard FROM shard_schools d JOIN shards s ON s.shard_id = d.shard_id ORDER BY LOWER(d.name)").then(({ rows }) => rows).catch(() => []),
    control.query("SELECT d.hub_id, d.name, s.name AS shard FROM shard_hubs d JOIN shards s ON s.shard_id = d.shard_id ORDER BY LOWER(d.name)").then(({ rows }) => rows).catch(() => []),
    registry.listShards({ fresh: true }),
  ]);
  const onSandbox = (row) => shards.some((shard) => shard.name === row.shard && shard.environment === "sandbox");
  const byKey = new Map(access.map((row) => [row.feature_key, row]));
  return {
    schools: schools.map((row) => ({ ...row, sandbox: onSandbox(row) })),
    hubs: hubs.map((row) => ({ ...row, sandbox: onSandbox(row) })),
    shards: shards.filter((shard) => shard.status === "active" && shard.environment !== "sandbox"),
    sandboxName: shards.find((shard) => shard.environment === "sandbox")?.name || null,
    features: Object.entries(FEATURES).map(([key, feature]) => ({
      key,
      label: feature.label,
      access: byKey.get(key)?.access || feature.access,
      organizationIds: byKey.get(key)?.organization_ids || [],
      hubIds: byKey.get(key)?.hub_ids || [],
      shardIds: byKey.get(key)?.shard_ids || [],
    })),
  };
}

const toIds = (value) => [...new Set([].concat(value || []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);

async function saveFeature(key, { access, organizationIds, hubIds, shardIds }, actor) {
  if (!Object.hasOwn(FEATURES, key)) throw new Error("That feature doesn't exist.");
  if (!ACCESS.has(access)) throw new Error("Choose who sees it.");
  await registry.controlDb().query(
    `INSERT INTO shard_feature_access (feature_key, access, organization_ids, hub_ids, shard_ids, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (feature_key) DO UPDATE SET access = EXCLUDED.access, organization_ids = EXCLUDED.organization_ids,
       hub_ids = EXCLUDED.hub_ids, shard_ids = EXCLUDED.shard_ids, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, access, toIds(organizationIds), toIds(hubIds), toIds(shardIds), actor]
  );
  await refresh();
}

module.exports = { FEATURES, isOn, featureList, saveFeature, refresh, keepFresh };
