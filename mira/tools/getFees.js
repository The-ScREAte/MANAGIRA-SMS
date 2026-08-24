const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_fees",
  description: "Get a student's recorded fee payments and totals within the caller's own school. Requires the student's numeric ID (use find_student first if you only have a name). Staff only.",
  parameters: {
    type: "object",
    properties: { studentId: { type: "number", description: "The student's numeric ID." } },
    required: ["studentId"],
  },
  // Staff-only: takes an arbitrary studentId with no ownership check
  // against the caller, and the real browser UI itself gates this behind
  // Manage Billing/PayGira - a guardian/student session must never reach
  // this, and even staff only via the real permission Mira re-checks
  // downstream, not by mistake through a wide-open read tool.
  async handler(args, tenant) {
    assertIsStaff(tenant, "view fee records");
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    return callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/fees?${params.toString()}`);
  },
};
