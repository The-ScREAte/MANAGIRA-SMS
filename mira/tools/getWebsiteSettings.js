const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_website_settings",
  description: "Get the school's public website: link, setup checklist (what's done and what's missing), layout, theme, online registration (self-enrollment) settings and status, unread contact-form messages, and every extra section (quick facts, programs, leadership, testimonials, FAQ, about photo, contact form) with whether it is live. Needs Manage Settings.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view website settings");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      return await callInternalApi(`/internal/api/website/settings?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
