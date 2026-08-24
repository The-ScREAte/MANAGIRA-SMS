const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_report_settings",
  description:
    "Read a class/term's report card settings - promotion rules (cutoff, promoted/repeated class), grading scale (percentage bands with grade " +
    "labels/remarks), and which columns/sections show on the printed report (position, attendance, score breakdown, remarks types, grade key). " +
    "Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string", description: "Disambiguates termName if needed." },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view report settings");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
      className: args.className,
    });
    if (args.termName) params.set("termName", args.termName);
    if (args.schoolYearLabel) params.set("schoolYearLabel", args.schoolYearLabel);
    try {
      return await callInternalApi(`/internal/api/report-settings?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
