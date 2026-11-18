const { accessFor, activatedFor, isStaffSession } = require('../utils/miraAccess');

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
  // Mira is for a school's staff: parents and students never see it.
  if (!isStaffSession(req.session)) return next();

  try {
    // Pages only: whether this person may use Mira (their own "Use Mira") and give it
    // (utils/miraAccess.js) decides what the header button does.
    const wantsPage = req.method === "GET" && String(req.headers.accept || "").includes("text/html");
    if (wantsPage) {
      const access = await accessFor(req);
      res.locals.miraActivated = access.activated;
      res.locals.miraCanUse = access.canUse;
      res.locals.miraCanManage = access.canManage;
    } else {
      res.locals.miraActivated = await activatedFor(req.session.organizationId);
    }
  } catch (err) {
    console.error('❌ Error fetching Mira activation status:', err);
  }

  next();
};

module.exports = setMiraStatus;
