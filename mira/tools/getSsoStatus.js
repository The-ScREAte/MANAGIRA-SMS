const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_sso_status",
  description: "Whether this school has single sign-on set up, with which provider, whether it's on, and recent sign-ins. Needs the Single Sign-On permission. Read-only: only a manager can change it, in Settings. Never ask anyone for a password, certificate or client secret.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view single sign-on");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      return await callInternalApi(`/internal/api/sso/status?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
