const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "find_contact",
  description: "Search for a guardian/parent contact by name within the caller's own school. Staff only.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Guardian name or partial name to search for." } },
    required: ["query"],
  },
  // Staff-only: an org-wide guardian PII directory search (phone/email) -
  // a guardian/student session must not be able to look up other
  // families' contact details this way.
  async handler(args, tenant) {
    assertIsStaff(tenant, "search for guardian contacts");
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), q: String(args?.query || "").trim() });
    const result = await callInternalApi(`/internal/api/guardians/search?${params.toString()}`);
    return result.guardians || [];
  },
};
