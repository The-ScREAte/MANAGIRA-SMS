const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_students",
  description:
    "Browse/report the full student roster (the Admissions/All Students page) - read-only. Richer than find_student's quick name search: every student's " +
    "displayed ID, class, gender, DOB, graduated status, and whether they have portal access. Optionally filter by class name and/or graduated true/false. " +
    "Combine with list_pending_admissions for the fuller admissions picture (open applications vs. actual enrolled students). Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "Optional - only list students in this class." },
      graduated: { type: "boolean", description: "Optional - true for graduated students only, false for active only." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view the student roster");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.className) params.set("className", args.className);
    if (args?.graduated !== undefined) params.set("graduated", String(args.graduated));
    try {
      const { students } = await callInternalApi(`/internal/api/students?${params.toString()}`);
      return { students };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
