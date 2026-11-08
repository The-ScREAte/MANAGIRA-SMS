"use strict";

// A verification code at sign-in. After a right password, the sign-in is held, not finished:
// a 6-character code goes to the person's email from reminders@managira.com, and only that
// code finishes it. Single sign-on skips it (the school's provider checks the person), and so
// does an account with no email to send it to.
//
// How it holds: the sign-in runs exactly as before, then, just as it would send the person on,
// the session it made is put aside on the server, the browser gets a new session that holds
// nothing but the wait for the code, and the code page is shown. The right code puts the
// sign-in back, in another new session, and sends the person where they were going.
const crypto = require("crypto");
const features = require("./shards/features");
const { sendEmailInBackground, renderCleanEmail } = require("./emailHelper");
const { settingsFor } = require("./tenantSettings");

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0, O, 1 or I: easy to read and type
const CODE_LENGTH = 6;
const LIFETIME_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_SENDS = 5;
const PLATFORM_ROLES = new Set(["admin", "mini admin", "internal worker"]);

const newCode = () => Array.from({ length: CODE_LENGTH }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join("");
const tidy = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashOf = (code) => crypto.createHash("sha256").update(tidy(code)).digest("hex");
const signedIn = (session) => Boolean(session && (session.userId || session.organizationId || session.guardianId || session.studentId || session.hubId));
const identityOf = (session) => (session ? [session.userId, session.organizationId, session.guardianId, session.studentId, session.hubId, session.hubUserId].map((v) => v || "").join("|") : "");

function emailOf(session) {
  const value = (session.user && session.user.email) || session.hubEmail || session.email || "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value).trim()) ? String(value).trim().toLowerCase() : "";
}

function masked(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
}

function wanted(session) {
  if (session.signedInWith === "sso") return false;
  const role = String(session.userRole || session.accountType || "").trim().toLowerCase();
  const organizationId = session.organizationId || null;
  const hubId = session.hubId || null;
  if (PLATFORM_ROLES.has(role) && !organizationId) return features.isOn("login_code");
  return features.isOn("login_code", { organizationId, hubId });
}

function sendCode(email, code) {
  const html = renderCleanEmail({
    title: "Your verification code",
    greeting: "Your security matters to us.",
    paragraphs: [
      "To continue your Managira log in, please verify your account with the code below.",
      `<div style="margin:18px 0 6px;padding:16px 20px;border-radius:12px;background:#f1f5f9;text-align:center;font:700 30px/1.2 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:8px;color:#0f172a;">${code}</div>`,
      "This code expires in 10 minutes. If you didn't try to log in, you can ignore this email, and we recommend changing your password.",
      "Sincerely,<br>Managira Security",
    ],
    noReply: true,
  });
  const text = [
    "Your security matters to us.",
    "",
    "To continue your Managira log in, please verify your account with the code below.",
    "",
    `Verification Code: ${code}`,
    "",
    "This code expires in 10 minutes. If you didn't try to log in, you can ignore this email, and we recommend changing your password.",
    "",
    "Sincerely,",
    "Managira Security",
    "",
    "This is a no-reply email.",
  ].join("\n");
  return sendEmailInBackground({ to: email, subject: "Your Managira verification code", html, text, sender: "reminders", senderName: "Managira Security" }, "Login code");
}

// ---------- a browser that has already entered a code ----------
// The browser keeps a random token in a cookie only the server can read; the database keeps
// only its hash, for each account that entered a code on it, with the kind of browser and
// system it was. The same account on the same browser skips the code for 30 days after it was
// last used. A cleared browser, another browser or another device gets the code again.
const DEVICE_COOKIE = "mg_device";
const TRUST_MS = 30 * 24 * 60 * 60 * 1000;
const TABLE_MISSING = "42P01";
const deviceHashOf = (token) => crypto.createHash("sha256").update(`device:${token}`).digest("hex");

function accountKeyOf(s) {
  if (s.studentId) return `student:${s.studentId}`;
  if (s.guardianId) return `guardian:${s.guardianId}`;
  if (s.hubUserId) return `hubuser:${s.hubUserId}`;
  if (s.hubId && !s.organizationId) return `hub:${s.hubId}`;
  if (s.userId) return `user:${s.userId}`;
  if (s.organizationId) return `owner:${s.organizationId}`;
  return "";
}

// "Chrome on Mac", from the browser's own description. A stolen cookie used from a different
// kind of browser or system doesn't count.
function deviceFamilyOf(userAgent) {
  const ua = String(userAgent || "");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const system = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Other";
  return `${browser} on ${system}`;
}

function deviceTokenOf(req) {
  const found = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEVICE_COOKIE}=`));
  const value = found ? decodeURIComponent(found.slice(DEVICE_COOKIE.length + 1)) : "";
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}

function deviceCookieOptions(req) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const domain = process.env.SESSION_COOKIE_DOMAIN === undefined ? ".managira.com" : process.env.SESSION_COOKIE_DOMAIN;
  const onManagira = /(^|\.)managira\.com$/i.test(req.hostname || "");
  return { path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: 400 * 24 * 60 * 60 * 1000, ...(onManagira && domain ? { domain } : {}) };
}

async function isTrusted(req, db, snapshot, settings) {
  const token = deviceTokenOf(req);
  const account = accountKeyOf(snapshot);
  if (!token || !account || !settings.remember_device_allowed) return false;
  try {
    // Counted from when the code was entered, and never pushed forward by signing in again:
    // with 3 days, the code is asked for at least every 3 days. A school that shortens it
    // shortens browsers already remembered too.
    const { rows } = await db.query(
      `UPDATE login_trusted_devices SET last_used_at = NOW()
        WHERE device_hash = $1 AND account_key = $2 AND expires_at > NOW() AND device_family = $3
          AND created_at > NOW() - make_interval(days => $4)
        RETURNING id`,
      [deviceHashOf(token), account, deviceFamilyOf(req.get("user-agent")), settings.remember_device_days]
    );
    return rows.length > 0;
  } catch (error) {
    if (error.code !== TABLE_MISSING) console.error("[Login code] device check:", error.message);
    return false;
  }
}

async function trustDevice(req, res, db, snapshot, settings) {
  const account = accountKeyOf(snapshot);
  if (!account || !settings.remember_device_allowed) return;
  const token = deviceTokenOf(req) || crypto.randomBytes(32).toString("hex");
  try {
    await db.query(
      `INSERT INTO login_trusted_devices (device_hash, account_key, organization_id, hub_id, device_family, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6))
       ON CONFLICT (device_hash, account_key) DO UPDATE SET device_family = EXCLUDED.device_family, created_at = NOW(), last_used_at = NOW(), expires_at = EXCLUDED.expires_at`,
      [deviceHashOf(token), account, snapshot.organizationId || null, snapshot.hubId || null, deviceFamilyOf(req.get("user-agent")), settings.remember_device_days]
    );
    res.cookie(DEVICE_COOKIE, token, deviceCookieOptions(req));
    if (Math.random() < 0.02) db.query("DELETE FROM login_trusted_devices WHERE expires_at < NOW() - INTERVAL '7 days'").catch(() => {});
  } catch (error) {
    if (error.code !== TABLE_MISSING) console.error("[Login code] trusting a device:", error.message);
  }
}

// A new password means every browser asks for a code again.
async function forgetDevices(db, session) {
  const account = accountKeyOf(session || {});
  if (!account) return;
  await db.query("DELETE FROM login_trusted_devices WHERE account_key = $1", [account]).catch(() => {});
}

const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));

// The page after the password: where to go once the code is right.
function homeOf(session) {
  if (session.guardianId) return "/guardian/dashboard";
  if (session.studentId) return "/student/dashboard";
  if (session.hubId && !session.organizationId) return "/hub/dashboard";
  return "/common/orgDashboard";
}

// On every password sign-in route, outside keepSignedInChoice.
function holdForCode(req, res, next) {
  const remember = ["on", "true", "1", "yes"].includes(String((req.body && req.body.remember) || "").trim().toLowerCase());
  const nextPage = String((req.body && req.body.next) || "") === "mira" ? "mira" : "";
  // Only a sign-in that happened in this request is held: someone already signed in who
  // submits the form again isn't asked for a code for the account they're already in.
  const before = identityOf(req.session);
  let held = false;
  const hold = async (target, original, args) => {
    const session = req.session;
    const db = req.app.get("db") || require("../config/db");
    const settings = await settingsFor(db, session.organizationId);
    // A school can turn the code off; a recognized browser skips it.
    if ((session.organizationId && !settings.login_code_required) || await isTrusted(req, db, session, settings)) {
      session.verifiedBy = "trusted-device";
      return original(...args);
    }
    const email = emailOf(session);
    const snapshot = JSON.parse(JSON.stringify(session));
    delete snapshot.cookie;
    const code = newCode();
    await regenerate(req);
    req.session.pendingLogin = {
      snapshot, target, remember, next: nextPage, email: masked(email), to: email,
      codeHash: hashOf(code), expiresAt: Date.now() + LIFETIME_MS, tries: 0, sends: 1, sentAt: Date.now(),
    };
    await save(req);
    sendCode(email, code).catch(() => {});
    res.set("X-Managira-Login", "code");
    res.set("Cache-Control", "no-store");
    return require("../controllers/accountController").loginGet(req, res, req.app.get("db") || require("../config/db"), { step: "code" });
  };
  const wrap = (name, targetOf) => {
    const original = res[name].bind(res);
    res[name] = (...args) => {
      if (held || !signedIn(req.session) || identityOf(req.session) === before || !emailOf(req.session) || !wanted(req.session)) return original(...args);
      const target = targetOf(args);
      if (target === null) return original(...args);
      held = true;
      return hold(target, original, args).catch((error) => {
        console.error("[Login code] couldn't hold the sign-in:", error.message);
        if (!res.headersSent) res.status(500).send("Sign-in failed. Please try again.");
      });
    };
  };
  // A sign-in ends by sending the person on (staff) or by the page that takes them to their
  // portal (a parent, student or hub on the main login).
  wrap("redirect", (args) => {
    const url = String(args[args.length - 1] || "");
    return /\/account\/(login|sso)|\/hub\/login/.test(url) ? null : url;
  });
  wrap("render", (args) => (args[0] === "account/goingTo" && args[1] && args[1].target ? args[1].target : homeOf(req.session)));
  return next();
}

function pendingOf(req) {
  const pending = req.session && req.session.pendingLogin;
  if (!pending || !pending.snapshot) return null;
  if (Date.now() > pending.expiresAt || pending.tries >= MAX_TRIES) return { expired: true };
  return pending;
}

async function verify(req, res, db) {
  const pending = pendingOf(req);
  if (!pending || pending.expired) {
    if (req.session) delete req.session.pendingLogin;
    req.flash("error", "That code has expired. Log in again.");
    return res.redirect("/account/login");
  }
  const given = Buffer.from(hashOf(req.body && req.body.code));
  const right = Buffer.from(pending.codeHash);
  if (tidy(req.body && req.body.code).length !== CODE_LENGTH || given.length !== right.length || !crypto.timingSafeEqual(given, right)) {
    pending.tries += 1;
    const left = MAX_TRIES - pending.tries;
    if (left <= 0) {
      delete req.session.pendingLogin;
      req.flash("error", "Too many wrong codes. Log in again for a new one.");
      return res.redirect("/account/login");
    }
    return require("../controllers/accountController").loginGet(req, res, db, { step: "code", codeError: `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` });
  }
  const { snapshot, target, remember, next } = pending;
  await regenerate(req);
  Object.assign(req.session, snapshot);
  const role = String(snapshot.userRole || snapshot.accountType || "").trim().toLowerCase();
  const settings = await settingsFor(db, snapshot.organizationId);
  const keep = remember && !PLATFORM_ROLES.has(role) && settings.keep_signed_in_allowed;
  req.session.keepSignedIn = keep;
  req.session.signedInAt = Date.now();
  if (keep) req.session.cookie.maxAge = settings.keep_signed_in_days * 24 * 60 * 60 * 1000;
  else req.session.cookie.expires = false;
  req.session.lastActivity = Date.now();
  req.session.verifiedBy = "email-code";
  await save(req);
  // "Don't ask again on this browser" is ticked unless the person unticks it.
  await trustDevice(req, res, db, snapshot, settings);
  if (next === "mira" && !snapshot.studentId && !snapshot.guardianId) {
    return res.redirect(`${(process.env.MIRA_PUBLIC_URL || "https://mira.managira.com").replace(/\/$/, "")}/continue`);
  }
  return res.redirect(target || homeOf(snapshot));
}

async function resend(req, res, db) {
  const pending = pendingOf(req);
  if (!pending || pending.expired) {
    if (req.session) delete req.session.pendingLogin;
    req.flash("error", "That code has expired. Log in again.");
    return res.redirect("/account/login");
  }
  const accountController = require("../controllers/accountController");
  if (pending.sends >= MAX_SENDS) return accountController.loginGet(req, res, db, { step: "code", codeError: "We've sent several codes already. Check your spam folder, or log in again later." });
  if (Date.now() - pending.sentAt < RESEND_AFTER_MS) return accountController.loginGet(req, res, db, { step: "code", codeNote: "We just sent a code. It can take a minute to arrive." });
  const code = newCode();
  Object.assign(pending, { codeHash: hashOf(code), expiresAt: Date.now() + LIFETIME_MS, tries: 0, sends: pending.sends + 1, sentAt: Date.now() });
  await save(req);
  sendCode(pending.to, code).catch(() => {});
  return accountController.loginGet(req, res, db, { step: "code", codeNote: "We sent a new code." });
}

// GET /account/login/code: the code page again (a refresh, or Mira handing over).
function page(req, res, db) {
  const pending = pendingOf(req);
  if (!pending || pending.expired) return res.redirect("/account/login");
  res.set("Cache-Control", "no-store");
  return require("../controllers/accountController").loginGet(req, res, db, { step: "code" });
}

module.exports = { holdForCode, verify, resend, page, pendingOf, sendCode, forgetDevices, accountKeyOf, deviceFamilyOf, DEVICE_COOKIE, newCode, tidy, hashOf, masked, CODE_LENGTH, LETTERS };
