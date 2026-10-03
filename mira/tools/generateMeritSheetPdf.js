const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "generate_merit_sheet_pdf",
  description:
    "Generate a class merit sheet as a real downloadable PDF - the same file the website's Merit Sheet Download button produces (school colours, " +
    "wide sheets split across pages). This is the SECOND step: call get_merit_sheet first and show the table; call this (slower) once the user wants a " +
    "PDF file. Pass the same arguments as get_merit_sheet (subjects, assessments, term, columns) so the PDF matches what they saw. Needs Manage Reports.",
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
        description: "Same column choice as get_merit_sheet - pass what the user saw. Omit for the default columns.",
      },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "generate a merit sheet");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };

    try {
      const result = await callWriteApi("/internal/api/merit-sheets/generate", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        className: args.className,
        termName: args.termName,
        schoolYearLabel: args.schoolYearLabel,
        subjectNames: args.subjectNames,
        assessmentTitles: args.assessmentTitles,
        columns: args.columns,
      });

      await logMiraActivity(tenant, {
        actionType: "Generated",
        moduleName: "Report Cards",
        recordType: "merit_sheet_pdf",
        recordLabel: `${result.className} - ${result.termName}`,
        description: `Generated a merit sheet PDF for ${result.className} (${result.termName}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "needs_info", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
