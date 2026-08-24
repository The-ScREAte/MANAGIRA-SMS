const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_event",
  description:
    "Delete an event. DESTRUCTIVE and PERMANENT. Needs Publish Events & Announcements. Identify by exact name; add eventDate if the name is reused. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      eventName: { type: "string" },
      eventDate: { type: "string", description: "YYYY-MM-DD, only needed to disambiguate if the name is reused." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["eventName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete events");
    const eventName = String(args?.eventName || "").trim();
    if (!eventName) {
      return { status: "needs_info", message: "I need the event's exact name to delete it." };
    }

    try {
      const result = await callWriteApi("/internal/api/events/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        eventName,
        eventDate: args?.eventDate,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Events & Announcements",
        recordType: "event",
        recordLabel: result.eventName,
        description: `Deleted event "${result.eventName}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
