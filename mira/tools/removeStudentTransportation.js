const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "remove_student_transportation",
  description: "Remove a student's bus access (deactivates their transportation assignment; doesn't delete their record, so re-assigning later still works). Needs Manage Students.",
  parameters: {
    type: "object",
    properties: { studentName: { type: "string" } },
    required: ["studentName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "remove student transportation access");
    const studentName = String(args?.studentName || "").trim();
    if (!studentName) {
      return { status: "needs_info", message: "I need the student's name." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/students/remove", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        studentName,
      });

      if (result.status === "no_change") return result;

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Transportation",
        recordType: "student_assignment",
        recordLabel: result.studentName,
        description: `Removed transportation access for "${result.studentName}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      throw error;
    }
  },
};
