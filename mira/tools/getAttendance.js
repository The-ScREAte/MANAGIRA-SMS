const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_attendance",
  description: "Get a student's attendance records and a status summary for the last N days (default 30) within the caller's own school. Staff only.",
  parameters: {
    type: "object",
    properties: {
      studentId: { type: "number", description: "The student's numeric ID." },
      days: { type: "number", description: "How many days back to look (default 30, max 180)." },
    },
    required: ["studentId"],
  },
  // Staff-only: arbitrary studentId, no ownership check against the
  // caller - a guardian/student session must not be able to pull any
  // other student's attendance this way.
  async handler(args, tenant) {
    assertIsStaff(tenant, "view attendance records");
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), days: String(args?.days || 30) });
    return callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/attendance?${params.toString()}`);
  },
};
