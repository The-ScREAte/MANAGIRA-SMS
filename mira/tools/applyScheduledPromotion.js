const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "apply_scheduled_promotion",
  description:
    "Run an already-scheduled (not-yet-applied) promotion immediately instead of waiting for its scheduled date. Needs Approve Promotions. Identify the schedule by its source and target term/year, same as it's shown in promotion history. " +
    "First call with confirm omitted/false to get a warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      sourceTermName: { type: "string", description: "Defaults to current term." },
      sourceYearLabel: { type: "string" },
      targetTermName: { type: "string", description: "Required to identify the schedule." },
      targetYearLabel: { type: "string" },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed after seeing the warning." },
    },
    required: ["targetTermName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "apply scheduled promotions");

    const targetTermName = String(args?.targetTermName || "").trim();
    if (!targetTermName) {
      return { status: "needs_info", message: "I need the target term (the one this promotion is scheduled to go into) to find the schedule." };
    }

    try {
      const result = await callWriteApi("/internal/api/promotion/apply-now", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        sourceTermName: args?.sourceTermName,
        sourceYearLabel: args?.sourceYearLabel,
        targetTermName,
        targetYearLabel: args?.targetYearLabel,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return result;
      }

      await logMiraActivity(tenant, {
        actionType: "Applied",
        moduleName: "Promotion",
        recordType: "promotion_schedule",
        recordLabel: `${result.sourceYearLabel} - ${result.sourceTermName} → ${result.targetYearLabel} - ${result.targetTermName}`,
        description:
          `Applied the scheduled promotion from ${result.sourceYearLabel} - ${result.sourceTermName} to ${result.targetYearLabel} - ${result.targetTermName} immediately` +
          (result.enrolledCount != null ? ` (${result.enrolledCount} student(s) enrolled)` : "") +
          ` via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) {
        return { status: "not_found", message: error.message };
      }
      if (error.status === 409) {
        return { status: "blocked", message: error.message };
      }
      throw error;
    }
  },
};
