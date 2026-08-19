const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_subjects",
  description: "List subjects in the caller's own school, grouped by name, showing which classes each subject is (and isn't) assigned to.",
  parameters: { type: "object", properties: {} },
  async handler(_args, tenant) {
    const { subjects } = await callInternalApi(`/internal/api/subjects?organizationId=${tenant.organizationId}`);
    return subjects;
  },
};
