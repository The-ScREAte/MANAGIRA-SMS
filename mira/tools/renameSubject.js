const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "rename_subject",
  description: "Rename a subject. This renames it across EVERY class it's assigned to at once (subjects are a shared name across classes, not a per-class label). Requires the Manage Classes & Subjects permission.",
  parameters: {
    type: "object",
    properties: {
      subjectName: { type: "string", description: "The subject's exact current name." },
      newSubjectName: { type: "string", description: "The new name." },
    },
    required: ["subjectName", "newSubjectName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "rename subjects");

    const subjectName = String(args?.subjectName || "").trim();
    const newSubjectName = String(args?.newSubjectName || "").trim();
    if (!subjectName || !newSubjectName) {
      return { status: "needs_info", message: "I need both the exact current subject name and the new name." };
    }

    const result = await callWriteApi("/internal/api/subjects/rename", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      subjectName,
      newSubjectName,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Subjects",
      recordType: "subject",
      recordLabel: result.newName,
      description: `Renamed subject "${result.oldName}" to "${result.newName}" (${result.classesAffected} class${result.classesAffected === 1 ? "" : "es"}) via Mira (AI assistant).`,
      changedFields: [{ field: "subject_name", from: result.oldName, to: result.newName }],
    });

    return { status: "done", ...result };
  },
};
