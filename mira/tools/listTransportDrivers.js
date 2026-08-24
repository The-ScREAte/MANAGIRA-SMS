const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_transport_drivers",
  description: "List Driver-role employees and their transportation roster status - phone, license number, active/inactive status in transportation, assigned bus/route. Needs Manage Students.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view transportation drivers");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { drivers } = await callInternalApi(`/internal/api/transportation/drivers?${params.toString()}`);
      return { drivers };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
