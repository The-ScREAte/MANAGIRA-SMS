// Shared helpers for every bus map (manage page, driver, class dashboard,
// parent and student portals): one clean map style, road-following routes
// from the server (never straight lines through buildings), and consistent
// bus / stop / school markers. Needs Leaflet (window.L) when called.
(function () {
  "use strict";

  var routeCache = {};

  function pointKey(points) {
    return points
      .filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); })
      .map(function (p) { return Number(p[0]).toFixed(5) + "," + Number(p[1]).toFixed(5); })
      .join(";");
  }

  // Road route through the points, in order: Promise<{ coordinates: [[lat,lng],...], distanceM, durationS } | null>.
  function roadRoute(points) {
    var key = pointKey(points || []);
    if (key.split(";").length < 2) return Promise.resolve(null);
    if (routeCache[key]) return routeCache[key];
    routeCache[key] = fetch("/transportation/road-route?points=" + encodeURIComponent(key), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.success || !Array.isArray(data.coordinates) || data.coordinates.length < 2) {
          delete routeCache[key]; // try again next time
          return null;
        }
        return { coordinates: data.coordinates, distanceM: data.distanceM, durationS: data.durationS };
      })
      .catch(function () { delete routeCache[key]; return null; });
    return routeCache[key];
  }

  // Coordinates only (or null) - drop-in for older code.
  function roadPoints(points) {
    return roadRoute(points).then(function (route) { return route ? route.coordinates : null; });
  }

  // The basemap: OpenFreeMap "Liberty" (free, no API key, OpenStreetMap
  // data) drawn as a vector map - clear roads and highways, parks, water and
  // street names, the look of Google or Apple Maps. Without WebGL it falls
  // back to OpenStreetMap's own tiles.
  var STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  var ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  var vectorReady = null;
  function loadOnce(tag, attrs) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement(tag);
      Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; });
      el.onload = resolve; el.onerror = reject;
      (tag === "link" ? document.head : document.body).appendChild(el);
    });
  }
  function loadVector() {
    if (vectorReady) return vectorReady;
    var gl = false;
    try { var c = document.createElement("canvas"); gl = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) {}
    if (!gl) return (vectorReady = Promise.reject(new Error("no webgl")));
    loadOnce("link", { rel: "stylesheet", href: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" }).catch(function () {});
    vectorReady = (window.maplibregl ? Promise.resolve() : loadOnce("script", { src: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js" }))
      .then(function () { return window.L.maplibreGL ? null : loadOnce("script", { src: "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js" }); });
    return vectorReady;
  }
  function addTiles(map) {
    var L = window.L;
    if (map.attributionControl) map.attributionControl.setPrefix(false);
    loadVector().then(function () {
      var gl = L.maplibreGL({ style: STYLE_URL, attribution: ATTRIBUTION, interactive: false, padding: 0.6 }).addTo(map);
      var glMap = gl.getMaplibreMap && gl.getMaplibreMap();
      if (glMap) glMap.on("styledata", function () {
        (glMap.getStyle().layers || []).forEach(function (layer) {
          if (/poi|building|housenumber|aeroway/.test(layer.id) && glMap.getLayoutProperty(layer.id, "visibility") !== "none") glMap.setLayoutProperty(layer.id, "visibility", "none");
        });
      });
    }).catch(function () {
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
    });
  }

  // Each route keeps one color on every map.
  var ROUTE_COLORS = ["#0f766e", "#2563eb", "#ea580c", "#9333ea", "#be123c", "#0284c7", "#4d7c0f"];
  function routeColor(routeId) {
    return ROUTE_COLORS[Math.abs(Number(routeId) || 0) % ROUTE_COLORS.length];
  }

  // Route line with a white casing, like navigation apps.
  function drawRoute(layer, coordinates, options) {
    var L = window.L;
    options = options || {};
    var color = options.color || "#1a73e8";
    var casing = L.polyline(coordinates, { color: "#ffffff", weight: (options.weight || 6) + 4, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false });
    var line = L.polyline(coordinates, { color: color, weight: options.weight || 6, opacity: options.opacity || 1, dashArray: options.dashArray || null, lineCap: "round", lineJoin: "round" });
    casing.addTo(layer);
    line.addTo(layer);
    return line;
  }

  var BUS_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18 11H6V6h12v5z"/></svg>';

  // The live vehicle: a top-down school bus that turns with the driver's heading.
  var VEHICLE_SVG = '<svg viewBox="0 0 26 48" width="22" height="40" aria-hidden="true">' +
    '<rect x="2" y="2" width="22" height="44" rx="6" fill="#f5b301" stroke="#fff" stroke-width="2.5"/>' +
    '<path d="M6 7.5h14a1.5 1.5 0 0 1 1.5 1.5v4H4.5V9A1.5 1.5 0 0 1 6 7.5Z" fill="#1e293b"/>' +
    '<rect x="6" y="17" width="14" height="22" rx="2" fill="#fcd34d"/>' +
    '<path d="M6 23h14M6 29h14M6 35h14" stroke="#e0a100" stroke-width="1.2"/>' +
    '<rect x="7" y="41" width="12" height="2.5" rx="1" fill="#1e293b"/></svg>';
  function busIcon(options) {
    var L = window.L;
    options = options || {};
    var heading = isFinite(options.heading) && options.heading !== null ? Number(options.heading) : 0;
    var html = '<div class="mgm-veh' + (options.stale ? " stale" : "") + '">' +
      '<span class="mgm-veh-body" style="transform: rotate(' + heading + 'deg)">' + VEHICLE_SVG + "</span>" +
      (options.label ? '<span class="mgm-bus-label">' + String(options.label).replace(/[<>&"]/g, "") + "</span>" : "") +
      "</div>";
    return L.divIcon({ className: "mgm-icon", html: html, iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -24] });
  }

  // A live position older than this means the driver is offline: hide the vehicle.
  var OFFLINE_MS = 2 * 60 * 1000;
  function isOffline(recordedAt) {
    var t = new Date(recordedAt || 0).getTime();
    return !t || Date.now() - t > OFFLINE_MS;
  }

  function stopIcon(number, options) {
    var L = window.L;
    options = options || {};
    var cls = "mgm-stop" + (options.highlight ? " highlight" : "") + (options.done ? " done" : "");
    return L.divIcon({ className: "mgm-icon", html: '<div class="' + cls + '">' + (number != null ? number : "") + "</div>", iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14] });
  }

  // A bus stop: white disc ringed in the route's color with a bus-stop sign;
  // the student's own stop is filled. Markers sit above route lines.
  var STOP_SVG = BUS_SVG;
  function stopPin(color, options) {
    var L = window.L;
    options = options || {};
    var size = options.highlight ? 32 : 24;
    return L.divIcon({
      className: "mgm-icon",
      html: '<div class="mgm-pin' + (options.highlight ? " mine" : "") + '" style="--c:' + (color || "#1a73e8") + '">' + STOP_SVG + "</div>",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
      tooltipAnchor: [0, -size / 2],
    });
  }

  function schoolIcon() {
    var L = window.L;
    return L.divIcon({
      className: "mgm-icon",
      html: '<div class="mgm-school"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/></svg></div>',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18],
    });
  }

  function ensureStyles() {
    if (document.getElementById("mgm-styles")) return;
    var style = document.createElement("style");
    style.id = "mgm-styles";
    style.textContent =
      ".mgm-icon{background:none;border:0}" +

      ".mgm-bus{position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center}" +
      ".mgm-bus-dot{width:34px;height:34px;border-radius:50%;background:#1a73e8;color:#fff;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);position:relative;z-index:2}" +
      ".mgm-bus.stale .mgm-bus-dot{background:#94a3b8}" +
      ".mgm-bus-heading{position:absolute;inset:-6px;z-index:1;pointer-events:none}" +
      ".mgm-bus-heading::before{content:'';position:absolute;left:50%;top:0;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:10px solid #1a73e8}" +
      ".mgm-bus.stale .mgm-bus-heading::before{border-bottom-color:#94a3b8}" +
      ".mgm-bus::after{content:'';position:absolute;inset:-4px;border-radius:50%;background:rgba(26,115,232,.25);animation:mgm-pulse 2s ease-out infinite;z-index:0}" +
      ".mgm-bus.stale::after{display:none}" +
      ".mgm-bus-label{position:absolute;top:38px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:2px 7px;border-radius:999px;background:#fff;color:#0f172a;font:700 11px/1.4 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25)}" +
      ".mgm-stop{width:26px;height:26px;border-radius:50%;background:#fff;color:#1a73e8;border:3px solid #1a73e8;display:flex;align-items:center;justify-content:center;font:800 11px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25);box-sizing:border-box}" +
      ".mgm-stop.highlight{background:#ea4335;border-color:#fff;color:#fff;transform:scale(1.15)}" +
      ".mgm-stop.done{border-color:#94a3b8;color:#94a3b8}" +
      ".mgm-veh{position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center}" +
      ".mgm-veh::before{content:'';position:absolute;inset:4px;border-radius:50%;background:rgba(245,179,1,.28);animation:mgm-pulse 2s ease-out infinite}" +
      ".mgm-veh-body{position:relative;z-index:1;display:flex;filter:drop-shadow(0 2px 4px rgba(15,23,42,.45));transition:transform .8s ease}" +
      ".mgm-veh .mgm-bus-label{top:46px}" +
      ".mgm-veh.stale{opacity:.55}.mgm-veh.stale::before{display:none}" +
      ".mgm-pin{width:100%;height:100%;box-sizing:border-box;border-radius:50%;background:#fff;color:var(--c);border:3px solid var(--c);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(15,23,42,.3)}" +
      ".mgm-pin svg{width:62%;height:62%}" +
      ".mgm-pin.mine{background:var(--c);color:#fff;border-color:#fff;box-shadow:0 0 0 3px var(--c),0 3px 10px rgba(15,23,42,.35)}" +
      ".mgm-school{width:34px;height:34px;border-radius:10px;background:#0f9d58;color:#fff;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);box-sizing:border-box}" +
      "@keyframes mgm-pulse{0%{transform:scale(.8);opacity:.9}100%{transform:scale(1.6);opacity:0}}" +
      "@media (prefers-reduced-motion:reduce){.mgm-bus::after{animation:none}}";
    document.head.appendChild(style);
  }

  // "3 min ago", "just now" - for how fresh a bus position is.
  function ago(timestamp) {
    var seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
    if (!isFinite(seconds)) return "";
    if (seconds < 45) return "just now";
    if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
    return Math.round(seconds / 3600) + " h ago";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureStyles);
  else ensureStyles();

  window.ManagiraMaps = {
    roadRoute: roadRoute,
    roadPoints: roadPoints,
    addTiles: addTiles,
    routeColor: routeColor,
    drawRoute: drawRoute,
    busIcon: busIcon,
    isOffline: isOffline,
    stopIcon: stopIcon,
    stopPin: stopPin,
    schoolIcon: schoolIcon,
    ago: ago,
  };
})();
