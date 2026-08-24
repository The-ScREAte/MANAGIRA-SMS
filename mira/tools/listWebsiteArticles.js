const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_website_articles",
  description: "List articles/text sections on the school's public website - heading and paragraph content. Needs Manage Settings.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view website articles");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { articles } = await callInternalApi(`/internal/api/website/articles?${params.toString()}`);
      return { articles };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
