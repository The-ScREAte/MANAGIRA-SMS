const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_transport_route",
  description:
    "Create a new transportation route, or edit an existing one (calling again with the same routeName updates it - routeName is the unique key). Needs Manage Students. " +
    "IMPORTANT: stopNames, if given, is the COMPLETE list of stops for the route - any stop not included gets detached from the route (not deleted, just unassigned). Omit stopNames to leave the route's current stops untouched.",
  parameters: {
    type: "object",
    properties: {
      routeName: { type: "string", description: "Required, unique." },
      routeCode: { type: "string" },
      status: { type: "string", enum: ["active", "inactive"], description: "Defaults to active." },
      destinationAddress: { type: "string", description: "Where the route ends, e.g. the school. Geocoded automatically if given." },
      useSchoolDestination: { type: "boolean", description: "Use the org's own school address as the destination instead of destinationAddress." },
      stopNames: { type: "array", items: { type: "string" }, description: "The COMPLETE set of stops on this route, in any order - omit to leave stops unchanged." },
    },
    required: ["routeName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create or edit routes");
    const routeName = String(args?.routeName || "").trim();
    if (!routeName) {
      return { status: "needs_info", message: "I need the route name." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/routes/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        routeName,
        routeCode: args?.routeCode,
        status: args?.status,
        destinationAddress: args?.destinationAddress,
        useSchoolDestination: args?.useSchoolDestination,
        stopNames: args?.stopNames,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Transportation",
        recordType: "route",
        recordLabel: result.routeName,
        description: `Saved route "${result.routeName}" via Mira (AI assistant).`,
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
