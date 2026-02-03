const db = require('../config/db');

const registerFeature = async (featureName, routePath) => {
  try {
    const featureResult = await db.query(
      `INSERT INTO features (feature_name, price_usd)
       VALUES ($1, 0)
       ON CONFLICT (feature_name) DO UPDATE SET feature_name = EXCLUDED.feature_name
       RETURNING id`,
      [featureName]
    );

    const featureId = featureResult.rows[0].id;

    await db.query(
      `INSERT INTO feature_routes (feature_id, route_path)
       VALUES ($1, $2)
       ON CONFLICT (route_path) DO NOTHING`,
      [featureId, routePath]
    );

  } catch (err) {
    console.error('❌ Error registering feature:', err);
  }
};

module.exports = { registerFeature };
