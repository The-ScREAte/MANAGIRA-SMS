"use strict";

// The worker thread behind utils/cpuPool.js: runs one named task from utils/spreadsheetTasks.js
// at a time and sends the answer back. Byte results are copied into their own buffer and
// handed over, not cloned.
const { parentPort } = require("node:worker_threads");
const tasks = require("./spreadsheetTasks");

parentPort.on("message", async ({ id, task, payload }) => {
  try {
    if (typeof tasks[task] !== "function") throw new Error(`Unknown task ${task}`);
    const result = await tasks[task](payload);
    if (result instanceof Uint8Array) {
      const bytes = new Uint8Array(result.length);
      bytes.set(result);
      parentPort.postMessage({ id, ok: true, result: bytes }, [bytes.buffer]);
    } else {
      parentPort.postMessage({ id, ok: true, result });
    }
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: { message: String((error && error.message) || error), status: error && error.status } });
  }
});
