const multer = require('multer');
const db = require('../config/db');
const { hydrateOrganizationSession } = require('../utils/sessionContext');
const { createShortCache } = require('../utils/shortCache');
const features = require('../utils/shards/features');

// "Is this school and account still active?" is asked on every request. A few seconds
// is soon enough for a hold or removal to take effect, and a change this school saves
// applies at once (utils/shortCache.js).
const accountChecks = createShortCache({ ttlMs: 15000, max: 20000 });

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

// A driver reaches only the pages their permissions cover, and otherwise stays in
// their own portal.
const DRIVER_PAGES = [
    { permission: 'manage_transportation', pages: /^\/(transportation\/|common\/management|common\/ui-preferences)/ },
    { permission: 'manage_employees', pages: /^\/common\/(management|ui-preferences|manageEmployees|createEmployee|modifyEmployee|deleteEmployee|enableEmployee|toggleHoldEmployee|employeeDetails|getSubjectsByClass)/ },
    { permission: 'reports_builder', pages: /^\/common\/(reports(\/|\?|$)|report-builder|ui-preferences)/ },
];

function driverMayOpen(req, res) {
    const held = res.locals?.userPermissions || [];
    const url = req.originalUrl || '';
    if (/^\/common\/(calendar|ui-preferences)/.test(url) && features.isOn('class_activities', { organizationId: req.session?.organizationId })) return true;
    return DRIVER_PAGES.some(({ permission, pages }) => held.includes(permission) && pages.test(url));
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
        const leadCanOpen = req.session && req.session.userRole === 'Driver' && driverMayOpen(req, res);
        if (req.session && req.session.userRole === 'Driver' && !leadCanOpen && !/^\/transportation\/driver\//.test(req.originalUrl || '')) {
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

        const schoolKey = req.session.organizationId || 'none';
        const [orgResult, userResult] = await accountChecks.get(schoolKey, req.session.userId || 'none', () => Promise.all([
            req.session.organizationId
                ? db.query('SELECT organization_id, deleted FROM organizations WHERE organization_id = $1', [req.session.organizationId])
                : null,
            req.session.userId
                ? db.query('SELECT user_id, on_hold FROM users WHERE user_id = $1', [req.session.userId])
                : null,
        ]));

        if (orgResult) {
            if (orgResult.rows.length === 0 || orgResult.rows[0].deleted) {
                if (expectsJsonResponse(req)) {
                    return res.status(403).json({ success: false, message: 'Your organization is no longer available.' });
                }
                req.flash('error', 'Your organization is no longer available.');
                return destroySessionAndRedirect(req, res, '/');
            }
        }

        if (userResult) {
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
        // A busy database isn't a reason to sign anyone out: they get the "try again" page and stay signed in.
        if (require('./errorMiddleware').isDatabaseUnavailable(error)) return next(error);
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
    if (req.session.userRole === 'Driver' && !driverMayOpen(req, res)) {
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
