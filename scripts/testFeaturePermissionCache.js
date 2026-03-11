"use strict";

const assert = require("assert");
const cacheManager = require("../utils/cacheManager");
const {
  resolvePlanForOrganization,
  invalidateOrganizationAccessCache,
  invalidatePlanFeatureAccess,
} = require("../utils/accessCache");
const { invalidateUserPermissionCache } = require("../middleware/permissionMiddleware");

async function testResolvePlanCaching() {
  let queryCount = 0;
  const fakeDb = {
    async query(sql) {
      queryCount += 1;
      if (String(sql).includes("LEFT JOIN managira_hubs")) {
        return {
          rows: [
            {
              plan_id: 3,
              is_hub_member: false,
              hub_id: null,
              hub_plan_id: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const first = await resolvePlanForOrganization(fakeDb, 9991);
  const second = await resolvePlanForOrganization(fakeDb, 9991);

  assert.equal(first.planId, 3);
  assert.equal(second.planId, 3);
  assert.equal(queryCount, 1, "Expected org plan lookup to be cached");

  invalidateOrganizationAccessCache(9991);

  const third = await resolvePlanForOrganization(fakeDb, 9991);
  assert.equal(third.planId, 3);
  assert.equal(queryCount, 2, "Expected DB lookup after org cache invalidation");
}

function testPlanFeatureInvalidation() {
  cacheManager.set("static", "access:plan-feature:77:101", { allowed: true }, 60);
  assert.deepEqual(cacheManager.get("static", "access:plan-feature:77:101"), { allowed: true });

  invalidatePlanFeatureAccess(77);

  assert.equal(
    cacheManager.get("static", "access:plan-feature:77:101"),
    undefined,
    "Expected plan-feature cache key to be invalidated"
  );
}

function testPermissionInvalidation() {
  cacheManager.set("organization", "perm:user:12:45", ["manage_reports"], 60);
  cacheManager.set("organization", "perm:primary-manager:12", 45, 60);
  cacheManager.set("organization", "perm:owner-email:12:user@example.com", true, 60);

  assert.ok(Array.isArray(cacheManager.get("organization", "perm:user:12:45")));
  assert.equal(cacheManager.get("organization", "perm:primary-manager:12"), 45);

  invalidateUserPermissionCache(12, 45);

  assert.equal(cacheManager.get("organization", "perm:user:12:45"), undefined);
  assert.equal(cacheManager.get("organization", "perm:primary-manager:12"), undefined);
  assert.equal(cacheManager.get("organization", "perm:owner-email:12:user@example.com"), undefined);
}

async function run() {
  console.log("Running feature/permission cache tests...\n");

  await testResolvePlanCaching();
  console.log("PASS: Organization plan lookup cache + invalidation works.");

  testPlanFeatureInvalidation();
  console.log("PASS: Plan-feature access invalidation works.");

  testPermissionInvalidation();
  console.log("PASS: Permission cache invalidation works.");

  console.log("\nAll feature/permission cache tests passed.");
}

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
