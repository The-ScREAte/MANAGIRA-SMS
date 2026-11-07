const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_bus_riding_today",
  description: "Who isn't coming on the bus today and who marked them, how many boarded, and who didn't board. A teacher sees their own classes; transport staff see every bus. Read-only.",
  parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD. Defaults to today." } }, required: [] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view bus riders");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.date) params.set("date", String(args.date));
    try {
      return await callInternalApi(`/internal/api/transport/riding?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
