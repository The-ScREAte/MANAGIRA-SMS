const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_test_date_window",
  description:
    "Set or clear when score entry opens/closes for a test - the edit window. Needs Manage Assessments and the test's exact name. " +
    "Pass an empty string for editWindowStart/editWindowEnd to clear that bound (leaving it open-ended); omit a field to leave it unchanged. Never guess dates the user hasn't given you.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The test's exact name." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Optional school year label (e.g. \"2026-2027\") to disambiguate if termName is reused across multiple years." },
      editWindowStart: { type: "string", description: "ISO datetime when score entry opens, or \"\" to clear." },
      editWindowEnd: { type: "string", description: "ISO datetime when score entry closes, or \"\" to clear." },
    },
    required: ["title"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "set test date windows");

    const title = String(args?.title || "").trim();
    if (!title || (args?.editWindowStart == null && args?.editWindowEnd == null)) {
      return { status: "needs_info", message: "I need the test's exact name and at least one of a start or end date/time for its edit window." };
    }

    const result = await callWriteApi("/internal/api/assessments/date-window", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      title,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
      editWindowStart: args?.editWindowStart,
      editWindowEnd: args?.editWindowEnd,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessments",
      recordType: "test",
      recordId: String(result.groupId),
      recordLabel: result.title,
      description: `Set edit window for test "${result.title}" (start: ${result.editWindowStart || "none"}, end: ${result.editWindowEnd || "none"}) via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
