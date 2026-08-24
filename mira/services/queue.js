// Background queue for work that must never sit in a chat request's
// critical path (incremental re-indexing, long report generation). Backed
// by BullMQ on the same Redis instance the rest of Mira uses. If Redis
// isn't configured, queue operations fall back to running inline
// (synchronous, not backgrounded) rather than crashing the service -
// acceptable in dev/early deploys, called out clearly in logs and in
// README-MIRA.md as a production requirement.
const { bullConnectionOptions } = require("../config/redis");

const REINDEX_QUEUE_NAME = "mira-reindex";

let queueInstance = null;
let queueUnavailableWarned = false;

function getReindexQueue() {
  const connection = bullConnectionOptions();
  if (!connection) {
    if (!queueUnavailableWarned) {
      console.warn(
        "[mira/queue] REDIS_URL not set - background re-indexing will run inline instead of queued. Set REDIS_URL before production use."
      );
      queueUnavailableWarned = true;
    }
    return null;
  }
  if (!queueInstance) {
    const { Queue } = require("bullmq");
    queueInstance = new Queue(REINDEX_QUEUE_NAME, { connection });
  }
  return queueInstance;
}

// Enqueues reindexing for one source document; falls back to calling
// `inlineFallback` immediately if no queue is available.
async function enqueueReindex(job, inlineFallback) {
  const queue = getReindexQueue();
  if (!queue) {
    if (typeof inlineFallback === "function") await inlineFallback(job);
    return { queued: false };
  }
  await queue.add("reindex", job, { removeOnComplete: 1000, removeOnFail: 1000 });
  return { queued: true };
}

module.exports = { REINDEX_QUEUE_NAME, getReindexQueue, enqueueReindex };
