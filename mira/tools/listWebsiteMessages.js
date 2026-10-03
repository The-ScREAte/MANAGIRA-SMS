const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_website_messages",
  description: "Messages visitors sent through the school website's contact form (newest first). status: new (unread), read or archived; default = inbox (not archived). Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: { status: { type: "string", enum: ["new", "read", "archived"] } },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view website messages");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (["new", "read", "archived"].includes(args?.status)) params.set("status", args.status);
    try {
      return await callInternalApi(`/internal/api/website/messages?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
