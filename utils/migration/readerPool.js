"use strict";
// The main thread's side of the reader thread (utils/migration/readerWorker.js). One thread per
// server, started when a migration needs it and stopped after a minute with nothing to do. Its
// memory is capped, so a file too large to read stops the thread, never the server.
const path = require("path");
const { Worker } = require("worker_threads");

const IDLE_MS = 60 * 1000;
const TIMEOUT_MS = 10 * 60 * 1000;
const MEMORY_MB = Math.max(256, Number(process.env.MIGRATION_READER_MEMORY_MB) || 512);

let worker = null;
let idleTimer = null;
let nextId = 1;
const pending = new Map();

function stopIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
function idleLater() {
  stopIdle();
  if (pending.size || !worker) return;
  idleTimer = setTimeout(() => { if (!pending.size && worker) { const w = worker; worker = null; w.terminate().catch(() => {}); } }, IDLE_MS);
  idleTimer.unref();
}
function failAll(message) {
  for (const [id, call] of pending) { pending.delete(id); call.fail(new Error(message)); }
}
function thread() {
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, "readerWorker.js"), { resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
  w.on("message", (message) => {
    const call = pending.get(message.id);
    if (!call) return;
    if (message.type === "chunk") return call.chunk(message.value);
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.type === "error") call.fail(new Error(message.message));
    else call.done(message.value);
    idleLater();
  });
  w.on("error", (error) => {
    if (worker === w) worker = null;
    failAll(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "That file is too large to read in one go. Export it in smaller parts." : error.message);
  });
  w.on("exit", () => {
    if (worker === w) worker = null;
    failAll("The file reader stopped. Try again.");
  });
  worker = w;
  return w;
}

function send(op, { content, compressed = false, name = "" }, onChunk = null) {
  stopIdle();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const call = {
      done: resolve, fail: reject, chunk: onChunk || (() => {}),
      timer: setTimeout(() => { pending.delete(id); reject(new Error("Reading the file took too long.")); if (worker) { const w = worker; worker = null; w.terminate().catch(() => {}); } }, TIMEOUT_MS),
    };
    call.timer.unref();
    pending.set(id, call);
    thread().postMessage({ id, op, content, compressed, name });
  });
}

// An upload as the lists it holds (each compressed, with its heading row and first rows).
const toBuffer = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
const expand = (content, { compressed = false, name = "" } = {}) => send("expand", { content, compressed, name })
  .then((lists) => lists.map((l) => (l.gz ? { ...l, gz: toBuffer(l.gz) } : l.content ? { ...l, content: toBuffer(l.content) } : l)));

// A stored list's rows, a chunk at a time: `for await (const { header, rows, offset } of rows(...))`.
async function* rows(content, compressed) {
  const queue = [];
  let wake = null;
  let finished = false;
  let failure = null;
  send("rows", { content, compressed }, (chunk) => { queue.push(chunk); if (wake) { wake(); wake = null; } })
    .then(() => { finished = true; if (wake) { wake(); wake = null; } })
    .catch((error) => { failure = error; finished = true; if (wake) { wake(); wake = null; } });
  for (;;) {
    if (queue.length) { yield queue.shift(); continue; }
    if (failure) throw failure;
    if (finished) return;
    await new Promise((resolve) => { wake = resolve; });
  }
}

module.exports = { expand, rows };
