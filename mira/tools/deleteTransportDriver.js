const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_transport_driver",
  description:
    "Remove a driver from the transportation roster. Does NOT delete their employee account or login access (use Manage Employees for that) - only their transportation profile and bus assignment. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true. Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      email: { type: "string", description: "The driver's exact email." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed after seeing the warning." },
    },
    required: ["email"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "remove transportation drivers");
    const email = String(args?.email || "").trim();
    if (!email) {
      return { status: "needs_info", message: "I need the driver's exact email." };
    }

    try {
      const result = await callWriteApi("/internal/api/transportation/drivers/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        email,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Transportation",
        recordType: "driver",
        recordLabel: result.name || email,
        description: `Removed driver "${result.name || email}" from the transportation roster via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      throw error;
    }
  },
};
