// Live bus tracker (DoorDash-style) shared by the class dashboard, parent
// portal and student portal. One big clean map, the bus glides between GPS
// updates, and a status card shows "Arriving in X min" for the student's stop.
// Usage: BusTracker.mount(element, snapshot, { studentId }) -> { destroy() }
(function () {
  "use strict";

  var LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  var LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  var POLL_MS = 5000;
  var STALE_MS = 2 * 60 * 1000;
  var leafletPromise = null;

  function loadLeaflet() {
    if (!document.querySelector('link[href="' + LEAFLET_CSS + '"]')) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = LEAFLET_JS;
      s.onload = function () { resolve(window.L); };
      s.onerror = function () { leafletPromise = null; reject(new Error("Leaflet failed")); };
      document.body.appendChild(s);
    });
    return leafletPromise;
  }

  function num(v, axis) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (axis === "lat" && (n < -90 || n > 90)) return null;
    if (axis === "lng" && (n < -180 || n > 180)) return null;
    return n;
  }
  function ll(obj, latKey, lngKey) {
    if (!obj) return null;
    var a = num(obj[latKey || "latitude"], "lat");
    var b = num(obj[lngKey || "longitude"], "lng");
    return a === null || b === null ? null : [a, b];
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function liveOf(live) {
    if (!live) return null;
    var pos = ll(live);
    if (!pos) return null;
    var at = live.recordedAt || live.recorded_at || null;
    return {
      pos: pos,
      at: at,
      heading: live.headingDeg != null ? live.headingDeg : live.heading_deg,
      bus: live.busNumber || live.bus_number || "",
      stale: !at || Date.now() - new Date(at).getTime() > STALE_MS,
    };
  }
  function clock(v) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
    if (!m) return v || "";
    var h = Number(m[1]);
    return ((h % 12) || 12) + ":" + m[2] + (h < 12 ? " AM" : " PM");
  }

  function ensureStyles() {
    if (document.getElementById("bt-styles")) return;
    var st = document.createElement("style");
    st.id = "bt-styles";
    st.textContent = [
      ".bt{position:relative;width:100%;height:min(58vh,460px);min-height:300px;border-radius:14px;overflow:hidden;background:#eef2f5;border:1px solid #e2e8f0;isolation:isolate}",
      ".bt.bt--full{position:fixed;inset:0;height:100%;min-height:0;border-radius:0;border:0;z-index:2147483000}",
      ".bt-map{position:absolute;inset:0}",
      ".bt-tools{position:absolute;top:10px;right:10px;z-index:500;display:flex;flex-direction:column;gap:6px}",
      ".bt-tool{width:38px;height:38px;border-radius:10px;border:0;background:#fff;color:#0f172a;box-shadow:0 1px 4px rgba(0,0,0,.2);display:grid;place-items:center;cursor:pointer;padding:0;margin:0}",
      ".bt-tool:hover{background:#f1f5f9}.bt-tool svg{width:18px;height:18px}",
      ".bt-card{position:absolute;left:10px;right:10px;bottom:10px;z-index:500;background:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.18);padding:12px 14px;display:grid;gap:8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:520px;margin:0 auto}",
      ".bt-row{display:flex;align-items:center;gap:10px;min-width:0}",
      ".bt-dot{flex:none;width:10px;height:10px;border-radius:50%;background:#94a3b8}",
      ".bt-dot.on{background:#16a34a;box-shadow:0 0 0 0 rgba(22,163,74,.5);animation:bt-ping 1.6s infinite}",
      ".bt-title{font-size:16px;font-weight:700;line-height:1.25;flex:1;min-width:0}",
      ".bt-eta{flex:none;font-size:13px;font-weight:700;color:#01535b;background:#e6f2f3;border-radius:999px;padding:4px 10px}",
      ".bt-sub{font-size:12px;color:#475569;line-height:1.4}",
      ".bt-bar{height:4px;border-radius:4px;background:#e2e8f0;overflow:hidden}",
      ".bt-bar>i{display:block;height:100%;width:0;background:#01535b;transition:width .8s ease}",
      ".bt-chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".bt-chip{font-size:12px;font-weight:600;color:#334155;background:#f1f5f9;border-radius:999px;padding:4px 10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".bt .leaflet-control-zoom{display:none}",
      ".bt-pin{width:30px;height:30px;border-radius:50%;background:#ea4335;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:grid;place-items:center;color:#fff;box-sizing:border-box}",
      ".bt-home{width:26px;height:26px;border-radius:8px;background:#0f172a;border:2px solid #fff;color:#fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3);box-sizing:border-box}",
      ".bt-mini{width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #64748b;box-sizing:border-box}",
      "@keyframes bt-ping{0%{box-shadow:0 0 0 0 rgba(22,163,74,.5)}100%{box-shadow:0 0 0 8px rgba(22,163,74,0)}}",
      "@media (max-width:480px){.bt{height:62vh;min-height:280px}.bt-title{font-size:15px}.bt-card{left:8px;right:8px;bottom:8px;padding:10px 12px}}",
      "@media (prefers-reduced-motion:reduce){.bt-dot.on{animation:none}}",
    ].join("");
    document.head.appendChild(st);
  }

  var ICON_FULL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  var ICON_EXIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  var ICON_BUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  var ICON_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>';

  function mount(host, snapshot, options) {
    options = options || {};
    ensureStyles();
    var state = { destroyed: false, timer: null, anim: null, marker: null, leg: null, follow: true, lastPos: null, fitPoints: [] };

    host.innerHTML = "";
    var root = document.createElement("div");
    root.className = "bt";
    root.innerHTML =
      '<div class="bt-map"></div>' +
      '<div class="bt-tools">' +
      '<button type="button" class="bt-tool" data-bt="full" aria-label="Full screen">' + ICON_FULL + "</button>" +
      '<button type="button" class="bt-tool" data-bt="bus" aria-label="Follow bus">' + ICON_BUS + "</button>" +
      '<button type="button" class="bt-tool" data-bt="all" aria-label="Show whole route">' + ICON_ALL + "</button>" +
      '<button type="button" class="bt-tool" data-bt="in" aria-label="Zoom in">' + ICON_PLUS + "</button>" +
      '<button type="button" class="bt-tool" data-bt="out" aria-label="Zoom out">' + ICON_MINUS + "</button>" +
      "</div>" +
      '<div class="bt-card" aria-live="polite">' +
      '<div class="bt-row"><span class="bt-dot"></span><span class="bt-title">Loading…</span><span class="bt-eta" hidden></span></div>' +
      '<div class="bt-bar" hidden><i></i></div>' +
      '<div class="bt-sub"></div>' +
      '<div class="bt-chips"></div>' +
      "</div>";
    host.appendChild(root);

    var q = function (sel) { return root.querySelector(sel); };
    var mapEl = q(".bt-map");
    var titleEl = q(".bt-title");
    var etaEl = q(".bt-eta");
    var subEl = q(".bt-sub");
    var dotEl = q(".bt-dot");
    var barEl = q(".bt-bar");
    var chipsEl = q(".bt-chips");

    var stopPos = ll(snapshot && snapshot.stop);
    var schoolPos = ll(snapshot && snapshot.school);
    var homePos = num(snapshot && snapshot.homeLatitude, "lat") !== null && num(snapshot && snapshot.homeLongitude, "lng") !== null
      ? [Number(snapshot.homeLatitude), Number(snapshot.homeLongitude)] : null;
    var stopName = (snapshot && snapshot.stop && snapshot.stop.stopName) || "your stop";

    chipsEl.innerHTML = [
      snapshot && snapshot.bus && snapshot.bus.busNumber ? "Bus " + snapshot.bus.busNumber : "",
      snapshot && snapshot.driverName ? "Driver " + snapshot.driverName : "",
      snapshot && snapshot.pickupTime ? "Pick-up " + clock(snapshot.pickupTime) : "",
      snapshot && snapshot.dropoffTime ? "Drop-off " + clock(snapshot.dropoffTime) : "",
    ].filter(Boolean).map(function (t) { return '<span class="bt-chip">' + esc(t) + "</span>"; }).join("");

    function setStatus(live, etaS) {
      if (!live) {
        dotEl.className = "bt-dot";
        titleEl.textContent = "Bus not on the road";
        etaEl.hidden = true;
        barEl.hidden = true;
        subEl.textContent = "The map updates by itself when the driver starts the trip.";
        return;
      }
      if (live.stale) {
        dotEl.className = "bt-dot";
        titleEl.textContent = "Waiting for bus signal";
        etaEl.hidden = true;
        barEl.hidden = true;
        subEl.textContent = "Last seen " + (window.ManagiraMaps ? window.ManagiraMaps.ago(live.at) : "") + ".";
        return;
      }
      dotEl.className = "bt-dot on";
      var mins = etaS != null ? Math.max(0, Math.round(etaS / 60)) : null;
      if (mins !== null && mins <= 1) {
        titleEl.textContent = "Bus is arriving";
      } else {
        titleEl.textContent = "Bus is on the way";
      }
      if (mins !== null) {
        etaEl.hidden = false;
        etaEl.textContent = mins <= 1 ? "Now" : mins + " min";
        barEl.hidden = false;
        barEl.firstChild.style.width = Math.max(6, Math.min(100, 100 - mins * 3)) + "%";
      } else {
        etaEl.hidden = true;
        barEl.hidden = true;
      }
      subEl.textContent = "To " + stopName + " · updated " + (window.ManagiraMaps ? window.ManagiraMaps.ago(live.at || Date.now()) : "");
    }

    loadLeaflet().then(function (L) {
      if (state.destroyed) return;
      var MM = window.ManagiraMaps;
      var map = L.map(mapEl, { zoomControl: false, scrollWheelZoom: true, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, tap: true });
      state.map = map;
      if (MM) MM.addTiles(map); else L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      var layer = L.layerGroup().addTo(map);

      var stops = snapshot && snapshot.route && Array.isArray(snapshot.route.stops) ? snapshot.route.stops : [];
      var stopPts = stops.map(function (s) { return ll(s); }).filter(Boolean);
      var routePts = [];
      if (schoolPos) routePts.push(schoolPos);
      routePts = routePts.concat(stopPts);
      if (schoolPos && stopPts.length) routePts.push(schoolPos);

      stopPts.forEach(function (p) {
        if (stopPos && Math.abs(p[0] - stopPos[0]) < 1e-6 && Math.abs(p[1] - stopPos[1]) < 1e-6) return;
        L.marker(p, { icon: L.divIcon({ className: "mgm-icon", html: '<div class="bt-mini"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }), interactive: false }).addTo(layer);
      });
      if (schoolPos && MM) L.marker(schoolPos, { icon: MM.schoolIcon() }).bindPopup("School").addTo(layer);
      if (homePos) L.marker(homePos, { icon: L.divIcon({ className: "mgm-icon", html: '<div class="bt-home"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg></div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).bindPopup("Home").addTo(layer);
      if (stopPos) L.marker(stopPos, { zIndexOffset: 500, icon: L.divIcon({ className: "mgm-icon", html: '<div class="bt-pin"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg></div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(esc(stopName)).addTo(layer);

      state.fitPoints = routePts.concat(stopPos ? [stopPos] : [], homePos ? [homePos] : []);
      function fitAll() {
        var pts = state.fitPoints.concat(state.lastPos ? [state.lastPos] : []);
        if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.15), { paddingBottomRight: [0, 120] });
        else if (pts.length) map.setView(pts[0], 15);
        else map.setView([40.7673, -111.9398], 11);
      }
      fitAll();
      setTimeout(function () { map.invalidateSize(); fitAll(); }, 120);

      if (routePts.length >= 2 && MM) {
        MM.roadPoints(routePts).then(function (road) {
          if (state.destroyed) return;
          MM.drawRoute(layer, road && road.length > 1 ? road : routePts, { color: "#94a3b8", weight: 5 });
        });
      }

      function animateTo(target) {
        if (!state.marker) return;
        var from = state.marker.getLatLng();
        var start = performance.now();
        var dur = POLL_MS * 0.9;
        if (state.anim) cancelAnimationFrame(state.anim);
        function step(now) {
          var t = Math.min(1, (now - start) / dur);
          var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          state.marker.setLatLng([from.lat + (target[0] - from.lat) * e, from.lng + (target[1] - from.lng) * e]);
          if (t < 1 && !state.destroyed) state.anim = requestAnimationFrame(step);
        }
        state.anim = requestAnimationFrame(step);
      }

      var legKey = "";
      function applyLive(live) {
        if (state.destroyed) return;
        if (!live) {
          if (state.marker) { layer.removeLayer(state.marker); state.marker = null; }
          if (state.leg) { layer.removeLayer(state.leg); state.leg = null; }
          state.lastPos = null;
          setStatus(null);
          return;
        }
        var icon = MM.busIcon({ heading: live.heading, label: live.bus || (snapshot && snapshot.bus && snapshot.bus.busNumber) || "Bus", stale: live.stale });
        if (!state.marker) {
          state.marker = L.marker(live.pos, { icon: icon, zIndexOffset: 1000 }).addTo(layer);
          if (state.follow) map.setView(live.pos, Math.max(map.getZoom(), 14), { animate: true });
        } else {
          state.marker.setIcon(icon);
          animateTo(live.pos);
          if (state.follow) map.panTo(live.pos, { animate: true, duration: POLL_MS / 1000 * 0.9 });
        }
        state.lastPos = live.pos;
        if (!stopPos || live.stale) { setStatus(live, null); return; }
        var key = live.pos[0].toFixed(4) + "," + live.pos[1].toFixed(4);
        if (key === legKey) return;
        legKey = key;
        MM.roadRoute([live.pos, stopPos]).then(function (r) {
          if (state.destroyed) return;
          var coords = r && r.coordinates && r.coordinates.length > 1 ? r.coordinates : [live.pos, stopPos];
          if (state.leg) state.leg.setLatLngs(coords);
          else state.leg = L.polyline(coords, { color: "#01535b", weight: 6, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(layer);
          setStatus(live, r && isFinite(r.durationS) ? r.durationS : null);
        });
      }

      applyLive(liveOf(snapshot && snapshot.live));

      function poll() {
        if (state.destroyed || !options.studentId) return;
        if (document.hidden) { state.timer = setTimeout(poll, POLL_MS); return; }
        fetch("/transportation/live/student/" + encodeURIComponent(options.studentId), {
          credentials: "same-origin",
          headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
          if (p && p.success) applyLive(liveOf(p.data && p.data.live));
        }).catch(function () {}).then(function () {
          if (!state.destroyed) state.timer = setTimeout(poll, POLL_MS);
        });
      }
      state.timer = setTimeout(poll, 1500);

      map.on("dragstart", function () { state.follow = false; });
      root.querySelector(".bt-tools").addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-bt]");
        if (!btn) return;
        var act = btn.getAttribute("data-bt");
        if (act === "in") map.zoomIn();
        else if (act === "out") map.zoomOut();
        else if (act === "all") { state.follow = false; fitAll(); }
        else if (act === "bus") { state.follow = true; if (state.lastPos) map.setView(state.lastPos, Math.max(map.getZoom(), 15)); else fitAll(); }
        else if (act === "full") {
          var on = !root.classList.contains("bt--full");
          root.classList.toggle("bt--full", on);
          btn.innerHTML = on ? ICON_EXIT : ICON_FULL;
          btn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
          setTimeout(function () { map.invalidateSize(); }, 60);
        }
      });
      state.onKey = function (e) {
        if (e.key === "Escape" && root.classList.contains("bt--full")) {
          root.classList.remove("bt--full");
          q('[data-bt="full"]').innerHTML = ICON_FULL;
          setTimeout(function () { map.invalidateSize(); }, 60);
        }
      };
      document.addEventListener("keydown", state.onKey);
    }).catch(function () {
      titleEl.textContent = "Map could not load right now";
      subEl.textContent = "Check your connection and open it again.";
    });

    return {
      destroy: function () {
        state.destroyed = true;
        if (state.timer) clearTimeout(state.timer);
        if (state.anim) cancelAnimationFrame(state.anim);
        if (state.onKey) document.removeEventListener("keydown", state.onKey);
        if (state.map) { try { state.map.remove(); } catch (_) {} }
        host.innerHTML = "";
      },
      resize: function () { if (state.map) state.map.invalidateSize(); },
    };
  }

  window.BusTracker = { mount: mount };
})();
