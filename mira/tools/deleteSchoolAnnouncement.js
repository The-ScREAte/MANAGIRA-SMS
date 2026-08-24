const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_school_announcement",
  description:
    "Delete an announcement. DESTRUCTIVE and PERMANENT. Needs Publish Events & Announcements. Identify it by a distinctive snippet of its text - ambiguous if more than one matches. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      currentText: { type: "string", description: "A distinctive snippet of the announcement's text." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["currentText"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete announcements");
    const currentText = String(args?.currentText || "").trim();
    if (!currentText) {
      return { status: "needs_info", message: "I need a snippet of the announcement's text to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/school-announcements/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        currentText,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Events & Announcements",
        recordType: "announcement",
        recordLabel: result.message.slice(0, 80),
        description: `Deleted an announcement via Mira (AI assistant).`,
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
