const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_school_year",
  description:
    "Create a new School Year record with its terms, matching the \"+ Create School Year\" button on Manage Records. Requires an admin-level role, " +
    "the year label (format YYYY-YYYY, consecutive years), and at least one term with a name, start date, and end date (YYYY-MM-DD). " +
    "Never invent term names or dates the user hasn't given you - ask for whatever is missing. Term date ranges must not overlap.",
  parameters: {
    type: "object",
    properties: {
      yearLabel: { type: "string", description: "e.g. \"2026-2027\"." },
      terms: {
        type: "array",
        description: "At least one term.",
        items: {
          type: "object",
          properties: {
            termName: { type: "string" },
            startDate: { type: "string", description: "YYYY-MM-DD" },
            endDate: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["termName", "startDate", "endDate"],
        },
      },
    },
    required: ["yearLabel", "terms"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create school years");

    const yearLabel = String(args?.yearLabel || "").trim();
    const terms = Array.isArray(args?.terms) ? args.terms : [];
    if (!yearLabel || !terms.length) {
      return { status: "needs_info", message: "I need the school year label (e.g. \"2026-2027\") and at least one term (name, start date, end date) to create it." };
    }

    const result = await callWriteApi("/internal/api/school-years/create", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      yearLabel,
      terms,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "School Years",
      recordType: "school_year",
      recordId: String(result.id),
      recordLabel: result.yearLabel,
      description: `Created school year "${result.yearLabel}" with ${result.terms.length} term${result.terms.length === 1 ? "" : "s"} (${result.terms.map((t) => t.term_name).join(", ")}) via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
