// routes/payoutRoute.js — Settings → Payouts
// Mounted at /account/settings (see server.js), matching financeRoute.js.
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const payoutController = require("../controllers/payoutController");

const canManagePayouts = [isAuthenticated, requirePermission(PERMISSIONS.PAYGIRA_PAYOUTS)];

router.get("/payouts.json", canManagePayouts, payoutController.payoutsListJsonGet);
router.get("/payouts/recipients/search", canManagePayouts, payoutController.payoutRecipientSearchGet);
router.post("/payouts", canManagePayouts, payoutController.payoutCreatePost);
router.post("/payouts/:id", canManagePayouts, payoutController.payoutUpdatePost);
router.post("/payouts/:id/delete", canManagePayouts, payoutController.payoutDeletePost);
router.post("/payouts/:id/pay-now", canManagePayouts, payoutController.payoutPayNowPost);
router.get("/payouts/:id/transactions", canManagePayouts, payoutController.payoutTransactionsGet);

module.exports = router;
