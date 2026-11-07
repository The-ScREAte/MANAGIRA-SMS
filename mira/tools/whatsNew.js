const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "whats_new",
  description: "What's new in Managira for this school, and where to find it: class activities, calendars, bus boarding, single sign-on and more. Use this for 'what's new' or 'what else can Managira do', and to explain any of these. Only lists what this school actually has. Read-only.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(args, tenant) {
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      return await callInternalApi(`/internal/api/whats-new?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
