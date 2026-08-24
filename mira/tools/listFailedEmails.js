const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_failed_emails",
  description:
    "List people whose email address is bouncing/broken (Email Issues page) - name, account type, the broken address, why it's failing, how many times, " +
    "and when. This only tracks WHO has a broken address, not individual failed email sends - there's no subject/body to \"resend\". Needs an " +
    "org owner/Manager/Supervisor/Admin/Mini Admin role (this page has no granular permission of its own in the real app).",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view email issues");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    try {
      const { failures } = await callInternalApi(`/internal/api/email-issues?${params.toString()}`);
      return { failures };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
