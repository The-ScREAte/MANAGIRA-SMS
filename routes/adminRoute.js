module.exports = (db) => {
    const express = require('express');
    const router = express.Router();
    const adminController = require('../controllers/adminController');
    const { isAuthenticated, fetchUserInfo, ensureAdmin, ensureAdminOrInternal } = require('../middleware/authMiddleware');
    const multer = require('multer');
    const upload = multer({ dest: 'uploads/' });

    // Middleware to ensure authentication and fetch user info (applies to all routes)
    router.use(isAuthenticated);
    router.use(fetchUserInfo);

    // Route: /org/:organization_id (for super admin to view org dashboard)
    // This route works in both development and production
    router.get('/org/:organization_id', ensureAdmin, async (req, res) => {
        const organizationId = req.params.organization_id;
        
        // Validate organization_id is a valid number
        const orgIdNum = parseInt(organizationId, 10);
        if (isNaN(orgIdNum)) {
            req.flash('error', 'Invalid organization ID.');
            return res.redirect('/admin');
        }
        
        try {
            // Verify the organization exists
            const orgCheck = await db.query(
                'SELECT organization_id, organization_name FROM organizations WHERE organization_id = $1 AND deleted = false',
                [orgIdNum]
            );
            
            if (orgCheck.rows.length === 0) {
                req.flash('error', 'Organization not found.');
                return res.redirect('/admin');
            }
            
            // Store the original admin session data before switching
            req.session.originalAdminUserId = req.session.userId;
            req.session.originalAccountType = req.session.accountType;
            
            // Set up session for the org (for dashboard logic)
            req.session.organizationId = orgIdNum;
            req.session.userRole = 'Admin';
            req.session.superAdminOrgSwitch = true;
            
            // Save session before redirect to ensure it persists
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    req.flash('error', 'Failed to switch to organization.');
                    return res.redirect('/admin');
                }
                // Redirect to the orgDashboard logic (will redirect to correct schoolYear/term)
                return res.redirect('/common/orgDashboard');
            });
        } catch (error) {
            console.error('Error switching to organization:', error);
            req.flash('error', 'Failed to load organization dashboard.');
            res.redirect('/admin');
        }
    });

    // Route to exit organization view and return to admin dashboard
    router.get('/exit-org', ensureAdmin, async (req, res) => {
        try {
            // Restore original admin session
            if (req.session.originalAdminUserId) {
                req.session.userId = req.session.originalAdminUserId;
                req.session.accountType = req.session.originalAccountType;
                delete req.session.originalAdminUserId;
                delete req.session.originalAccountType;
            }
            
            // Clear organization-specific session data
            delete req.session.organizationId;
            delete req.session.userRole;
            delete req.session.superAdminOrgSwitch;
            
            req.flash('success', 'Returned to admin dashboard.');
            res.redirect('/admin');
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to exit organization view.');
            res.redirect('/admin');
        }
    });

    // General routes
    router.get('/', async (req, res) => {
        try {
            if (req.session.accountType === 'Admin' || req.session.accountType === 'Mini Admin' || req.session.accountType === 'Internal Worker') {
                await adminController.adminDashboard(req, res);
            } else {
                req.flash('error', 'Unauthorized access.');
                res.redirect('/account/login');
            }
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'An error occurred.');
            res.redirect('/account/login');
        }
    });

    // Internal contacts (referrals) routes - available to Admin, Mini Admin, and Internal Worker
    router.post('/contacts', ensureAdminOrInternal, adminController.createInternalContact);
    router.get('/contacts/assignees/options', ensureAdminOrInternal, adminController.getInternalContactAssigneeOptions);
    router.post('/contacts/:id/follow-up', ensureAdminOrInternal, adminController.toggleInternalContactFollowUp);
    router.post('/contacts/:id/joined', ensureAdminOrInternal, adminController.toggleInternalContactJoined);
    router.post('/contacts/:id/assignee', ensureAdminOrInternal, adminController.assignInternalContact);
    router.post('/contacts/:id/note', ensureAdminOrInternal, adminController.appendInternalContactNote);
    router.post('/contacts/:id/delete', ensureAdminOrInternal, adminController.deleteInternalContact);

    // Self-service profile (any signed-in admin-side user)
    router.get('/profile', (req, res, next) => {
        console.log('[GET /admin/profile] session=', {
            sid: req.sessionID,
            userId: req.session && req.session.userId,
            accountType: req.session && req.session.accountType,
            userRole: req.session && req.session.userRole,
        });
        next();
    }, ensureAdminOrInternal, adminController.getAdminProfile);
    router.post('/profile', ensureAdminOrInternal, adminController.updateAdminProfile);
    router.post('/profile/notifications', ensureAdminOrInternal, adminController.updateAdminNotificationPrefs);

    router.post('/hold', adminController.holdOrganization);
    router.post('/resume', adminController.resumeOrganization);
    router.post('/delete', adminController.deleteOrganization);

    // Super Admin-only routes
    router.get('/superDashboard', ensureAdmin, async (req, res) => {
        try {
            await adminController.superAdminDashboard(req, res);
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to load the Super Admin Dashboard.');
            res.redirect('/admin');
        }
    });
    router.get('/superDashboard/users/ajax', ensureAdmin, adminController.superDashboardUsersAjax);
    router.post('/superDashboard/users/:userId/status', ensureAdmin, adminController.superDashboardUserStatusAjax);
    router.post('/superDashboard/users/:userId/delete', ensureAdmin, adminController.superDashboardDeleteUserAjax);

    router.get('/superSettings', ensureAdmin, async (req, res) => {
        try {
            await adminController.superAdminSettings(req, res);
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to load the Super Admin Settings.');
            res.redirect('/admin');
        }
    });

    router.get('/create-promo', ensureAdmin, adminController.createPromoPage);

    router.get('/employment', isAuthenticated, ensureAdmin, adminController.getEmploymentAdmin);
    router.get('/employment/applications/overview', isAuthenticated, ensureAdmin, adminController.getEmploymentApplicationsAjax);
    router.get('/employment/applications/:id/analyze', isAuthenticated, ensureAdmin, adminController.analyzeEmploymentApplication);
    router.post('/employment/applications/analyze-all', isAuthenticated, ensureAdmin, adminController.analyzeAllEmploymentApplications);
    router.post('/employment', isAuthenticated, ensureAdmin, adminController.postEmployment);
    router.post('/employment/update/:id', isAuthenticated, ensureAdmin, adminController.updateEmployment);
    router.post('/employment/toggle-status/:id', isAuthenticated, ensureAdmin, adminController.toggleEmploymentStatus);
    router.post('/employment/delete/:id', isAuthenticated, ensureAdmin, adminController.deleteEmployment);
    router.post('/employment/applications/:id/approve', isAuthenticated, ensureAdmin, adminController.approveEmploymentApplication);
    router.post('/employment/applications/:id/reject', isAuthenticated, ensureAdmin, adminController.rejectEmploymentApplication);
    router.post('/employment/applications/:id/reverse-rejection', isAuthenticated, ensureAdmin, adminController.reverseEmploymentRejection);
    router.post('/employment/applications/:id/delete', isAuthenticated, ensureAdmin, adminController.deleteEmploymentApplication);
    router.post('/employment/applications/:id/second-interview', isAuthenticated, ensureAdmin, adminController.sendSecondInterviewInvite);
    router.post('/employment/applications/:id/final-interview', isAuthenticated, ensureAdmin, adminController.sendFinalInterviewInvite);
    router.post('/employment/applications/:id/stage-reject', isAuthenticated, ensureAdmin, adminController.rejectAtInterviewStage);
    
    router.get('/donations', isAuthenticated, ensureAdmin, adminController.getDonationsAdmin);
    router.post('/donations', isAuthenticated, ensureAdmin, upload.single('image'), adminController.postDonation);
    router.post('/donations/delete/:id', isAuthenticated, ensureAdmin, adminController.deleteDonation);
    

    router.post('/create-promo', ensureAdmin, adminController.createPromoCode);
    router.post("/delete-promo/:id", ensureAdmin, adminController.deletePromoCode);
        

    router.post('/createAdmin', ensureAdmin, adminController.createAdminUser);
    router.post('/toggleAdminHoldStatus', ensureAdmin, adminController.toggleAdminHoldStatus);
    router.get('/editAdminUser/:userId', ensureAdmin, adminController.editAdminUserGet);
    router.post('/editAdminUser/:userId', ensureAdmin, adminController.editAdminUserPost);
    router.post('/resendAdminInvite/:userId', ensureAdmin, adminController.resendAdminInvite);
    router.post('/deleteAdminUser/:userId', ensureAdmin, adminController.deleteAdminUser);
    router.post('/permanentlyDelete', ensureAdmin, adminController.permanentlyDeleteOrganization);
    router.post('/restore', ensureAdmin, adminController.restoreOrganization);
    router.get('/scheduled-holds', ensureAdmin, adminController.scheduledHoldsPage);

    router.get("/announcements", isAuthenticated, ensureAdmin, adminController.getAdminAnnouncements);
    router.post("/announcements", isAuthenticated, ensureAdmin, adminController.createAdminAnnouncement);
    router.post("/announcements/toggle/:id", isAuthenticated, ensureAdmin, adminController.toggleAdminAnnouncement);
    router.post("/announcements/delete/:id", isAuthenticated, ensureAdmin, adminController.deleteAdminAnnouncement);
    // Available to Admin / Mini Admin / Internal Worker so they can dismiss
    // dashboard announcements that are flagged "show for admins".
    router.post("/announcements/seen/:id", isAuthenticated, ensureAdminOrInternal, adminController.markAdminAnnouncementSeen);
    router.get("/announcements/email-campaigns", isAuthenticated, ensureAdmin, adminController.listAdminEmailCampaigns);
    router.get("/announcements/email-recipients", isAuthenticated, ensureAdmin, adminController.searchAdminEmailRecipients);
    router.post("/announcements/email-campaigns", isAuthenticated, ensureAdmin, adminController.createAdminEmailCampaign);
    router.put("/announcements/email-campaigns/:id", isAuthenticated, ensureAdmin, adminController.updateAdminEmailCampaign);
    router.post("/announcements/email-campaigns/:id/toggle", isAuthenticated, ensureAdmin, adminController.toggleAdminEmailCampaign);
    router.delete("/announcements/email-campaigns/:id", isAuthenticated, ensureAdmin, adminController.deleteAdminEmailCampaign);
    

    // Help tickets and messages
    router.get('/helpMessages', async (req, res) => {
        try {
            await adminController.helpMessages(req, res);
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to load help messages.');
            res.redirect('/admin');
        }
    });

    router.post('/respondMessage', adminController.respondToMessage);
    router.post('/resolveMessage', adminController.markAsResolved);
    router.get('/helpHistory', async (req, res) => {
        try {
            await adminController.helpHistory(req, res);
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to load help history.');
            res.redirect('/admin');
        }
    });

    router.post('/setFeaturePrice', async (req, res) => {
        const { featureId, priceUsd } = req.body;
      
        try {
          // Get the old price before updating
          const oldPriceResult = await db.query('SELECT price_usd FROM features WHERE id = $1', [featureId]);
          const oldPrice = oldPriceResult.rows[0]?.price_usd || 0;
          
          // Update the feature price
          await db.query('UPDATE features SET price_usd = $1 WHERE id = $2', [priceUsd, featureId]);
          
          // Calculate the price difference
          const priceDifference = parseFloat(priceUsd) - parseFloat(oldPrice);
          
          // Update total_cost for all plans that include this feature
          await db.query(`
            UPDATE plans 
            SET total_cost = total_cost + $1 
            WHERE id IN (
              SELECT DISTINCT plan_id 
              FROM plan_features 
              WHERE feature_id = $2
            )
          `, [priceDifference, featureId]);
          
          req.flash('success', 'Feature price updated and plan total costs recalculated.');
          res.redirect('/admin/servicePricing');
        } catch (err) {
          // ...removed error log for clean background operation...
          req.flash('error', 'Failed to update feature price.');
          res.redirect('/admin/servicePricing');
        }
      });
      

    router.post('/reopenThread', adminController.reopenThread);
    router.post('/deleteThread', adminController.deleteThread);
    router.post('/tempDeleteMessage', adminController.tempDeleteMessage);
    router.post('/bulkDeleteMessages', async (req, res) => {
        try {
            let ids = req.body.threadIds;
            if (!ids) { req.flash('error', 'No tickets selected.'); return res.redirect('/admin/helpMessages'); }
            if (!Array.isArray(ids)) ids = [ids];
            const intIds = ids.map(x => parseInt(x, 10)).filter(Number.isFinite);
            if (!intIds.length) { req.flash('error', 'Invalid selection.'); return res.redirect('/admin/helpMessages'); }
            const db = require('../config/db');
            await db.query(`UPDATE help_threads SET is_deleted = true WHERE id = ANY($1::int[])`, [intIds]);
            req.flash('success', `${intIds.length} ticket(s) moved to Super Admin review.`);
            res.redirect('/admin/helpMessages');
        } catch (err) {
            req.flash('error', 'Bulk delete failed.');
            res.redirect('/admin/helpMessages');
        }
    });
    router.post('/restoreMessage', adminController.restoreMessage);
    router.post('/permanentDeleteMessage', adminController.permanentDeleteMessage); 

    router.get('/servicePricing', ensureAdmin, adminController.servicePricingGet);
    router.post("/updateFeature", ensureAdmin, adminController.updateFeature);
    router.post("/features", ensureAdmin, adminController.addFeature);

    router.post('/togglePlanStatus', ensureAdmin, adminController.togglePlanStatus); 
    router.post('/addFeatureToPlan', ensureAdmin, adminController.addFeatureToPlan);  
    router.post('/removeFeatureFromPlan', ensureAdmin, adminController.removeFeatureFromPlan);  
    router.post('/updatePlanDescription', ensureAdmin, adminController.updatePlanDescription);  
    router.post('/recalculateAllPlanTotals', ensureAdmin, adminController.recalculateAllPlanTotals);  

    // Add missing routes for admin settings
    router.post('/updateFreeTrialSettings', ensureAdmin, adminController.updateFreeTrialSettings);
    router.post('/updateBillingInterval', ensureAdmin, adminController.updateBillingInterval);
    router.post('/updateBillingPeriod', ensureAdmin, adminController.updateBillingPeriod);
    router.get('/getBillingPeriods', ensureAdmin, adminController.getBillingPeriods);
    router.post('/updatePaystackSettings', ensureAdmin, adminController.updatePaystackSettings);

    // Student count tier routes
    router.post('/addStudentTier', ensureAdmin, adminController.addStudentTier);
    router.post('/saveStudentTiers', ensureAdmin, adminController.saveStudentTiers);
    router.post('/updateStudentTier', ensureAdmin, adminController.updateStudentTier);
    router.post('/deleteStudentTier', ensureAdmin, adminController.deleteStudentTier);
    router.get('/getStudentTiers', ensureAdmin, adminController.getStudentTiers);

    router.post("/deleteFeature", ensureAdmin, adminController.deleteFeature);

    router.get('/data-export', ensureAdmin, adminController.dataExportPage);
    router.post('/generate-organization-csv', ensureAdmin, adminController.generateOrganizationCSV);

    // Hub Management Routes
    router.get('/hubs', ensureAdmin, adminController.hubsListGet);
    router.get('/hubs/create', ensureAdmin, adminController.hubCreateGet);
    router.post('/hubs/create', ensureAdmin, adminController.hubCreatePost);
    router.get('/hubs/:hubId/edit', ensureAdmin, adminController.hubEditGet);
    router.post('/hubs/:hubId/edit', ensureAdmin, adminController.hubEditPost);
    router.post('/hubs/hold', ensureAdmin, adminController.hubHoldPost);
    router.post('/hubs/resume', ensureAdmin, adminController.hubResumePost);
    router.post('/hubs/delete', ensureAdmin, adminController.hubDeletePost);
    router.post('/hubs/restore', ensureAdmin, adminController.restoreHub);
    router.post('/hubs/permanently-delete', ensureAdmin, adminController.permanentlyDeleteHub);
    router.post('/permanentlyDelete/bulk', ensureAdmin, adminController.bulkPermanentlyDeleteOrganizations);
    router.post('/hubs/permanently-delete/bulk', ensureAdmin, adminController.bulkPermanentlyDeleteHubs);
    router.post('/permanentDeleteMessage/bulk', ensureAdmin, adminController.bulkPermanentDeleteMessages);
    router.get('/hubs/:hubId/organizations', ensureAdmin, adminController.hubOrganizationsGet);

    return router;
};
