const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_document",
  description:
    "Create a new Doc (rich text) or Sheet (spreadsheet) in Docs/Sheets. Needs Manage Records. The creator automatically gets edit access. " +
    "After creating, use set_document_text or set_sheet_cells to add content, and share_document_with_user / assign_document_to_class to give others access.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Defaults to \"Untitled Document\" / \"Untitled Spreadsheet\" if omitted." },
      docType: { type: "string", enum: ["document", "spreadsheet"], description: "\"document\" for rich text, \"spreadsheet\" for a grid. Defaults to document." },
    },
    required: ["docType"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create a doc/sheet");
    try {
      const result = await callWriteApi("/internal/api/documents/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        title: args?.title,
        docType: args?.docType,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        recordLabel: result.title,
        description: `Created ${result.docType === "spreadsheet" ? "a spreadsheet" : "a document"} "${result.title}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
