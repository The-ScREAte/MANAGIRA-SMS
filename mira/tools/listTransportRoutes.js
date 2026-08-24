const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_transport_routes",
  description: "List transportation routes - name, code, status (active/inactive), destination, and each route's ordered list of stops. Needs Manage Students.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view transportation routes");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { routes } = await callInternalApi(`/internal/api/transportation/routes?${params.toString()}`);
      return { routes };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
