const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_notification_preferences",
  description:
    "Read notification/email preferences - the caller's own personal toggles (role-specific, e.g. weekly digest, assignment changes) and the org-wide " +
    "toggles (currently just auto-inviting new guardians to the parent portal). Each shows its key, label, description, and current on/off state.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view notification preferences");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    return await callInternalApi(`/internal/api/notifications/preferences?${params.toString()}`);
  },
};
