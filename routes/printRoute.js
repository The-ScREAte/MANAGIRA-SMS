const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/middleware');
const multer = require('multer');
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 
const { requirePermission, PERMISSIONS } = require('../middleware/permissionMiddleware');




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

    // Report cards: a teacher opens and changes only their own classes' (utils/classScope.js).
    router.use(require('../utils/classScope').requireClassScope(db));

    // Report Settings and what it saves.
    const canManageReports = requirePermission(PERMISSIONS.REPORTS_SETTINGS);
    // Report cards and merit sheets: open, print, post and send (Terminal Reports).
    const canOpenReportCards = requirePermission(PERMISSIONS.REPORTS_TERMINAL);

    // Define routes
    router.get('/printStudentReport', checkFeatureAccess, isAuthenticated, canOpenReportCards, printController.printStudentReport); // Fetch student report
    router.get('/reportSettings', checkFeatureAccess, isAuthenticated, canManageReports, printController.reportSettingsPage); // Render report settings page
    router.post('/savePromotionSettings', isAuthenticated, canManageReports, printController.savePromotionSettings); // Save promotion settings
    router.post('/saveReportTemplates', isAuthenticated, canManageReports, express.json(), printController.saveReportTemplates);
    // Transcript designs (utils/transcriptDesign.js): the school's choice, and a preview of each
    // with a made-up student (no real record is opened here).
    // Both answer only where transcript_designs is released to the school.
    const designsOn = (req, res, next) => (require('../utils/shards/features').isOn('transcript_designs', { organizationId: req.session.organizationId, hubId: req.session.hubId || null })
        ? next()
        : res.status(404).json({ success: false, message: 'Not available.' }));
    router.post('/transcriptDesign', isAuthenticated, designsOn, canManageReports, express.json(), async (req, res) => {
        try {
            const design = await require('../utils/transcriptDesign').saveDesign(db, req.session.organizationId, (req.body || {}).design);
            return res.json({ success: true, design });
        } catch (error) {
            if (!error.status) console.error('[transcriptDesign] save:', error.message);
            return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'The design wasn\'t saved. Please try again.' });
        }
    });
    router.get('/transcriptDesignPreview', checkFeatureAccess, isAuthenticated, designsOn, canManageReports, async (req, res) => {
        try {
            const transcriptDesign = require('../utils/transcriptDesign');
            const organizationId = req.session.organizationId;
            const { rows } = await db.query(
                'SELECT organization_name, organization_address, organization_country, organization_province, organization_phone, email, logo_path, logo FROM organizations WHERE organization_id = $1',
                [organizationId]
            );
            const savedDesign = await transcriptDesign.designFor(db, organizationId).catch(() => transcriptDesign.DEFAULT);
            // The sample shows course credits only where the school has them (feature gpa_credits).
            const sample = transcriptDesign.sampleData(rows[0] || {}, { credits: require('../utils/gpa').creditsOn(organizationId) });
            return res.render('print/transcript', {
                ...sample,
                preview: true,
                design: transcriptDesign.pick(req.query.design, savedDesign),
                savedDesign,
                transcriptDesigns: transcriptDesign.DESIGNS,
                title: 'Transcript design preview',
                signatureImageUrl: null,
                signatureName: '',
                signatureTitle: 'Registrar',
                official: false,
                canBroadcastToGuardians: false,
                hideGlobalHeader: true,
                hideGlobalFooter: true,
            });
        } catch (error) {
            console.error('[transcriptDesign] preview:', error.message);
            return res.status(500).send('The preview could not be shown.');
        }
    }); // Which report card layout each class uses
    router.post('/gpaSettings', isAuthenticated, canManageReports, express.json(), require('../controllers/printController').saveGpaSettings); // GPA weights: Honors, AP and each subject's level
    router.post('/saveScoreRemarks', isAuthenticated, canManageReports, printController.saveScoreRemarks); // Save score remarks
    router.post('/saveScoreRemarksAjax', isAuthenticated, canManageReports, printController.saveScoreRemarksAjax); // Save score remarks via AJAX
// Lock/unlock a specific score remark rule range for selected classes
    router.post('/saveRemarks', isAuthenticated, canManageReports, printController.saveRemarks); // Save remarks
    router.post('/createCustomRemarkTypeAjax', isAuthenticated, canManageReports, express.json(), printController.createCustomRemarkTypeAjax); // Create custom remark type via AJAX
    router.post('/deleteCustomRemarkTypeAjax', isAuthenticated, canManageReports, express.json(), printController.deleteCustomRemarkTypeAjax); // Delete custom remark type via AJAX
    router.post('/saveClassroomRemarkTypes', isAuthenticated, canManageReports, printController.saveClassroomRemarkTypes); // Save classroom remark visibility controls
    router.get('/meritSheetPage', checkFeatureAccess, isAuthenticated, canOpenReportCards, printController.meritSheetPage); // Render merit sheet page
    // Merit sheet generation (supports GET refresh + POST form submit)
    router.get('/generateMeritSheet', checkFeatureAccess, isAuthenticated, canOpenReportCards, printController.generateMeritSheet);
    router.post('/generateMeritSheet', isAuthenticated, canOpenReportCards, printController.generateMeritSheet); // Generate merit sheet
    router.post('/downloadMeritSheet', checkFeatureAccess, isAuthenticated, canOpenReportCards, express.json(), printController.downloadMeritSheet); // Merit sheet PDF

    // Route to upload a signature image using multer's memory storage
    router.post('/uploadSignatureImage', isAuthenticated, canManageReports, upload.single('signatureImage'), printController.uploadSignatureImage);

    router.get('/deleteSignatureForClass', isAuthenticated, canManageReports, printController.deleteSignatureForClass);
    router.get('/deleteEntireSignature', isAuthenticated, canManageReports, printController.deleteEntireSignature);
    router.post('/addClassesToSignature', isAuthenticated, canManageReports, printController.addClassesToSignature);

    // Transcript signature routes
    router.post('/uploadTranscriptSignature', isAuthenticated, canManageReports, upload.single('signatureImage'), printController.uploadTranscriptSignature);
    router.get('/deleteTranscriptSignatureForClass', isAuthenticated, canManageReports, printController.deleteTranscriptSignatureForClass);
    router.get('/deleteEntireTranscriptSignature', isAuthenticated, canManageReports, printController.deleteEntireTranscriptSignature);
    router.post('/addClassesToTranscriptSignature', isAuthenticated, canManageReports, printController.addClassesToTranscriptSignature);

    router.get('/deleteRemark/:id', isAuthenticated, canManageReports, printController.deleteRemark);

    // Make obsolete / restore: remarks and remark types stay on the report
    // cards that use them; obsolete signatures stay on their classes.
    const obsolete = require('../utils/obsolete');
    router.post('/obsolete', isAuthenticated, requirePermission(PERMISSIONS.REPORTS_SETTINGS), express.json(), express.urlencoded({ extended: false }),
        obsolete.obsoleteHandler(db, { kinds: ['remark', 'remarkType'], fallbackRedirect: '/print/reportSettings' }));
    router.post('/obsoleteSignature', isAuthenticated, requirePermission(PERMISSIONS.REPORTS_SETTINGS), express.json(), async (req, res) => {
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
    router.get('/deleteScoreRemark/:id', isAuthenticated, canManageReports, printController.deleteScoreRemark);
    router.post('/saveReportChanges', isAuthenticated, canOpenReportCards, printController.saveReportChanges);
    router.post('/savePaygiraReportOverrides', isAuthenticated, canOpenReportCards, express.json(), printController.savePaygiraReportOverrides);
    router.post('/saveDisplaySettings', isAuthenticated, canManageReports, express.json(), printController.saveDisplaySettings);

   // Email reports
    router.get('/emailHistoryPage', isAuthenticated, canOpenReportCards, async (req, res, next) => {
        const { classId = '', termId = '' } = req.query;
        const organizationId = req.session.organizationId;
        try {
          // The filters' choices come with the page: this school's classes and its terms, newest first.
          const [classes, terms] = await Promise.all([
            db.query('SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY class_name', [organizationId]),
            db.query(`SELECT t.term_id, t.term_name, sy.year_label FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
                       WHERE t.organization_id = $1 ORDER BY t.start_date DESC NULLS LAST LIMIT 40`, [organizationId]),
          ]);
          res.render('print/emailHistory', {
            organizationId,
            classId,
            termId,
            filterClasses: classes.rows,
            filterTerms: terms.rows.map((t) => ({ term_id: t.term_id, term_name: t.year_label ? `${t.term_name} (${t.year_label})` : t.term_name })),
            hideGlobalHeader: true,
            hideGlobalFooter: true,
          });
        } catch (error) {
          next(error);
        }
    });
   router.get('/getGuardianEmails', isAuthenticated, canOpenReportCards, printController.getGuardianEmails);
    router.get('/getGuardianWhatsappNumbers', isAuthenticated, canOpenReportCards, printController.getGuardianWhatsappNumbers);
    router.post('/postReportCards', isAuthenticated, canOpenReportCards, express.json(), printController.postReportCards);
    router.post('/downloadReports', isAuthenticated, canOpenReportCards, express.json(), printController.downloadReports);
    router.get('/postReportCardsStatus', isAuthenticated, canOpenReportCards, printController.getReportPostJobStatus);
    router.post('/logDeliveryEvent', isAuthenticated, express.json(), printController.logDeliveryEvent);
   router.post('/emailReports', isAuthenticated, canOpenReportCards, express.json(), printController.emailReports);
    router.post('/whatsappReports', isAuthenticated, canOpenReportCards, express.json(), printController.whatsappReports);
    router.post('/smsReports', isAuthenticated, canOpenReportCards, express.json(), printController.smsReports);
   router.get('/emailHistory', isAuthenticated, canOpenReportCards, printController.getEmailHistory);
   router.post('/retryEmail', isAuthenticated, canOpenReportCards, express.json(), printController.retryFailedEmail);
   
    return router;
};
