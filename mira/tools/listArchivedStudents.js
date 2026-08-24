const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_archived_students",
  description: "List archived (closed/graduated-out) students, optionally scoped to one graduation year group. Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      groupName: { type: "string", description: "Optional - only students archived under this group." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view archived students");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    if (args?.groupName) params.set("groupName", args.groupName);
    try {
      const { archivedStudents } = await callInternalApi(`/internal/api/archived-students?${params.toString()}`);
      return { archivedStudents };
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
