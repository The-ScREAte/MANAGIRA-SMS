const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "generate_report_pdf",
  description:
    "Generate a student's report card as a real PDF (Terminal Report) and get a download link - the exact same report the real print page produces, " +
    "already reflecting whatever grading scale/promotion/display settings are configured (see the Report Settings tools). Give one or more studentNames, " +
    "or allInClass:true for everyone (max 10 per call - ask again for more). Defaults to the org's current school year/term unless you name a different " +
    "one. This tool only generates and hands over the PDF - it doesn't change any report content or settings. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string", description: "Disambiguates termName if needed." },
      studentNames: { type: "array", items: { type: "string" } },
      allInClass: { type: "boolean", description: "Generate for every enrolled student (max 10)." },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "generate a report card PDF");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };
    if (!args?.allInClass && (!args?.studentNames || !args.studentNames.length)) {
      return { status: "needs_info", message: "I need studentNames, or allInClass: true." };
    }

    try {
      const result = await callWriteApi("/internal/api/reports/generate", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        className: args.className,
        termName: args.termName,
        schoolYearLabel: args.schoolYearLabel,
        studentNames: args.studentNames,
        allInClass: args.allInClass === true,
      });

      for (const r of result.reports || []) {
        await logMiraActivity(tenant, {
          actionType: "Generated",
          moduleName: "Report Cards",
          recordType: "report_card_pdf",
          recordLabel: `${r.studentName} - ${result.termName}`,
          description: `Generated a report card PDF for ${r.studentName} (${result.className}, ${result.termName}) via Mira (AI assistant).`,
        });
      }

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
