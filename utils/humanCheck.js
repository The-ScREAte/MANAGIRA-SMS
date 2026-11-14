"use strict";
// "Are you a person?" for every form a visitor can send without signing in (help tickets, demo
// requests, job applications, a school website's contact form, online admission, school sign-up).
// No outside service and no puzzle to click: the page asks the server for a signed challenge and
// the browser works it out in the background (a small proof of work, about a second), which a bot
// posting forms by the thousand can't afford. On top of it:
//  - a hidden field people never see (bots fill it in);
//  - the form must have been open a few seconds, counted from when the server signed the
//    challenge (never from a time the browser sends);
//  - each challenge works once and for two hours;
//  - a visitor's network may send only so many forms an hour.
// `emailAllowance` keeps Managira from mailing any one address more than a few times a day, so
// even a person can't use a form to flood someone else's inbox.
const crypto = require("crypto");
const { BoundedMap } = require("./boundedMap");

const MAX_NUMBER = 120000; // the puzzle's size: ~0.3-1 s in a browser, at most MAX_NUMBER hashes
const MIN_SECONDS = 3;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const FORMS = ["help", "demo", "job", "school-contact", "admission", "register"];
const TRAPS = ["company_website", "website_url"]; // hidden fields: a person never fills them

const secret = () => process.env.HUMAN_CHECK_SECRET || process.env.SESSION_SECRET || "managira-human-check";
const sign = (parts) => crypto.createHmac("sha256", secret()).update(parts.join("|")).digest("hex");
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

const used = new BoundedMap(50000, { keepUnderPressure: true }); // salt -> time, each challenge once
const perNetwork = new BoundedMap(20000, { keepUnderPressure: true }); // ip:form -> { start, count }
const perAddress = new BoundedMap(50000, { keepUnderPressure: true }); // email -> { start, count }

// A new challenge for one form.
function issue(form) {
  const name = FORMS.includes(form) ? form : "help";
  const salt = crypto.randomBytes(12).toString("hex");
  const number = crypto.randomInt(0, MAX_NUMBER);
  const issuedAt = Date.now();
  const challenge = sha256(salt + number);
  return { algorithm: "SHA-256", challenge, salt, maxnumber: MAX_NUMBER, form: name, issuedAt, signature: sign([name, salt, challenge, issuedAt]) };
}

function windowCount(map, key, windowMs) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.start > windowMs) { map.set(key, { start: now, count: 1 }); return 1; }
  entry.count += 1;
  return entry.count;
}

// Checks a submitted form. Returns { ok: true } or { ok: false, reason } in words for the visitor.
// `perHour`: how many of this form one network may send in an hour.
function verify(req, form, { perHour = 20 } = {}) {
  const body = (req && req.body) || {};
  if (TRAPS.some((name) => String(body[name] || "").trim())) return { ok: false, reason: "We couldn't send that. Please try again.", bot: true };
  let proof = body.human_proof;
  if (typeof proof === "string") { try { proof = JSON.parse(proof); } catch (error) { proof = null; } }
  const again = { ok: false, reason: "Please wait a moment while we check you're a person, then send it again." };
  if (!proof || typeof proof !== "object") return again;
  const issuedAt = Number(proof.issuedAt);
  const salt = String(proof.salt || "");
  const challenge = String(proof.challenge || "");
  const number = Number(proof.number);
  if (!/^[a-f0-9]{24}$/.test(salt) || !/^[a-f0-9]{64}$/.test(challenge) || !Number.isInteger(number) || number < 0 || number > MAX_NUMBER) return again;
  const expected = sign([form, salt, challenge, issuedAt]);
  const given = String(proof.signature || "");
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return again;
  const age = Date.now() - issuedAt;
  if (!(age >= 0) || age > MAX_AGE_MS) return { ok: false, reason: "This page was open a long time. Please refresh it and send again." };
  if (age < MIN_SECONDS * 1000) return { ok: false, reason: "That was very quick. Please wait a few seconds and send it again." };
  if (sha256(salt + number) !== challenge) return again;
  if (used.has(salt)) return { ok: false, reason: "This form was already sent. Please refresh the page to send another." };
  used.set(salt, Date.now());
  const ip = String((req && (req.ip || (req.connection && req.connection.remoteAddress))) || "unknown");
  if (windowCount(perNetwork, `${ip}:${form}`, 60 * 60 * 1000) > perHour) return { ok: false, reason: "Too many messages from your network. Please try again in an hour." };
  return { ok: true };
}

// Whether Managira may email this address a confirmation now (at most `perDay` a day).
function emailAllowance(email, { perDay = 3 } = {}) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return false;
  return windowCount(perAddress, key, 24 * 60 * 60 * 1000) <= perDay;
}

// Express middleware for a form route (after any upload parser, so the fields are read).
// A JSON request gets { success: false, message }; a page goes back with the message flashed.
function requireHuman(form, { perHour, back } = {}) {
  return (req, res, next) => {
    const result = verify(req, form, { perHour });
    if (result.ok) return next();
    if (result.bot) console.warn(`[human-check] ${form}: hidden field filled from ${req.ip}`);
    const wantsJson = /application\/json/.test(String(req.get("accept") || "")) || req.xhr;
    if (wantsJson) return res.status(429).json({ success: false, message: result.reason, error: result.reason });
    if (typeof req.flash === "function") req.flash("error", result.reason);
    const to = typeof back === "function" ? back(req) : back || req.get("Referer") || "/";
    return res.redirect(to);
  };
}

// The challenge a page asks for (GET /human-check/challenge?form=help), never cached.
function challengeRoute(req, res) {
  const ip = String(req.ip || "unknown");
  if (windowCount(perNetwork, `${ip}:challenge`, 60 * 1000) > 60) return res.status(429).json({ error: "Too many requests." });
  res.set("Cache-Control", "no-store");
  return res.json(issue(String(req.query.form || "")));
}

module.exports = { issue, verify, requireHuman, emailAllowance, challengeRoute, FORMS, MAX_NUMBER, _reset: () => { used.clear(); perNetwork.clear(); perAddress.clear(); } };
