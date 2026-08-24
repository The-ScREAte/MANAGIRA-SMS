const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "assign_document_to_class",
  description:
    "Assign a Doc/Sheet to a class (view/comment/edit for teachers on that class). Adds or updates just this one class - every other class's/person's " +
    "access is left exactly as it was. Newly-assigned classes' teachers get an email + in-app notification, same as the real page. " +
    "includeStudents/includeSubjects are stored as intent flags shown in the editor's UI, but nothing currently reads them to auto-populate anything - " +
    "don't imply they'll do something extra. Needs Manage Records.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
      className: { type: "string" },
      permissionLevel: { type: "string", enum: ["view", "comment", "edit"], description: "Defaults to view." },
      includeStudents: { type: "boolean" },
      includeSubjects: { type: "boolean" },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "assign a doc/sheet to a class");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }
    if (!args?.className) return { status: "needs_info", message: "I need which class to assign it to." };

    try {
      const result = await callWriteApi("/internal/api/documents/class-assignment/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        className: args.className,
        permissionLevel: args?.permissionLevel,
        includeStudents: args?.includeStudents,
        includeSubjects: args?.includeSubjects,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        description: `Assigned a doc/sheet to "${result.className}" (${result.permissionLevel}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 403) { error.denied = true; throw error; }
      throw error;
    }
  },
};
