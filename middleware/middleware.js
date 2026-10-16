const multer = require('multer');
const db = require('../config/db');
const { hydrateOrganizationSession } = require('../utils/sessionContext');

const storage = multer.memoryStorage(); // Store files in memory to send to S3

// Configuring multer to accept multiple fields with file inputs
const contentUpload = multer({
    storage,
    ...require('../utils/uploadSafety').safeUploadOptions({ maxMb: 50, maxFiles: 11 }),
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

function expectsJsonResponse(req) {
    const accept = String(req.headers?.accept || '').toLowerCase();
    const requestedWith = String(req.headers?.['x-requested-with'] || '').toLowerCase();
    return req.xhr || requestedWith === 'xmlhttprequest' || accept.includes('application/json');
}

// Middleware to check if the user is authenticated
async function isAuthenticated(req, res, next) {
    try {
        await hydrateOrganizationSession(req);

        // A background preload of a page this person can't open: just say no, no message.

        if (req.session && ['Student', 'Driver'].includes(req.session.userRole) && req.get && req.get('X-SPA-Preload') === '1') {

            return res.status(403).end();

        }

        if (req.session && req.session.userRole === 'Student') {
            if (expectsJsonResponse(req)) {
                return res.status(403).json({ success: false, message: 'You do not have permission to access this resource.' });
            }
            req.flash('error', 'You do not have permission to access that page.');
            return res.redirect('/student/dashboard');
        }

        // Drivers work only from their own portal (/driver) and its trip and
        // live-location endpoints; every other staff page is off limits.
        if (req.session && req.session.userRole === 'Driver' && !/^\/transportation\/driver\//.test(req.originalUrl || '')) {
            if (expectsJsonResponse(req)) {
                return res.status(403).json({ success: false, message: 'You do not have permission to access this resource.' });
            }
            req.flash('error', 'You do not have permission to access that page.');
            return res.redirect('/driver/dashboard');
        }

        if (!req.session || (!req.session.organizationId && !req.session.userId)) {
            if (expectsJsonResponse(req)) {
                return res.status(401).json({ success: false, message: 'Your session has expired. Please log in again.' });
            }
            return res.redirect('/account/login');
        }

        if (req.session.organizationId) {
            const orgResult = await db.query(
                'SELECT organization_id, deleted FROM organizations WHERE organization_id = $1',
                [req.session.organizationId]
            );

            if (orgResult.rows.length === 0 || orgResult.rows[0].deleted) {
                if (expectsJsonResponse(req)) {
                    return res.status(403).json({ success: false, message: 'Your organization is no longer available.' });
                }
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
                if (expectsJsonResponse(req)) {
                    return res.status(401).json({ success: false, message: 'Your account is no longer active. Please log in again.' });
                }
                req.flash('error', 'Your account is no longer active. Please log in again.');
                return destroySessionAndRedirect(req, res, '/account/login');
            }
        }

        return next();
    } catch (error) {
        console.error('Auth validation error:', error);
        if (expectsJsonResponse(req)) {
            return res.status(401).json({ success: false, message: 'Session validation failed. Please log in again.' });
        }
        req.flash('error', 'Session validation failed. Please log in again.');
        return destroySessionAndRedirect(req, res, '/account/login');
    }
}

// Middleware to block guardians (and other non-admin portal roles) from
// accessing the generic staff/admin routes.
function blockGuardians(req, res, next) {
    if (req.session.userRole === 'Guardian') {
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/guardian/dashboard');
    }
    if (req.session.userRole === 'Student') {
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/student/dashboard');
    }
    if (req.session.userRole === 'Driver') {
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/driver/dashboard');
    }
    next();
}

module.exports = {
    isAuthenticated,
    contentUpload,
    blockGuardians
};
