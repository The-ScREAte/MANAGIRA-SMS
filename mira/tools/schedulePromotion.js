const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "schedule_promotion",
  description:
    "Schedule (or immediately apply) promoting students from one or more classes into their next-term class, using the promotion decisions already computed by report generation (Promoted/Repeated + destination class). Needs Approve Promotions. " +
    "Bulk action - affects every eligible student in the given classes. Never invent classNames, target term, or a date - ask the user for exactly which classes and where to promote them. " +
    "First call with confirm omitted/false to get a preview (how many students are eligible per class, and which classes are skipped because promotion isn't activated for them); relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      classNames: { type: "array", items: { type: "string" }, description: "Exact source class names to promote from." },
      sourceTermName: { type: "string", description: "Defaults to current term." },
      sourceYearLabel: { type: "string", description: "Disambiguates sourceTermName if reused across years." },
      targetTermName: { type: "string", description: "The term students will be promoted INTO. Required - never guess." },
      targetYearLabel: { type: "string", description: "The school year of the target term, if it needs disambiguating." },
      applyMode: { type: "string", enum: ["now", "schedule"], description: "\"now\" runs it immediately; \"schedule\" queues it for scheduledDate. Ask the user which they want." },
      scheduledDate: { type: "string", description: "YYYY-MM-DD. Required when applyMode is \"schedule\"." },
      confirm: {
        type: "boolean",
        description: "false/omitted on the first call to fetch the preview. Set true on the very next call once the user has given any clear yes/go-ahead - do not ask again before setting this.",
      },
    },
    required: ["classNames", "targetTermName", "applyMode"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "schedule promotions");

    const classNames = Array.isArray(args?.classNames) ? args.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    const targetTermName = String(args?.targetTermName || "").trim();
    if (!classNames.length || !targetTermName || !args?.applyMode) {
      return { status: "needs_info", message: "I need the source class(es), the target term to promote into, and whether to run it now or schedule it for later." };
    }
    if (args.applyMode === "schedule" && !args?.scheduledDate) {
      return { status: "needs_info", message: "I need a scheduled date (YYYY-MM-DD) since this isn't running immediately." };
    }

    try {
      const result = await callWriteApi("/internal/api/promotion/schedule", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        classNames,
        sourceTermName: args?.sourceTermName,
        sourceYearLabel: args?.sourceYearLabel,
        targetTermName,
        targetYearLabel: args?.targetYearLabel,
        applyMode: args.applyMode,
        scheduledDate: args?.scheduledDate,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return result;
      }

      await logMiraActivity(tenant, {
        actionType: result.status === "completed" ? "Applied" : "Scheduled",
        moduleName: "Promotion",
        recordType: "promotion_schedule",
        recordLabel: `${result.sourceYearLabel} - ${result.sourceTermName} → ${result.targetYearLabel} - ${result.targetTermName}`,
        description:
          `${result.status === "completed" ? "Applied" : "Scheduled"} a promotion from ${result.sourceYearLabel} - ${result.sourceTermName} to ${result.targetYearLabel} - ${result.targetTermName}` +
          (result.enrolledCount != null ? ` (${result.enrolledCount} student(s) enrolled)` : "") +
          ` via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404 || error.status === 400) {
        return { status: "not_found", message: error.message };
      }
      if (error.status === 409) {
        return { status: "blocked", message: error.message };
      }
      throw error;
    }
  },
};
