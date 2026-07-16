const db = require('../config/db');
const cacheManager = require('../utils/cacheManager');

const USER_ROLE_CACHE_TTL_SEC = Number(process.env.USER_ROLE_CACHE_TTL_SEC || 90);

async function getCurrentRoleFromDb(userId, organizationId) {
    if (!userId || !organizationId) {
        return null;
    }

    const cacheKey = `perm:user-role:${organizationId}:${userId}`;

    return cacheManager.getOrFetch(
        'organization',
        cacheKey,
        async () => {
            const result = await db.query(
                `SELECT account_type
                 FROM users
                 WHERE user_id = $1 AND organization_id = $2
                 LIMIT 1`,
                [userId, organizationId]
            );

            return result.rows[0]?.account_type || null;
        },
        { ttl: USER_ROLE_CACHE_TTL_SEC }
    );
}

module.exports = async (req, res, next) => {
    try {
        const userId = req.session?.user?.user_id || req.session?.userId || null;
        const organizationId = req.session?.organizationId || null;
        const sessionRole = String(req.session?.userRole || '').trim();

        let resolvedRole = sessionRole;

        if (userId && organizationId) {
            const dbRole = await getCurrentRoleFromDb(userId, organizationId);
            if (dbRole) {
                resolvedRole = String(dbRole).trim();

                if (resolvedRole && resolvedRole !== sessionRole) {
                    req.session.userRole = resolvedRole;

                    if (req.session.user && typeof req.session.user === 'object') {
                        req.session.user.account_type = resolvedRole;
                    }

                    const currentAccountType = String(req.session.accountType || '').trim().toLowerCase();
                    if (!['organization', 'hub'].includes(currentAccountType)) {
                        req.session.accountType = resolvedRole;
                    }
                }
            }
        }

        res.locals.userRole = resolvedRole || 'default';
    } catch (error) {
        res.locals.userRole = req.session?.userRole || 'default';
    }

    next();
};
