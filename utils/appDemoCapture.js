// Interactive page captures for the product tour (/legal/app-demo).
//
// A full Admin opens a 30-minute capture window for one school from
// /admin/app-demo. While it is open, staff signed in to that school (including
// an Admin switched into it) see a "Capture this page" bar on every page
// (public/js/demoCapture.js). A capture records the page and every state its
// toggles, tabs and expanders lead to, and is saved as a version of a tour
// step. Visitors replay it in a sandbox (public/js/appDemoPlayer.js): nothing
// from the capture can run scripts or reach the server.
const { ensureAppDemoSchema } = require("./appDemo");

const WINDOW_MINUTES = 30;
const CACHE_MS = 5 * 1000;
const NON_STAFF_ROLES = new Set(["guardian", "student", "driver", "parent"]);
let cache = { at: 0, window: null };

async function activeWindow(db) {
  if (Date.now() - cache.at < CACHE_MS) return cache.window && new Date(cache.window.ends_at) > new Date() ? cache.window : null;
  await ensureAppDemoSchema(db);
  const { rows } = await db.query(
    `SELECT w.id, w.organization_id, w.ends_at, o.organization_name
       FROM app_demo_capture_windows w
       JOIN organizations o ON o.organization_id = w.organization_id
      WHERE w.ended_at IS NULL AND w.ends_at > NOW()
      ORDER BY w.id DESC LIMIT 1`
  );
  cache = { at: Date.now(), window: rows[0] || null };
  return cache.window;
}

async function startWindow(db, organizationId, userId) {
  await ensureAppDemoSchema(db);
  await db.query(`UPDATE app_demo_capture_windows SET ended_at = NOW() WHERE ended_at IS NULL`);
  await db.query(
    `INSERT INTO app_demo_capture_windows (organization_id, enabled_by, ends_at)
     VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
    [organizationId, userId || null, WINDOW_MINUTES]
  );
  cache = { at: 0, window: null };
  return activeWindow(db);
}

async function stopWindow(db) {
  await ensureAppDemoSchema(db);
  await db.query(`UPDATE app_demo_capture_windows SET ended_at = NOW() WHERE ended_at IS NULL`);
  cache = { at: 0, window: null };
}

// Staff (not parents, students or drivers) signed in to the school that has the open window.
function isCaptureSession(req, window) {
  const s = req.session || {};
  if (!window || !s.userId || !s.organizationId) return false;
  if (Number(s.organizationId) !== Number(window.organization_id)) return false;
  const role = String(s.userRole || s.accountType || "").trim().toLowerCase();
  return !NON_STAFF_ROLES.has(role);
}

// Sets res.locals.demoCapture on full page loads for people who may capture.
function captureLocals(db) {
  return async (req, res, next) => {
    if (req.method !== "GET" || !req.session || !req.session.organizationId) return next();
    try {
      const window = await activeWindow(db);
      if (isCaptureSession(req, window)) {
        res.locals.demoCapture = { endsAt: new Date(window.ends_at).toISOString(), school: window.organization_name };
      }
    } catch (_) { /* capture is optional; never block a page */ }
    next();
  };
}

// The capture bar asks this on load and every few seconds, so turning capture
// off (or it ending) removes the bar from open pages and from pages the
// service worker kept.
function captureStatus(db) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const window = await activeWindow(db);
      if (isCaptureSession(req, window)) {
        return res.json({ active: true, endsAt: new Date(window.ends_at).toISOString(), school: window.organization_name });
      }
    } catch (_) { /* treat as off */ }
    return res.json({ active: false });
  };
}

// A recording started before the window ran out can still be saved for a while
// afterwards. Only when time ran out: an Admin turning capture off still ends it.
const SAVE_GRACE_MINUTES = 120;
async function recentlyExpiredWindow(db, organizationId) {
  if (!organizationId) return null;
  const { rows } = await db.query(
    `SELECT w.id, w.organization_id, w.ends_at, o.organization_name
       FROM app_demo_capture_windows w
       JOIN organizations o ON o.organization_id = w.organization_id
      WHERE w.organization_id = $1 AND w.ended_at IS NULL
        AND w.ends_at > NOW() - make_interval(mins => $2)
      ORDER BY w.id DESC LIMIT 1`,
    [organizationId, SAVE_GRACE_MINUTES]
  );
  return rows[0] || null;
}

// For the capture API: rejects anyone outside the open window (saving also
// accepts a window that ran out while the capture was being made).
function requireCaptureSession(db, { allowExpired = false } = {}) {
  return async (req, res, next) => {
    try {
      const window = await activeWindow(db);
      if (isCaptureSession(req, window)) return next();
      if (allowExpired) {
        const recent = await recentlyExpiredWindow(db, Number(req.session && req.session.organizationId));
        if (isCaptureSession(req, recent)) return next();
      }
    } catch (_) { /* fall through */ }
    return res.status(403).json({ success: false, message: "Demo capture is not turned on for this school, or it has ended." });
  };
}

module.exports = { WINDOW_MINUTES, activeWindow, startWindow, stopWindow, captureLocals, captureStatus, requireCaptureSession };
