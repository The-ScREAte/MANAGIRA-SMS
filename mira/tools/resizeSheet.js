const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "resize_sheet",
  description:
    "Grow a spreadsheet by adding rows and/or columns (mirrors the editor's \"+ Row\"/\"+ Col\" buttons). Grow-only - can't shrink a sheet this way. " +
    "Usually not needed before set_sheet_cells, which auto-grows the sheet to fit whatever cell you write to; use this for adding extra blank space ahead " +
    "of time. Needs edit access.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the spreadsheet's title, if documentId isn't known." },
      addRows: { type: "number" },
      addCols: { type: "number" },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "resize a spreadsheet");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the spreadsheet's title to find it." };
    }
    if (!args?.addRows && !args?.addCols) {
      return { status: "needs_info", message: "I need addRows and/or addCols." };
    }

    try {
      const result = await callWriteApi("/internal/api/documents/sheet/resize", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        addRows: args?.addRows,
        addCols: args?.addCols,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "spreadsheet",
        recordId: String(result.documentId),
        description: `Resized a spreadsheet to ${result.rowCount} rows x ${result.colCount} columns via Mira (AI assistant).`,
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
