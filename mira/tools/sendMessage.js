const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "send_message",
  description:
    "Send a message to guardians through the Mailroom (email, text/SMS or WhatsApp) - e.g. all guardians, the guardians of certain classes, or of " +
    "certain students. Uses the Mailroom's contacts and access rules (staff limited to some classes only reach those guardians) and appears in " +
    "Mailroom history. Only channels the school has turned on work (email always). Call WITHOUT confirm first and show the user the exact message, " +
    "who it goes to and the counts; send only after their explicit yes, by calling again with the same arguments and confirm=true. For report cards " +
    "use post_or_send_report_cards instead. Needs the Mailroom permission.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The exact message text guardians will receive." },
      channels: { type: "array", items: { type: "string", enum: ["email", "sms", "whatsapp"] } },
      allGuardians: { type: "boolean", description: "Every guardian the user can reach." },
      classNames: { type: "array", items: { type: "string" }, description: "Guardians of students in these classes." },
      studentNames: { type: "array", items: { type: "string" }, description: "Guardians of these students." },
      guardianNames: { type: "array", items: { type: "string" }, description: "These guardians by name." },
      emailSubject: { type: "string", description: "Optional email subject." },
      confirm: { type: "boolean" },
    },
    required: ["message", "channels"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "send messages");
    try {
      const result = await callWriteApi("/internal/api/messages/send", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        message: args?.message,
        channels: args?.channels,
        emailSubject: args?.emailSubject,
        audience: {
          all: args?.allGuardians === true,
          classNames: args?.classNames,
          studentNames: args?.studentNames,
          guardianNames: args?.guardianNames,
        },
        confirm: args?.confirm === true,
      });
      if (result.status === "confirmation_required") return { status: "confirm", ...result };

      await logMiraActivity(tenant, {
        actionType: "Sent",
        moduleName: "Mailroom",
        recordType: "mailroom_message",
        recordLabel: String(args.message).slice(0, 60),
        description: `${result.message} (via Mira, AI assistant)`,
      });
      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if ([400, 404, 409].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
