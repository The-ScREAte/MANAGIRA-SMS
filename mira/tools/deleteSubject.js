const { callInternalApi } = require("../internalApiClient");
const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

const IMPACT_LABELS = {
  assessment_results: "assessment result",
  student_subjects: "student subject enrollment",
  pending_student_subjects: "pending student subject enrollment",
  assessments: "assessment",
  user_subjects: "teacher assignment",
};

function describeImpact(dependentCounts) {
  const parts = Object.entries(dependentCounts || {}).map(([table, count]) => {
    const label = IMPACT_LABELS[table] || table;
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  });
  return parts;
}

module.exports = {
  name: "delete_subject",
  description:
    "Delete a subject. This is DESTRUCTIVE and PERMANENT - unlike deleting a class or school year, this is NOT blocked by dependent data: it deletes the subject's full assessment history, results, and enrollments along with it. Requires the Manage Classes & Subjects permission. " +
    "By default this removes the subject from EVERY class it's assigned to - pass className to remove it from just that one class instead. " +
    "Call this tool a first time with confirm omitted (or false) to see exactly what would be lost; read that warning to the user IN FULL and ask them to confirm - never set confirm=true on that first call. " +
    "As soon as the user replies with ANY clear affirmative in a later message, call this tool again with confirm=true right away.",
  parameters: {
    type: "object",
    properties: {
      subjectName: { type: "string", description: "The subject's exact name." },
      className: { type: "string", description: "Optional - if given, only removes the subject from this one class instead of all classes." },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["subjectName"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete subjects");

    const subjectName = String(args?.subjectName || "").trim();
    const className = String(args?.className || "").trim();
    if (!subjectName) {
      return { status: "needs_info", message: "I need the exact subject name to delete it." };
    }

    if (args?.confirm !== true) {
      const params = new URLSearchParams({ organizationId: String(tenant.organizationId), subjectName });
      if (className) params.set("className", className);
      let impact;
      try {
        impact = await callInternalApi(`/internal/api/subjects/delete-impact?${params.toString()}`);
      } catch (error) {
        return { status: "not_found", message: error.message };
      }

      const lostItems = describeImpact(impact.dependentCounts);
      return {
        status: "confirmation_required",
        subjectName: impact.subjectName,
        scope: impact.scope,
        warning:
          `Deleting subject ${impact.scope} is permanent and cannot be undone. ` +
          (lostItems.length
            ? `This will permanently delete: ${lostItems.join(", ")}. `
            : "No assessment results, enrollments, or other records were found attached to it right now. ") +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/subjects/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        subjectName,
        className,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "Subjects",
        recordType: "subject",
        recordLabel: result.scope,
        description: `Deleted subject ${result.scope} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "Subjects",
        recordType: "subject",
        recordLabel: subjectName,
        description: `Mira (AI assistant) attempted to delete subject "${subjectName}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
