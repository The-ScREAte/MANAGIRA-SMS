const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

// When the person is free, from their own Managira calendar: day by day, within working hours.
module.exports = {
  name: "find_free_time",
  description:
    "The free times on the signed-in person's own calendar, day by day within working hours, and what's already booked (classes, events, meetings, timed tasks) plus that day's all-day items (like a holiday). " +
    "Use it before suggesting or booking a time. Read-only. Defaults: from today, 5 days, 08:00-17:00, slots of at least 30 minutes.",
  parameters: {
    type: "object",
    properties: {
      start: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      days: { type: "integer", description: "How many days to look at, 1-14. Defaults to 5." },
      dayStart: { type: "string", description: "HH:MM. Defaults to 08:00." },
      dayEnd: { type: "string", description: "HH:MM. Defaults to 17:00." },
      minutes: { type: "integer", description: "The shortest free slot worth showing, in minutes. Defaults to 30." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "check your calendar");
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), userId: String(tenant.userId || "") });
    ["start", "days", "dayStart", "dayEnd", "minutes"].forEach((key) => { if (args?.[key] !== undefined && args?.[key] !== null && args?.[key] !== "") params.set(key, String(args[key])); });
    try {
      return await callInternalApi(`/internal/api/calendar/free?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
