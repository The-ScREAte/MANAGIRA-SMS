const { accessFor, activatedFor, schoolNameFor, isStaffSession } = require('../utils/miraAccess');

// Makes "is Mira activated for this org" available to every EJS render
// (used by partials/header.ejs to show/hide the header icon) without every
// controller having to fetch and pass it individually. Mirrors
// setThemeColor.js's shape.
const setMiraStatus = async (req, res, next) => {
  res.locals.miraActivated = false;
  // In production, MIRA_PUBLIC_URL must be a real configured URL (e.g.
  // https://mira.managira.com) - falling back to a localhost dev URL would
  // send every user to an address that only resolves on their own machine.
  // Only use the localhost fallback outside production, where it's the
  // correct behavior for local development.
  res.locals.miraPublicUrl = process.env.MIRA_PUBLIC_URL ||
    (process.env.NODE_ENV === "production" ? null : require("../utils/miraIntegration").miraPublicUrl());

  res.locals.miraCanUse = false;
  res.locals.miraCanManage = false;
  res.locals.miraCanTurnOn = false;
  // The header's Mira button: every member of staff sees it, on or off (utils/miraAccess.js).
  res.locals.miraOffered = false;
  // Mira is for a school's staff: parents and students never see it.
  if (!isStaffSession(req.session)) return next();
  res.locals.miraOffered = true;

  try {
    // Pages only: whether this person may use Mira (their own "Use Mira") and give it
    // (utils/miraAccess.js) decides what the header button does.
    const wantsPage = req.method === "GET" && String(req.headers.accept || "").includes("text/html");
    if (wantsPage) {
      const [access, schoolName] = await Promise.all([accessFor(req), schoolNameFor(req.session.organizationId).catch(() => "")]);
      res.locals.miraSchoolName = schoolName;
      res.locals.miraActivated = access.activated;
      res.locals.miraCanUse = access.canUse;
      res.locals.miraCanManage = access.canManage;
      res.locals.miraCanTurnOn = access.canTurnOn;
    } else {
      res.locals.miraActivated = await activatedFor(req.session.organizationId);
    }
  } catch (err) {
    console.error('❌ Error fetching Mira activation status:', err);
  }

  next();
};

module.exports = setMiraStatus;
