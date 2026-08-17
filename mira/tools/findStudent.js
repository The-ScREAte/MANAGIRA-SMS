const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "find_student",
  description: "Search for a student by name within the caller's own school. Only ever searches the caller's tenant.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Student name or partial name to search for." },
    },
    required: ["query"],
  },
  // `tenant` comes from req.tenant (middleware/tenantScope.js) - the model
  // never supplies organizationId itself, so it cannot be tricked into
  // asking for another school's data.
  async handler(args, tenant) {
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      q: String(args?.query || "").trim(),
    });
    const result = await callInternalApi(`/internal/api/students/search?${params.toString()}`);
    return result.students || [];
  },
};
