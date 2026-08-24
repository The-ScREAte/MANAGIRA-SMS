const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_transport_route",
  description:
    "Delete a route. DESTRUCTIVE and PERMANENT - its stops become unattached (not deleted), and any students/schedules referencing it lose that link. Needs Manage Students. " +
    "First call with confirm omitted/false to get the warning with exact counts; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      routeName: { type: "string" },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["routeName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete routes");
    const routeName = String(args?.routeName || "").trim();
    if (!routeName) {
      return { status: "needs_info", message: "I need the route name to delete it." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/routes/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        routeName,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Transportation",
        recordType: "route",
        recordLabel: result.routeName,
        description: `Deleted route "${result.routeName}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      throw error;
    }
  },
};
