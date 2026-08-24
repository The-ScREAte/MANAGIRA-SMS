const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_promotion_settings",
  description:
    "Set a class/term's promotion rules - the pass/fail cutoff percentage, which class passing students promote into, which class failing students " +
    "repeat into, whether auto-promotion is active, and the school reopen date shown on the report. Only pass what's changing. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      cutOffPoint: { type: "number", description: "Pass/fail percentage cutoff." },
      promotedClassName: { type: "string", description: "Class a passing student is promoted into." },
      repeatedClassName: { type: "string", description: "Class a failing student repeats into." },
      activatePromotion: { type: "boolean" },
      schoolReopenDate: { type: "string", description: "YYYY-MM-DD" },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change promotion settings");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };

    try {
      const result = await callWriteApi("/internal/api/report-settings/promotion/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        className: args.className,
        termName: args.termName,
        schoolYearLabel: args.schoolYearLabel,
        cutOffPoint: args.cutOffPoint,
        promotedClassName: args.promotedClassName,
        repeatedClassName: args.repeatedClassName,
        activatePromotion: args.activatePromotion,
        schoolReopenDate: args.schoolReopenDate,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Report Settings",
        recordType: "promotion_settings",
        recordLabel: `${result.className} - ${result.termName}`,
        description: `Updated promotion settings for ${result.className} (${result.termName}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409 || error.status === 422) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
