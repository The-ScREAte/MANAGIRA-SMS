// Signing in to and out of Mira.
//
// Mira has no password form of its own. Signing in happens on Managira's
// own sign-in page (/account/login?next=mira) - email first, single sign-on,
// the emailed verification code, Keep me logged in and the wrong-password
// waits all apply exactly as everywhere else - and Managira sends staff back
// here (/continue) once they're in. Mira never sees a password.
//
// Log out signs the person out of Managira itself: one sign-in is shared by
// Managira and Mira, so leaving it open after "Log out" would leave the
// school's data open on that computer.
const express = require("express");
const router = express.Router();
const { resolveIdentity, forgetIdentity, MIRA_SIGNED_OUT_COOKIE } = require("../middleware/ssoAuth");

const MAIN_APP_PUBLIC_URL = (process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const SIGN_IN = `${MAIN_APP_PUBLIC_URL}/account/login?next=mira`;
const REASONS = new Set(["expired", "idle"]);

// Mira's old "signed out of Mira only" cookie is no longer used; clear it wherever it's left.
function clearOldSignedOutFlag(res) {
  res.clearCookie(MIRA_SIGNED_OUT_COOKIE, { path: "/" });
}

// GET /login - already signed in: straight to Mira. Otherwise: Managira's sign-in page.
router.get("/login", async (req, res) => {
  clearOldSignedOutFlag(res);
  res.set("Cache-Control", "no-store");
  try {
    const { identity } = await resolveIdentity(req);
    if (identity) return res.redirect("/");
    const reason = REASONS.has(req.query.reason) ? `&reason=${req.query.reason}` : "";
    return res.redirect(`${SIGN_IN}${reason}`);
  } catch (error) {
    // Managira can't be reached: say so, with a way to try again.
    console.error("[mira/authRoute/login]", error);
    return res.status(503).render("login", { title: "Sign in - Mira", layout: false, signInUrl: SIGN_IN });
  }
});

// An old bookmarked form, or a page left open from before: never read a password here.
router.post("/login", (req, res) => res.redirect(303, SIGN_IN));

// GET /continue - where Managira sends staff once they're signed in for Mira.
router.get("/continue", (req, res) => {
  clearOldSignedOutFlag(res);
  res.redirect("/");
});

// GET /logout - signs out of Managira and Mira together.
router.get("/logout", async (req, res) => {
  await forgetIdentity(req).catch(() => {});
  clearOldSignedOutFlag(res);
  res.set("Cache-Control", "no-store");
  res.redirect(`${MAIN_APP_PUBLIC_URL}/account/logout?next=mira`);
});

module.exports = router;
