// Single sign-on: a user already logged into the main Managira app reaches
// Mira with no second login. Reads the shared `connect.sid` cookie
// (readable here because the production session cookie's domain is
// ".managira.com" - already configured on the main app, nothing to change),
// validates it against the main app's internal API (never against the
// session table directly - see internalApiClient.js), and caches the
// result briefly in Redis so every keystroke doesn't round-trip to the
// main app. Falls back to an in-memory cache if Redis is unavailable.
//
// Also honors a Mira-local "signed out of Mira" flag (see routes/authRoute.js)
// so a user can sign out of Mira specifically without touching - or being
// affected by - the shared Managira session other tabs are using.
const cookie = require("cookie");
const crypto = require("crypto");
const { validateSession } = require("../internalApiClient");
const { getRedisClient, prefixed } = require("../config/redis");

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "connect.sid";
const MIRA_SIGNED_OUT_COOKIE = "mira_signed_out";
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

function isSignedOutOfMira(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  return cookies[MIRA_SIGNED_OUT_COOKIE] === "1";
}

// Resolves identity without writing any response - shared by the JSON API
// guard (ssoAuth) and the browser-page guard (pageAuth), and also usable
// directly by routes/authRoute.js's login page to check "is the underlying
// Managira session still alive?" regardless of the Mira-local signed-out flag.
async function resolveIdentity(req, { ignoreMiraSignedOut = false } = {}) {
  if (!ignoreMiraSignedOut && isSignedOutOfMira(req)) {
    return { identity: null, reason: "signed_out" };
  }

  const cookies = cookie.parse(req.headers.cookie || "");
  const rawCookieValue = cookies[SESSION_COOKIE_NAME];
  if (!rawCookieValue) {
    return { identity: null, reason: "no_session" };
  }

  const cacheKey = `identity:${hashCookie(rawCookieValue)}`;
  let identity = await getCachedIdentity(cacheKey);

  if (!identity) {
    const result = await validateSession(rawCookieValue).catch((error) => {
      if (error.status === 401) return null;
      throw error;
    });
    if (!result) {
      return { identity: null, reason: "expired" };
    }
    identity = result.identity;
    await setCachedIdentity(cacheKey, identity);
  }

  if (!identity.organizationId) {
    return { identity: null, reason: "no_organization" };
  }

  return { identity, reason: null };
}

// JSON API guard - used on /api/* routes, where a fetch()/SSE caller needs
// a machine-readable 401, not an HTML redirect.
async function ssoAuth(req, res, next) {
  try {
    const { identity, reason } = await resolveIdentity(req);
    if (!identity) {
      const status = reason === "no_organization" ? 403 : 401;
      const message =
        reason === "signed_out"
          ? "Signed out of Mira."
          : reason === "expired"
          ? "Your Managira session has expired. Please log in again."
          : reason === "no_organization"
          ? "No organization context on this session."
          : "Not signed in to Managira.";
      return res.status(status).json({ error: message });
    }
    req.identity = identity;
    next();
  } catch (error) {
    console.error("[mira/ssoAuth]", error);
    return res.status(502).json({ error: "Unable to verify your session right now." });
  }
}

// Browser-page guard - used on GET / (and any future full-page routes),
// where the right response to "not authenticated" is a redirect to Mira's
// own login page, not a raw JSON error.
async function pageAuth(req, res, next) {
  try {
    const { identity, reason } = await resolveIdentity(req);
    if (!identity) {
      return res.redirect(`/login${reason ? `?reason=${reason}` : ""}`);
    }
    req.identity = identity;
    next();
  } catch (error) {
    console.error("[mira/pageAuth]", error);
    return res.redirect("/login?reason=error");
  }
}

module.exports = { ssoAuth, pageAuth, resolveIdentity, MIRA_SIGNED_OUT_COOKIE };
