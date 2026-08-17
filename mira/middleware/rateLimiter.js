// Per-user and per-tenant request rate limiting on Mira endpoints. Redis
// fixed-window counters (INCR + EXPIRE), same instance as the rest of
// Mira; falls back to an in-memory Map (single-process only, same
// trade-off the main app's own rate limiter documents for itself) when
// Redis isn't configured, so the service still degrades gracefully rather
// than either crashing or silently having no limit at all.
const { getRedisClient, prefixed } = require("../config/redis");

const WINDOW_SEC = 60;
const memoryWindows = new Map();

function memoryIncrement(key) {
  const now = Date.now();
  const windowStart = Math.floor(now / (WINDOW_SEC * 1000));
  const mapKey = `${key}:${windowStart}`;
  const count = (memoryWindows.get(mapKey) || 0) + 1;
  memoryWindows.set(mapKey, count);
  if (memoryWindows.size > 5000) {
    const oldestKey = memoryWindows.keys().next().value;
    memoryWindows.delete(oldestKey);
  }
  return count;
}

async function incrementWindow(key) {
  const client = await getRedisClient();
  if (!client) return memoryIncrement(key);

  const redisKey = prefixed(`ratelimit:${key}`);
  const count = await client.incr(redisKey);
  if (count === 1) await client.expire(redisKey, WINDOW_SEC);
  return count;
}

function rateLimiter({ perUserPerMinute = 20, perTenantPerMinute = 100 } = {}) {
  return async function rateLimiterMiddleware(req, res, next) {
    if (!req.tenant) return next(); // ssoAuth/tenantScope should already have rejected this

    try {
      const [userCount, tenantCount] = await Promise.all([
        incrementWindow(`user:${req.tenant.viewerType}:${req.tenant.userId}`),
        incrementWindow(`tenant:${req.tenant.organizationId}`),
      ]);

      if (userCount > perUserPerMinute) {
        return res.status(429).json({ error: "You're sending requests a bit fast - please wait a moment and try again." });
      }
      if (tenantCount > perTenantPerMinute) {
        return res.status(429).json({ error: "Your school has hit Mira's request limit for this minute. Please try again shortly." });
      }
      next();
    } catch (error) {
      console.error("[mira/rateLimiter] error, allowing request through:", error.message);
      next();
    }
  };
}

module.exports = { rateLimiter };
