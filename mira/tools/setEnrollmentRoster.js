const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_enrollment_roster",
  description:
    "Open/set which classes and students are enrolled for a school year/term. Needs Manage Students. " +
    "IMPORTANT: `roster` must be the COMPLETE intended list - any currently-enrolled class or student not included gets REMOVED from this term's enrollment (attendance/scores/other records are untouched, just their class assignment for this term). " +
    "Use get_enrollment_roster first to see the current state before proposing changes, so you don't accidentally drop students who should stay. " +
    "First call with confirm omitted/false to get a diff preview (what's added/removed/moved); relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
      roster: {
        type: "array",
        description: "The complete list of classes to open for this term, each with its complete student list.",
        items: {
          type: "object",
          properties: {
            className: { type: "string" },
            studentNames: { type: "array", items: { type: "string" }, description: "Full names. May be empty to open a class with no students yet." },
          },
          required: ["className", "studentNames"],
        },
      },
      confirm: {
        type: "boolean",
        description: "false/omitted on the first call to fetch the diff preview. Set true on the very next call once the user has given any clear yes/go-ahead - do not ask again before setting this.",
      },
    },
    required: ["roster"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "set enrollment rosters");

    const roster = Array.isArray(args?.roster) ? args.roster : [];
    if (!roster.length) {
      return { status: "needs_info", message: "I need the complete list of classes (and their students) to open for this term." };
    }

    try {
      const result = await callWriteApi("/internal/api/enrollment/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        termName: args?.termName,
        yearLabel: args?.yearLabel,
        roster,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return result;
      }

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Enrollment",
        recordType: "enrollment",
        recordId: String(result.enrollmentId),
        recordLabel: `${result.yearLabel} - ${result.termName}`,
        description: `Set the enrollment roster for ${result.yearLabel} - ${result.termName} (${result.classCount} class(es), ${result.studentCount} student(s)) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404 || error.status === 400 || error.status === 409) {
        return { status: error.status === 404 ? "not_found" : "needs_info", message: error.message };
      }
      throw error;
    }
  },
};
