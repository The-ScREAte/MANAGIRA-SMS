const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_transport_driver_status",
  description:
    "Set a driver's transportation status to active or inactive (hold/pause). This only affects transportation, not their employee login (use set_employee_hold for that). Only works for a driver already in the transportation roster (use create_transport_driver first). Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      email: { type: "string", description: "The driver's exact email." },
      status: { type: "string", enum: ["active", "inactive"] },
    },
    required: ["email", "status"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change a driver's transportation status");
    const email = String(args?.email || "").trim();
    if (!email || !args?.status) {
      return { status: "needs_info", message: "I need the driver's exact email and the new status." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/drivers/set-status", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        email,
        status: args.status,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Transportation",
        recordType: "driver",
        recordLabel: result.name,
        description: `Set driver "${result.name}" transportation status to "${result.status}" via Mira (AI assistant).`,
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
