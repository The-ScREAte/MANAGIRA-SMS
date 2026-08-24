const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_enrollment_roster",
  description:
    "Get the full roster (which classes are open, and which students are in each) for one school year/term's enrollment. Use this before set_enrollment_roster so you know the current state and can describe exactly what will change.",
  parameters: {
    type: "object",
    properties: {
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: [],
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    if (args?.termName) params.set("termName", String(args.termName).trim());
    if (args?.yearLabel) params.set("yearLabel", String(args.yearLabel).trim());
    try {
      const result = await callInternalApi(`/internal/api/enrollment/roster?${params.toString()}`);
      return result;
    } catch (error) {
      return { status: "not_found", message: error.message };
    }
  },
};
