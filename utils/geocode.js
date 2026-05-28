/**
 * utils/geocode.js
 *
 * Automatic address → GPS coordinates using OpenStreetMap Nominatim.
 * Free, no API key required.
 *
 * Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * - Must include a descriptive User-Agent
 * - No more than 1 request per second (we fire-and-forget so this is fine)
 */
const https = require("https");

/**
 * Geocode a full address string.
 * Returns { lat: Number, lng: Number } or null if not found / on error.
 * @param {string} address  Street address
 * @param {string} province Province / region / state
 * @param {string} country  Country name or ISO code
 */
function geocodeAddress(address, province, country) {
  return new Promise((resolve) => {
    const parts = [address, province, country].filter(Boolean);
    if (!parts.length) return resolve(null);

    const q = encodeURIComponent(parts.join(", "));
    const path = `/search?q=${q}&format=json&limit=1&addressdetails=0`;

    const options = {
      hostname: "nominatim.openstreetmap.org",
      path,
      method: "GET",
      headers: {
        "User-Agent": "Managira-SMS/1.0 (info@managira.com)",
        "Accept": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const results = JSON.parse(data);
          if (Array.isArray(results) && results.length > 0) {
            const lat = parseFloat(results[0].lat);
            const lng = parseFloat(results[0].lon);
            if (!isNaN(lat) && !isNaN(lng)) {
              return resolve({ lat, lng });
            }
          }
          resolve(null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Fire-and-forget: geocode an org's address and persist the result.
 * Silently ignored on failure — never blocks the HTTP response.
 *
 * @param {object} db              pg Pool / Client
 * @param {number} organizationId
 * @param {string} address
 * @param {string} province
 * @param {string} country
 */
async function autoGeocodeOrg(db, organizationId, address, province, country) {
  try {
    const result = await geocodeAddress(address, province, country);
    if (result) {
      await db.query(
        "UPDATE organizations SET geo_lat = $1, geo_lng = $2 WHERE organization_id = $3",
        [result.lat, result.lng, organizationId]
      );
    }
  } catch (_) {
    /* non-critical — never surface to user */
  }
}

module.exports = { geocodeAddress, autoGeocodeOrg };
