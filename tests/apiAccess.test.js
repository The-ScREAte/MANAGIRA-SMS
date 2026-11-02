const test = require("node:test");
const assert = require("node:assert/strict");

const api = require("../utils/apiAccess");

const ALL_ON = { paygira: true, transport: true };

test("credentials are long, random, prefixed and stored only as a hash", () => {
  const a = api.newCredential("mgr_pat");
  const b = api.newCredential("mgr_pat");
  assert.match(a, /^mgr_pat_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(api.sha256(a), api.sha256(a));
  assert.equal(api.sha256(a).length, 64);
  assert.notEqual(api.sha256(a), api.sha256(b));
});

test("each data area is one scope, and a service account with no areas gets nothing", () => {
  assert.equal(new Set(api.API_AREAS.map((a) => a.scope)).size, api.API_AREAS.length);
  assert.deepEqual(api.effectiveScopes(api.ALL_PERMISSION_KEYS, [], ALL_ON), []);
  assert.ok(api.groupAvailability([], ALL_ON).every((g) => !g.available));
});

test("a token never has more than its service account allows now", () => {
  const all = api.effectiveScopes(["students", "guardians"], api.ALL_PERMISSION_KEYS, ALL_ON);
  assert.deepEqual(all, ["guardians.read", "managira.api.access", "students.read", "tenant.read"]);
  const shrunk = api.effectiveScopes(["students", "guardians"], ["guardians"], ALL_ON);
  assert.ok(!shrunk.includes("students.read"));
  assert.ok(shrunk.includes("guardians.read"));
  assert.deepEqual(api.effectiveScopes(["unknown", "../../etc"], api.ALL_PERMISSION_KEYS, ALL_ON), []);
});

test("PayGira and Transportation only count while the school uses them", () => {
  const off = api.groupAvailability(api.ALL_PERMISSION_KEYS, { paygira: false, transport: false });
  assert.equal(off.find((g) => g.key === "paygira").available, false);
  assert.match(off.find((g) => g.key === "paygira").reason, /PayGira/);
  assert.equal(off.find((g) => g.key === "transport").available, false);
  assert.deepEqual(api.effectiveScopes(["paygira", "transport"], api.ALL_PERMISSION_KEYS, { paygira: false, transport: false }), []);
  assert.ok(api.effectiveScopes(["paygira"], ["paygira"], { paygira: true }).includes("paygira.read"));
});

test("only the areas saved on a service account count (new areas need a new agreement)", () => {
  assert.deepEqual(api.permissionsOf({ all_permissions: true, permissions: ["students"] }), ["students"]);
  assert.deepEqual(api.permissionsOf({ all_permissions: false, permissions: ["students", "manage_billing", "admin"] }), ["students"]);
  assert.match(api.AGREEMENT_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test("usage is counted in UTC minute and day buckets", () => {
  const { dayKey, minuteKey, DEFAULT_ALLOWANCE, WARN_AT } = require("../utils/apiAllowance");
  const d = new Date(Date.UTC(2026, 10, 1, 23, 59, 30));
  assert.equal(dayKey(d), "2026-11-01");
  assert.equal(minuteKey(d), "2026-11-01T23:59");
  assert.equal(DEFAULT_ALLOWANCE.perMinute, 120);
  assert.equal(DEFAULT_ALLOWANCE.perDay, 10000);
  assert.ok(WARN_AT > 0 && WARN_AT < 1);
});
