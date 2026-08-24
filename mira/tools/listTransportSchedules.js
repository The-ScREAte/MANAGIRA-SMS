const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_transport_schedules",
  description: "List the weekly recurring bus schedule - each bus's assigned route/driver per day of week, with per-day active/inactive (paused) status and any notes. Needs Manage Students.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view transportation schedules");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { schedules } = await callInternalApi(`/internal/api/transportation/schedules?${params.toString()}`);
      return { schedules };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
