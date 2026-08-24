const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_employee_hold",
  description:
    "Put a staff account on hold, or resume one already on hold. Needs Manage Employees. Notifies the employee by email and in-app. " +
    "Identify the employee by exact email (preferred) or full name. You can't put your own account on hold this way. " +
    "Putting someone ON hold needs explicit confirmation first (call with confirm omitted/false to get the warning, then confirm=true after the user clearly agrees); resuming someone is safe and runs immediately.",
  parameters: {
    type: "object",
    properties: {
      email: { type: "string", description: "The employee's exact email - preferred over name." },
      name: { type: "string", description: "Full name, only if email isn't known. Ambiguous if more than one match." },
      hold: { type: "boolean", description: "true = put on hold, false = resume." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed putting someone ON hold." },
    },
    required: ["hold"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change an employee's hold status");

    const email = String(args?.email || "").trim();
    const name = String(args?.name || "").trim();
    if (!email && !name) {
      return { status: "needs_info", message: "I need the employee's exact email (preferred) or full name." };
    }

    try {
      const result = await callWriteApi("/internal/api/employees/set-hold", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        email: email || undefined,
        name: name || undefined,
        hold: args.hold === true,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required" || result.status === "no_change") {
        return result;
      }

      await logMiraActivity(tenant, {
        actionType: result.onHold ? "Held" : "Resumed",
        moduleName: "Employees",
        recordType: "employee",
        recordId: String(result.userId),
        recordLabel: result.name,
        description: `${result.onHold ? "Put" : "Resumed"} "${result.name}" (${result.email}) ${result.onHold ? "on hold" : "from hold"} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) {
        return { status: "not_found", message: error.message };
      }
      if (error.status === 409) {
        return { status: "ambiguous", message: error.message };
      }
      if (error.status === 422) {
        return { status: "blocked", message: error.message };
      }
      throw error;
    }
  },
};
