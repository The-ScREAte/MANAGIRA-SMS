// The hub a school belongs to, for its pages' footer (hub logo on the far
// left). Looked up per request from the school's own row, so it is right even
// if the school joined the hub or the hub changed its logo after sign-in.
// Cached for a minute per school.
const TTL_MS = 60 * 1000;
const cache = new Map();

const usableLogo = (path) => {
  const v = String(path || '').trim();
  return v && !/\/(images\/)?hub-logos\/?$/.test(v) ? v : '';
};

async function hubBrandFor(db, organizationId) {
  const id = Number(organizationId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = (await db.query(
    `SELECT mh.hub_name, mh.logo_path, mh.hub_footer_text
       FROM organizations o
       JOIN managira_hubs mh ON mh.hub_id = o.hub_id
      WHERE o.organization_id = $1
        AND COALESCE(o.is_hub_member, false) = true
        AND COALESCE(o.deleted, false) = false
        AND COALESCE(mh.deleted, false) = false
        AND COALESCE(mh.hub_branding_enabled, true) = true
      LIMIT 1`,
    [id]
  )).rows[0];
  const value = row ? { name: row.hub_name, logo: usableLogo(row.logo_path), footerText: row.hub_footer_text || '' } : null;
  if (cache.size > 5000) cache.clear();
  cache.set(id, { value, expires: Date.now() + TTL_MS });
  return value;
}

// Express middleware: res.locals.hubBrand for signed-in school pages.
function hubBrandMiddleware(db) {
  return async (req, res, next) => {
    res.locals.hubBrand = null;
    const s = req.session;
    if (req.method !== 'GET' || !s || !s.organizationId || s.accountType === 'Hub') return next();
    try {
      res.locals.hubBrand = await hubBrandFor(db, s.organizationId);
    } catch (_e) { /* the footer just shows Managira */ }
    next();
  };
}

module.exports = { hubBrandFor, hubBrandMiddleware };
