const { callInternalApi } = require("../internalApiClient");

// "Project" in Mira's UI maps to a school/organization scope. Today a
// session is always tied to exactly one org, so this returns that single
// org - the hook is here for whenever cross-org access (e.g. a hub admin
// working across several schools) gets built.
module.exports = {
  name: "list_projects",
  description: "List the school(s)/project(s) the current user can work with in Mira. Currently always the caller's own school.",
  parameters: { type: "object", properties: {} },
  async handler(_args, tenant) {
    const result = await callInternalApi(`/internal/api/organizations/${tenant.organizationId}`);
    return [result.organization];
  },
};
