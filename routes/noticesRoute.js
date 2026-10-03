// Feedback requests from the Managira admin, for signed-in school users:
// the prompt in the page layout (partials/feedbackPrompt.ejs) and the page
// linked from the notification bell.
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const notices = require("../utils/platformNotices");

function requireRespondent(req, res, next) {
  const who = notices.respondentFromSession(req.session);
  if (!who) {
    if (req.method === "GET" && !String(req.get("accept") || "").includes("application/json")) {
      return res.redirect("/account/login");
    }
    return res.status(401).json({ success: false, message: "Please sign in." });
  }
  req.noticeRespondent = who;
  next();
}

// GET /notices/active - the next feedback request this person should answer.
router.get("/active", requireRespondent, async (req, res) => {
  try {
    notices.sweepFeedbackNotificationsSoon(db);
    const pending = await notices.pendingFeedbackFor(db, req.noticeRespondent);
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, feedback: pending.length ? notices.publicRequest(pending[0]) : null, pendingCount: pending.length });
  } catch (error) {
    console.error("[notices/active]", error.message);
    return res.json({ success: false, feedback: null, pendingCount: 0 });
  }
});

// GET /notices/feedback/:id - a feedback request on its own page (from the bell).
router.get("/feedback/:id", requireRespondent, async (req, res) => {
  const loaded = await notices.loadRequestForRespondent(db, Number(req.params.id), req.noticeRespondent).catch(() => ({ error: "Something went wrong.", status: 500 }));
  return res.render("common/feedbackRespond", {
    title: loaded.request ? loaded.request.title : "Feedback",
    feedback: loaded.request && !loaded.error ? notices.publicRequest(loaded.request) : null,
    existing: loaded.existing || null,
    canEdit: Boolean(loaded.request && loaded.request.allow_edit),
    errorMessage: loaded.error || null,
    noFeedbackPrompt: true,
  });
});

// POST /notices/feedback/:id  { rating, comment }
router.post("/feedback/:id", requireRespondent, express.json(), async (req, res) => {
  try {
    const result = await notices.saveFeedbackResponse(db, req.noticeRespondent, Number(req.params.id), req.body || {});
    if (result.error) return res.status(result.status || 400).json({ success: false, message: result.error });
    return res.json({ success: true, updated: result.updated, message: "Thank you for your feedback! Your response has been submitted." });
  } catch (error) {
    console.error("[notices/feedback]", error.message);
    return res.status(500).json({ success: false, message: "Your feedback could not be sent. Please try again." });
  }
});

module.exports = router;
