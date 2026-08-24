const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_question_set_students",
  description: "List every enrolled student's attempt status for a test's question set - started/submitted, locked, posted, and score. Use this before posting/unposting scores, locking/unlocking a student, or grading.",
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
    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    if (!className || !subjectName || !testTitle) {
      return { status: "needs_info", message: "I need the class, subject, and test name." };
    }
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), className, subjectName, testTitle });
    if (args?.termName) params.set("termName", String(args.termName).trim());
    if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
    return callInternalApi(`/internal/api/assessments/question-sets/students?${params.toString()}`);
  },
};
