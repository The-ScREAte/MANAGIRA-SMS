// routes/financeRoute.js
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const c = require("../controllers/financeController");

router.get("/finance", isAuthenticated, c.financePageGet);

router.post("/finance/templates", isAuthenticated, c.templateCreatePost);
router.post("/finance/templates/:id/delete", isAuthenticated, c.templateDeletePost);

router.post("/finance/bills", isAuthenticated, c.billCreatePost);
router.post("/finance/bills/:id/cancel", isAuthenticated, c.billCancelPost);
router.post("/finance/bills/:id/delete", isAuthenticated, c.billDeletePost);

router.post("/finance/payments", isAuthenticated, c.paymentRecordPost);

module.exports = router;
