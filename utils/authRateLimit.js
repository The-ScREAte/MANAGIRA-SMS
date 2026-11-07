// Brute-force guard for sign-in and password routes.
// Two limits: per account (stops password guessing on one login) and per
// network (stops one machine hammering many logins). The network limit is
// generous because a whole school often signs in from one address.
const { checkRateLimit } = require("./rateLimiter");
const { BoundedMap } = require("./boundedMap");

const WINDOW_MS = 15 * 60 * 1000;

// Render sits in front of the app and Express does not trust proxies here, so
// req.ip is Render's address. Use the address Render (or Cloudflare) saw.
function clientIp(req) {
  const cf = String(req.get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const forwarded = String(req.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  // The last entry is the one added by our own proxy, so it can't be faked.
  return forwarded.length ? forwarded[forwarded.length - 1] : (req.ip || "unknown");
}

function sameSiteReferer(req) {
  try {
    const ref = new URL(req.get("referer") || "");
    return ref.host === req.get("host") ? ref.pathname + ref.search : null;
  } catch (_) {
    return null;
  }
}

// Security log line for Render logs. Emails are masked; passwords never logged.
function maskAccount(value) {
  const text = String(value || "");
  const at = text.indexOf("@");
  if (at > 1) return `${text.slice(0, 2)}***${text.slice(at)}`;
  return text ? `${text.slice(0, 2)}***` : "";
}

function securityLog(event, req, details = {}) {
  console.warn(`[Security] ${JSON.stringify({ event, ip: clientIp(req), path: req.originalUrl, at: new Date().toISOString(), ...details })}`);
}

function reject(req, res, retryAfterMs) {
  req.authRateLimited = true;
  const minutes = Math.max(1, Math.ceil((retryAfterMs || WINDOW_MS) / 60000));
  const message = `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  res.set("Retry-After", String(Math.ceil((retryAfterMs || WINDOW_MS) / 1000)));
  const wantsJson = req.xhr || /json/i.test(req.get("accept") || "") || /json/i.test(req.get("content-type") || "");
  if (wantsJson || typeof req.flash !== "function") {
    return res.status(429).json({ success: false, message });
  }
  req.flash("error", message);
  return res.redirect(303, sameSiteReferer(req) || req.originalUrl);
}

// name: which form (login, guardian-login…). field: the body field naming the account.
function authRateLimit(name, { field = "email", perAccount = 10, perIp = 300 } = {}) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const accountForLog = maskAccount((req.body && req.body[field]) || "");
    // A sign-in that ends back on a sign-in page failed; record it.
    res.on("finish", () => {
      const location = String(res.get("location") || "");
      if (req.authRateLimited) securityLog("sign_in_rate_limited", req, { form: name, account: accountForLog });
      else if (/login/.test(name) && res.statusCode >= 300 && res.statusCode < 400 && /login/i.test(location)) {
        securityLog("sign_in_failed", req, { form: name, account: accountForLog });
      }
    });
    const ipLimit = checkRateLimit(`auth:${name}:ip:${ip}`, { max: perIp, windowMs: WINDOW_MS });
    if (!ipLimit.allowed) return reject(req, res, ipLimit.retryAfterMs);

    const account = String((req.body && req.body[field]) || "").trim().toLowerCase();
    if (account) {
      const accountLimit = checkRateLimit(`auth:${name}:acct:${account}`, { max: perAccount, windowMs: WINDOW_MS });
      if (!accountLimit.allowed) return reject(req, res, accountLimit.retryAfterMs);
    }
    return next();
  };
}

// The sign-in forms never turn anyone away. A lock on an account would let a stranger shut
// someone out just by typing their email, so a right password always gets in. What slows a
// guesser down is time: past a free allowance of wrong tries, each further try on that account
// (or from that network) waits its turn before its password is even checked.
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const FREE_WRONG_PER_ACCOUNT = 10;
const FREE_WRONG_PER_NETWORK = 300; // A whole school often signs in from one address.
const TURN_PER_ACCOUNT_MS = 2000;
const TURN_PER_NETWORK_MS = 500;
const LONGEST_WAIT_MS = 15000;
const tries = new BoundedMap(20000);

function trackOf(key, now) {
  let row = tries.get(key);
  if (!row || now - row.startedAt > SIGN_IN_WINDOW_MS) {
    row = { startedAt: now, wrong: 0, nextTurnAt: 0 };
    tries.set(key, row);
  }
  return row;
}

function turnFor(row, free, step, now) {
  if (row.wrong < free) return 0;
  const turn = Math.max(now, row.nextTurnAt);
  row.nextTurnAt = turn + step;
  return turn - now;
}

// name: which form. field: the body field naming the account. failedWhen: where a failed try is
// sent back to; anywhere else means it went through.
function signInGuard(name, { field = "email", failedWhen = /login/i } = {}) {
  return (req, res, next) => {
    const account = String((req.body && req.body[field]) || "").trim().toLowerCase();
    const accountKey = account ? `signin:${name}:acct:${account}` : null;
    const networkKey = `signin:${name}:ip:${clientIp(req)}`;
    const now = Date.now();
    res.on("finish", () => {
      const location = String(res.get("location") || "");
      const failed = res.statusCode >= 300 && res.statusCode < 400 && failedWhen.test(location);
      if (failed) {
        const at = Date.now();
        trackOf(networkKey, at).wrong += 1;
        if (accountKey) trackOf(accountKey, at).wrong += 1;
        securityLog("sign_in_failed", req, { form: name, account: maskAccount(account) });
      } else if (accountKey && res.statusCode < 400) {
        tries.delete(accountKey);
      }
    });
    const wait = Math.min(LONGEST_WAIT_MS, Math.max(
      accountKey ? turnFor(trackOf(accountKey, now), FREE_WRONG_PER_ACCOUNT, TURN_PER_ACCOUNT_MS, now) : 0,
      turnFor(trackOf(networkKey, now), FREE_WRONG_PER_NETWORK, TURN_PER_NETWORK_MS, now)
    ));
    if (wait > 0) {
      securityLog("sign_in_slowed", req, { form: name, account: maskAccount(account), waitMs: wait });
      return setTimeout(next, wait);
    }
    return next();
  };
}

// An email nobody has must take as long to answer as one with a wrong password, or the time
// taken tells a stranger which emails have accounts.
const NOBODY = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.zfV3HtZ6Z0E0pJc6GEBk3qk3qR5K";
async function takeTheSameTime(password) {
  await require("bcryptjs").compare(String(password || ""), NOBODY).catch(() => false);
}

module.exports = { authRateLimit, signInGuard, takeTheSameTime, clientIp, securityLog, maskAccount };
