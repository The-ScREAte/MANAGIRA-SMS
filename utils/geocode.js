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

// Reverse geocoding (lat/lng -> human-readable address), added for Mira's
// live bus-location reporting - nothing else in the codebase turns a raw
// GPS ping into words. Same Nominatim service/policy as geocodeAddress
// above, plus a short in-memory cache: unlike geocodeAddress (fire-and-forget,
// called once per address edit), this can be asked "where's the bus"
// repeatedly while a trip is active, so caching by a rounded coordinate
// keeps repeat lookups within Nominatim's ~1 req/sec policy instead of
// hammering it every time the same bus is asked about again.
const REVERSE_GEOCODE_CACHE_TTL_MS = 60 * 1000;
const REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 500;
const reverseGeocodeCache = new Map(); // key -> { value, expiresAt }

function reverseGeocodeCacheKey(lat, lng) {
  // ~11m precision (4 decimal places) - enough to treat two pings a few
  // seconds apart at the same red light as "the same place" for caching.
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

/**
 * Reverse geocode a coordinate into a human-readable address/description.
 * Returns { address: String, city, road, raw } or null if not found/on error.
 */
function reverseGeocode(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Promise.resolve(null);

  const cacheKey = reverseGeocodeCacheKey(latitude, longitude);
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }

  return new Promise((resolve) => {
    const path = `/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&format=json&zoom=16&addressdetails=1`;

    const options = {
      hostname: "nominatim.openstreetmap.org",
      path,
      method: "GET",
      headers: {
        "User-Agent": "Managira-SMS/1.0 (info@managira.com)",
        "Accept": "application/json",
      },
    };

    const finish = (value) => {
      if (reverseGeocodeCache.size >= REVERSE_GEOCODE_CACHE_MAX_ENTRIES) reverseGeocodeCache.clear();
      reverseGeocodeCache.set(cacheKey, { value, expiresAt: Date.now() + REVERSE_GEOCODE_CACHE_TTL_MS });
      resolve(value);
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result && !result.error && (result.display_name || result.address)) {
            const addr = result.address || {};
            return finish({
              address: result.display_name || null,
              road: addr.road || addr.pedestrian || addr.footway || null,
              city: addr.city || addr.town || addr.village || addr.suburb || null,
              raw: addr,
            });
          }
          finish(null);
        } catch {
          finish(null);
        }
      });
    });

    req.on("error", () => finish(null));
    req.setTimeout(8000, () => { req.destroy(); finish(null); });
    req.end();
  });
}

module.exports = { geocodeAddress, autoGeocodeOrg, reverseGeocode };
