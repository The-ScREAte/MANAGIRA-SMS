// Single sign-on: a user already logged into the main Managira app reaches
// Mira with no second login. Reads the shared `connect.sid` cookie
// (readable here because the production session cookie's domain is
// ".managira.com" - already configured on the main app, nothing to change),
// validates it against the main app's internal API (never against the
// session table directly - see internalApiClient.js), and caches the
// result briefly in Redis so every keystroke doesn't round-trip to the
// main app. Falls back to an in-memory cache if Redis is unavailable.
const cookie = require("cookie");
const crypto = require("crypto");
const { validateSession } = require("../internalApiClient");
const { getRedisClient, prefixed } = require("../config/redis");

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "connect.sid";
const IDENTITY_CACHE_TTL_SEC = 60;

// In-memory fallback so SSO still works (just without cross-process
// caching) when Redis isn't configured, matching the main app's own
// cacheManager.js optional-Redis convention.
const memoryCache = new Map();

function hashCookie(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getCachedIdentity(cacheKey) {
  const client = await getRedisClient();
  if (client) {
    const raw = await client.get(prefixed(cacheKey)).catch(() => null);
    return raw ? JSON.parse(raw) : null;
  }
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryCache.delete(cacheKey);
    return null;
  }
  return entry.identity;
}

async function setCachedIdentity(cacheKey, identity) {
  const client = await getRedisClient();
  if (client) {
    await client.set(prefixed(cacheKey), JSON.stringify(identity), { EX: IDENTITY_CACHE_TTL_SEC }).catch(() => {});
    return;
  }
  memoryCache.set(cacheKey, { identity, expiresAt: Date.now() + IDENTITY_CACHE_TTL_SEC * 1000 });
}

async function ssoAuth(req, res, next) {
  try {
    const cookies = cookie.parse(req.headers.cookie || "");
    const rawCookieValue = cookies[SESSION_COOKIE_NAME];
    if (!rawCookieValue) {
      return res.status(401).json({ error: "Not signed in to Managira." });
    }

    const cacheKey = `identity:${hashCookie(rawCookieValue)}`;
    let identity = await getCachedIdentity(cacheKey);

    if (!identity) {
      const result = await validateSession(rawCookieValue).catch((error) => {
        if (error.status === 401) return null;
        throw error;
      });
      if (!result) {
        return res.status(401).json({ error: "Your Managira session has expired. Please log in again." });
      }
      identity = result.identity;
      await setCachedIdentity(cacheKey, identity);
    }

    if (!identity.organizationId) {
      return res.status(403).json({ error: "No organization context on this session." });
    }

    req.identity = identity;
    next();
  } catch (error) {
    console.error("[mira/ssoAuth]", error);
    return res.status(502).json({ error: "Unable to verify your session right now." });
  }
}

module.exports = { ssoAuth };
