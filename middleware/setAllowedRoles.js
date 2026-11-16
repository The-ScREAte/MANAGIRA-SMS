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

        // A student's or parent's id comes from another table. Looked up here, it could match a
        // member of staff with the same number and turn this session into theirs.
        const isPortalSession = ['guardian', 'student'].includes(sessionRole.toLowerCase());

        if (userId && organizationId && !isPortalSession) {
            const dbRole = await getCurrentRoleFromDb(userId, organizationId);
            // A school's staff account is only ever Manager, Supervisor, Teacher or Driver. One that
            // carries a Managira role (Admin, Mini Admin, Internal Worker) never gets it into a session:
            // it is signed out, as fetchUserInfo does on the admin pages.
            if (dbRole && !require('../utils/staffChangeGuard').isSchoolRole(String(dbRole).trim())) {
                console.warn(`[Security] A school account (user ${userId}, school ${organizationId}) carries the platform role ${dbRole}; signing it out.`);
                return req.session.regenerate(() => {
                    if (typeof req.flash === 'function') req.flash('error', 'Your account needs attention. Ask your school\'s manager to check your role.');
                    if (req.xhr || /json/i.test(req.get('accept') || '')) return res.status(401).json({ success: false, message: 'Sign in again.' });
                    return res.redirect('/account/login');
                });
            }
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
