const db = require('../config/db');
const { hydrateOrganizationSession } = require('../utils/sessionContext');

function safeFlash(req, type, message) {
    if (req && req.session && typeof req.flash === 'function') {
        req.flash(type, message);
    }
}

function destroySessionAndRedirect(req, res, redirectTo) {
    if (!req || !req.session) {
        return res.redirect(redirectTo);
    }

    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        return res.redirect(redirectTo);
    });
}

const isAuthenticated = async (req, res, next) => {
    try {
        if (!req.session) {
            return res.redirect('/account/login');
        }

        await hydrateOrganizationSession(req);

        if (req.session && req.session.userRole === 'Student') {
            safeFlash(req, 'error', 'You do not have permission to access that page.');
            return res.redirect('/student/dashboard');
        }

        if (req.session && req.session.userRole === 'Driver') {
            safeFlash(req, 'error', 'You do not have permission to access that page.');
            return res.redirect('/driver/dashboard');
        }

        // Debug log removed for production
        // Allow super admin org switch session
        if (req.session.superAdminOrgSwitch && req.session.userId && req.session.organizationId) {
            return next();
        }
        // 1. Check session existence
        if (!req.session.userId && !req.session.organizationId) {
            console.error('[isAuthenticated] Missing session IDs', {
                sid: req.sessionID,
                path: req.originalUrl,
                method: req.method,
                hasCookieHeader: Boolean(req.headers && req.headers.cookie),
                cookieHeader: req.headers && req.headers.cookie ? String(req.headers.cookie).slice(0, 200) : null,
                sessionKeys: req.session ? Object.keys(req.session) : null,
                accountType: req.session && req.session.accountType,
                userRole: req.session && req.session.userRole,
                xhr: req.xhr,
                accept: req.headers && req.headers.accept,
            });

            if (!req.session.returnTo) {
                req.session.returnTo = req.originalUrl;
            }

            safeFlash(req, 'error', 'Session expired. Please log in again.');
            return res.redirect('/account/login');
        }

        // 2. Validate organization status first
        if (req.session.organizationId) {
            const org = await db.query(
                'SELECT deleted, on_hold FROM organizations WHERE organization_id = $1',
                [req.session.organizationId]
            );
            
            if (org.rows.length === 0) {
                safeFlash(req, 'error', 'Organization not found');
                return destroySessionAndRedirect(req, res, '/');
            }

            const orgData = org.rows[0];
            
            if (orgData.deleted || orgData.on_hold) {
                safeFlash(req, 'error', 'Account suspended. Contact support.');
                return destroySessionAndRedirect(req, res, '/');
            }
        }

        // 3. Validate user status
        if (req.session.userId) {
            const user = await db.query(
                'SELECT on_hold FROM users WHERE user_id = $1',
                [req.session.userId]
            );
            
            if (user.rows.length === 0) {
                safeFlash(req, 'error', 'User not found');
                return destroySessionAndRedirect(req, res, '/account/login');
            }
            
            if (user.rows[0].on_hold) {
                safeFlash(req, 'error', 'Account suspended. Contact admin.');
                return destroySessionAndRedirect(req, res, '/account/login');
            }
        }

        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        safeFlash(req, 'error', 'Authentication system error');
        return destroySessionAndRedirect(req, res, '/account/login');
    }
};


 

// Middleware to ensure only Admins can access certain routes
const ensureAdmin = async (req, res, next) => {
    try {
        if (req.session.accountType !== 'Admin') {
            console.error('Authorization failed: User is not an Admin.', { userType: req.session.accountType });
            req.flash('error', 'You do not have permission to access this page.');
            return res.redirect('/admin');
        }
        next();
    } catch (err) {
        console.error('Error in ensureAdmin middleware:', err);
        req.flash('error', 'An error occurred during authorization.');
        res.redirect('/admin');
    }
};

// Middleware that allows full Admins, Mini Admins, and the new Internal Worker role.
// Use on admin routes that Internal Workers are explicitly allowed to access.
const ensureAdminOrInternal = (req, res, next) => {
    try {
        const accountType = String(req.session && req.session.accountType || '').trim().toLowerCase();
        const userRole    = String(req.session && req.session.userRole    || '').trim().toLowerCase();
        const ALLOWED = new Set(['admin', 'mini admin', 'internal worker']);
        if (ALLOWED.has(accountType) || ALLOWED.has(userRole)) {
            return next();
        }
        console.warn('[ensureAdminOrInternal] denied', {
            path: req.originalUrl,
            userId: req.session && req.session.userId,
            accountType: req.session && req.session.accountType,
            userRole: req.session && req.session.userRole,
        });
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/account/login');
    } catch (err) {
        console.error('Error in ensureAdminOrInternal middleware:', err);
        req.flash('error', 'An error occurred during authorization.');
        return res.redirect('/account/login');
    }
};

// Middleware to block guardians from accessing staff routes
const blockGuardians = (req, res, next) => {
    try {
        if (req.session.userRole === 'Guardian') {
            req.flash('error', 'You do not have permission to access this page.');
            return res.redirect('/guardian/dashboard');
        }
        if (req.session.userRole === 'Student') {
            req.flash('error', 'You do not have permission to access this page.');
            return res.redirect('/student/dashboard');
        }
        next();
    } catch (err) {
        console.error('Error in blockGuardians middleware:', err);
        req.flash('error', 'An error occurred during authorization.');
        res.redirect('/guardian/dashboard');
    }
};

// Middleware to fetch user or organization details and set session variables
const fetchUserInfo = async (req, res, next) => {
    if (req.session.userId) {
        try {
            // Fetch user details
            const userResult = await db.query('SELECT * FROM users WHERE user_id = $1', [req.session.userId]);

            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                req.session.firstName = user.first_name;
                req.session.lastName = user.last_name;
                req.session.accountType = user.account_type;
                req.session.profileImageUrl = user.profile_image_url || null;

                // Fetch organization details for non-admin users
                if (
                    user.account_type !== 'Admin' &&
                    user.account_type !== 'Mini Admin' &&
                    user.account_type !== 'Internal Worker' &&
                    user.organization_id
                ) {
                    const orgResult = await db.query(
                        'SELECT * FROM organizations WHERE organization_id = $1',
                        [user.organization_id]
                    );

                    if (orgResult.rows.length > 0) {
                        const organization = orgResult.rows[0];
                        req.session.organizationId = organization.organization_id;
                        req.session.organizationName = organization.organization_name;
                        req.session.logo = organization.logo;
                        req.session.fontStyle = organization.font_style;
                        req.session.themeColor = organization.theme_color || 'teal';
                    }
                }
            }
            next();
        } catch (err) {
            console.error('Error fetching user info:', err);
            req.flash('error', 'An error occurred while processing your session. Please log in again.');
            res.redirect('/account/login');
        }
    } else {
        next();
    }
};

module.exports = {
    isAuthenticated,
    ensureAdmin,
    ensureAdminOrInternal,
    fetchUserInfo,
    blockGuardians,
};
