"use strict";

// Uploads are held in memory while they're read (photos, imports, slideshow
// files). Several large uploads arriving together could add hundreds of MB at
// once and get the server restarted for exceeding its memory. This lets only a
// few large uploads be read at the same time; the rest wait their turn (up to
// a limit) instead of all landing in memory together.
const LARGE_UPLOAD_BYTES = Number(process.env.UPLOAD_GATE_MIN_BYTES) || 2 * 1024 * 1024;
const MAX_CONCURRENT = Math.max(1, Number(process.env.UPLOAD_GATE_CONCURRENCY) || 2);
const MAX_WAIT_MS = Number(process.env.UPLOAD_GATE_MAX_WAIT_MS) || 45000;
const MAX_QUEUE = Number(process.env.UPLOAD_GATE_MAX_QUEUE) || 20;
// One request brings at most this much into memory (a school's slideshow included).
const MAX_TOTAL_BYTES = Number(process.env.UPLOAD_GATE_MAX_TOTAL_BYTES) || 120 * 1024 * 1024;

function createUploadGate({ maxTotalBytes = MAX_TOTAL_BYTES, minBytes = LARGE_UPLOAD_BYTES, concurrency = MAX_CONCURRENT, maxWaitMs = MAX_WAIT_MS, maxQueue = MAX_QUEUE } = {}) {
  let active = 0;
  const queue = [];

  function release() {
    active = Math.max(0, active - 1);
    while (queue.length && active < concurrency) {
      const next = queue.shift();
      if (next.cancelled) continue;
      clearTimeout(next.timer);
      active += 1;
      next.start();
    }
  }

  function busy(res) {
    res.set("Retry-After", "10");
    return res.status(503).type("txt").send("The server is busy handling other uploads. Please try again in a moment.");
  }

  const middleware = (req, res, next) => {
    const type = String(req.headers["content-type"] || "");
    const length = Number(req.headers["content-length"] || 0);
    // Uploads without a declared size are gated too (could be any size).
    const isLarge = /multipart\/form-data/i.test(type) && (!length || length >= minBytes);
    if (!isLarge) return next();
    // Admin uploads go to disk, so only the wait applies to them.
    if (length > maxTotalBytes && !/^\/admin(\/|$)/.test(req.path)) {
      return res.status(413).type("txt").send(`These files are too large to upload together. Please send under ${Math.round(maxTotalBytes / (1024 * 1024))} MB at a time.`);
    }

    const start = () => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        release();
      };
      res.once("finish", finish);
      res.once("close", finish);
      next();
    };

    if (active < concurrency) {
      active += 1;
      return start();
    }
    if (queue.length >= maxQueue) return busy(res);

    const entry = { start, cancelled: false, timer: null };
    entry.timer = setTimeout(() => {
      entry.cancelled = true;
      if (!res.headersSent) busy(res);
    }, maxWaitMs);
    req.once("close", () => {
      entry.cancelled = true;
      clearTimeout(entry.timer);
    });
    queue.push(entry);
  };

  middleware.stats = () => ({ active, waiting: queue.filter((e) => !e.cancelled).length });
  return middleware;
}

module.exports = { createUploadGate };
