const express = require('express');
const router = express.Router();
const hubController = require('../controllers/hubController');
const { isHubAuthenticated, fetchHubInfo } = require('../middleware/hubAuthMiddleware');

// Public routes
router.get('/login', hubController.hubLoginGet);
router.post('/login', hubController.hubLoginPost);
router.get('/logout', hubController.hubLogoutGet);
router.get('/setup-password', hubController.setupPasswordGet);
router.post('/setup-password', hubController.setupPasswordPost);

// Protected routes (require hub authentication)
router.use(isHubAuthenticated);
router.use(fetchHubInfo);

router.get('/dashboard', hubController.hubDashboardGet);
router.get('/settings', hubController.hubSettingsGet);
router.post('/settings/profile', hubController.hubSettingsProfilePost);
router.post('/settings/password', hubController.hubSettingsPasswordPost);

// Organization management routes
router.get('/organizations/invite', hubController.organizationInviteGet);
router.post('/organizations/invite', hubController.organizationInvitePost);
router.post('/organizations/resend-invite', hubController.resendInvitePost);
router.post('/organizations/remove', hubController.removeOrganizationPost);
router.post('/organizations/cancel-invitation', hubController.cancelInvitationPost);

module.exports = router;
