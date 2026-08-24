const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_students",
  description:
    "Add one or more new students (the Add New Student page) - single or bulk. This is the template every student must be normalized into before calling: " +
    "whatever messy format the user gives you (a pasted list, a spreadsheet dump, a paragraph of names) - extract and convert it into this exact shape, " +
    "one object per student, before calling. Never guess a class, gender, or date the user didn't actually give you - ask instead. " +
    "Runs the real app's own validation and duplicate-detection before saving; if a duplicate is detected the whole batch is rejected (not just that " +
    "student) - tell the user, and only retry with allowDuplicateSave:true after they explicitly confirm they want it added anyway. " +
    "Needs Manage Students.",
  parameters: {
    type: "object",
    properties: {
      students: {
        type: "array",
        description: "1-50 students per call.",
        items: {
          type: "object",
          properties: {
            firstName: { type: "string", description: "Letters, spaces, hyphens, apostrophes only." },
            lastName: { type: "string", description: "Letters, spaces, hyphens, apostrophes only." },
            dateOfBirth: { type: "string", description: "YYYY-MM-DD. Required unless dateOfBirthUnknown is true." },
            dateOfBirthUnknown: { type: "boolean" },
            gender: { type: "string", description: "e.g. Male, Female." },
            className: { type: "string", description: "Must match a real class in the org (use get_class to check)." },
            graduationYearGroupName: { type: "string" },
            hometown: { type: "string" },
            studentAddress: { type: "string" },
            studentEmail: { type: "string" },
            enrollmentType: { type: "string", enum: ["current", "future"], description: "Defaults to current (the org's active term)." },
            schoolYearLabel: { type: "string", description: "Required with termName if enrollmentType is future." },
            termName: { type: "string", description: "Required if enrollmentType is future." },
            subjects: { type: "array", items: { type: "string" }, description: "Subject names, must belong to the chosen class." },
            customStudentId: { type: "string", description: "Only if the org uses manual custom student IDs and the user gave a specific one - otherwise leave unset to auto-generate (if enabled) or leave blank." },
            guardians: {
              type: "array",
              description: "Optional. Matched/merged automatically against existing guardians by email, then phone+name, then name+hometown - creates a new guardian profile only if nothing matches.",
              items: {
                type: "object",
                properties: {
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  address: { type: "string" },
                  hometown: { type: "string" },
                },
                required: ["firstName"],
              },
            },
          },
          required: ["firstName", "lastName", "gender", "className"],
        },
      },
      allowDuplicateSave: { type: "boolean", description: "Only set true after the user explicitly confirms they want to save despite a detected duplicate." },
    },
    required: ["students"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "add students");
    if (!args?.students?.length) return { status: "needs_info", message: "I need at least one student's details." };

    try {
      const result = await callWriteApi("/internal/api/students/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        students: args.students,
        allowDuplicateSave: args?.allowDuplicateSave === true,
      });

      for (const s of result.created || []) {
        await logMiraActivity(tenant, {
          actionType: "Created",
          moduleName: "Admissions",
          recordType: "student",
          recordId: String(s.studentId),
          recordLabel: s.name,
          description: `Added student "${s.name}"${s.className ? ` to ${s.className}` : ""} via Mira (AI assistant).`,
        });
      }

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 409) return { status: "confirm_duplicate", message: error.message };
      if (error.status === 400 || error.status === 404 || error.status === 422) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
