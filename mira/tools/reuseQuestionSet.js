const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "reuse_question_set",
  description:
    "Copy a question set to a new/existing test in a different class/subject/term (\"Reuse\"). Auto-creates the target test if needed. Needs Manage Assessments + Set Assessment Questions. Non-destructive - only creates records.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "Source class." },
      subjectName: { type: "string", description: "Source subject." },
      testTitle: { type: "string", description: "Source test's exact name." },
      termName: { type: "string", description: "Source term, defaults to current." },
      yearLabel: { type: "string", description: "Disambiguates source termName if reused across years." },
      targetClassName: { type: "string" },
      targetSubjectName: { type: "string" },
      targetTestTitle: { type: "string", description: "Name for the new/target test." },
      targetTermName: { type: "string", description: "Defaults to same term as source." },
      targetYearLabel: { type: "string", description: "Disambiguates targetTermName if reused across years." },
      shuffleMode: { type: "string", enum: ["none", "random", "reverse"], description: "Default none." },
      shuffleOptions: { type: "boolean", description: "Also shuffle answer options." },
    },
    required: ["className", "subjectName", "testTitle", "targetClassName", "targetSubjectName", "targetTestTitle"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "reuse question sets");

    const required = ["className", "subjectName", "testTitle", "targetClassName", "targetSubjectName", "targetTestTitle"];
    if (required.some((key) => !String(args?.[key] || "").trim())) {
      return { status: "needs_info", message: "I need the source (class, subject, test) and target (class, subject, new test name) to reuse a question set." };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/reuse", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className: args.className,
      subjectName: args.subjectName,
      testTitle: args.testTitle,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
      targetClassName: args.targetClassName,
      targetSubjectName: args.targetSubjectName,
      targetTestTitle: args.targetTestTitle,
      targetTermName: args?.targetTermName,
      targetYearLabel: args?.targetYearLabel,
      shuffleMode: args?.shuffleMode,
      shuffleOptions: args?.shuffleOptions,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Assessment Questions",
      recordType: "question_set",
      recordId: String(result.questionSetId),
      recordLabel: `${args.targetTestTitle} (${args.targetSubjectName}, ${args.targetClassName})`,
      description: `Reused question set from "${args.testTitle}" (${args.subjectName}, ${args.className}) into "${args.targetTestTitle}" (${args.targetSubjectName}, ${args.targetClassName}) via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
