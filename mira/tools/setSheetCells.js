const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_sheet_cells",
  description:
    "Write or clear individual cells in a spreadsheet (doc_type='spreadsheet' only - use set_document_text for docs). Only the cells you list are touched " +
    "- everything else in the sheet is left exactly as it was. Cell refs are A1-style (\"A1\", \"C12\"). A value starting with \"=\" is stored as a " +
    "formula (e.g. \"=SUM(A1:A5)\") - Mira doesn't evaluate it, the sheet does when opened. Writing to a cell beyond the current grid automatically grows " +
    "the sheet (up to 500 rows / 100 columns). Needs edit access.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the spreadsheet's title, if documentId isn't known." },
      cells: {
        type: "object",
        description: "Map of cell ref -> value to set, e.g. {\"A1\":\"Name\",\"B1\":\"Score\",\"B2\":\"=SUM(B3:B10)\"}. An empty-string value clears that cell.",
      },
      clearCells: { type: "array", items: { type: "string" }, description: "Cell refs to clear, e.g. [\"C1\",\"C2\"]." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit a spreadsheet's cells");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the spreadsheet's title to find it." };
    }
    if ((!args?.cells || !Object.keys(args.cells).length) && (!args?.clearCells || !args.clearCells.length)) {
      return { status: "needs_info", message: "I need at least one cell to set or clear." };
    }

    try {
      const result = await callWriteApi("/internal/api/documents/sheet/cells/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        cells: args?.cells,
        clearCells: args?.clearCells,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "spreadsheet",
        recordId: String(result.documentId),
        description: `Set ${result.cellsSet} cell(s) and cleared ${result.cellsCleared} in a spreadsheet via Mira (AI assistant).`,
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
