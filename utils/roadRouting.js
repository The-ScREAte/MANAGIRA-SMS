// Road-following routes for the bus maps. Browsers ask the server
// (GET /transportation/road-route) instead of calling a routing service
// directly, so results are cached, shared and never fall back to straight
// lines through buildings. Uses OSRM (OpenStreetMap roads); set OSRM_URL to
// use your own OSRM server.
const PROVIDERS = [
  process.env.OSRM_URL,
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
].filter(Boolean);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const CACHE_MAX = 800;
const MAX_POINTS = 40;
const cache = new Map();
const inflight = new Map();

function parsePoints(raw) {
  const points = String(raw || "")
    .split(";")
    .map((pair) => pair.split(",").map(Number))
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
    .map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
  // Drop consecutive duplicates (same stop twice, or a bus parked on a stop).
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]).slice(0, MAX_POINTS);
}

function remember(key, value, ttl) {
  cache.delete(key);
  cache.set(key, { value, expires: Date.now() + ttl });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function fetchFrom(base, points) {
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${base.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Managira school transport (managira.com)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const route = data && data.code === "Ok" && Array.isArray(data.routes) ? data.routes[0] : null;
    const line = route && route.geometry && Array.isArray(route.geometry.coordinates) ? route.geometry.coordinates : null;
    if (!line || line.length < 2) throw new Error(data && data.code ? `routing ${data.code}` : "no route");
    return {
      coordinates: line.map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]),
      distanceM: Math.round(route.distance || 0),
      durationS: Math.round(route.duration || 0),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Returns { coordinates: [[lat,lng],...], distanceM, durationS } or null.
async function roadRoute(rawPoints) {
  const points = Array.isArray(rawPoints) ? parsePoints(rawPoints.map((p) => p.join(",")).join(";")) : parsePoints(rawPoints);
  if (points.length < 2) return null;
  const key = points.map((p) => p.join(",")).join(";");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    for (const base of PROVIDERS) {
      try {
        const result = await fetchFrom(base, points);
        remember(key, result, CACHE_TTL_MS);
        return result;
      } catch (_) {
        // try the next provider
      }
    }
    remember(key, null, FAIL_TTL_MS);
    return null;
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

module.exports = { roadRoute, parsePoints, MAX_POINTS };
