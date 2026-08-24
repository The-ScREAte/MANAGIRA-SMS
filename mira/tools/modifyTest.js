const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "modify_test",
  description:
    "Modify an existing test's details - name, weight, max score, and/or category. Needs Manage Assessments and the test's exact current name. " +
    "Only changes what's given; anything omitted stays as-is. Does NOT change which classes/subjects the test is assigned to, its lock/active status, or its date window - use set_test_status or set_test_date_window for those, or the Manage Assessments page for reassigning classes/subjects.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The test's exact current name." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Optional school year label (e.g. \"2026-2027\") to disambiguate if termName is reused across multiple years." },
      newTestName: { type: "string" },
      testWeight: { type: "number" },
      maxScore: { type: "number" },
      category: { type: "string", enum: ["Class Assessment", "Exams Assessment", "Other"] },
    },
    required: ["title"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "modify tests");

    const title = String(args?.title || "").trim();
    if (!title) {
      return { status: "needs_info", message: "I need the test's exact current name to modify it." };
    }

    const result = await callWriteApi("/internal/api/assessments/modify", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      title,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
      newTestName: args?.newTestName,
      testWeight: args?.testWeight,
      maxScore: args?.maxScore,
      category: args?.category,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessments",
      recordType: "test",
      recordId: String(result.groupId),
      recordLabel: result.newTitle,
      description: `Modified test "${result.oldTitle}"${result.newTitle !== result.oldTitle ? ` (renamed to "${result.newTitle}")` : ""} via Mira (AI assistant).`,
      changedFields: result.newTitle !== result.oldTitle ? [{ field: "title", from: result.oldTitle, to: result.newTitle }] : [],
    });

    return { status: "done", ...result };
  },
};
