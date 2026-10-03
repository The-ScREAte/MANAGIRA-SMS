const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "generate_report_pdf",
  description:
    "Generate students' report cards as PDFs (Terminal Report) with download links - always freshly generated from the website's own report page, so " +
    "they show the latest scores, grading scale, positions and display settings, in the school's colours. Give one or more studentNames, or " +
    "allInClass:true (max 10 per call - offer to continue for more). Defaults to the current school year/term. This only creates download links: it " +
    "does NOT post the report to parents or change anything. Needs Manage Reports.",
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
