const axios = require("axios");

/**
 * Keep-Alive Job
 * Keeps a free-tier instance warm by pinging before it would sleep.
 * Default assumes Render free sleep at 15 minutes, and pings 2 minutes earlier.
 */

const BASE_URL =
  process.env.NODE_ENV === "production"
    ? (process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL_PRODUCTION || process.env.BASE_URL_PRODUCTION_FALLBACK)
    : process.env.BASE_URL_LOCAL;

const KEEP_ALIVE_ENABLED = process.env.KEEP_ALIVE_ENABLED !== "false";
const RENDER_SLEEP_MINUTES = Number(process.env.RENDER_FREE_SLEEP_MINUTES) || 15;
const WAKE_BEFORE_MINUTES = Number(process.env.KEEP_ALIVE_WAKE_BEFORE_MINUTES) || 2;
const INTERVAL_OVERRIDE_MINUTES = Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES);
const calculatedIntervalMinutes = Math.max(1, RENDER_SLEEP_MINUTES - WAKE_BEFORE_MINUTES);
const DEFAULT_INTERVAL_MINUTES = 10;
const pingIntervalMinutes = Number.isFinite(INTERVAL_OVERRIDE_MINUTES) && INTERVAL_OVERRIDE_MINUTES > 0
  ? INTERVAL_OVERRIDE_MINUTES
  : DEFAULT_INTERVAL_MINUTES;
const pingIntervalMs = pingIntervalMinutes * 60 * 1000;

let pingInFlight = false;

async function pingSelf() {
  if (pingInFlight || !BASE_URL) {
    return;
  }

  pingInFlight = true;

  try {
    await axios.get(`${BASE_URL}/health`, {
      timeout: 10000,
    });
  } catch (error) {
    console.error("[Keep-Alive] ❌ Ping failed:", error.message);
  } finally {
    pingInFlight = false;
  }
}

// Only run keep-alive in production to avoid unnecessary pings in development
if (process.env.NODE_ENV === "production" && BASE_URL && KEEP_ALIVE_ENABLED) {
  // The first ping waits a full interval: at startup this instance isn't serving yet,
  // so pinging straight away only logged a 502.
  setInterval(pingSelf, pingIntervalMs);

  console.log(
    `[Keep-Alive] 🔄 Self-ping scheduler started (every ${pingIntervalMinutes} minute${pingIntervalMinutes === 1 ? "" : "s"}; Render sleep=${RENDER_SLEEP_MINUTES}m, wake-before=${WAKE_BEFORE_MINUTES}m)`
  );
} else {
  // Keep-alive disabled in dev.
}
