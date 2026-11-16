// Unsubscribe links for optional emails (digests, announcements, reminders).
//
// An optional email is sent with a `category`: a key from utils/emailPreferences.js. Each
// recipient gets their own signed link, so one click turns off that kind of email for that
// address and nothing else. Account holders (staff, parents) have the choice saved on their
// account, where their settings page shows it; any other address goes in `email_opt_outs`.
// Security codes, passwords, receipts and account notices never carry a category.
const crypto = require("crypto");

const BASE_URL = (process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/+$/, "");
const TOKEN_VERSION = "1";

function linkKey() {
  const secret = process.env.EMAIL_LINK_SECRET || process.env.SESSION_SECRET || "";
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update("managira-email-links").digest();
}

const b64 = (value) => Buffer.from(String(value), "utf8").toString("base64url");
const unb64 = (value) => Buffer.from(String(value), "base64url").toString("utf8");
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

function sign(payload) {
  const key = linkKey();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(payload).digest("base64url").slice(0, 32);
}

function unsubscribeToken(email, category) {
  const address = normalizeEmail(email);
  if (!address || !category) return null;
  const payload = `${TOKEN_VERSION}.${b64(address)}.${b64(category)}`;
  const signature = sign(payload);
  return signature ? `${payload}.${signature}` : null;
}

function readUnsubscribeToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = sign(payload);
  if (!expected) return null;
  const given = Buffer.from(parts[3]);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  try {
    const email = normalizeEmail(unb64(parts[1]));
    const category = unb64(parts[2]);
    if (!email.includes("@") || !/^[a-z0-9_]{2,64}$/.test(category)) return null;
    return { email, category };
  } catch (_) {
    return null;
  }
}

function unsubscribeUrl(email, category) {
  const token = unsubscribeToken(email, category);
  return token ? `${BASE_URL}/email/unsubscribe?t=${encodeURIComponent(token)}` : null;
}

// Where someone changes all their email choices once signed in.
const SETTINGS_URL = `${BASE_URL}/email/settings`;

module.exports = { unsubscribeToken, readUnsubscribeToken, unsubscribeUrl, SETTINGS_URL, BASE_URL, normalizeEmail };
