const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_grading_scale_band",
  description:
    "Create or update one grading-scale band for a class/term - e.g. \"80-100% = A, Excellent\". Call once per band. Use get_report_settings first " +
    "to see existing bands (and their id, for updating one via delete_grading_scale_band + re-creating if the range itself changes). Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      fromPercentage: { type: "number" },
      toPercentage: { type: "number" },
      gradeLabel: { type: "string", description: "e.g. \"A\", \"B+\", \"Distinction\"." },
      remark: { type: "string", description: "Optional descriptive remark, e.g. \"Excellent\"." },
    },
    required: ["className", "fromPercentage", "toPercentage", "gradeLabel"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the grading scale");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };
    if (args?.fromPercentage === undefined || args?.toPercentage === undefined || !args?.gradeLabel) {
      return { status: "needs_info", message: "I need fromPercentage, toPercentage, and gradeLabel." };
    }

    try {
      const result = await callWriteApi("/internal/api/report-settings/grading-scale/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        className: args.className,
        termName: args.termName,
        schoolYearLabel: args.schoolYearLabel,
        fromPercentage: args.fromPercentage,
        toPercentage: args.toPercentage,
        gradeLabel: args.gradeLabel,
        remark: args.remark,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Report Settings",
        recordType: "grading_scale",
        recordLabel: `${result.className} - ${result.gradeLabel} (${result.fromPercentage}-${result.toPercentage}%)`,
        description: `Set a grading band (${result.gradeLabel}, ${result.fromPercentage}-${result.toPercentage}%) for ${result.className} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409 || error.status === 422) return { status: "needs_info", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
