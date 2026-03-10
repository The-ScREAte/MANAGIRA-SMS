async function getOrganizationWebsiteInfo(db, organizationId) {
  if (!organizationId) {
    return {
      hasWebsiteFeature: false,
      hasWebsite: false,
      websiteHost: null,
      websiteUrl: null,
      nickname: null,
    };
  }

  let org;
  let planIdToCheck = null;

  try {
    const orgResult = await db.query(
      "SELECT plan_id, nickname, is_hub_member, hub_id FROM organizations WHERE organization_id = $1",
      [organizationId]
    );
    org = orgResult.rows[0];
  } catch (error) {
    // Backward-compatible fallback for installations without hub columns.
    const orgResult = await db.query(
      "SELECT plan_id, nickname FROM organizations WHERE organization_id = $1",
      [organizationId]
    );
    org = orgResult.rows[0];
  }

  if (!org) {
    return {
      hasWebsiteFeature: false,
      hasWebsite: false,
      websiteHost: null,
      websiteUrl: null,
      nickname: null,
    };
  }

  planIdToCheck = org.plan_id || null;

  if (org.is_hub_member && org.hub_id) {
    try {
      const hubResult = await db.query(
        "SELECT plan_id FROM managira_hubs WHERE hub_id = $1",
        [org.hub_id]
      );
      if (hubResult.rows[0]?.plan_id) {
        planIdToCheck = hubResult.rows[0].plan_id;
      }
    } catch (error) {
      // Ignore and keep org plan fallback.
    }
  }

  if (!planIdToCheck) {
    return {
      hasWebsiteFeature: false,
      hasWebsite: false,
      websiteHost: null,
      websiteUrl: null,
      nickname: org.nickname || null,
    };
  }

  const featureResult = await db.query(
    `SELECT 1
       FROM plan_features pf
       JOIN features f ON f.id = pf.feature_id
      WHERE pf.plan_id = $1
        AND LOWER(TRIM(f.feature_name)) = 'school website'
      LIMIT 1`,
    [planIdToCheck]
  );

  const hasWebsiteFeature = featureResult.rows.length > 0;
  const rawNickname = String(org.nickname || "").trim().toLowerCase();
  const sanitizedNickname = rawNickname.replace(/[^a-z0-9-]/g, "");
  const baseDomain = "managira.com";

  if (!hasWebsiteFeature || !sanitizedNickname) {
    return {
      hasWebsiteFeature,
      hasWebsite: false,
      websiteHost: null,
      websiteUrl: null,
      nickname: sanitizedNickname || null,
    };
  }

  const websiteHost = `${sanitizedNickname}.${baseDomain}`;

  return {
    hasWebsiteFeature,
    hasWebsite: true,
    websiteHost,
    websiteUrl: `https://${websiteHost}`,
    nickname: sanitizedNickname,
  };
}

module.exports = {
  getOrganizationWebsiteInfo,
};