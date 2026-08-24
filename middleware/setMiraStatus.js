const db = require('../config/db');
const { getMiraIntegrationStatus } = require('../utils/miraIntegration');

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
    (process.env.NODE_ENV === "production" ? null : `http://localhost:${process.env.MIRA_PORT || 4100}`);

  if (!req.session.organizationId) {
    return next();
  }

  try {
    const status = await getMiraIntegrationStatus(db, req.session.organizationId);
    res.locals.miraActivated = !!status.activated;
  } catch (err) {
    console.error('❌ Error fetching Mira activation status:', err);
  }

  next();
};

module.exports = setMiraStatus;
