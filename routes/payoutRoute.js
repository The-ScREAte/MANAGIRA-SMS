// routes/payoutRoute.js — Settings → Payouts
// Mounted at /account/settings (see server.js), matching financeRoute.js.
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const payoutController = require("../controllers/payoutController");

// A Managira worker who opened the school without PayGira or Billing access is kept out, as on
// every other PayGira page (routes/financeRoute.js).
const { getOrgSwitchFeatureRestriction } = require("../utils/orgSwitchAccess");
const notRestrictedWorker = async (req, res, next) => {
  try {
    const restriction = await getOrgSwitchFeatureRestriction(req.app.get("db") || require("../config/db"), req).catch(() => ({ isRestricted: false }));
    if (restriction.isRestricted && !(restriction.flags && (restriction.flags.canViewPaygira || restriction.flags.canViewBilling))) {
      return res.status(403).json({ success: false, message: "You do not have permission to manage this school's payouts." });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
const canManagePayouts = [isAuthenticated, requirePermission(PERMISSIONS.PAYGIRA_PAYOUTS), notRestrictedWorker];

router.get("/payouts.json", canManagePayouts, payoutController.payoutsListJsonGet);
router.get("/payouts/recipients/search", canManagePayouts, payoutController.payoutRecipientSearchGet);
router.post("/payouts", canManagePayouts, payoutController.payoutCreatePost);
router.post("/payouts/:id", canManagePayouts, payoutController.payoutUpdatePost);
router.post("/payouts/:id/delete", canManagePayouts, payoutController.payoutDeletePost);
router.post("/payouts/:id/pay-now", canManagePayouts, payoutController.payoutPayNowPost);
router.get("/payouts/:id/transactions", canManagePayouts, payoutController.payoutTransactionsGet);

module.exports = router;
