// Signatures the router and the shards use to trust each other. No other dependencies,
// so the router stays small.
const crypto = require("crypto");

const ROUTE_COOKIE = "mgr_shard";
const secret = () => process.env.SHARD_SECRET || "";
const signWith = (key, value) => crypto.createHmac("sha256", key).update(String(value)).digest("base64url");
const sign = (value) => signWith(secret(), value);
// A test shard's own secret: enough for the control shard to read its version, and useless
// against production. It can't be turned back into the real one.
const testShardSecret = () => signWith(secret(), "test-shard");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const routeValue = (shardName) => `${shardName}.${sign(`route:${shardName}`).slice(0, 24)}`;

function routeFromValue(value) {
  if (!secret() || !value) return null;
  const text = String(value);
  const name = text.slice(0, text.lastIndexOf("."));
  return name && safeEqual(text, routeValue(name)) ? name : null;
}

// The shard a browser was sent to, or null when the cookie is missing or altered.
function routeFromCookies(cookieHeader) {
  const match = String(cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${ROUTE_COOKIE}=([^;]+)`));
  return match ? routeFromValue(decodeURIComponent(match[1])) : null;
}

const edgeToken = () => sign("edge");
const isEdgeRequest = (headers) => Boolean(secret()) && safeEqual(headers["x-managira-edge"], edgeToken());

// Calls between shards. A signature covers the time and the body, and lasts a minute.
function signCall(body, key = secret()) {
  const time = String(Date.now());
  return { "x-shard-time": time, "x-shard-signature": signWith(key, `${time}.${body}`) };
}

function verifyCall(headers, body) {
  if (!secret()) return false;
  const time = Number(headers["x-shard-time"]);
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 60000) return false;
  return safeEqual(headers["x-shard-signature"], sign(`${headers["x-shard-time"]}.${body}`));
}

// A sign-up continues on another shard: what it chose so far travels with it, signed.
function sealHandoff(data) {
  const payload = Buffer.from(JSON.stringify({ data, at: Date.now() })).toString("base64url");
  return `${payload}.${sign(`handoff:${payload}`).slice(0, 32)}`;
}

function openHandoff(value) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !secret() || !safeEqual(signature, sign(`handoff:${payload}`).slice(0, 32))) return null;
  try {
    const { data, at } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Date.now() - at < 15 * 60 * 1000 ? data : null;
  } catch (_error) {
    return null;
  }
}

module.exports = { ROUTE_COOKIE, routeValue, routeFromValue, routeFromCookies, edgeToken, isEdgeRequest, testShardSecret, signCall, verifyCall, sealHandoff, openHandoff };
