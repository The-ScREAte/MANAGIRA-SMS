const { callInternalApi } = require("../internalApiClient");

module.exports = {
  name: "get_class",
  description: "List classes in the caller's own school, optionally filtered by name, with student counts.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Optional class name filter, e.g. 'Grade 3'." } },
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), q: String(args?.query || "").trim() });
    const result = await callInternalApi(`/internal/api/classes?${params.toString()}`);
    const classes = result.classes || [];
    if (!classes.length && args?.query) {
      // No match: say so plainly (never "0 students") and list the real classes.
      const all = await callInternalApi(`/internal/api/classes?${new URLSearchParams({ organizationId: String(tenant.organizationId), q: "" })}`);
      return { found: false, message: `There is no class called "${args.query}" in this school.`, classes: (all.classes || []).map((c) => c.class_name) };
    }
    return classes;
  },
};
