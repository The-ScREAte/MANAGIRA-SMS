// routes/financeRoute.js — PayGira Finance & Billing
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS, userHasPermission } = require("../middleware/permissionMiddleware");
const c = require("../controllers/financeController");

// Admin/finance pages require the Manage Billing permission (in addition to authentication).
// Owners/admins always pass; managers must have it explicitly granted.
const requireBilling = requirePermission(PERMISSIONS.MANAGE_BILLING);
const requireFinanceSettingsAccess = async (req, res, next) => {
	try {
		const userRole = req.session.userRole || req.session.user?.account_type || null;
		const accountType = req.session.accountType || req.session.user?.account_type || null;
		const normalizedRole = String(userRole || accountType || "").trim().toLowerCase();

		if (normalizedRole === "teacher") {
			req.flash("error", "Teachers do not have access to these PayGira settings.");
			return res.redirect("/account/settings?section=profile");
		}

		const database = req.app.get("db");
		const permissionContext = {
			userId: req.session.user?.user_id || req.session.userId || null,
			userRole,
			organizationId: req.session.organizationId,
			accountType,
			userEmail: req.session.user?.email || req.session.email || null,
		};

		const canManageBilling = await userHasPermission(
			database,
			permissionContext,
			PERMISSIONS.MANAGE_BILLING
		);
		const canManagePaygira = await userHasPermission(
			database,
			permissionContext,
			PERMISSIONS.MANAGE_PAYGIRA
		);

		if (canManageBilling || canManagePaygira) {
			return next();
		}

		req.flash("error", "You do not have permission to access PayGira settings.");
		return res.redirect("/account/settings?section=profile");
	} catch (error) {
		req.flash("error", "Unable to verify PayGira access.");
		return res.redirect("/account/settings?section=profile");
	}
};

// My PayGira routes are accessible to any role (including teachers) that has been
// explicitly granted the MANAGE_PAYGIRA (or MANAGE_BILLING) permission.
const requireMyPaygiraAccess = async (req, res, next) => {
	try {
		const database = req.app.get("db");
		const userRole = req.session.userRole || req.session.user?.account_type || null;
		const accountType = req.session.accountType || req.session.user?.account_type || null;
		const permissionContext = {
			userId: req.session.user?.user_id || req.session.userId || null,
			userRole,
			organizationId: req.session.organizationId,
			accountType,
			userEmail: req.session.user?.email || req.session.email || null,
		};

		const canManageBilling = await userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_BILLING);
		const canManagePaygira = await userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_PAYGIRA);

		if (canManageBilling || canManagePaygira) {
			return next();
		}

		req.flash("error", "You do not have permission to access My PayGira.");
		return res.redirect("/account/settings?section=profile");
	} catch (error) {
		req.flash("error", "Unable to verify PayGira access.");
		return res.redirect("/account/settings?section=profile");
	}
};

// Auto-invalidate PayGira cache after any state-changing finance request
router.use((req, res, next) => {
	if (req.method !== "GET" && req.method !== "HEAD" && /^\/(finance|my-paygira)(\/|$)/.test(req.path)) {
		res.on("finish", () => {
			try {
				const orgId = req.session?.organizationId;
				if (orgId && res.statusCode < 500) c.invalidateFinanceCache(orgId);
			} catch (_) {}
		});
	}
	next();
});

router.get("/finance/_stats.json", isAuthenticated, requireFinanceSettingsAccess, c.financeStatsJsonGet);
router.get("/finance", isAuthenticated, requireFinanceSettingsAccess, c.financePageGet);
router.get("/finance/arrears", isAuthenticated, requireFinanceSettingsAccess, c.financeArrearsPageGet);
router.post("/finance/arrears/presets", isAuthenticated, requireFinanceSettingsAccess, c.arrearsPresetCreatePost);
router.post("/finance/arrears/notes", isAuthenticated, requireFinanceSettingsAccess, c.arrearsNoteCreatePost);
router.post("/finance/arrears/guardians", isAuthenticated, requireFinanceSettingsAccess, c.arrearsGuardianSavePost);
router.post("/finance/arrears/reports", isAuthenticated, requireFinanceSettingsAccess, c.arrearsReportCreatePost);
router.get("/finance/arrears/reports/:id/view", isAuthenticated, requireFinanceSettingsAccess, c.arrearsReportViewGet);
router.get("/finance/arrears/reports/:id/download", isAuthenticated, requireFinanceSettingsAccess, c.arrearsReportDownloadGet);
router.post("/finance/arrears/reports/:id/delete", isAuthenticated, requireFinanceSettingsAccess, c.arrearsReportDeletePost);
router.post("/finance/arrears/email", isAuthenticated, requireFinanceSettingsAccess, c.arrearsEmailSendPost);

// Templates
router.post("/finance/templates", isAuthenticated, requireFinanceSettingsAccess, c.templateCreatePost);
router.post("/finance/templates/:id/delete", isAuthenticated, requireFinanceSettingsAccess, c.templateDeletePost);

// Bills
router.post("/finance/bills", isAuthenticated, requireFinanceSettingsAccess, c.billCreatePost);
router.post("/finance/bills/:id/edit", isAuthenticated, requireFinanceSettingsAccess, c.billEditPost);
router.post("/finance/bills/:id/cancel", isAuthenticated, requireFinanceSettingsAccess, c.billCancelPost);
router.post("/finance/bills/:id/delete", isAuthenticated, requireFinanceSettingsAccess, c.billDeletePost);
router.post("/finance/bills/:id/reminder", isAuthenticated, requireFinanceSettingsAccess, c.sendReminderPost);

// Payments
router.post("/finance/payments", isAuthenticated, requireFinanceSettingsAccess, c.paymentRecordPost);
router.get("/finance/_assignments.json", isAuthenticated, requireFinanceSettingsAccess, c.assignmentsJsonGet);

// Overdue sweep
router.post("/finance/sweep-overdue", isAuthenticated, requireFinanceSettingsAccess, c.overdueSweepPost);

// Student detail JSON
router.get("/finance/students/:id/detail.json", isAuthenticated, requireFinanceSettingsAccess, c.studentDetailGet);

// CSV export
router.get("/finance/export/csv", isAuthenticated, requireFinanceSettingsAccess, c.exportCsvGet);

// PSP / Payment-Settings save (stripe, momo, bank, general)
router.post("/finance/psp/:provider", isAuthenticated, requireFinanceSettingsAccess, c.pspSavePost);

// ====== My PayGira (Teacher / Class teacher / Supervisor collector view) ======
// Access requires the MANAGE_PAYGIRA (or MANAGE_BILLING) permission regardless of role.
router.get("/my-paygira", isAuthenticated, requireMyPaygiraAccess, c.staffMyPaygiraGet);
router.post("/my-paygira/collect", isAuthenticated, requireMyPaygiraAccess, c.staffMyPaygiraCollectPost);
router.post("/my-paygira/collect/bulk", isAuthenticated, requireMyPaygiraAccess, c.staffMyPaygiraBulkCollectPost);
router.post("/my-paygira/signoff", isAuthenticated, requireMyPaygiraAccess, c.staffMyPaygiraSignOffPost);
router.get("/my-paygira/occurrence-summary", isAuthenticated, requireMyPaygiraAccess, c.occurrenceSummaryGet);

// Invoices & receipts (staff side — assignee or admin)
router.get("/my-paygira/invoice/:assignmentId", isAuthenticated, c.invoiceGet);
router.get("/my-paygira/receipt/:paymentId", isAuthenticated, c.receiptGet);
router.get("/finance/invoice/:assignmentId", isAuthenticated, c.invoiceGet);
router.get("/finance/receipt/:paymentId", isAuthenticated, c.receiptGet);

module.exports = router;
