// scripts/setupLessonNotesFeature.js
// Creates the "Lesson Notes" feature in pricing without binding it to any route.
// Run once: node scripts/setupLessonNotesFeature.js

const db = require("../config/db");

(async () => {
  try {
    await db.query(
      `INSERT INTO features (feature_name, price_usd)
       VALUES ($1, 0)
       ON CONFLICT (feature_name) DO UPDATE SET feature_name = EXCLUDED.feature_name`,
      ["Lesson Notes"]
    );

    console.log("✅ Lesson Notes feature created for service pricing.");
  } catch (err) {
    console.error("❌ Failed to create Lesson Notes feature:", err);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
