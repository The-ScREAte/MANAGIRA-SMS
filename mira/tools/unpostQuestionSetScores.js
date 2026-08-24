const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "unpost_question_set_scores",
  description:
    "Remove all posted scores for a test's question set from the gradebook (they no longer show on the subject dashboard, but the attempts/answers themselves are kept), matching the \"Unpost Scores\" action. Needs Manage Assessments + Set Assessment Questions.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string" },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: ["className", "subjectName", "testTitle"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "unpost scores");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    if (!className || !subjectName || !testTitle) {
      return { status: "needs_info", message: "I need the class, subject, and test name to unpost scores." };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/unpost-scores", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className,
      subjectName,
      testTitle,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessment Questions",
      recordType: "question_set_scores",
      recordLabel: `${testTitle} (${subjectName}, ${className})`,
      description: `Unposted ${result.count} score(s) for test "${testTitle}" (${subjectName}, ${className}) via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
