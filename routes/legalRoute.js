const express = require('express');
const router = express.Router();
const multer = require('multer');
const legalController = require('../controllers/legalController');
const documentationController = require('../controllers/documentationController');
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 
const { isAuthenticated, ensureAdmin } = require('../middleware/authMiddleware');
const { upload: s3Upload } = require('../middleware/s3Upload');

const upload = multer({
	dest: 'uploads/',
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (req, file, cb) => {
		const allowedMimeTypes = [
			'application/pdf',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		];

		if (allowedMimeTypes.includes(file.mimetype)) {
			return cb(null, true);
		}

		return cb(new Error('Only PDF, DOC, and DOCX files are allowed.'));
	},
});


router.get('/about-us', legalController.aboutUs);
router.get('/faq', legalController.faq);
router.get('/help', legalController.getHelp);
router.post('/help', legalController.postHelp);
router.get('/privacy-policy', legalController.privacyPolicy);
router.get('/terms-of-service', legalController.termsOfService);
router.get('/employment', legalController.employmentPage);
router.post('/employment/:id/apply', (req, res, next) => {
	upload.fields([
		{ name: 'resume', maxCount: 1 },
		{ name: 'cover_letter_file', maxCount: 1 },
	])(req, res, (err) => {
		if (err) {
			const message = err.message || 'File upload failed.';
			req.flash('error', message);
			return res.redirect('/legal/employment');
		}
		return next();
	});
}, legalController.submitEmploymentApplication);
router.get('/donations', legalController.donationsPage);
router.get('/app-demo', legalController.appDemo);
router.get('/request-demo', legalController.requestDemoPage);
router.post('/request-demo', legalController.submitDemoRequest);
router.get('/user-documentation/api/search', documentationController.documentationSearchJson);
router.get('/user-documentation/api/index', documentationController.documentationIndexJson);
router.get('/user-documentation/api/article/:slug', documentationController.documentationArticleJson);
router.post('/user-documentation/api/helpful', documentationController.documentationHelpfulVote);

router.post('/user-documentation/api/articles', isAuthenticated, ensureAdmin, documentationController.documentationCreateArticle);
router.post('/user-documentation/api/articles/:id', isAuthenticated, ensureAdmin, documentationController.documentationUpdateArticle);
router.post('/user-documentation/api/articles/:id/status', isAuthenticated, ensureAdmin, documentationController.documentationToggleStatus);
router.post('/user-documentation/api/articles/:id/duplicate', isAuthenticated, ensureAdmin, documentationController.documentationDuplicateArticle);
router.post('/user-documentation/api/articles/:id/delete', isAuthenticated, ensureAdmin, documentationController.documentationDeleteArticle);
router.post('/user-documentation/api/media', isAuthenticated, ensureAdmin, s3Upload.single('file'), documentationController.documentationUploadMedia);

router.get('/user-documentation', documentationController.renderDocumentationIndex);
router.get('/user-documentation/:slug', documentationController.renderDocumentationArticle);
module.exports = router;
