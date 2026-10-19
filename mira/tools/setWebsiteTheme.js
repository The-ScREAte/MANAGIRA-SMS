const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_website_theme",
  description: "Change the school's public website visual style/color theme. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      theme: { type: "string", enum: require("../../utils/themePalette").BRAND_COLOR_VALUES },
    },
    required: ["theme"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the website style");
    if (!args?.theme) {
      return { status: "needs_info", message: "I need which style/theme to switch to." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/theme/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        theme: args.theme,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "theme",
        recordLabel: result.theme,
        description: `Set the school website style to "${result.theme}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
