// routes/accountRoute.js
const express = require("express");
const router = express.Router();
const accountController = require("../controllers/accountController");
const themeController = require("../controllers/themeController");
const accountValidation = require("../validation/accountValidation");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { upload } = require("../middleware/s3Upload");
const db = require("../config/db");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");

// Registration Routes
router.get("/register", (req, res) => accountController.registerGet(req, res));
router.post(
  "/register",
  upload.fields([{ name: "proof1" }, { name: "proof2" }]),
  accountValidation.validateRegistration,
  accountValidation.validateRegistrationResult,
  (req, res) => accountController.registerPost(req, res)
);

// Payment Routes
router.get("/payment", (req, res) => accountController.paymentGet(req, res));
router.post("/payment", (req, res) => accountController.paymentPost(req, res, db));
router.post("/payment/confirm", (req, res) => accountController.paymentConfirmPost(req, res, db));

// Service Plan Route
router.get("/service-plan", (req, res) => accountController.servicePlanGet(req, res));
router.post("/service-plan", (req, res) => accountController.servicePlanPost(req, res));

// Password Confirmation Routes
router.get("/confirm-password", accountController.confirmPasswordGet);
router.post("/confirm-password", accountController.confirmPasswordPost);
router.post("/confirm-password/json", isAuthenticated, accountController.confirmPasswordJson);

// Subscription Cancellation Routes
router.get(
  "/cancel-subscription",
  checkFeatureAccess,
  isAuthenticated,
  (req, res) => accountController.cancelSubscriptionGet(req, res)
);
router.post("/cancel-subscription", isAuthenticated, (req, res) =>
  accountController.cancelSubscriptionPost(req, res, db)
);
router.post(
  "/resume-or-cancel-cancellation",
  isAuthenticated,
  accountController.resumeOrCancelCancellationPost
);

// Login and Logout Routes
router.get("/login", (req, res) => accountController.loginGet(req, res, db));
router.post(
  "/login",
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
  accountValidation.validateGuardianLogin,
  accountValidation.validateGuardianLoginResult,
  (req, res) => accountController.guardianLoginPost(req, res, db)
);
router.get("/logout", isAuthenticated, (req, res) =>
  accountController.logoutGet(req, res, db)
);

// Account Management Routes
router.get("/account", isAuthenticated, (req, res) =>
  accountController.accountGet(req, res, db)
);
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
  (req, res) => accountController.personalizationGet(req, res, db)
);
router.post("/personalization", isAuthenticated, (req, res) =>
  accountController.personalizationPost(req, res, db)
);
router.post("/personalization/logo", upload.single("logo"), (req, res) =>
  accountController.personalizationLogoPost(req, res, db)
);
router.post("/personalization/name", checkFeatureAccess, isAuthenticated, (req, res) =>
  accountController.updateOrgNamePost(req, res, db)
);
router.post("/personalization/font", checkFeatureAccess, isAuthenticated, (req, res) =>
  accountController.updateFontPost(req, res, db)
);
router.post("/personalization/theme", isAuthenticated, (req, res) =>
  themeController.updateThemePost(req, res)
);
router.post(
  "/personalization/nickname",
  isAuthenticated,
  accountValidation.validateNickname,
  accountValidation.validateNicknameResult,
  (req, res) => accountController.updateNicknamePost(req, res, db)
);

// Public Content Management Routes
router.get(
  "/managePublicContent",
  checkFeatureAccess,
  isAuthenticated,
  (req, res) => accountController.managePublicContentGet(req, res, db)
);
router.post(
  "/uploadSlideshowImages",
  isAuthenticated,
  upload.array("slideshowImages"),
  (req, res) => accountController.uploadSlideshowImages(req, res, db)
);
router.post(
  "/addTextSection",
  isAuthenticated,
  accountValidation.validateTextSection,
  accountValidation.validateTextSectionResult,
  (req, res) => accountController.addTextSection(req, res, db)
);
router.post("/updateImage", isAuthenticated, (req, res) =>
  accountController.updateImagePost(req, res, db)
);
router.get("/deleteImage/:imageId", isAuthenticated, (req, res) =>
  accountController.deleteImageGet(req, res, db)
);
router.post(
  "/updateText",
  isAuthenticated,
  accountValidation.validateTextSection,
  accountValidation.validateTextSectionResult,
  (req, res) => accountController.updateTextPost(req, res, db)
);
router.get("/deleteText/:textId", isAuthenticated, (req, res) =>
  accountController.deleteTextGet(req, res, db)
);
router.post("/update-about-us", isAuthenticated, (req, res) =>
  accountController.updateAboutUsSection(req, res, db)
);

// School Website Theme
router.post(
  "/updatePublicDashboardTheme",
  checkFeatureAccess,
  isAuthenticated,
  (req, res) => accountController.updatePublicDashboardThemePost(req, res, db)
);

// School Website Layout
router.post(
  "/updatePublicDashboardLayout",
  checkFeatureAccess,
  isAuthenticated,
  (req, res) => accountController.updatePublicDashboardLayoutPost(req, res, db)
);

// Password Reset Routes
router.get("/forget-password", (req, res) =>
  accountController.forgetPasswordGet(req, res, db)
);
router.post("/forget-password", (req, res) =>
  accountController.forgetPasswordPost(req, res, db)
);
router.get("/reset-password", (req, res) =>
  accountController.resetPasswordGet(req, res, db)
);
router.post("/reset-password", (req, res) =>
  accountController.resetPasswordPost(req, res, db)
);

// Settings overview (new)
router.get("/settings", isAuthenticated, (req, res) =>
  accountController.settingsGet(req, res, db)
);
router.post("/settings/profile", isAuthenticated, (req, res) =>
  accountController.updateProfileNamePost(req, res, db)
);
router.post("/settings/profile-image", 
  isAuthenticated, 
  upload.single("profileImage"),
  (req, res) => accountController.updateProfileImagePost(req, res, db)
);
router.post("/settings/security/email", isAuthenticated, (req, res) =>
  accountController.updateSecurityEmailPost(req, res, db)
);
router.post("/settings/security/password", isAuthenticated, (req, res) =>
  accountController.updateSecurityPasswordPost(req, res, db)
);

// Payment Method Management Routes
router.get("/update-card", checkFeatureAccess, isAuthenticated, (req, res) => {
  if (!req.session.passwordVerified) {
    return res.redirect(
      "/account/confirm-password?redirect=/account/update-card"
    );
  }
  accountController.updateCardGet(req, res, db);
});
router.post("/add-card", checkFeatureAccess, isAuthenticated, (req, res) =>
  accountController.addCardPost(req, res, db)
);
router.post("/api/tokenize-card", isAuthenticated, (req, res) =>
  accountController.tokenizeCard(req, res)
);
router.post("/cards/set-primary", isAuthenticated, (req, res) =>
  accountController.setPrimaryCardPost(req, res)
);
router.post("/api/tokenize-card/pin", isAuthenticated, (req, res) =>
  accountController.tokenizeCardSubmitPin(req, res)
);
router.post("/api/tokenize-card/otp", isAuthenticated, (req, res) =>
  accountController.tokenizeCardSubmitOtp(req, res)
);
router.post("/api/tokenize-card/phone", isAuthenticated, (req, res) =>
  accountController.tokenizeCardSubmitPhone(req, res)
);
router.post("/remove-card", isAuthenticated, (req, res) =>
  accountController.removeCardPost(req, res, db)
);

// Paystack Subaccount Routes
router.post("/add-paystack-subaccount", checkFeatureAccess, isAuthenticated, (req, res) =>
  accountController.addPaystackSubaccountPost(req, res)
);
router.get("/paystack/:id", isAuthenticated, (req, res) =>
  accountController.getPaystackSubaccountById(req, res)
);
router.put("/paystack", isAuthenticated, (req, res) =>
  accountController.updatePaystackSubaccount(req, res)
);
router.delete("/paystack/:id", isAuthenticated, (req, res) =>
  accountController.deletePaystackSubaccount(req, res)
);
router.post("/paystack/set-primary", isAuthenticated, (req, res) =>
  accountController.setPaystackSubaccountPrimary(req, res)
);

// Utility API: Paystack banks
router.get('/paystack-banks', isAuthenticated, (req, res) => accountController.listPaystackBanks(req, res));

// Subscription Plan Management Routes
router.get("/update-plan", checkFeatureAccess, isAuthenticated, (req, res) =>
  accountController.updatePlanGet(req, res, db)
);
router.post("/update-plan", isAuthenticated, (req, res) =>
  accountController.updatePlanPost(req, res, db)
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

router.post(
  "/updatePublicRegistration",
  accountController.updatePublicRegistration
);

router.get(
  "/flutterwave/:id",
  isAuthenticated,
  accountController.getFlutterwaveAccountById
);
router.put(
  "/flutterwave",
  isAuthenticated,
  accountController.updateFlutterwaveAccount
);
router.delete(
  "/flutterwave/:id",
  isAuthenticated,
  accountController.deleteFlutterwaveAccount
);
router.post(
  "/add-flutterwave-account",
  isAuthenticated,
  accountController.addFlutterwaveAccountPost
);

module.exports = router;
