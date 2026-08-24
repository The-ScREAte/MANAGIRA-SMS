const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_integrations_status",
  description:
    "VIEW-ONLY report of the org's integrations (Google Classroom, WhatsApp Business, SMS - Arkesel/Africa's Talking/Twilio, Student Portal, " +
    "Transportation) - whether each is activated/configured/connected, and who last changed each one. Mira cannot activate, connect, disconnect, or " +
    "configure any integration - only look, never touch. Needs Manage Settings.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view integrations status");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      return await callInternalApi(`/internal/api/integrations?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
