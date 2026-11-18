// Who can open Mira from the header (views/partials/header.ejs, public/js/miraPanel.js).
// The same rule Mira's own server applies (internalApiController.getMiraActivationStatusApi):
// the school has Mira on, and this person holds their own "Use Mira" row; the owner too, since
// every seat is given one by one. canManage: they may give it (Mira Settings, /account/mira).
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

async function activatedFor(organizationId) {
  const status = await statuses.get(organizationId, "status", () => getMiraIntegrationStatus(db, organizationId));
  return Boolean(status && status.activated);
}

async function accessFor(req) {
  const session = req.session;
  const none = { activated: false, canUse: false, canManage: false };
  if (!isStaffSession(session)) return none;
  const organizationId = session.organizationId;
  const activated = await activatedFor(organizationId);
  if (!activated) return none;
  const { PERMISSIONS, getUserPermissions, userHasPermission, sessionActor } = require("../middleware/permissionMiddleware");
  const userId = session.userId || (session.user && session.user.user_id) || null;
  const [held, canManage] = await Promise.all([
    userId ? getUserPermissions(db, userId, organizationId) : [],
    userHasPermission(db, sessionActor(req), PERMISSIONS.SETTINGS_MIRA).catch(() => false),
  ]);
  return { activated, canUse: held.includes(PERMISSIONS.USE_MIRA), canManage: Boolean(canManage) };
}

module.exports = { accessFor, activatedFor, isStaffSession };
