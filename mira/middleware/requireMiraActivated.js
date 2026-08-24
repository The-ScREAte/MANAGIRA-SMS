// Blocks access to Mira for any org that hasn't activated it under
// Settings -> Integrations on the main app, mirroring the same
// activation-gate pattern every other integration (Transportation,
// Student Portal, WhatsApp, SMS) already uses there. For staff, also
// requires the individually-granted "Use Mira" permission set on
// /account/mira - guardians and students are exempt from that specific
// check (there's no per-guardian/per-student grant UI for it, and their
// own tool access is already scoped to their own child/own record
// elsewhere). Must run after tenantScope (needs req.tenant).
const { callInternalApi } = require("../internalApiClient");

async function requireMiraActivated(req, res, next) {
  const tenant = req.tenant;
  if (!tenant || !tenant.organizationId) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    if (tenant.viewerType === "staff") {
      params.set("userId", String(tenant.userId || ""));
      params.set("userRole", tenant.userRole || "");
      params.set("accountType", tenant.accountType || "");
      params.set("userEmail", tenant.userEmail || "");
    }

    const { activated, canUse } = await callInternalApi(`/internal/api/mira/activation-status?${params.toString()}`);
    const allowed = activated && (tenant.viewerType !== "staff" || canUse);

    if (!allowed) {
      const message = !activated
        ? "Mira isn't available for your school yet."
        : "You don't have access to Mira yet.";

      if (req.accepts(["html", "json"]) === "json") {
        return res.status(403).json({ error: message });
      }
      return res.status(403).render("notActivated", {
        title: "Mira",
        layout: false,
        message,
        mainAppUrl: process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4000",
      });
    }

    next();
  } catch (error) {
    console.error("[mira/requireMiraActivated]", error);
    return res.status(502).json({ error: "Unable to verify Mira activation right now." });
  }
}

module.exports = { requireMiraActivated };
