const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_school_profile",
  description: "Update the school's name, address, country, and/or province. Only pass what's changing. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      schoolName: { type: "string" },
      address: { type: "string" },
      country: { type: "string", description: "2-letter country code, e.g. GH, US, NG." },
      province: { type: "string" },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change the school profile");
    if (!Object.values(args || {}).some((v) => v !== undefined)) {
      return { status: "needs_info", message: "I need at least one field to change." };
    }

    try {
      const result = await callWriteApi("/internal/api/school-customization/profile", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        schoolName: args?.schoolName,
        address: args?.address,
        country: args?.country,
        province: args?.province,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Settings",
        recordType: "school_profile",
        description: `Updated the school profile via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
