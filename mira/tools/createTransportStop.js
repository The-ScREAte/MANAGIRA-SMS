const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_transport_stop",
  description:
    "Create a new bus stop, optionally attached to a route. Give either latitude+longitude, or a stopAddress to have it geocoded automatically. Needs Manage Students. " +
    "Never invent coordinates - only pass latitude/longitude if the user gave you real ones.",
  parameters: {
    type: "object",
    properties: {
      stopName: { type: "string" },
      routeName: { type: "string", description: "Optional - attaches the stop to this route." },
      stopAddress: { type: "string", description: "Used to auto-geocode if latitude/longitude aren't given." },
      latitude: { type: "number" },
      longitude: { type: "number" },
      pickupTime: { type: "string", description: "HH:MM" },
      dropoffTime: { type: "string", description: "HH:MM" },
      stopOrder: { type: "number", description: "Position within the route, lower = earlier." },
    },
    required: ["stopName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create stops");
    const stopName = String(args?.stopName || "").trim();
    if (!stopName) {
      return { status: "needs_info", message: "I need the stop name." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/stops/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        stopName,
        routeName: args?.routeName,
        stopAddress: args?.stopAddress,
        latitude: args?.latitude,
        longitude: args?.longitude,
        pickupTime: args?.pickupTime,
        dropoffTime: args?.dropoffTime,
        stopOrder: args?.stopOrder,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Transportation",
        recordType: "stop",
        recordLabel: result.stopName,
        description: `Created stop "${result.stopName}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
