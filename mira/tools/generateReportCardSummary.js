const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

// A lightweight summary (attendance + fee standing) the model can narrate -
// not a replacement for the main app's full report-card/assessment engine,
// which covers grading, subjects, and comments in far more depth than a
// single tool call should attempt to reproduce.
module.exports = {
  name: "generate_report_card_summary",
  description:
    "Generate a brief status summary for a student (attendance + fee standing) within the caller's own school. Requires the student's numeric ID. Staff only.",
  parameters: {
    type: "object",
    properties: { studentId: { type: "number", description: "The student's numeric ID." } },
    required: ["studentId"],
  },
  // Staff-only: composes get_attendance + get_fees, both arbitrary-studentId
  // reads with no ownership check - inherits the same exposure if not
  // gated here too.
  async handler(args, tenant) {
    assertIsStaff(tenant, "generate a report card summary");
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    const [attendance, fees] = await Promise.all([
      callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/attendance?${params.toString()}`),
      callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/fees?${params.toString()}`),
    ]);

    return {
      student: attendance.student,
      attendanceSummary: attendance.summary,
      feeTotals: fees.totals,
      note: "Grades/subject summaries are not covered by this tool - use the main app's Report Cards page for full academic reports.",
    };
  },
};
