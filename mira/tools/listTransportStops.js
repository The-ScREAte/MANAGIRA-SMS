const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_transport_stops",
  description: "List all bus stops (the org-wide stop pool, not just ones attached to a route) - name, address, coordinates, pickup/dropoff times, and which route (if any) each belongs to. Needs Manage Students.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view transportation stops");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { stops } = await callInternalApi(`/internal/api/transportation/stops?${params.toString()}`);
      return { stops };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
