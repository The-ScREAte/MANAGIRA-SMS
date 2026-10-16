"use strict";

// Security headers and cross-site request protection for every response.
// See docs/SECURITY.md for the full list of protections in the app.

const isProduction = process.env.NODE_ENV === "production";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Our own sites: managira.com and every school subdomain (*.managira.com).
function isOwnHost(hostname, requestHost) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  if (requestHost && host === String(requestHost).toLowerCase().split(":")[0]) return true;
  if (host === "managira.com" || host.endsWith(".managira.com")) return true;
  if (!isProduction && (host === "localhost" || host === "127.0.0.1")) return true;
  return false;
}

function securityHeaders(req, res, next) {
  // Browsers must not guess file types (stops uploaded files running as scripts).
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Only our own pages may frame ours (stops clickjacking).
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self' https://managira.com https://*.managira.com");
  res.setHeader("X-Frame-Options", "SAMEORIGIN"); // older browsers; CSP above wins in modern ones
  // Don't leak full page addresses (which can hold IDs) to other sites.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Camera, microphone and location only for our own pages, never embedded sites.
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self), payment=(self)");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (isProduction) {
    // Always use HTTPS for managira.com for the next 180 days.
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  res.removeHeader("X-Powered-By");
  next();
}

// Blocks form posts and API calls that come from another website while the
// user is signed in (CSRF). Server-to-server calls (Stripe/Paystack webhooks,
// Mira) send no Origin header and pass; signature checks protect those.
function crossSiteRequestGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin || origin === "null") return next();
  let hostname = "";
  try {
    hostname = new URL(origin).hostname;
  } catch (_) {
    hostname = "";
  }
  if (isOwnHost(hostname, req.get("host"))) return next();

  console.warn(`[Security] Blocked cross-site ${req.method} ${req.originalUrl} from ${origin}`);
  const wantsJson = req.xhr || /json/i.test(req.get("accept") || "") || /json/i.test(req.get("content-type") || "");
  if (wantsJson) return res.status(403).json({ success: false, message: "This request came from another website and was blocked." });
  return res.status(403).send("This request came from another website and was blocked.");
}

// Fair-use request limit, so one user or one network can't flood the server.
// Signed-in users are counted per session (a whole school shares one network);
// visitors who aren't signed in are counted per network address.
const { checkRateLimit } = require("../utils/rateLimiter");
const REQUEST_WINDOW_MS = 60 * 1000;
const SIGNED_IN_PER_MINUTE = Number(process.env.REQUEST_LIMIT_SIGNED_IN || 600);
const VISITOR_PER_MINUTE = Number(process.env.REQUEST_LIMIT_VISITOR || 1200);
// Health checks and payment/messaging provider callbacks are never limited.
const UNLIMITED_PATHS = /^\/(health|favicon\.ico|service-worker\.js)$|^\/account\/settings\/finance\/webhooks\/|^\/account\/(paystack-webhook|webhook|whatsapp\/webhook)$/;

function requestRateLimit(req, res, next) {
  if (UNLIMITED_PATHS.test(req.path)) return next();
  const s = req.session || {};
  const signedIn = Boolean(s.userId || s.organizationId || s.studentId || s.guardianId || s.hubId);
  const { clientIp, securityLog } = require("../utils/authRateLimit");
  const key = signedIn ? `req:session:${req.sessionID}` : `req:ip:${clientIp(req)}`;
  const max = signedIn ? SIGNED_IN_PER_MINUTE : VISITOR_PER_MINUTE;
  const limit = checkRateLimit(key, { max, windowMs: REQUEST_WINDOW_MS });
  if (limit.allowed) return next();

  // Log once per window, not on every refused request.
  if (checkRateLimit(`${key}:logged`, { max: 1, windowMs: REQUEST_WINDOW_MS }).allowed) {
    securityLog("request_rate_limited", req, { signedIn });
  }
  const retrySeconds = Math.ceil((limit.retryAfterMs || REQUEST_WINDOW_MS) / 1000);
  res.set("Retry-After", String(retrySeconds));
  const message = "Too many requests. Please wait a moment and try again.";
  if (req.xhr || /json/i.test(req.get("accept") || "")) return res.status(429).json({ success: false, message });
  return res.status(429).type("txt").send(message);
}

module.exports = { securityHeaders, crossSiteRequestGuard, requestRateLimit, isOwnHost };
