const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_employees",
  description:
    "List staff/employee accounts - name, email, role, on-hold status, pending-setup status, assigned classes, and granted permissions. Needs Manage Employees - viewing this page requires it in the real app too, not just changing it.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view employees");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    try {
      const { employees } = await callInternalApi(`/internal/api/employees?${params.toString()}`);
      // The exact count, by role, so Mira never counts a list itself.
      const byRole = {};
      (employees || []).forEach((e) => { const role = e.account_type || e.role || "Other"; byRole[role] = (byRole[role] || 0) + 1; });
      return { total: (employees || []).length, byRole, employees };
    } catch (error) {
      if (error.status === 403) {
        error.denied = true;
      }
      throw error;
    }
  },
};
