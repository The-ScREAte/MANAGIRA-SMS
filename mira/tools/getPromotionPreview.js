const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_promotion_preview",
  description:
    "Preview the already-computed promotion decisions (from report generation) for one or more classes in a term - who's Promoted/Repeated, their destination class, and whether promotion is even activated for that class (if not, it will be silently skipped when applied). Use this before schedule_promotion so you can describe exactly what will happen. Needs Approve Promotions.",
  parameters: {
    type: "object",
    properties: {
      classNames: { type: "array", items: { type: "string" }, description: "Exact class names to preview." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: ["classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "preview promotions");

    const classNames = Array.isArray(args?.classNames) ? args.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    if (!classNames.length) {
      return { status: "needs_info", message: "I need at least one exact class name to preview." };
    }

    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
      classNames: classNames.join(","),
    });
    if (args?.termName) params.set("termName", String(args.termName).trim());
    if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());

    try {
      return await callInternalApi(`/internal/api/promotion/preview?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) {
        error.denied = true;
        throw error;
      }
      return { status: error.status === 404 ? "not_found" : "needs_info", message: error.message };
    }
  },
};
