const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_website_layout",
  description: "Change the school's public website layout - one of 8 designs: wireframe1 (Classic: full-width photo banner, centered sections), wireframe2 (Modern: split welcome with photos, card sections), wireframe3 (Magazine: newspaper masthead, lead story, side column for events and notices), wireframe4 (Story: large opening photo, numbered chapters, events timeline), wireframe5 (Campus: side menu with the school's details), wireframe6 (Spotlight: brand-color welcome beside photos, alternating rows), wireframe7 (Minimal: text-first, headings on the left), wireframe8 (Mosaic: a grid of tiles). Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: { layout: { type: "string", enum: ["wireframe1", "wireframe2", "wireframe3", "wireframe4", "wireframe5", "wireframe6", "wireframe7", "wireframe8"] } },
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
