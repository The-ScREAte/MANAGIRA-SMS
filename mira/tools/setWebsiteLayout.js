const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");
const { LAYOUTS } = require("../../utils/websiteView");

module.exports = {
  name: "set_website_layout",
  // Every design, from the same list the Manage Website page uses. A design still being
  // released reaches only some schools: the API refuses it elsewhere and Mira says so.
  description: `Change the school's public website design. The designs: ${LAYOUTS.map((l) => `${l.value} (${l.name}${l.motion ? ", 3D, animates as visitors scroll" : ""}: ${l.description})`).join("; ")}. Every design shows the same content. A design that isn't available for this school yet is refused: tell the person so. Needs Manage Settings.`,
  parameters: {
    type: "object",
    properties: { layout: { type: "string", enum: LAYOUTS.map((l) => l.value) } },
    required: ["layout"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the website layout");
    if (!args?.layout) {
      return { status: "needs_info", message: "I need which layout to switch to." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/layout/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        layout: args.layout,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "layout",
        recordLabel: result.layout,
        description: `Set the school website layout to "${result.layout}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
