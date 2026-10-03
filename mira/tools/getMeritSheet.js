const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_merit_sheet",
  description:
    "Compute a class merit sheet (not a PDF) - the exact same numbers as the website's Merit Sheet page. Returns `table`, a ready markdown table " +
    "(a row per student: position, name, each subject's total and the chosen columns) - show it as-is (for a very long class, show it and say how " +
    "many students there are). Then offer the PDF; if the user wants it, call generate_merit_sheet_pdf with the same arguments. Defaults: every " +
    "subject and assessment for the class, the current school year/term, and the page's default columns. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      subjectNames: { type: "array", items: { type: "string" }, description: "Defaults to every subject in the class." },
      assessmentTitles: { type: "array", items: { type: "string" }, description: "Defaults to every assessment for the selected subjects/term." },
      columns: {
        type: "array",
        items: { type: "string", enum: ["studentId", "gender", "grade", "subjectTotal", "total", "average", "percentage", "overallGrade", "position", "remark"] },
        description: "Which optional columns to show (same choices as the website). grade = each assessment's grade (shown with includeAssessmentScores). Omit for the default columns.",
      },
      includeAssessmentScores: { type: "boolean", description: "Add a column per assessment (not just subject totals). Only when the user asks for individual test scores - it makes the table much wider." },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view a merit sheet");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };

    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      className: args.className,
    });
    if (args.termName) params.set("termName", args.termName);
    if (args.schoolYearLabel) params.set("schoolYearLabel", args.schoolYearLabel);
    if (args.subjectNames?.length) params.set("subjectNames", args.subjectNames.join(","));
    if (args.assessmentTitles?.length) params.set("assessmentTitles", args.assessmentTitles.join(","));
    if (args.columns?.length) params.set("columns", args.columns.join(","));
    if (args.includeAssessmentScores) params.set("includeAssessmentScores", "true");

    try {
      return await callInternalApi(`/internal/api/merit-sheets?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
