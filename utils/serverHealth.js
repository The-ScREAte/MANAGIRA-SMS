"use strict";

// What /health/detail reports: how busy this one server is. Event-loop lag is the best single
// sign that a server is full (every request waits when the loop is late), so it's measured here
// and reported as a rolling window.
const { monitorEventLoopDelay } = require("node:perf_hooks");
const crypto = require("node:crypto");

let histogram = null;
let windowStartedAt = Date.now();
let last = { p50: 0, p99: 0, max: 0, windowSec: 0 };

function startMonitoring() {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
}

// Lag over the time since the previous call (at least 10 seconds), in milliseconds.
function eventLoopLag() {
  startMonitoring();
  const now = Date.now();
  if (now - windowStartedAt >= 10000 && histogram.count > 0) {
    last = {
      p50: +(histogram.percentile(50) / 1e6).toFixed(1),
      p99: +(histogram.percentile(99) / 1e6).toFixed(1),
      max: +(histogram.max / 1e6).toFixed(1),
      windowSec: Math.round((now - windowStartedAt) / 1000),
    };
    histogram.reset();
    windowStartedAt = now;
  }
  return last;
}

// The server's own computer, or someone holding HEALTH_DETAIL_TOKEN. With neither, no answer at all.
function mayReadDetail(req, env = process.env) {
  const token = env.HEALTH_DETAIL_TOKEN;
  const given = String(req.headers["x-health-token"] || "");
  if (token && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return true;
  const address = (req.socket && req.socket.remoteAddress) || "";
  const direct = !req.headers["x-forwarded-for"] && !req.headers["x-forwarded-host"];
  return direct && (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1");
}

function detail(db, cpuPool) {
  const memory = process.memoryUsage();
  return {
    status: "ok",
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
    pool: db.getPoolStats ? db.getPoolStats() : null,
    eventLoopLagMs: eventLoopLag(),
    memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576) },
    fileWorkers: cpuPool ? cpuPool.stats() : null,
    cluster: process.env.CLUSTER_WORKER ? { worker: Number(process.env.CLUSTER_WORKER), of: Number(process.env.CLUSTER_WORKERS) || 1, leader: process.env.CLUSTER_LEADER === "1" } : null,
    jobsHere: require("./jobsSwitch").jobsEnabled(),
  };
}

module.exports = { startMonitoring, eventLoopLag, mayReadDetail, detail };
