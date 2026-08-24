const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_document_title",
  description: "Rename a Doc/Sheet. Needs edit access to it (creator, Manage Records, or an explicit edit share/class assignment).",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      currentTitle: { type: "string", description: "A distinctive snippet of the document's CURRENT title, if documentId isn't known." },
      newTitle: { type: "string" },
    },
    required: ["newTitle"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "rename a doc/sheet");
    if (!args?.documentId && !args?.currentTitle) {
      return { status: "needs_info", message: "I need a documentId or the document's current title to find it." };
    }
    if (!args?.newTitle) return { status: "needs_info", message: "I need the new title." };

    try {
      const result = await callWriteApi("/internal/api/documents/title/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        currentTitle: args?.currentTitle,
        newTitle: args.newTitle,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        recordLabel: result.title,
        description: `Renamed a doc/sheet to "${result.title}" via Mira (AI assistant).`,
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
