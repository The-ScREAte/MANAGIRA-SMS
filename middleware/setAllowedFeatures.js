const db = require('../config/db');
const cacheManager = require('../utils/cacheManager');
const { resolvePlanForOrganization } = require('../utils/accessCache');

const ALLOWED_FEATURES_CACHE_TTL_SEC = Number(process.env.ALLOWED_FEATURES_CACHE_TTL_SEC || 90);

const setAllowedFeatures = async (req, res, next) => {
    res.locals.allowedFeatures = []; // Always ensure it's an array

    if (!req.session.organizationId) {
        // Leave a visitor's untouched session alone: writing to it makes
        // express-session store it, one database row per anonymous request
        // (website visitors, crawlers, health checks).
        if (Array.isArray(req.session.allowedFeatures) && req.session.allowedFeatures.length) {
            req.session.allowedFeatures = [];
        }
        return next(); // Continue without breaking
    }
    req.session.allowedFeatures = [];

    try {
        const planContext = await resolvePlanForOrganization(db, req.session.organizationId);

        if (!planContext) {
            return next(); // Organization not found, continue
        }

        const planId = planContext.planId;

        if (!planId) {
            return next(); // No plan assigned, continue
        }

        const features = await cacheManager.getOrFetch(
            'organization',
            `access:allowed-features:${req.session.organizationId}:${planId}`,
            async () => {
                const { rows } = await db.query(
                    `SELECT f.feature_name
                     FROM features f
                     JOIN plan_features pf ON pf.feature_id = f.id
                     WHERE pf.plan_id = $1`,
                    [planId]
                );

                return rows.map((f) => f.feature_name);
            },
            { ttl: ALLOWED_FEATURES_CACHE_TTL_SEC }
        );

        res.locals.allowedFeatures = Array.isArray(features) ? features : [];
        req.session.allowedFeatures = res.locals.allowedFeatures; // ✅ Store in session to be consistent

    } catch (err) {
        console.error('❌ Error fetching features:', err);
    }

    next(); // Move to the next middleware
};

module.exports = setAllowedFeatures;
