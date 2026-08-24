const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_subject",
  description: "Create a new subject and assign it to one or more classes, matching the \"+ Add New Items\" > New Subject form. Needs Manage Classes & Subjects and at least one class name.",
  parameters: {
    type: "object",
    properties: {
      subjectName: { type: "string" },
      classNames: { type: "array", items: { type: "string" }, description: "Classes to assign this subject to." },
    },
    required: ["subjectName", "classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create subjects");

    const subjectName = String(args?.subjectName || "").trim();
    const classNames = Array.isArray(args?.classNames) ? args.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    if (!subjectName || !classNames.length) {
      return { status: "needs_info", message: "I need the subject name and at least one class to assign it to." };
    }

    const result = await callWriteApi("/internal/api/subjects/create", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      subjectName,
      classNames,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Subjects",
      recordType: "subject",
      recordLabel: result.subjectName,
      description: `Created subject "${result.subjectName}" assigned to ${result.created.map((c) => c.class_name).join(", ") || "no new classes (already assigned)"} via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
