// scripts/setupPaygiraFeature.js
// Registers the "PayGira" plan feature and maps it to the PayGira finance route.
// Run once:  node scripts/setupPaygiraFeature.js
// Afterwards, assign "PayGira" to the desired plans (and set its price) from the
// admin Service Pricing page. Only organizations whose plan includes PayGira will
// see and access it in Settings, the Class Dashboard, and the Guardian Portal.

const { registerFeature } = require("../utils/featureRegistrar");

(async () => {
  try {
    await registerFeature("PayGira", "/account/settings/finance");
    console.log("✅ PayGira feature registered and mapped to /account/settings/finance.");
  } catch (err) {
    console.error("❌ Failed to register PayGira feature:", err);
  } finally {
    process.exit(0);
  }
})();
