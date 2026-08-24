const { callInternalApi } = require("../internalApiClient");
const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_class",
  description:
    "Delete a class. DESTRUCTIVE and PERMANENT; BLOCKED if it still has students, attendance, assessments, subjects, or any other real data. Needs Manage Classes & Subjects. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string", description: "The class's exact name." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete classes");

    const className = String(args?.className || "").trim();
    if (!className) {
      return { status: "needs_info", message: "I need the exact class name to delete it." };
    }

    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), q: className });
    const { classes } = await callInternalApi(`/internal/api/classes?${params.toString()}`);
    const match = (classes || []).filter((c) => c.class_name.trim().toLowerCase() === className.toLowerCase());

    if (!match.length) {
      return { status: "not_found", message: `I couldn't find a class named "${className}".` };
    }
    if (match.length > 1) {
      return { status: "ambiguous", message: `More than one class is named "${className}" - please delete it manually from Manage Records.` };
    }

    const cls = match[0];

    if (args?.confirm !== true) {
      return {
        status: "confirmation_required",
        className: cls.class_name,
        studentCount: cls.student_count,
        warning:
          `Deleting the class "${cls.class_name}" is permanent and cannot be undone. ` +
          (cls.student_count > 0
            ? `It currently has ${cls.student_count} student${cls.student_count === 1 ? "" : "s"} - the deletion will be BLOCKED until they're moved or removed, so nothing will be lost by mistake. `
            : "") +
          `If any attendance, assessment, or other records still reference it, the deletion will also be blocked. ` +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/classes/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
      userEmail: tenant.userEmail,
        className: cls.class_name,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Classes",
        recordType: "class",
        recordId: String(result.id),
        recordLabel: result.className,
        description: `Deleted class "${result.className}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "Classes",
        recordType: "class",
        recordId: String(cls.class_id),
        recordLabel: cls.class_name,
        description: `Mira (AI assistant) attempted to delete class "${cls.class_name}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
