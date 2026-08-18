// Mira's own thin auth surface. Deliberately does NOT touch the shared
// Managira session (never calls the main app's /account/logout, never
// destroys the session row) - "signed out of Mira" is tracked with a
// small Mira-only cookie, independent of the real Managira login that
// other tabs/apps rely on. See middleware/ssoAuth.js for how this flag is
// honored.
const express = require("express");
const router = express.Router();
const { resolveIdentity, MIRA_SIGNED_OUT_COOKIE } = require("../middleware/ssoAuth");

const MAIN_APP_PUBLIC_URL = process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4000";

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
    });
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
