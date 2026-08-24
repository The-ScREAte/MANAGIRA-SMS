const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_transport_route_status",
  description: "Set a route's status to active or inactive (hold/pause a route). Reversible, takes effect immediately, doesn't touch the route's stops or assignments. Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      routeName: { type: "string" },
      status: { type: "string", enum: ["active", "inactive"] },
    },
    required: ["routeName", "status"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change a route's status");
    const routeName = String(args?.routeName || "").trim();
    if (!routeName || !args?.status) {
      return { status: "needs_info", message: "I need the route name and the new status." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/routes/set-status", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        routeName,
        status: args.status,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Transportation",
        recordType: "route",
        recordLabel: result.routeName,
        description: `Set route "${result.routeName}" status to "${result.status}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
