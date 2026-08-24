const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_test_questions",
  description:
    "Create or replace a test's question set (\"Set Questions\"). Always give the FULL question list (replaces the whole set, not a partial edit). BLOCKED if a student already has an attempt on the existing set. New/edited sets go to 'pending' review. Never invent question text/options/answers.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string", description: "Exact existing test name (create with create_test first if needed)." },
      setTitle: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            questionType: { type: "string", enum: ["multiple_choice", "single_choice", "true_false", "short_text", "essay"] },
            questionText: { type: "string" },
            options: { type: "array", items: { type: "string" }, description: "Choice types only." },
            answerKey: { type: "string" },
            marks: { type: "number" },
          },
          required: ["questionText", "marks"],
        },
      },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
      openBook: { type: "boolean" },
      timeLimitMinutes: { type: "number" },
      maxAttempts: { type: "number", description: "Default 1." },
    },
    required: ["className", "subjectName", "testTitle", "setTitle", "questions"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "set test questions");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    const setTitle = String(args?.setTitle || "").trim();
    const questions = Array.isArray(args?.questions) ? args.questions : [];
    if (!className || !subjectName || !testTitle || !setTitle || !questions.length) {
      return { status: "needs_info", message: "I need the class, subject, test name, a set title, and at least one question." };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/set", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className,
      subjectName,
      testTitle,
      setTitle,
      questions,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
      openBook: args?.openBook,
      timeLimitMinutes: args?.timeLimitMinutes,
      maxAttempts: args?.maxAttempts,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessment Questions",
      recordType: "question_set",
      recordId: String(result.questionSetId),
      recordLabel: `${setTitle} (${testTitle})`,
      description: `Set ${result.questionCount} question(s) for test "${testTitle}" (${subjectName}, ${className}) via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
