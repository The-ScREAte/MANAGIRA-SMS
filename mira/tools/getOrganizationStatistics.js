const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_organization_statistics",
  description:
    "Full organization statistics dashboard for one term - student/employee/class/subject counts, attendance by class, top performing classes, " +
    "enrollment growth by year, enrollment over terms, gender distribution, employee roles, subject strength profile, and student count per class. " +
    "Returns both the raw numbers (present them as markdown tables) AND ready-to-embed chart image URLs in `charts` (bar/line/doughnut/radar) - " +
    "embed these directly in your reply using markdown image syntax, e.g. `![Attendance by Class](charts.attendanceByClass)`, so the user actually " +
    "sees the graphs, not just numbers. Defaults to the org's current term if none given. Needs Manage Records.",
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
