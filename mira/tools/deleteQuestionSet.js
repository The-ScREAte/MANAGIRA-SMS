const { callInternalApi } = require("../internalApiClient");
const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_question_set",
  description:
    "Delete a test's question set. DESTRUCTIVE and PERMANENT; BLOCKED if any student has an attempt on it. Needs Manage Assessments + Set Assessment Questions. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string" },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["className", "subjectName", "testTitle"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete question sets");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    if (!className || !subjectName || !testTitle) {
      return { status: "needs_info", message: "I need the class, subject, and test name to delete its question set." };
    }

    if (args?.confirm !== true) {
      const params = new URLSearchParams({ organizationId: String(tenant.organizationId), className, subjectName, testTitle });
      if (args?.termName) params.set("termName", String(args.termName).trim());
      if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
      let impact;
      try {
        impact = await callInternalApi(`/internal/api/assessments/question-sets/delete-impact?${params.toString()}`);
      } catch (error) {
        return { status: "not_found", message: error.message };
      }
      return {
        status: "confirmation_required",
        setTitle: impact.setTitle,
        attemptCount: impact.attemptCount,
        warning:
          `Deleting the question set "${impact.setTitle}" for "${testTitle}" is permanent and cannot be undone. ` +
          (impact.attemptCount > 0
            ? `${impact.attemptCount} student attempt${impact.attemptCount === 1 ? " has" : "s have"} already been made on it - the deletion will be BLOCKED until those are resolved, so nothing will be lost by mistake. `
            : "No student attempts have been made on it yet. ") +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/assessments/question-sets/delete", {
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
        actionType: "Deleted",
        moduleName: "Assessment Questions",
        recordType: "question_set",
        recordId: String(result.questionSetId),
        recordLabel: `${result.setTitle} (${testTitle})`,
        description: `Deleted question set "${result.setTitle}" for test "${testTitle}" (${subjectName}, ${className}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "Assessment Questions",
        recordType: "question_set",
        recordLabel: `${testTitle} (${subjectName}, ${className})`,
        description: `Mira (AI assistant) attempted to delete the question set for "${testTitle}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
