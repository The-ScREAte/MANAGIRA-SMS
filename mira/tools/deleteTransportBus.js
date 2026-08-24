const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_transport_bus",
  description:
    "Delete a bus. DESTRUCTIVE and PERMANENT - its weekly schedule rows are deleted too, and any students assigned to it lose that bus assignment. Needs Manage Students. " +
    "First call with confirm omitted/false to get the warning with exact counts; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      busNumber: { type: "string" },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["busNumber"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete buses");
    const busNumber = String(args?.busNumber || "").trim();
    if (!busNumber) {
      return { status: "needs_info", message: "I need the bus number to delete it." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/buses/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        busNumber,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Transportation",
        recordType: "bus",
        recordLabel: result.busNumber,
        description: `Deleted bus "${result.busNumber}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      throw error;
    }
  },
};
