const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "find_student",
  description: "Search for a student by name within the caller's own school. Only ever searches the caller's tenant. Staff only.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Student name or partial name to search for." },
      className: { type: "string", description: "Optional - only search students enrolled in this class." },
    },
    required: ["query"],
  },
  // `tenant` comes from req.tenant (middleware/tenantScope.js) - the model
  // never supplies organizationId itself, so it cannot be tricked into
  // asking for another school's data. Staff-only: this is an org-wide
  // student directory search - a guardian/student session must not be able
  // to browse every other student at the school this way.
  async handler(args, tenant) {
    assertIsStaff(tenant, "search for students");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      q: String(args?.query || "").trim(),
    });
    if (args?.className) params.set("className", String(args.className).trim());
    const result = await callInternalApi(`/internal/api/students/search?${params.toString()}`);
    return result.students || [];
  },
};
