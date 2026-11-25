"use strict";

// The Content-Security-Policy every page is sent with. It names each outside site the app really
// uses; anything else (a script, picture, frame or request to a site not listed) is refused by the
// browser. Pages still use inline scripts and styles, so those stay allowed ('unsafe-inline')
// until they are moved to files. CSP_MODE=report-only sends the same policy without enforcing it;
// CSP_MODE=off sends only the framing rule (an emergency switch, never needed in normal use).
const isProduction = () => process.env.NODE_ENV === "production";

const CDNS = ["https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.quilljs.com"];
const FRAME_ANCESTORS = ["'self'", "https://managira.com", "https://*.managira.com"];

// The storage buckets files and pictures come from (https://<bucket>.s3.<region>.amazonaws.com).
function storageHosts(env = process.env) {
  const region = String(env.AWS_REGION || "").trim();
  const buckets = [env.S3_BUCKET_NAME, ...String(env.S3_LEGACY_BUCKETS || "").split(",")].map((b) => String(b || "").trim()).filter((b) => /^[a-z0-9][a-z0-9.-]*$/.test(b));
  const hosts = new Set();
  for (const bucket of buckets) {
    if (region) hosts.add(`https://${bucket}.s3.${region}.amazonaws.com`);
    hosts.add(`https://${bucket}.s3.amazonaws.com`);
  }
  if (String(env.AWS_ENDPOINT_URL || "").trim()) {
    try { hosts.add(new URL(env.AWS_ENDPOINT_URL).origin); } catch (_) { /* not an address */ }
  }
  return [...hosts];
}

function origins(env, miraOrigin) {
  const list = [];
  if (miraOrigin) list.push(miraOrigin);
  return list;
}

function directives({ env = process.env, miraOrigin = "", nonce = "" } = {}) {
  const storage = storageHosts(env);
  const mira = origins(env, miraOrigin);
  const stripe = ["https://js.stripe.com"];
  const paystack = ["https://js.paystack.co", "https://checkout.paystack.com"];
  const maps = ["https://tile.openstreetmap.org", "https://a.tile.openstreetmap.org", "https://b.tile.openstreetmap.org", "https://c.tile.openstreetmap.org", "https://tiles.openfreemap.org", "https://a.basemaps.cartocdn.com", "https://b.basemaps.cartocdn.com", "https://c.basemaps.cartocdn.com", "https://d.basemaps.cartocdn.com"];
  const list = {
    "default-src": ["'self'"],
    "script-src": ["'self'", nonce ? `'nonce-${nonce}'` : "'unsafe-inline'", ...CDNS, ...stripe, "https://js.paystack.co", "https://connect.facebook.net"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", ...CDNS],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com", ...CDNS],
    "img-src": ["'self'", "data:", "blob:", ...storage, "https://flagcdn.com", "https://www.gstatic.com", "https://i.ytimg.com", ...maps, ...CDNS, "https://js.stripe.com", "https://www.facebook.com"],
    "media-src": ["'self'", "blob:", "data:", ...storage],
    "connect-src": ["'self'", ...mira, ...storage, "https://nominatim.openstreetmap.org", "https://tiles.openfreemap.org", "https://api.bigdatacloud.net", "https://ipapi.co", "https://ipwho.is", "https://api.stripe.com", "https://checkout.paystack.com", "https://api.paystack.co", "https://www.facebook.com", "https://connect.facebook.net", ...CDNS],
    "frame-src": ["'self'", ...mira, "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://maps.google.com", "https://www.google.com", "https://docs.google.com", "https://js.stripe.com", "https://hooks.stripe.com", "https://checkout.paystack.com", "https://www.facebook.com", "https://web.facebook.com", ...storage],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": FRAME_ANCESTORS,
  };
  return list;
}

function build(options) {
  const parts = Object.entries(directives(options)).map(([name, values]) => `${name} ${values.join(" ")}`);
  parts.push("report-uri /csp-report");
  return parts.join("; ");
}

// "enforce" (default), "report-only" or "off" (the whole policy).
function mode(env = process.env) {
  const value = String(env.CSP_MODE || "").trim().toLowerCase();
  return value === "report-only" || value === "off" ? value : "enforce";
}

// The strict policy: scripts only with this response's nonce, no 'unsafe-inline'. It is the enforced
// policy by default. Every inline <script> carries the nonce and page handlers are data-on<event>
// attributes (public/js/mgActions.js), so nothing inline runs without it.
//   CSP_STRICT=report-only  the older policy (inline scripts allowed) enforced, the strict one reported
//   CSP_STRICT=off          the older policy only
// (emergency switches; the older policy stays in this file as the fallback).
function strictMode(env = process.env) {
  const value = String(env.CSP_STRICT || "").trim().toLowerCase();
  return value === "report-only" || value === "off" ? value : "enforce";
}

const FRAMING_ONLY = `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`;

// The headers for a response: [{ name, value }].
function headers(options = {}) {
  const env = options.env || process.env;
  const how = mode(env);
  if (how === "off") return [{ name: "Content-Security-Policy", value: FRAMING_ONLY }];
  const strict = strictMode(env);
  const nonce = options.nonce || "";
  if (how === "report-only") return [{ name: "Content-Security-Policy-Report-Only", value: build({ ...options, nonce: nonce || "" }) }, { name: "Content-Security-Policy", value: FRAMING_ONLY }];
  if (strict === "enforce" && nonce) return [{ name: "Content-Security-Policy", value: build(options) }];
  const list = [{ name: "Content-Security-Policy", value: build({ ...options, nonce: "" }) }];
  if (strict === "report-only" && nonce) list.push({ name: "Content-Security-Policy-Report-Only", value: build(options) });
  return list;
}

// A browser's violation report, boiled down to one short line for the log.
function reportLine(body) {
  const r = (body && (body["csp-report"] || (Array.isArray(body) ? (body[0] || {}).body : body.body) || body)) || {};
  const pick = (...keys) => { for (const k of keys) if (r[k]) return String(r[k]); return ""; };
  const what = pick("effective-directive", "effectiveDirective", "violated-directive", "violatedDirective");
  const blocked = pick("blocked-uri", "blockedURL", "blockedUri").slice(0, 120);
  const page = pick("document-uri", "documentURL", "documentUri").replace(/[?#].*$/, "").slice(0, 120);
  return what ? `${what} blocked ${blocked || "inline"} on ${page || "?"}` : "";
}

const { checkRateLimit } = require("./rateLimiter");
// POST /csp-report: logs a short line per violation, at most 30 a minute for the whole app.
function reportHandler(req, res) {
  try {
    const line = reportLine(req.body);
    if (line && checkRateLimit("csp-report", { max: 30, windowMs: 60 * 1000 }).allowed) console.warn(`[CSP] ${line}`);
  } catch (_) { /* a report is never worth an error */ }
  res.status(204).end();
}

module.exports = { build, headers, mode, strictMode, reportLine, reportHandler, storageHosts, directives, FRAMING_ONLY };
