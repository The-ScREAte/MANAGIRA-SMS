const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_student_assessment_status",
  description:
    "Lock or unlock a student's (or all students') access to a test's question set. Needs Manage Assessments + Set Assessment Questions. " +
    "\"lock\" just blocks further attempts - safe, immediate, no confirmation needed. " +
    "\"unlock\" is DESTRUCTIVE and PERMANENT: DELETES the student's existing attempt, answers, and any posted score so they can retake - unrecoverable. " +
    "For unlock: first call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      subjectName: { type: "string" },
      testTitle: { type: "string" },
      studentName: { type: "string", description: "Required unless unlockAll is true." },
      unlockAll: { type: "boolean", description: "Unlock every student at once. unlock only." },
      action: { type: "string", enum: ["lock", "unlock"] },
      reshuffleQuestions: { type: "boolean", description: "Unlock only - give a freshly shuffled retake." },
      confirm: { type: "boolean", description: "unlock only - true only after explicit user confirmation." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Disambiguates termName if reused across years." },
    },
    required: ["className", "subjectName", "testTitle", "action"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change a student's assessment status");

    const className = String(args?.className || "").trim();
    const subjectName = String(args?.subjectName || "").trim();
    const testTitle = String(args?.testTitle || "").trim();
    const action = String(args?.action || "").trim().toLowerCase();
    const unlockAll = Boolean(args?.unlockAll);
    const studentName = String(args?.studentName || "").trim();
    if (!className || !subjectName || !testTitle || !["lock", "unlock"].includes(action) || (!unlockAll && !studentName)) {
      return { status: "needs_info", message: "I need the class, subject, test name, an action (lock/unlock), and either a student name or unlockAll." };
    }

    if (action === "unlock" && args?.confirm !== true) {
      return {
        status: "confirmation_required",
        target: unlockAll ? "every student" : studentName,
        warning:
          `Unlocking ${unlockAll ? "every student" : studentName} for "${testTitle}" is permanent and cannot be undone: it will DELETE their existing attempt, answers, and any posted score for this test so they can retake it. ` +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    const result = await callWriteApi("/internal/api/assessments/question-sets/student-status", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      className,
      subjectName,
      testTitle,
      studentName: unlockAll ? undefined : studentName,
      unlockAll,
      action,
      reshuffleQuestions: args?.reshuffleQuestions,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessment Questions",
      recordType: "student_assessment_status",
      recordLabel: `${unlockAll ? "All students" : studentName} - ${testTitle} (${subjectName}, ${className})`,
      description: `${action === "lock" ? "Locked" : "Unlocked"} ${unlockAll ? "all students" : studentName} for test "${testTitle}" (${subjectName}, ${className})${action === "unlock" ? " - their prior attempt/answers/posted score were deleted" : ""} via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
