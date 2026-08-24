const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_classes",
  description: "Create one or more new classes in the caller's own school, matching the \"+ Add New Items\" > New Class form. Needs Manage Classes & Subjects. Class names may only contain letters, numbers, spaces, and hyphens.",
  parameters: {
    type: "object",
    properties: {
      classNames: { type: "array", items: { type: "string" }, description: "One or more class names, e.g. [\"Grade 4\", \"Grade 5\"]." },
    },
    required: ["classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create classes");

    const classNames = Array.isArray(args?.classNames) ? args.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    if (!classNames.length) {
      return { status: "needs_info", message: "I need at least one class name to create." };
    }

    const result = await callWriteApi("/internal/api/classes/create", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      classNames,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Classes",
      recordType: "class",
      recordLabel: result.classes.map((c) => c.class_name).join(", "),
      description: `Created class${result.classes.length === 1 ? "" : "es"} ${result.classes.map((c) => `"${c.class_name}"`).join(", ")} via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
