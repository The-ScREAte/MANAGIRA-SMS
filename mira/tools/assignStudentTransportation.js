const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "assign_student_transportation",
  description: "Give a student bus access - assign them to a bus, route, and/or stop. Needs Manage Students. Provide at least one of busNumber/routeName/stopName.",
  parameters: {
    type: "object",
    properties: {
      studentName: { type: "string" },
      busNumber: { type: "string" },
      routeName: { type: "string" },
      stopName: { type: "string" },
      pickupTime: { type: "string", description: "HH:MM" },
      dropoffTime: { type: "string", description: "HH:MM" },
      homeAddress: { type: "string" },
    },
    required: ["studentName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "assign student transportation");
    const studentName = String(args?.studentName || "").trim();
    if (!studentName) {
      return { status: "needs_info", message: "I need the student's name." };
    }
    if (!args?.busNumber && !args?.routeName && !args?.stopName) {
      return { status: "needs_info", message: "I need at least a bus, route, or stop to assign." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/students/assign", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        studentName,
        busNumber: args?.busNumber,
        routeName: args?.routeName,
        stopName: args?.stopName,
        pickupTime: args?.pickupTime,
        dropoffTime: args?.dropoffTime,
        homeAddress: args?.homeAddress,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Transportation",
        recordType: "student_assignment",
        recordLabel: result.studentName,
        description: `Assigned transportation for "${result.studentName}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
