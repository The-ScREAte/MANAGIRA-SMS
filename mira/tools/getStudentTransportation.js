const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_student_transportation",
  description:
    "Get a student's transportation assignment - bus, route, stop, pickup/dropoff times, driver, distance from home, and whether there's an active trip right now. " +
    "Available to staff, guardians, and students (not staff-only): any staff member can look up any student by name; a guardian can only look up their own linked child (omit studentName to default to their child if they have just one); a student can only look up themselves (studentName is ignored).",
  parameters: {
    type: "object",
    properties: {
      studentName: { type: "string", description: "Required for staff. Optional for a guardian (defaults to their child); ignored for a student." },
    },
    required: [],
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      viewerType: tenant.viewerType || "",
      userId: String(tenant.userId || ""),
    });
    if (args?.studentName) params.set("studentName", String(args.studentName).trim());

    try {
      return await callInternalApi(`/internal/api/transportation/student?${params.toString()}`);
    } catch (error) {
      // No RBAC permission gate on this read (matches the real endpoint,
      // open to any staff member) - a 422 here is the ownership check
      // (wrong guardian/student asking about someone else's data), not a
      // permission denial, so it maps to a normal blocked-status reply
      // rather than being thrown as `.denied`.
      if (error.status === 404) return { status: "not_found", message: error.message };
      if (error.status === 422 || error.status === 409) return { status: "blocked", message: error.message };
      return { status: "needs_info", message: error.message };
    }
  },
};
