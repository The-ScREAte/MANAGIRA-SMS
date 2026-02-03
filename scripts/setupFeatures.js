const { registerFeature } = require("../utils/featureRegistrar");

(async () => {
  await registerFeature("School Website", "/publicDashboard");
  await registerFeature("Organization Dashboard", "/");
  await registerFeature(
    "Organization Analytics & Insights",
    "/stats/organization"
  );
  await registerFeature(
    "Class Base Analytics & Insights",
    "/attendanceCollection"
  );
  await registerFeature("Progressive Student Report ", "/");
  await registerFeature("Attendance tracking feature", "/");
  await registerFeature("Assessment tracking feature", "/");
  await registerFeature("Class Base Merrit sheet", "/meritSheetPage");
  await registerFeature("Terminal Report", "/");
  await registerFeature("Official School Transcript", "/transcript");
  await registerFeature("Student and Guardian Profile", "/");
  process.exit(0); // Clean exit after registration
})();
