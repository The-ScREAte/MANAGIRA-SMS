const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "rename_graduation_year_group",
  description: "Rename a graduation year group. Needs Manage Classes & Subjects and the exact current name (use list_graduation_year_groups first if unsure).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The group's exact current name, e.g. \"Graduation Class of 2030 Group\"." },
      newName: { type: "string", description: "The new name." },
    },
    required: ["name", "newName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "rename graduation year groups");

    const name = String(args?.name || "").trim();
    const newName = String(args?.newName || "").trim();
    if (!name || !newName) {
      return { status: "needs_info", message: "I need both the exact current name and the new name." };
    }

    const result = await callWriteApi("/internal/api/graduation-year-groups/rename", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      name,
      newName,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Graduation Year Groups",
      recordType: "graduation_year_group",
      recordId: String(result.id),
      recordLabel: result.newName,
      description: `Renamed graduation year group "${result.oldName}" to "${result.newName}" via Mira (AI assistant).`,
      changedFields: [{ field: "name", from: result.oldName, to: result.newName }],
    });

    return { status: "done", ...result };
  },
};
