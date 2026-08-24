const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "review_question_set",
  description: "Approve or reject a pending question set. Needs Manage Assessments + Set Assessment Questions.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string" },
      action: { type: "string", enum: ["approve", "reject"] },
      reviewNote: { type: "string", description: "Optional note, especially useful when rejecting." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: ["className", "subjectName", "testTitle", "action"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "review question sets");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    const action = String(args?.action || "").trim().toLowerCase();
    if (!className || !subjectName || !testTitle || !["approve", "reject"].includes(action)) {
      return { status: "needs_info", message: "I need the class, subject, test name, and whether to approve or reject." };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/review", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className,
      subjectName,
      testTitle,
      action,
      reviewNote: args?.reviewNote,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessment Questions",
      recordType: "question_set",
      recordId: String(result.questionSetId),
      recordLabel: `${result.setTitle} (${testTitle})`,
      description: `${action === "approve" ? "Approved" : "Rejected"} question set "${result.setTitle}" for test "${testTitle}" via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
