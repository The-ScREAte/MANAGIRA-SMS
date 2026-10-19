"use strict";

// A school's brand color for every page and every person signed in to it.
// Read from the database at most every 30 seconds per school, and dropped the
// moment the school saves a new color, so a change shows for everyone at once
// (not only for the person who changed it, after they sign in again).
const TTL_MS = 30 * 1000;
const cache = new Map(); // organizationId -> { at, color }

async function getOrgThemeColor(db, organizationId) {
  const key = String(organizationId || "");
  if (!key) return "teal";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.color;
  const { rows } = await db.query("SELECT theme_color FROM organizations WHERE organization_id = $1", [organizationId]);
  const color = (rows[0] && rows[0].theme_color) || "teal";
  cache.set(key, { at: Date.now(), color });
  return color;
}

function forgetOrgThemeColor(organizationId) {
  cache.delete(String(organizationId || ""));
}

module.exports = { getOrgThemeColor, forgetOrgThemeColor };
