const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_school_years",
  description: "List the caller's school's School Year records (label, whether it's the current year, and how many terms it has). Use this first to look up the exact year label before renaming or deleting one.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async handler(_args, tenant) {
    const { schoolYears } = await callInternalApi(`/internal/api/school-years?organizationId=${tenant.organizationId}`);
    return { schoolYears };
  },
};
