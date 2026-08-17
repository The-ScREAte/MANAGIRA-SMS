const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "create_announcement",
  description: "Create a banner announcement visible to staff/guardians in the caller's own school. Requires an admin-level role.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["title", "body"],
  },
  async handler(args, tenant) {
    if (!tenant.roleTags.includes("org_admin") && !tenant.roleTags.includes("super_admin")) {
      const error = new Error("You need an admin-level role to create announcements.");
      error.denied = true;
      throw error;
    }

    return callInternalApi("/internal/api/announcements", {
      method: "POST",
      body: {
        organizationId: tenant.organizationId,
        title: args?.title,
        body: args?.body,
      },
    });
  },
};
