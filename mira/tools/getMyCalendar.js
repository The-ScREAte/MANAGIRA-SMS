const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_my_calendar",
  description:
    "What's on the signed-in person's own Managira calendar between two dates: school events, class activities, their classes or bus runs, their tasks and personal events. " +
    "Only ever shows what this person can already see. Defaults to the next 14 days. Read-only.",
  parameters: {
    type: "object",
    properties: {
      start: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      end: { type: "string", description: "YYYY-MM-DD, last day to include. Defaults to 14 days from the start. At most 62 days." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view the calendar");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.start) params.set("start", String(args.start));
    if (args?.end) params.set("end", String(args.end));
    try {
      return await callInternalApi(`/internal/api/calendar/items?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
