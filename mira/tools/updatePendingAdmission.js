const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_pending_admission",
  description:
    "Edit a pending admission's details WITHOUT approving it yet - fix a typo'd name, change the requested class, etc. Only pass what's changing; " +
    "everything else keeps its current value. Needs Approve Admissions.",
  parameters: {
    type: "object",
    properties: {
      pendingId: { type: "number" },
      studentName: { type: "string", description: "If pendingId isn't known." },
      firstName: { type: "string" },
      lastName: { type: "string" },
      dateOfBirth: { type: "string", description: "YYYY-MM-DD" },
      gender: { type: "string" },
      hometown: { type: "string" },
      studentEmail: { type: "string" },
      className: { type: "string" },
      graduationYearGroupName: { type: "string" },
      enrollmentType: { type: "string", enum: ["current", "future"] },
      schoolYearLabel: { type: "string" },
      termName: { type: "string" },
      subjects: { type: "array", items: { type: "string" }, description: "REPLACES the whole subject list if given - omit to leave subjects unchanged." },
      guardians: {
        type: "array",
        description: "REPLACES the whole guardian list if given - omit to leave guardians unchanged.",
        items: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            hometown: { type: "string" },
          },
          required: ["firstName"],
        },
      },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit a pending admission");
    if (!args?.pendingId && !args?.studentName) {
      return { status: "needs_info", message: "I need a pendingId or the applicant's name to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/admissions/pending/update", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        ...args,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Admissions",
        recordType: "pending_admission",
        recordId: String(result.pendingId),
        description: `Edited a pending admission via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
