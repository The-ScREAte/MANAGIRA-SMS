// Minimal in-memory fixed-window rate limiter for sensitive, low-volume
// endpoints (e.g. sending a test SMS, saving provider credentials) where a
// full Redis-backed limiter would be overkill. Not safe across multiple
// processes/instances — fine for this app's current single-process deploy.
const windows = new Map();

function checkRateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now - entry.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: max - 1 };
  }

  if (entry.count >= max) {
    const retryAfterMs = windowMs - (now - entry.start);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.count += 1;
  return { allowed: true, remaining: max - entry.count };
}

// Periodic cleanup so long-idle keys don't accumulate forever in memory.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows.entries()) {
    if (now - entry.start > 60 * 60 * 1000) windows.delete(key);
  }
}, 15 * 60 * 1000).unref();

module.exports = { checkRateLimit };
