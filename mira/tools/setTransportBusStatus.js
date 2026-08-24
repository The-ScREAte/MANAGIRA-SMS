const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_transport_bus_status",
  description: "Set a bus's status - active, in_service, maintenance, or out_of_service (hold/pause a bus by setting it to maintenance or out_of_service). Reversible, takes effect immediately. Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      busNumber: { type: "string" },
      status: { type: "string", enum: ["active", "in_service", "maintenance", "out_of_service"] },
    },
    required: ["busNumber", "status"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change a bus's status");
    const busNumber = String(args?.busNumber || "").trim();
    if (!busNumber || !args?.status) {
      return { status: "needs_info", message: "I need the bus number and the new status." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/buses/set-status", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        busNumber,
        status: args.status,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Transportation",
        recordType: "bus",
        recordLabel: result.busNumber,
        description: `Set bus "${result.busNumber}" status to "${result.status}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
