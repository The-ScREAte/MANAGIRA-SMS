const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

// Writes report-card remarks for named students in one class and term (previewed first).
module.exports = {
  name: "set_student_remarks",
  description:
    "Write report-card remarks for students in one class and term: teacher, conduct, attitude and/or interest remark per student (up to 60 students, 500 characters each). " +
    "Only the remarks given change; the others stay. First call without confirm shows a preview (current and new remark per student). " +
    "When asked to write remarks from grades or attendance, first read them (get_scores, get_attendance_summary or find_low_attendance, and list_student_remarks), " +
    "base every remark only on those figures, keep each remark specific and professional, and never state a figure the records don't give. " +
    "Managers can do any class; other staff only classes assigned to them.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "The exact class name." },
      termName: { type: "string", description: "Term name; omit for the current term." },
      remarks: {
        type: "array",
        description: "One entry per student.",
        items: {
          type: "object",
          properties: {
            studentName: { type: "string", description: "The student's full name as the records give it." },
            teacher: { type: "string" },
            conduct: { type: "string" },
            attitude: { type: "string" },
            interest: { type: "string" },
          },
          required: ["studentName"],
        },
      },
      confirm: { type: "boolean" },
    },
    required: ["className", "remarks"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "write report-card remarks");
    try {
      const result = await callWriteApi("/internal/api/reports/student-remarks", {
        organizationId: tenant.organizationId, userId: tenant.userId, userRole: tenant.userRole, accountType: tenant.accountType, userEmail: tenant.userEmail,
        className: args.className, termName: args.termName, remarks: args.remarks, confirm: args.confirm === true,
      });
      if (result.status === "confirmation_required") return { status: "confirm", ...result };
      await logMiraActivity(tenant, {
        actionType: "Updated", moduleName: "Report cards", recordType: "student remarks", recordLabel: `${result.class} (${result.saved})`,
        description: `Wrote report-card remarks for ${result.saved} student${result.saved === 1 ? "" : "s"} in ${result.class} via Mira (AI assistant).`,
      });
      return { status: "done", ...result };
    } catch (error) {
      if (error.denied || error.status === 403) { error.denied = true; throw error; }
      if ([400, 404, 409].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
