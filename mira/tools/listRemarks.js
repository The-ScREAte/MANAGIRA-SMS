const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_remarks",
  description: "List the org's comment-bank templates (teacher/conduct/attitude/interest, or a custom type) that teachers pick from on report cards. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      remarkType: { type: "string", description: "Optional filter: teacher, conduct, attitude, interest, or a custom type key." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view the remarks bank");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    if (args?.remarkType) params.set("remarkType", args.remarkType);
    try {
      const { remarks } = await callInternalApi(`/internal/api/report-settings/remarks?${params.toString()}`);
      return { remarks };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
