"use strict";

// Watches this server's memory use. Before it reaches the hosting limit (when
// the host restarts the server and visitors see errors), it frees what can be
// rebuilt: in-memory caches, the idle PDF browser and visitor lookup tables.
// Nothing saved by users is touched; caches simply refill from the database.
const fs = require("fs");

const CHECK_MS = Number(process.env.MEMORY_GUARD_INTERVAL_MS) || 15000;
const SOFT_RATIO = Number(process.env.MEMORY_GUARD_SOFT_RATIO) || 0.75;
const HARD_RATIO = Number(process.env.MEMORY_GUARD_HARD_RATIO) || 0.88;
const MB = 1024 * 1024;

// The container's memory limit: MEMORY_LIMIT_MB if set, otherwise read from
// the Linux cgroup (Render, Docker). Null when it can't be determined.
function detectMemoryLimitBytes() {
  const fromEnv = Number(process.env.MEMORY_LIMIT_MB);
  if (fromEnv > 0) return fromEnv * MB;
  const files = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, "utf8").trim();
      const value = Number(raw);
      // "max" or a huge number means no limit.
      if (Number.isFinite(value) && value > 0 && value < 64 * 1024 * MB) return value;
    } catch (_) {}
  }
  return null;
}

// Pressure level for a given memory use: "ok", "soft" or "hard".
function pressureLevel(rssBytes, limitBytes, { soft = SOFT_RATIO, hard = HARD_RATIO } = {}) {
  if (!limitBytes) return "ok";
  const ratio = rssBytes / limitBytes;
  if (ratio >= hard) return "hard";
  if (ratio >= soft) return "soft";
  return "ok";
}

const relievers = [];
// Register a function that frees memory. level is "soft" or "hard".
function onPressure(fn) {
  if (typeof fn === "function") relievers.push(fn);
}

let lastLevel = "ok";
let lastLogAt = 0;
let limitBytes = null;

async function relieve(level) {
  for (const fn of relievers) {
    try {
      await fn(level);
    } catch (_) {}
  }
  if (typeof global.gc === "function") {
    try { global.gc(); } catch (_) {}
  }
}

async function check() {
  const rss = process.memoryUsage().rss;
  const level = pressureLevel(rss, limitBytes);
  if (level !== "ok") {
    const now = Date.now();
    if (level !== lastLevel || now - lastLogAt > 5 * 60 * 1000) {
      lastLogAt = now;
      const heap = process.memoryUsage();
      console.warn(
        `[MemoryGuard] ${level} pressure: rss=${Math.round(rss / MB)}MB of ${Math.round(limitBytes / MB)}MB ` +
        `(heap ${Math.round(heap.heapUsed / MB)}/${Math.round(heap.heapTotal / MB)}MB, buffers ${Math.round((heap.arrayBuffers || 0) / MB)}MB). Freeing caches.`
      );
    }
    await relieve(level);
  }
  lastLevel = level;
}

let timer = null;
function start() {
  if (timer) return;
  limitBytes = detectMemoryLimitBytes();
  if (!limitBytes) return; // no known limit: nothing to guard against
  console.log(`[MemoryGuard] Watching memory (limit ${Math.round(limitBytes / MB)}MB).`);
  timer = setInterval(() => { check().catch(() => {}); }, CHECK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function snapshot() {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round(usage.rss / MB),
    heapUsedMb: Math.round(usage.heapUsed / MB),
    limitMb: limitBytes ? Math.round(limitBytes / MB) : null,
    level: pressureLevel(usage.rss, limitBytes),
  };
}

module.exports = { start, onPressure, pressureLevel, detectMemoryLimitBytes, snapshot, relieve };
