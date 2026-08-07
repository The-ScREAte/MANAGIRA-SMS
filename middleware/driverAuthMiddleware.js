const db = require("../config/db");
const { ensureTransportationSchema } = require("../utils/transportation");

// Gates /driver/* routes to logged-in Driver-role staff and resolves the
// bus (if any) this driver is assigned to onto req.driverBus.
async function isDriverAuthenticated(req, res, next) {
  const safeFlash = (type, message) => {
    try {
      if (req.session && typeof req.flash === "function") req.flash(type, message);
    } catch (_) {}
  };

  try {
    const userId = req.session && (req.session.userId || (req.session.user && req.session.user.user_id));
    if (!req.session || !userId || req.session.userRole !== "Driver") {
      safeFlash("error", "Please log in as a driver.");
      return res.redirect("/account/login");
    }
    req.session.userId = userId;

    const organizationId = req.session.organizationId;
    if (!organizationId) {
      return req.session.destroy(() => res.redirect("/account/login"));
    }

    const orgResult = await db.query(
      "SELECT deleted, on_hold FROM organizations WHERE organization_id = $1 LIMIT 1",
      [organizationId]
    );
    if (!orgResult.rows.length || orgResult.rows[0].deleted || orgResult.rows[0].on_hold) {
      safeFlash("error", "This organization account is no longer active.");
      return req.session.destroy(() => res.redirect("/account/login"));
    }

    const userResult = await db.query(
      `SELECT user_id, on_hold FROM users
        WHERE user_id = $1 AND organization_id = $2 AND account_type = 'Driver'`,
      [req.session.userId, organizationId]
    );
    if (!userResult.rows.length || userResult.rows[0].on_hold) {
      safeFlash("error", "Your account is no longer active.");
      return req.session.destroy(() => res.redirect("/account/login"));
    }

    await ensureTransportationSchema(db);
    const [busResult, profileResult] = await Promise.all([
      db.query(
        `SELECT bus_id, bus_number, status, license_plate, capacity,
                vehicle_make, vehicle_model, vehicle_year, vehicle_color
           FROM transport_buses
          WHERE driver_user_id = $1 AND organization_id = $2
          LIMIT 1`,
        [req.session.userId, organizationId]
      ),
      db.query(
        `SELECT driver_id, phone, license_number, image_url, assigned_route_id
           FROM transport_drivers
          WHERE user_id = $1 AND organization_id = $2
          LIMIT 1`,
        [req.session.userId, organizationId]
      ),
    ]);
    req.driverBus = busResult.rows[0] || null;
    req.driverProfile = profileResult.rows[0] || null;

    next();
  } catch (error) {
    console.error("[DriverAuth] error:", error && error.message ? error.message : error);
    safeFlash("error", "Session validation failed. Please log in again.");
    return res.redirect("/account/login");
  }
}

module.exports = { isDriverAuthenticated };
