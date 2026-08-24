const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "unarchive_students",
  description:
    "Reverse close_graduation_year_group for specific students - marks them not-graduated again and removes their archive record. Call once without " +
    "confirm to get a warning, then again with confirm=true after the user explicitly agrees. Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      studentNames: { type: "array", items: { type: "string" } },
      confirm: { type: "boolean" },
    },
    required: ["studentNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "unarchive students");
    if (!args?.studentNames?.length) return { status: "needs_info", message: "I need at least one archived student's name." };

    try {
      const result = await callWriteApi("/internal/api/archived-students/unarchive", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        studentNames: args.studentNames,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return { status: "confirm", message: result.warning, studentCount: result.studentCount, students: result.students };
      }

      if (result.unarchived?.length) {
        await logMiraActivity(tenant, {
          actionType: "Updated",
          moduleName: "Graduation Year Groups",
          recordType: "student",
          description: `Unarchived ${result.unarchived.length} student(s) via Mira (AI assistant).`,
        });
      }

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "needs_info", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
