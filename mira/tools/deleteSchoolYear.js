const { callInternalApi } = require("../internalApiClient");
const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_school_year",
  description:
    "Delete a School Year record. DESTRUCTIVE and PERMANENT. Needs Manage School Years & Terms. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      yearLabel: { type: "string", description: "The school year's exact label, e.g. \"2024-2025\"." },
      confirm: {
        type: "boolean",
        description: "false/omitted on the first call to fetch the warning. Set true on the very next call once the user has given any clear yes/go-ahead - do not ask again before setting this.",
      },
    },
    required: ["yearLabel"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete school years");

    const yearLabel = String(args?.yearLabel || "").trim();
    if (!yearLabel) {
      return { status: "needs_info", message: "I need the exact school year label (e.g. \"2024-2025\") to delete it." };
    }

    const { schoolYears } = await callInternalApi(`/internal/api/school-years?organizationId=${tenant.organizationId}`);
    // Stored year_label spacing is inconsistent ("2026 - 2027" next to
    // "2022-2023" in the same org) - compare with whitespace stripped so a
    // real year isn't reported as "not found" over spacing alone.
    const normalize = (s) => String(s || "").replace(/\s+/g, "");
    const match = (schoolYears || []).filter((y) => normalize(y.year_label) === normalize(yearLabel));

    if (!match.length) {
      return { status: "not_found", message: `I couldn't find a school year named "${yearLabel}".` };
    }
    if (match.length > 1) {
      return { status: "ambiguous", message: `More than one school year is named "${yearLabel}" - please delete it manually from Manage Records.` };
    }

    const year = match[0];

    if (args?.confirm !== true) {
      const warnings = [];
      if (year.current) warnings.push("This is the CURRENT school year.");
      if (year.term_count > 0) warnings.push(`It has ${year.term_count} term${year.term_count === 1 ? "" : "s"}, which would also be deleted.`);
      return {
        status: "confirmation_required",
        yearLabel: year.year_label,
        isCurrent: year.current,
        termCount: year.term_count,
        warning:
          `Deleting the school year "${year.year_label}" is permanent and cannot be undone. ` +
          (warnings.length ? warnings.join(" ") + " " : "") +
          `If any classes, enrollments, attendance, or exam records are still linked to it (through its terms), the deletion will be blocked until those are removed. ` +
          `Ask the user to explicitly confirm before calling this tool again with confirm=true.`,
      };
    }

    try {
      const result = await callWriteApi("/internal/api/school-years/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
      userEmail: tenant.userEmail,
        yearLabel: year.year_label,
      });

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "School Years",
        recordType: "school_year",
        recordId: String(result.id),
        recordLabel: result.yearLabel,
        description: `Deleted school year "${result.yearLabel}"${result.wasCurrent ? " (was the current year)" : ""} via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      // A 409 here means collectSchoolYearDeletionBlockers() (commonController.js)
      // found dependent records - an expected, user-facing outcome, not a bug.
      // Log the blocked attempt too so it's visible in the audit trail.
      await logMiraActivity(tenant, {
        actionType: "Delete Blocked",
        moduleName: "School Years",
        recordType: "school_year",
        recordId: String(year.id),
        recordLabel: year.year_label,
        description: `Mira (AI assistant) attempted to delete school year "${year.year_label}" but it was blocked: ${error.message}`,
      });
      return { status: "blocked", message: error.message };
    }
  },
};
