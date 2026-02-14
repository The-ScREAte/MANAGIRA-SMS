const express = require('express');
const router = express.Router();
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 



const { isAuthenticated } = require('../middleware/middleware');
const { requirePermission, PERMISSIONS } = require('../middleware/permissionMiddleware');

module.exports = (db) => {
    const transcriptController = require('../controllers/transcriptController')(db);
    const { upload } = require('../middleware/s3Upload');

    // Transcript route
    router.get('/transcript/:studentId', checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), transcriptController.generateTranscript);
    router.post('/uploadSignatureImage', isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), upload.single('signatureImage'), transcriptController.uploadSignatureImage);
    router.post('/saveDigitalSignature', isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), express.json(), transcriptController.saveDigitalSignature);
    
    // Email transcript - uses express.json() to parse JSON body
    router.post('/emailTranscript', express.json(), isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS), transcriptController.emailTranscript);

    return router;
};
