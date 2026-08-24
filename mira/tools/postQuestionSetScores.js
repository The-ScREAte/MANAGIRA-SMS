const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "post_question_set_scores",
  description:
    "Publish all pending submitted-and-graded attempts for a test's question set into the gradebook (subject dashboard), matching the \"Post Scores\" action. Needs Manage Assessments + Set Assessment Questions. Reversible via unpost_question_set_scores.",
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
    assertIsStaff(tenant, "post scores");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    if (!className || !subjectName || !testTitle) {
      return { status: "needs_info", message: "I need the class, subject, and test name to post scores." };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/post-scores", {
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
      description: `Posted ${result.count} score(s) for test "${testTitle}" (${subjectName}, ${className}) via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
