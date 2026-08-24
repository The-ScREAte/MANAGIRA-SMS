const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "reorder_classes",
  description:
    "Change the display order of classes on the Classes dashboard, matching the drag-and-drop \"Dashboard Class Arrangement\" panel. Needs Manage Classes & Subjects. " +
    "Give the class names in the exact order the user wants them to appear, top to bottom - any class not mentioned keeps its place, appended after the ones you listed. Never guess an order the user hasn't stated.",
  parameters: {
    type: "object",
    properties: {
      orderedClassNames: { type: "array", items: { type: "string" }, description: "Class names in the desired top-to-bottom order." },
    },
    required: ["orderedClassNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "reorder classes");

    const orderedClassNames = Array.isArray(args?.orderedClassNames) ? args.orderedClassNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    if (!orderedClassNames.length) {
      return { status: "needs_info", message: "I need the class names in the order you want them displayed." };
    }

    const result = await callWriteApi("/internal/api/classes/reorder", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      orderedClassNames,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Classes",
      recordType: "class_dashboard_layout",
      recordLabel: "Class arrangement order",
      description: `Reordered classes via Mira (AI assistant): ${result.classes.map((c) => c.class_name).join(" → ")}.`,
    });

    return { status: "done", ...result };
  },
};
