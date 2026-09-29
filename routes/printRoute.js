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
    router.post('/saveScoreRemarksAjax', isAuthenticated, printController.saveScoreRemarksAjax); // Save score remarks via AJAX
    router.post('/getScoreRemarkClassCoverageAjax', isAuthenticated, printController.getScoreRemarkClassCoverageAjax); // Fetch class coverage for a score remark range/value
    router.post('/setScoreRemarkClassLockAjax', isAuthenticated, printController.setScoreRemarkClassLockAjax); // Lock/unlock a specific score remark rule range for selected classes
    router.post('/saveRemarks', isAuthenticated, printController.saveRemarks); // Save remarks
    router.post('/createCustomRemarkTypeAjax', isAuthenticated, express.json(), printController.createCustomRemarkTypeAjax); // Create custom remark type via AJAX
    router.post('/deleteCustomRemarkTypeAjax', isAuthenticated, express.json(), printController.deleteCustomRemarkTypeAjax); // Delete custom remark type via AJAX
    router.post('/saveClassroomRemarkTypes', isAuthenticated, printController.saveClassroomRemarkTypes); // Save classroom remark visibility controls
    router.get('/meritSheetPage', checkFeatureAccess, isAuthenticated, printController.meritSheetPage); // Render merit sheet page
    router.get('/deleteStatusSettings', isAuthenticated, printController.deleteStatusSettings);

    // Merit sheet generation (supports GET refresh + POST form submit)
    router.get('/generateMeritSheet', checkFeatureAccess, isAuthenticated, printController.generateMeritSheet);
    router.post('/generateMeritSheet', isAuthenticated, printController.generateMeritSheet); // Generate merit sheet
    router.post('/downloadMeritSheet', checkFeatureAccess, isAuthenticated, express.json(), printController.downloadMeritSheet); // Merit sheet PDF

    // Route to upload a signature image using multer's memory storage
    router.post('/uploadSignatureImage', isAuthenticated, upload.single('signatureImage'), printController.uploadSignatureImage);

    // Routes for deleting signature image, remarks, and score remarks
    router.get('/deleteSignatureImage', isAuthenticated, printController.deleteSignatureImage);
    router.get('/deleteSignatureForClass', isAuthenticated, printController.deleteSignatureForClass);
    router.get('/deleteEntireSignature', isAuthenticated, printController.deleteEntireSignature);
    router.post('/addClassesToSignature', isAuthenticated, printController.addClassesToSignature);

    // Transcript signature routes
    router.post('/uploadTranscriptSignature', isAuthenticated, upload.single('signatureImage'), printController.uploadTranscriptSignature);
    router.get('/deleteTranscriptSignatureForClass', isAuthenticated, printController.deleteTranscriptSignatureForClass);
    router.get('/deleteEntireTranscriptSignature', isAuthenticated, printController.deleteEntireTranscriptSignature);
    router.post('/addClassesToTranscriptSignature', isAuthenticated, printController.addClassesToTranscriptSignature);

    router.get('/deleteRemark/:id', isAuthenticated, printController.deleteRemark);
    router.get('/deleteScoreRemark/:id', isAuthenticated, printController.deleteScoreRemark);
    router.post('/saveReportChanges', isAuthenticated, printController.saveReportChanges);
    router.post('/savePaygiraReportOverrides', isAuthenticated, express.json(), printController.savePaygiraReportOverrides);
    router.post('/saveDisplaySettings', isAuthenticated, express.json(), printController.saveDisplaySettings);

   // Migration Page (Upload + Search)
   router.get("/migration", checkFeatureAccess, isAuthenticated, printController.migrationPage);
   // Upload File to S3
   router.post("/upload", isAuthenticated, upload.single("file"), printController.uploadFile);
   // Search File Content
   router.get("/search", isAuthenticated, printController.searchFile);
   // Preview File
   router.get("/preview/:key", checkFeatureAccess, isAuthenticated, printController.previewFile);
   router.get("/delete/:key",  checkFeatureAccess, isAuthenticated, printController.deleteFile);
   
   // Email reports
    router.get('/emailHistoryPage', isAuthenticated, (req, res) => {
        const { classId = '', termId = '' } = req.query;
        res.render('print/emailHistory', {
          organizationId: req.session.organizationId,
          classId,
          termId,
          hideGlobalHeader: true,
          hideGlobalFooter: true,
        });
    });
   router.get('/getGuardianEmails', isAuthenticated, printController.getGuardianEmails);
    router.get('/getGuardianWhatsappNumbers', isAuthenticated, printController.getGuardianWhatsappNumbers);
    router.post('/postReportCards', isAuthenticated, express.json(), printController.postReportCards);
    router.post('/downloadReports', isAuthenticated, express.json(), printController.downloadReports);
    router.get('/postReportCardsStatus', isAuthenticated, printController.getReportPostJobStatus);
    router.post('/logDeliveryEvent', isAuthenticated, express.json(), printController.logDeliveryEvent);
   router.post('/emailReports', isAuthenticated, express.json(), printController.emailReports);
    router.post('/whatsappReports', isAuthenticated, express.json(), printController.whatsappReports);
    router.post('/smsReports', isAuthenticated, express.json(), printController.smsReports);
   router.get('/emailHistory', isAuthenticated, printController.getEmailHistory);
   router.post('/retryEmail', isAuthenticated, express.json(), printController.retryFailedEmail);
   
    return router;
};
