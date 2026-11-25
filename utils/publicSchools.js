// utils/publicSchools.js
// The schools whose public page (name.managira.com) is listed for search engines. Used by the school
// sitemaps (server.js) and by the daily search-engine update (utils/searchIndexSync.js), so both agree.
//
// Only list a school's subdomain if its plan actually has the "School Website" feature active:
// otherwise the public URL just renders a generic "Website Not Activated Yet" placeholder (see
// checkFeatureAccess.js). Submitting thousands of near-identical placeholder pages to Google reads as
// thin/duplicate content at scale. This mirrors checkFeatureAccess.js's own feature-gate lookup for
// the /common/publicDashboard route exactly, rather than hardcoding a feature id that could drift.
async function listPublicSchools(db) {
  const result = await db.query(
    `SELECT o.organization_id, o.nickname, o.updated_at
       FROM organizations o
       LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
      WHERE o.deleted = false
        AND o.nickname IS NOT NULL
        AND o.nickname <> ''
        -- Test schools ("(TEST)" in the name, or "test" as a word of the address) aren't listed for search engines.
        AND o.organization_name !~* '\\(test\\)'
        AND o.nickname !~* '(^|-)test(-|$)'
        AND COALESCE(mh.on_hold, false) = false
        AND (
          NOT EXISTS (
            SELECT 1 FROM feature_routes fr
            WHERE fr.route_path = '/common/publicDashboard'
          )
          OR EXISTS (
            SELECT 1 FROM feature_routes fr
            JOIN plan_features pf ON pf.feature_id = fr.feature_id
            WHERE fr.route_path = '/common/publicDashboard'
              AND pf.plan_id = (
                CASE
                  WHEN o.is_hub_member AND COALESCE(o.hub_assigned_plan_id, mh.plan_id) IS NOT NULL THEN COALESCE(o.hub_assigned_plan_id, mh.plan_id)
                  ELSE o.plan_id
                END
              )
          )
        )
      ORDER BY o.organization_name ASC
      LIMIT 5000` 
  );
  return result.rows;
}

module.exports = { listPublicSchools };
