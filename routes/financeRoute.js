// routes/financeRoute.js — PayGira Finance & Billing
const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/authMiddleware");
const { requirePermission, PERMISSIONS, userHasPermission } = require("../middleware/permissionMiddleware");
const { hydrateOrganizationSession } = require("../utils/sessionContext");
const { isBillCollector } = require("../utils/paygiraCollectors");
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
		const database = req.app.get("db");
		const permissionContext = getPermissionContextFromRequest(req);

		if (localPermissionSet.has(PERMISSIONS.PAYGIRA_WORKSPACE)
			|| await userHasPermission(database, permissionContext, PERMISSIONS.PAYGIRA_WORKSPACE)) {
			return next();
		}

		req.flash("error", "You do not have permission to access PayGira settings.");
		return res.redirect("/account/settings?section=profile");
	} catch (error) {
		req.flash("error", "Unable to verify PayGira access.");
		return res.redirect("/account/settings?section=profile");
	}
};

// A page or action in Main PayGira: Main PayGira plus any one of these follow-ups.
const paygiraPage = (...keys) => [requireFinanceSettingsAccess, requirePermission(keys)];

// My PayGira (the class dashboard's collector view) needs Classroom PayGira, or
// being given a bill to collect.
const requireMyPaygiraAccess = async (req, res, next) => {
	try {
		await hydrateFinanceSessionContext(req);

		const database2 = req.app.get("db");
		const orgSwitchRestriction = await getOrgSwitchFeatureRestriction(database2, req).catch(() => ({ isRestricted: false }));
		if (orgSwitchRestriction.isRestricted && !orgSwitchRestriction.flags.canViewBilling && !orgSwitchRestriction.flags.canViewPaygira) {
			req.flash("error", "You do not have permission to access My PayGira.");
			return res.redirect("/account/settings?section=profile");
		}

		const database = req.app.get("db");
		const permissionContext = getPermissionContextFromRequest(req);

		if (await userHasPermission(database, permissionContext, PERMISSIONS.PAYGIRA_CLASSROOM)
			|| await isBillCollector(database, permissionContext.organizationId, permissionContext.userId)) {
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

// PayGira needs the feature in the school's plan, whatever permissions someone
// holds. Platform admins (no org) bypass this gate.
const requirePaygiraFeature = async (req, res, next) => {
	await hydrateFinanceSessionContext(req);

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
router.get("/finance/_stats.json", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_OVERVIEW), c.financeStatsJsonGet);
router.get("/finance/_overview-section", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_OVERVIEW), c.financeOverviewFragmentGet);
router.get("/finance/_overview-detail-section", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_OVERVIEW), c.financeOverviewDetailFragmentGet);
router.get("/finance", isAuthenticated, requireFinanceSettingsAccess, c.financePageGet);
router.get("/finance/arrears", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.financeArrearsPageGet);
router.post("/finance/arrears/presets", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsPresetCreatePost);
router.post("/finance/arrears/notes", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsNoteCreatePost);
router.post("/finance/arrears/reports", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsReportCreatePost);
router.get("/finance/arrears/reports/:id/view", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsReportViewGet);
router.get("/finance/arrears/reports/:id/download", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsReportDownloadGet);
router.post("/finance/arrears/reports/:id/delete", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsReportDeletePost);
router.post("/finance/arrears/email", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECOVERY), c.arrearsEmailSendPost);

// Templates
router.post("/finance/templates", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS), c.templateCreatePost);
router.post("/finance/templates/:id/delete", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS), c.templateDeletePost);

// Bills
router.post("/finance/bills", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS), c.billCreatePost);
router.post("/finance/bills/:id/edit", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS), c.billEditPost);
router.post("/finance/bills/:id/cancel", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_DELETE_BILLS), c.billCancelPost);
router.post("/finance/bills/:id/delete", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_DELETE_BILLS), c.billDeletePost);
router.post("/finance/bills/:id/reminder", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS), c.sendReminderPost);
// One student's bill, from their ledger or the overdue list.
router.post("/finance/assignments/:id/request", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS, PERMISSIONS.PAYGIRA_ORG_BILLS, PERMISSIONS.PAYGIRA_RECOVERY), c.assignmentRequestPost);

// Payments
router.post("/finance/payments", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_RECORD_PAYMENTS), c.paymentRecordPost);
router.post("/finance/payments/:id/delete", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_DELETE_PAYMENTS), c.paymentDeletePost);
router.get("/finance/_assignments.json", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS, PERMISSIONS.PAYGIRA_ORG_BILLS, PERMISSIONS.PAYGIRA_PAYMENTS, PERMISSIONS.PAYGIRA_RECORD_PAYMENTS, PERMISSIONS.PAYGIRA_RECOVERY), c.assignmentsJsonGet);

// Sign-off corrections and read-only reports
router.post("/finance/signoffs/:id/unsign", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_DELETE_PAYMENTS), c.signoffUnsignPost);
router.get("/finance/signoffs/:id/report", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_PAYMENTS, PERMISSIONS.PAYGIRA_DELETE_PAYMENTS), c.signoffReportGet);


// Student detail JSON
router.get("/finance/students/:id/detail.json", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_BILLS, PERMISSIONS.PAYGIRA_ORG_BILLS, PERMISSIONS.PAYGIRA_PAYMENTS, PERMISSIONS.PAYGIRA_RECORD_PAYMENTS, PERMISSIONS.PAYGIRA_RECOVERY), c.studentDetailGet);


// PSP / Payment-Settings save (stripe, momo, bank, general)
router.post("/finance/psp/:provider", isAuthenticated, paygiraPage(PERMISSIONS.PAYGIRA_SETTINGS), c.pspSavePost);

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

module.exports = router;
