const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_students",
  description:
    "Browse/report the full student roster (the Admissions/All Students page) - read-only. Richer than find_student's quick name search: every student's " +
    "displayed ID, class, gender, DOB, graduated status, and whether they have portal access. Optionally filter by class name and/or graduated true/false. " +
    "Combine with list_pending_admissions for the fuller admissions picture (open applications vs. actual enrolled students). Needs Manage Students. " +
    "For any \"how many\" question answer from `counts` (total, active, graduated, byClass, byGender) - never count the list yourself. " +
    "Without a class filter the list is cut to the first " + "60 students; filter by class to see a whole class.",
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
      const { students, counts } = await callInternalApi(`/internal/api/students?${params.toString()}`);
      // Exact counts always; the full list only when it's short (or one class),
      // which keeps answers accurate and each turn small.
      const LIST_CAP = 60;
      if (!args?.className && students.length > LIST_CAP) {
        return { counts, students: students.slice(0, LIST_CAP), note: `Showing ${LIST_CAP} of ${students.length} students. Use counts for totals; filter by class to list a whole class.` };
      }
      return { counts, students };
    } catch (error) {
      if (error.status === 403) error.denied = true;
      if (error.status === 404 || error.status === 409) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
