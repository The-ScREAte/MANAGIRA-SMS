const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_attempt_for_grading",
  description: "Load one student's attempt on a test's question set - each question, their answer, and current awarded marks - for manual grading. Use before save_attempt_grade.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string" },
      studentName: { type: "string" },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: ["className", "subjectName", "testTitle", "studentName"],
  },
  async handler(args, tenant) {
    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    const studentName = String(args?.studentName || "").trim();
    if (!className || !subjectName || !testTitle || !studentName) {
      return { status: "needs_info", message: "I need the class, subject, test name, and student name." };
    }
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), className, subjectName, testTitle, studentName });
    if (args?.termName) params.set("termName", String(args.termName).trim());
    if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
    return callInternalApi(`/internal/api/assessments/question-sets/grade?${params.toString()}`);
  },
};
