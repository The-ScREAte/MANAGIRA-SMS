// Which integrations a school has switched on, read once per school every 30 seconds.
//
// A permission that belongs to an integration exists only while that integration is on
// (middleware/permissionMiddleware.js), so menus, pages, Mira and the staff form all show a
// school's integrations exactly as they are. Whoever flips a switch calls forget().
const cacheManager = require("./cacheManager");

const TTL_SECONDS = 30;
const LABELS = { transportation: "Transportation", mira: "Mira" };
const cacheKey = (organizationId) => `integration-switches:${organizationId}`;

// Null when the switches can't be read: callers then leave access alone, as with an unreadable
// plan, so an outage never hides a school's pages.
async function switchesFor(database, organizationId) {
  const id = Number(organizationId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    return await cacheManager.getOrFetch(
      "organization",
      cacheKey(id),
      async () => {
        const row = (await database.query(
          `SELECT transportation_activated, mira_activated FROM organizations WHERE organization_id = $1 LIMIT 1`,
          [id]
        )).rows[0];
        if (!row) return null;
        return { transportation: row.transportation_activated === true, mira: row.mira_activated === true };
      },
      { ttl: TTL_SECONDS }
    );
  } catch (_error) {
    return null;
  }
}

// True unless the school is known to have it off.
async function isOn(database, organizationId, integration) {
  const switches = await switchesFor(database, organizationId);
  return !switches || switches[integration] !== false;
}

function forget(organizationId) {
  if (organizationId) cacheManager.invalidate("organization", cacheKey(Number(organizationId)));
}

const labelOf = (integration) => LABELS[integration] || integration;
// What a person is told when they reach for something of an integration that is off.
const offMessage = (integration) => `${labelOf(integration)} is turned off for this school. A manager can turn it on in Settings, Integrations.`;

const HOMES = { guardian: "/guardian/dashboard", student: "/student/dashboard", driver: "/driver/dashboard" };

// For a router that belongs wholly to an integration: nothing under it answers while the school
// has it off. Someone opening a page is sent home with the reason; anything else gets a 403.
function guard(database, integration) {
  return async (req, res, next) => {
    const session = req.session || {};
    if (!session.organizationId || await isOn(database, session.organizationId, integration)) return next();
    const message = offMessage(integration);
    const opensPage = req.method === "GET" && !req.xhr && /text\/html/.test(String(req.headers.accept || ""));
    if (!opensPage) return res.status(403).json({ success: false, message });
    try { req.flash("error", message); } catch (_error) { /* no flash on this request */ }
    return res.redirect(HOMES[String(session.userRole || "").trim().toLowerCase()] || "/common/orgDashboard");
  };
}

module.exports = { switchesFor, isOn, forget, labelOf, offMessage, guard };
