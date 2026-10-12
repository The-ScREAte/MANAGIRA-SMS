const express = require('express');
const router = express.Router();
const hubController = require('../controllers/hubController');
const hubUsersController = require('../controllers/hubUsersController');
const hubBillingController = require('../controllers/hubBillingController');
const { isHubAuthenticated, fetchHubInfo } = require('../middleware/hubAuthMiddleware');
const { upload } = require('../middleware/s3Upload');
const { ensureHubAccessSchema, loadHubActor, actorCan } = require('../utils/hubAccess');

// Someone who opened a school from the hub comes back to the hub on any /hub page.
router.use((req, res, next) => {
  if (req.session && req.session.hubOrgSwitch && req.path !== '/exit-org') hubController.restoreHubFromOrg(req);
  next();
});
router.get('/exit-org', hubController.exitOrganizationGet);

// Forms opened in the side panel post with X-Hub-Ajax: answer with JSON
// ({ success, message, redirect }) instead of a flash message and a redirect.
router.use((req, res, next) => {
  if (req.get('X-Hub-Ajax') !== '1') return next();
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

// Public routes
router.get('/login', hubController.hubLoginGet);
router.post('/login', hubController.hubLoginPost);
router.get('/logout', hubController.hubLogoutGet);
router.get('/setup-password', hubController.setupPasswordGet);
router.post('/setup-password', hubController.setupPasswordPost);
// The card link emailed to the hub works without signing in.
router.get('/billing/setup/:token([a-f0-9]{48})', hubBillingController.setupPageGet);
router.get('/billing/setup/:token([a-f0-9]{48})/go', hubBillingController.setupGoGet);
router.get('/billing/setup/:token([a-f0-9]{48})/done', hubBillingController.setupDoneGet);

// Protected routes (require hub authentication)
router.use(isHubAuthenticated);
router.use(fetchHubInfo);

// Who is signed in (owner or hub user) and what they may do.
router.use(async (req, res, next) => {
  try {
    const db = require('../config/db');
    await ensureHubAccessSchema(db);
    const actor = await loadHubActor(db, req.session);
    if (!actor) {
      req.session.destroy(() => {});
      return res.redirect('/hub/login');
    }
    req.hubActor = actor;
    res.locals.hubActor = actor;
    res.locals.hubCan = (permission) => actorCan(actor, permission);
    next();
  } catch (err) {
    next(err);
  }
});

// Every signed-in hub page shares the same side menu (with counts) and the slim footer.
router.use(async (req, res, next) => {
  res.locals.showFooterTopSection = false;
  res.locals.hubNav = { schools: 0, invitations: 0, requests: 0, users: 0 };
  try {
    const db = require('../config/db');
    const r = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM organizations WHERE hub_id = $1 AND deleted = false AND is_hub_member = true) AS schools,
         (SELECT COUNT(*)::int FROM hub_organization_invitations WHERE hub_id = $1 AND status = 'pending') AS invitations,
         (SELECT COUNT(*)::int FROM hub_detachment_requests WHERE hub_id = $1 AND status = 'pending') AS requests,
         (SELECT COUNT(*)::int FROM hub_users WHERE hub_id = $1) AS users`,
      [req.session.hubId]
    );
    res.locals.hubNav = r.rows[0] || res.locals.hubNav;
  } catch (_e) { /* counts are optional */ }
  next();
});

// Billing: charges waiting for approval, and a nudge to add the card. People
// who manage billing land on Billing once after signing in until a card is saved.
router.use(async (req, res, next) => {
  res.locals.hubBillingPrompt = null;
  if (!actorCan(req.hubActor, 'billing.view')) return next();
  try {
    const db = require('../config/db');
    const hubBilling = require('../utils/hubBilling');
    const b = await hubBilling.loadBilling(db, req.session.hubId);
    if (!b) return next();
    const pending = (await db.query(`SELECT COUNT(*)::int AS n FROM hub_billing_charges WHERE hub_id = $1 AND status = 'pending'`, [req.session.hubId])).rows[0].n;
    res.locals.hubNav.billing = pending;
    const mode = (await require('../utils/stripeConfig').getStripeSettings(db).catch(() => ({}))).mode;
    const needsCard = hubBilling.billingLive(b) && !(b.card_last4 && b.stripe_mode === mode);
    if (needsCard) {
      res.locals.hubBillingPrompt = { canAdd: actorCan(req.hubActor, 'billing.manage') };
      if (req.method === 'GET' && req.path === '/dashboard' && res.locals.hubBillingPrompt.canAdd
          && !req.session.hubBillingPrompted && !req.session.adminHubView) {
        req.session.hubBillingPrompted = true;
        return res.redirect('/hub/billing');
      }
    }
  } catch (_e) { /* billing hints are optional */ }
  next();
});

// Only let people through who have the permission.
const can = (permission) => (req, res, next) => {
  if (actorCan(req.hubActor, permission)) return next();
  const wantsJson = req.xhr || req.get('X-Hub-Ajax') === '1' || String(req.get('accept') || '').includes('application/json');
  if (wantsJson) return res.status(403).json({ success: false, message: 'You do not have access to this.', error: 'You do not have access to this.' });
  req.flash('error', 'You do not have access to that. Ask a hub admin if you need it.');
  return res.redirect('/hub/dashboard');
};

router.get('/dashboard', hubController.hubDashboardGet);
router.get('/overview-stats', can('reports.view'), hubController.hubOverviewStatsGet);
router.get('/reports/pdf', can('reports.view'), can('reports.export'), hubController.hubReportsPdfGet);

// Settings: everyone manages their own profile and emails.
router.get('/settings', hubController.hubSettingsGet);
router.get('/settings/profile', hubController.hubProfileFormGet);
router.post('/settings/profile', hubController.hubSettingsProfilePost);
router.post('/settings/notifications', hubController.hubSettingsNotificationsPost);
router.get('/settings/hub', can('settings.manage'), hubController.hubDetailsFormGet);
router.post('/settings/hub', can('settings.manage'), hubController.hubSettingsHubPost);
router.post('/settings/logo', can('settings.manage'), upload.single('logo'), hubController.hubSettingsLogoPost);
router.get('/settings/contacts/new', can('contacts.manage'), hubController.hubContactFormGet);
router.get('/settings/contacts/:contactId(\\d+)/edit', can('contacts.manage'), hubController.hubContactFormGet);
router.post('/settings/contacts', can('contacts.manage'), hubController.hubContactSavePost);
router.post('/settings/contacts/:contactId(\\d+)', can('contacts.manage'), hubController.hubContactSavePost);
router.post('/settings/contacts/:contactId(\\d+)/delete', can('contacts.manage'), hubController.hubContactDeletePost);
router.post('/settings/contacts/:contactId(\\d+)/primary', can('contacts.manage'), hubController.hubContactPrimaryPost);

// Billing. Charges are approved and cards added by the hub itself, never by
// Managira viewing the hub.
const hubItself = (req, res, next) => {
  if (!req.session.adminHubView) return next();
  const message = 'Only the hub can do this. You are viewing it as Managira.';
  if (req.get('X-Hub-Ajax') === '1' || req.xhr) return res.status(403).json({ success: false, message });
  req.flash('error', message);
  return res.redirect('/hub/billing');
};
router.get('/billing', can('billing.view'), hubBillingController.hubBillingGet);
router.get('/billing/invoices/:invoiceId([A-Za-z0-9_]+)/pdf', can('billing.view'), hubBillingController.invoicePdfGet);
router.get('/billing/card', can('billing.manage'), hubItself, hubBillingController.hubCardGet);
router.get('/billing/card/done', can('billing.manage'), hubItself, hubBillingController.hubCardDoneGet);
router.post('/billing/charges/:chargeId(\\d+)/:decision(approve|decline)', can('billing.manage'), hubItself, hubBillingController.hubChargeDecisionPost);
router.post('/billing/add-ons/:addonId(\\d+)', can('billing.manage'), hubItself, hubBillingController.hubAddonPost);

// Hub users and roles (shown in Settings › Users & roles)
router.get('/users', can('users.manage'), (req, res) => res.redirect('/hub/settings?tab=users'));
router.get('/users/new', can('users.manage'), hubUsersController.formGet);
router.post('/users/new', can('users.manage'), hubUsersController.savePost);
router.get('/users/:hubUserId(\\d+)/edit', can('users.manage'), hubUsersController.formGet);
router.post('/users/:hubUserId(\\d+)/edit', can('users.manage'), hubUsersController.savePost);
router.post('/users/:hubUserId(\\d+)/hold', can('users.manage'), hubUsersController.holdPost);
router.post('/users/:hubUserId(\\d+)/invite', can('users.manage'), hubUsersController.invitePost);
router.post('/users/:hubUserId(\\d+)/delete', can('users.manage'), hubUsersController.deletePost);

// Organization management routes
router.get('/organizations/invite', can('invitations.manage'), hubController.organizationInviteGet);
router.post('/organizations/invite', can('invitations.manage'), hubController.organizationInvitePost);
router.get('/organizations/search', can('invitations.manage'), hubController.searchOrganizationsGet);
router.post('/organizations/invite-existing', can('invitations.manage'), hubController.inviteExistingOrgPost);
router.post('/organizations/resend-invite', can('invitations.manage'), hubController.resendInvitePost);
router.post('/organizations/cancel-invitation', can('invitations.manage'), hubController.cancelInvitationPost);
router.post('/organizations/remove', can('schools.remove'), hubController.removeOrganizationPost);
router.post('/organizations/delete', can('schools.remove'), hubController.deleteOrganizationPost);
router.post('/organizations/toggle-hold', can('schools.hold'), hubController.toggleOrganizationHoldPost);
router.get('/organizations/edit/:organizationId', can('schools.edit'), hubController.editOrganizationGet);
router.post('/organizations/edit/:organizationId', can('schools.edit'), hubController.editOrganizationPost);
router.get('/organizations/:organizationId/open', can('schools.access'), hubController.openOrganizationGet);
router.get('/organizations/:organizationId', can('schools.view'), hubController.organizationDetailsGet);
router.get('/organizations/:organizationId/report/export', can('schools.view'), can('reports.export'), hubController.organizationReportExportGet);
router.get('/organizations/:organizationId/report/pdf', can('schools.view'), can('reports.export'), hubController.organizationReportPdfGet);
router.get('/organizations/:organizationId/students', can('people.view'), hubController.organizationStudentsListGet);
router.get('/organizations/:organizationId/students/:studentId', can('people.view'), hubController.organizationStudentDetailsGet);
router.get('/organizations/:organizationId/staff', can('people.view'), hubController.organizationStaffListGet);
router.get('/organizations/:organizationId/staff/:staffId', can('people.view'), hubController.organizationStaffDetailsGet);
router.get('/organizations/:organizationId/classes', can('people.view'), hubController.organizationClassesListGet);
router.get('/organizations/:organizationId/classes/:classId', can('people.view'), hubController.organizationClassDetailsGet);

// Detachment request routes
router.post('/detachment-requests/approve', can('requests.manage'), hubController.approveDetachmentPost);
router.post('/detachment-requests/reject', can('requests.manage'), hubController.rejectDetachmentPost);

module.exports = router;
