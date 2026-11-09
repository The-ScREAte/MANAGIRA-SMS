const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_attendance",
  description: "Get one student's attendance marks and a summary for the last N days (default 30, up to 180) - not a whole term. Say which days it covers. For a term's attendance percentage use find_low_attendance or run_report (attendance per student).",
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
    const days = Math.min(180, Math.max(1, Number(args?.days) || 30));
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), days: String(days) });
    const result = await callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/attendance?${params.toString()}`);
    return { covers: `the last ${days} days only (not the whole term)`, ...result };
  },
};
