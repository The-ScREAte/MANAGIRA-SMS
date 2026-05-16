// routes/financeRoute.js — PayGira Finance & Billing
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const c = require("../controllers/financeController");

// Admin/finance pages require the Manage Billing permission (in addition to authentication).
// Owners/admins always pass; managers must have it explicitly granted.
const requireBilling = requirePermission(PERMISSIONS.MANAGE_BILLING);

router.get("/finance", isAuthenticated, requireBilling, c.financePageGet);
router.get("/finance/arrears", isAuthenticated, requireBilling, c.financeArrearsPageGet);
router.post("/finance/arrears/presets", isAuthenticated, requireBilling, c.arrearsPresetCreatePost);
router.post("/finance/arrears/notes", isAuthenticated, requireBilling, c.arrearsNoteCreatePost);
router.post("/finance/arrears/guardians", isAuthenticated, requireBilling, c.arrearsGuardianSavePost);
router.post("/finance/arrears/reports", isAuthenticated, requireBilling, c.arrearsReportCreatePost);
router.get("/finance/arrears/reports/:id/view", isAuthenticated, requireBilling, c.arrearsReportViewGet);
router.get("/finance/arrears/reports/:id/download", isAuthenticated, requireBilling, c.arrearsReportDownloadGet);
router.post("/finance/arrears/reports/:id/delete", isAuthenticated, requireBilling, c.arrearsReportDeletePost);
router.post("/finance/arrears/email", isAuthenticated, requireBilling, c.arrearsEmailSendPost);

// Templates
router.post("/finance/templates", isAuthenticated, requireBilling, c.templateCreatePost);
router.post("/finance/templates/:id/delete", isAuthenticated, requireBilling, c.templateDeletePost);

// Bills
router.post("/finance/bills", isAuthenticated, requireBilling, c.billCreatePost);
router.post("/finance/bills/:id/edit", isAuthenticated, requireBilling, c.billEditPost);
router.post("/finance/bills/:id/cancel", isAuthenticated, requireBilling, c.billCancelPost);
router.post("/finance/bills/:id/delete", isAuthenticated, requireBilling, c.billDeletePost);
router.post("/finance/bills/:id/reminder", isAuthenticated, requireBilling, c.sendReminderPost);

// Payments
router.post("/finance/payments", isAuthenticated, requireBilling, c.paymentRecordPost);
router.get("/finance/_assignments.json", isAuthenticated, requireBilling, c.assignmentsJsonGet);

// Overdue sweep
router.post("/finance/sweep-overdue", isAuthenticated, requireBilling, c.overdueSweepPost);

// Student detail JSON
router.get("/finance/students/:id/detail.json", isAuthenticated, requireBilling, c.studentDetailGet);

// CSV export
router.get("/finance/export/csv", isAuthenticated, requireBilling, c.exportCsvGet);

// PSP / Payment-Settings save (stripe, momo, bank, general)
router.post("/finance/psp/:provider", isAuthenticated, requireBilling, c.pspSavePost);

// ====== My PayGira (Teacher / Class teacher / Supervisor collector view) ======
// These are per-assignee staff pages; the controller already restricts access to the
// assigned collector or an admin, so we keep them on isAuthenticated.
router.get("/my-paygira", isAuthenticated, c.staffMyPaygiraGet);
router.post("/my-paygira/collect", isAuthenticated, c.staffMyPaygiraCollectPost);

// Invoices & receipts (staff side — assignee or admin)
router.get("/my-paygira/invoice/:assignmentId", isAuthenticated, c.invoiceGet);
router.get("/my-paygira/receipt/:paymentId", isAuthenticated, c.receiptGet);
router.get("/finance/invoice/:assignmentId", isAuthenticated, c.invoiceGet);
router.get("/finance/receipt/:paymentId", isAuthenticated, c.receiptGet);

module.exports = router;
