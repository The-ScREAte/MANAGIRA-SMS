const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_fees",
  description: "Get a student's recorded fee payments and totals within the caller's own school. Requires the student's numeric ID (use find_student first if you only have a name).",
  parameters: {
    type: "object",
    properties: { studentId: { type: "number", description: "The student's numeric ID." } },
    required: ["studentId"],
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    return callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/fees?${params.toString()}`);
  },
};
