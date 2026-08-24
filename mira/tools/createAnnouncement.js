const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_announcement",
  description: "Create a banner announcement visible to staff/guardians in the caller's own school. Needs Publish Events & Announcements.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["title", "body"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create announcements");

    const title = String(args?.title || "").trim();
    const body = String(args?.body || "").trim();
    if (!title || !body) {
      return { status: "needs_info", message: "I need both a title and a body to create the announcement." };
    }

    const result = await callWriteApi("/internal/api/announcements", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      title,
      body,
    });

    return { status: "done", ...result };
  },
};
