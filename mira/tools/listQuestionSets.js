const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_question_sets",
  description:
    "List question sets and how many questions each has. Omit className/subjectName for a TERM-WIDE overview - every question set that exists, with its test/class/subject, question count, and total marks (use this for \"how many questions do we have set overall / across everything\"). " +
    "Give className AND subjectName (optionally testTitle too) instead to get the FULL question content - text, options, and answer keys - for one specific set, which doubles as previewing it for the user.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "Omit for the term-wide overview." },
      subjectName: { type: "string", description: "Omit for the term-wide overview." },
      testTitle: { type: "string", description: "Optional, only used together with className+subjectName." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
  },
  async handler(args, tenant) {
    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();

    if (!className && !subjectName) {
      const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
      if (args?.termName) params.set("termName", String(args.termName).trim());
      if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
      return callInternalApi(`/internal/api/assessments/question-sets/overview?${params.toString()}`);
    }

    if (!className || !subjectName) {
      return { status: "needs_info", message: "I need both the class and subject to look up one specific question set - or omit both for a term-wide overview." };
    }
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), className, subjectName });
    if (args?.testTitle) params.set("testTitle", String(args.testTitle).trim());
    if (args?.termName) params.set("termName", String(args.termName).trim());
    if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
    return callInternalApi(`/internal/api/assessments/question-sets?${params.toString()}`);
  },
};
