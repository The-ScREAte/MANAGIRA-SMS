const test = require("node:test");
const assert = require("node:assert");
const registry = require("../utils/shards/registry");
const features = require("../utils/shards/features");
const { moveSchool } = require("../utils/shards/moveSchool");

const SANDBOX_SCHOOL = 63;
const MAIN_SCHOOL = 146;
const RELEASED_SCHOOL = 148;
const SANDBOX_HUB = 2;

function fakeControl(accessRows) {
  return {
    query: async (sql) => {
      if (/FROM shard_feature_access a/.test(sql)) return { rows: accessRows };
      if (/environment = 'sandbox'/.test(sql)) return { rows: [{ organization_id: SANDBOX_SCHOOL, hub_id: null }, { organization_id: null, hub_id: SANDBOX_HUB }] };
      return { rows: [] };
    },
  };
}

// A refresh already under way keeps its answer, so the next one reads what's now in place.
async function useControl(control) {
  registry.controlDb = () => control;
  await features.refresh();
  await features.refresh();
}

test("one database: the sandbox and the main shard share it, and nothing else does", () => {
  const main = { is_control: true, same_database: false };
  const sandbox = { is_control: false, same_database: true };
  const other = { is_control: false, same_database: false };
  assert.strictEqual(registry.sharesDatabase(main, sandbox), true);
  assert.strictEqual(registry.sharesDatabase(sandbox, main), true);
  assert.strictEqual(registry.sharesDatabase(main, other), false);
  assert.strictEqual(registry.sharesDatabase(sandbox, other), false);
});

test("a move between two shards on one database is refused before touching anything", async () => {
  const url = "postgres://user:one@db.example.com:5432/managira";
  const sameWithOtherLogin = "postgres://other:two@db.example.com/managira";
  await assert.rejects(moveSchool({ organizationIds: [SANDBOX_SCHOOL], sourceUrl: url, destinationUrl: url }), /share a database/);
  await assert.rejects(moveSchool({ organizationIds: [SANDBOX_SCHOOL], sourceUrl: url, destinationUrl: sameWithOtherLogin }), /share a database/);
});

test("a new feature reaches the sandbox only, until it's released", async (t) => {
  // A feature on its first, sandbox-only release (a stand-in, so this holds whatever is released).
  const NEW = "test_new_feature";
  features.FEATURES[NEW] = { label: "Test feature", access: "selected" };
  const original = registry.controlDb;
  t.after(() => { registry.controlDb = original; delete features.FEATURES[NEW]; });

  await useControl(fakeControl([]));
  assert.strictEqual(features.isOn(NEW, { organizationId: SANDBOX_SCHOOL }), true);
  assert.strictEqual(features.isOn(NEW, { hubId: SANDBOX_HUB }), true);
  assert.strictEqual(features.isOn(NEW, { organizationId: MAIN_SCHOOL }), false);
  assert.strictEqual(features.isOn(NEW, {}), false);

  await useControl(fakeControl([{ feature_key: NEW, access: "selected", organization_ids: [RELEASED_SCHOOL], hub_ids: [], reached_schools: [], reached_hubs: [] }]));
  assert.strictEqual(features.isOn(NEW, { organizationId: RELEASED_SCHOOL }), true);
  assert.strictEqual(features.isOn(NEW, { organizationId: MAIN_SCHOOL }), false);

  // Released to a whole shard: the query already expands it to that shard's schools.
  await useControl(fakeControl([{ feature_key: NEW, access: "selected", organization_ids: [], hub_ids: [], reached_schools: [MAIN_SCHOOL], reached_hubs: [] }]));
  assert.strictEqual(features.isOn(NEW, { organizationId: MAIN_SCHOOL }), true);

  await useControl(fakeControl([{ feature_key: NEW, access: "everyone", organization_ids: [], hub_ids: [], reached_schools: [], reached_hubs: [] }]));
  assert.strictEqual(features.isOn(NEW, { organizationId: 999 }), true);

  await useControl(fakeControl([{ feature_key: NEW, access: "off", organization_ids: [], hub_ids: [], reached_schools: [], reached_hubs: [] }]));
  assert.strictEqual(features.isOn(NEW, { organizationId: SANDBOX_SCHOOL }), false);

  // What was already out for everyone stays that way.
  assert.strictEqual(features.isOn("transport_report_builder", { organizationId: MAIN_SCHOOL }), true);
});

test("a failed read keeps the last answer, so a database hiccup can't open a feature to everyone", async (t) => {
  const NEW = "test_new_feature";
  features.FEATURES[NEW] = { label: "Test feature", access: "selected" };
  const original = registry.controlDb;
  t.after(() => { registry.controlDb = original; delete features.FEATURES[NEW]; });
  await useControl(fakeControl([]));
  await useControl({ query: async () => { throw new Error("busy"); } });
  assert.strictEqual(features.isOn(NEW, { organizationId: MAIN_SCHOOL }), false);
  assert.strictEqual(features.isOn(NEW, { organizationId: SANDBOX_SCHOOL }), true);
});
