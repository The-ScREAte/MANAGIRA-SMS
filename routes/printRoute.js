const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware');
const multer = require('multer');
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 




// Use memory storage for file uploads (files stored in memory, not disk)
const storage = multer.memoryStorage(); 
const upload = multer({ storage: storage });

module.exports = (db) => {
    const printController = require('../controllers/printController')(db);

    // Ensure all controller methods are defined
    if (!printController || typeof printController.printStudentReport !== 'function') {
        throw new Error('printController is not properly initialized');
    }

    // Define routes
    router.get('/printStudentReport', checkFeatureAccess, isAuthenticated, printController.printStudentReport); // Fetch student report
    router.get('/reportSettings', checkFeatureAccess, isAuthenticated, printController.reportSettingsPage); // Render report settings page
    router.post('/savePromotionSettings', isAuthenticated, printController.savePromotionSettings); // Save promotion settings
    router.post('/saveScoreRemarks', isAuthenticated, printController.saveScoreRemarks); // Save score remarks
    router.post('/saveRemarks', isAuthenticated, printController.saveRemarks); // Save remarks
    router.get('/meritSheetPage', checkFeatureAccess, isAuthenticated, printController.meritSheetPage); // Render merit sheet page
    router.get('/modifyStatusSettings', isAuthenticated, printController.modifyStatusSettingsPage);
    router.get('/deleteStatusSettings', isAuthenticated, printController.deleteStatusSettings);
    router.post("/updatePromotionSettings", printController.updatePromotionSettings);

    // Fix the POST method for generateMeritSheet
    router.post('/generateMeritSheet', isAuthenticated, printController.generateMeritSheet); // Generate merit sheet

    // Route to upload a signature image using multer's memory storage
    router.post('/uploadSignatureImage', isAuthenticated, upload.single('signatureImage'), printController.uploadSignatureImage);

    // Routes for deleting signature image, remarks, and score remarks
    router.get('/deleteSignatureImage', isAuthenticated, printController.deleteSignatureImage);
    router.get('/deleteRemark/:id', isAuthenticated, printController.deleteRemark);
    router.get('/deleteScoreRemark/:id', isAuthenticated, printController.deleteScoreRemark);
    router.post('/saveReportChanges', isAuthenticated, printController.saveReportChanges);

   // Migration Page (Upload + Search)
   router.get("/migration", checkFeatureAccess, isAuthenticated, printController.migrationPage);
   // Upload File to S3
   router.post("/upload", isAuthenticated, upload.single("file"), printController.uploadFile);
   // Search File Content
   router.get("/search", isAuthenticated, printController.searchFile);
   // Preview File
   router.get("/preview/:key", checkFeatureAccess, isAuthenticated, printController.previewFile);
   router.get("/delete/:key",  checkFeatureAccess, isAuthenticated, printController.deleteFile);
    return router;
};
