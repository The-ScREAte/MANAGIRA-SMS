// What the app does about shards: sending a sign-in or sign-up to the right shard,
// pausing a school that is moving, and believing the router's headers.
const db = require("../../config/db");
const { ROUTE_COOKIE, routeValue, edgeToken, isEdgeRequest, sealHandoff, openHandoff } = require("./signing");
const registry = require("./registry");

const HANDOFF_COOKIE = "mgr_handoff";
const SESSION_KEYS_FOR_SIGNUP = ["planSelection", "registrationProofDraft"];

function cookieOptions(maxAge) {
  const domain = process.env.SESSION_COOKIE_DOMAIN === undefined ? ".managira.com" : process.env.SESSION_COOKIE_DOMAIN;
  const production = process.env.NODE_ENV === "production";
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge,
    ...(production && domain ? { domain } : {}),
    ...(production && process.env.SESSION_COOKIE_SECURE !== "false" ? { secure: true } : {}),
  };
}

function sendToShard(res, shard) {
  res.cookie(ROUTE_COOKIE, routeValue(shard.name), cookieOptions(30 * 24 * 60 * 60 * 1000));
}

// Run first thing on a sign-in. If this shard doesn't know the person and another shard
// accepts these credentials, the browser re-sends the form through the router and lands
// there. A wrong password looks the same as an unknown email. Returns true if it left.
async function sentToLoginShard(req, res, login) {
  const identity = String(login || "").trim();
  const password = req.body?.password;
  if (!identity || !password) return false;
  try {
    if ((await registry.otherLiveShards()).length === 0) return false;
    if (await registry.knowsLogin(identity)) return false;
    const shard = await registry.findLoginElsewhere(identity, password);
    if (!shard) return false;
    sendToShard(res, shard);
    res.redirect(307, req.originalUrl);
    return true;
  } catch (error) {
    console.error("[shards] sign-in routing:", error.message);
    return false;
  }
}

// A reset request for someone on another shard goes on quietly: the person sees the same
// message either way, and the right shard sends the email.
async function passResetToOtherShards(req, email) {
  try {
    const others = await registry.otherLiveShards();
    if (!others.length || await registry.knowsLogin(email)) return;
    const body = new URLSearchParams({ email }).toString();
    await Promise.allSettled(others.map((shard) => fetch(`${String(shard.app_url).replace(/\/$/, "")}/account/forget-password`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-managira-edge": edgeToken(), "x-managira-client-ip": req.ip || "" },
      body,
      signal: AbortSignal.timeout(8000),
    })));
  } catch (error) {
    console.error("[shards] reset routing:", error.message);
  }
}

// Links in email from a shard other than the control shard name it, signed, so they open
// on the right shard wherever they were built.
const LINK = /https:\/\/(?:www\.)?managira\.com\/[^\s"'<>)]*/g;
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?)(\?|$)/i;
function withShardLinks(content) {
  const name = registry.thisShardName();
  if (!content || typeof content !== "string" || name === registry.CONTROL_SHARD_NAME) return content;
  const via = `via=${encodeURIComponent(routeValue(name))}`;
  return content.replace(LINK, (url) => (ASSET.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}${via}`));
}

// Run first thing on a sign-up. A new school belongs on the shard for its country, so the
// form continues there, along with what the person chose so far.
async function sentToSignupShard(req, res, country) {
  try {
    const shard = await registry.pickShardForCountry(country);
    if (!shard || shard.name === registry.thisShardName()) return false;
    const carried = {};
    SESSION_KEYS_FOR_SIGNUP.forEach((key) => { if (req.session?.[key]) carried[key] = req.session[key]; });
    res.cookie(HANDOFF_COOKIE, sealHandoff(carried), cookieOptions(15 * 60 * 1000));
    sendToShard(res, shard);
    res.redirect(307, req.originalUrl);
    return true;
  } catch (error) {
    console.error("[shards] sign-up routing:", error.message);
    return false;
  }
}

// On the other side of that hand-off.
function restoreSignup(req, res) {
  const data = openHandoff(req.cookies?.[HANDOFF_COOKIE] || readCookie(req.headers.cookie, HANDOFF_COOKIE));
  if (!data || !req.session) return;
  SESSION_KEYS_FOR_SIGNUP.forEach((key) => { if (data[key] && !req.session[key]) req.session[key] = data[key]; });
  res.clearCookie(HANDOFF_COOKIE, cookieOptions(0));
}

function readCookie(header, name) {
  const match = String(header || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ---- Requests from the router ---------------------------------------------------------
// Render's address is what the router connects to, so the visitor's real address and
// host arrive in signed headers.
function trustEdge(req, res, next) {
  if (!isEdgeRequest(req.headers)) return next();
  const host = req.headers["x-managira-host"];
  if (host) {
    req.headers.host = host;
    req.headers["x-forwarded-host"] = host;
  }
  // Rate limits and logs read this: the visitor, never the router.
  const ip = req.headers["x-managira-client-ip"];
  if (ip) req.headers["x-forwarded-for"] = ip;
  const proto = req.headers["x-managira-proto"];
  if (proto) req.headers["x-forwarded-proto"] = proto;
  return next();
}

// ---- A school being moved -------------------------------------------------------------
let paused = { schools: new Set(), hubs: new Set() };
let checkedAt = 0;
let checking = null;

function pausedNow() {
  if (Date.now() - checkedAt < 3000) return paused;
  if (!checking) {
    checkedAt = Date.now();
    checking = Promise.all([
      db.query("SELECT organization_id AS id FROM organizations WHERE shard_move_state IS NOT NULL"),
      db.query("SELECT hub_id AS id FROM managira_hubs WHERE shard_move_state IS NOT NULL"),
    ])
      .then(([schools, hubs]) => { paused = { schools: new Set(schools.rows.map((row) => Number(row.id))), hubs: new Set(hubs.rows.map((row) => Number(row.id))) }; })
      .catch(() => { paused = { schools: new Set(), hubs: new Set() }; })
      .finally(() => { checking = null; });
  }
  return paused;
}

function pauseWhileMoving(req, res, next) {
  const { schools, hubs } = pausedNow();
  if (!schools.size && !hubs.size) return next();
  const school = Number(req.session?.organizationId || req.schoolDetails?.organization_id);
  const hub = Number(req.session?.hubId);
  if (!(school && schools.has(school)) && !(hub && hubs.has(hub))) return next();
  res.set("Retry-After", "60");
  res.set("Cache-Control", "no-store");
  if (/application\/json/.test(req.headers.accept || "") || req.xhr) {
    return res.status(503).json({ success: false, message: "Back in a few minutes." });
  }
  return res.status(503).type("html").send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One moment</title><body style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#0f172a;text-align:center"><div><h1 style="font-size:1.3rem;margin:0 0 6px">One moment</h1><p style="margin:0;color:#64748b">Back in a few minutes.</p></div>');
}

module.exports = { sendToShard, sentToLoginShard, passResetToOtherShards, withShardLinks, sentToSignupShard, restoreSignup, trustEdge, pauseWhileMoving, cookieOptions };
