// The driver's trip: a plain page until Go, then a full-screen navigation map with
// turn-by-turn directions, voice, heading-up and 3D views, satellite and night maps,
// and the list of stops. The map engine loads only when it is needed.
(function () {
  'use strict';

  var MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  var MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  var STYLE_DAY = 'https://tiles.openfreemap.org/styles/liberty';
  var STYLE_NIGHT = 'https://tiles.openfreemap.org/styles/dark';
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var STYLE_SATELLITE = {
    version: 8,
    sources: {
      imagery: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery &copy; Esri', tiles: [ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
      roads: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'] },
      places: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] }
    },
    layers: [
      { id: 'imagery', type: 'raster', source: 'imagery' },
      { id: 'roads', type: 'raster', source: 'roads' },
      { id: 'places', type: 'raster', source: 'places' }
    ]
  };
  var ARRIVE_M = 60;           // within 60 m of a stop counts as served
  var PASS_M = 35;
  var OFF_ROUTE_M = 80;        // further than this from the line: plan again
  var SNAP_M = 35;             // closer than this to the line: draw the bus on it
  var REROUTE_GAP_MS = 15000;
  var ROUTE_REFRESH_MS = 300000;
  var DWELL_S = 30;
  var RAD = Math.PI / 180;
  var PREFS_KEY = 'managira-driver-nav';

  var ICONS = {
    straight: 'M12 20V5M6 11l6-6 6 6',
    left: 'M19 20v-7a3 3 0 0 0-3-3H5M10 5l-5 5 5 5',
    right: 'M5 20v-7a3 3 0 0 1 3-3h11M14 5l5 5-5 5',
    'slight left': 'M16 20v-6L8 6M8 12V6h6',
    'slight right': 'M8 20v-6l8-8M16 12V6h-6',
    'sharp left': 'M7 20V9l8 8M15 11v6H9',
    'sharp right': 'M17 20V9l-8 8M9 11v6h6',
    uturn: 'M17 20V9A5 5 0 0 0 7 9v7M3 12l4 4 4-4',
    roundabout: 'M12 21v-6M12 15a4.5 4.5 0 1 0-4.5-4.5M7.5 6v4.5H12',
    arrive: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'
  };
  function arrowSvg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[name] || ICONS.straight) + '"/></svg>';
  }
  function toolSvg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  var TOOL = {
    compass: '<path d="M12 3l4 9h-8z" fill="#d92d20" stroke="none"/><path d="M12 21l-4-9h8z" fill="currentColor" stroke="none" opacity=".35"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    soundOn: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
    soundOff: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 10l4 4M21 10l-4 4"/>',
    overview: '<path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3"/><path d="M8 15c2-5 6-1 8-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>'
  };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function point(lat, lng) {
    if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') return null;
    var a = Number(lat), b = Number(lng);
    return (isFinite(a) && isFinite(b) && !(a === 0 && b === 0) && Math.abs(a) <= 90 && Math.abs(b) <= 180) ? { lat: a, lng: b } : null;
  }
  function distM(a, b) {
    var dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function measure(line) { var cum = [0]; for (var i = 1; i < line.length; i++) cum.push(cum[i - 1] + distM(line[i - 1], line[i])); return cum; }
  function project(line, cum, p, fromIndex, firstWithin) {
    var best = null, kx = Math.cos(p.lat * RAD) * 111320, ky = 110540;
    for (var i = Math.max(1, fromIndex || 1); i < line.length; i++) {
      var a = line[i - 1], b = line[i];
      var ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky, dx = (b.lng - a.lng) * kx, dy = (b.lat - a.lat) * ky;
      var len2 = dx * dx + dy * dy, t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var cx = ax + t * dx, cy = ay + t * dy, d = Math.sqrt(cx * cx + cy * cy);
      if (!best || d < best.offset) best = { index: i, offset: d, along: cum[i - 1] + t * (cum[i] - cum[i - 1]), point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) } };
      if (firstWithin && d <= firstWithin) return best;
    }
    return best;
  }
  function smoothHeading(prev, next) {
    if (typeof next !== 'number' || !isFinite(next)) return prev;
    if (prev === null) return next;
    var delta = ((next - prev + 540) % 360) - 180;
    return (prev + delta * 0.35 + 360) % 360;
  }
  function fmtMin(min) { if (!isFinite(min)) return '–'; var r = Math.max(1, Math.round(min)); return r < 60 ? r + ' min' : Math.floor(r / 60) + ' h ' + (r % 60) + ' min'; }
  function fmtClock(ms) { try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  var engine = null;
  function loadEngine() {
    if (window.maplibregl) return Promise.resolve();
    if (engine) return engine;
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = MAPLIBRE_CSS;
    document.head.appendChild(link);
    engine = loadScript(MAPLIBRE_JS).catch(function (error) { engine = null; throw error; });
    return engine;
  }

  // What to say and show for one step of the route.
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function describeStep(step, stopName) {
    var onto = step.name ? ' onto ' + step.name : '';
    var mod = step.modifier || 'straight';
    var turnWord = { left: 'Turn left', right: 'Turn right', 'slight left': 'Bear left', 'slight right': 'Bear right', 'sharp left': 'Turn sharp left', 'sharp right': 'Turn sharp right', uturn: 'Make a U-turn', straight: 'Continue' }[mod] || 'Continue';
    var side = /left/.test(mod) ? 'left' : /right/.test(mod) ? 'right' : '';
    switch (step.type) {
      case 'arrive': return { icon: 'arrive', text: stopName ? 'Arrive at ' + stopName : 'Arrive' };
      case 'depart': return { icon: 'straight', text: step.name ? 'Head out on ' + step.name : 'Head out' };
      case 'roundabout': case 'rotary': case 'exit roundabout': case 'exit rotary':
        return { icon: 'roundabout', text: step.exit ? 'At the roundabout, take the ' + ordinal(step.exit) + ' exit' + onto : 'Go through the roundabout' + onto };
      case 'merge': return { icon: ICONS[mod] ? mod : 'straight', text: 'Merge' + (side ? ' ' + side : '') + onto };
      case 'on ramp': return { icon: ICONS[mod] ? mod : 'straight', text: 'Take the ramp' + onto };
      case 'off ramp': return { icon: ICONS[mod] ? mod : 'straight', text: 'Take the exit' + onto };
      case 'fork': return { icon: ICONS[mod] ? mod : 'straight', text: 'Keep ' + (side || 'straight') + onto };
      case 'new name': case 'continue': return { icon: ICONS[mod] ? mod : 'straight', text: mod === 'straight' ? 'Continue' + onto : turnWord + onto };
      default: return { icon: ICONS[mod] ? mod : 'straight', text: turnWord + onto };
    }
  }

  function mount() {
    var configEl = document.getElementById('drv-config');
    if (!configEl || configEl.dataset.bound === '1') return;
    configEl.dataset.bound = '1';
    document.querySelectorAll('body > .drvn').forEach(function (old) { old.remove(); });
    document.documentElement.classList.remove('drv-navigating');

    var cfg = JSON.parse(configEl.textContent || '{}');
    var routes = cfg.routes || [];
    var unit = cfg.unit === 'mi' ? 'mi' : 'km';
    var $ = function (id) { return document.getElementById(id); };

    var prefs = { type: 'default', theme: 'auto', orientation: 'heading', tilt: true, muted: false };
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (_) { /* defaults */ }
    function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* this device only */ } }

    var st = {
      map: null, styleReady: false, bus: null, glide: 0, markers: [], route: null, stops: [], dest: null, passed: -1,
      line: null, lineAt: 0, linePending: false, lineReq: 0, offRoute: false,
      tripId: cfg.activeTrip && cfg.activeTrip.trip_id ? Number(cfg.activeTrip.trip_id) : null,
      pos: null, speed: null, heading: null, following: true, cameraAt: 0, gps: 'idle', sync: 'idle',
      said: {}, arrivedSaid: false, lastListAt: 0, styleName: ''
    };

    function driving() { return Boolean(st.tripId); }
    function findRoute(id) { return routes.find(function (r) { return String(r.route_id) === String(id); }) || null; }
    function remaining() { return st.stops.filter(function (s) { return s.seq > st.passed; }); }
    function alongOf(seq) { if (!st.line) return null; var hit = st.line.stops.find(function (x) { return x.seq === seq; }); return hit ? hit.along : null; }
    function busAlong() { if (!st.line || !st.pos) return null; var p = project(st.line.pts, st.line.cum, st.pos); return p && p.offset <= OFF_ROUTE_M ? p : null; }
    function studentsAt(stopId) { return (cfg.students || []).filter(function (s) { return s.stopId && String(s.stopId) === String(stopId); }); }
    function fmtDistance(m) {
      if (!isFinite(m)) return '–';
      if (unit === 'mi') { var mi = m / 1609.344; return mi < 0.1 ? Math.max(10, Math.round(m * 3.28084 / 10) * 10) + ' ft' : mi.toFixed(1) + ' mi'; }
      return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : (m / 1000).toFixed(1) + ' km';
    }
    function spokenDistance(m) {
      if (unit === 'mi') { var mi = m / 1609.344; return mi < 0.2 ? (Math.round(m * 3.28084 / 50) * 50) + ' feet' : mi.toFixed(1) + ' miles'; }
      return m < 1000 ? (Math.round(m / 50) * 50) + ' metres' : (m / 1000).toFixed(1) + ' kilometres';
    }

    /* ---------- the route ---------- */
    function setRoute(route) {
      st.route = route || null;
      st.passed = -1;
      st.line = null; st.lineAt = 0; st.linePending = false; st.lineReq++; st.said = {}; st.arrivedSaid = false;
      st.stops = !route ? [] : (route.stops || []).map(function (s, i) {
        var p = point(s.latitude, s.longitude);
        if (!p) return null;
        p.id = s.stop_id;
        p.name = s.stop_name || 'Stop';
        p.order = s.stop_order !== null && s.stop_order !== undefined && s.stop_order !== '' ? Number(s.stop_order) : i;
        return p;
      }).filter(Boolean).sort(function (a, b) { return a.order - b.order; });
      st.stops.forEach(function (s, i) { s.seq = i; });
      st.dest = null;
      var school = point(cfg.school && cfg.school.lat, cfg.school && cfg.school.lng);
      if (route && route.use_school_destination && school) st.dest = { lat: school.lat, lng: school.lng, label: 'School' };
      else if (route) {
        var d = point(route.destination_latitude, route.destination_longitude);
        if (d) st.dest = { lat: d.lat, lng: d.lng, label: route.destination_address || 'Final stop' };
      }
      renderIdle();
      drawMarkers();
      requestLine(true);
      drawMini();
    }

    function fetchLine(points) {
      var query = points.map(function (p) { return Number(p[0]).toFixed(5) + ',' + Number(p[1]).toFixed(5); }).join(';');
      return fetch('/transportation/road-route?steps=1&points=' + encodeURIComponent(query), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { return data && data.success && Array.isArray(data.coordinates) && data.coordinates.length > 1 ? data : null; })
        .catch(function () { return null; });
    }

    // Road-following line: bus (when driving) -> remaining stops -> destination.
    function requestLine(force) {
      if (st.linePending && !force) return;
      var now = Date.now();
      if (!force && now - st.lineAt < REROUTE_GAP_MS) return;
      var rest = remaining(), pts = [], fromBus = false;
      if (st.pos && driving()) { pts.push([st.pos.lat, st.pos.lng]); fromBus = true; }
      rest.forEach(function (s) { pts.push([s.lat, s.lng]); });
      if (st.dest) pts.push([st.dest.lat, st.dest.lng]);
      if (pts.length < 2) { st.line = null; drawLine(); renderIdleTotals(null); updateStats(); return; }
      var req = ++st.lineReq;
      st.linePending = true;
      st.lineAt = now;
      fetchLine(pts).then(function (data) {
        if (req !== st.lineReq) return;
        st.linePending = false;
        if (!data) { st.line = null; drawLine(); updateStats(); return; }
        var line = data.coordinates.map(function (p) { return { lat: Number(p[0]), lng: Number(p[1]) }; });
        var cum = measure(line), from = 1;
        var stops = rest.map(function (s) {
          var p = project(line, cum, s, from);
          if (p) from = p.index;
          return { seq: s.seq, along: p && p.offset < 80 ? p.along : null };
        });
        // Leg n ends at this stop; the name lets "Arrive at ..." say where.
        var legEnds = rest.map(function (s) { return s.name; }).concat(st.dest ? [st.dest.label] : []);
        if (!fromBus) legEnds.shift();
        var stepFrom = 1;
        var steps = (data.steps || []).map(function (step) {
          var at = { lat: Number(step.at[0]), lng: Number(step.at[1]) };
          var p = project(line, cum, at, stepFrom, 8);
          if (p) stepFrom = p.index;
          return { type: step.type, modifier: step.modifier, exit: step.exit, name: step.name, at: at, along: p ? p.along : 0, end: legEnds[step.leg] || '' };
        }).filter(function (step) { return step.type !== 'depart' && !(step.type === 'new name' && !step.name); });
        st.line = { pts: line, cum: cum, length: cum[cum.length - 1], durationS: Number(data.durationS) || 0, stops: stops, steps: steps };
        st.offRoute = false;
        if (!driving()) { renderIdleTotals(data); drawMini(); }
        drawLine();
        updateStats();
        if (driving() && !st.pos) frameRoute();
      });
    }

    // The map's credits stay one tap away instead of covering the map.
    function collapseCredits(container) {
      var box = container.querySelector('.maplibregl-ctrl-attrib');
      if (box) { box.classList.remove('maplibregl-compact-show'); box.removeAttribute('open'); }
    }

    /* ---------- the small map on the page before Go ---------- */
    var mini = { map: null, ready: false, markers: [] };
    function drawMini() {
      var el = $('drv-mini');
      if (!el || nav.hidden === false) return;
      loadEngine().then(function () {
        var gl = window.maplibregl;
        if (gl.supported && !gl.supported()) { el.hidden = true; return; }
        if (!mini.map) {
          var first = st.stops[0] || st.dest || point(cfg.school && cfg.school.lat, cfg.school && cfg.school.lng);
          mini.map = new gl.Map({
            container: el, style: document.documentElement.getAttribute('data-appearance') === 'dark' ? STYLE_NIGHT : STYLE_DAY, interactive: false, attributionControl: false,
            center: first ? [first.lng, first.lat] : [0, 20], zoom: first ? 12 : 1
          });
          mini.map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-right');
          mini.map.on('style.load', function () {
            collapseCredits(el);
            (mini.map.getStyle().layers || []).forEach(function (layer) {
              if (/^poi|housenumber/.test(layer.id) || layer.type === 'fill-extrusion') mini.map.setLayoutProperty(layer.id, 'visibility', 'none');
            });
            mini.map.addSource('line', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
            mini.map.addLayer({ id: 'line', type: 'line', source: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 3 } });
            mini.ready = true;
            drawMini();
          });
          return;
        }
        if (!mini.ready) return;
        var coords = st.line ? st.line.pts.map(function (q) { return [q.lng, q.lat]; }) : [];
        mini.map.getSource('line').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
        mini.markers.forEach(function (marker) { marker.remove(); });
        mini.markers = st.stops.map(function (s) {
          var dot = document.createElement('div');
          dot.className = 'drvn-mark drvn-mark--mini';
          return new gl.Marker({ element: dot }).setLngLat([s.lng, s.lat]).addTo(mini.map);
        });
        var all = coords.concat(st.stops.map(function (s) { return [s.lng, s.lat]; }));
        if (st.dest) all.push([st.dest.lng, st.dest.lat]);
        if (all.length) {
          var bounds = new gl.LngLatBounds(all[0], all[0]);
          all.forEach(function (c) { bounds.extend(c); });
          mini.map.fitBounds(bounds, { padding: 16, maxZoom: 14, animate: false });
        }
      }).catch(function () { el.hidden = true; });
    }

    /* ---------- the page before Go ---------- */
    var idle = {
      stops: $('drv-fact-stops'), students: $('drv-fact-students'), distance: $('drv-fact-distance'), time: $('drv-fact-time'),
      list: $('drv-stops-list'), count: $('drv-stops-count'), select: $('drv-route-select'), start: $('drv-start'), note: $('drv-note')
    };
    function renderIdle() {
      if (!idle.stops) return;
      idle.stops.textContent = st.stops.length;
      var riders = st.stops.reduce(function (sum, s) { return sum + studentsAt(s.id).length; }, 0);
      idle.students.textContent = riders || (cfg.students || []).length;
      idle.distance.textContent = '–';
      idle.time.textContent = '–';
      if (idle.count) idle.count.textContent = st.stops.length;
      if (idle.list) {
        idle.list.innerHTML = st.stops.map(function (s) {
          var count = studentsAt(s.id).length;
          return '<li><span class="drv-num">' + (s.seq + 1) + '</span><div><strong>' + esc(s.name) + '</strong><span class="drv-sub">' + count + ' student' + (count === 1 ? '' : 's') + '</span></div></li>';
        }).join('') + (st.dest ? '<li><span class="drv-num"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M5 21V9l7-5 7 5v12h-5v-6h-4v6H5z"/></svg></span><div><strong>' + esc(st.dest.label) + '</strong><span class="drv-sub">Final stop</span></div></li>' : '');
      }
    }
    function renderIdleTotals(data) {
      if (!idle.distance) return;
      idle.distance.textContent = data ? fmtDistance(data.distanceM) : '–';
      idle.time.textContent = data ? fmtMin((data.durationS + st.stops.length * DWELL_S) / 60) : '–';
    }
    function showIdleNote(message) { if (!idle.note) return; idle.note.textContent = message; idle.note.hidden = false; }

    /* ---------- the navigation screen ---------- */
    var nav = document.createElement('div');
    nav.className = 'drvn';
    nav.hidden = true;
    nav.setAttribute('role', 'application');
    nav.setAttribute('aria-label', 'Trip navigation');
    nav.innerHTML = ''
      + '<div class="drvn-map" id="drvn-map"></div><p class="drvn-msg" id="drvn-msg" hidden></p>'
      + '<div class="drvn-top" id="drvn-top">'
      +   '<div class="drvn-turn" id="drvn-turn" hidden><span id="drvn-turn-icon"></span><div class="drvn-turn__text"><strong class="drvn-turn__dist" id="drvn-turn-dist"></strong><span class="drvn-turn__what" id="drvn-turn-what"></span></div></div>'
      +   '<div class="drvn-then" id="drvn-then" hidden></div>'
      +   '<div class="drvn-chip" id="drvn-chip"></div>'
      + '</div>'
      + '<div class="drvn-tools">'
      +   '<button type="button" class="drvn-tool" id="drvn-compass" aria-label="Switch between heading up and north up" title="Heading up / north up"><span id="drvn-compass-needle" style="display:flex">' + toolSvg(TOOL.compass) + '</span></button>'
      +   '<button type="button" class="drvn-tool" id="drvn-layers-btn" aria-label="Map options" aria-expanded="false" title="Map options">' + toolSvg(TOOL.layers) + '</button>'
      +   '<button type="button" class="drvn-tool" id="drvn-sound" title="Voice guidance"></button>'
      +   '<button type="button" class="drvn-tool" id="drvn-overview" aria-label="Show the whole route" title="Show the whole route">' + toolSvg(TOOL.overview) + '</button>'
      +   '<div class="drvn-zoom"><button type="button" class="drvn-tool" id="drvn-zoom-in" aria-label="Zoom in">' + toolSvg(TOOL.plus) + '</button><button type="button" class="drvn-tool" id="drvn-zoom-out" aria-label="Zoom out">' + toolSvg(TOOL.minus) + '</button></div>'
      + '</div>'
      + '<div class="drvn-layers" id="drvn-layers" hidden>'
      +   '<p class="drvn-h">Map type</p><div class="drvn-seg" data-pref="type"><button type="button" data-value="default">Default</button><button type="button" data-value="satellite">Satellite</button></div>'
      +   '<p class="drvn-h">Appearance</p><div class="drvn-seg" data-pref="theme"><button type="button" data-value="auto">Auto</button><button type="button" data-value="day">Day</button><button type="button" data-value="night">Night</button></div>'
      +   '<label class="drvn-toggle">3D view<input type="checkbox" id="drvn-tilt" /></label>'
      +   '<label class="drvn-toggle">Face direction of travel<input type="checkbox" id="drvn-heading" /></label>'
      + '</div>'
      + '<div class="drvn-speed" id="drvn-speed" hidden><strong id="drvn-speed-value"></strong><small>' + (unit === 'mi' ? 'mph' : 'km/h') + '</small></div>'
      + '<button type="button" class="drvn-recenter" id="drvn-recenter" hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>Re-center</button>'
      + '<p class="drvn-toast" id="drvn-toast" role="status" hidden></p>'
      + '<section class="drvn-sheet" id="drvn-sheet" aria-label="Trip">'
      +   '<button type="button" class="drvn-grab" id="drvn-grab" aria-label="Show stops and options" aria-expanded="false"><i></i></button>'
      +   '<div class="drvn-eta"><div class="drvn-eta__text"><strong class="drvn-eta__time" id="drvn-eta-time">–</strong><span class="drvn-eta__sub"><i class="drvn-dot" id="drvn-dot" aria-hidden="true"></i><span id="drvn-eta-sub">Finding GPS…</span></span></div><button type="button" class="drvn-end" id="drvn-end">End</button></div>'
      +   '<div class="drvn-confirm" id="drvn-confirm" hidden><p>End this trip? Families will stop seeing the bus.</p><div><button type="button" class="drvn-plain" id="drvn-keep">Keep driving</button><button type="button" class="drvn-plain drvn-plain--danger" id="drvn-end-yes">End trip</button></div></div>'
      +   '<div class="drvn-more" id="drvn-more" hidden>'
      +     '<p class="drvn-h" id="drvn-route-name"></p><ol class="drvn-stops" id="drvn-stops"></ol>'
      +     '<p class="drvn-h">Navigate with</p><div class="drvn-apps">' + (cfg.navApps || []).map(function (app) { return '<button type="button" class="drvn-plain" data-nav-app="' + esc(app.key) + '">' + esc(app.label) + '</button>'; }).join('') + '</div>'
      +   '</div>'
      + '</section>';
    document.body.appendChild(nav);

    var ui = {
      turn: $('drvn-turn'), turnIcon: $('drvn-turn-icon'), turnDist: $('drvn-turn-dist'), turnWhat: $('drvn-turn-what'), then: $('drvn-then'), chip: $('drvn-chip'),
      compass: $('drvn-compass'), needle: $('drvn-compass-needle'), layersBtn: $('drvn-layers-btn'), layers: $('drvn-layers'), sound: $('drvn-sound'), overview: $('drvn-overview'),
      tilt: $('drvn-tilt'), heading: $('drvn-heading'), speed: $('drvn-speed'), speedValue: $('drvn-speed-value'), recenter: $('drvn-recenter'), toast: $('drvn-toast'),
      sheet: $('drvn-sheet'), grab: $('drvn-grab'), etaTime: $('drvn-eta-time'), etaSub: $('drvn-eta-sub'), dot: $('drvn-dot'), end: $('drvn-end'), confirm: $('drvn-confirm'),
      keep: $('drvn-keep'), endYes: $('drvn-end-yes'), more: $('drvn-more'), routeName: $('drvn-route-name'), stops: $('drvn-stops'), msg: $('drvn-msg')
    };

    function isNight() {
      if (prefs.theme === 'night') return true;
      if (prefs.theme === 'day') return false;
      if (document.documentElement.getAttribute('data-appearance') === 'dark') return true;
      var hour = new Date().getHours();
      return hour < 6 || hour >= 19;
    }
    function syncToolbar() {
      nav.setAttribute('data-theme', isNight() ? 'night' : 'day');
      ui.sound.innerHTML = toolSvg(prefs.muted ? TOOL.soundOff : TOOL.soundOn);
      ui.sound.setAttribute('aria-label', prefs.muted ? 'Turn voice guidance on' : 'Turn voice guidance off');
      ui.sound.setAttribute('aria-pressed', String(!prefs.muted));
      ui.tilt.checked = Boolean(prefs.tilt);
      ui.heading.checked = prefs.orientation === 'heading';
      ui.layers.querySelectorAll('[data-pref]').forEach(function (group) {
        group.querySelectorAll('button').forEach(function (button) {
          button.setAttribute('aria-pressed', String(prefs[group.getAttribute('data-pref')] === button.getAttribute('data-value')));
        });
      });
    }
    function sheetHeight() { return ui.sheet.offsetHeight || 96; }
    function syncSheet() { nav.style.setProperty('--n-sheet', (window.innerWidth >= 720 ? 10 : 0) + sheetHeight() + 'px'); }

    function speak(text) {
      if (prefs.muted || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      } catch (_) { /* voice is a nicety */ }
    }
    var toastTimer = 0;
    function toast(text, ms) {
      ui.toast.textContent = text;
      ui.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { ui.toast.hidden = true; }, ms || 3500);
    }

    /* ---------- the map ---------- */
    function currentStyle() {
      if (prefs.type === 'satellite') return STYLE_SATELLITE;
      return isNight() ? STYLE_NIGHT : STYLE_DAY;
    }
    function styleKey() { return prefs.type === 'satellite' ? 'satellite' : (isNight() ? 'night' : 'day'); }
    function ensureMap() {
      if (st.map) return Promise.resolve();
      return loadEngine().then(function () {
        if (st.map || nav.hidden) return;
        var gl = window.maplibregl;
        if (gl.supported && !gl.supported()) throw new Error('no webgl');
        var start = st.pos || (cfg.lastLocation && point(cfg.lastLocation.latitude, cfg.lastLocation.longitude)) || st.stops[0] || st.dest || point(cfg.school && cfg.school.lat, cfg.school && cfg.school.lng);
        var map = st.map = new gl.Map({
          container: $('drvn-map'), style: currentStyle(), attributionControl: false, dragRotate: true, pitchWithRotate: true,
          center: start ? [start.lng, start.lat] : [0, 20], zoom: start ? 14 : 2, maxPitch: 70
        });
        st.styleName = styleKey();
        map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new gl.ScaleControl({ unit: unit === 'mi' ? 'imperial' : 'metric', maxWidth: 90 }), 'bottom-left');
        map.on('style.load', function () { st.styleReady = true; addRouteLayers(); collapseCredits($('drvn-map')); });
        map.on('rotate', syncCompass);
        map.on('movestart', function (event) { if (event.originalEvent && driving()) setFollowing(false); });
        map.on('error', function () { /* a missing tile is not worth interrupting a driver */ });
        drawMarkers();
        if (st.pos) placeBus(st.pos, false, false);
        else if (cfg.lastLocation) { var last = point(cfg.lastLocation.latitude, cfg.lastLocation.longitude); if (last) placeBus(last, true, false); }
      }).catch(function () {
        ui.msg.hidden = false;
        ui.msg.textContent = 'The map could not load. Your trip is still running. Open the list below to navigate with another app.';
      });
    }
    function addRouteLayers() {
      var map = st.map;
      if (!map || !st.styleReady) return;
      var layers = (map.getStyle().layers || []);
      layers.forEach(function (layer) {
        if (/^poi|housenumber/.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
        if (layer.type === 'fill-extrusion') map.setLayoutProperty(layer.id, 'visibility', prefs.tilt ? 'visible' : 'none');
      });
      var beforeId = (layers.find(function (layer) { return layer.type === 'symbol'; }) || {}).id;
      var empty = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
      if (!map.getSource('drv-done')) map.addSource('drv-done', { type: 'geojson', data: empty });
      if (!map.getSource('drv-ahead')) map.addSource('drv-ahead', { type: 'geojson', data: empty });
      var lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
      map.addLayer({ id: 'drv-done', type: 'line', source: 'drv-done', layout: lineLayout, paint: { 'line-color': '#98a2b3', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 18, 10], 'line-opacity': .8 } }, beforeId);
      map.addLayer({ id: 'drv-casing', type: 'line', source: 'drv-ahead', layout: lineLayout, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 18, 16] } }, beforeId);
      map.addLayer({ id: 'drv-ahead', type: 'line', source: 'drv-ahead', layout: lineLayout, paint: { 'line-color': '#1a73e8', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 18, 11] } }, beforeId);
      drawLine();
    }
    function applyStyle() {
      syncToolbar();
      if (!st.map) return;
      var key = styleKey();
      if (key === st.styleName) { addTiltOnly(); return; }
      st.styleName = key;
      st.styleReady = false;
      st.map.setStyle(currentStyle());
    }
    function addTiltOnly() {
      if (!st.map || !st.styleReady) return;
      (st.map.getStyle().layers || []).forEach(function (layer) {
        if (layer.type === 'fill-extrusion') st.map.setLayoutProperty(layer.id, 'visibility', prefs.tilt ? 'visible' : 'none');
      });
    }
    function drawLine() {
      var map = st.map;
      if (!map || !st.styleReady || !map.getSource('drv-ahead')) return;
      var ahead = [], done = [];
      if (st.line) {
        var toCoord = function (q) { return [q.lng, q.lat]; };
        var p = driving() ? busAlong() : null;
        if (p) {
          done = st.line.pts.slice(0, p.index).map(toCoord).concat([[p.point.lng, p.point.lat]]);
          ahead = [[p.point.lng, p.point.lat]].concat(st.line.pts.slice(p.index).map(toCoord));
        } else {
          ahead = st.line.pts.map(toCoord);
        }
      }
      var feature = function (coordinates) { return { type: 'Feature', geometry: { type: 'LineString', coordinates: coordinates }, properties: {} }; };
      map.getSource('drv-ahead').setData(feature(ahead));
      map.getSource('drv-done').setData(feature(done));
    }
    function drawMarkers() {
      if (!st.map) return;
      var gl = window.maplibregl;
      st.markers.forEach(function (marker) { marker.remove(); });
      st.markers = [];
      var nextSeq = (remaining()[0] || {}).seq;
      st.stops.forEach(function (s) {
        var el = document.createElement('div');
        var done = s.seq <= st.passed;
        el.className = 'drvn-mark' + (done ? ' is-done' : (s.seq === nextSeq ? ' is-next' : ''));
        el.textContent = done ? '' : s.seq + 1;
        el.title = s.name;
        st.markers.push(new gl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(st.map));
      });
      if (st.dest) {
        var school = document.createElement('div');
        school.className = 'drvn-mark drvn-mark--school';
        school.title = st.dest.label;
        school.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 21V9l7-5 7 5v12h-5v-6h-4v6H5z"/></svg>';
        st.markers.push(new gl.Marker({ element: school }).setLngLat([st.dest.lng, st.dest.lat]).addTo(st.map));
      }
    }
    function syncCompass() {
      if (st.map) ui.needle.style.transform = 'rotate(' + (-st.map.getBearing()) + 'deg)';
    }

    /* ---------- the bus ---------- */
    function placeBus(p, stale, animate) {
      if (!st.map || !p) return;
      if (!st.bus) {
        var el = document.createElement('div');
        el.className = 'drvn-puck';
        el.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#fff"/><path d="M24 7l13 31-13-7-13 7z" fill="#1a73e8"/></svg>';
        st.bus = new window.maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat([p.lng, p.lat]).addTo(st.map);
      } else if (animate) {
        glideTo(p);
      } else {
        st.bus.setLngLat([p.lng, p.lat]);
      }
      st.bus.getElement().classList.toggle('is-stale', Boolean(stale));
      if (st.heading !== null) st.bus.setRotation(st.heading);
    }
    function glideTo(p) {
      var marker = st.bus;
      if (st.glide) cancelAnimationFrame(st.glide);
      st.glide = 0;
      var from = marker.getLngLat();
      var distance = distM({ lat: from.lat, lng: from.lng }, p);
      if (distance < 0.5) return;
      if (distance > 1500 || document.hidden) { marker.setLngLat([p.lng, p.lat]); return; }
      var startAt = null;
      var step = function (now) {
        if (st.bus !== marker) return;
        if (startAt === null) startAt = now;
        var k = Math.min(1, (now - startAt) / 1000);
        marker.setLngLat([from.lng + (p.lng - from.lng) * k, from.lat + (p.lat - from.lat) * k]);
        st.glide = k < 1 ? requestAnimationFrame(step) : 0;
      };
      st.glide = requestAnimationFrame(step);
    }

    /* ---------- the camera ---------- */
    function cameraPadding() {
      var h = st.map.getContainer().clientHeight;
      return { top: Math.round(h * (prefs.tilt ? 0.42 : 0.3)), bottom: sheetHeight() + 20, left: 0, right: 0 };
    }
    function follow(force) {
      if (!st.map || !driving() || !st.pos || (!st.following && !force)) return;
      var now = Date.now();
      if (!force && now - st.cameraAt < 900) return;
      st.cameraAt = now;
      var kmh = (st.speed || 0) * 3.6;
      var at = st.shown || st.pos;
      st.map.easeTo({
        center: [at.lng, at.lat],
        zoom: kmh > 70 ? 15 : kmh > 40 ? 15.8 : 16.6,
        bearing: prefs.orientation === 'heading' && st.heading !== null ? st.heading : 0,
        pitch: prefs.tilt ? 55 : 0,
        padding: cameraPadding(),
        duration: force ? 800 : 1000,
        easing: force ? undefined : function (t) { return t; },
        essential: true
      });
    }
    function setFollowing(on) {
      st.following = on;
      ui.recenter.hidden = on || !driving();
    }
    function frameRoute() {
      if (!st.map) return;
      var pts = st.line ? st.line.pts.map(function (q) { return [q.lng, q.lat]; }) : st.stops.map(function (s) { return [s.lng, s.lat]; });
      if (st.dest) pts.push([st.dest.lng, st.dest.lat]);
      if (st.pos) pts.push([st.pos.lng, st.pos.lat]);
      if (!pts.length) return;
      var bounds = new window.maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach(function (c) { bounds.extend(c); });
      var top = ($('drvn-top').offsetHeight || 0) + 30;
      st.map.fitBounds(bounds, { padding: { top: top, bottom: sheetHeight() + 30, left: 50, right: 70 }, bearing: 0, pitch: 0, maxZoom: 16, duration: 800, essential: true });
    }

    /* ---------- progress ---------- */
    function checkProgress() {
      var before = st.passed, proj = busAlong(), rest = remaining();
      for (var i = 0; i < rest.length; i++) {
        var s = rest[i], near = distM(st.pos, s);
        var reached = near <= ARRIVE_M;
        if (!reached && proj && near < 400) { var a = alongOf(s.seq); reached = a !== null && proj.along > a + PASS_M; }
        if (!reached) break; // stops are served in order
        st.passed = s.seq;
      }
      if (st.passed !== before) {
        var reachedStop = st.stops[st.passed];
        var riders = studentsAt(reachedStop.id).length;
        var message = 'Arrived at ' + reachedStop.name + (riders ? '. ' + riders + ' student' + (riders === 1 ? '' : 's') : '');
        toast(message);
        speak(message);
        drawMarkers();
        requestLine(true);
      }
    }
    // GPS wanders a few metres: while the bus is on its route, show it on the road and
    // point it the way the road goes.
    function roadPoint(fix) {
      if (!st.line) return null;
      var p = project(st.line.pts, st.line.cum, fix);
      if (!p || p.offset > SNAP_M) return null;
      var a = st.line.pts[p.index - 1], b = st.line.pts[p.index];
      var y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
      var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
      return { point: p.point, bearing: (Math.atan2(y, x) / RAD + 360) % 360 };
    }
    function onFix(fix) {
      var wasWaiting = !st.pos;
      st.pos = fix;
      if (fix.speed !== null && fix.speed !== undefined) st.speed = st.speed === null ? fix.speed : st.speed * 0.6 + fix.speed * 0.4;
      var onRoad = driving() ? roadPoint(fix) : null;
      if (st.heading === null || (fix.speed !== null && fix.speed > 1.5)) st.heading = smoothHeading(st.heading, onRoad ? onRoad.bearing : fix.heading);
      fix.heading = st.heading;
      st.shown = onRoad ? onRoad.point : fix;
      placeBus(st.shown, false, !wasWaiting);
      if (!driving()) return;
      checkProgress();
      var p = busAlong();
      if (wasWaiting) { requestLine(true); follow(true); }
      else if (!st.line || !p) {
        if (st.line && !st.offRoute) { st.offRoute = true; speak('Rerouting'); toast('Rerouting…', 2000); }
        requestLine(false);
      }
      else if (Date.now() - st.lineAt > ROUTE_REFRESH_MS) requestLine(false);
      drawLine();
      updateStats();
      follow(false);
    }

    function stepNow(proj) {
      if (!st.line || !proj) return null;
      var steps = st.line.steps;
      for (var i = 0; i < steps.length; i++) {
        if (steps[i].along > proj.along + 5) return { step: steps[i], next: steps[i + 1] || null, distance: steps[i].along - proj.along };
      }
      return null;
    }
    function speakStep(current) {
      var key = current.step.at.lat + ',' + current.step.at.lng;
      var level = current.distance <= 60 ? 3 : current.distance <= 300 ? 2 : current.distance <= 900 ? 1 : 0;
      if (!level || (st.said[key] || 0) >= level) return;
      st.said[key] = level;
      var text = describeStep(current.step, current.step.end).text;
      speak(level === 3 ? text : 'In ' + spokenDistance(current.distance) + ', ' + text.charAt(0).toLowerCase() + text.slice(1));
    }
    function updateStats() {
      if (nav.hidden) return;
      var rest = remaining(), target = rest[0] || st.dest, isDest = !rest[0];
      var kmh = st.speed === null ? null : st.speed * 3.6;
      ui.speed.hidden = kmh === null || !st.pos || kmh > 200; // over 200 km/h is a GPS jump, not a bus
      if (!ui.speed.hidden) ui.speedValue.textContent = Math.round(unit === 'mi' ? kmh * 0.621371 : kmh);

      if (!target) {
        ui.turn.hidden = true; ui.then.hidden = true; ui.chip.hidden = false;
        ui.chip.textContent = 'No stops on this route';
        ui.etaTime.textContent = '–';
        return;
      }
      var proj = busAlong(), toNext = null, total = null;
      if (proj) {
        var a = isDest ? st.line.length : alongOf(target.seq);
        if (a !== null) toNext = Math.max(0, a - proj.along);
        total = Math.max(0, st.line.length - proj.along);
      }
      if (st.pos) {
        if (toNext === null) toNext = distM(st.pos, target) * 1.3;
        if (total === null) {
          total = 0;
          var prev = st.pos;
          rest.concat(st.dest ? [st.dest] : []).forEach(function (q) { total += distM(prev, q) * 1.3; prev = q; });
        }
      } else if (st.line) {
        total = st.line.length;
      }

      // Directions
      var current = stepNow(proj);
      if (current) {
        var what = describeStep(current.step, current.step.end);
        ui.turn.hidden = false;
        ui.turnIcon.innerHTML = arrowSvg(what.icon);
        ui.turnDist.textContent = fmtDistance(current.distance);
        ui.turnWhat.textContent = what.text;
        var soon = current.next && current.next.along - current.step.along < 200 ? describeStep(current.next, current.next.end) : null;
        ui.then.hidden = !soon;
        if (soon) ui.then.innerHTML = arrowSvg(soon.icon) + 'Then ' + esc(soon.text.charAt(0).toLowerCase() + soon.text.slice(1));
        speakStep(current);
      } else {
        ui.turn.hidden = true;
        ui.then.hidden = true;
      }

      // Next stop
      var nearEnd = isDest && st.pos && st.dest && distM(st.pos, st.dest) <= ARRIVE_M;
      if (nearEnd && !st.arrivedSaid) { st.arrivedSaid = true; speak('You have arrived at ' + st.dest.label); toast('You have arrived'); }
      ui.chip.hidden = false;
      if (isDest) {
        ui.chip.innerHTML = esc(nearEnd ? 'You have arrived' : 'Final stop: ' + st.dest.label);
      } else {
        var riders = studentsAt(target.id).length;
        ui.chip.innerHTML = 'Stop ' + (target.seq + 1) + ' of ' + st.stops.length + ': ' + esc(target.name) + ' <small>' + (riders ? '· ' + riders + ' student' + (riders === 1 ? '' : 's') + ' ' : '') + (toNext !== null ? '· ' + esc(fmtDistance(toNext)) : '') + '</small>';
      }

      // Time left: the road route's own time for what is left, plus a short wait per stop.
      var pace = st.line && st.line.length ? st.line.durationS / st.line.length : 1 / Math.max(18 / 3.6, Math.min(60 / 3.6, st.speed === null ? 25 / 3.6 : st.speed));
      if (total !== null) {
        var seconds = total * pace + rest.length * DWELL_S;
        ui.etaTime.textContent = fmtMin(seconds / 60);
        st.statsLine = fmtDistance(total) + ' · ' + fmtClock(Date.now() + seconds * 1000);
      } else {
        ui.etaTime.textContent = '–';
        st.statsLine = '';
      }
      renderStatus();
      if (!ui.more.hidden && Date.now() - st.lastListAt > 5000) renderStops(proj, pace);
    }
    function renderStops(proj, pace) {
      st.lastListAt = Date.now();
      if (!proj) proj = busAlong();
      if (pace === undefined) pace = st.line && st.line.length ? st.line.durationS / st.line.length : 0;
      ui.routeName.textContent = st.route ? st.route.route_name : '';
      var nextSeq = (remaining()[0] || {}).seq;
      var waited = 0;
      ui.stops.innerHTML = st.stops.map(function (s) {
        var done = s.seq <= st.passed;
        var names = studentsAt(s.id).map(function (r) { return r.name; }).join(', ');
        var eta = '';
        if (!done && proj && pace) {
          var along = alongOf(s.seq);
          if (along !== null) eta = fmtClock(Date.now() + (Math.max(0, along - proj.along) * pace + waited * DWELL_S) * 1000);
          waited += 1;
        }
        return '<li class="' + (done ? 'is-done' : '') + '"><span class="drvn-num">' + (s.seq + 1) + '</span><div class="drvn-stop-text"><strong>' + esc(s.name) + '</strong>' + (names ? '<small>' + esc(names) + '</small>' : '') + '</div>'
          + (eta ? '<em>' + esc(eta) + '</em>' : '')
          + (s.seq === nextSeq ? '<button type="button" class="drvn-skip" data-skip="' + s.seq + '">Skip</button>' : '')
          + '</li>';
      }).join('');
      syncSheet();
    }
    function renderStatus() {
      var state = 'idle', text = 'Finding GPS…';
      if (st.gps === 'denied' || st.gps === 'unsupported') { state = 'off'; text = 'Location is off'; }
      else if (st.gps === 'starting' || st.gps === 'idle') { state = 'weak'; text = 'Finding GPS…'; }
      else if (st.gps === 'weak') { state = 'weak'; text = 'Weak GPS'; }
      else if (st.sync === 'failing') { state = 'weak'; text = 'Reconnecting…'; }
      else { state = 'live'; text = st.statsLine || 'Sharing live'; }
      ui.dot.setAttribute('data-state', state);
      ui.etaSub.textContent = (state === 'live' || !st.statsLine) ? text : text + ' · ' + st.statsLine;
      if (st.gps === 'denied') { ui.msg.hidden = true; toast('Location is blocked. Allow it for this site in your phone’s settings so families can see the bus.', 6000); }
      else if (st.gps === 'unsupported') toast('This browser can’t share location. Open the driver screen over a secure (https) connection.', 6000);
    }
    function gpsHandlers() {
      return { tripId: st.tripId, onFix: onFix, onStatus: function (s) { var was = st.gps; st.gps = s.gps; st.sync = s.sync; if (was !== s.gps || s.gps !== 'denied') renderStatus(); } };
    }

    /* ---------- open and close ---------- */
    function enterNav() {
      nav.hidden = false;
      document.documentElement.classList.add('drv-navigating');
      syncToolbar();
      syncSheet();
      setFollowing(true);
      ensureMap().then(function () {
        if (!st.map) return;
        st.map.resize();
        drawMarkers();
        if (st.pos) follow(true); else frameRoute();
      });
    }
    function leaveNav() {
      nav.hidden = true;
      document.documentElement.classList.remove('drv-navigating');
      ui.layers.hidden = true;
      ui.confirm.hidden = true;
      setSheetOpen(false);
      if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (_) { /* nothing to stop */ } }
      if (st.glide) { cancelAnimationFrame(st.glide); st.glide = 0; }
      if (st.map) { try { st.map.remove(); } catch (_) { /* already gone */ } }
      st.map = null; st.bus = null; st.markers = []; st.styleReady = false;
    }
    function post(url, data) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(data).toString()
      }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (json) {
          if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Something went wrong. Try again.');
          return json;
        });
      });
    }
    function selectedRouteId() {
      if (idle.select) return idle.select.value;
      return routes[0] ? routes[0].route_id : '';
    }
    function go() {
      var routeId = selectedRouteId();
      if (!routeId || !cfg.bus) { showIdleNote('Choose your route first.'); return; }
      if (idle.note) idle.note.hidden = true;
      if (!window.DriverLocation) { showIdleNote('Location sharing could not load. Refresh the page and try again.'); return; }
      window.DriverLocation.start(gpsHandlers()); // inside the tap, so the phone asks for permission
      speak(' ');                                 // and so the phone allows the voice
      var label = idle.start.querySelector('span');
      idle.start.disabled = true;
      label.textContent = 'Starting…';
      setRoute(findRoute(routeId));
      enterNav();
      post('/transportation/driver/trips/start', { routeId: routeId, busId: String(cfg.bus.bus_id) }).then(function (result) {
        if (!result.trip) throw new Error('The trip could not start. Try again.');
        st.tripId = Number(result.trip.trip_id);
        window.DriverLocation.setTrip(st.tripId);
        if (st.pos) onFix(st.pos);
        requestLine(true);
        speak('Starting ' + (st.route ? st.route.route_name : 'your route'));
      }).catch(function (error) {
        if (!st.tripId) { window.DriverLocation.stop(); leaveNav(); }
        showIdleNote(error.message);
      }).then(function () {
        idle.start.disabled = false;
        label.textContent = 'Go';
      });
    }
    function endTrip() {
      if (!st.tripId) { leaveNav(); return; }
      ui.endYes.disabled = true;
      post('/transportation/driver/trips/end', { tripId: String(st.tripId) }).then(function () {
        st.tripId = null;
        if (window.DriverLocation) { window.DriverLocation.setTrip(null); window.DriverLocation.stop(); }
        st.pos = null; st.speed = null; st.heading = null;
        leaveNav();
        setRoute(findRoute(selectedRouteId()));
      }).catch(function (error) { toast(error.message); }).then(function () { ui.endYes.disabled = false; });
    }
    function openNavApp(app) {
      var pts = remaining().map(function (s) { return [s.lat, s.lng]; });
      if (st.dest) pts.push([st.dest.lat, st.dest.lng]);
      if (!pts.length) { toast('There are no stops left to navigate to.'); return; }
      var dest = pts[pts.length - 1], via = pts.slice(0, -1), url;
      if (app === 'waze') url = 'https://waze.com/ul?ll=' + dest[0] + ',' + dest[1] + '&navigate=yes';
      else if (app === 'apple') url = 'https://maps.apple.com/?saddr=Current%20Location&daddr=' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join('+to:') + '&dirflg=d';
      else {
        url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=' + dest[0] + ',' + dest[1];
        if (via.length) url += '&waypoints=' + encodeURIComponent(via.slice(0, 9).map(function (p) { return p[0] + ',' + p[1]; }).join('|'));
      }
      var win = window.open(url, '_blank', 'noopener');
      if (!win) window.location.href = url;
    }
    function setSheetOpen(open) {
      ui.more.hidden = !open;
      ui.grab.setAttribute('aria-expanded', String(open));
      if (open) { ui.confirm.hidden = true; renderStops(); }
      syncSheet();
    }

    /* ---------- controls ---------- */
    if (idle.select) idle.select.addEventListener('change', function () { if (idle.note) idle.note.hidden = true; setRoute(findRoute(idle.select.value)); });
    if (idle.start) idle.start.addEventListener('click', go);
    ui.recenter.addEventListener('click', function () { setFollowing(true); follow(true); });
    ui.overview.addEventListener('click', function () { setFollowing(false); frameRoute(); });
    ui.grab.addEventListener('click', function () { setSheetOpen(ui.more.hidden); });
    ui.end.addEventListener('click', function () { setSheetOpen(false); ui.confirm.hidden = false; syncSheet(); });
    ui.keep.addEventListener('click', function () { ui.confirm.hidden = true; syncSheet(); });
    ui.endYes.addEventListener('click', endTrip);
    ui.compass.addEventListener('click', function () {
      prefs.orientation = prefs.orientation === 'heading' ? 'north' : 'heading';
      savePrefs(); syncToolbar();
      toast(prefs.orientation === 'heading' ? 'Direction of travel' : 'North', 1200);
      if (st.following && st.pos) follow(true);
      else if (st.map) st.map.easeTo({ bearing: prefs.orientation === 'heading' && st.heading !== null ? st.heading : 0, duration: 500 });
    });
    ui.sound.addEventListener('click', function () {
      prefs.muted = !prefs.muted;
      savePrefs(); syncToolbar();
      if (prefs.muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      else speak('Voice guidance on');
    });
    ui.layersBtn.addEventListener('click', function () {
      ui.layers.hidden = !ui.layers.hidden;
      ui.layersBtn.setAttribute('aria-expanded', String(!ui.layers.hidden));
    });
    ui.layers.addEventListener('click', function (event) {
      var button = event.target.closest('[data-value]');
      if (!button) return;
      prefs[button.parentNode.getAttribute('data-pref')] = button.getAttribute('data-value');
      savePrefs();
      applyStyle();
    });
    ui.tilt.addEventListener('change', function () {
      prefs.tilt = ui.tilt.checked;
      savePrefs(); applyStyle();
      if (st.following && st.pos) follow(true);
      else if (st.map) st.map.easeTo({ pitch: prefs.tilt ? 55 : 0, duration: 500 });
    });
    ui.heading.addEventListener('change', function () {
      prefs.orientation = ui.heading.checked ? 'heading' : 'north';
      savePrefs(); syncToolbar();
      if (st.following && st.pos) follow(true);
      else if (st.map) st.map.easeTo({ bearing: prefs.orientation === 'heading' && st.heading !== null ? st.heading : 0, duration: 500 });
    });
    $('drvn-zoom-in').addEventListener('click', function () { if (st.map) st.map.zoomIn(); });
    $('drvn-zoom-out').addEventListener('click', function () { if (st.map) st.map.zoomOut(); });
    ui.more.addEventListener('click', function (event) {
      var app = event.target.closest('[data-nav-app]');
      if (app) { openNavApp(app.getAttribute('data-nav-app')); return; }
      var skip = event.target.closest('[data-skip]');
      if (skip) {
        st.passed = Number(skip.getAttribute('data-skip'));
        drawMarkers();
        requestLine(true);
        renderStops();
      }
    });
    window.addEventListener('resize', function () { if (!nav.hidden) { syncSheet(); if (st.map) st.map.resize(); } });
    // Auto day/night follows the clock during a long trip.
    setInterval(function () { if (!nav.hidden && prefs.theme === 'auto') applyStyle(); }, 60000);

    /* ---------- begin ---------- */
    syncToolbar();
    var firstRoute = cfg.activeTrip ? findRoute(cfg.activeTrip.route_id) : (idle.select ? findRoute(idle.select.value) : routes[0] || null);
    setRoute(firstRoute);
    if (driving()) {
      enterNav();
      if (window.DriverLocation) window.DriverLocation.start(gpsHandlers());
    }
  }

  window.DriverNav = { mount: mount, describeStep: describeStep };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('spa:pageLoaded', mount);
})();
