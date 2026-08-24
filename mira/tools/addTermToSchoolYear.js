const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "add_term_to_school_year",
  description:
    "Add one new term to an EXISTING school year. Requires an admin-level role, the exact school year label, and the new term's name, start date, and end date (YYYY-MM-DD). " +
    "Its dates must not overlap any term already in that year. Never guess dates the user hasn't given you.",
  parameters: {
    type: "object",
    properties: {
      yearLabel: { type: "string", description: "Exact label of the school year to add the term to, e.g. \"2026-2027\"." },
      termName: { type: "string" },
      startDate: { type: "string", description: "YYYY-MM-DD" },
      endDate: { type: "string", description: "YYYY-MM-DD" },
    },
    required: ["yearLabel", "termName", "startDate", "endDate"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "add terms");

    const yearLabel = String(args?.yearLabel || "").trim();
    const termName = String(args?.termName || "").trim();
    if (!yearLabel || !termName || !args?.startDate || !args?.endDate) {
      return { status: "needs_info", message: "I need the school year label, and the new term's name, start date, and end date." };
    }

    const result = await callWriteApi("/internal/api/school-years/terms/add", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      yearLabel,
      termName,
      startDate: args.startDate,
      endDate: args.endDate,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "School Years",
      recordType: "term",
      recordId: String(result.term.term_id),
      recordLabel: `${result.term.term_name} (${result.yearLabel})`,
      description: `Added term "${result.term.term_name}" to school year "${result.yearLabel}" via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
