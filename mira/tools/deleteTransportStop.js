const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_transport_stop",
  description:
    "Delete a bus stop. DESTRUCTIVE and PERMANENT - any students assigned to this stop lose it (their bus/route assignment stays). Needs Manage Students. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      stopName: { type: "string" },
      routeName: { type: "string", description: "Disambiguates if more than one stop shares this name." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["stopName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete stops");
    const stopName = String(args?.stopName || "").trim();
    if (!stopName) {
      return { status: "needs_info", message: "I need the stop name to delete it." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/stops/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        stopName,
        routeName: args?.routeName,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Transportation",
        recordType: "stop",
        recordLabel: result.stopName,
        description: `Deleted stop "${result.stopName}" via Mira (AI assistant).`,
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
