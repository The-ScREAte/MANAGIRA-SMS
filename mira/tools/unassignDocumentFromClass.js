const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "unassign_document_from_class",
  description: "Remove a Doc/Sheet's assignment to a class. Only affects this one class - every other class/person keeps their access. Needs Manage Records.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
      className: { type: "string" },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "unassign a doc/sheet from a class");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }
    if (!args?.className) return { status: "needs_info", message: "I need which class to unassign it from." };

    try {
      const result = await callWriteApi("/internal/api/documents/class-assignment/remove", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        className: args.className,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        description: `Removed a doc/sheet's assignment to "${result.className}" via Mira (AI assistant).`,
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
