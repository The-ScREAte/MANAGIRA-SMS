const { callInternalApi } = require("../internalApiClient");
const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_test",
  description:
    "Delete a test/assessment. DESTRUCTIVE and PERMANENT; BLOCKED if any student scores exist for it. Needs Manage Assessments. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The test's exact name." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Optional school year label (e.g. \"2026-2027\") to disambiguate if termName is reused across multiple years." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["title"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete tests");

    const title = String(args?.title || "").trim();
    if (!title) {
      return { status: "needs_info", message: "I need the test's exact name to delete it." };
    }

    if (args?.confirm !== true) {
      const params = new URLSearchParams({ organizationId: String(tenant.organizationId), title });
      if (args?.termName) params.set("termName", String(args.termName).trim());
      if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
      let impact;
      try {
        impact = await callInternalApi(`/internal/api/assessments/delete-impact?${params.toString()}`);
      } catch (error) {
        return { status: "not_found", message: error.message };
      }

      return {
        status: "confirmation_required",
        title: impact.title,
        classCount: impact.classCount,
        scoreCount: impact.scoreCount,
        warning:
          `Deleting the test "${impact.title}" is permanent and cannot be undone. It's assigned to ${impact.classCount} class${impact.classCount === 1 ? "" : "es"}. ` +
          (impact.scoreCount > 0
            ? `It already has ${impact.scoreCount} student score${impact.scoreCount === 1 ? "" : "s"} entered - the deletion will be BLOCKED until those are removed, so nothing will be lost by mistake. `
            : "No student scores have been entered for it yet. ") +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/assessments/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
      userEmail: tenant.userEmail,
        title,
        termName: args?.termName,
        yearLabel: args?.yearLabel,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Assessments",
        recordType: "test",
        recordId: String(result.groupId),
        recordLabel: result.title,
        description: `Deleted test "${result.title}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "Assessments",
        recordType: "test",
        recordLabel: title,
        description: `Mira (AI assistant) attempted to delete test "${title}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
