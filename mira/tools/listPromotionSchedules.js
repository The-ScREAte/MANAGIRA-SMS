const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_promotion_schedules",
  description:
    "List promotion schedules (source term/year -> target term/year, status, classes, scheduled date). Needs Approve Promotions - viewing this page requires it in the real app too, not just changing it.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view promotion schedules");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { schedules } = await callInternalApi(`/internal/api/promotion/schedules?${params.toString()}`);
      return { schedules };
    } catch (error) {
      if (error.status === 403) {
        error.denied = true;
      }
      throw error;
    }
  },
};
