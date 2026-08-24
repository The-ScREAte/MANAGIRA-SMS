const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_class",
  description: "List classes in the caller's own school, optionally filtered by name, with student counts.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Optional class name filter, e.g. 'Grade 3'." } },
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), q: String(args?.query || "").trim() });
    const result = await callInternalApi(`/internal/api/classes?${params.toString()}`);
    return result.classes || [];
  },
};
