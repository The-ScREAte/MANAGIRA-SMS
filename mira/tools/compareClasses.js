const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "compare_classes",
  description:
    "Compare 2+ classes side-by-side: enrolled students, average assessment score, pass/fail counts (across all terms, not scoped to just one). " +
    "Returns a table (present as markdown) and a `chartUrl` grouped-bar-chart image - embed it in your reply with markdown image syntax, e.g. " +
    "`![Class comparison](chartUrl)`, so the user sees the actual chart. Needs Manage Records.",
  parameters: {
    type: "object",
    properties: {
      classNames: { type: "array", items: { type: "string" }, description: "At least 2 class names." },
    },
    required: ["classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "compare classes");
    if (!args?.classNames || args.classNames.length < 2) {
      return { status: "needs_info", message: "I need at least 2 class names to compare." };
    }
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      classNames: args.classNames.join(","),
    });
    try {
      return await callInternalApi(`/internal/api/stats/compare-classes?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409 || error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
