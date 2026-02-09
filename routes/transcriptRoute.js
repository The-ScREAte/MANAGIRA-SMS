const express = require('express');
const router = express.Router();
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 



const { isAuthenticated } = require('../middleware/middleware');

module.exports = (db) => {
    const transcriptController = require('../controllers/transcriptController')(db);
    const { upload } = require('../middleware/s3Upload');

    // Transcript route
    router.get('/transcript/:studentId', checkFeatureAccess, isAuthenticated, transcriptController.generateTranscript);
    router.post('/uploadSignatureImage', isAuthenticated, upload.single('signatureImage'), transcriptController.uploadSignatureImage);
    router.post('/saveDigitalSignature', isAuthenticated, express.json(), transcriptController.saveDigitalSignature);

    return router;
};
