const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_document",
  description:
    "DESTRUCTIVE. Delete a Doc/Sheet. It's soft-deleted server-side, but there's no restore feature anywhere in the app, so treat it as permanent. " +
    "Needs Manage Records. Call once without confirm to get a warning, then again with confirm=true after the user explicitly agrees.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
      confirm: { type: "boolean" },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete a doc/sheet");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/documents/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return { status: "confirm", message: result.warning, documentId: result.documentId, title: result.title };
      }

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        recordLabel: result.title,
        description: `Deleted a doc/sheet ("${result.title}") via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
