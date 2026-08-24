const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "close_graduation_year_group",
  description:
    "Archive students in a graduation year group - marks them graduated and moves them to Archived Students. Fully reversible via unarchive_students. " +
    "Give either studentNames (specific students) or allInGroup:true (every non-graduated member of the group). Use get_close_group_candidates first to " +
    "see who's actually in the group. Call once without confirm to get a warning, then again with confirm=true after the user explicitly agrees. " +
    "Needs Manage School Years & Terms.",
  parameters: {
    type: "object",
    properties: {
      groupName: { type: "string" },
      studentNames: { type: "array", items: { type: "string" } },
      allInGroup: { type: "boolean" },
      confirm: { type: "boolean" },
    },
    required: ["groupName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "close a graduation year group");
    if (!args?.groupName) return { status: "needs_info", message: "I need the graduation year group's name." };
    if (!args?.allInGroup && (!args?.studentNames || !args.studentNames.length)) {
      return { status: "needs_info", message: "I need studentNames, or allInGroup: true." };
    }

    try {
      const result = await callWriteApi("/internal/api/graduation-year-groups/close", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        groupName: args.groupName,
        studentNames: args.studentNames,
        allInGroup: args.allInGroup === true,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return { status: "confirm", message: result.warning, groupName: result.groupName, studentCount: result.studentCount, students: result.students };
      }

      if (result.archived?.length) {
        await logMiraActivity(tenant, {
          actionType: "Updated",
          moduleName: "Graduation Year Groups",
          recordType: "graduation_year_group",
          recordLabel: result.groupName,
          description: `Closed "${result.groupName}" for ${result.archived.length} student(s) via Mira (AI assistant).`,
        });
      }

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "needs_info", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
