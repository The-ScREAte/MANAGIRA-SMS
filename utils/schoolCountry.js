// A school's country code ("US", "GH"), cached for a few minutes. Phone fields
// default to it, and numbers saved without a country code are dialled with it.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

async function getSchoolCountry(db, organizationId) {
  const id = Number(organizationId);
  if (!id) return "";
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.country;
  const { rows } = await db.query("SELECT organization_country FROM organizations WHERE organization_id = $1", [id]);
  const country = String(rows[0]?.organization_country || "").trim().toUpperCase();
  cache.set(id, { country: /^[A-Z]{2}$/.test(country) ? country : "", at: Date.now() });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return cache.get(id).country;
}

// When a school changes its country in Settings.
function forgetSchoolCountry(organizationId) {
  cache.delete(Number(organizationId));
}

module.exports = { getSchoolCountry, forgetSchoolCountry };
