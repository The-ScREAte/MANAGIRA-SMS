const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "save_attempt_grade",
  description:
    "Save awarded marks for a student's attempt (manual grading). Use get_attempt_for_grading first for question IDs/max marks (awarded values clamp to each question's max). Needs Manage Assessments + Set Assessment Questions. " +
    "Updates attempt score; only updates the posted gradebook score if already posted (post_question_set_scores is a separate step). Never invent marks.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string" },
      studentName: { type: "string" },
      marks: {
        type: "object",
        description: "questionId -> awarded marks, e.g. {\"123\": 4, \"124\": 0}.",
        additionalProperties: { type: "number" },
      },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: ["className", "subjectName", "testTitle", "studentName", "marks"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "grade attempts");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    const studentName = String(args?.studentName || "").trim();
    const marks = args?.marks && typeof args.marks === "object" ? args.marks : null;
    if (!className || !subjectName || !testTitle || !studentName || !marks || !Object.keys(marks).length) {
      return { status: "needs_info", message: "I need the class, subject, test name, student name, and the marks to award per question (use get_attempt_for_grading first for the question IDs)." };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/grade", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className,
      subjectName,
      testTitle,
      studentName,
      marks,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessment Questions",
      recordType: "attempt_grade",
      recordLabel: `${studentName} - ${testTitle} (${subjectName}, ${className})`,
      description: `Graded ${studentName}'s attempt on "${testTitle}" (${subjectName}, ${className}) - new score ${result.score} via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
