// Reuses the same Redis instance as the main app's utils/cacheManager.js
// (same REDIS_URL), under its own key prefix so the two services' cache
// entries never collide. Lazy-connect, optional: if REDIS_URL is unset or
// the connection fails, callers get `null` back and must degrade
// gracefully (matching the main app's own optional-Redis convention) -
// rate limiting and the SSO identity cache both have in-memory fallbacks
// for this reason; BullMQ (services/queue) genuinely requires Redis and
// logs a clear warning instead of crashing when it's unavailable.
require("dotenv").config();

const REDIS_URL = process.env.REDIS_URL || "";
const KEY_PREFIX = process.env.MIRA_REDIS_PREFIX || "mira:cache";

let clientPromise = null;

async function getRedisClient() {
  if (!REDIS_URL) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const redisModule = require("redis");
        const client = redisModule.createClient({ url: REDIS_URL });
        client.on("error", (err) => console.error("[mira/redis] client error", err.message));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[mira/redis] failed to connect, falling back to no-cache:", error.message);
        return null;
      }
    })();
  }
  return clientPromise;
}

function prefixed(key) {
  return `${KEY_PREFIX}:${key}`;
}

function bullConnectionOptions() {
  if (!REDIS_URL) return null;
  return { url: REDIS_URL };
}

module.exports = { getRedisClient, prefixed, bullConnectionOptions, REDIS_URL_CONFIGURED: !!REDIS_URL };
