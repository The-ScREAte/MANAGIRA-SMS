const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_school_announcement",
  description:
    "Edit an existing announcement's text or visibility. Needs Publish Events & Announcements. Identify it by a distinctive snippet of its current text (use get/list_school_announcements first if unsure) - ambiguous if more than one matches. " +
    "Setting notifyByEmail sends a REAL email to guardians right away - needs explicit confirmation first; without it this runs immediately.",
  parameters: {
    type: "object",
    properties: {
      currentText: { type: "string", description: "A distinctive snippet of the announcement's current text." },
      newMessage: { type: "string", description: "New full text, if changing it." },
      visibility: { type: "string", enum: ["org", "public", "both"] },
      notifyByEmail: { type: "boolean", description: "Sends a real email to guardians immediately. Defaults to false." },
      confirm: { type: "boolean", description: "Only needed (and only checked) when notifyByEmail is true." },
    },
    required: ["currentText"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit announcements");
    const currentText = String(args?.currentText || "").trim();
    if (!currentText) {
      return { status: "needs_info", message: "I need a snippet of the announcement's current text to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/school-announcements/update", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        currentText,
        newMessage: args?.newMessage,
        visibility: args?.visibility,
        notifyByEmail: args?.notifyByEmail === true,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Events & Announcements",
        recordType: "announcement",
        recordLabel: result.message.slice(0, 80),
        description: `Updated an announcement via Mira (AI assistant).`,
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
