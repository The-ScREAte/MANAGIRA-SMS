const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_event",
  description:
    "Create a school event - name, date, and details. Needs Publish Events & Announcements. " +
    "visibility defaults to \"org\" (internal-only) if not given - only set \"public\" or \"both\" if the user actually wants it on the school's public website. " +
    "Setting notifyByEmail sends a REAL email to guardians right away - needs explicit confirmation first (call with confirm omitted/false to get the warning, then confirm=true once the user clearly agrees); without notifyByEmail this runs immediately.",
  parameters: {
    type: "object",
    properties: {
      eventName: { type: "string" },
      eventDate: { type: "string", description: "YYYY-MM-DD" },
      eventDetails: { type: "string" },
      visibility: { type: "string", enum: ["org", "public", "both"], description: "Defaults to org (internal-only)." },
      notifyByEmail: { type: "boolean", description: "Sends a real email to guardians immediately. Defaults to false." },
      confirm: { type: "boolean", description: "Only needed (and only checked) when notifyByEmail is true - set true ONLY after the user has explicitly confirmed." },
    },
    required: ["eventName", "eventDate", "eventDetails"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create events");
    const eventName = String(args?.eventName || "").trim();
    const eventDate = String(args?.eventDate || "").trim();
    const eventDetails = String(args?.eventDetails || "").trim();
    if (!eventName || !eventDate || !eventDetails) {
      return { status: "needs_info", message: "I need the event's name, date, and details." };
    }

    try {
      const result = await callWriteApi("/internal/api/events/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        eventName,
        eventDate,
        eventDetails,
        visibility: args?.visibility,
        notifyByEmail: args?.notifyByEmail === true,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Events & Announcements",
        recordType: "event",
        recordLabel: result.eventName,
        description: `Created event "${result.eventName}" on ${result.eventDate} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
