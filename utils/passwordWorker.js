"use strict";

// One password worker (utils/passwordHashing.js): runs bcryptjs off the main thread.
const { parentPort } = require("worker_threads");
const bcrypt = require("bcryptjs");

parentPort.on("message", ({ id, op, args }) => {
  try {
    const result = op === "compare" ? bcrypt.compareSync(args[0], args[1]) : bcrypt.hashSync(args[0], args[1]);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: (error && error.message) || String(error) });
  }
});
