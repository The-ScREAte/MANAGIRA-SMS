const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_grading_scale_band",
  description: "Remove one grading-scale band. Identify it by gradingScaleId (from get_report_settings). Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      gradingScaleId: { type: "number" },
    },
    required: ["gradingScaleId"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the grading scale");
    if (!args?.gradingScaleId) return { status: "needs_info", message: "I need the gradingScaleId from get_report_settings." };

    try {
      const result = await callWriteApi("/internal/api/report-settings/grading-scale/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        gradingScaleId: args.gradingScaleId,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Report Settings",
        recordType: "grading_scale",
        recordId: String(args.gradingScaleId),
        description: `Deleted a grading band via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 422) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
