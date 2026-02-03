const db = require('../config/db');

const isAuthenticated = async (req, res, next) => {
    try {
        // Debug log removed for production
        // Allow super admin org switch session
        if (req.session.superAdminOrgSwitch && req.session.userId && req.session.organizationId) {
            return next();
        }
        // 1. Check session existence
        if (!req.session.userId && !req.session.organizationId) {
            console.error('Auth failed - Missing session IDs:', req.sessionID);
            
            if (!req.session.returnTo) {
                req.session.returnTo = req.originalUrl;
            }
            
            req.flash('error', 'Session expired. Please log in again.');
            return res.redirect('/account/login');
        }

        // 2. Validate organization status first
        if (req.session.organizationId) {
            const org = await db.query(
                'SELECT deleted, on_hold FROM organizations WHERE organization_id = $1',
                [req.session.organizationId]
            );
            
            if (org.rows.length === 0) {
                req.session.destroy();
                req.flash('error', 'Organization not found');
                return res.redirect('/account/login');
            }
            
            if (org.rows[0].deleted || org.rows[0].on_hold) {
                req.session.destroy();
                req.flash('error', 'Account suspended. Contact support.');
                return res.redirect('/account/login');
            }
        }

        // 3. Validate user status
        if (req.session.userId) {
            const user = await db.query(
                'SELECT on_hold FROM users WHERE user_id = $1',
                [req.session.userId]
            );
            
            if (user.rows.length === 0) {
                req.session.destroy();
                req.flash('error', 'User not found');
                return res.redirect('/account/login');
            }
            
            if (user.rows[0].on_hold) {
                req.session.destroy();
                req.flash('error', 'Account suspended. Contact admin.');
                return res.redirect('/account/login');
            }
        }

        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        req.flash('error', 'Authentication system error');
        res.redirect('/account/login');
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

// Middleware to block guardians from accessing staff routes
const blockGuardians = (req, res, next) => {
    try {
        if (req.session.userRole === 'Guardian') {
            req.flash('error', 'You do not have permission to access this page.');
            return res.redirect('/guardian/dashboard');
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

                // Fetch organization details for non-admin users
                if (
                    user.account_type !== 'Admin' &&
                    user.account_type !== 'Mini Admin' &&
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
    fetchUserInfo,
    blockGuardians,
};
