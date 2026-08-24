const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_student_id_settings",
  description:
    "Configure the org's custom student ID system - whether it's used at all, the letter prefix (e.g. \"MIS\"), whether new IDs auto-generate, and the " +
    "starting number. Only pass what's changing. When enabled, create_students auto-generates IDs like PREFIX + zero-padded number unless a manual one " +
    "is given. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      useCustomStudentId: { type: "boolean" },
      prefix: { type: "string", description: "Letters/digits/-/_ only, max 10 chars, auto-uppercased." },
      autoGenerate: { type: "boolean" },
      startingNumber: { type: "number" },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change student ID settings");
    if (!Object.values(args || {}).some((v) => v !== undefined)) {
      return { status: "needs_info", message: "I need at least one setting to change." };
    }

    try {
      const result = await callWriteApi("/internal/api/school-customization/student-id/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        useCustomStudentId: args?.useCustomStudentId,
        prefix: args?.prefix,
        autoGenerate: args?.autoGenerate,
        startingNumber: args?.startingNumber,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Settings",
        recordType: "student_id_settings",
        description: `Updated custom student ID settings via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
