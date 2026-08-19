const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "assign_subject_to_classes",
  description: "Assign an EXISTING subject to one or more additional classes, matching the \"Assign Existing Subject\" form. Requires the Manage Classes & Subjects permission. Use list_subjects first if you need to confirm the subject's exact name.",
  parameters: {
    type: "object",
    properties: {
      subjectName: { type: "string", description: "The existing subject's exact name." },
      classNames: { type: "array", items: { type: "string" }, description: "Classes to add this subject to." },
    },
    required: ["subjectName", "classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "assign subjects to classes");

    const subjectName = String(args?.subjectName || "").trim();
    const classNames = Array.isArray(args?.classNames) ? args.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    if (!subjectName || !classNames.length) {
      return { status: "needs_info", message: "I need the subject's exact name and at least one class to assign it to." };
    }

    const result = await callWriteApi("/internal/api/subjects/assign", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      subjectName,
      classNames,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Subjects",
      recordType: "subject",
      recordLabel: result.subjectName,
      description: `Assigned subject "${result.subjectName}" to ${result.created.map((c) => c.class_name).join(", ") || "no new classes (already assigned)"} via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
