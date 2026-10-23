const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware');
const multer = require('multer');
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 




// Use memory storage for file uploads (files stored in memory, not disk)
const storage = multer.memoryStorage(); 
const { safeUploadOptions } = require('../utils/uploadSafety');
const upload = multer({ storage: storage, ...safeUploadOptions({ maxMb: 25, maxFiles: 1 }) });

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
    router.post('/saveReportTemplates', isAuthenticated, express.json(), printController.saveReportTemplates); // Which report card layout each class uses
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

    // Make obsolete / restore: remarks and remark types stay on the report
    // cards that use them; obsolete signatures stay on their classes.
    const { requirePermission, PERMISSIONS } = require('../middleware/permissionMiddleware');
    const obsolete = require('../utils/obsolete');
    router.post('/obsolete', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_REPORTS), express.json(), express.urlencoded({ extended: false }),
        obsolete.obsoleteHandler(db, { kinds: ['remark', 'remarkType'], fallbackRedirect: '/print/reportSettings' }));
    router.post('/obsoleteSignature', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_REPORTS), express.json(), async (req, res) => {
        const { signaturePath, kind, action } = req.body || {};
        const organizationId = req.session.organizationId;
        if (!organizationId) return res.status(401).json({ success: false, message: 'Please sign in again.' });
        if (!['report', 'transcript'].includes(kind) || !['obsolete', 'restore'].includes(action)) {
            return res.status(400).json({ success: false, message: "That action isn't available." });
        }
        try {
            const owned = await db.query(
                `SELECT 1 FROM report_settings WHERE organization_id = $1 AND signature_image_path = $2 AND ${kind === 'transcript' ? 'term_id = -1' : 'term_id <> -1'} LIMIT 1`,
                [organizationId, String(signaturePath || '')]
            );
            if (!owned.rows.length) return res.status(404).json({ success: false, message: 'Signature not found.' });
            const userId = req.session.userId || (req.session.user && req.session.user.user_id) || null;
            const result = await obsolete.setSignatureObsolete(db, organizationId, kind, signaturePath, action === 'obsolete', userId);
            return res.status(result.status).json({ success: result.ok, message: result.message });
        } catch (error) {
            console.error('[obsoleteSignature]', error.message);
            return res.status(500).json({ success: false, message: "That couldn't be saved. Please try again." });
        }
    });
    router.get('/deleteScoreRemark/:id', isAuthenticated, printController.deleteScoreRemark);
    router.post('/saveReportChanges', isAuthenticated, printController.saveReportChanges);
    router.post('/savePaygiraReportOverrides', isAuthenticated, express.json(), printController.savePaygiraReportOverrides);
    router.post('/saveDisplaySettings', isAuthenticated, express.json(), printController.saveDisplaySettings);

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
