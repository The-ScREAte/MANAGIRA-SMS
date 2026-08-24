const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_transport_bus",
  description:
    "Create a new bus/vehicle, or edit an existing one (calling again with the same busNumber updates it - busNumber is the unique key). Needs Manage Students. " +
    "Never invent capacity, license plate, VIN, or other vehicle details the user didn't give you.",
  parameters: {
    type: "object",
    properties: {
      busNumber: { type: "string", description: "Required, unique. e.g. \"Bus 12\"." },
      busName: { type: "string" },
      licensePlate: { type: "string" },
      capacity: { type: "number" },
      driverEmail: { type: "string", description: "Exact email of an existing Driver-role employee to assign." },
      status: { type: "string", enum: ["active", "in_service", "maintenance", "out_of_service"], description: "Defaults to active." },
      vehicleMake: { type: "string" },
      vehicleModel: { type: "string" },
      vehicleYear: { type: "number" },
      vehicleColor: { type: "string" },
      vin: { type: "string" },
      fuelType: { type: "string" },
      odometer: { type: "number" },
    },
    required: ["busNumber"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create or edit buses");

    const busNumber = String(args?.busNumber || "").trim();
    if (!busNumber) {
      return { status: "needs_info", message: "I need the bus number." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/buses/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        busNumber,
        busName: args?.busName,
        licensePlate: args?.licensePlate,
        capacity: args?.capacity,
        driverEmail: args?.driverEmail,
        status: args?.status,
        vehicleMake: args?.vehicleMake,
        vehicleModel: args?.vehicleModel,
        vehicleYear: args?.vehicleYear,
        vehicleColor: args?.vehicleColor,
        vin: args?.vin,
        fuelType: args?.fuelType,
        odometer: args?.odometer,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Transportation",
        recordType: "bus",
        recordLabel: result.busNumber,
        description: `Saved bus "${result.busNumber}" via Mira (AI assistant).`,
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
