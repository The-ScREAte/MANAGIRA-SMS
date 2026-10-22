module.exports = (db) => {
    const express = require('express');
    const router = express.Router();
    const adminController = require('../controllers/adminController');
    const { isAuthenticated, fetchUserInfo, ensureAdmin, ensureAdminOrInternal } = require('../middleware/authMiddleware');
    const multer = require('multer');
    const upload = multer({ dest: 'uploads/', ...require('../utils/uploadSafety').safeUploadOptions({ maxMb: 25 }) });

    // Side-panel forms on the hub pages post with X-Admin-Ajax: answer with JSON
    // ({ success, message, redirect }) instead of a flash message and a redirect.
    router.use((req, res, next) => {
        if (req.get('X-Admin-Ajax') !== '1') return next();
        const notes = [];
        const originalFlash = req.flash;
        req.flash = function flash(type, msg) {
            if (msg === undefined) return originalFlash.apply(this, arguments);
            notes.push({ type, msg: [].concat(msg).join(' ') });
            return notes.length;
        };
        res.redirect = function redirect(a, b) {
            const url = typeof a === 'number' ? b : a;
            const error = notes.find((n) => n.type === 'error');
            const last = error || notes[notes.length - 1] || {};
            return res.json({ success: !error, message: last.msg || '', redirect: url });
        };
        next();
    });

    // ?drawer=1: render just the form, for the side panel.
    router.use((req, res, next) => {
        if (req.method !== 'GET' || req.query.drawer !== '1') return next();
        res.locals.drawer = true;
        const render = res.render.bind(res);
        res.render = (view, options = {}, cb) => render(view, { ...options, layout: false, drawer: true }, cb);
        next();
    });

    // An admin who opened a hub is put back in admin mode on any /admin page.
    router.use((req, res, next) => {
        adminController.restoreAdminFromHubView(req);
        next();
    });

    // Middleware to ensure authentication and fetch user info (applies to all routes)
    router.use(isAuthenticated);
    router.use(fetchUserInfo);

    const ensureAdminOrMiniAdmin = (req, res, next) => {
        const accountType = String(req.session?.accountType || '').trim().toLowerCase();
        if (accountType === 'admin' || accountType === 'mini admin') {
            return next();
        }
        req.flash('error', 'You do not have permission to access feedback.');
        return res.redirect('/admin');
    };

    // Allows full Admin/Mini Admin through unconditionally; anyone else must
    // have been explicitly granted that specific school via Manage Access.
    const ensureAdminOrGrantedOrg = async (req, res, next) => {
        const accountType = req.session && req.session.accountType;
        if (accountType === 'Admin' || accountType === 'Mini Admin') return next();

        const organizationId = parseInt(req.params.organization_id, 10);
        const userId = req.session && req.session.userId;
        if (userId && Number.isInteger(organizationId)) {
            try {
                const grant = await db.query(
                    `SELECT 1 FROM user_extra_organizations WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
                    [userId, organizationId]
                );
                if (grant.rows.length) return next();
            } catch (_) {}
        }
        req.flash('error', 'You do not have access to that school.');
        return res.redirect('/admin');
    };

    // Step-up password check before entering another school's dashboard.
    // super_admin is exempt; everyone else (Admin, Mini Admin, Internal
    // Worker) must re-enter their own password once per school per session.
    const ensureOrgSwitchPasswordVerified = (req, res, next) => {
        const accountType = req.session && req.session.accountType;
        if (accountType === 'super_admin') return next();

        const organizationId = parseInt(req.params.organization_id, 10);
        const verifiedOrgIds = (req.session && req.session.orgSwitchVerifiedOrgIds) || [];
        if (Number.isInteger(organizationId) && verifiedOrgIds.includes(organizationId)) return next();

        return res.redirect(`/admin/confirm-password?redirect=${encodeURIComponent(req.originalUrl)}`);
    };

    // Same step-up check before opening a hub.
    const ensureHubSwitchPasswordVerified = (req, res, next) => {
        if (req.session && req.session.accountType === 'super_admin') return next();
        const hubId = parseInt(req.params.hubId, 10);
        const verifiedHubIds = (req.session && req.session.hubSwitchVerifiedIds) || [];
        if (Number.isInteger(hubId) && verifiedHubIds.includes(hubId)) return next();
        return res.redirect(`/admin/confirm-password?redirect=${encodeURIComponent(req.originalUrl)}`);
    };

    // Where "Back to Admin" lands after opening a school from an admin list.
    const safeAdminReturn = (value) => {
        const v = String(value || '');
        return /^\/admin(\/hubs(\/\d+\/organizations)?)?$/.test(v) ? v : null;
    };

    router.get('/confirm-password', adminController.orgSwitchConfirmGet);
    router.post('/confirm-password', adminController.orgSwitchConfirmPost);

    // Route: /org/:organization_id (for super admin to view org dashboard)
    // This route works in both development and production
    router.get('/org/:organization_id', ensureAdminOrGrantedOrg, ensureOrgSwitchPasswordVerified, async (req, res) => {
        const organizationId = req.params.organization_id;
        
        // Validate organization_id is a valid number
        const orgIdNum = parseInt(organizationId, 10);
        if (isNaN(orgIdNum)) {
            req.flash('error', 'Invalid organization ID.');
            return res.redirect('/admin');
        }
        
        try {
            // Verify the organization exists (also fetch nickname + hub for subdomain redirect)
            const orgCheck = await db.query(
                                `SELECT o.organization_id, o.organization_name, o.nickname, o.nickname_display, o.logo, o.theme_color, o.font_style,
                                                o.is_hub_member, o.hub_id,
                        mh.hub_nickname
                   FROM organizations o
                   LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
                  WHERE o.organization_id = $1 AND o.deleted = false`,
                [orgIdNum]
            );
            
            if (orgCheck.rows.length === 0) {
                req.flash('error', 'Organization not found.');
                return res.redirect('/admin');
            }

            const org = orgCheck.rows[0];
            
            const returnTo = safeAdminReturn(req.query.return);
            if (returnTo) req.session.adminReturnTo = returnTo;
            else delete req.session.adminReturnTo;

            // Store the original admin session data before switching
            req.session.originalAdminUserId = req.session.userId;
            req.session.originalAccountType = req.session.accountType;
            
            // Set up session for the org (for dashboard logic)
            req.session.organizationId = orgIdNum;
            req.session.userRole = 'Admin';
            req.session.superAdminOrgSwitch = true;
            req.session.organizationName = org.organization_name;
            req.session.logo = org.logo || null;
            req.session.themeColor = org.theme_color || 'teal';
            req.session.fontStyle = org.font_style || null;
            req.session.orgNickName = org.nickname || null;
            req.session.orgNickNameDisplay = (org.nickname_display && String(org.nickname_display).trim()) || org.nickname || null;
            
            // Save session before redirect to ensure it persists
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    req.flash('error', 'Failed to switch to organization.');
                    return res.redirect('/admin');
                }

                // In production, redirect to the org's subdomain so that
                // req.schoolDetails is populated by the subdomain middleware.
                // Without this, routes that rely on req.schoolDetails (like
                // orgDashboardRestricted) fail on the root managira.com host.
                // The session cookie is scoped to .managira.com so it carries.
                if (process.env.NODE_ENV === 'production' && org.nickname) {
                    const host = org.is_hub_member && org.hub_nickname
                        ? `${org.nickname}.${org.hub_nickname}.managira.com`
                        : `${org.nickname}.managira.com`;
                    return res.redirect(`https://${host}/common/orgDashboard`);
                }

                // Dev / fallback: relative redirect
                return res.redirect('/common/orgDashboard');
            });
        } catch (error) {
            console.error('Error switching to organization:', error);
            req.flash('error', 'Failed to load organization dashboard.');
            res.redirect('/admin');
        }
    });

    // Route to exit organization view and return to admin dashboard
    // Anyone currently mid org-switch (originalAdminUserId set) may exit back,
    // not just full Admins — a granted worker viewing a school needs a way out too.
    const ensureAdminOrExitingOrg = (req, res, next) => {
        if (req.session && req.session.accountType === 'Admin') return next();
        if (req.session && req.session.originalAdminUserId) return next();
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/admin');
    };
    router.get('/exit-org', ensureAdminOrExitingOrg, async (req, res) => {
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
            delete req.session.organizationName;
            delete req.session.logo;
            delete req.session.themeColor;
            delete req.session.fontStyle;
            delete req.session.orgNickName;
            delete req.session.orgNickNameDisplay;
            
            const returnTo = safeAdminReturn(req.session.adminReturnTo) || '/admin';
            delete req.session.adminReturnTo;
            req.flash('success', 'Returned to admin dashboard.');
            res.redirect(returnTo);
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

    // Org Chart — Admin/Mini Admin, plus any user explicitly granted access via Manage Access
    const ensureOrgChartAccess = async (req, res, next) => {
        const t = req.session && req.session.accountType;
        if (t === 'Admin' || t === 'Mini Admin') return next();
        try {
            const userId = req.session && req.session.userId;
            if (userId) {
                const flag = await db.query(
                    `SELECT can_view_org_chart FROM user_feature_flags WHERE user_id = $1`,
                    [userId]
                );
                if (flag.rows.length && flag.rows[0].can_view_org_chart) return next();
            }
        } catch (_) {}
        req.flash('error', 'Unauthorized.');
        return res.redirect('/admin');
    };
    router.get('/org-chart', ensureOrgChartAccess, adminController.getOrgChart);
    router.post('/org-chart/:id', ensureAdmin, upload.single('profileImage'), adminController.updateOrgChartMember);

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
    router.post('/profile', ensureAdminOrInternal, upload.single('profileImage'), adminController.updateAdminProfile);
    router.post('/profile/notifications', ensureAdminOrInternal, adminController.updateAdminNotificationPrefs);

    router.post('/hold', ensureAdmin, adminController.holdOrganization);
    router.post('/resume', ensureAdmin, adminController.resumeOrganization);
    router.post('/delete', ensureAdmin, adminController.deleteOrganization);

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
    router.get('/superDashboard/users/:userId/permissions', ensureAdmin, adminController.getUserPermissionsAjax);
    router.post('/superDashboard/users/:userId/permissions', ensureAdmin, adminController.updateUserPermissionsAjax);
    router.get('/superDashboard/workers/search', ensureAdmin, adminController.searchManagiraWorkersAjax);
    router.get('/superDashboard/organizations/search', ensureAdmin, adminController.searchOrganizationsAjax);

    // Soft-deleted internal contacts (referrals) — Super Admin only
    router.post('/contacts/restore', ensureAdmin, adminController.restoreInternalContact);
    router.post('/contacts/permanent-delete', ensureAdmin, adminController.permanentlyDeleteInternalContact);

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
    router.post('/employment/applications/:id/hire', isAuthenticated, ensureAdmin, adminController.hireApplicant);
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
    // Dashboard notices are now a format of the unified announcements; the
    // older notice form and create route point back to the Announcements page.
    router.get("/announcements/new", isAuthenticated, ensureAdmin, (req, res) => res.redirect("/admin/announcements"));
    // Request Feedback (star rating + comment) from chosen roles in chosen schools.
    const feedbackRequests = require("../controllers/feedbackRequestController");
    router.get("/feedback-requests/new", isAuthenticated, ensureAdmin, feedbackRequests.formPage);
    router.get("/feedback-requests/estimate", isAuthenticated, ensureAdmin, feedbackRequests.estimate);
    router.post("/feedback-requests", isAuthenticated, ensureAdmin, express.json(), feedbackRequests.save);
    router.get("/feedback-requests/:id(\\d+)", isAuthenticated, ensureAdmin, feedbackRequests.resultsPage);
    router.get("/feedback-requests/:id(\\d+)/edit", isAuthenticated, ensureAdmin, feedbackRequests.formPage);
    router.get("/feedback-requests/:id(\\d+)/export.csv", isAuthenticated, ensureAdmin, feedbackRequests.exportCsv);
    router.post("/feedback-requests/:id(\\d+)", isAuthenticated, ensureAdmin, express.json(), feedbackRequests.save);
    router.post("/feedback-requests/:id(\\d+)/status", isAuthenticated, ensureAdmin, express.json(), feedbackRequests.setStatus);
    router.post("/feedback-requests/:id(\\d+)/delete", isAuthenticated, ensureAdmin, feedbackRequests.remove);

    router.post("/broadcasts/:id(\\d+)/active", isAuthenticated, ensureAdmin, express.json(), adminController.setBroadcastActive);
    router.post("/broadcasts/:id(\\d+)/delete", isAuthenticated, ensureAdmin, adminController.deleteBroadcast);

    // The announcement composer for every school (pop-ups/banners by role and school).
    router.get("/announcements/compose", isAuthenticated, ensureAdmin, (req, res) => {
        req.query.global = "1";
        return require("../controllers/commonController").commonController.announcementComposerGet(req, res, db);
    });
    // Login page ads (managed from the Announcements page, shown on /account/login).
    const loginAdsController = require('../controllers/loginAdsController');
    const { MEDIA_TYPES, MAX_FILE_BYTES } = require('../utils/loginAds');
    const loginAdUpload = multer({
        dest: 'uploads/',
        limits: { fileSize: MAX_FILE_BYTES },
        fileFilter: (req, file, cb) => cb(null, Boolean(MEDIA_TYPES[file.mimetype])),
    });
    const loginAdFile = (req, res, next) => loginAdUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 50 MB.' : 'Upload failed.';
        return res.status(400).json({ success: false, message });
    });
    router.post("/announcements/ads", isAuthenticated, ensureAdmin, loginAdFile, loginAdsController.create);
    router.post("/announcements/ads/reorder", isAuthenticated, ensureAdmin, express.json(), loginAdsController.reorder);
    router.post("/announcements/ads/:id(\\d+)", isAuthenticated, ensureAdmin, loginAdFile, loginAdsController.update);
    router.post("/announcements/ads/:id(\\d+)/delete", isAuthenticated, ensureAdmin, loginAdsController.remove);

    // Public product tour (/legal/app-demo): sections, features, steps and their versions.
    const appDemoController = require('../controllers/appDemoController');
    const appDemoLimits = require('../utils/appDemo');
    const appDemoUpload = multer({
        dest: 'uploads/',
        limits: { fileSize: appDemoLimits.MAX_FILE_BYTES, files: appDemoLimits.MAX_FILES_PER_UPLOAD },
        fileFilter: (req, file, cb) => cb(null, Boolean(appDemoLimits.MEDIA_TYPES[file.mimetype])),
    });
    const appDemoFiles = (field, many) => (req, res, next) => {
        const handler = many ? appDemoUpload.array(field, appDemoLimits.MAX_FILES_PER_UPLOAD) : appDemoUpload.single(field);
        handler(req, res, (err) => {
            if (!err) return next();
            const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 25 MB or smaller.'
                : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Upload up to ${appDemoLimits.MAX_FILES_PER_UPLOAD} files at a time.`
                : 'Upload failed.';
            return res.status(400).json({ success: false, message });
        });
    };
    const appDemoAdmin = [isAuthenticated, ensureAdmin];
    router.get("/app-demo", ...appDemoAdmin, appDemoController.adminPage);
    router.post("/app-demo/sections", ...appDemoAdmin, appDemoController.createSection);
    router.post("/app-demo/sections/reorder", ...appDemoAdmin, appDemoController.reorderSections);
    router.post("/app-demo/sections/:id(\\d+)", ...appDemoAdmin, appDemoController.updateSection);
    router.post("/app-demo/sections/:id(\\d+)/delete", ...appDemoAdmin, appDemoController.deleteSection);
    router.post("/app-demo/features", ...appDemoAdmin, appDemoController.createFeature);
    router.post("/app-demo/features/reorder", ...appDemoAdmin, appDemoController.reorderFeatures);
    router.post("/app-demo/features/:id(\\d+)", ...appDemoAdmin, appDemoController.updateFeature);
    router.post("/app-demo/features/:id(\\d+)/delete", ...appDemoAdmin, appDemoController.deleteFeature);
    router.post("/app-demo/features/:id(\\d+)/screens", ...appDemoAdmin, appDemoFiles('files', true), appDemoController.addScreens);
    router.post("/app-demo/features/:id(\\d+)/screens/reorder", ...appDemoAdmin, appDemoController.reorderScreens);
    router.post("/app-demo/screens/:id(\\d+)", ...appDemoAdmin, appDemoController.updateScreen);
    router.post("/app-demo/screens/:id(\\d+)/delete", ...appDemoAdmin, appDemoController.deleteScreen);
    router.post("/app-demo/screens/:id(\\d+)/media", ...appDemoAdmin, appDemoFiles('files', true), appDemoController.addMedia);
    router.post("/app-demo/screens/:id(\\d+)/media/reorder", ...appDemoAdmin, appDemoController.reorderMedia);
    router.post("/app-demo/media/:id(\\d+)", ...appDemoAdmin, appDemoFiles('file', false), appDemoController.updateMedia);
    router.post("/app-demo/media/:id(\\d+)/delete", ...appDemoAdmin, appDemoController.deleteMedia);
    router.post("/app-demo/media/:id(\\d+)/guide", ...appDemoAdmin, appDemoController.updateGuide);
    router.post("/app-demo/capture", ...appDemoAdmin, appDemoController.startCapture);
    router.post("/app-demo/capture/stop", ...appDemoAdmin, appDemoController.stopCapture);

    router.post("/announcements", isAuthenticated, ensureAdmin, (req, res) => {
        req.flash("info", 'Dashboard notices are now created with "New Announcement" (choose Dashboard notice).');
        res.redirect("/admin/announcements");
    });
    router.post("/announcements/toggle/:id", isAuthenticated, ensureAdmin, adminController.toggleAdminAnnouncement);
    router.post("/announcements/delete/:id", isAuthenticated, ensureAdmin, adminController.deleteAdminAnnouncement);
    router.get('/email-suppressions', isAuthenticated, ensureAdmin, adminController.getEmailSuppressionsPage);
    router.post('/email-suppressions/remove', isAuthenticated, ensureAdmin, express.urlencoded({ extended: true }), adminController.removeEmailSuppression);
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
    router.get('/helpMessages', ensureAdminOrMiniAdmin, async (req, res) => {
        try {
            await adminController.helpMessages(req, res);
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to load help messages.');
            res.redirect('/admin');
        }
    });

    router.get('/feedback', ensureAdminOrMiniAdmin, async (req, res) => {
        try {
            await adminController.feedbackInbox(req, res);
        } catch (error) {
            req.flash('error', 'Failed to load feedback.');
            res.redirect('/admin');
        }
    });

    router.post(
        '/feedback/:id/status',
        ensureAdminOrMiniAdmin,
        express.json(),
        express.urlencoded({ extended: true }),
        adminController.updateFeedbackStatus
    );

    router.post('/respondMessage', ensureAdminOrMiniAdmin, adminController.respondToMessage);
    router.post('/resolveMessage', ensureAdminOrMiniAdmin, adminController.markAsResolved);
    router.get('/helpHistory', ensureAdminOrMiniAdmin, async (req, res) => {
        try {
            await adminController.helpHistory(req, res);
        } catch (error) {
            // ...removed error log for clean background operation...
            req.flash('error', 'Failed to load help history.');
            res.redirect('/admin');
        }
    });

    router.post('/setFeaturePrice', ensureAdmin, async (req, res) => {
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
      

    router.post('/reopenThread', ensureAdminOrMiniAdmin, adminController.reopenThread);
    router.post('/deleteThread', ensureAdminOrMiniAdmin, adminController.deleteThread);
    router.post('/tempDeleteMessage', ensureAdminOrMiniAdmin, adminController.tempDeleteMessage);
    router.post('/bulkDeleteMessages', ensureAdminOrMiniAdmin, async (req, res) => {
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
    router.post('/restoreMessage', ensureAdmin, adminController.restoreMessage);
    router.post('/permanentDeleteMessage', ensureAdmin, adminController.permanentDeleteMessage); 

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
    router.post('/updatePlatformFeeSettings', ensureAdmin, adminController.updatePlatformFeeSettings);
    router.post('/updateBillingPeriod', ensureAdmin, adminController.updateBillingPeriod);
    router.get('/getBillingPeriods', ensureAdmin, adminController.getBillingPeriods);
    router.post('/updatePaymentProviderSettings', ensureAdmin, adminController.updatePaymentProviderSettings);
    router.post('/updatePaystackSettings', ensureAdmin, adminController.updatePaystackSettings);
    router.post('/updateStripeSettings', ensureAdmin, adminController.updateStripeSettings);

    // Student count tier routes
    router.post('/addStudentTier', ensureAdmin, adminController.addStudentTier);
    router.post('/saveStudentTiers', ensureAdmin, adminController.saveStudentTiers);
    router.post('/updateStudentTier', ensureAdmin, adminController.updateStudentTier);
    router.post('/deleteStudentTier', ensureAdmin, adminController.deleteStudentTier);
    router.get('/getStudentTiers', ensureAdmin, adminController.getStudentTiers);

    // ============================================================
    // Dynamic Pricing v2 (Beta) — parallel routes, isolated from the live system
    // ============================================================
    router.get('/dynamicPricing', ensureAdmin, adminController.dynamicPricingGet);
    router.post('/dynamicPricing/regions', ensureAdmin, adminController.createRegion);
    router.post('/dynamicPricing/regions/:id', ensureAdmin, adminController.updateRegion);
    router.post('/dynamicPricing/regions/:id/delete', ensureAdmin, adminController.deleteRegion);
    router.post('/dynamicPricing/planRegionPrices', ensureAdmin, adminController.upsertPlanRegionPrice);
    router.post('/dynamicPricing/cycles', ensureAdmin, adminController.createDynamicCycle);
    router.post('/dynamicPricing/cycles/:id', ensureAdmin, adminController.updateDynamicCycle);
    router.post('/dynamicPricing/cycles/:id/delete', ensureAdmin, adminController.deleteDynamicCycle);
    router.post('/dynamicPricing/termMonths', ensureAdmin, adminController.updateDynamicTermMonths);
    router.post('/dynamicPricing/preview', ensureAdmin, adminController.previewDynamicPrice);

    router.post("/deleteFeature", ensureAdmin, adminController.deleteFeature);

    router.get('/data-export', ensureAdmin, adminController.dataExportPage);
    router.post('/generate-organization-csv', ensureAdmin, adminController.generateOrganizationCSV);

    // Hub Management Routes
    router.get('/hubs', ensureAdmin, adminController.hubsListGet);
    const hubForms = require('../controllers/hubBillingController');
    router.get('/hubs/create', ensureAdmin, hubForms.adminHubCreateFormGet);
    router.post('/hubs/create', ensureAdmin, adminController.hubCreatePost);
    router.get('/hubs/:hubId(\\d+)/edit', ensureAdmin, hubForms.adminHubEditFormGet);
    router.get('/hubs/:hubId(\\d+)/password', ensureAdmin, hubForms.adminHubPasswordFormGet);
    router.get('/hubs/:hubId(\\d+)/organizations/:organizationId(\\d+)/licenses', ensureAdmin, hubForms.adminSchoolLicensesFormGet);
    router.get('/hubs/:hubId(\\d+)/organizations/:organizationId(\\d+)/plan', ensureAdmin, hubForms.adminSchoolPlanFormGet);
    router.post('/hubs/:hubId(\\d+)/organizations/:organizationId(\\d+)/plan', ensureAdmin, hubForms.adminSchoolPlanPost);
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
    // Hub billing (contract, Stripe payment link, charges, holds) and the add-on catalog.
    const hubBilling = require('../controllers/hubBillingController');
    router.get('/hubs/add-ons', ensureAdmin, hubBilling.adminAddonsGet);
    router.get('/hubs/add-ons/new', ensureAdmin, hubBilling.adminAddonFormGet);
    router.get('/hubs/add-ons/:addonId(\\d+)/edit', ensureAdmin, hubBilling.adminAddonFormGet);
    router.post('/hubs/add-ons', ensureAdmin, hubBilling.adminAddonSavePost);
    router.post('/hubs/integration-prices', ensureAdmin, hubBilling.adminIntegrationPricesPost);
    router.post('/hubs/add-ons/:addonId(\\d+)', ensureAdmin, hubBilling.adminAddonSavePost);
    router.post('/hubs/add-ons/:addonId(\\d+)/toggle', ensureAdmin, hubBilling.adminAddonTogglePost);
    router.get('/hubs/:hubId(\\d+)/billing', ensureAdmin, hubBilling.adminBillingGet);
    router.post('/hubs/:hubId(\\d+)/billing', ensureAdmin, hubBilling.adminBillingSavePost);
    router.get('/hubs/:hubId(\\d+)/billing/plan', ensureAdmin, hubBilling.adminPlanFormGet);
    router.get('/hubs/:hubId(\\d+)/billing/invoices/:invoiceId([A-Za-z0-9_]+)/pdf', ensureAdmin, hubBilling.invoicePdfGet);
    router.get('/hubs/:hubId(\\d+)/billing/charges/new', ensureAdmin, hubBilling.adminChargeFormGet);
    router.get('/hubs/:hubId(\\d+)/billing/hold', ensureAdmin, hubBilling.adminHoldFormGet);
    router.get('/hubs/:hubId(\\d+)/billing/end', ensureAdmin, hubBilling.adminEndFormGet);
    router.get('/hubs/:hubId(\\d+)/people/new', ensureAdmin, hubBilling.adminPersonFormGet);
    router.post('/hubs/:hubId(\\d+)/billing/send-link', ensureAdmin, hubBilling.adminSendLinkPost);
    router.post('/hubs/:hubId(\\d+)/billing/new-link', ensureAdmin, hubBilling.adminNewLinkPost);
    router.post('/hubs/:hubId(\\d+)/billing/sync', ensureAdmin, hubBilling.adminSyncPost);
    router.post('/hubs/:hubId(\\d+)/billing/charges', ensureAdmin, hubBilling.adminChargeAddPost);
    router.post('/hubs/:hubId(\\d+)/billing/charges/:chargeId(\\d+)/remove', ensureAdmin, hubBilling.adminChargeRemovePost);
    router.post('/hubs/:hubId(\\d+)/billing/hold', ensureAdmin, hubBilling.adminHoldPost);
    router.post('/hubs/:hubId(\\d+)/billing/resume', ensureAdmin, hubBilling.adminResumePost);
    router.post('/hubs/:hubId(\\d+)/billing/cancel-hold', ensureAdmin, hubBilling.adminCancelHoldPost);
    router.post('/hubs/:hubId(\\d+)/billing/end', ensureAdmin, hubBilling.adminEndPost);
    router.post('/hubs/:hubId(\\d+)/billing/restart', ensureAdmin, hubBilling.adminRestartPost);
    router.post('/hubs/:hubId(\\d+)/people', ensureAdmin, hubBilling.adminPersonAddPost);
    router.post('/hubs/:hubId(\\d+)/people/:hubUserId(\\d+)/invite', ensureAdmin, hubBilling.adminPersonInvitePost);
    router.post('/hubs/:hubId/send-reset', ensureAdmin, adminController.hubSendResetPost);
    router.post('/organizations/:organizationId(\\d+)/licenses', ensureAdmin, adminController.organizationLicensesPost);
    router.post('/hubs/:hubId/set-password', ensureAdmin, adminController.hubSetPasswordPost);
    router.get('/hub/:hubId', ensureAdmin, ensureHubSwitchPasswordVerified, adminController.hubEnterGet);
    // "Back to Admin" from a hub. The router-level restore has already run.
    router.get('/exit-hub', (req, res) => {
        req.flash('success', 'Returned to admin.');
        res.redirect('/admin/hubs');
    });

    return router;
};
