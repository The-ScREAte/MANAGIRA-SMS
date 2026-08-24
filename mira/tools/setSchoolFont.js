const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_school_font",
  description: "Change the app's display font for this school. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      font: {
        type: "string",
        enum: ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway", "Work Sans", "Source Sans Pro", "Ubuntu", "Noto Sans", "PT Serif", "Merriweather", "Playfair Display"],
      },
    },
    required: ["font"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the school font");
    if (!args?.font) return { status: "needs_info", message: "I need which font." };

    try {
      const result = await callWriteApi("/internal/api/school-customization/font/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        font: args.font,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Settings",
        recordType: "school_font",
        recordLabel: result.font,
        description: `Set the school's font to "${result.font}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
