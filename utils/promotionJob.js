// utils/promotionJob.js
const schedule = require("node-schedule");
const { applyScheduledPromotions } = require("../controllers/promotionController");


// Runs every minute (or adjust as needed)
schedule.scheduleJob("0 0 * * *", async () => {
  try {
    await applyScheduledPromotions();
  } catch (err) {
    console.error("❌ Error during automatic promotion apply:", err);
  }
});

