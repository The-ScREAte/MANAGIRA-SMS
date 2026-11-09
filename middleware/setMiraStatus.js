const db = require('../config/db');
const { getMiraIntegrationStatus } = require('../utils/miraIntegration');
const { createShortCache } = require('../utils/shortCache');
const miraStatuses = createShortCache({ ttlMs: 30000 });

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

  if (!req.session.organizationId) {
    return next();
  }
  // Mira is for a school's staff: parents and students never see it.
  const role = String(req.session.userRole || req.session.accountType || "").trim().toLowerCase();
  if (req.session.guardianId || req.session.studentId || ["guardian", "parent", "student"].includes(role)) {
    return next();
  }

  try {
    const organizationId = req.session.organizationId;
    const status = await miraStatuses.get(organizationId, 'status', () => getMiraIntegrationStatus(db, organizationId));
    res.locals.miraActivated = !!status.activated;
  } catch (err) {
    console.error('❌ Error fetching Mira activation status:', err);
  }

  next();
};

module.exports = setMiraStatus;
