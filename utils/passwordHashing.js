"use strict";

// bcrypt on worker threads. A password check is slow on purpose (about 60-100 ms of CPU), and on
// the main thread a burst of sign-ins (the morning rush) held up every other request: at 30
// sign-ins a second each one waited about 20 seconds and ordinary pages up to 2 seconds. The
// workers run the same bcryptjs, so hashes and answers are exactly as before; if a worker can't
// start or stops, the check runs here instead. Use this in place of require("bcryptjs").
const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");
const bcrypt = require("bcryptjs");

const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const SIZE = Math.max(1, Math.min(Number(process.env.PASSWORD_WORKERS) || 2, cores));
const WORKER_FILE = path.join(__dirname, "passwordWorker.js");

const workers = [];
const pending = new Map(); // job id -> { resolve, reject, worker, op, args }
let nextId = 1;
let disabled = false;

const local = (op, args) => (op === "compare" ? bcrypt.compare(args[0], args[1]) : bcrypt.hash(args[0], args[1]));

function retire(worker) {
  const at = workers.indexOf(worker);
  if (at !== -1) workers.splice(at, 1);
  // Anything this worker still held is done here instead, so no sign-in is lost.
  for (const [id, job] of pending) {
    if (job.worker !== worker) continue;
    pending.delete(id);
    local(job.op, job.args).then(job.resolve, job.reject);
  }
}

function spawn() {
  const worker = new Worker(WORKER_FILE);
  worker.busy = 0;
  worker.unref();
  worker.on("message", ({ id, result, error }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    worker.busy -= 1;
    if (error !== undefined) job.reject(new Error(error));
    else job.resolve(result);
  });
  worker.on("error", () => retire(worker));
  worker.on("exit", () => retire(worker));
  workers.push(worker);
  return worker;
}

function run(op, args) {
  if (disabled) return local(op, args);
  let worker;
  try {
    while (workers.length < SIZE) spawn();
    worker = workers.reduce((least, w) => (w.busy < least.busy ? w : least));
  } catch (_) {
    disabled = true;
    return local(op, args);
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, worker, op, args });
    worker.busy += 1;
    try {
      worker.postMessage({ id, op, args });
    } catch (_) {
      pending.delete(id);
      worker.busy -= 1;
      local(op, args).then(resolve, reject);
    }
  });
}

// Promise style, like bcryptjs; a callback as the last argument also works.
const withCallback = (promise, cb) => {
  if (typeof cb !== "function") return promise;
  promise.then((value) => cb(null, value), (error) => cb(error));
  return undefined;
};

module.exports = {
  ...bcrypt,
  compare: (password, hash, cb) => withCallback(run("compare", [password, hash]), cb),
  hash: (password, saltOrRounds, cb) => withCallback(run("hash", [password, saltOrRounds]), cb),
};
