// Mira's own thin auth surface.
//
// Logout is Mira-local by design: it never touches the shared Managira
// session (never calls the main app's /account/logout, never destroys the
// session row) - "signed out of Mira" is tracked with a small Mira-only
// cookie. See middleware/ssoAuth.js for how that flag is honored.
//
// Login is a genuine native form on Mira ("log in here directly"), not a
// bounce to the main app - but it authenticates against the exact same
// account system by relaying credentials to the main app's real,
// unmodified POST /account/login and forwarding back whatever session
// cookie that issues. No credential-checking logic is duplicated here;
// Mira never sees or stores a password beyond this one relay call.
const express = require("express");
const router = express.Router();
const { resolveIdentity, MIRA_SIGNED_OUT_COOKIE } = require("../middleware/ssoAuth");

const MAIN_APP_PUBLIC_URL = process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4000";
// Matches server.js's own BASE_PORT (process.env.PORT, Render's dynamically
// assigned port) - see internalApiClient.js for the full explanation.
const MAIN_APP_INTERNAL_BASE_URL = process.env.MAIN_APP_INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "connect.sid";

// Trivial in-memory rate limit on login attempts, matching
// middleware/rateLimiter.js's own documented trade-off (single-process
// only) - login has no per-tenant identity to key on yet, so this is a
// simple per-IP guard against brute-forcing through Mira specifically.
const attemptsByIp = new Map();
const MAX_ATTEMPTS_PER_WINDOW = 10;
const WINDOW_MS = 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS);
  const key = `${ip}:${windowStart}`;
  const count = (attemptsByIp.get(key) || 0) + 1;
  attemptsByIp.set(key, count);
  if (attemptsByIp.size > 5000) attemptsByIp.delete(attemptsByIp.keys().next().value);
  return count > MAX_ATTEMPTS_PER_WINDOW;
}

function renderLoginError(req, res, message, statusCode = 200) {
  return res.status(statusCode).render("login", {
    title: "Sign in - Mira",
    layout: false,
    mainAppUrl: MAIN_APP_PUBLIC_URL,
    hasUnderlyingSession: false,
    displayName: null,
    reason: null,
    formError: message,
    formEmail: req.body?.email || "",
  });
}

// GET /login - shown whenever pageAuth can't resolve a session (real expiry,
// no cookie at all, or the user chose "Log out" on Mira specifically).
router.get("/login", async (req, res) => {
  try {
    // Check the REAL underlying session regardless of the Mira-local
    // signed-out flag, so someone who only signed out of Mira (but is
    // still logged into Managira elsewhere) gets a one-click "continue"
    // instead of being asked to log in again from scratch.
    const { identity } = await resolveIdentity(req, { ignoreMiraSignedOut: true });

    res.render("login", {
      title: "Sign in - Mira",
      layout: false,
      mainAppUrl: MAIN_APP_PUBLIC_URL,
      hasUnderlyingSession: !!identity,
      displayName: identity ? [identity.firstName, identity.lastName].filter(Boolean).join(" ") : null,
      reason: req.query.reason || null,
      formError: null,
      formEmail: "",
    });
  } catch (error) {
    console.error("[mira/authRoute/login]", error);
    res.render("login", {
      title: "Sign in - Mira",
      layout: false,
      mainAppUrl: MAIN_APP_PUBLIC_URL,
      hasUnderlyingSession: false,
      displayName: null,
      reason: "error",
      formError: null,
      formEmail: "",
    });
  }
});

// POST /login - the native "log in here" form. Relays credentials to the
// main app's real login route and forwards its session cookie back to the
// browser on Mira's own response, so the same login works for both apps.
router.post("/login", express.urlencoded({ extended: true }), async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return renderLoginError(req, res, "Too many attempts. Please wait a minute and try again.", 429);
  }

  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return renderLoginError(req, res, "Email and password are required.", 400);
  }

  try {
    const relayResponse = await fetch(`${MAIN_APP_INTERNAL_BASE_URL}/account/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        // res.redirect("back") on a validation failure needs a Referer to
        // resolve consistently to the login page (not "/", which would be
        // indistinguishable from a real success redirect).
        Referer: `${MAIN_APP_INTERNAL_BASE_URL}/account/login`,
      },
      body: JSON.stringify({ email, password }),
    });

    const location = relayResponse.headers.get("location") || "";
    const isRedirect = relayResponse.status >= 300 && relayResponse.status < 400;
    const isSuccess = isRedirect && !location.includes("/account/login");

    if (!isSuccess) {
      return renderLoginError(req, res, "Invalid email or password.");
    }

    const setCookieValues = relayResponse.headers.getSetCookie
      ? relayResponse.headers.getSetCookie()
      : [relayResponse.headers.get("set-cookie")].filter(Boolean);
    const sessionCookie = setCookieValues.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

    if (!sessionCookie) {
      console.error("[mira/authRoute/login] main app reported success but sent no session cookie");
      return renderLoginError(req, res, "Login succeeded but Mira couldn't pick up the session. Please try again.", 502);
    }

    // Forward the exact cookie value the main app issued. Locally, host
    // ("localhost") is shared regardless of port so no Domain attribute is
    // needed (matches how the main app's own dev cookie already works); in
    // production the main app sets Domain=.managira.com itself, which
    // res.cookie() below preserves if present in the relayed value - we
    // only need to re-set path/httpOnly/sameSite explicitly since we're
    // constructing this cookie fresh on Mira's own response, not literally
    // forwarding the raw header.
    const cookieValueMatch = sessionCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    const cookieDomainMatch = sessionCookie.match(/Domain=([^;]+)/i);
    const cookieValue = cookieValueMatch ? decodeURIComponent(cookieValueMatch[1]) : null;

    if (!cookieValue) {
      return renderLoginError(req, res, "Login succeeded but Mira couldn't read the session. Please try again.", 502);
    }

    res.cookie(SESSION_COOKIE_NAME, cookieValue, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      domain: cookieDomainMatch ? cookieDomainMatch[1] : undefined,
      maxAge: 24 * 60 * 60 * 1000,
    });
    // A fresh, explicit login always wins over a previous "signed out of
    // Mira" choice.
    res.clearCookie(MIRA_SIGNED_OUT_COOKIE, { path: "/" });

    return res.redirect("/");
  } catch (error) {
    console.error("[mira/authRoute/login]", error);
    return renderLoginError(req, res, "Unable to reach Managira right now. Please try again.", 502);
  }
});

// GET /continue - clears the Mira-local signed-out flag and resumes,
// reusing whatever valid Managira session is already there. No re-auth.
router.get("/continue", (req, res) => {
  res.clearCookie(MIRA_SIGNED_OUT_COOKIE, { path: "/" });
  res.redirect("/");
});

// GET /logout - signs out of Mira ONLY. Sets a Mira-local flag; the shared
// Managira session cookie/row is never touched, so other tabs/apps stay
// logged in exactly as they were.
router.get("/logout", (req, res) => {
  res.cookie(MIRA_SIGNED_OUT_COOKIE, "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.redirect("/login?reason=signed_out");
});

module.exports = router;
