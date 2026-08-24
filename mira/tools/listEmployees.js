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
      return { employees };
    } catch (error) {
      if (error.status === 403) {
        error.denied = true;
      }
      throw error;
    }
  },
};
