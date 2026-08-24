const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_display_preferences",
  description: "Set how names and dates are displayed across the app for this school. Only pass what's changing. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      nameDisplayFormat: { type: "string", enum: ["first_last", "last_first"] },
      dateDisplayFormat: { type: "string", enum: ["dd_mm_yyyy", "mm_dd_yyyy", "yyyy_mm_dd"] },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change display preferences");
    if (!args?.nameDisplayFormat && !args?.dateDisplayFormat) {
      return { status: "needs_info", message: "I need nameDisplayFormat and/or dateDisplayFormat." };
    }

    try {
      const result = await callWriteApi("/internal/api/school-customization/display-preferences/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        nameDisplayFormat: args?.nameDisplayFormat,
        dateDisplayFormat: args?.dateDisplayFormat,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Settings",
        recordType: "display_preferences",
        description: `Updated name/date display preferences via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
