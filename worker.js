// Background worker: runs the scheduled jobs (billing, payouts, emails, digests,
// Google Classroom sync) without serving web pages.
// On Render: a Background Worker with start command `node worker.js`, and
// RUN_SCHEDULED_JOBS=false on the web service so jobs run in one place.
require("dotenv").config();
require("./utils/processGuards").install("Worker");
require("./utils/memoryRelief").install();
const scheduler = require("./jobs/scheduler");
const db = require("./config/db");
const { runningJobCount } = require("./utils/dbLock");

console.log("[Worker] Scheduled jobs running.");
// Stay up even if every job is switched off by env flags.
const keepRunning = setInterval(() => {}, 60 * 60 * 1000);

// On a deploy: start nothing new, let running jobs finish (Render waits about
// 30 seconds), then close the database pool.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[Worker] ${signal}: finishing ${runningJobCount()} running job(s).`);
  scheduler.stopAll();
  const deadline = Date.now() + 25000;
  while (runningJobCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  clearInterval(keepRunning);
  await db.end().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
