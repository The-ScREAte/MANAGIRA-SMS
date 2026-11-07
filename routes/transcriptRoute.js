const express = require('express');
const router = express.Router();
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 



const { isAuthenticated } = require('../middleware/middleware');
const { requirePermission, PERMISSIONS } = require('../middleware/permissionMiddleware');

module.exports = (db) => {
    const transcriptController = require('../controllers/transcriptController')(db);
    const { upload } = require('../middleware/s3Upload');

    // Transcript route
    // A transcript opens only after the person confirmed their password for this
    // student on Reports -> Transcript (valid 10 minutes, see /common/transcripts/unlock).
    const requireTranscriptUnlock = (req, res, next) => {
        const access = req.session?.transcriptAccess;
        if (access && String(access.studentId) === String(req.params.studentId) && Number(access.until) > Date.now()) return next();
        if (req.flash) req.flash('error', 'Confirm your password to open this transcript.');
        return res.redirect('/common/transcripts');
    };
    router.get('/transcript/:studentId', checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), requireTranscriptUnlock, transcriptController.generateTranscript);
    router.post('/saveDigitalSignature', isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), express.json(), transcriptController.saveDigitalSignature);
    
    // Email transcript - uses express.json() to parse JSON body
    router.post('/emailTranscript', express.json(), isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), transcriptController.emailTranscript);

    return router;
};
