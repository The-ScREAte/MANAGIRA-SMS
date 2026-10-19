const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_test",
  description:
    "Create a new test/assessment (\"+ New Test\"). Needs Manage Assessments. " +
    "Needs: name, weight, max score, category (Class Assessment/Exams Assessment/Other), subject, and 1+ class (subject must already be assigned to it - check list_subjects or use create_subject/assign_subject_to_classes first). " +
    "Never invent weight, max score, or category. " +
    "Results can be a score (default) or a choice: set entryMode 'choice' with choiceOptions such as [{label:'Yes',points:1},{label:'No',points:0}] " +
    "(points make the choice count in totals; leave points out of every choice to keep it out of totals, then weight and max score aren't needed).",
  parameters: {
    type: "object",
    properties: {
      testName: { type: "string" },
      testWeight: { type: "number", description: "e.g. 20 for 20%." },
      maxScore: { type: "number" },
      category: { type: "string", enum: ["Class Assessment", "Exams Assessment", "Other"] },
      subjectName: { type: "string" },
      classNames: { type: "array", items: { type: "string" }, description: "Must be enrolled in the term." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
      editWindowStart: { type: "string", description: "ISO datetime - score entry opens." },
      editWindowEnd: { type: "string", description: "ISO datetime - score entry closes." },
      isLocked: { type: "boolean", description: "Default false." },
      notifyTeachers: { type: "boolean", description: "Default false." },
      entryMode: { type: "string", enum: ["score", "choice"], description: "How results are recorded. Default score." },
      choiceOptions: {
        type: "array",
        description: "For entryMode 'choice': 2-10 choices the teacher picks from. Give every choice points, or none.",
        items: {
          type: "object",
          properties: { label: { type: "string" }, points: { type: "number" } },
          required: ["label"],
        },
      },
    },
    required: ["testName", "category", "subjectName", "classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create tests");

    const testName = String(args?.testName || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const classNames = Array.isArray(args?.classNames) ? args.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    const isChoice = String(args?.entryMode || "").toLowerCase() === "choice";
    const choicesHavePoints = isChoice && Array.isArray(args?.choiceOptions) && args.choiceOptions.some((c) => c && c.points != null);
    const needsNumbers = !isChoice || choicesHavePoints;
    if (!testName || (needsNumbers && args?.testWeight == null) || (!isChoice && args?.maxScore == null) || !args?.category || !subjectName || !classNames.length) {
      return { status: "needs_info", message: "I need the test name, weight, max score, category, subject, and at least one class to create it." };
    }
    if (isChoice && (!Array.isArray(args?.choiceOptions) || args.choiceOptions.length < 2)) {
      return { status: "needs_info", message: "Which choices should teachers pick from (for example Yes and No), and should each choice have points?" };
    }

    const result = await callWriteApi("/internal/api/assessments/create", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      testName,
      testWeight: args.testWeight,
      maxScore: args.maxScore,
      category: args.category,
      entryMode: isChoice ? "choice" : "score",
      choiceOptions: isChoice ? args.choiceOptions : undefined,
      subjectName,
      classNames,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
      editWindowStart: args?.editWindowStart,
      editWindowEnd: args?.editWindowEnd,
      isLocked: args?.isLocked,
      notifyTeachers: args?.notifyTeachers,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Assessments",
      recordType: "test",
      recordLabel: result.testName,
      description: `Created test "${result.testName}" (${args.category}, weight ${args.testWeight}, max score ${args.maxScore}) for ${result.subjectName} in ${result.classNames.join(", ")} via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
