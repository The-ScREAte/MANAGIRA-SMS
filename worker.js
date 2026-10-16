// Background worker: runs the scheduled jobs (billing, payouts, emails, digests,
// Google Classroom sync) without serving web pages.
// On Render: a Background Worker with start command `node worker.js`, and
// RUN_SCHEDULED_JOBS=false on the web service so jobs run in one place.
require("dotenv").config();
require("./jobs/scheduler");

const db = require("./config/db");

console.log("[Worker] Scheduled jobs running.");
// Stay up even if every job is switched off by env flags.
const keepRunning = setInterval(() => {}, 60 * 60 * 1000);

function shutdown(signal) {
  console.log(`[Worker] ${signal} received, closing.`);
  clearInterval(keepRunning);
  db.end().finally(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
