const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_website_self_enrollment",
  description:
    "Update the school's public self-enrollment settings on its website - whether it's open, the date window, price, and currency. Needs Manage Settings. " +
    "Only pass the fields you want changed - anything omitted keeps its current value. Never invent a price/currency/dates the user didn't give you.",
  parameters: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      startDate: { type: "string", description: "YYYY-MM-DD" },
      endDate: { type: "string", description: "YYYY-MM-DD" },
      price: { type: "number" },
      currency: { type: "string", description: "e.g. USD, GHS." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change self-enrollment settings");

    try {
      const result = await callWriteApi("/internal/api/website/self-enrollment/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        enabled: args?.enabled,
        startDate: args?.startDate,
        endDate: args?.endDate,
        price: args?.price,
        currency: args?.currency,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "self_enrollment",
        recordLabel: "Self Enrollment Settings",
        description: `Updated self-enrollment settings (enabled: ${result.enabled}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      throw error;
    }
  },
};
