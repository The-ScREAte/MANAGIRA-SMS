// routes/financeRoute.js — PayGira Finance & Billing
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const c = require("../controllers/financeController");

router.get("/finance", isAuthenticated, c.financePageGet);

// Templates
router.post("/finance/templates", isAuthenticated, c.templateCreatePost);
router.post("/finance/templates/:id/delete", isAuthenticated, c.templateDeletePost);

// Bills
router.post("/finance/bills", isAuthenticated, c.billCreatePost);
router.post("/finance/bills/:id/edit", isAuthenticated, c.billEditPost);
router.post("/finance/bills/:id/cancel", isAuthenticated, c.billCancelPost);
router.post("/finance/bills/:id/delete", isAuthenticated, c.billDeletePost);
router.post("/finance/bills/:id/reminder", isAuthenticated, c.sendReminderPost);

// Payments
router.post("/finance/payments", isAuthenticated, c.paymentRecordPost);
router.get("/finance/_assignments.json", isAuthenticated, c.assignmentsJsonGet);

// Overdue sweep
router.post("/finance/sweep-overdue", isAuthenticated, c.overdueSweepPost);

// Student detail JSON
router.get("/finance/students/:id/detail.json", isAuthenticated, c.studentDetailGet);

// CSV export
router.get("/finance/export/csv", isAuthenticated, c.exportCsvGet);

module.exports = router;
