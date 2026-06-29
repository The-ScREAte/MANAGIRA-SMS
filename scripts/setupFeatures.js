const { registerFeature } = require("../utils/featureRegistrar");

(async () => {
  await registerFeature("School Website", "/publicDashboard");
  await registerFeature("Organization Dashboard", "/orgDashboard");
  await registerFeature(
    "Organization Analytics & Insights",
    "/stats/organization"
  );
  await registerFeature(
    "Class Base Analytics & Insights",
    "/stats/classes"
  );
  await registerFeature("Progressive Student Report", "/termDetails");
  await registerFeature("Attendance Tracking", "/attendanceCollection");
  await registerFeature("Assessment Tracking", "/assessment");
  await registerFeature("Set Assessment Questions", "/allClassAssessmentExams");
  await registerFeature("Parent/Guardian Portal", "/guardian");
  await registerFeature("Create Files", "/documents");
  await registerFeature("Class Base Merit Sheet", "/meritSheetPage");
  await registerFeature("Terminal Report", "/reportSettings");
  await registerFeature("Official School Transcript", "/transcript");
  await registerFeature("Student and Guardian Profile", "/studentDetails");
  process.exit(0); // Clean exit after registration
})();
