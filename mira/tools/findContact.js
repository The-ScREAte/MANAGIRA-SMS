const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "find_contact",
  description: "Search for a guardian/parent contact by name within the caller's own school.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Guardian name or partial name to search for." } },
    required: ["query"],
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), q: String(args?.query || "").trim() });
    const result = await callInternalApi(`/internal/api/guardians/search?${params.toString()}`);
    return result.guardians || [];
  },
};
