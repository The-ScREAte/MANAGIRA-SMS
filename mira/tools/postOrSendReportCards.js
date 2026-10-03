const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "post_or_send_report_cards",
  description:
    "Post report cards to the parent portal and/or send them to guardians - the same as the website's Post Report and Send Report. " +
    "post:true publishes them on the parent portal (freshly generated; guardians get a portal notification and a 'report card ready' email). " +
    "channels sends them directly: email attaches the PDF; sms/whatsapp send a link to the report card. Only channels the school has turned on " +
    "work (email always). BEFORE calling, if the user hasn't said, ask: should it be posted to the parent portal as well, or just sent - and by " +
    "which channel. Then call WITHOUT confirm to get the preview (who gets what, students with no contact) and show it; only after the user's " +
    "explicit yes, call again with the same arguments and confirm=true. Give studentNames or allInClass:true. Defaults to the current term. " +
    "Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      studentNames: { type: "array", items: { type: "string" } },
      allInClass: { type: "boolean", description: "Every student enrolled in the class this term." },
      post: { type: "boolean", description: "Publish to the parent portal." },
      channels: { type: "array", items: { type: "string", enum: ["email", "sms", "whatsapp"] }, description: "Send directly by these channels. Omit for post-only." },
      message: { type: "string", description: "Optional custom text for sms/whatsapp; the report link is added automatically." },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "post or send report cards");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };
    if (args.post !== true && !(args.channels || []).length) {
      return { status: "needs_info", message: "Ask whether to post the report cards to the parent portal as well, or just send them - and by email, text or WhatsApp." };
    }

    try {
      const result = await callWriteApi("/internal/api/reports/send", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        className: args.className,
        studentNames: args.studentNames,
        allInClass: args.allInClass === true,
        post: args.post === true,
        channels: args.channels,
        message: args.message,
        termName: args.termName,
        schoolYearLabel: args.schoolYearLabel,
        confirm: args.confirm === true,
      });

      if (result.status === "confirmation_required") return { status: "confirm", ...result };

      const actions = [result.posting?.started ? "posted to the parent portal" : null, result.sent ? `sent (${Object.entries(result.sent).map(([c, n]) => `${c}: ${n}`).join(", ")})` : null].filter(Boolean).join(" and ");
      await logMiraActivity(tenant, {
        actionType: "Sent",
        moduleName: "Report Cards",
        recordType: "report_card_send",
        recordLabel: `${result.className} - ${result.termName}`,
        description: `Report cards for ${result.studentCount} student(s) in ${result.className} (${result.termName}) ${actions || "processed"} via Mira (AI assistant).`,
      });
      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if ([400, 404, 409, 502].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
