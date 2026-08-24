const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_document",
  description:
    "Read a Doc/Sheet's full content plus who it's shared with. For a text document, returns plain text (formatting like bold/color isn't exposed). " +
    "For a spreadsheet, returns rowCount/colCount and a sparse cell map (e.g. {\"A1\":\"Name\",\"B1\":\"=SUM(A1:A5)\"}) - cell values that start with " +
    "\"=\" are formulas, stored as raw text (Mira doesn't evaluate them). Identify the doc by documentId (from list_documents) or its exact/partial title.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view a doc/sheet");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    if (args.documentId) params.set("documentId", String(args.documentId));
    if (args.title) params.set("title", args.title);
    try {
      return await callInternalApi(`/internal/api/documents/get?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
