// routes/payoutRoute.js — Settings → Payouts
// Mounted at /account/settings (see server.js), matching financeRoute.js.
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const payoutController = require("../controllers/payoutController");

router.use("/payouts", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_BILLING));

router.get("/payouts.json", payoutController.payoutsListJsonGet);
router.get("/payouts/recipients/search", payoutController.payoutRecipientSearchGet);
router.post("/payouts", payoutController.payoutCreatePost);
router.post("/payouts/:id", payoutController.payoutUpdatePost);
router.post("/payouts/:id/delete", payoutController.payoutDeletePost);
router.post("/payouts/:id/pay-now", payoutController.payoutPayNowPost);
router.get("/payouts/:id/transactions", payoutController.payoutTransactionsGet);

module.exports = router;
