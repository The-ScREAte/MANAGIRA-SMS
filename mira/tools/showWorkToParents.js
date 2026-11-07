const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "show_work_to_parents",
  description: "Show a test or homework question set on the parent portal (or stop showing it), with notes to help parents help their child. Parents only ever see what their child can already see, and never the answers. Use list_question_sets to find the id. Attaching files is done on the question set's page.",
  parameters: { type: "object", properties: { questionSetId: { type: "integer" }, show: { type: "boolean" }, notes: { type: "string", description: "Recommendations for parents. Leave out to keep what is there." } }, required: ["questionSetId", "show"] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "show work to parents");
    const result = await callWriteApi("/internal/api/parent-help/show", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      userName: tenant.displayName,
      questionSetId: args?.questionSetId,
      show: args?.show,
      notes: args?.notes,
    });
    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessments",
      recordType: "show_work_to_parents",
      recordLabel: String(result.title || args?.questionSetId || ""),
      description: "show_work_to_parents through Mira.",
    });
    return result;
  },
};
