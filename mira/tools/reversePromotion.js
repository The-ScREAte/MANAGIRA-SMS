const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "reverse_promotion",
  description:
    "Reverse an already-applied promotion, undoing exactly what it created (new-term class/subject enrollments), where safe to do so. DESTRUCTIVE. Only works within 15 days of when it ran, on a promotion with a recorded action audit (older records can't be auto-reversed). Doesn't undo anything a human has changed by hand since. Needs Approve Promotions. Identify it by its source and target term/year. " +
    "First call with confirm omitted/false to get a warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      sourceTermName: { type: "string", description: "Defaults to current term." },
      sourceYearLabel: { type: "string" },
      targetTermName: { type: "string", description: "Required to identify the schedule." },
      targetYearLabel: { type: "string" },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the reversal after seeing the danger warning." },
    },
    required: ["targetTermName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "reverse promotions");

    const targetTermName = String(args?.targetTermName || "").trim();
    if (!targetTermName) {
      return { status: "needs_info", message: "I need the target term (the one this promotion ran into) to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/promotion/reverse", {
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
        actionType: "Reversed",
        moduleName: "Promotion",
        recordType: "promotion_schedule",
        recordLabel: `${result.sourceYearLabel} - ${result.sourceTermName} → ${result.targetYearLabel} - ${result.targetTermName}`,
        description: `Reversed the promotion from ${result.sourceYearLabel} - ${result.sourceTermName} to ${result.targetYearLabel} - ${result.targetTermName} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) {
        return { status: "not_found", message: error.message };
      }
      if (error.status === 409) {
        await logMiraActivity(tenant, {
          actionType: "Reverse Blocked",
          moduleName: "Promotion",
          recordType: "promotion_schedule",
          recordLabel: `${args?.sourceYearLabel || ""} ${args?.sourceTermName || ""} -> ${args?.targetYearLabel || ""} ${targetTermName}`.trim(),
          description: `Mira (AI assistant) attempted to reverse a promotion but it was blocked: ${error.message}`,
        });
        return { status: "blocked", message: error.message };
      }
      throw error;
    }
  },
};
