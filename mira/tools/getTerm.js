const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_term",
  description:
    "List school terms for the caller's own school, most recent first. Each term includes its school year's label (year_label) and whether that year is the current year (year_is_current), plus the term's own current/current_term flags - always read year_label off each term rather than assuming order or grouping; never guess which year a term belongs to.",
  parameters: { type: "object", properties: {} },
  async handler(_args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    const result = await callInternalApi(`/internal/api/terms?${params.toString()}`);
    return result.terms || [];
  },
};
