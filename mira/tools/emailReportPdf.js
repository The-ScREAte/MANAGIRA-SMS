const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "email_report_pdf",
  description:
    "Email a student's report card PDF (real attachment, not just a link) to their guardian(s) on file. Defaults to the org's current school year/term " +
    "unless you name a different one. Call once without confirm to see who it would go to, then again with confirm=true after the user explicitly " +
    "agrees. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      studentName: { type: "string" },
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["studentName", "className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "email a report card");
    if (!args?.studentName) return { status: "needs_info", message: "I need which student." };
    if (!args?.className) return { status: "needs_info", message: "I need which class." };

    try {
      const result = await callWriteApi("/internal/api/reports/email", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        studentName: args.studentName,
        className: args.className,
        termName: args.termName,
        schoolYearLabel: args.schoolYearLabel,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return { status: "confirm", message: result.warning, studentName: result.studentName, guardianEmails: result.guardianEmails };
      }

      await logMiraActivity(tenant, {
        actionType: "Sent",
        moduleName: "Report Cards",
        recordType: "report_card_email",
        recordLabel: `${result.studentName} - ${result.termName}`,
        description: `Emailed ${result.studentName}'s report card (${result.className}, ${result.termName}) to ${result.sentTo?.join(", ")} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "needs_info", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      if (error.status === 502) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
