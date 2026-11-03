// Live bus tracker for teachers, parents and students: one large map that
// follows the bus like a delivery tracker. BusTracker.open(studentId, name)
// shows it; it reads /transportation/live/student/:id every 5 seconds and
// glides the bus to each new position. Uses Leaflet + public/js/managiraMaps.js.
(function () {
  "use strict";
  var POLL_MS = 5000;
  var STALE_MS = 2 * 60 * 1000;
  var state = null;
  // This file's own ?v= stamp, passed on so its style sheet and map helper are never stale.
  var VERSION = (function () { var m = String((document.currentScript || {}).src || "").match(/[?&]v=([^&]+)/); return m ? m[1] : ""; })();
  var V = VERSION ? "?v=" + encodeURIComponent(VERSION) : "";

  function loadLeaflet() {
    if (!document.getElementById("bt-css")) {
      var css = document.createElement("link");
      css.id = "bt-css"; css.rel = "stylesheet"; css.href = "/css/busTracker.css" + V;
      document.head.appendChild(css);
    }
    if (!document.getElementById("bt-leaflet-css")) {
      var link = document.createElement("link");
      link.id = "bt-leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (window.L) return Promise.resolve(window.L);
    if (!window.__btLeaflet) {
      window.__btLeaflet = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        s.onload = function () { resolve(window.L); };
        s.onerror = reject;
        document.body.appendChild(s);
      });
    }
    return window.__btLeaflet;
  }
  function loadMaps() {
    if (window.ManagiraMaps) return Promise.resolve();
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "/js/managiraMaps.js" + V; s.onload = resolve; s.onerror = resolve;
      document.body.appendChild(s);
    });
  }

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function point(lat, lng) {
    var a = Number(lat), b = Number(lng);
    return isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a || b) ? [a, b] : null;
  }
  function time12(t) {
    if (!t) return "";
    var m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return String(t);
    var h = Number(m[1]);
    return ((h % 12) || 12) + ":" + m[2] + (h < 12 ? " AM" : " PM");
  }

  var ICONS = {
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>',
    follow: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    route: '<path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>"; }

  function build() {
    var el = document.createElement("div");
    el.className = "bt-overlay";
    el.hidden = true;
    el.innerHTML =
      '<div class="bt-sheet" role="dialog" aria-modal="true" aria-labelledby="btTitle">' +
        '<div class="bt-head"><div class="bt-head-text"><h3 id="btTitle"></h3><div class="bt-tags" id="btTags"></div></div>' +
        '<button type="button" class="bt-close" data-bt="close" aria-label="Close">&times;</button></div>' +
        '<div class="bt-map-wrap"><div class="bt-map" id="btMap"></div>' +
          '<div class="bt-status" id="btStatus"><span class="bt-dot"></span><div><strong></strong><small></small></div></div>' +
          '<div class="bt-tools">' +
            '<button type="button" data-bt="size" title="Bigger" aria-label="Make the map bigger">' + icon("expand") + "</button>" +
            '<button type="button" data-bt="follow" title="Follow the bus" aria-label="Follow the bus" aria-pressed="true">' + icon("follow") + "</button>" +
            '<button type="button" data-bt="route" title="Whole route" aria-label="Show the whole route">' + icon("route") + "</button>" +
            '<div class="bt-zoom"><button type="button" data-bt="in" title="Zoom in" aria-label="Zoom in">' + icon("plus") + '</button><button type="button" data-bt="out" title="Zoom out" aria-label="Zoom out">' + icon("minus") + "</button></div>" +
          "</div></div>" +
        '<div class="bt-places" id="btPlaces"></div>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var b = e.target.closest("[data-bt]");
      if (!b || !state) return;
      var act = b.dataset.bt, map = state.map;
      if (act === "close") close();
      else if (act === "in") map.zoomIn();
      else if (act === "out") map.zoomOut();
      else if (act === "route") { setFollow(false); fitAll(); }
      else if (act === "follow") { setFollow(!state.follow); if (state.follow && state.busAt) map.setView(state.busAt, Math.max(map.getZoom(), 15)); }
      else if (act === "size") setSize(!el.classList.contains("bt-big"));
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state && !el.hidden) close(); });
    return el;
  }

  // Compact by default; the size button makes it large (full screen on phones).
  function setSize(big) {
    var el = state.root, b = el.querySelector('[data-bt="size"]');
    el.classList.toggle("bt-big", big);
    b.innerHTML = icon(big ? "shrink" : "expand");
    b.title = big ? "Smaller" : "Bigger";
    b.setAttribute("aria-label", big ? "Make the map smaller" : "Make the map bigger");
    var center = state.busAt;
    setTimeout(function () {
      if (!state || !state.map) return;
      state.map.invalidateSize();
      if (state.follow && center) state.map.panTo(center); else fitAll();
    }, 240);
  }

  function setFollow(on) {
    state.follow = on;
    var b = state.root.querySelector('[data-bt="follow"]');
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function fitAll() {
    var pts = state.fixedPoints.slice();
    if (state.busAt) pts.push(state.busAt);
    if (pts.length > 1) state.map.fitBounds(pts, { padding: [48, 48], maxZoom: 16 });
    else if (pts.length) state.map.setView(pts[0], 15);
  }

  function status(kind, title, detail) {
    var box = state.root.querySelector("#btStatus");
    box.className = "bt-status is-" + kind;
    box.querySelector("strong").textContent = title;
    box.querySelector("small").textContent = detail || "";
  }

  // Draw what doesn't move: the route (soft gray, on the roads), stops, the student's stop, home, school.
  function drawFixed(snap) {
    var L = window.L, M = window.ManagiraMaps, layer = state.fixed;
    layer.clearLayers();
    state.fixedPoints = [];
    var stops = (snap.route && snap.route.stops || []).slice().sort(function (a, b) { return a.stopOrder - b.stopOrder; });
    var myStopId = snap.stop && snap.stop.stopId;
    var color = state.color = M.routeColor(snap.route && snap.route.routeId);
    var routePts = [];
    stops.forEach(function (s) {
      var p = point(s.latitude, s.longitude);
      if (!p) return;
      routePts.push(p);
      if (s.stopId !== myStopId) L.marker(p, { icon: M.stopPin(color), zIndexOffset: 200 }).addTo(layer).bindTooltip(esc(s.stopName), { direction: "top" });
    });
    var school = point(snap.school && snap.school.latitude, snap.school && snap.school.longitude);
    if (school) { routePts.push(school); L.marker(school, { icon: M.schoolIcon() }).addTo(layer).bindTooltip("School"); state.fixedPoints.push(school); }
    state.root.querySelector(".bt-sheet").style.setProperty("--bt-route", color);
    if (routePts.length > 1) {
      M.roadPoints(routePts).then(function (road) {
        if (!state || state.snapRoute !== snap) return;
        M.drawRoute(state.routeLayer, road && road.length > 1 ? road : routePts, { color: color, weight: 5, opacity: 0.5 });
      });
    }
    state.snapRoute = snap;
    var stop = snap.stop && point(snap.stop.latitude, snap.stop.longitude);
    state.stopAt = stop;
    if (stop) {
      L.marker(stop, { icon: M.stopPin(state.color, { highlight: true }), zIndexOffset: 500 }).addTo(layer).bindTooltip(esc((snap.stop.stopName || "Stop")) + " · their stop", { direction: "top" });
      state.fixedPoints.push(stop);
    }
    var home = point(snap.homeLatitude, snap.homeLongitude);
    if (home) { L.marker(home, { icon: L.divIcon({ className: "bt-home-icon", html: '<div class="bt-home">⌂</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(layer).bindTooltip("Home"); state.fixedPoints.push(home); }
  }

  function renderInfo(snap) {
    var tags = [];
    if (snap.bus && snap.bus.busNumber) tags.push("Bus " + snap.bus.busNumber);
    if (snap.driverName) tags.push(snap.driverName);
    if (snap.pickupTime) tags.push("Pick-up " + time12(snap.pickupTime));
    if (snap.dropoffTime) tags.push("Drop-off " + time12(snap.dropoffTime));
    state.root.querySelector("#btTags").innerHTML = tags.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("");
    var places = [
      ["Route", snap.route && (snap.route.routeName || snap.route.routeCode)],
      ["Stop", snap.stop && (snap.stop.stopName || snap.stop.stopAddress)],
      ["Home", snap.homeAddress],
    ].filter(function (p) { return p[1]; });
    state.root.querySelector("#btPlaces").innerHTML = places.map(function (p) { return '<div><small>' + p[0] + "</small><strong>" + esc(p[1]) + "</strong></div>"; }).join("");
  }

  // Glide the bus from where it is to where it now is.
  function moveBus(to, live) {
    var L = window.L, M = window.ManagiraMaps;
    var stale = live.recordedAt && Date.now() - new Date(live.recordedAt).getTime() > STALE_MS;
    var busIcon = M.busIcon({ heading: live.headingDeg, label: live.busNumber || "Bus", stale: stale });
    if (!state.bus) {
      state.bus = L.marker(to, { icon: busIcon, zIndexOffset: 1000 }).addTo(state.map);
      state.busAt = to;
      // First sight: frame the bus and the student's stop together.
      if (state.stopAt) state.map.fitBounds([to, state.stopAt], { padding: [70, 70], maxZoom: 16 });
      else state.map.setView(to, 15);
      return;
    }
    state.bus.setIcon(busIcon);
    var from = state.busAt, start = performance.now(), dur = 1200;
    cancelAnimationFrame(state.anim);
    (function step(now) {
      var k = Math.min(1, (now - start) / dur), e = k * (2 - k);
      var p = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
      state.bus.setLatLng(p);
      if (k < 1) state.anim = requestAnimationFrame(step);
    })(start);
    state.busAt = to;
    if (state.follow) state.map.panTo(to, { animate: true, duration: 1 });
  }

  // The road from the bus to the student's stop, and how long it will take.
  function updateLeg(busAt, live) {
    var M = window.ManagiraMaps, L = window.L;
    if (!state.stopAt) { status("live", "Bus is on the road", "Updated " + M.ago(live.recordedAt)); return; }
    var now = Date.now();
    if (state.legAt && now - state.legAt < 4000) return;
    state.legAt = now;
    M.roadRoute([busAt, state.stopAt]).then(function (r) {
      if (!state) return;
      var pts = r && r.coordinates && r.coordinates.length > 1 ? r.coordinates : [busAt, state.stopAt];
      state.legLayer.clearLayers();
      state.leg = M.drawRoute(state.legLayer, pts, { color: state.color || "#1a73e8", weight: 7 });
      var meters = r && r.distanceM != null ? r.distanceM : state.map.distance(busAt, state.stopAt);
      var mins = r && r.durationS != null ? Math.max(1, Math.round(r.durationS / 60)) : null;
      if (meters < 150) status("arriving", "Arriving at the stop", "Updated " + M.ago(live.recordedAt));
      else status("live", "Bus is on the way", (mins ? "About " + mins + " min to the stop · " : "") + "updated " + M.ago(live.recordedAt));
    });
  }

  function poll() {
    if (!state) return;
    var id = state.studentId;
    fetch("/transportation/live/student/" + encodeURIComponent(id), { credentials: "same-origin", headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!state || state.studentId !== id) return;
        var snap = payload && payload.success ? payload.data : null;
        if (!snap) {
          status("off", "No bus for this student", "Transportation hasn't been set up for them yet.");
          return;
        }
        if (!state.snap) { state.snap = snap; renderInfo(snap); drawFixed(snap); fitAll(); }
        var live = snap.live;
        var at = live && point(live.latitude, live.longitude);
        if (!at) {
          if (state.bus) { state.map.removeLayer(state.bus); state.bus = null; state.busAt = null; }
          if (state.leg) { state.legLayer.clearLayers(); state.leg = null; }
          status("off", "Bus not on the road", snap.pickupTime ? "Pick-up is at " + time12(snap.pickupTime) + "." : "It will show here once the driver starts the trip.");
          return;
        }
        // No signal for 2 minutes: the driver is offline, so the bus leaves the map.
        if (window.ManagiraMaps.isOffline(live.recordedAt)) {
          if (state.bus) { state.map.removeLayer(state.bus); state.bus = null; state.busAt = null; }
          state.legLayer.clearLayers(); state.leg = null;
          status("waiting", "Bus is offline", "Last seen " + window.ManagiraMaps.ago(live.recordedAt));
          return;
        }
        moveBus(at, live);
        updateLeg(at, live);
      })
      .catch(function () { if (state) status("waiting", "Can't reach the bus right now", "Trying again…"); });
  }

  function close() {
    if (!state) return;
    clearInterval(state.timer);
    cancelAnimationFrame(state.anim);
    state.root.hidden = true;
    state.root.classList.remove("bt-big");
    document.documentElement.classList.remove("bt-lock");
    state.map.remove();
    state = null;
  }

  function open(studentId, name) {
    if (!studentId) return;
    var root = document.querySelector(".bt-overlay") || build();
    if (state) close();
    root.hidden = false;
    document.documentElement.classList.add("bt-lock");
    root.querySelector("#btTitle").textContent = (name ? name + "'s bus" : "Bus");
    root.querySelector("#btTags").innerHTML = "";
    root.querySelector("#btPlaces").innerHTML = "";
    state = { root: root, studentId: studentId, follow: true, fixedPoints: [] };
    setFollow(true);
    root.querySelector('[data-bt="size"]').innerHTML = icon("expand");
    status("waiting", "Finding the bus…", "");
    Promise.all([loadLeaflet(), loadMaps()]).then(function () {
      if (!state || state.studentId !== studentId) return;
      var L = window.L;
      state.map = L.map(root.querySelector("#btMap"), { zoomControl: false, scrollWheelZoom: true, tap: true }).setView([40.7608, -111.891], 12);
      window.ManagiraMaps.addTiles(state.map);
      state.routeLayer = L.layerGroup().addTo(state.map);
      state.legLayer = L.layerGroup().addTo(state.map);
      state.fixed = L.layerGroup().addTo(state.map);
      state.map.on("dragstart", function () { setFollow(false); });
      setTimeout(function () { if (state) state.map.invalidateSize(); }, 60);
      poll();
      state.timer = setInterval(function () { if (!document.hidden) poll(); }, POLL_MS);
    }).catch(function () { status("off", "The map couldn't load", "Check the connection and try again."); });
  }

  window.BusTracker = { open: open, close: close };
})();
