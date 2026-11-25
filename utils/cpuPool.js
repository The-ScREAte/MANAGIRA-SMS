"use strict";

// Runs heavy, CPU-only work (building and reading spreadsheets) on worker threads so one big
// export never freezes every other signed-in person on the server.
//   CPU_WORKERS      how many threads may run at once (default 2 on 4+ cores, else 1).
//                    0 runs the work on the main thread, exactly as before.
//   CPU_WORKER_MB    each thread's memory ceiling (default 512). A file too big for it stops
//                    the thread and fails that one request, never the server.
//   CPU_TASK_MS      longest one task may take (default 120000).
//   CPU_QUEUE_MAX    most tasks waiting for a free thread (default 40); more get a "busy" error.
// Threads start on first use and close after a minute idle, so a quiet server holds no extra memory.
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const configured = process.env.CPU_WORKERS;
const MAX_WORKERS = configured === undefined || configured === ""
  ? (os.availableParallelism ? os.availableParallelism() : os.cpus().length) >= 4 ? 2 : 1
  : Math.max(0, parseInt(configured, 10) || 0);
const WORKER_MB = Number(process.env.CPU_WORKER_MB) || 512;
const TASK_MS = Number(process.env.CPU_TASK_MS) || 120000;
const QUEUE_MAX = Number(process.env.CPU_QUEUE_MAX) || 40;
const IDLE_MS = Number(process.env.CPU_WORKER_IDLE_MS) || 60000;

const workers = []; // { worker, busy, job, idleTimer }
const queue = [];
const counters = { ran: 0, failed: 0, inline: 0 };
let nextId = 1;

function busyError() {
  return Object.assign(new Error("The server is busy building files. Try again in a moment."), { status: 503 });
}

function startWorker() {
  const worker = new Worker(path.join(__dirname, "cpuWorker.js"), { resourceLimits: { maxOldGenerationSizeMb: WORKER_MB } });
  const slot = { worker, busy: false, job: null, idleTimer: null, dead: false };
  const fail = (error) => {
    if (slot.dead) return;
    slot.dead = true;
    clearTimeout(slot.idleTimer);
    const index = workers.indexOf(slot);
    if (index >= 0) workers.splice(index, 1);
    if (slot.job) {
      clearTimeout(slot.job.timer);
      counters.failed += 1;
      slot.job.reject(error);
      slot.job = null;
    }
    worker.terminate().catch(() => {});
    pump();
  };
  worker.on("message", (message) => {
    const job = slot.job;
    if (!job || job.id !== message.id) return;
    clearTimeout(job.timer);
    slot.job = null;
    slot.busy = false;
    slot.worker.unref();
    armIdle(slot);
    if (message.ok) { counters.ran += 1; job.resolve(message.result); } else {
      counters.failed += 1;
      job.reject(Object.assign(new Error(message.error.message), message.error.status ? { status: message.error.status } : {}));
    }
    pump();
  });
  worker.on("error", (error) => fail(/memory|heap/i.test(String(error && error.message)) || (error && error.code === "ERR_WORKER_OUT_OF_MEMORY")
    ? Object.assign(new Error("That file is too big to process."), { status: 413 }) : error));
  worker.on("exit", () => fail(new Error("The file worker stopped.")));
  // After the listeners: adding a 'message' listener takes the thread back into the event loop's count.
  worker.unref();
  workers.push(slot);
  return slot;
}

function armIdle(slot) {
  clearTimeout(slot.idleTimer);
  slot.idleTimer = setTimeout(() => {
    if (slot.busy || slot.dead) return;
    slot.dead = true;
    const index = workers.indexOf(slot);
    if (index >= 0) workers.splice(index, 1);
    slot.worker.terminate().catch(() => {});
  }, IDLE_MS);
  slot.idleTimer.unref();
}

function pump() {
  while (queue.length) {
    let slot = workers.find((candidate) => !candidate.busy && !candidate.dead);
    if (!slot && workers.length < MAX_WORKERS) {
      try { slot = startWorker(); } catch (error) { queue.shift().reject(error); continue; }
    }
    if (!slot) return;
    const job = queue.shift();
    clearTimeout(slot.idleTimer);
    slot.busy = true;
    slot.worker.ref(); // a script waiting on this job must not exit under it
    slot.job = job;
    job.timer = setTimeout(() => {
      // Stuck or far too slow: stop that thread; its request fails, nobody else is touched.
      slot.worker.terminate().catch(() => {});
    }, TASK_MS);
    job.timer.unref();
    try {
      slot.worker.postMessage({ id: job.id, task: job.task, payload: job.payload });
    } catch (error) {
      clearTimeout(job.timer);
      slot.job = null;
      slot.busy = false;
      slot.worker.unref();
      armIdle(slot);
      job.reject(error);
    }
  }
}

// run("buildReportWorkbook", { spec, values }) -> the task's result (byte results as a Buffer).
function run(task, payload) {
  if (MAX_WORKERS === 0) {
    counters.inline += 1;
    return Promise.resolve().then(() => require("./spreadsheetTasks")[task](payload));
  }
  if (queue.length >= QUEUE_MAX) return Promise.reject(busyError());
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, task, payload, resolve, reject, timer: null });
    pump();
  }).then((result) => (result instanceof Uint8Array && !Buffer.isBuffer(result)
    ? Buffer.from(result.buffer, result.byteOffset, result.byteLength) : result));
}

const stats = () => ({ maxWorkers: MAX_WORKERS, workers: workers.length, busy: workers.filter((w) => w.busy).length, waiting: queue.length, ...counters });

module.exports = { run, stats };
