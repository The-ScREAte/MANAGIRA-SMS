"use strict";

// The school website's own mode (light or dark) for visitors who aren't
// signed in. Signed-in people always see their personal light/dark choice.
const MODES = new Set(["light", "dark"]);

let columnReady = null;
function ensureColumn(db) {
  if (!columnReady) {
    columnReady = db
      .query(
        `ALTER TABLE organizations
           ADD COLUMN IF NOT EXISTS public_site_appearance TEXT NOT NULL DEFAULT 'light'`
      )
      .catch((error) => {
        columnReady = null;
        throw error;
      });
  }
  return columnReady;
}

function normalize(mode) {
  return MODES.has(mode) ? mode : "light";
}

async function getPublicSiteAppearance(db, organizationId) {
  if (!organizationId) return "light";
  try {
    await ensureColumn(db);
    const { rows } = await db.query(
      "SELECT public_site_appearance FROM organizations WHERE organization_id = $1",
      [organizationId]
    );
    return normalize(rows[0] && rows[0].public_site_appearance);
  } catch (error) {
    console.error("[PublicSite] Could not read website mode:", error.message);
    return "light";
  }
}

async function setPublicSiteAppearance(db, organizationId, mode) {
  if (!MODES.has(mode)) throw new Error("Choose Light or Dark.");
  await ensureColumn(db);
  await db.query(
    "UPDATE organizations SET public_site_appearance = $1 WHERE organization_id = $2",
    [mode, organizationId]
  );
  return mode;
}

// Which look the public website uses for this request.
// Signed-in viewer: their own choice (dark, otherwise light).
// Everyone else: the school's website mode.
function resolvePublicSiteAppearance({ viewerSignedIn, viewerAppearance, schoolMode }) {
  if (viewerSignedIn) return ({ classic: "gray", dark: "dark" })[viewerAppearance] || "white";
  return schoolMode === "dark" ? "dark" : "white";
}

module.exports = { getPublicSiteAppearance, setPublicSiteAppearance, resolvePublicSiteAppearance };
