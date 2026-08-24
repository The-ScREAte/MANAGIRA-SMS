const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "reject_pending_admission",
  description:
    "DESTRUCTIVE/IRREVERSIBLE. Rejects a pending admission - permanently deletes the application and emails/notifies the guardian(s) it wasn't approved. " +
    "There's no undo and no trace kept of a rejected application. Call once without confirm to get a warning, then again with confirm=true after the " +
    "user explicitly agrees. Needs Approve Admissions.",
  parameters: {
    type: "object",
    properties: {
      pendingId: { type: "number" },
      studentName: { type: "string", description: "If pendingId isn't known." },
      confirm: { type: "boolean" },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "reject a pending admission");
    if (!args?.pendingId && !args?.studentName) {
      return { status: "needs_info", message: "I need a pendingId or the applicant's name to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/admissions/pending/reject", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        pendingId: args?.pendingId,
        studentName: args?.studentName,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return { status: "confirm", message: result.warning, pendingId: result.pendingId, name: result.name };
      }

      await logMiraActivity(tenant, {
        actionType: "Rejected",
        moduleName: "Admissions",
        recordType: "pending_admission",
        recordId: String(result.pendingId),
        description: `Rejected a pending admission via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
