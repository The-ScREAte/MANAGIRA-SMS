const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_term",
  description: "List school terms/school-years for the caller's own school, most recent first, including which one is current.",
  parameters: { type: "object", properties: {} },
  async handler(_args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    const result = await callInternalApi(`/internal/api/terms?${params.toString()}`);
    return result.terms || [];
  },
};
