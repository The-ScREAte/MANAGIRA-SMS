const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_organization_statistics",
  description:
    "Organization statistics for one term (default: the current term) - the exact same numbers as the website's Organization Stats page: enrolled " +
    "students (and change from the previous term), average score, pass rate, attendance rate, score entry progress, students needing support, active " +
    "classes, staff, per-class and per-subject results, score distribution, top students, enrollment by term, gender and staff by role. If the term has " +
    "no scores yet, academic figures come from the latest term with results - say which term (academicResultsTerm) whenever that happens. Present the " +
    "headline numbers first, then tables; embed the `charts` image URLs with markdown image syntax. Offer `pageUrl` and the `downloads` (PDF / Excel) " +
    "links when the user wants the full report or a file. Needs Manage Records.",
  parameters: {
    type: "object",
    properties: {
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string", description: "Disambiguates termName if the same term name exists in multiple years." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view organization statistics");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.termName) params.set("termName", args.termName);
    if (args?.schoolYearLabel) params.set("schoolYearLabel", args.schoolYearLabel);
    try {
      return await callInternalApi(`/internal/api/stats/organization?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
