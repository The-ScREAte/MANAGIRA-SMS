const GUARDIAN_PORTAL_FEATURE_NAMES = [
  "parent/guardian portal",
  "guardian portal",
  "parent portal",
  "parent guardian portal",
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

// The parent portal is an add-on: the school's own switch (Settings › Integrations) decides.
// A school that hasn't chosen (empty) follows its plan, as before. Before the migration that
// adds the switch has run, the plan decides.
const getParentPortalSwitch = async (db, organizationId) => {
  try {
    const { rows } = await db.query(
      "SELECT parent_portal_activated FROM organizations WHERE organization_id = $1 LIMIT 1",
      [organizationId]
    );
    const value = rows[0] ? rows[0].parent_portal_activated : null;
    return value === true || value === false ? value : null;
  } catch (error) {
    if (error && error.code === "42703") return null; // the column isn't there yet
    throw error;
  }
};

const hasGuardianPortalFeature = async (db, organizationId) => {
  if (!organizationId) {
    return false;
  }

  const chosen = await getParentPortalSwitch(db, organizationId);
  if (chosen !== null) return chosen;
  return planHasGuardianPortal(db, organizationId);
};

// Whether the school's plan (or its hub's) has the parent portal: what a school follows until it
// switches the add-on on or off itself.
const planHasGuardianPortal = async (db, organizationId) => {
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
         OR fr.route_path = '/guardian'
       )
     LIMIT 1`,
    [planId, GUARDIAN_PORTAL_FEATURE_NAMES]
  );

  return rows.length > 0;
};

async function setParentPortalActivation(db, organizationId, activated) {
  await db.query(
    "UPDATE organizations SET parent_portal_activated = $2 WHERE organization_id = $1",
    [organizationId, Boolean(activated)]
  );
}

module.exports = {
  hasGuardianPortalFeature,
  planHasGuardianPortal,
  setParentPortalActivation,
};
