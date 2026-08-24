const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_transport_schedule_status",
  description: "Pause or resume one bus's schedule entry for one specific day of the week (the most granular hold/pause - e.g. pause just Fridays without touching the rest of the week). Reversible, immediate. Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      busNumber: { type: "string" },
      dayOfWeek: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
      status: { type: "string", enum: ["active", "inactive"] },
    },
    required: ["busNumber", "dayOfWeek", "status"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change a schedule's status");
    const busNumber = String(args?.busNumber || "").trim();
    if (!busNumber || !args?.dayOfWeek || !args?.status) {
      return { status: "needs_info", message: "I need the bus number, day of week, and new status." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/schedules/set-status", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        busNumber,
        dayOfWeek: args.dayOfWeek,
        status: args.status,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Transportation",
        recordType: "schedule",
        recordLabel: `${result.busNumber} - ${result.dayOfWeek}`,
        description: `Set Bus ${result.busNumber}'s ${result.dayOfWeek} schedule to "${result.status}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
