"use strict";

const cacheManager = require("./cacheManager");

const ACCESS_PLAN_CACHE_TTL_SEC = Number(process.env.ACCESS_PLAN_CACHE_TTL_SEC || 90);

async function resolvePlanForOrganization(db, organizationId) {
  if (!organizationId) {
    return null;
  }

  const cacheKey = `access:org-plan:${organizationId}`;

  return cacheManager.getOrFetch(
    "organization",
    cacheKey,
    async () => {
      try {
        const { rows: orgRows } = await db.query(
          `SELECT o.plan_id, o.is_hub_member, o.hub_id, mh.plan_id AS hub_plan_id
           FROM organizations o
           LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
           WHERE o.organization_id = $1`,
          [organizationId]
        );

        if (orgRows.length === 0) {
          return null;
        }

        const org = orgRows[0];
        const planId = org.is_hub_member && org.hub_plan_id ? org.hub_plan_id : org.plan_id;

        return {
          planId: planId || null,
          hubId: org.hub_id || null,
          isHubMember: Boolean(org.is_hub_member),
        };
      } catch (columnError) {
        const { rows: orgRows } = await db.query(
          "SELECT plan_id FROM organizations WHERE organization_id = $1",
          [organizationId]
        );

        if (orgRows.length === 0) {
          return null;
        }

        return {
          planId: orgRows[0].plan_id || null,
          hubId: null,
          isHubMember: false,
        };
      }
    },
    { ttl: ACCESS_PLAN_CACHE_TTL_SEC }
  );
}

function invalidateOrganizationAccessCache(organizationId) {
  if (!organizationId) {
    return;
  }

  const orgId = String(organizationId);
  cacheManager.invalidatePattern("organization", `access:org-plan:${orgId}`);
  cacheManager.invalidatePattern("organization", `access:allowed-features:${orgId}:`);
  cacheManager.invalidatePattern("organization", `perm:primary-manager:${orgId}`);
  cacheManager.invalidatePattern("organization", `perm:user:${orgId}:`);
  cacheManager.invalidatePattern("organization", `perm:owner-email:${orgId}:`);
}

function invalidatePlanFeatureAccess(planId) {
  if (!planId) {
    return;
  }

  cacheManager.invalidatePattern("static", `access:plan-feature:${planId}:`);
}

function invalidateRouteFeatureCache() {
  cacheManager.invalidatePattern("static", "access:route-feature:");
}

async function invalidateAccessForPlan(db, planId) {
  if (!planId) {
    return 0;
  }

  const directOrgs = await db.query(
    `SELECT organization_id
     FROM organizations
     WHERE deleted = false AND plan_id = $1`,
    [planId]
  );

  const hubMemberOrgs = await db.query(
    `SELECT o.organization_id
     FROM organizations o
     JOIN managira_hubs h ON h.hub_id = o.hub_id
     WHERE o.deleted = false
       AND COALESCE(o.is_hub_member, false) = true
       AND h.plan_id = $1`,
    [planId]
  );

  const affectedOrgIds = new Set();
  for (const row of directOrgs.rows) {
    affectedOrgIds.add(row.organization_id);
  }
  for (const row of hubMemberOrgs.rows) {
    affectedOrgIds.add(row.organization_id);
  }

  for (const orgId of affectedOrgIds) {
    invalidateOrganizationAccessCache(orgId);
  }

  invalidatePlanFeatureAccess(planId);
  return affectedOrgIds.size;
}

module.exports = {
  resolvePlanForOrganization,
  invalidateOrganizationAccessCache,
  invalidatePlanFeatureAccess,
  invalidateRouteFeatureCache,
  invalidateAccessForPlan,
};
