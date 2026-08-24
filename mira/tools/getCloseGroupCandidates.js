const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_close_group_candidates",
  description: "List every student currently in a graduation year group, with their graduated status - use before close_graduation_year_group to see who'd actually be affected. Needs Manage School Years & Terms.",
  parameters: {
    type: "object",
    properties: {
      groupName: { type: "string" },
    },
    required: ["groupName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view a graduation year group's students");
    if (!args?.groupName) return { status: "needs_info", message: "I need the graduation year group's name." };
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      groupName: args.groupName,
    });
    try {
      return await callInternalApi(`/internal/api/graduation-year-groups/close-candidates?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
