// routes/accountRoute.js
const express = require("express");
const router = express.Router();
const accountController = require("../controllers/accountController");
const guardianMessagingController = require("../controllers/guardianMessagingController");
const themeController = require("../controllers/themeController");
const accountValidation = require("../validation/accountValidation");
const { authRateLimit, signInGuard } = require("../utils/authRateLimit");
const { keepSignedInChoice } = require("../utils/keepSignedIn");
const loginCode = require("../utils/loginCode");
const { holdForCode } = loginCode;
const { isAuthenticated } = require("../middleware/authMiddleware");
const { upload } = require("../middleware/s3Upload");
const db = require("../config/db");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const websiteController = require("../controllers/websiteController");

// Registration Routes
router.get("/register", (req, res) => accountController.registerGet(req, res));
router.post(
  "/register",
  upload.fields([{ name: "proof1" }, { name: "proof2" }]),
  require("../utils/humanCheck").requireHuman("register", { back: "/account/register", perHour: 10 }),
  (req, res) => accountController.registerPost(req, res)
);

// Payment Routes
router.get("/payment", (req, res) => accountController.paymentGet(req, res));
router.post("/payment", (req, res) => accountController.paymentPost(req, res, db));
router.post("/payment/stripe-intent", (req, res) => accountController.createStripePaymentIntentPost(req, res, db));
router.post("/payment/confirm", (req, res) => accountController.paymentConfirmPost(req, res, db));

// Service Plan Route
router.get("/service-plan", (req, res) => accountController.servicePlanGet(req, res));
router.post("/service-plan", (req, res) => accountController.servicePlanPost(req, res));
router.post("/geo-hint", (req, res) => {
  const countryCode = String(req.body?.countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({ success: false, message: "Invalid country code." });
  }

  req.session.geoCountryHint = {
    countryCode,
    updatedAt: Date.now(),
  };

  return res.json({ success: true, countryCode });
});

// Password Confirmation Routes
router.get("/confirm-password", accountController.confirmPasswordGet);
router.post("/confirm-password", accountController.confirmPasswordPost);
router.post("/confirm-password/json", isAuthenticated, accountController.confirmPasswordJson);

// Only Managira cancels or resumes a school's subscription (Admin › Organizations,
// utils/subscriptionCancel.js): the school asks support. Old links and forms land on Billing & Plan.
const askSupportToCancel = (req, res) => {
  req.flash("info", "To cancel or keep your subscription, contact Managira support at support@managira.com.");
  return res.redirect("/account/settings?section=billing");
};
router.get("/cancel-subscription", isAuthenticated, askSupportToCancel);
router.post("/cancel-subscription", isAuthenticated, askSupportToCancel);
router.post("/resume-or-cancel-cancellation", isAuthenticated, askSupportToCancel);

// Login and Logout Routes
router.get("/login", (req, res) => accountController.loginGet(req, res, db));
// The first step of the login page: the email decides between a password and single sign-on.
router.post("/login/continue", (req, res) => require("../controllers/ssoController").continueWithEmail(req, res, db));
// The verification code step, once the password was right.
router.get("/login/code", (req, res) => loginCode.page(req, res, db));
// Two-step sign-in with an authenticator app, each person for themselves (utils/signInMfa.js).
{
  const authenticator = require("../controllers/authenticatorController");
  router.get("/authenticator", isAuthenticated, (req, res) => authenticator.page(req, res, db));
  router.get("/authenticator/status", isAuthenticated, (req, res) => authenticator.status(req, res, db));
  router.post("/authenticator/start", isAuthenticated, express.json(), (req, res) => authenticator.start(req, res, db));
  router.post("/authenticator/confirm", isAuthenticated, express.json(), (req, res) => authenticator.confirm(req, res, db));
  router.post("/authenticator/off", isAuthenticated, express.json(), (req, res) => authenticator.off(req, res, db));
}
// Settings, Tenant configuration: a school's sign-in rules. Managers only.
{
  const { blockGuardians } = require("../middleware/authMiddleware");
  const tenant = require("../controllers/tenantController");
  const door = [isAuthenticated, blockGuardians, requirePermission(PERMISSIONS.MANAGE_SETTINGS), tenant.managersOnly];
  router.get("/settings/tenant", ...door, (req, res) => tenant.get(req, res, db));
  router.post("/settings/tenant", ...door, (req, res) => tenant.save(req, res, db));
  router.post("/settings/tenant/authenticator/reset", ...door, express.json(), (req, res) => tenant.resetAuthenticator(req, res, db));
}
router.post("/login/verify-code", signInGuard("login-code", { field: "email" }), (req, res) => loginCode.verify(req, res, db));
router.post("/login/resend-code", (req, res) => loginCode.resend(req, res, db));
// Sign-in page ads: PDFs served same-origin so PDF.js can render them, plus click counts.
const loginAdsController = require("../controllers/loginAdsController");
router.get("/login-ads/:id(\\d+)/file", loginAdsController.serveFile);
router.post("/login-ads/:id(\\d+)/click", loginAdsController.recordSignInClick);
// Signing in for Mira (next=mira): staff go back to Mira once signed in, and a
// wrong try keeps the way back. Parents and students go to their own portal:
// Mira is for staff only.
function backToMiraAfterSignIn(req, res, next) {
  if (String((req.body && req.body.next) || req.query.next || "") !== "mira") return next();
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    const status = args.length > 1 ? args[0] : 302;
    const url = String(args.length > 1 ? args[1] : args[0] || "");
    const session = req.session || {};
    const staffSignedIn = !!session.userId && !session.guardianId && !session.studentId && !session.pendingLogin;
    if (/^\/account\/login(\?|$)/.test(url)) {
      return redirect(status, url.includes("next=mira") ? url : `${url}${url.includes("?") ? "&" : "?"}next=mira`);
    }
    if (staffSignedIn && !/^\/account\//.test(url)) {
      return redirect(303, `${require("../utils/miraIntegration").miraPublicUrl()}/continue`);
    }
    return redirect(...args);
  };
  return next();
}

router.post(
  "/login",
  backToMiraAfterSignIn,
  signInGuard("login", { field: "email" }),
  keepSignedInChoice,
  holdForCode,
  accountValidation.validateLogin,
  accountValidation.validateLoginResult,
  (req, res) => accountController.loginPost(req, res, db)
);

// Guardian (Parent Portal) Login Routes
router.get("/guardian-login", (req, res) =>
  accountController.guardianLoginGet(req, res, db)
);
router.post(
  "/guardian-login",
  signInGuard("guardian-login", { field: "identifier" }),
  keepSignedInChoice,
  holdForCode,
  accountValidation.validateGuardianLogin,
  accountValidation.validateGuardianLoginResult,
  (req, res) => accountController.guardianLoginPost(req, res, db)
);
router.get("/student-login", (req, res) =>
  accountController.studentLoginGet(req, res, db)
);
router.post(
  "/student-login",
  signInGuard("student-login", { field: "email" }),
  keepSignedInChoice,
  holdForCode,
  accountValidation.validateStudentLogin,
  accountValidation.validateStudentLoginResult,
  (req, res) => accountController.studentLoginPost(req, res, db)
);
router.get("/logout", (req, res) =>
  accountController.logoutGet(req, res, db)
);

// About me on the person's own profile (utils/staffAbout.js, feature teacher_cards).
const staffAboutController = require("../controllers/staffAboutController");
const aboutPhotoUpload = require("multer")({ storage: require("multer").memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const aboutPhoto = (req, res, next) => aboutPhotoUpload.single("photo")(req, res, (error) => {
  if (!error) return next();
  const message = error.code === "LIMIT_FILE_SIZE" ? "That photo is too large. Choose one under 8 MB." : "That photo could not be read. Try another.";
  return res.status(400).json({ success: false, message });
});
router.post("/about", isAuthenticated, express.json({ limit: "16kb" }), (req, res) => staffAboutController.saveFact(req, res, db));
router.post("/about/photo", isAuthenticated, aboutPhoto, (req, res) => staffAboutController.addPhoto(req, res, db));
router.post("/about/photo/remove", isAuthenticated, express.json({ limit: "4kb" }), (req, res) => staffAboutController.removePhoto(req, res, db));

router.get("/update", isAuthenticated, (req, res) =>
  accountController.updateGet(req, res, db)
);
router.post(
  "/update",
  isAuthenticated,
  accountValidation.validateAccountUpdate,
  accountValidation.validateUpdateResult,
  (req, res) => accountController.updatePost(req, res, db)
);

// Personalization Routes
router.get(
  "/personalization",
  checkFeatureAccess,
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_PROFILE),
  (req, res) => accountController.personalizationGet(req, res, db)
);
router.post("/personalization", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), (req, res) =>
  accountController.personalizationPost(req, res, db)
);
router.post("/personalization/logo", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), upload.single("logo"), (req, res) =>
  accountController.personalizationLogoPost(req, res, db)
);
router.post("/personalization/name", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), (req, res) =>
  accountController.updateOrgNamePost(req, res, db)
);
router.post("/personalization/font", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), (req, res) =>
  accountController.updateFontPost(req, res, db)
);
router.post("/personalization/display-preferences", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), (req, res) =>
  accountController.updateDisplayPreferencesPost(req, res, db)
);
router.post("/personalization/theme", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), (req, res) =>
  themeController.updateThemePost(req, res)
);
router.post("/personalization/student-id", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), (req, res) =>
  accountController.updateStudentIdSettingsPost(req, res, db)
);
router.post(
  "/personalization/nickname",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_PROFILE),
  accountValidation.validateNickname,
  accountValidation.validateNicknameResult,
  (req, res) => accountController.updateNicknamePost(req, res, db)
);

// Public Content Management Routes
router.get(
  "/managePublicContent",
  checkFeatureAccess,
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  (req, res) => accountController.managePublicContentGet(req, res, db)
);
router.post(
  "/managePublicContent/website-destination",
  checkFeatureAccess,
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  express.json(),
  express.urlencoded({ extended: true }),
  (req, res) => accountController.saveSchoolWebsiteDestinationPost(req, res)
);
router.post(
  "/uploadSlideshowImages",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  require("../utils/mediaOptimize").websiteMediaFields("slideshowImages"),
  (req, res) => accountController.uploadSlideshowImages(req, res, db)
);
router.post(
  "/addTextSection",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  accountValidation.validateTextSection,
  accountValidation.validateTextSectionResult,
  (req, res) => accountController.addTextSection(req, res, db)
);
// School website extras (sections, images, contact-form inbox).
router.post("/website/section/:key", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), websiteController.saveSection);
router.post("/website/image", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), upload.single("image"), websiteController.uploadImage);
router.get("/website/messages", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), websiteController.listMessages);
router.post("/website/messages/:id", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), websiteController.updateMessage);
router.post("/updateImage", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), (req, res) =>
  accountController.updateImagePost(req, res, db)
);
router.post("/deleteImage/:imageId", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), (req, res) =>
  accountController.deleteImageGet(req, res, db)
);
router.post(
  "/updateText",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  accountValidation.validateTextSection,
  accountValidation.validateTextSectionResult,
  (req, res) => accountController.updateTextPost(req, res, db)
);
router.post("/deleteText/:textId", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), (req, res) =>
  accountController.deleteTextGet(req, res, db)
);
router.post("/update-about-us", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_WEBSITE), (req, res) =>
  accountController.updateAboutUsSection(req, res, db)
);

// School Website Theme
router.post(
  "/updatePublicDashboardTheme",
  checkFeatureAccess,
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  (req, res) => accountController.updatePublicDashboardThemePost(req, res, db)
);

// School Website mode (light or dark for visitors)
router.post(
  "/updatePublicSiteAppearance",
  checkFeatureAccess,
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  (req, res) => accountController.updatePublicSiteAppearancePost(req, res, db)
);

// School Website Layout
router.post(
  "/updatePublicDashboardLayout",
  checkFeatureAccess,
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  (req, res) => accountController.updatePublicDashboardLayoutPost(req, res, db)
);

// Password Reset Routes
router.get("/forget-password", (req, res) =>
  accountController.forgetPasswordGet(req, res, db)
);
router.post("/forget-password", authRateLimit("forget-password", { field: "email", perAccount: 5, perIp: 50 }), (req, res) =>
  accountController.forgetPasswordPost(req, res, db)
);
router.get("/reset-password", (req, res) =>
  accountController.resetPasswordGet(req, res, db)
);
router.post("/reset-password", authRateLimit("reset-password", { field: "token", perIp: 50 }), (req, res) =>
  accountController.resetPasswordPost(req, res, db)
);

// Settings overview (new). Integrations isn't part of it: an old link to its section goes to
// the Integrations page (keeping anything else the link carried).
router.get("/settings", isAuthenticated, (req, res) => {
  if (String(req.query.section || "").trim().toLowerCase() === "integrations") {
    const rest = new URLSearchParams(req.query);
    rest.delete("section");
    const query = rest.toString();
    return res.redirect(`/account/integrations${query ? `?${query}` : ""}`);
  }
  res.locals.alertRulesOn = require("../utils/alertRules").featureOn(req.session && req.session.organizationId);
  return accountController.settingsGet(req, res, db);
});
// Integrations: a page of its own, opened in Management (middleware/workspaceOnly.js), built
// from the same data and checks as Settings, showing only its section.
router.get("/integrations", isAuthenticated, (req, res) => {
  req.query.section = "integrations";
  res.locals.integrationsPage = true;
  return accountController.settingsGet(req, res, db);
});
router.get(
  "/invoices/:invoiceId/pdf",
  isAuthenticated,
  requirePermission(PERMISSIONS.MANAGE_BILLING),
  (req, res) => accountController.appInvoicePdfGet(req, res, db)
);
router.post("/settings/profile", isAuthenticated, (req, res) =>
  accountController.updateProfileNamePost(req, res, db)
);
router.post("/settings/notifications", isAuthenticated, require("../utils/jsonSaves"), (req, res) =>
  accountController.updateNotificationPreferencesPost(req, res, db)
);
// The whole school's email choices: School Profile, as the same setting through Mira.
router.post("/settings/notifications/organization", isAuthenticated, requirePermission(PERMISSIONS.SETTINGS_PROFILE), require("../utils/jsonSaves"), (req, res) =>
  accountController.updateOrgNotificationPreferencesPost(req, res, db)
);
router.post("/settings/profile-image", 
  isAuthenticated, 
  upload.single("profileImage"),
  (req, res) => accountController.updateProfileImagePost(req, res, db)
);
router.post("/settings/profile-image/delete",
  isAuthenticated,
  (req, res) => accountController.deleteProfileImagePost(req, res, db)
);
router.post("/settings/security/email", isAuthenticated, (req, res) =>
  accountController.updateSecurityEmailPost(req, res, db)
);
router.post("/settings/security/password", isAuthenticated, (req, res) =>
  accountController.updateSecurityPasswordPost(req, res, db)
);
router.post(
  "/settings/platform-fee-bearer",
  isAuthenticated,
  requirePermission(PERMISSIONS.MANAGE_BILLING),
  (req, res) => accountController.updatePlatformFeeBearerPost(req, res, db)
);
router.post(
  "/settings/pay-now",
  isAuthenticated,
  requirePermission(PERMISSIONS.MANAGE_BILLING),
  (req, res) => accountController.payNowPost(req, res, db)
);
router.post(
  "/settings/calendar/profile",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_PROFILE),
  (req, res) => accountController.saveAttendanceCalendarProfilePost(req, res, db)
);
router.post(
  "/settings/calendar/day",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_PROFILE),
  (req, res) => accountController.addAttendanceCalendarDayPost(req, res, db)
);
router.post(
  "/settings/calendar/day/delete",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_PROFILE),
  (req, res) => accountController.deleteAttendanceCalendarDayPost(req, res, db)
);
router.post(
  "/google-classroom/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.googleClassroomActivationPost
);
router.post(
  "/student-portal/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.studentPortalActivationPost
);
router.post(
  "/parent-portal/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.parentPortalActivationPost
);
router.post(
  "/mira/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_MIRA),
  accountController.miraActivationPost
);
router.get(
  "/mira",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_MIRA),
  accountController.miraSettingsGet
);
router.get(
  "/mira/info",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_MIRA),
  accountController.miraInfoGet
);
// Whether this person may open Mira now (the header's panel asks before showing "no access").
router.get("/mira/access", isAuthenticated, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    return res.json(await require("../utils/miraAccess").accessFor(req));
  } catch (error) {
    console.error("[mira/access]", error);
    return res.status(503).json({ error: "Unable to check Mira access right now." });
  }
});
router.get(
  "/mira/users",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_MIRA),
  accountController.miraUsersGet
);
router.get(
  "/mira/user/:userId",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_MIRA),
  accountController.miraUserPermissionsGet
);
router.post(
  "/mira/user/:userId",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_MIRA),
  accountController.miraUserPermissionsPost
);
router.post(
  "/transportation/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.transportationActivationPost
);
router.post(
  "/transportation/google-maps-nav/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.googleMapsNavActivationPost
);
router.post(
  "/transportation/apple-maps-nav/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.appleMapsNavActivationPost
);
router.post(
  "/whatsapp/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.whatsappActivationPost
);
router.post(
  "/whatsapp/connect",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.whatsappConnectPost
);
router.post(
  "/whatsapp/disconnect",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.whatsappDisconnectPost
);
router.get(
  "/whatsapp/setup-status",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.whatsappSetupStatusGet
);
router.post(
  "/whatsapp/test-message",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.whatsappTestMessagePost
);
router.post(
  "/sms/activate",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.smsActivationPost
);
router.post(
  "/sms/settings",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.smsSettingsSavePost
);
router.post(
  "/sms/check",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.smsCheckConnectionPost
);
router.post(
  "/sms/test-message",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.smsTestMessagePost
);
router.get(
  "/messaging/status",
  isAuthenticated,
  guardianMessagingController.channelStatus
);
router.post(
  "/messaging/resolve",
  isAuthenticated,
  guardianMessagingController.resolve
);
router.post(
  "/messaging/broadcast",
  isAuthenticated,
  guardianMessagingController.broadcast
);
router.post(
  "/messaging/sentStatus",
  isAuthenticated,
  guardianMessagingController.sentStatus
);
router.post(
  "/messaging/saveContacts",
  isAuthenticated,
  guardianMessagingController.saveContacts
);
router.post(
  "/messaging/resend",
  isAuthenticated,
  guardianMessagingController.resend
);
router.get(
  "/messaging/mailroomDirectory",
  isAuthenticated,
  requirePermission(PERMISSIONS.MAILROOM),
  guardianMessagingController.mailroomDirectory
);
router.post(
  "/messaging/mailroomDeleteStudentContact",
  isAuthenticated,
  requirePermission(PERMISSIONS.MAILROOM),
  guardianMessagingController.mailroomDeleteStudentContact
);
router.post(
  "/messaging/mailroomSend",
  isAuthenticated,
  requirePermission(PERMISSIONS.MAILROOM),
  guardianMessagingController.mailroomSend
);
router.get(
  "/messaging/mailroomHistory",
  isAuthenticated,
  requirePermission(PERMISSIONS.MAILROOM),
  guardianMessagingController.mailroomHistory
);
router.post(
  "/messaging/mailroomResend",
  isAuthenticated,
  requirePermission(PERMISSIONS.MAILROOM),
  guardianMessagingController.mailroomResend
);
router.get(
  "/google-classroom/connect",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.googleClassroomConnectGet
);
router.get(
  "/google-classroom/callback",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.googleClassroomCallbackGet
);
// Sync is also on the assessments' question sets page, for whoever manages assessments.
router.post(
  "/google-classroom/resync",
  isAuthenticated,
  requirePermission([PERMISSIONS.SETTINGS_INTEGRATIONS, PERMISSIONS.MANAGE_ASSESSMENTS]),
  accountController.googleClassroomResyncPost
);
router.post(
  "/google-classroom/options",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.googleClassroomOptionsPost
);
router.post(
  "/google-classroom/disconnect",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_INTEGRATIONS),
  accountController.googleClassroomDisconnectPost
);

// Payment Method Management Routes
router.get("/update-card", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) => {
  if (!req.session.passwordVerified) {
    return res.redirect(
      "/account/confirm-password?redirect=/account/update-card"
    );
  }
  accountController.updateCardGet(req, res, db);
});
router.post("/cards/stripe/setup-intent", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.createStripeCardSetupIntentPost(req, res, db)
);
router.post("/cards/stripe/complete", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.completeStripeCardSetupPost(req, res, db)
);
router.post("/api/tokenize-card", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.tokenizeCard(req, res)
);
router.post("/cards/set-primary", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.setPrimaryCardPost(req, res)
);
router.post("/cards/set-fallback-order", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.setCardFallbackOrderPost(req, res)
);
router.post("/cards/set-display-name", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.setCardDisplayNamePost(req, res)
);
router.post("/api/tokenize-card/pin", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.tokenizeCardSubmitPin(req, res)
);
router.post("/api/tokenize-card/otp", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.tokenizeCardSubmitOtp(req, res)
);
router.post("/api/tokenize-card/phone", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.tokenizeCardSubmitPhone(req, res)
);
router.post("/remove-card", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.removeCardPost(req, res, db)
);

// Paystack Subaccount Routes
router.post("/add-paystack-subaccount", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.addPaystackSubaccountPost(req, res)
);
router.get("/paystack/:id", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.getPaystackSubaccountById(req, res)
);
router.put("/paystack", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.updatePaystackSubaccount(req, res)
);
router.delete("/paystack/:id", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.deletePaystackSubaccount(req, res)
);
router.post("/paystack/set-primary", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.setPaystackSubaccountPrimary(req, res)
);

// Stripe Connect — school payout account onboarding
router.get("/stripe-connect/onboard", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.stripeConnectOnboardGet(req, res)
);
router.get("/stripe-connect/return", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.stripeConnectReturnGet(req, res)
);
router.get("/stripe-connect/refresh", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.stripeConnectRefreshGet(req, res)
);

// Save a Stripe card as a Self Enrollment Transaction Account
router.post("/paystack/stripe-card", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.saveStripeCardAsSubaccountPost(req, res)
);


// Utility API: Paystack banks
router.get('/paystack-banks', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) => accountController.listPaystackBanks(req, res));

router.post('/settings/payout-preference', isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.updatePayoutPreferencePost(req, res)
);

// Subscription Plan Management Routes
router.get("/update-plan", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.updatePlanGet(req, res, db)
);
router.post("/update-plan", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING), (req, res) =>
  accountController.updatePlanPost(req, res, db)
);

// Webhook Route for Stripe Events (Legacy)
router.get("/whatsapp/webhook", (req, res) =>
  accountController.whatsappWebhookVerifyGet(req, res)
);
// The raw body is kept so the controller can check Meta's X-Hub-Signature-256.
router.post("/whatsapp/webhook", express.json({ type: "application/json", verify: (req, res, buf) => { req.rawBody = buf; } }), (req, res) =>
  accountController.whatsappWebhookPost(req, res)
);

// SMS delivery-status callbacks (Arkesel, Africa's Talking, Twilio all post here — no auth, providers only).
router.post(
  "/sms/webhook/:provider",
  express.json(),
  express.urlencoded({ extended: false }),
  (req, res) => accountController.smsWebhookPost(req, res)
);

// Webhook Route for Stripe Events (Legacy)
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) =>
  accountController.webhookPost(req, res)
);

// Webhook Route for Paystack Events
router.post("/paystack-webhook", express.raw({ type: "application/json" }), (req, res) =>
  accountController.paystackWebhookPost(req, res)
);

// Promo Code Validation Route
router.get("/validate-promo", (req, res) =>
  accountController.validatePromoGet(req, res)
);

// Was previously reachable with no auth/permission check at all - any
// request carrying a valid organizationId in session could flip a school's
// public self-enrollment on/off and set its price, unlike every sibling
// route on this same page. Brought in line with the rest of Public Content
// Management above.
router.post(
  "/updatePublicRegistration",
  isAuthenticated,
  requirePermission(PERMISSIONS.SETTINGS_WEBSITE),
  accountController.updatePublicRegistration
);


// Hub Invitation Routes
router.get("/accept-hub-invitation/:token", accountController.hubInvitationAcceptGet);
router.post("/accept-hub-invitation/:token", accountController.hubInvitationAcceptPost);
router.get("/accept-hub-invitation-existing/:token", accountController.hubInvitationAcceptExistingGet);
router.post("/accept-hub-invitation-existing/:token", accountController.hubInvitationAcceptExistingPost);

// Hub Detachment Routes
router.post("/request-hub-detachment", isAuthenticated, accountController.requestHubDetachmentPost);

module.exports = router;
