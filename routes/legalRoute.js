const express = require('express');
const router = express.Router();
const legalController = require('../controllers/legalController');
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 


router.get('/about-us', legalController.aboutUs);
router.get('/faq', legalController.faq);
router.get('/help', legalController.getHelp);
router.post('/help', legalController.postHelp);
router.get('/privacy-policy', legalController.privacyPolicy);
router.get('/terms-of-service', legalController.termsOfService);
router.get('/employment', legalController.employmentPage);
router.get('/donations', legalController.donationsPage);
// router.get('/directory', legalController.directory); // Temporarily disabled
module.exports = router;
