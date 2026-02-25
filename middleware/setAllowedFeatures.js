const db = require('../config/db');

const setAllowedFeatures = async (req, res, next) => {
    res.locals.allowedFeatures = []; // Always ensure it's an array
    req.session.allowedFeatures = [];

    if (!req.session.organizationId) {
        return next(); // Continue without breaking
    }

    try {
        // Determine plan_id: use hub's plan if organization is a hub member
        let planId;

        const { rows: orgRows } = await db.query(
            `SELECT o.plan_id, o.is_hub_member, o.hub_id, mh.plan_id as hub_plan_id
             FROM organizations o
             LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
             WHERE o.organization_id = $1`,
            [req.session.organizationId]
        );

        if (orgRows.length === 0) {
            return next(); // Organization not found, continue
        }

        const org = orgRows[0];

        // If organization is a hub member, use hub's plan; otherwise use org's plan
        if (org.is_hub_member && org.hub_plan_id) {
            planId = org.hub_plan_id;
        } else {
            planId = org.plan_id;
        }

        if (!planId) {
            return next(); // No plan assigned, continue
        }

        // Fetch features based on the determined plan
        const { rows: features } = await db.query(
            `SELECT f.feature_name
             FROM features f
             JOIN plan_features pf ON pf.feature_id = f.id
             WHERE pf.plan_id = $1`,
            [planId]
        );

        res.locals.allowedFeatures = features.map(f => f.feature_name);
        req.session.allowedFeatures = res.locals.allowedFeatures; // ✅ Store in session to be consistent

    } catch (err) {
        console.error('❌ Error fetching features:', err);
    }

    next(); // Move to the next middleware
};

module.exports = setAllowedFeatures;
