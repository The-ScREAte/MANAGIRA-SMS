const multer = require('multer');

const storage = multer.memoryStorage(); // Store files in memory to send to S3

// Configuring multer to accept multiple fields with file inputs
const contentUpload = multer({
    storage,
}).fields([
    { name: 'files', maxCount: 10 }, // Allow up to 10 slideshow images/videos
    { name: 'logo', maxCount: 1 },    // Allow 1 logo file
]);

// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.organizationId || req.session.userId) {
        return next();
    } else {
        res.redirect('/account/login');
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
