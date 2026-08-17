// BullMQ worker consuming the mira-reindex queue (services/queue.js).
// Started as its own process (`node jobs/reindexWorker.js`), separate from
// the request-serving server.js, so heavy re-embedding work never competes
// with chat request latency. No-op until phase 5's ragService/vectorStore
// land - this just proves the queue plumbing runs end to end.
require("dotenv").config();
const { bullConnectionOptions, REDIS_URL_CONFIGURED } = require("../config/redis");
const { REINDEX_QUEUE_NAME } = require("../services/queue");

if (!REDIS_URL_CONFIGURED) {
  console.warn("[mira/reindexWorker] REDIS_URL not set - nothing to consume, exiting. Set REDIS_URL to run this worker.");
  process.exit(0);
}

const { Worker } = require("bullmq");

async function processReindexJob(job) {
  const { reindexSource } = require("../services/ragService");
  return reindexSource(job.data);
}

const worker = new Worker(REINDEX_QUEUE_NAME, processReindexJob, {
  connection: bullConnectionOptions(),
  concurrency: 2,
});

worker.on("completed", (job) => {
  console.log(`[mira/reindexWorker] completed job ${job.id} (${job.data?.sourceType}:${job.data?.sourceId})`);
});
worker.on("failed", (job, err) => {
  console.error(`[mira/reindexWorker] job ${job?.id} failed:`, err.message);
});

console.log("[mira/reindexWorker] listening for reindex jobs...");
