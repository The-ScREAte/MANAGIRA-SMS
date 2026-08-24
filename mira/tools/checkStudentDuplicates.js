const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "check_student_duplicates",
  description:
    "Pre-flight check: does a student matching this name/DOB/gender/class/hometown combination already exist? Use this before create_students when you're " +
    "not sure whether a student was already added - create_students already runs this same check itself and will refuse a duplicate, but calling this " +
    "first lets you warn the user and ask before attempting the create. Read-only, needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      students: {
        type: "array",
        items: {
          type: "object",
          properties: {
            className: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            dateOfBirth: { type: "string", description: "YYYY-MM-DD" },
            gender: { type: "string" },
            hometown: { type: "string" },
          },
          required: ["className", "firstName", "lastName", "dateOfBirth"],
        },
      },
    },
    required: ["students"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "check for duplicate students");
    if (!args?.students?.length) return { status: "needs_info", message: "I need at least one student to check." };
    const result = await callInternalApi("/internal/api/students/check-duplicates", {
      method: "POST",
      body: {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        students: args.students,
      },
    });
    return { duplicates: result.duplicates || [] };
  },
};
