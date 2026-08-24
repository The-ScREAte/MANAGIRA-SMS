const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_website_gallery_images",
  description: "List images on the school's public website - imageId, URL, caption, allocation (hero/slideshow/siteImage), when added. Needs Manage Settings.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view website images");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { images } = await callInternalApi(`/internal/api/website/images?${params.toString()}`);
      return { images };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
