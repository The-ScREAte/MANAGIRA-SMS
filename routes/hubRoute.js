const express = require('express');
const router = express.Router();
const hubController = require('../controllers/hubController');
const { isHubAuthenticated, fetchHubInfo } = require('../middleware/hubAuthMiddleware');
const { upload } = require('../middleware/s3Upload');

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
router.get('/overview-stats', hubController.hubOverviewStatsGet);
router.get('/settings', hubController.hubSettingsGet);
router.post('/settings/profile', hubController.hubSettingsProfilePost);
router.post('/settings/password', hubController.hubSettingsPasswordPost);
router.post('/settings/logo', upload.single('logo'), hubController.hubSettingsLogoPost);
router.post('/settings/notifications', hubController.hubSettingsNotificationsPost);

// Organization management routes
router.get('/organizations/invite', hubController.organizationInviteGet);
router.post('/organizations/invite', hubController.organizationInvitePost);
router.get('/organizations/search', hubController.searchOrganizationsGet);
router.post('/organizations/invite-existing', hubController.inviteExistingOrgPost);
router.post('/organizations/resend-invite', hubController.resendInvitePost);
router.post('/organizations/remove', hubController.removeOrganizationPost);
router.post('/organizations/cancel-invitation', hubController.cancelInvitationPost);
router.post('/organizations/toggle-hold', hubController.toggleOrganizationHoldPost);
router.post('/organizations/delete', hubController.deleteOrganizationPost);
router.get('/organizations/edit/:organizationId', hubController.editOrganizationGet);
router.post('/organizations/edit/:organizationId', hubController.editOrganizationPost);
router.get('/organizations/:organizationId', hubController.organizationDetailsGet);
router.get('/organizations/:organizationId/students', hubController.organizationStudentsListGet);
router.get('/organizations/:organizationId/students/:studentId', hubController.organizationStudentDetailsGet);
router.get('/organizations/:organizationId/staff', hubController.organizationStaffListGet);
router.get('/organizations/:organizationId/staff/:staffId', hubController.organizationStaffDetailsGet);
router.get('/organizations/:organizationId/classes', hubController.organizationClassesListGet);
router.get('/organizations/:organizationId/classes/:classId', hubController.organizationClassDetailsGet);

// Detachment request routes
router.post('/detachment-requests/approve', hubController.approveDetachmentPost);
router.post('/detachment-requests/reject', hubController.rejectDetachmentPost);

module.exports = router;
