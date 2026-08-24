const { callInternalApi } = require("../internalApiClient");
const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_graduation_year_group",
  description:
    "Delete a graduation year group. DESTRUCTIVE and PERMANENT; BLOCKED if any classes still reference it. Needs Manage Classes & Subjects. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The group's exact name, e.g. \"Graduation Class of 2030 Group\"." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["name"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete graduation year groups");

    const name = String(args?.name || "").trim();
    if (!name) {
      return { status: "needs_info", message: "I need the exact graduation year group name to delete it." };
    }

    const { graduationYearGroups } = await callInternalApi(`/internal/api/graduation-year-groups?organizationId=${tenant.organizationId}`);
    const match = (graduationYearGroups || []).filter((g) => g.name.trim().toLowerCase() === name.toLowerCase());

    if (!match.length) {
      return { status: "not_found", message: `I couldn't find a graduation year group named "${name}".` };
    }
    if (match.length > 1) {
      return { status: "ambiguous", message: `More than one graduation year group is named "${name}" - please delete it manually from Manage Records.` };
    }

    const group = match[0];

    if (args?.confirm !== true) {
      return {
        status: "confirmation_required",
        name: group.name,
        classCount: group.class_count,
        warning:
          `Deleting the graduation year group "${group.name}" is permanent and cannot be undone. ` +
          (group.class_count > 0
            ? `It's currently referenced by ${group.class_count} class${group.class_count === 1 ? "" : "es"}, so the deletion will be BLOCKED until those classes are reassigned or removed. `
            : "") +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/graduation-year-groups/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
      userEmail: tenant.userEmail,
        name: group.name,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Graduation Year Groups",
        recordType: "graduation_year_group",
        recordId: String(result.id),
        recordLabel: result.name,
        description: `Deleted graduation year group "${result.name}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "Graduation Year Groups",
        recordType: "graduation_year_group",
        recordId: String(group.id),
        recordLabel: group.name,
        description: `Mira (AI assistant) attempted to delete graduation year group "${group.name}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
