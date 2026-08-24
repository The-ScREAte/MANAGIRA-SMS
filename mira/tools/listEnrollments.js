const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_enrollments",
  description:
    "List enrollments (school year, term, how many classes/students are open) for the org. Use this to find which school years/terms already have an enrollment before reading or setting a roster.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async handler(_args, tenant) {
    const { enrollments } = await callInternalApi(`/internal/api/enrollment?organizationId=${tenant.organizationId}`);
    return { enrollments };
  },
};
