const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_upcoming_birthdays",
  description:
    "Read-only report of students and staff with a birthday today or in the next 7 days (matches the real Birthdays page exactly, including its " +
    "weekend-carryover rule: a Sat/Sun birthday is reported as \"today\" on the following Monday). Managers/Supervisors/Admins/org owners see every " +
    "student org-wide; other staff only see students in classes they're assigned to (staff birthdays are visible to everyone regardless of role, " +
    "same as the real page). No guardian birthdays are tracked.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view birthdays");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    return await callInternalApi(`/internal/api/birthdays?${params.toString()}`);
  },
};
