// scripts/setupSetAssessmentQuestionsFeature.js
// Registers the "Set Assessment Questions" feature and maps it to plans that
// already include "Assessment Tracking".
// Run: node scripts/setupSetAssessmentQuestionsFeature.js

const db = require("../config/db");
const { registerFeature } = require("../utils/featureRegistrar");

(async () => {
  try {
    await registerFeature("Set Assessment Questions", "/allClassAssessmentExams");

    const featureResult = await db.query(
      `SELECT id FROM features WHERE LOWER(TRIM(feature_name)) = LOWER(TRIM($1)) LIMIT 1`,
      ["Set Assessment Questions"]
    );
    const assessmentTrackingResult = await db.query(
      `SELECT id FROM features WHERE LOWER(TRIM(feature_name)) = LOWER(TRIM($1)) LIMIT 1`,
      ["Assessment Tracking"]
    );

    const featureId = featureResult.rows[0]?.id;
    const assessmentTrackingId = assessmentTrackingResult.rows[0]?.id;

    if (!featureId) {
      throw new Error("Set Assessment Questions feature was not found after registration.");
    }

    let mappedCount = 0;
    if (assessmentTrackingId) {
      const mapResult = await db.query(
        `INSERT INTO plan_features (plan_id, feature_id)
         SELECT pf.plan_id, $1
         FROM plan_features pf
         WHERE pf.feature_id = $2
           AND NOT EXISTS (
             SELECT 1
             FROM plan_features existing
             WHERE existing.plan_id = pf.plan_id
               AND existing.feature_id = $1
           )`,
        [featureId, assessmentTrackingId]
      );
      mappedCount = Number(mapResult.rowCount || 0);
    }

    console.log(
      `✅ Set Assessment Questions feature is registered. Added to ${mappedCount} plan(s) that already have Assessment Tracking.`
    );
  } catch (error) {
    console.error("❌ Failed to set up Set Assessment Questions feature:", error);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
