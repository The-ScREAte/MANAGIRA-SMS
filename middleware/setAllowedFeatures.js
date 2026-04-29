const db = require('../config/db');
const cacheManager = require('../utils/cacheManager');
const { resolvePlanForOrganization } = require('../utils/accessCache');
const { isPublicRoute } = require('../utils/routeProfile');

const ALLOWED_FEATURES_CACHE_TTL_SEC = Number(process.env.ALLOWED_FEATURES_CACHE_TTL_SEC || 90);

const setAllowedFeatures = async (req, res, next) => {
    res.locals.allowedFeatures = []; // Always ensure it's an array

    const requestPath = req.path || '';
    if (isPublicRoute(requestPath)) {
        return next();
    }

    if (!req.session.organizationId) {
        return next(); // Continue without breaking
    }

    const cachedFeatures = Array.isArray(req.session.allowedFeatures)
        ? req.session.allowedFeatures
        : null;
    const cachedAt = Number(req.session.allowedFeaturesCachedAt || 0);
    const cachedOrgId = String(req.session.allowedFeaturesOrgId || '');

    if (
        cachedFeatures
        && cachedOrgId === String(req.session.organizationId)
        && cachedAt > 0
        && (Date.now() - cachedAt) < (ALLOWED_FEATURES_CACHE_TTL_SEC * 1000)
    ) {
        res.locals.allowedFeatures = cachedFeatures;
        return next();
    }

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
        req.session.allowedFeatures = res.locals.allowedFeatures;
        req.session.allowedFeaturesOrgId = req.session.organizationId;
        req.session.allowedFeaturesCachedAt = Date.now();

    } catch (err) {
        console.error('❌ Error fetching features:', err);
    }

    next(); // Move to the next middleware
};

module.exports = setAllowedFeatures;
