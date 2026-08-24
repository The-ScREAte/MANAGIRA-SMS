const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_transportation_live_status",
  description:
    "Where is the bus right now, in plain English - current location (reverse-geocoded to a real address, not raw coordinates), which stop it just passed, the next stop and ETA, speed, and how recent the update is. " +
    "Look up by studentName (available to staff, or a guardian for their own child, or a student for themself), OR by busNumber/routeName (staff only). " +
    "If there's no active trip right now, says so plainly instead of stale/blank data.",
  parameters: {
    type: "object",
    properties: {
      studentName: { type: "string", description: "Find the bus for this student. Optional for a guardian (defaults to their child) or student (always themself)." },
      busNumber: { type: "string", description: "Staff only." },
      routeName: { type: "string", description: "Staff only." },
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
    if (args?.busNumber) params.set("busNumber", String(args.busNumber).trim());
    if (args?.routeName) params.set("routeName", String(args.routeName).trim());

    try {
      return await callInternalApi(`/internal/api/transportation/live-status?${params.toString()}`);
    } catch (error) {
      // No RBAC permission gate on this read for the student-anchored path
      // (matches the real endpoint); a 422 is the ownership/staff-only
      // check, not a permission denial.
      if (error.status === 404) return { status: "not_found", message: error.message };
      if (error.status === 422 || error.status === 409) return { status: "blocked", message: error.message };
      return { status: "needs_info", message: error.message };
    }
  },
};
