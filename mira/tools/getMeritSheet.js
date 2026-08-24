const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_merit_sheet",
  description:
    "Compute a class merit sheet - every enrolled student's total score per subject, overall total, average, and rank - as data, not a PDF. This is the " +
    "normal first step: present the result as a clean markdown table in your reply. Only call generate_merit_sheet_pdf afterward if the user actually " +
    "wants a downloadable/printable PDF file. Defaults to every subject and every assessment for the class/term if you don't name specific ones; " +
    "defaults to the org's current school year/term unless you name a different one. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      subjectNames: { type: "array", items: { type: "string" }, description: "Defaults to every subject in the class." },
      assessmentTitles: { type: "array", items: { type: "string" }, description: "Defaults to every assessment for the selected subjects/term." },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view a merit sheet");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };

    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      className: args.className,
    });
    if (args.termName) params.set("termName", args.termName);
    if (args.schoolYearLabel) params.set("schoolYearLabel", args.schoolYearLabel);
    if (args.subjectNames?.length) params.set("subjectNames", args.subjectNames.join(","));
    if (args.assessmentTitles?.length) params.set("assessmentTitles", args.assessmentTitles.join(","));

    try {
      return await callInternalApi(`/internal/api/merit-sheets?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
