// Unsubscribe links in optional emails (utils/emailLinks.js) and the "manage your email
// settings" link. Opening a link changes nothing: link checkers in mail systems open every
// link. The button on the page, or a mail provider's one-click POST (RFC 8058), does.
const express = require("express");
const db = require("../config/db");
const { readUnsubscribeToken } = require("../utils/emailLinks");
const { categoryOf, setEmailChoice } = require("../utils/emailPreferences");

const router = express.Router();

// "jo•••@example.com": enough for someone to recognise their own address.
function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return "";
  const shown = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(2, Math.min(6, name.length - shown.length)))}@${domain}`;
}

function pageFor(req) {
  const token = String(req.query.t || req.body?.t || "");
  const link = readUnsubscribeToken(token);
  const category = link ? categoryOf(link.category) : null;
  return { token, link: link && category ? link : null, category };
}

function render(res, status, view) {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex");
  return res.status(status).render("email/unsubscribe", { layout: false, ...view });
}

router.get("/unsubscribe", (req, res) => {
  const { token, link, category } = pageFor(req);
  if (!link) return render(res, 400, { state: "invalid" });
  return render(res, 200, { state: "confirm", token, what: category.label, address: maskEmail(link.email) });
});

router.post("/unsubscribe", async (req, res) => {
  const { token, link, category } = pageFor(req);
  const oneClick = String(req.body?.["List-Unsubscribe"] || "") === "One-Click";
  if (!link) {
    return oneClick ? res.status(400).type("text/plain").send("This unsubscribe link isn't valid.") : render(res, 400, { state: "invalid" });
  }
  const turnOn = String(req.body?.action || "") === "resubscribe";
  try {
    await setEmailChoice(db, link.email, link.category, turnOn);
  } catch (error) {
    console.error("[Email] Unsubscribe failed:", error.message);
    return oneClick ? res.status(503).type("text/plain").send("Please try again.") : render(res, 503, { state: "error", token });
  }
  if (oneClick) return res.status(200).type("text/plain").send("Unsubscribed.");
  return render(res, 200, { state: turnOn ? "resubscribed" : "unsubscribed", token, what: category.label, address: maskEmail(link.email) });
});

// "Manage your email settings": the signed-in person's own settings page.
router.get("/settings", (req, res) => {
  const session = req.session || {};
  if (session.guardianId) return res.redirect("/guardian/settings");
  if (session.user && session.organizationId) return res.redirect("/account/settings?section=notifications");
  if (session.hubId) return res.redirect("/hub/settings");
  return res.redirect("/account/login");
});

module.exports = router;
