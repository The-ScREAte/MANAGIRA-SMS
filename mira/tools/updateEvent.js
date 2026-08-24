const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_event",
  description:
    "Edit an existing event's name, date, details, or visibility. Only pass the fields you want changed - anything omitted stays as-is. Needs Publish Events & Announcements. " +
    "Identify the event by its exact current name; if more than one event shares that name, also give eventDate to pick the right one. " +
    "Setting notifyByEmail sends a REAL email to guardians right away - needs explicit confirmation first; without it this runs immediately.",
  parameters: {
    type: "object",
    properties: {
      eventName: { type: "string", description: "The event's exact CURRENT name." },
      eventDate: { type: "string", description: "The event's exact CURRENT date (YYYY-MM-DD) - only needed to disambiguate if the name is reused." },
      newEventName: { type: "string", description: "New name, if changing it." },
      newEventDate: { type: "string", description: "New date (YYYY-MM-DD), if changing it." },
      eventDetails: { type: "string", description: "New details, if changing them." },
      visibility: { type: "string", enum: ["org", "public", "both"] },
      notifyByEmail: { type: "boolean", description: "Sends a real email to guardians immediately. Defaults to false." },
      confirm: { type: "boolean", description: "Only needed (and only checked) when notifyByEmail is true." },
    },
    required: ["eventName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit events");
    const eventName = String(args?.eventName || "").trim();
    if (!eventName) {
      return { status: "needs_info", message: "I need the event's exact current name." };
    }

    try {
      const result = await callWriteApi("/internal/api/events/update", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        eventName,
        eventDate: args?.eventDate,
        newEventName: args?.newEventName,
        newEventDate: args?.newEventDate,
        eventDetails: args?.eventDetails,
        visibility: args?.visibility,
        notifyByEmail: args?.notifyByEmail === true,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Events & Announcements",
        recordType: "event",
        recordLabel: result.eventName,
        description: `Updated event "${result.eventName}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
