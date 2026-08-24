const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_transport_schedule",
  description:
    "Delete one bus's schedule entry for one day of the week. Permanent, but nothing else references a schedule row so there's no wider impact. Needs Manage Students. " +
    "First call with confirm omitted/false to get the warning; relay it and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      busNumber: { type: "string" },
      dayOfWeek: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed after seeing the warning." },
    },
    required: ["busNumber", "dayOfWeek"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete transportation schedules");
    const busNumber = String(args?.busNumber || "").trim();
    if (!busNumber || !args?.dayOfWeek) {
      return { status: "needs_info", message: "I need the bus number and day of week." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/schedules/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        busNumber,
        dayOfWeek: args.dayOfWeek,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Transportation",
        recordType: "schedule",
        recordLabel: `${result.busNumber} - ${result.dayOfWeek}`,
        description: `Deleted Bus ${result.busNumber}'s ${result.dayOfWeek} schedule entry via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      throw error;
    }
  },
};
