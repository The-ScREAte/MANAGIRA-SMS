const db = require('../config/db');
const { getMiraIntegrationStatus } = require('../utils/miraIntegration');

// Makes "is Mira activated for this org" available to every EJS render
// (used by partials/header.ejs to show/hide the header icon) without every
// controller having to fetch and pass it individually. Mirrors
// setThemeColor.js's shape.
const setMiraStatus = async (req, res, next) => {
  res.locals.miraActivated = false;
  res.locals.miraPublicUrl = process.env.MIRA_PUBLIC_URL || `http://localhost:${process.env.MIRA_PORT || 4100}`;

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
