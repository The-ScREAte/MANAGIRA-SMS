const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "rename_class",
  description: "Rename an existing class. Needs Manage Classes & Subjects and the exact current class name.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "The class's exact current name." },
      newClassName: { type: "string", description: "The new name." },
    },
    required: ["className", "newClassName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "rename classes");

    const className = String(args?.className || "").trim();
    const newClassName = String(args?.newClassName || "").trim();
    if (!className || !newClassName) {
      return { status: "needs_info", message: "I need both the exact current class name and the new name." };
    }

    const result = await callWriteApi("/internal/api/classes/rename", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className,
      newClassName,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Classes",
      recordType: "class",
      recordId: String(result.id),
      recordLabel: result.newName,
      description: `Renamed class "${result.oldName}" to "${result.newName}" via Mira (AI assistant).`,
      changedFields: [{ field: "class_name", from: result.oldName, to: result.newName }],
    });

    return { status: "done", ...result };
  },
};
