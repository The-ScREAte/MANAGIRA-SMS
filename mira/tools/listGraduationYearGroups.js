const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_graduation_year_groups",
  description: "List graduation year groups in the caller's own school, with how many classes are assigned to each.",
  parameters: { type: "object", properties: {} },
  async handler(_args, tenant) {
    const { graduationYearGroups } = await callInternalApi(`/internal/api/graduation-year-groups?organizationId=${tenant.organizationId}`);
    return graduationYearGroups;
  },
};
