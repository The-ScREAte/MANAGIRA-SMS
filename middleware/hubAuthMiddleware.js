const db = require("../config/db");

// Middleware to ensure hub is authenticated
const isHubAuthenticated = async (req, res, next) => {
  try {
    // Check if hub session exists
    if (!req.session.hubId || req.session.accountType !== 'Hub') {
      req.flash('error', 'Please login to access the hub dashboard.');
      return res.redirect('/hub/login');
    }

    // Validate hub status
    const hub = await db.query(
      'SELECT deleted, on_hold FROM managira_hubs WHERE hub_id = $1',
      [req.session.hubId]
    );

    if (hub.rows.length === 0) {
      req.session.destroy();
      req.flash('error', 'Hub not found.');
      return res.redirect('/hub/login');
    }

    if (hub.rows[0].deleted || hub.rows[0].on_hold) {
      req.session.destroy();
      req.flash('error', 'Hub account is suspended. Please contact support.');
      return res.redirect('/hub/login');
    }

    next();
  } catch (err) {
    console.error('Hub auth middleware error:', err);
    req.flash('error', 'Authentication error.');
    res.redirect('/hub/login');
  }
};

// Middleware to fetch hub info and make it available in views
const fetchHubInfo = async (req, res, next) => {
  try {
    if (req.session.hubId) {
      const result = await db.query(
        `SELECT h.hub_id, h.hub_name, h.hub_nickname, h.hub_email, h.first_name, h.last_name, 
                h.logo_path, h.plan_id, h.max_organizations, h.hub_branding_enabled, h.hub_footer_text,
                h.hub_phone, h.hub_address,
                p.plan_name
         FROM managira_hubs h
         LEFT JOIN plans p ON h.plan_id = p.id
         WHERE h.hub_id = $1`,
        [req.session.hubId]
      );

      if (result.rows.length > 0) {
        res.locals.hubInfo = result.rows[0];
        req.hubInfo = result.rows[0];
      }
    }
    next();
  } catch (err) {
    console.error('Error fetching hub info:', err);
    next();
  }
};

// Middleware to block non-hub users from accessing hub routes
const ensureHub = (req, res, next) => {
  if (req.session.accountType !== 'Hub') {
    req.flash('error', 'Access denied. Hub access only.');
    return res.redirect('/account/login');
  }
  next();
};

module.exports = { 
  isHubAuthenticated, 
  fetchHubInfo,
  ensureHub
};
