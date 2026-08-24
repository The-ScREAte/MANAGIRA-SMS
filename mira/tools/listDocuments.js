const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_documents",
  description:
    "List the org's Docs/Sheets (documentId, title, type document/spreadsheet, creator, last updated). If the caller has Manage Records, shows every doc in " +
    "the org; otherwise only docs they created, were directly shared, or can reach through a class assignment - exactly what they'd see on the real page. " +
    "Pass className to scope to docs assigned to one class.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "Optional - only list docs assigned to this class." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view docs/sheets");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    if (args?.className) params.set("className", args.className);
    try {
      const { documents } = await callInternalApi(`/internal/api/documents?${params.toString()}`);
      return { documents };
    } catch (error) {
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
