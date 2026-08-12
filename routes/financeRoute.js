// routes/financeRoute.js — PayGira Finance & Billing
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS, userHasPermission } = require("../middleware/permissionMiddleware");
const { hydrateOrganizationSession } = require("../utils/sessionContext");
const { getOrgSwitchFeatureRestriction } = require("../utils/orgSwitchAccess");
const c = require("../controllers/financeController");

const PAYGIRA_FEATURE_NAMES = new Set([
	"paygira",
	"pay gira",
	"paygira & payments",
	"paygira and payments",
]);

function hasPaygiraFeatureInSession(req, res) {
	const allowed = Array.isArray(req.session?.allowedFeatures)
		? req.session.allowedFeatures
		: (Array.isArray(res.locals?.allowedFeatures) ? res.locals.allowedFeatures : []);

	return allowed.some((featureName) =>
		PAYGIRA_FEATURE_NAMES.has(String(featureName || "").trim().toLowerCase())
	);
}

function isWorkspaceEmbeddedMyPaygiraRequest(req) {
	const isMyPaygiraPath = /^\/my-paygira(\/|$)/.test(String(req.path || ""));
	if (!isMyPaygiraPath) {
		return false;
	}

	const embedMode = String(req.query?.embed || req.body?.embedMode || "").trim().toLowerCase();
	if (embedMode !== "workspace") {
		return false;
	}

	const classIdRaw = req.query?.classId ?? req.body?.classId;
	const classId = Number.parseInt(classIdRaw, 10);
	return Number.isInteger(classId) && classId > 0;
}

async function hydrateFinanceSessionContext(req) {
	try {
		await hydrateOrganizationSession(req);
	} catch (_) {
		// Best-effort only; guards below still handle denial/fallback.
	}
}

function getPermissionContextFromRequest(req) {
	const sessionUser = req.session?.user || {};
	const requestUser = req.user || {};

	return {
		userId: sessionUser.user_id || req.session?.userId || req.session?.passport?.user || requestUser.user_id || null,
		userRole: req.session?.userRole || sessionUser.account_type || requestUser.account_type || null,
		organizationId: req.session?.organizationId || sessionUser.organization_id || requestUser.organization_id || null,
		accountType: req.session?.accountType || sessionUser.account_type || requestUser.account_type || null,
		userEmail: sessionUser.email || req.session?.email || requestUser.email || null,
	};
}

// Admin/finance pages require the Manage Billing permission (in addition to authentication).
// Owners/admins always pass; managers must have it explicitly granted.
const requireBilling = requirePermission(PERMISSIONS.MANAGE_BILLING);
const requireFinanceSettingsAccess = async (req, res, next) => {
	try {
		await hydrateFinanceSessionContext(req);

		const database0 = req.app.get("db");
		const orgSwitchRestriction = await getOrgSwitchFeatureRestriction(database0, req).catch(() => ({ isRestricted: false }));
		if (orgSwitchRestriction.isRestricted && !orgSwitchRestriction.flags.canViewBilling && !orgSwitchRestriction.flags.canViewPaygira) {
			req.flash("error", "You do not have permission to access PayGira settings.");
			return res.redirect("/account/settings?section=profile");
		}

		const localPermissionSet = new Set(
			(Array.isArray(res.locals?.userPermissions) ? res.locals.userPermissions : [])
				.map((permissionKey) => String(permissionKey || "").trim().toLowerCase())
		);
		const hasLocalBillingAccess = localPermissionSet.has(PERMISSIONS.MANAGE_BILLING);
		const hasLocalPaygiraAccess = localPermissionSet.has(PERMISSIONS.MANAGE_PAYGIRA);

		const database = req.app.get("db");
		const permissionContext = getPermissionContextFromRequest(req);

		const [canManageBilling, canManagePaygira] = await Promise.all([
			userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_BILLING),
			userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_PAYGIRA),
		]);

		if (canManageBilling || canManagePaygira || hasLocalBillingAccess || hasLocalPaygiraAccess) {
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
		await hydrateFinanceSessionContext(req);

		if (isWorkspaceEmbeddedMyPaygiraRequest(req)) {
			return next();
		}

		const database = req.app.get("db");
		const localPermissionSet = new Set(
			(Array.isArray(res.locals?.userPermissions) ? res.locals.userPermissions : [])
				.map((permissionKey) => String(permissionKey || "").trim().toLowerCase())
		);
		const hasLocalBillingAccess = localPermissionSet.has(PERMISSIONS.MANAGE_BILLING);
		const hasLocalPaygiraAccess = localPermissionSet.has(PERMISSIONS.MANAGE_PAYGIRA);
		const permissionContext = getPermissionContextFromRequest(req);

		const canManageBilling = await userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_BILLING);
		const canManagePaygira = await userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_PAYGIRA);

		if (canManageBilling || canManagePaygira || hasLocalBillingAccess || hasLocalPaygiraAccess) {
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

// PayGira routes can be unlocked by either:
// 1) Plan feature entitlement (PayGira), or
// 2) Explicit finance permission (MANAGE_PAYGIRA / MANAGE_BILLING).
// Platform admins (no org) also bypass this gate.
const requirePaygiraFeature = async (req, res, next) => {
	await hydrateFinanceSessionContext(req);

	if (isWorkspaceEmbeddedMyPaygiraRequest(req)) {
		return next();
	}

	const database1 = req.app.get("db");
	const orgSwitchRestriction = await getOrgSwitchFeatureRestriction(database1, req).catch(() => ({ isRestricted: false }));
	if (orgSwitchRestriction.isRestricted && !orgSwitchRestriction.flags.canViewBilling && !orgSwitchRestriction.flags.canViewPaygira) {
		req.flash("error", "PayGira is not included in your current plan.");
		return res.redirect("/account/settings?section=profile");
	}

	const accountType = String(
		req.session?.accountType || req.session?.user?.account_type || req.user?.account_type || ""
	).trim().toLowerCase();
	const role = String(
		req.session?.userRole || req.session?.user?.account_type || req.user?.account_type || ""
	).trim().toLowerCase();
	const adminSet = new Set(["admin", "mini admin", "internal worker"]);
	if (adminSet.has(accountType) || adminSet.has(role)) {
		return next();
	}

	if (hasPaygiraFeatureInSession(req, res)) {
		return next();
	}

	try {
		const database = req.app.get("db");
		const permissionContext = getPermissionContextFromRequest(req);

		const [canManageBilling, canManagePaygira] = await Promise.all([
			userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_BILLING),
			userHasPermission(database, permissionContext, PERMISSIONS.MANAGE_PAYGIRA),
		]);

		if (canManageBilling || canManagePaygira) {
			return next();
		}
	} catch (_error) {
		// Permission checks are best-effort here; denial handling below remains the fallback.
	}

	// Background/SPA fragment and JSON requests get a clean 403 instead of an
	// HTML redirect so the client can handle it gracefully.
	const isFragment = req.path.includes("/_") || /\.json$/.test(req.path) || req.xhr;
	if (isFragment) {
		return res.status(403).json({ error: "PayGira is not enabled on your plan." });
	}

	req.flash("error", "PayGira is not included in your current plan.");
	return res.redirect("/account/settings?section=profile");
};

router.use("/finance", requirePaygiraFeature);
router.use("/my-paygira", requirePaygiraFeature);


router.get("/finance/_version.json", isAuthenticated, c.financeVersionJsonGet);
router.get("/finance/_stats.json", isAuthenticated, requireFinanceSettingsAccess, c.financeStatsJsonGet);
router.get("/finance/_overview-section", isAuthenticated, requireFinanceSettingsAccess, c.financeOverviewFragmentGet);
router.get("/finance/_overview-detail-section", isAuthenticated, requireFinanceSettingsAccess, c.financeOverviewDetailFragmentGet);
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
router.post("/finance/payments/:id/delete", isAuthenticated, requireFinanceSettingsAccess, c.paymentDeletePost);
router.get("/finance/_assignments.json", isAuthenticated, requireFinanceSettingsAccess, c.assignmentsJsonGet);

// Sign-off corrections and read-only reports
router.post("/finance/signoffs/:id/unsign", isAuthenticated, requireFinanceSettingsAccess, c.signoffUnsignPost);
router.get("/finance/signoffs/:id/report", isAuthenticated, requireFinanceSettingsAccess, c.signoffReportGet);

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
