const db = require('../config/db');

const setAllowedFeatures = async (req, res, next) => {
    res.locals.allowedFeatures = []; // Always ensure it's an array

    if (!req.session.organizationId) {
        return next(); // Continue without breaking
    }

    try {

        const { rows: features } = await db.query(
            `SELECT f.feature_name
             FROM features f
             JOIN plan_features pf ON pf.feature_id = f.id
             JOIN organizations o ON o.plan_id = pf.plan_id
             WHERE o.organization_id = $1`,
            [req.session.organizationId]
        );

        res.locals.allowedFeatures = features.map(f => f.feature_name);
        req.session.allowedFeatures = res.locals.allowedFeatures; // ✅ Store in session to be consistent

    } catch (err) {
        console.error('❌ Error fetching features:', err);
    }

    next(); // Move to the next middleware
};

module.exports = setAllowedFeatures;
