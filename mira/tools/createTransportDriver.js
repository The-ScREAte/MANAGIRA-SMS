const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_transport_driver",
  description:
    "Add a driver to the transportation roster, or edit an existing one (calling again with the same email updates it - email is the unique key). Needs Manage Students. " +
    "If the email belongs to an existing Driver-role employee, this links their transportation profile. If it's a brand-new email, this creates a new Driver-role employee too and sends them a REAL invite email - same as create_employee's invite flow. " +
    "IMPORTANT: scheduleDays, if given, REPLACES this driver's entire weekly schedule (any day not included is removed). Omit scheduleDays to leave their schedule untouched.",
  parameters: {
    type: "object",
    properties: {
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      licenseNumber: { type: "string" },
      assignedBusNumber: { type: "string" },
      assignedRouteName: { type: "string" },
      status: { type: "string", enum: ["active", "inactive"], description: "Defaults to active." },
      scheduleDays: {
        type: "array",
        items: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
        description: "REPLACES the driver's whole weekly schedule with exactly these days. Omit to leave their existing schedule alone.",
      },
      scheduleStartTime: { type: "string", description: "HH:MM, used with scheduleDays." },
      scheduleEndTime: { type: "string", description: "HH:MM, used with scheduleDays." },
    },
    required: ["firstName", "lastName", "email"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "manage transportation drivers");
    const firstName = String(args?.firstName || "").trim();
    const lastName = String(args?.lastName || "").trim();
    const email = String(args?.email || "").trim();
    if (!firstName || !lastName || !email) {
      return { status: "needs_info", message: "I need the driver's first name, last name, and email." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/drivers/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        firstName,
        lastName,
        email,
        phone: args?.phone,
        licenseNumber: args?.licenseNumber,
        assignedBusNumber: args?.assignedBusNumber,
        assignedRouteName: args?.assignedRouteName,
        status: args?.status,
        scheduleDays: args?.scheduleDays,
        scheduleStartTime: args?.scheduleStartTime,
        scheduleEndTime: args?.scheduleEndTime,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Transportation",
        recordType: "driver",
        recordLabel: `${firstName} ${lastName}`,
        description: `Saved transportation driver "${firstName} ${lastName}" (${email}) via Mira (AI assistant).`,
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
