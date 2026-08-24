const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_transport_buses",
  description: "List school buses/vehicles - number, name, license plate, capacity, status (active/in_service/maintenance/out_of_service), assigned driver, and vehicle details. Needs Manage Students - viewing this page requires it in the real app too.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view transportation buses");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { buses } = await callInternalApi(`/internal/api/transportation/buses?${params.toString()}`);
      return { buses };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
