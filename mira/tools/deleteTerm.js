const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_term",
  description:
    "Delete a single term from a school year. DESTRUCTIVE and PERMANENT. Needs Manage School Years & Terms. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      yearLabel: { type: "string", description: "Exact school year label the term belongs to, e.g. \"2026-2027\"." },
      termName: { type: "string", description: "Exact term name, e.g. \"Term 1\"." },
      confirm: {
        type: "boolean",
        description: "false/omitted on the first call to fetch the warning. Set true on the very next call once the user has given any clear yes/go-ahead.",
      },
    },
    required: ["yearLabel", "termName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete terms");

    const yearLabel = String(args?.yearLabel || "").trim();
    const termName = String(args?.termName || "").trim();
    if (!yearLabel || !termName) {
      return { status: "needs_info", message: "I need the exact school year label and the exact term name to delete it." };
    }

    if (args?.confirm !== true) {
      return {
        status: "confirmation_required",
        yearLabel,
        termName,
        warning:
          `Deleting the term "${termName}" from school year "${yearLabel}" is permanent and cannot be undone. ` +
          `If a school year would be left with zero terms, or if classes, enrollments, attendance, or exam records are still linked to this term, the deletion will be blocked. ` +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/school-years/terms/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
      userEmail: tenant.userEmail,
        yearLabel,
        termName,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "School Years",
        recordType: "term",
        recordId: String(result.termId),
        recordLabel: `${result.termName} (${result.yearLabel})`,
        description: `Deleted term "${result.termName}" from school year "${result.yearLabel}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "School Years",
        recordType: "term",
        recordLabel: `${termName} (${yearLabel})`,
        description: `Mira (AI assistant) attempted to delete term "${termName}" from "${yearLabel}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
