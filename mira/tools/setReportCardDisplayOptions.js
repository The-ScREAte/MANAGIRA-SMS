const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_report_card_display_options",
  description:
    "Toggle which columns/sections show on a class/term's printed report card - e.g. whether student rank/position shows, whether attendance shows, " +
    "which score columns appear, which remark types show, the grade key. Only pass the toggles that are changing - everything else (including advanced " +
    "settings not exposed here, like PayGira billing display) is left exactly as it was. Needs Manage Reports.",
  parameters: {
    type: "object",
    properties: {
      className: { type: "string" },
      termName: { type: "string", description: "Defaults to the current term." },
      schoolYearLabel: { type: "string" },
      showPosition: { type: "boolean", description: "Student rank/position on the class." },
      showAttendance: { type: "boolean" },
      showClassScore: { type: "boolean" },
      showExamsScore: { type: "boolean" },
      showOtherScore: { type: "boolean" },
      showTotalScore: { type: "boolean" },
      showScaledScore: { type: "boolean" },
      showTotalPercentage: { type: "boolean" },
      showGrade: { type: "boolean" },
      showRemarksColumn: { type: "boolean" },
      showTeacherRemarks: { type: "boolean" },
      showConductRemarks: { type: "boolean" },
      showAttitudeRemarks: { type: "boolean" },
      showInterestRemarks: { type: "boolean" },
      showGradeKey: { type: "boolean" },
      showPromotion: { type: "boolean" },
    },
    required: ["className"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change report card display options");
    if (!args?.className) return { status: "needs_info", message: "I need which class." };

    const { className, termName, schoolYearLabel, ...toggles } = args || {};
    if (!Object.keys(toggles).some((k) => toggles[k] !== undefined)) {
      return { status: "needs_info", message: "I need at least one display option to change." };
    }

    try {
      const result = await callWriteApi("/internal/api/report-settings/display-options", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        className,
        termName,
        schoolYearLabel,
        ...toggles,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Report Settings",
        recordType: "display_settings",
        recordLabel: `${result.className} - ${result.termName}`,
        description: `Updated report card display options for ${result.className} (${result.termName}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
