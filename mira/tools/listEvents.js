const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_events",
  description:
    "List school events - name, date, details, visibility, and a human timing label (\"today\", \"tomorrow\", \"in 5 days\", \"3 days ago\"). Defaults to the current school year/term only, same as the real page; pass scope=\"all\" to see every term. Use when=\"today\"/\"upcoming\"/\"past\" to filter by date. Needs Publish Events & Announcements.",
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["current", "all"], description: "Defaults to current term." },
      when: { type: "string", enum: ["today", "upcoming", "past", "all"], description: "Defaults to all." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view events");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.scope) params.set("scope", args.scope);
    if (args?.when) params.set("when", args.when);
    try {
      const result = await callInternalApi(`/internal/api/events?${params.toString()}`);
      return result;
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
