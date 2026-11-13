// School-side screens for API access: Service Accounts (Management) and Access
// Tokens (Settings). Everything is scoped to the signed-in school and needs
// the "Manage Settings" permission.
const express = require("express");
const router = express.Router();
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { checkRateLimit } = require("../utils/rateLimiter");
const api = require("../utils/apiAccess");
const allowance = require("../utils/apiAllowance");
const { confirmOwnPassword } = require("../utils/confirmOwnPassword");

const guard = [isAuthenticated, blockGuardians, requirePermission(PERMISSIONS.SETTINGS_SERVICE_ACCOUNTS)];

// The API's endpoints, for the "How to connect" guide (routes/publicApiRoute.js).
const API_ENDPOINTS = [
  { path: "/me", returns: "The school, the service account and the token's scopes", needs: "Any token" },
  { path: "/classes · /subjects?class_id= · /school-years · /terms?school_year_id=", returns: "Classes, subjects, school years and terms", needs: "Classes & subjects" },
  { path: "/students?class_id= · /students/{id}", returns: "Students", needs: "Students" },
  { path: "/guardians", returns: "Parents and guardians with their children's IDs", needs: "Parents & guardians" },
  { path: "/attendance?date=YYYY-MM-DD&class_id=", returns: "Attendance marks for one day", needs: "Attendance" },
  { path: "/grades?term_id=&class_id=&student_id=", returns: "Assessment scores, percentages, grades, positions", needs: "Grades" },
  { path: "/employees", returns: "Staff names, roles and emails", needs: "Staff" },
  { path: "/events?from=YYYY-MM-DD · /announcements", returns: "School events and announcements", needs: "Events & announcements" },
  { path: "/paygira/bills · /paygira/balances?student_id=&bill_id= · /paygira/payments?from=&to=", returns: "Bills, balances owed, payments", needs: "PayGira" },
  { path: "/transportation/routes · /transportation/stops?route_id= · /transportation/buses · /transportation/assignments?student_id=", returns: "Routes with their stops, all stops, buses, each student's stop", needs: "Transportation" },
  { path: "/deleted?updated_since=", returns: "Students, guardians and attendance marks deleted since then", needs: "Students, Parents & guardians or Attendance" },
  { path: "/assessments?term_id=&class_id=&subject_id=", returns: "Assessments, to send scores to", needs: "Grades" },
  { path: "POST /students · PATCH /students/{id}", returns: "Add a student to a class, or change their details", needs: "Students: add and update" },
  { path: "POST /guardians · PATCH /guardians/{id}", returns: "Add a parent linked to their children, or change their details", needs: "Parents & guardians: add and update" },
  { path: "POST /attendance", returns: "Mark a class present or absent for a day", needs: "Attendance: mark" },
  { path: "POST /grades", returns: "Enter scores for an assessment", needs: "Grades: enter scores" },
  { path: "POST /paygira/payments", returns: "Record a payment taken outside Managira (one per reference)", needs: "PayGira: record payments" },
];

const schoolNameOf = async (organizationId) => {
  const { rows } = await require("../config/db").query("SELECT organization_name FROM organizations WHERE organization_id = $1", [organizationId]);
  return (rows[0] && rows[0].organization_name) || "the School";
};
const orgOf = (req) => Number(req.session.organizationId);

// JSON answers for the drawers; a thrown error with .status becomes its message.
const handle = (fn) => async (req, res) => {
  try {
    if (req.method === "POST" && !checkRateLimit(`api-access:${req.sessionID}`, { max: 60, windowMs: 10 * 60 * 1000 }).allowed) {
      return res.status(429).json({ success: false, message: "Too many changes. Try again in a few minutes." });
    }
    const result = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, ...(result || {}) });
  } catch (error) {
    if (!error.status) console.error("[api-access]", error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Something went wrong. Try again." });
  }
};

const serviceAccountView = (account) => ({
  id: account.service_account_id,
  name: account.name,
  description: account.description || "",
  allPermissions: account.all_permissions,
  permissions: api.permissionsOf(account),
  agreementVersion: account.agreement_version || null,
  agreementAcceptedAt: account.agreement_accepted_at || null,
  agreementAcceptedName: account.agreement_accepted_name || null,
  status: account.status,
  activeTokens: account.active_tokens || 0,
  createdAt: account.created_at,
});

// ---------- Service accounts (Management -> Integrations) ----------
router.get("/service-accounts", ...guard, async (req, res) => {
  try {
    const [accounts, features, schoolName, usage] = await Promise.all([
      api.listServiceAccounts(orgOf(req)), api.schoolFeatures(orgOf(req)), schoolNameOf(orgOf(req)), allowance.usageSummary(orgOf(req)),
    ]);
    res.render("common/serviceAccounts", {
      title: "Service Accounts",
      accounts: accounts.map(serviceAccountView),
      permissionOptions: api.API_AREAS.map((area) => ({ ...area, featureOff: Boolean(area.feature && !features[area.feature]) })),
      agreementVersion: api.AGREEMENT_VERSION,
      schoolName,
      usage,
    });
  } catch (error) {
    console.error("[service-accounts]", error);
    res.status(500).send("Could not load service accounts.");
  }
});
router.post("/service-accounts", ...guard, handle(async (req) => ({
  account: serviceAccountView(await api.createServiceAccount(req, orgOf(req), req.body || {})),
})));
router.post("/service-accounts/:id", ...guard, handle(async (req) => ({
  account: serviceAccountView(await api.updateServiceAccount(req, orgOf(req), Number(req.params.id), req.body || {})),
})));
// Pausing, resuming and revoking a service account each need the person's password.
router.post("/service-accounts/:id/hold", ...guard, handle(async (req) => {
  await confirmOwnPassword(req, (req.body || {}).password, { purpose: "pause a service account" });
  await api.holdServiceAccount(req, orgOf(req), Number(req.params.id));
}));
router.post("/service-accounts/:id/resume", ...guard, handle(async (req) => {
  await confirmOwnPassword(req, (req.body || {}).password, { purpose: "resume a service account" });
  await api.resumeServiceAccount(req, orgOf(req), Number(req.params.id));
}));
router.post("/service-accounts/:id/revoke", ...guard, handle(async (req) => {
  await confirmOwnPassword(req, (req.body || {}).password, { purpose: "revoke a service account" });
  await api.revokeServiceAccount(req, orgOf(req), Number(req.params.id));
}));

// The agreement on its own page, to read in full or print.
router.get("/agreement", ...guard, async (req, res) => {
  res.render("account/apiAgreement", {
    title: "API Data-Sharing Agreement",
    agreementVersion: api.AGREEMENT_VERSION,
    schoolName: await schoolNameOf(orgOf(req)).catch(() => "the School"),
  });
});

// ---------- Access tokens (Settings) ----------
router.get("/tokens", ...guard, async (req, res) => {
  try {
    const organizationId = orgOf(req);
    const [tokens, secrets, accounts, clientId, features, usage, requests] = await Promise.all([
      api.listTokens(organizationId),
      api.listSecrets(organizationId),
      api.listServiceAccounts(organizationId),
      api.getClientId(organizationId),
      api.schoolFeatures(organizationId),
      allowance.usageSummary(organizationId),
      allowance.listRequests(organizationId),
    ]);
    // What each token can read right now: its scopes, cut down by what its
    // service account still allows (blocked ones are listed separately).
    const accessOf = (t) => {
      const groups = api.groupAvailability(api.permissionsOf(t), features).filter((g) => (t.scope_groups || []).includes(g.key));
      return { canRead: groups.filter((g) => g.available).map((g) => g.label), blocked: groups.filter((g) => !g.available).map((g) => g.label) };
    };
    res.render("account/accessTokens", {
      title: "Access Tokens",
      tab: ["secrets", "usage"].includes(req.query.tab) ? req.query.tab : "pat",
      usage,
      requests,
      defaultAllowance: allowance.DEFAULT_ALLOWANCE,
      contactEmail: (req.session.user && req.session.user.email) || "",
      tokens: tokens.map((t) => ({ ...t, ...accessOf(t) })),
      apiBaseUrl: `${String(res.locals.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "")}/api/v1`,
      endpoints: API_ENDPOINTS,
      secrets,
      clientId,
      serviceAccounts: accounts.filter((a) => a.status === "active" && a.agreement_accepted_at).map(serviceAccountView),
      scopeGroups: api.SCOPE_GROUPS,
      tokenExpiryDays: api.TOKEN_EXPIRY_DAYS,
      secretExpiryDays: api.SECRET_EXPIRY_DAYS,
    });
  } catch (error) {
    console.error("[access-tokens]", error);
    res.status(500).send("Could not load access tokens.");
  }
});
// Which scope groups a service account may grant (drawer re-checks on change).
router.get("/tokens/scopes", ...guard, handle(async (req) => {
  const accounts = await api.listServiceAccounts(orgOf(req));
  const account = accounts.find((a) => a.service_account_id === Number(req.query.serviceAccountId) && a.status === "active");
  if (!account) throw Object.assign(new Error("Service account not found."), { status: 404 });
  return { groups: api.groupAvailability(api.permissionsOf(account), await api.schoolFeatures(orgOf(req))) };
}));
router.post("/tokens", ...guard, handle(async (req) => api.createToken(req, orgOf(req), req.body || {})));
router.post("/tokens/:id/revoke", ...guard, handle(async (req) => {
  await api.revokeToken(req, orgOf(req), Number(req.params.id));
}));

// For the dashboard banner: only what the banner shows.
router.get("/usage-banner.json", ...guard, handle(async (req) => {
  const u = await allowance.usageSummary(orgOf(req));
  return {
    nearLimit: u.nearLimit,
    limitHit: u.limitHitToday,
    minuteLimitHit: u.minuteLimitHit,
    perMinute: u.allowance.perMinute,
    usedToday: u.usedToday,
    perDay: u.allowance.perDay,
    percent: Math.min(100, Math.round(u.share * 100)),
    resetsInHours: Math.max(1, Math.round(u.resetsInSeconds / 3600)),
  };
}));

// Asking Managira for a bigger allowance (answered on Admin -> API requests).
router.post("/allowance/requests", ...guard, handle(async (req) => ({
  request: await allowance.createRequest(req, orgOf(req), req.body || {}),
})));
router.post("/allowance/requests/:id/cancel", ...guard, handle(async (req) => {
  await allowance.cancelRequest(req, orgOf(req), Number(req.params.id));
}));

router.post("/secrets", ...guard, handle(async (req) => api.createSecret(req, orgOf(req), req.body || {})));
router.post("/secrets/:id/revoke", ...guard, handle(async (req) => {
  await api.revokeSecret(req, orgOf(req), Number(req.params.id));
}));
router.post("/secrets/:id/regenerate", ...guard, handle(async (req) => api.regenerateSecret(req, orgOf(req), Number(req.params.id))));

module.exports = router;
