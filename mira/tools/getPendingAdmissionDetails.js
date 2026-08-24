const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_pending_admission_details",
  description:
    "Full detail on one pending admission - subjects requested and the guardian(s) who applied on the student's behalf, in addition to what " +
    "list_pending_admissions already shows. Identify by pendingId (from list_pending_admissions) or the applicant's name. Needs Approve Admissions.",
  parameters: {
    type: "object",
    properties: {
      pendingId: { type: "number" },
      studentName: { type: "string", description: "If pendingId isn't known." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view a pending admission");
    if (!args?.pendingId && !args?.studentName) {
      return { status: "needs_info", message: "I need a pendingId or the applicant's name to find it." };
    }
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
    });
    if (args.pendingId) params.set("pendingId", String(args.pendingId));
    if (args.studentName) params.set("studentName", args.studentName);
    try {
      return await callInternalApi(`/internal/api/admissions/pending/get?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
