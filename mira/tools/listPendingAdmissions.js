const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_pending_admissions",
  description:
    "List open admission applications submitted through the public registration form (Pending Admissions page) - name, DOB, gender, requested class, " +
    "enrollment type, when submitted, and registration-fee payment status if the org charges one. These are NOT real students yet - use " +
    "approve_pending_admission or reject_pending_admission to act on one. Needs Approve Admissions.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(_args, tenant) {
    assertIsStaff(tenant, "view pending admissions");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    try {
      const { pending } = await callInternalApi(`/internal/api/admissions/pending?${params.toString()}`);
      return { pending };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
