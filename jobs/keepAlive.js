const cron = require("node-cron");
const axios = require("axios");

/**
 * Keep-Alive Job
 * Pings the server every 5 minutes to prevent cold starts
 * on free hosting platforms like Render, Railway, etc.
 */

const BASE_URL =
  process.env.NODE_ENV === "production"
    ? process.env.BASE_URL_PRODUCTION
    : process.env.BASE_URL_LOCAL;

// Only run keep-alive in production to avoid unnecessary pings in development
if (process.env.NODE_ENV === "production" && BASE_URL) {
  // Run every 10 minutes: */10 * * * *
  cron.schedule("*/10 * * * *", async () => {
    try {
      await axios.get(`${BASE_URL}/health`, {
        timeout: 10000, // 10 second timeout
      });
      // Silent ping - logs removed for clean console
    } catch (error) {
      // Only log errors
      console.error(`[Keep-Alive] ❌ Ping failed:`, error.message);
    }
  });

  console.log("[Keep-Alive] 🔄 Self-ping scheduler started (every 10 minutes)");
} else {
  console.log("[Keep-Alive] ⏸️  Disabled in development mode");
}
