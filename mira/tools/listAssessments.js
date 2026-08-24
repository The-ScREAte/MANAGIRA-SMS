const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "list_assessments",
  description: "List tests/assessments for a term in the caller's own school - title, weight, max score, category, lock/active status, edit window, and which classes/subjects each is assigned to. Omit termName to use the current term.",
  parameters: {
    type: "object",
    properties: {
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Optional school year label (e.g. \"2026-2027\") to disambiguate if termName is reused across multiple years." },
    },
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    if (args?.termName) params.set("termName", String(args.termName).trim());
    if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
    const result = await callInternalApi(`/internal/api/assessments?${params.toString()}`);
    return result;
  },
};
