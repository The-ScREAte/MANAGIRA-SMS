"use strict";

// One server using several cores. WEB_CONCURRENCY=N (default 1: nothing changes, one process as
// always) makes `node server.js` a small supervisor that starts N copies of the app. The operating
// system hands each incoming connection to one of them, so N cores answer pages at once.
//
//   - Only worker 1 (the leader, CLUSTER_LEADER=1) runs the scheduled jobs, the shard sync, the
//     keep-alive ping and Mira; the others serve pages only. (Every job also takes a Postgres lock,
//     so a second leader after a crash could never double-run one.) If the leader dies, its
//     replacement is the leader again.
//   - A save in one worker clears the school's kept answers (utils/shortCache.js) in the others
//     straight away, through the supervisor.
//   - The database pool size you set (DB_POOL_MAX) is the whole server's: it is shared out between
//     the workers, so adding cores never adds database connections by itself.
//   - Bus positions are saved to the database every 3 seconds in this mode (LIVE_BUS_SAVE_MS), so a
//     parent whose request lands on another worker sees a position at most a few seconds old.
//   - On SIGTERM / SIGINT every worker stops taking new requests, finishes the ones open (up to 20
//     seconds) and exits; the supervisor then exits 0. A worker that crashes is replaced, with a
//     pause when it keeps crashing right away.
const cluster = require("node:cluster");

const MAX_WORKERS = 32;
function workerCount(env = process.env) {
  const wanted = parseInt(env.WEB_CONCURRENCY, 10);
  return Number.isFinite(wanted) && wanted > 1 ? Math.min(wanted, MAX_WORKERS) : 1;
}

// True when this process is the supervisor (the caller then loads nothing else).
function start() {
  const count = workerCount();
  if (count <= 1 || !cluster.isPrimary) return false;

  let stopping = false;
  // Every worker must stamp its assets alike (a page from one, a script from another).
  const sharedVersion = process.env.RENDER_GIT_COMMIT || String(Date.now());
  const byIndex = new Map(); // index -> worker
  const quickDeaths = new Map(); // index -> consecutive deaths within 10 s of starting

  const fork = (index) => {
    const worker = cluster.fork({ RENDER_GIT_COMMIT: sharedVersion, CLUSTER_WORKER: String(index), CLUSTER_WORKERS: String(count), CLUSTER_LEADER: index === 1 ? "1" : "0" });
    worker.startedAt = Date.now();
    worker.clusterIndex = index;
    byIndex.set(index, worker);
    return worker;
  };

  cluster.on("message", (from, message) => {
    // A school's save: tell every other worker (shortCache / stableReads generations).
    if (message && message.type === "forget") {
      for (const worker of byIndex.values()) if (worker !== from && worker.isConnected()) worker.send(message);
    }
  });

  cluster.on("exit", (worker, code, signal) => {
    if (byIndex.get(worker.clusterIndex) === worker) byIndex.delete(worker.clusterIndex);
    if (stopping) {
      if (!byIndex.size) { console.log("[Cluster] All workers stopped."); process.exit(0); }
      return;
    }
    const index = worker.clusterIndex;
    const quick = Date.now() - worker.startedAt < 10000;
    const deaths = quick ? (quickDeaths.get(index) || 0) + 1 : 0;
    quickDeaths.set(index, deaths);
    const pause = deaths >= 3 ? 10000 : 500;
    console.error(`[Cluster] Worker ${index} (pid ${worker.process.pid}) stopped (${signal || code}); starting another in ${pause} ms.`);
    setTimeout(() => { if (!stopping) fork(index); }, pause);
  });

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[Cluster] ${signal}: asking ${byIndex.size} worker(s) to finish their requests and stop.`);
    for (const worker of byIndex.values()) { try { worker.process.kill("SIGTERM"); } catch (_) { /* already gone */ } }
    if (!byIndex.size) process.exit(0);
    setTimeout(() => {
      console.warn("[Cluster] Workers still running after 25 seconds; stopping them.");
      for (const worker of byIndex.values()) { try { worker.process.kill("SIGKILL"); } catch (_) { /* gone */ } }
      process.exit(0);
    }, 25000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  console.log(`[Cluster] Starting ${count} workers (worker 1 runs the scheduled jobs).`);
  for (let index = 1; index <= count; index += 1) fork(index);
  return true;
}

// In a worker: pass this worker's saves to the others, and apply theirs.
function installWorker() {
  if (!cluster.isWorker) return;
  const shortCache = require("./shortCache");
  shortCache.onForget((schoolId) => { if (process.connected) process.send({ type: "forget", schoolId }); });
  process.on("message", (message) => {
    if (message && message.type === "forget") shortCache.forgetSchool(message.schoolId, true);
  });
}

// Worker 1 (or any process that isn't part of a cluster) is the one that runs singleton work.
const isLeader = (env = process.env) => !env.CLUSTER_WORKER || env.CLUSTER_LEADER === "1";

module.exports = { start, installWorker, workerCount, isLeader };
