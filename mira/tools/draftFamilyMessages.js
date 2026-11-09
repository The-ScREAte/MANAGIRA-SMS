// One message draft per family, ready for the person to review - nothing is
// sent. Each draft goes through the Mailroom's own preview (its directory and
// access rules: staff limited to some classes only reach those families), so
// the recipients shown are exactly who a send would reach. Sending is
// send_message with confirm=true, after the person's yes.
// Feature: mira_outreach (services/access.js).
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

const MAX_FAMILIES = 25;

module.exports = {
  name: "draft_family_messages",
  description:
    "Prepare a separate message draft for the family of each listed student (up to 25), for the user to review. Nothing is sent. Write one warm, " +
    "professional message and put {student} where each student's name goes. Sign it with only the sender's own name and the school's name (from the conversation) - never a job title they didn't give, and never a placeholder like [Your Name]. Each draft is checked against the Mailroom: who would receive it, by " +
    "which channel, and any family with no contact on file. To send after the user's explicit yes, call send_message for each draft with its " +
    "sendWith values and confirm=true. Needs the Mailroom permission.",
  parameters: {
    type: "object",
    properties: {
      studentNames: { type: "array", items: { type: "string" }, description: "Students' names exactly as Managira shows them (e.g. from find_low_attendance)." },
      message: { type: "string", description: "The message, with {student} where the student's name goes." },
      channels: { type: "array", items: { type: "string", enum: ["email", "sms", "whatsapp"] }, description: "Default email." },
      emailSubject: { type: "string" },
    },
    required: ["studentNames", "message"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "draft messages to families");
    const names = [...new Set((Array.isArray(args?.studentNames) ? args.studentNames : []).map((name) => String(name || "").trim()).filter(Boolean))];
    // Never a "[Your Name]" left for a parent to read: the sender's name and school go in.
    const template = String(args?.message || "").trim()
      .replace(/\[(?:your|sender'?s?|teacher'?s?|staff) name\]/gi, tenant.displayName || "")
      .replace(/\[(?:school|school's|organi[sz]ation) name\]/gi, tenant.organizationName || "");
    if (!names.length) return { status: "needs_info", message: "Which students' families should I write to?" };
    if (!template) return { status: "needs_info", message: "What should the message say?" };
    if (names.length > MAX_FAMILIES) return { status: "needs_info", message: `That's ${names.length} families. I can prepare up to ${MAX_FAMILIES} drafts at a time - narrow it down, or send one message to everyone with send_message.` };
    const channels = Array.isArray(args?.channels) && args.channels.length ? args.channels : ["email"];

    const drafts = [];
    const notReached = [];
    for (const name of names) {
      const message = template.replace(/\{student\}/gi, name);
      try {
        const preview = await callWriteApi("/internal/api/messages/send", {
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          userRole: tenant.userRole,
          accountType: tenant.accountType,
          userEmail: tenant.userEmail,
          message,
          channels,
          emailSubject: args?.emailSubject,
          audience: { studentNames: [name] },
          confirm: false,
        });
        drafts.push({
          student: name,
          to: preview.sample || [],
          channels: preview.perChannel || [],
          message,
          sendWith: { studentNames: [name], message, channels, emailSubject: args?.emailSubject || undefined },
        });
      } catch (error) {
        if (error.denied) throw error;
        if ([400, 404, 409].includes(error.status)) { notReached.push({ student: name, reason: error.message }); continue; }
        throw error;
      }
    }

    return {
      status: "drafted",
      draftCount: drafts.length,
      drafts,
      notReached,
      note: "Drafts only - nothing has been sent. Show every draft (who it goes to and the message) for review. Send only after an explicit yes, with send_message and each draft's sendWith plus confirm=true.",
      reply: drafts.length
        ? `Start your answer with: "Done. ${drafts.length} draft${drafts.length === 1 ? " is" : "s are"} ready for your review." Then show each draft, mention anyone not reached, and ask whether to send them. Call no other tool.`
        : "Say that no family could be reached through the Mailroom, and why.",
    };
  },
};
