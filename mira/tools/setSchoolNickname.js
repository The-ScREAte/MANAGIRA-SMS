const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_school_nickname",
  description:
    "Change the school's human-readable display nickname (3-60 characters). This does NOT change the .managira.com subdomain, which is locked at " +
    "registration - only the display label shown around the app. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: { nickname: { type: "string" } },
    required: ["nickname"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the school nickname");
    if (!args?.nickname) return { status: "needs_info", message: "I need the new nickname." };

    try {
      const result = await callWriteApi("/internal/api/school-customization/nickname/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        nickname: args.nickname,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Settings",
        recordType: "school_nickname",
        recordLabel: result.nickname,
        description: `Set the school's nickname to "${result.nickname}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
