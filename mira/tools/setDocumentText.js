const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_document_text",
  description:
    "Write plain text into a Doc (doc_type='document' only - use set_sheet_cells for spreadsheets). mode='replace' overwrites the entire document " +
    "(including any existing rich formatting, matching how the real editor saves); mode='append' adds this text as new paragraph(s) after what's already " +
    "there, keeping the existing content untouched. Needs edit access. Mira doesn't apply rich formatting (bold/color/etc) - only plain text.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
      text: { type: "string" },
      mode: { type: "string", enum: ["replace", "append"], description: "Defaults to replace." },
    },
    required: ["text"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit a document's text");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }
    if (args?.text === undefined || args?.text === null) return { status: "needs_info", message: "I need the text to write." };

    try {
      const result = await callWriteApi("/internal/api/documents/text/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        text: args.text,
        mode: args?.mode,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        description: `${result.mode === "append" ? "Appended to" : "Replaced"} a document's text via Mira (AI assistant).`,
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
