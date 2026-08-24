const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "share_document_with_user",
  description:
    "Give a specific staff member direct access to a Doc/Sheet (view/comment/edit). Adds or updates just this one person - every other person's/class's " +
    "access is left exactly as it was. Needs Manage Records.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
      userName: { type: "string", description: "The employee's name, if userEmail isn't known." },
      userEmail: { type: "string" },
      permissionLevel: { type: "string", enum: ["view", "comment", "edit"], description: "Defaults to view." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "share a doc/sheet");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }
    if (!args?.userName && !args?.userEmail) {
      return { status: "needs_info", message: "I need the name or email of who to share it with." };
    }

    try {
      const result = await callWriteApi("/internal/api/documents/share/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        userName: args?.userName,
        userEmail: args?.userEmail,
        permissionLevel: args?.permissionLevel,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        description: `Shared a doc/sheet with ${result.userName} (${result.permissionLevel}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      if (error.status === 403) { error.denied = true; throw error; }
      throw error;
    }
  },
};
