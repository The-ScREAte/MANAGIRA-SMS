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

// PSP / Payment-Settings save (stripe, momo, bank, general)
router.post("/finance/psp/:provider", isAuthenticated, c.pspSavePost);

// ====== My PayGira (Teacher / Class teacher / Supervisor collector view) ======
router.get("/my-paygira", isAuthenticated, c.staffMyPaygiraGet);
router.post("/my-paygira/collect", isAuthenticated, c.staffMyPaygiraCollectPost);

// Invoices & receipts (staff side — assignee or admin)
router.get("/my-paygira/invoice/:assignmentId", isAuthenticated, c.invoiceGet);
router.get("/my-paygira/receipt/:paymentId", isAuthenticated, c.receiptGet);
router.get("/finance/invoice/:assignmentId", isAuthenticated, c.invoiceGet);
router.get("/finance/receipt/:paymentId", isAuthenticated, c.receiptGet);

module.exports = router;
