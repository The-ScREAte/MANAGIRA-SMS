const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_calendar_sync_status",
  description:
    "Whether the signed-in person's calendar is connected to their personal Google or Outlook calendar, when it last synced, and whether it needs attention. " +
    "Connecting is something only they can do, by signing in themselves on the page this returns. Mira never handles passwords or sign-in codes. Read-only.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view calendar sync");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      return await callInternalApi(`/internal/api/calendar/sync-status?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
