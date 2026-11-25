"use strict";

// SMS delivery-status callbacks come from providers, not from signed-in people, so each post
// must prove itself:
//   - Twilio signs every request (X-Twilio-Signature, HMAC-SHA1 with the school's Auth Token);
//   - Arkesel and Africa's Talking don't sign, so their callback address carries a secret,
//     SMS_WEBHOOK_SECRET, as ?token=... (or an X-Webhook-Token header).
// A post that proves nothing is refused (403). With no secret set, only Twilio's own signature
// can pass, and the log says so once.
const crypto = require("crypto");

const sameText = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a || "")).digest();
  const y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
};

function sharedSecret(env = process.env) {
  return String(env.SMS_WEBHOOK_SECRET || "").trim();
}

function tokenMatches(req, env = process.env) {
  const secret = sharedSecret(env);
  if (!secret) return false;
  const given = String((req.query && req.query.token) || (req.get && req.get("x-webhook-token")) || "").trim();
  return Boolean(given) && sameText(given, secret);
}

// Twilio's rule: the full address it called + every posted field (names sorted) appended as name+value.
function twilioSignature(url, params, authToken) {
  const data = Object.keys(params || {}).sort().reduce((text, key) => text + key + (Array.isArray(params[key]) ? params[key].join("") : String(params[key] ?? "")), url);
  return crypto.createHmac("sha1", String(authToken || "")).update(data, "utf8").digest("base64");
}

function twilioSignatureMatches(req, authToken) {
  const given = req.get && req.get("x-twilio-signature");
  if (!given || !authToken) return false;
  const host = req.get("host");
  const url = `${req.protocol}://${host}${req.originalUrl}`;
  return sameText(given, twilioSignature(url, req.body || {}, authToken));
}

let warned = false;
function warnNoSecret() {
  if (warned) return;
  warned = true;
  console.warn("[SMS webhook] SMS_WEBHOOK_SECRET is not set: Arkesel and Africa's Talking delivery callbacks are refused until it is (add ?token=<secret> to the callback address). Twilio callbacks are checked by signature.");
}

// Resolves true when the post is genuine. `authTokenFor(orgId)` returns the school's Twilio token.
async function webhookIsGenuine(req, provider, authTokenFor, env = process.env) {
  if (provider === "twilio") {
    const orgId = Number(req.query && req.query.orgId);
    if (orgId && typeof authTokenFor === "function") {
      try { if (twilioSignatureMatches(req, await authTokenFor(orgId))) return true; } catch (_) { /* fall through */ }
    }
  }
  if (!sharedSecret(env)) { warnNoSecret(); return false; }
  return tokenMatches(req, env);
}

// At start-up: say in the log when schools send through a provider whose delivery receipts need
// the secret and it isn't set. Receipts only; sending never depends on this. Read-only, never throws.
async function logIfSecretNeeded(db, env = process.env) {
  if (sharedSecret(env)) return;
  try {
    const { rows } = await db.query("SELECT sms_active_provider AS provider, COUNT(*)::int AS schools FROM organizations WHERE sms_active_provider IN ('arkesel', 'africastalking') GROUP BY 1");
    const total = rows.reduce((sum, row) => sum + row.schools, 0);
    if (total) console.warn(`[SMS webhook] ${total} school(s) send through Arkesel or Africa's Talking and SMS_WEBHOOK_SECRET is not set: their delivery receipts are refused (messages still send). Set it and add ?token=<secret> to the callback address in the provider's dashboard.`);
  } catch (_) { /* the columns may not exist yet: nothing to report */ }
}

module.exports = { logIfSecretNeeded, webhookIsGenuine, twilioSignature, tokenMatches, sameText };
