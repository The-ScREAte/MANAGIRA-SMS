const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_remark",
  description: "Remove a comment-bank template. Identify by remarkId (from list_remarks). Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      remarkId: { type: "number" },
    },
    required: ["remarkId"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete a remark");
    if (!args?.remarkId) return { status: "needs_info", message: "I need the remarkId from list_remarks." };

    try {
      const result = await callWriteApi("/internal/api/report-settings/remarks/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        remarkId: args.remarkId,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Report Settings",
        recordType: "remark",
        recordId: String(args.remarkId),
        description: `Deleted a remark from the comment bank via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
