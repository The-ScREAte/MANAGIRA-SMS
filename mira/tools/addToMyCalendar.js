const { assertIsStaff, callWriteApi } = require("./_writeAuth");
const { logMiraActivity } = require("./_activityLog");

// Scheduling for the person themselves: a meeting, an appointment or a reminder on their own
// calendar (a personal event, the same as one made on the calendar page). It also reaches their
// Google Calendar or Outlook if they connected one. A school-wide event is create_event.
module.exports = {
  name: "add_to_my_calendar",
  description:
    "Put something on the signed-in person's own calendar: a meeting, appointment or reminder they asked for. " +
    "Title and date are needed; add a start and end time only if they gave one (no time means all day). " +
    "Use find_free_time first when they ask you to find a time. Only for the person themselves; for a school-wide event use create_event.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "What it is, in their words (e.g. \"Meeting with Ms. Owusu\")." },
      date: { type: "string", description: "YYYY-MM-DD" },
      endDate: { type: "string", description: "YYYY-MM-DD, only if it runs over several days." },
      startTime: { type: "string", description: "HH:MM, 24-hour. Leave out for all day." },
      endTime: { type: "string", description: "HH:MM, 24-hour." },
      location: { type: "string", description: "Only a place they named." },
      details: { type: "string", description: "Only what they said. Never invent an agenda." },
    },
    required: ["title", "date"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "add to your calendar");
    const result = await callWriteApi("/internal/api/calendar/add", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      title: String(args?.title || "").trim(),
      date: String(args?.date || "").trim(),
      endDate: args?.endDate ? String(args.endDate).trim() : undefined,
      startTime: args?.startTime ? String(args.startTime).trim() : undefined,
      endTime: args?.endTime ? String(args.endTime).trim() : undefined,
      location: args?.location ? String(args.location).trim() : undefined,
      details: args?.details ? String(args.details).trim() : undefined,
    }).catch((error) => {
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    });
    if (result.status === "needs_info") return result;
    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Calendar",
      recordType: "personal event",
      recordLabel: result.added.title,
      description: `Added "${result.added.title}" on ${result.added.date} to their own calendar via Mira (AI assistant).`,
    });
    return { status: "done", ...result };
  },
};
