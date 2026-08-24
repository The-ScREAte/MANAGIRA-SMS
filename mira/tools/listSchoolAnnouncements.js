const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_school_announcements",
  description:
    "List announcements posted on the Announcements & Events page - message text, visibility, when posted. Defaults to the current school year/term only, same as the real page; pass scope=\"all\" to see every term. Needs Publish Events & Announcements. " +
    "(Not the same as any org-wide/platform admin announcement feature - this is specifically the school's own Announcements & Events page.)",
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["current", "all"], description: "Defaults to current term." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view announcements");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.scope) params.set("scope", args.scope);
    try {
      const result = await callInternalApi(`/internal/api/school-announcements?${params.toString()}`);
      return result;
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
