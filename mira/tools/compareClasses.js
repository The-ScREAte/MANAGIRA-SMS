const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "compare_classes",
  description:
    "Compare 2+ classes side by side for one term (default: the current term) - the same figures as the Organization Stats page's Compare classes: " +
    "students enrolled, average score, pass rate (results at or above the pass mark) and attendance rate. Returns a table (present as markdown) and a " +
    "`chartUrl` image - embed it with markdown image syntax, e.g. `![Class comparison](chartUrl)`. A null value means nothing is saved for that class " +
    "in that term yet - say so rather than showing 0. Needs Manage Records.",
  parameters: {
    type: "object",
    properties: {
      classNames: { type: "array", items: { type: "string" }, description: "At least 2 class names." },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string", description: "Only needed for a term in another school year." },
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
      classNames: args.classNames.join(","),
    });
    if (args.termName) params.set("termName", args.termName);
    if (args.schoolYearLabel) params.set("schoolYearLabel", args.schoolYearLabel);
    try {
      return await callInternalApi(`/internal/api/stats/compare-classes?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409 || error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
