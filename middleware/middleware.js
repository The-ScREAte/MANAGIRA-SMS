const multer = require('multer');
const db = require('../config/db');
const { hydrateOrganizationSession } = require('../utils/sessionContext');

const storage = multer.memoryStorage(); // Store files in memory to send to S3

// Configuring multer to accept multiple fields with file inputs
const contentUpload = multer({
    storage,
}).fields([
    { name: 'files', maxCount: 10 }, // Allow up to 10 slideshow images/videos
    { name: 'logo', maxCount: 1 },    // Allow 1 logo file
]);

function destroySessionAndRedirect(req, res, redirectTo) {
    if (!req.session) {
        return res.redirect(redirectTo);
    }

    req.session.destroy(() => {
        // Ensure stale auth state is removed in browser too.
        res.clearCookie('connect.sid');
        return res.redirect(redirectTo);
    });
}

// Middleware to check if the user is authenticated
async function isAuthenticated(req, res, next) {
    try {
        await hydrateOrganizationSession(req);

        if (!req.session || (!req.session.organizationId && !req.session.userId)) {
            return res.redirect('/account/login');
        }

        if (req.session.organizationId) {
            const orgResult = await db.query(
                'SELECT organization_id, deleted FROM organizations WHERE organization_id = $1',
                [req.session.organizationId]
            );

            if (orgResult.rows.length === 0 || orgResult.rows[0].deleted) {
                req.flash('error', 'Your organization is no longer available.');
                return destroySessionAndRedirect(req, res, '/');
            }
        }

        if (req.session.userId) {
            const userResult = await db.query(
                'SELECT user_id, on_hold FROM users WHERE user_id = $1',
                [req.session.userId]
            );

            if (userResult.rows.length === 0 || userResult.rows[0].on_hold) {
                req.flash('error', 'Your account is no longer active. Please log in again.');
                return destroySessionAndRedirect(req, res, '/account/login');
            }
        }

        return next();
    } catch (error) {
        console.error('Auth validation error:', error);
        req.flash('error', 'Session validation failed. Please log in again.');
        return destroySessionAndRedirect(req, res, '/account/login');
    }
}

// Middleware to block guardians from accessing staff routes
function blockGuardians(req, res, next) {
    if (req.session.userRole === 'Guardian') {
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/guardian/dashboard');
    }
    next();
}

module.exports = {
    isAuthenticated,
    contentUpload,
    blockGuardians
};
