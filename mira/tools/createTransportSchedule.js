const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_transport_schedule",
  description:
    "Add a bus's weekly schedule entry for one day (which route/driver runs on that day, and start/end times). Blocked if that bus already has an entry for that day - delete or use a different day. Needs Manage Students. " +
    "Call once per day to set up a multi-day week.",
  parameters: {
    type: "object",
    properties: {
      busNumber: { type: "string" },
      dayOfWeek: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
      routeName: { type: "string" },
      driverEmail: { type: "string", description: "Exact email of a driver already in the transportation roster." },
      startTime: { type: "string", description: "HH:MM" },
      endTime: { type: "string", description: "HH:MM" },
      status: { type: "string", enum: ["active", "inactive"], description: "Defaults to active." },
      notes: { type: "string" },
    },
    required: ["busNumber", "dayOfWeek"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create transportation schedules");
    const busNumber = String(args?.busNumber || "").trim();
    if (!busNumber || !args?.dayOfWeek) {
      return { status: "needs_info", message: "I need the bus number and day of week." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/schedules/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        busNumber,
        dayOfWeek: args.dayOfWeek,
        routeName: args?.routeName,
        driverEmail: args?.driverEmail,
        startTime: args?.startTime,
        endTime: args?.endTime,
        status: args?.status,
        notes: args?.notes,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Transportation",
        recordType: "schedule",
        recordLabel: `${result.busNumber} - ${result.dayOfWeek}`,
        description: `Created a ${result.dayOfWeek} schedule entry for Bus ${result.busNumber} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "blocked", message: error.message };
      throw error;
    }
  },
};
