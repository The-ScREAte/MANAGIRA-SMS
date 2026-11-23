const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

// Each student's report-card remarks (Teacher / Conduct / Attitude / Interest) for a class and term.
module.exports = {
  name: "list_student_remarks",
  description:
    "Read each student's report-card remarks (teacher, conduct, attitude, interest) for one class and term, as the report card shows them, with how many students " +
    "have a teacher remark and how many have none. Use it before writing remarks (set_student_remarks) and to answer \"who still needs a remark\". " +
    "Managers see any class; other staff only classes assigned to them.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "The exact class name." },
      termName: { type: "string", description: "Term name; omit for the current term." },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "read report-card remarks");
    const params = new URLSearchParams({ className: String(args.className || "") });
    if (args.termName) params.set("termName", String(args.termName));
    try {
      return await callInternalApi(`/internal/api/reports/student-remarks?${params}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if ([400, 404].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
