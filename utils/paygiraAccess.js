// utils/paygiraAccess.js
// Plan-feature gate for the PayGira module. Mirrors guardianPortalAccess.js.
// PayGira is a premium add-on: only organizations whose (effective) plan
// includes the "PayGira" feature can see and use it.

const PAYGIRA_FEATURE_NAMES = [
  "paygira",
  "pay gira",
  "paygira & payments",
  "paygira and payments",
];

const getEffectivePlanId = async (db, organizationId) => {
  const { rows } = await db.query(
    `SELECT o.plan_id, o.is_hub_member, COALESCE(o.hub_assigned_plan_id, mh.plan_id) AS hub_plan_id
     FROM organizations o
     LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
     WHERE o.organization_id = $1
     LIMIT 1`,
    [organizationId]
  );

  if (!rows.length) {
    return null;
  }

  const org = rows[0];
  return org.is_hub_member && org.hub_plan_id ? org.hub_plan_id : org.plan_id;
};

const hasPaygiraFeature = async (db, organizationId) => {
  if (!organizationId) {
    return false;
  }

  const planId = await getEffectivePlanId(db, organizationId);
  if (!planId) {
    return false;
  }

  const { rows } = await db.query(
    `SELECT 1
     FROM plan_features pf
     JOIN features f ON f.id = pf.feature_id
     LEFT JOIN feature_routes fr ON fr.feature_id = f.id
     WHERE pf.plan_id = $1
       AND (
         LOWER(TRIM(f.feature_name)) = ANY($2::text[])
         OR fr.route_path = '/account/settings/finance'
       )
     LIMIT 1`,
    [planId, PAYGIRA_FEATURE_NAMES]
  );

  return rows.length > 0;
};

module.exports = {
  hasPaygiraFeature,
  PAYGIRA_FEATURE_NAMES,
};
