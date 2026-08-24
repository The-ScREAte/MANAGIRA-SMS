const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "add_remark",
  description: "Add a comment-bank template teachers can pick from on report cards (teacher/conduct/attitude/interest, or a custom type already set up in the org). Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      remark: { type: "string" },
      remarkType: { type: "string", enum: ["teacher", "conduct", "attitude", "interest"], description: "Defaults to teacher. A custom org-defined type key also works." },
    },
    required: ["remark"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "add a remark");
    if (!args?.remark) return { status: "needs_info", message: "I need the remark text." };

    try {
      const result = await callWriteApi("/internal/api/report-settings/remarks/add", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        remark: args.remark,
        remarkType: args.remarkType,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Report Settings",
        recordType: "remark",
        recordLabel: result.remark,
        description: `Added a ${result.remarkType} remark to the comment bank via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
