"use strict";

// One sign-in in progress. It can only be finished once, within ten minutes, by the browser
// that started it, which is what stops a stolen or replayed answer from signing anyone in.
const crypto = require("crypto");
const { encryptSecret, decryptSecret } = require("../encryption");

const COOKIE = "mg_sso";
const LIFETIME_MS = 10 * 60 * 1000;

const hashOf = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function cookieOptions(req) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const domain = process.env.SESSION_COOKIE_DOMAIN === undefined ? ".managira.com" : process.env.SESSION_COOKIE_DOMAIN;
  const onManagira = /(^|\.)managira\.com$/i.test(req.hostname || "");
  return {
    path: "/account/sso",
    httpOnly: true,
    maxAge: LIFETIME_MS,
    // A SAML provider answers with a post from its own site, so the cookie has to travel with it.
    sameSite: secure ? "none" : "lax",
    secure,
    ...(onManagira && domain ? { domain } : {}),
  };
}

function browserToken(req, res) {
  const existing = String((req.cookies && req.cookies[COOKIE]) || cookieFromHeader(req) || "");
  const token = /^[a-f0-9]{48}$/.test(existing) ? existing : crypto.randomBytes(24).toString("hex");
  res.cookie(COOKIE, token, cookieOptions(req));
  return token;
}

function cookieFromHeader(req) {
  const found = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : "";
}

async function create(db, req, res, connection, { kind, requestId, nonce = null, verifier = null }) {
  // Old rows go now and then; nothing depends on it happening at any given moment.
  if (Math.random() < 0.02) db.query("DELETE FROM sso_login_requests WHERE expires_at < NOW() - INTERVAL '1 day'").catch(() => {});
  await db.query(
    `INSERT INTO sso_login_requests (request_id, organization_id, connection_id, kind, browser_hash, nonce, verifier_locked, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [requestId, connection.organization_id, connection.connection_id, kind, hashOf(browserToken(req, res)), nonce, verifier ? encryptSecret(verifier) : null, new Date(Date.now() + LIFETIME_MS)]
  );
}

// Still usable, by this connection? Doesn't use it up.
async function peek(db, requestId, connection) {
  const { rows } = await db.query(
    `SELECT * FROM sso_login_requests
      WHERE request_id = $1 AND connection_id = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
    [String(requestId || ""), connection.connection_id]
  );
  return rows[0] || null;
}

// Uses it up. If two arrive together only one gets the row.
async function consume(db, req, requestId, connection) {
  const { rows } = await db.query(
    `UPDATE sso_login_requests SET consumed_at = NOW()
      WHERE request_id = $1 AND connection_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
      RETURNING *`,
    [String(requestId || ""), connection.connection_id]
  );
  const row = rows[0];
  if (!row) return null;
  const a = Buffer.from(hashOf(cookieFromHeader(req)));
  const b = Buffer.from(row.browser_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { ...row, verifier: row.verifier_locked ? decryptSecret(row.verifier_locked) : null };
}

module.exports = { create, peek, consume };
