const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "approve_pending_admission",
  description:
    "DESTRUCTIVE/IRREVERSIBLE. Approves a pending admission as-is: creates a real student record, enrolls them in their requested class, links their " +
    "guardian(s) (with real portal accounts), and permanently deletes the pending application - there's no undo. To change something first, use " +
    "update_pending_admission before approving. Call once without confirm to get a warning, then again with confirm=true after the user explicitly " +
    "agrees. Needs Approve Admissions.",
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
    assertIsStaff(tenant, "approve a pending admission");
    if (!args?.pendingId && !args?.studentName) {
      return { status: "needs_info", message: "I need a pendingId or the applicant's name to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/admissions/pending/approve", {
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
        actionType: "Approved",
        moduleName: "Admissions",
        recordType: "student",
        recordId: String(result.studentId),
        description: `Approved a pending admission (now student #${result.studentId}) via Mira (AI assistant).`,
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
