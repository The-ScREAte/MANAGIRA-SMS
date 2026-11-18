// Who can open Mira from the header (views/partials/header.ejs, public/js/miraPanel.js). Every
// member of staff sees the button; what it opens follows the same rule Mira's own server applies
// (internalApiController.getMiraActivationStatusApi): the school has Mira on, and this person
// holds their own "Use Mira" row; the owner too, since every seat is given one by one.
// canManage: they may give it (Mira Settings: Management › Mira, /account/mira).
// canTurnOn: they may turn it on where that's done: Mira Settings and Management › Integrations
// (the Integrations permission opens that page); Turn on Mira shows only to them.
// Mira still checks on every request; this only decides what the button does.
const db = require("../config/db");
const { getMiraIntegrationStatus } = require("./miraIntegration");
const { createShortCache } = require("./shortCache");
const statuses = createShortCache({ ttlMs: 30000 });

const isStaffSession = (session) => {
  if (!session || !session.organizationId) return false;
  const role = String(session.userRole || session.accountType || "").trim().toLowerCase();
  return !(session.guardianId || session.studentId || ["guardian", "parent", "student"].includes(role));
};

// The school's name, for "Mira isn't turned on for <school>".
async function schoolNameFor(organizationId) {
  return statuses.get(organizationId, "name", async () => {
    // The nickname when the school chose one; its full name when the nickname is still the web address.
    const { rows } = await db.query(
      `SELECT CASE WHEN NULLIF(TRIM(nickname_display), '') IS NULL OR nickname_display = nickname
                   THEN organization_name ELSE nickname_display END AS name
         FROM organizations WHERE organization_id = $1`,
      [organizationId]
    );
    return (rows[0] && rows[0].name) || "";
  });
}

async function activatedFor(organizationId) {
  const status = await statuses.get(organizationId, "status", () => getMiraIntegrationStatus(db, organizationId));
  return Boolean(status && status.activated);
}

async function accessFor(req) {
  const session = req.session;
  const none = { activated: false, canUse: false, canManage: false, canTurnOn: false };
  if (!isStaffSession(session)) return none;
  const organizationId = session.organizationId;
  const { PERMISSIONS, getUserPermissions, userHasPermission, sessionActor } = require("../middleware/permissionMiddleware");
  const userId = session.userId || (session.user && session.user.user_id) || null;
  const actor = sessionActor(req);
  const [activated, held, canManage, canIntegrations] = await Promise.all([
    activatedFor(organizationId),
    userId ? getUserPermissions(db, userId, organizationId) : [],
    userHasPermission(db, actor, PERMISSIONS.SETTINGS_MIRA).catch(() => false),
    userHasPermission(db, actor, PERMISSIONS.SETTINGS_INTEGRATIONS).catch(() => false),
  ]);
  return {
    activated,
    canUse: activated && held.includes(PERMISSIONS.USE_MIRA),
    canManage: Boolean(canManage),
    canTurnOn: Boolean(canManage && canIntegrations),
  };
}

module.exports = { accessFor, activatedFor, schoolNameFor, isStaffSession };
