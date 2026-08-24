const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_employee",
  description:
    "Invite a new staff account (Manager/Supervisor/Teacher/Driver). Needs Manage Employees. Sends the new employee a REAL email invite to set their own password. " +
    "Creating a Manager account, or granting any high-risk permission (Manage Employees, Manage Settings, Manage School Years & Terms, Approve Promotions, Manage Billing), only works if the calling user themself has manager-level access - otherwise those get silently dropped and the preview will say so. Never invent a role or permissions the user didn't ask for. " +
    "First call with confirm omitted/false to get a preview (final role, classes, and exactly which permissions will actually be granted vs dropped); relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string" },
      role: { type: "string", enum: ["Manager", "Supervisor", "Teacher", "Driver"] },
      dateOfBirth: { type: "string", description: "YYYY-MM-DD, optional." },
      classNames: { type: "array", items: { type: "string" }, description: "Classes to assign them to, optional." },
      permissions: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "manage_employees", "manage_students", "manage_guardians", "manage_assessments",
            "set_assessment_questions", "mark_attendance", "manage_reports", "manage_records",
            "manage_promotions", "approve_promotions", "approve_admissions", "publish_events_announcements",
            "manage_school_year_terms", "manage_classes_subjects", "generate_transcripts",
            "manage_billing", "manage_settings", "manage_paygira", "mailroom",
          ],
        },
        description: "Optional. Never invent these - only include what the user explicitly asked to grant. Granting \"mailroom\" gives org-wide guardian-contact access (the per-class-restricted option isn't available via Mira).",
      },
      confirm: {
        type: "boolean",
        description: "false/omitted on the first call to fetch the preview. Set true on the very next call once the user has given any clear yes/go-ahead - do not ask again before setting this.",
      },
    },
    required: ["firstName", "lastName", "email", "role"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create employees");

    const firstName = String(args?.firstName || "").trim();
    const lastName = String(args?.lastName || "").trim();
    const email = String(args?.email || "").trim();
    if (!firstName || !lastName || !email || !args?.role) {
      return { status: "needs_info", message: "I need the employee's first name, last name, email, and role." };
    }

    try {
      const result = await callWriteApi("/internal/api/employees/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        organizationName: tenant.organizationName,
        firstName,
        lastName,
        email,
        role: args.role,
        dateOfBirth: args?.dateOfBirth,
        classNames: args?.classNames,
        permissions: args?.permissions,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") {
        return result;
      }

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Employees",
        recordType: "employee",
        recordId: String(result.userId),
        recordLabel: `${result.firstName} ${result.lastName}`,
        description: `Invited "${result.firstName} ${result.lastName}" (${result.email}) as a ${result.role}${result.grantedPermissions?.length ? ` with permissions: ${result.grantedPermissions.join(", ")}` : ""} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) {
        return { status: "needs_info", message: error.message };
      }
      if (error.status === 409 || error.status === 422) {
        return { status: "blocked", message: error.message };
      }
      throw error;
    }
  },
};
