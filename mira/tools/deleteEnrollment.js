const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_enrollment",
  description:
    "Delete the entire enrollment (all open classes and student assignments) for one school year/term. DESTRUCTIVE and PERMANENT. Needs Manage Students. " +
    "Attendance, scores, and other records are unaffected - only class assignments for that term are removed. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete enrollments");

    try {
      const result = await callWriteApi("/internal/api/enrollment/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        termName: args?.termName,
        yearLabel: args?.yearLabel,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return result;
      }

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Enrollment",
        recordType: "enrollment",
        recordLabel: `${result.yearLabel} - ${result.termName}`,
        description: `Deleted the enrollment for ${result.yearLabel} - ${result.termName} (${result.classCount} class(es), ${result.studentCount} student(s)) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) {
        return { status: "not_found", message: error.message };
      }
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "Enrollment",
        recordType: "enrollment",
        recordLabel: `${args?.yearLabel || ""} ${args?.termName || ""}`.trim() || "current term",
        description: `Mira (AI assistant) attempted to delete an enrollment but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
