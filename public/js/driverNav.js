// The driver's trip: a plain page with a small map, then on Go a large navigation map
// under the app's header, with directions, the stops, Google or Apple Maps a tap away,
// and a button to minimize it while the trip keeps running.
(function () {
  'use strict';

  var MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  var MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  var STYLE_DAY = 'https://tiles.openfreemap.org/styles/liberty';
  var ARRIVE_M = 60;           // within 60 m of a stop counts as served
  var LEAVE_STOP_M = 150;      // this far from where the bus stopped: it has driven off
  var RIDING_EVERY_MS = 60000;
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
    minimize: '<path d="M6 9l6 6 6-6"/>',
    compass: '<path d="M12 3l4 9h-8z" fill="#d92d20" stroke="none"/><path d="M12 21l-4-9h8z" fill="currentColor" stroke="none" opacity=".35"/>',
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
  function fmtMin(min) { if (!isFinite(min)) return '–'; var r = Math.max(1, Math.round(min)); return r < 60 ? r + ' min' : r % 60 ? Math.floor(r / 60) + ' h ' + (r % 60) + ' m' : (r / 60) + ' h'; }
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

  // On a driver's page only the map zooms: a quick second tap on a button must never
  // enlarge the page. iPhones ignore the viewport tag, so they need touch-action and these.
  function pageZoom(allowed) {
    document.documentElement.classList.toggle('drv-nozoom', !allowed);
    var tag = document.querySelector('meta[name="viewport"]');
    if (!tag) return;
    if (tag.getAttribute('data-usual') === null) tag.setAttribute('data-usual', tag.getAttribute('content') || '');
    var usual = tag.getAttribute('data-usual');
    tag.setAttribute('content', allowed ? usual : usual + ', user-scalable=no');
  }
  ['gesturestart', 'gesturechange'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (!document.documentElement.classList.contains('drv-nozoom')) return;
      if (!(event.target && event.target.closest && event.target.closest('.maplibregl-map'))) event.preventDefault();
    }, { passive: false });
  });

  function mount() {
    var configEl = document.getElementById('drv-config');
    if (configEl && configEl.dataset.bound === '1') return;
    // A new page, or the header's menu led elsewhere: the map doesn't stay on top of it.
    document.querySelectorAll('body > .drvn').forEach(function (old) { old.remove(); });
    document.documentElement.classList.remove('drv-navigating');
    pageZoom(!configEl);
    if (!configEl) return;
    configEl.dataset.bound = '1';

    var cfg = JSON.parse(configEl.textContent || '{}');
    var routes = cfg.routes || [];
    var unit = cfg.unit === 'mi' ? 'mi' : 'km';
    var $ = function (id) { return document.getElementById(id); };

    var prefs = { orientation: 'heading' };
    try { if (JSON.parse(localStorage.getItem(PREFS_KEY) || '{}').orientation === 'north') prefs.orientation = 'north'; } catch (_) { /* defaults */ }
    function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* this device only */ } }

    var st = {
      map: null, styleReady: false, bus: null, glide: 0, markers: [], route: null, stops: [], dest: null, passed: -1,
      line: null, lineAt: 0, linePending: false, lineReq: 0, offRoute: false,
      tripId: cfg.activeTrip && cfg.activeTrip.trip_id ? Number(cfg.activeTrip.trip_id) : null,
      pos: null, speed: null, heading: null, following: true, cameraAt: 0, gps: 'idle', sync: 'idle',
      arrivedSaid: false, lastListAt: 0,
      board: null, boarded: {}, stopsDone: {}, boardingOut: [], boardingBusy: null, boardingAt: 0, ridingAt: 0, ridingKnown: false, stopCard: null, skipArrivals: false, endExcept: false
    };

    // The driver is done the moment they tap: the trip's end goes to the server from here,
    // and waits for signal if there is none.
    var END_KEY = 'managira-trip-ending';
    var ENDED_KEY = 'managira-trip-ended';
    st.endList = [];
    try { st.ending = JSON.parse(localStorage.getItem(END_KEY) || 'null'); } catch (_) { st.ending = null; }
    if (st.ending && Date.now() - st.ending.at > 24 * 3600 * 1000) { st.ending = null; try { localStorage.removeItem(END_KEY); } catch (_) { /* nothing saved */ } }
    if (st.ending && st.tripId === Number(st.ending.tripId)) { st.tripId = null; cfg.activeTrip = null; }
    // The page may have been drawn a moment before the end reached the server.
    try { if (st.tripId && st.tripId === Number(localStorage.getItem(ENDED_KEY))) { st.tripId = null; cfg.activeTrip = null; } } catch (_) { /* nothing saved */ }

    function driving() { return Boolean(st.tripId); }
    function findRoute(id) { return routes.find(function (r) { return String(r.route_id) === String(id); }) || null; }
    function remaining() { return st.stops.filter(function (s) { return s.seq > st.passed; }); }
    function alongOf(seq) { if (!st.line) return null; var hit = st.line.stops.find(function (x) { return x.seq === seq; }); return hit ? hit.along : null; }
    function busAlong() {
      if (!st.line || !st.pos) return null;
      if (st.alongFor === st.pos && st.alongLine === st.line) return st.alongValue;
      var p = project(st.line.pts, st.line.cum, st.pos);
      st.alongFor = st.pos; st.alongLine = st.line;
      st.alongValue = p && p.offset <= OFF_ROUTE_M ? p : null;
      return st.alongValue;
    }
    function studentsAt(stopId) { return (cfg.students || []).filter(function (s) { return s.hasAccess && !s.notRiding && s.stopId && String(s.stopId) === String(stopId); }); }
    function notComingAt(stopId) { return (cfg.students || []).filter(function (s) { return s.hasAccess && s.notRiding && s.stopId && String(s.stopId) === String(stopId); }); }
    // Who this trip picks up: riders on the chosen route, or on this bus with no route yet.
    function ridersOnRoute() {
      var routeId = st.route ? String(st.route.route_id) : '';
      return (cfg.students || []).filter(function (s) { return s.hasAccess && (!routeId || s.routeId === null || String(s.routeId) === routeId); });
    }
    function notPickingUp() {
      var riders = ridersOnRoute();
      return (cfg.students || []).filter(function (s) { return riders.indexOf(s) < 0; });
    }
    function fmtDistance(m) {
      if (!isFinite(m)) return '–';
      if (unit === 'mi') { var mi = m / 1609.344; return mi < 0.1 ? Math.max(10, Math.round(m * 3.28084 / 10) * 10) + ' ft' : mi < 100 ? mi.toFixed(1) + ' mi' : Math.round(mi).toLocaleString() + ' mi'; }
      if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
      return m < 100000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 1000).toLocaleString() + ' km';
    }
    /* ---------- the route ---------- */
    function setRoute(route) {
      st.route = route || null;
      st.passed = -1;
      st.line = null; st.lineAt = 0; st.linePending = false; st.lineReq++; st.arrivedSaid = false;
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
      scheduleMini();
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
      if (pts.length < 2) { st.line = null; drawLine(true); renderIdleTotals(null); updateStats(); return; }
      var req = ++st.lineReq;
      st.linePending = true;
      st.lineAt = now;
      fetchLine(pts).then(function (data) {
        if (req !== st.lineReq) return;
        st.linePending = false;
        if (!data) { st.line = null; drawLine(true); updateStats(); scheduleMini(); return; }
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
        if (!driving()) { renderIdleTotals(data); scheduleMini(); }
        drawLine(true);
        updateStats();
        if (driving() && !st.pos) frameRoute();
      });
    }

    // The map's credits stay one tap away instead of covering the map.
    function collapseCredits(container) {
      var box = container.querySelector('.maplibregl-ctrl-attrib');
      if (box) { box.classList.remove('maplibregl-compact-show'); box.removeAttribute('open'); }
    }
    function keepCreditsSmall(map, container) {
      collapseCredits(container);
      map.once('idle', function () { collapseCredits(container); });
    }

    /* ---------- the small map on the page before Go ---------- */
    // Drawn once when the page is idle and kept as a picture, so this page holds no map
    // engine, graphics memory or map traffic until Go.
    var mini = { key: '', timer: 0, map: null };
    function scheduleMini() {
      if (!$('drv-mini') || mini.timer) return;
      var run = function () { mini.timer = 0; drawMini(); };
      mini.timer = 1;
      if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1500 }); else setTimeout(run, 600);
    }
    function drawMini() {
      var el = $('drv-mini');
      if (!el || !nav.hidden || st.linePending) return;
      var key = (st.route ? st.route.route_id : '') + '|' + (st.line ? st.line.pts.length : 0);
      if (key === mini.key || (!st.line && !st.stops.length)) return;
      mini.key = key;
      loadEngine().then(function () {
        var gl = window.maplibregl;
        if (gl.supported && !gl.supported()) return;
        if (mini.map) { mini.map.remove(); mini.map = null; }
        var coords = st.line ? st.line.pts.map(function (q) { return [q.lng, q.lat]; }) : [];
        var stops = st.stops.map(function (s) { return [s.lng, s.lat]; });
        var all = coords.concat(stops);
        if (st.dest) all.push([st.dest.lng, st.dest.lat]);
        if (!all.length) return;
        var bounds = new gl.LngLatBounds(all[0], all[0]);
        all.forEach(function (c) { bounds.extend(c); });
        var box = document.createElement('div');
        box.className = 'drv-mini__draw';
        el.appendChild(box);
        var map = mini.map = new gl.Map({
          container: box, style: STYLE_DAY, interactive: false, attributionControl: false, fadeDuration: 0, preserveDrawingBuffer: true,
          bounds: bounds, fitBoundsOptions: { padding: 16, maxZoom: 14 }
        });
        var finish = function (keep) {
          if (keep) {
            var img = el.querySelector('img') || el.appendChild(document.createElement('img'));
            img.alt = '';
            try { img.src = map.getCanvas().toDataURL('image/jpeg', 0.82); } catch (_) { /* keep the last picture */ }
          }
          if (mini.map === map) mini.map = null;
          map.remove();
          box.remove();
        };
        var giveUp = setTimeout(function () { if (mini.map === map) finish(false); }, 15000);
        map.on('load', function () {
          (map.getStyle().layers || []).forEach(function (layer) {
            if (/^poi|housenumber/.test(layer.id) || layer.type === 'fill-extrusion') map.setLayoutProperty(layer.id, 'visibility', 'none');
          });
          map.addSource('line', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} } });
          map.addLayer({ id: 'line', type: 'line', source: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 3 } });
          map.addSource('stops', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: stops }, properties: {} } });
          map.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 2 } });
          map.once('idle', function () {
            clearTimeout(giveUp);
            if (mini.map === map) finish(true);
          });
        });
      }).catch(function () { /* the page works without the picture */ });
    }

    /* ---------- the page before Go ---------- */
    var idle = {
      stops: $('drv-fact-stops'), students: $('drv-fact-students'), distance: $('drv-fact-distance'), time: $('drv-fact-time'),
      list: $('drv-stops-list'), count: $('drv-stops-count'), select: $('drv-route-select'), start: $('drv-start'), note: $('drv-note'),
      live: $('drv-live'), end: $('drv-end-page')
    };
    function renderIdle() {
      if (!idle.stops) return;
      idle.stops.textContent = st.stops.length;
      renderIdleCounts();
      idle.distance.textContent = '–';
      idle.time.textContent = '–';
      if (idle.count) idle.count.textContent = st.stops.length;
    }
    function renderIdleCounts() {
      if (!idle.stops) return;
      idle.students.textContent = ridersOnRoute().filter(function (s) { return !s.notRiding; }).length;
      renderStudents();
      if (idle.list) {
        idle.list.innerHTML = st.stops.map(function (s) {
          var count = studentsAt(s.id).length;
          return '<li><span class="drv-num">' + (s.seq + 1) + '</span><div><strong>' + esc(s.name) + '</strong><span class="drv-sub">' + count + ' student' + (count === 1 ? '' : 's') + '</span></div></li>';
        }).join('') + (st.dest ? '<li><span class="drv-num"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M5 21V9l7-5 7 5v12h-5v-6h-4v6H5z"/></svg></span><div><strong>' + esc(st.dest.label) + '</strong><span class="drv-sub">Final stop</span></div></li>' : '');
      }
    }
    var studentTab = 'yes';
    function renderStudents() {
      var list = $('drv-students-list');
      if (!list) return;
      var yes = ridersOnRoute(), no = notPickingUp();
      $('drv-count-yes').textContent = yes.length;
      $('drv-count-no').textContent = no.length;
      var shown = studentTab === 'yes' ? yes : no;
      var searchBox = $('drv-students-search');
      var wanted = searchBox ? searchBox.value.trim().toLowerCase() : '';
      if (wanted) {
        shown = shown.filter(function (student) { return student.name.toLowerCase().indexOf(wanted) >= 0; });
        if (!shown.length) { list.innerHTML = '<li class="drv-none">No student matches.</li>'; return; }
      }
      if (!shown.length) {
        list.innerHTML = '<li class="drv-none">' + (studentTab === 'yes' ? 'No riders on this route yet.' : 'Everyone you see has bus access.') + '</li>';
        return;
      }
      list.innerHTML = shown.map(function (student) {
        var parts = studentTab === 'yes'
          ? [student.notRiding ? 'Not coming today' : '', student.stopName, student.className]
          : [student.className, student.otherBus ? 'Another bus or route' : 'No bus access'];
        var extra = (student.address ? '<span class="drv-sub">' + esc(student.address) + '</span>' : '')
          + (student.parentPhone ? '<a class="drv-phone" href="tel:' + esc(student.parentPhone) + '">Parent: ' + esc(student.parentPhone) + '</a>' : '');
        return '<li><div><strong>' + esc(student.name) + '</strong><span class="drv-sub">' + esc(parts.filter(Boolean).join(' · ')) + '</span>' + extra + '</div></li>';
      }).join('');
    }
    document.querySelectorAll('[data-student-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        studentTab = tab.getAttribute('data-student-tab');
        document.querySelectorAll('[data-student-tab]').forEach(function (other) {
          other.classList.toggle('is-on', other === tab);
          other.setAttribute('aria-selected', String(other === tab));
        });
        renderStudents();
      });
    });
    if ($('drv-students-search')) $('drv-students-search').addEventListener('input', renderStudents);
    function renderIdleTotals(data) {
      if (!idle.distance) return;
      idle.distance.textContent = data ? fmtDistance(data.distanceM) : '–';
      idle.time.textContent = data ? fmtMin((data.durationS + st.stops.length * DWELL_S) / 60) : '–';
    }
    function showIdleNote(message, good) { if (!idle.note) return; idle.note.textContent = message; idle.note.classList.toggle('is-good', Boolean(good)); idle.note.hidden = false; }

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
      +   '<button type="button" class="drvn-chip" id="drvn-chip" aria-expanded="false" aria-controls="drvn-more"></button>'
      + '</div>'
      + '<div class="drvn-tools">'
      +   '<button type="button" class="drvn-tool" id="drvn-minimize" aria-label="Minimize the map" title="Minimize">' + toolSvg(TOOL.minimize) + '</button>'
      +   '<button type="button" class="drvn-tool" id="drvn-compass" aria-label="Turn the map" title="Direction of travel or north"><span id="drvn-compass-needle" style="display:flex">' + toolSvg(TOOL.compass) + '</span></button>'
      +   '<button type="button" class="drvn-tool" id="drvn-overview" aria-label="Show the whole route" title="Whole route">' + toolSvg(TOOL.overview) + '</button>'
      +   '<div class="drvn-zoom"><button type="button" class="drvn-tool" id="drvn-zoom-in" aria-label="Zoom in">' + toolSvg(TOOL.plus) + '</button><button type="button" class="drvn-tool" id="drvn-zoom-out" aria-label="Zoom out">' + toolSvg(TOOL.minus) + '</button></div>'
      + '</div>'
      + '<button type="button" class="drvn-recenter" id="drvn-recenter" hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>Re-center</button>'
      + '<p class="drvn-toast" id="drvn-toast" role="status" hidden></p>'
      + '<div class="drvn-board" id="drvn-board" hidden><div class="drvn-board__head"><strong id="drvn-board-stop"></strong><small id="drvn-board-count"></small></div><div class="drvn-picks" id="drvn-board-list" hidden></div><div class="drvn-confirm__btns"><button type="button" class="drvn-plain drvn-plain--yes" id="drvn-board-all">All boarded</button><button type="button" class="drvn-plain drvn-plain--no" id="drvn-board-except">Except</button></div></div>'
      + '<section class="drvn-sheet" id="drvn-sheet" aria-label="Trip">'
      +   '<button type="button" class="drvn-grab" id="drvn-grab" aria-label="Show stops" aria-expanded="false"><i></i></button>'
      +   '<div class="drvn-eta"><div class="drvn-eta__text"><strong class="drvn-eta__time" id="drvn-eta-time">–</strong><span class="drvn-eta__sub"><i class="drvn-dot" id="drvn-dot" aria-hidden="true"></i><span id="drvn-eta-sub">Finding GPS…</span></span></div>'
      +     '<div class="drvn-open"><button type="button" class="drvn-openbtn" id="drvn-open" aria-haspopup="menu" aria-expanded="false">Navigate<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>'
      +       '<div class="drvn-menu" id="drvn-menu" role="menu" hidden>' + (cfg.navApps || []).map(function (app) { return '<button type="button" role="menuitem" data-nav-app="' + esc(app.key) + '">' + esc(app.label) + '</button>'; }).join('') + '<p class="drvn-menu__note">Families see an estimate until you return.</p></div></div>'
      +     '<button type="button" class="drvn-end" id="drvn-end">End</button></div>'
      +   '<div class="drvn-confirm" id="drvn-confirm" hidden><div class="drvn-confirm__head"><p id="drvn-confirm-title"></p><small id="drvn-arrival-count"></small></div><input type="search" class="drvn-search" id="drvn-arrival-search" placeholder="Search students" autocomplete="off" aria-label="Search students" hidden /><div class="drvn-arrivals" id="drvn-arrivals" hidden></div><div class="drvn-confirm__btns drvn-confirm__main" id="drvn-arrive-answer"><button type="button" class="drvn-plain drvn-plain--yes" id="drvn-arrive-yes">Yes</button><button type="button" class="drvn-plain drvn-plain--no" id="drvn-arrive-no">No</button></div><button type="button" class="drvn-plain drvn-plain--danger drvn-endmain" id="drvn-end-yes" hidden>End trip</button><div class="drvn-confirm__btns drvn-confirm__minor"><button type="button" class="drvn-plain" id="drvn-except-back" hidden>Back</button><button type="button" class="drvn-plain" id="drvn-no-students">No students</button><button type="button" class="drvn-plain" id="drvn-keep">Keep driving</button></div></div>'
      +   '<div class="drvn-more" id="drvn-more" hidden>'
      +     '<div class="drvn-morehead"><strong id="drvn-route-name"></strong><button type="button" class="drvn-morex" id="drvn-more-close" aria-label="Close stops">' + toolSvg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></div>'
      +     '<input type="search" class="drvn-search" id="drvn-stops-search" placeholder="Find a stop or student" autocomplete="off" aria-label="Find a stop or student" />'
      +     '<div id="drvn-stops"></div>'
      +     '<form class="drvn-addstop" id="drvn-addstop" hidden><input id="drvn-addstop-input" maxlength="300" autocomplete="off" placeholder="Stop address" aria-label="Stop address" /><div class="drvn-confirm__btns"><button type="button" class="drvn-plain" id="drvn-addstop-here">Use my location</button><button type="submit" class="drvn-plain drvn-plain--go" id="drvn-addstop-save">Add stop</button></div></form>'
      +     '<div class="drvn-morebtns"><button type="button" class="drvn-plain" id="drvn-addstop-open">Add stop</button><button type="button" class="drvn-plain" data-drv-report>Report</button></div>'
      +   '</div>'
      + '</section>';
    document.body.appendChild(nav);
    // A box getting focus can scroll even a screen that doesn't scroll, and leave it moved.
    nav.addEventListener('scroll', function () { nav.scrollTop = 0; nav.scrollLeft = 0; });

    var ui = {
      turn: $('drvn-turn'), turnIcon: $('drvn-turn-icon'), turnDist: $('drvn-turn-dist'), turnWhat: $('drvn-turn-what'), chip: $('drvn-chip'),
      minimize: $('drvn-minimize'), compass: $('drvn-compass'), needle: $('drvn-compass-needle'), overview: $('drvn-overview'), recenter: $('drvn-recenter'), toast: $('drvn-toast'),
      sheet: $('drvn-sheet'), grab: $('drvn-grab'), etaTime: $('drvn-eta-time'), etaSub: $('drvn-eta-sub'), dot: $('drvn-dot'), open: $('drvn-open'), menu: $('drvn-menu'), end: $('drvn-end'), confirm: $('drvn-confirm'),
      keep: $('drvn-keep'), endYes: $('drvn-end-yes'), more: $('drvn-more'), routeName: $('drvn-route-name'), stops: $('drvn-stops'), msg: $('drvn-msg'),
      confirmTitle: $('drvn-confirm-title'), arrivals: $('drvn-arrivals'), board: $('drvn-board'), boardStop: $('drvn-board-stop'), boardCount: $('drvn-board-count'), boardList: $('drvn-board-list'), boardAll: $('drvn-board-all'), boardExcept: $('drvn-board-except'), addStop: $('drvn-addstop'), addStopInput: $('drvn-addstop-input')
    };

    // The panels follow the app's own look; the map itself stays the one clear map.
    function syncLook() {
      nav.setAttribute('data-theme', document.documentElement.getAttribute('data-appearance') === 'dark' ? 'night' : 'day');
    }
    // Always under the app's header, whatever its height on this screen.
    function fitUnderHeader() {
      var header = document.getElementById('top-header');
      nav.style.top = (header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0) + 'px';
    }
    function sheetHeight() { return ui.sheet.offsetHeight || 96; }
    function syncSheet() {
      ui.sheet.classList.toggle('is-checking', !ui.confirm.hidden);
      nav.style.setProperty('--n-sheet', (window.innerWidth >= 720 ? 10 : 0) + sheetHeight() + 'px');
      nav.classList.toggle('drvn--tall', sheetHeight() > nav.clientHeight * 0.4);
    }

    var CHIP_ARROW = '<svg class="drvn-chip__arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var toastTimer = 0;
    function toast(text, ms) {
      ui.toast.textContent = text;
      ui.toast.hidden = false;
      ui.toast.style.bottom = ui.board.hidden ? '' : (sheetHeight() + ui.board.offsetHeight + 22) + 'px';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { ui.toast.hidden = true; }, ms || 3500);
    }

    /* ---------- the map ---------- */
    function ensureMap() {
      if (st.map) return Promise.resolve();
      return loadEngine().then(function () {
        if (st.map || nav.hidden) return;
        var gl = window.maplibregl;
        if (gl.supported && !gl.supported()) throw new Error('no webgl');
        var start = st.pos || (cfg.lastLocation && point(cfg.lastLocation.latitude, cfg.lastLocation.longitude)) || st.stops[0] || st.dest || point(cfg.school && cfg.school.lat, cfg.school && cfg.school.lng);
        var map = st.map = new gl.Map({
          container: $('drvn-map'), style: STYLE_DAY, attributionControl: false, dragRotate: true, pitchWithRotate: false,
          center: start ? [start.lng, start.lat] : [0, 20], zoom: start ? 14 : 2, maxPitch: 0
        });
        map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new gl.ScaleControl({ unit: unit === 'mi' ? 'imperial' : 'metric', maxWidth: 90 }), 'bottom-left');
        map.on('style.load', function () { st.styleReady = true; addRouteLayers(); keepCreditsSmall(map, $('drvn-map')); });
        map.on('rotate', syncCompass);
        map.on('movestart', function (event) { if (event.originalEvent && driving()) setFollowing(false); });
        map.on('error', function () { /* a missing tile is not worth interrupting a driver */ });
        drawMarkers();
        if (st.pos) placeBus(st.pos, false, false);
        else if (cfg.lastLocation) { var last = point(cfg.lastLocation.latitude, cfg.lastLocation.longitude); if (last) placeBus(last, true, false); }
      }).catch(function () {
        ui.msg.hidden = false;
        ui.msg.textContent = 'The map could not load. Your trip is still running.';
      });
    }
    function addRouteLayers() {
      var map = st.map;
      if (!map || !st.styleReady) return;
      var layers = (map.getStyle().layers || []);
      layers.forEach(function (layer) {
        if (/^poi|housenumber/.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
        if (layer.type === 'fill-extrusion') map.setLayoutProperty(layer.id, 'visibility', 'none');
      });
      var beforeId = (layers.find(function (layer) { return layer.type === 'symbol'; }) || {}).id;
      var empty = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
      if (!map.getSource('drv-done')) map.addSource('drv-done', { type: 'geojson', data: empty });
      if (!map.getSource('drv-ahead')) map.addSource('drv-ahead', { type: 'geojson', data: empty });
      var lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
      map.addLayer({ id: 'drv-done', type: 'line', source: 'drv-done', layout: lineLayout, paint: { 'line-color': '#98a2b3', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 18, 10], 'line-opacity': .8 } }, beforeId);
      map.addLayer({ id: 'drv-casing', type: 'line', source: 'drv-ahead', layout: lineLayout, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 18, 16] } }, beforeId);
      map.addLayer({ id: 'drv-ahead', type: 'line', source: 'drv-ahead', layout: lineLayout, paint: { 'line-color': '#1a73e8', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 18, 11] } }, beforeId);
      drawLine(true);
    }
    function drawLine(force) {
      var map = st.map;
      if (!map || !st.styleReady || !map.getSource('drv-ahead')) return;
      var drawNow = Date.now();
      if (!force && drawNow - (st.lineDrawnAt || 0) < 3000) return;
      st.lineDrawnAt = drawNow;
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
        el.addEventListener('click', function (event) { event.stopPropagation(); showStop(s); });
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
    function closeStopCard() { if (st.stopCard) { st.stopCard.remove(); st.stopCard = null; } }
    function showStop(stop) {
      closeStopCard();
      var names = studentsAt(stop.id).map(function (student) { return student.name; });
      var shown = names.slice(0, 6).map(esc).join(', ') + (names.length > 6 ? ' +' + (names.length - 6) : '');
      st.stopCard = new window.maplibregl.Popup({ closeButton: false, offset: 20, maxWidth: '240px', className: 'drvn-stopcard' })
        .setLngLat([stop.lng, stop.lat])
        .setHTML('<strong>' + esc(stop.name) + '</strong><span>' + (names.length ? names.length + (names.length === 1 ? ' student: ' : ' students: ') + shown : 'No students') + '</span>')
        .addTo(st.map);
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
        el.innerHTML = '<svg viewBox="0 0 32 56" aria-hidden="true"><rect class="drvn-puck__body" x="3" y="2" width="26" height="52" rx="7" fill="#1a73e8" stroke="#fff" stroke-width="2.5"/><rect x="7.5" y="8" width="17" height="9" rx="2.5" fill="#dbeafe"/><rect x="7.5" y="42" width="17" height="6" rx="2" fill="#dbeafe" opacity=".75"/></svg>';
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
      return { top: Math.round(h * 0.3), bottom: sheetHeight() + 20, left: 0, right: 0 };
    }
    function follow(force) {
      if (!st.map || nav.hidden || !driving() || !st.pos || (!st.following && !force)) return;
      var now = Date.now();
      if (!force && now - st.cameraAt < 900) return;
      st.cameraAt = now;
      var kmh = (st.speed || 0) * 3.6;
      var at = st.shown || st.pos;
      st.map.easeTo({
        center: [at.lng, at.lat],
        zoom: kmh > 70 ? 15 : kmh > 40 ? 15.8 : 16.6,
        bearing: prefs.orientation === 'heading' && st.heading !== null ? st.heading : 0,
        padding: cameraPadding(),
        duration: force ? 800 : 1000,
        easing: force ? function (t) { return t * (2 - t); } : function (t) { return t; },
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
        for (var j = before + 1; j <= st.passed; j++) stopReached(st.stops[j]);
        drawMarkers();
        requestLine(true);
      }
    }
    // GPS wanders a few metres: while the bus is on its route, show it on the road and
    // point it the way the road goes.
    function roadPoint() {
      var p = busAlong();
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
      var onRoad = driving() ? roadPoint() : null;
      if (st.heading === null || (fix.speed !== null && fix.speed > 1.5)) st.heading = smoothHeading(st.heading, onRoad ? onRoad.bearing : fix.heading);
      fix.heading = st.heading;
      st.shown = onRoad ? onRoad.point : fix;
      placeBus(st.shown, false, !wasWaiting);
      if (!driving()) return;
      leftStop(fix);
      checkProgress();
      if (Date.now() - st.ridingAt > RIDING_EVERY_MS) refreshRiding();
      if (st.boardingOut.length && Date.now() - st.boardingAt > 15000) flushBoarding();
      var p = busAlong();
      if (wasWaiting) { requestLine(true); follow(true); }
      else if (!st.line || !p) {
        if (st.line && !st.offRoute) { st.offRoute = true; toast('Finding a new way…', 2000); }
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
    function updateStats() {
      if (nav.hidden) return;
      var rest = remaining(), target = rest[0] || st.dest, isDest = !rest[0];
      if (!target) {
        ui.turn.hidden = true; ui.chip.hidden = false;
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
      } else {
        ui.turn.hidden = true;
      }

      // Next stop
      var nearEnd = isDest && st.pos && st.dest && distM(st.pos, st.dest) <= ARRIVE_M;
      if (nearEnd && !st.arrivedSaid) { st.arrivedSaid = true; toast('You have arrived'); openEndCheck(); }
      ui.chip.hidden = false;
      if (isDest) {
        ui.chip.innerHTML = '<span class="drvn-chip__name">' + esc(nearEnd ? 'You have arrived' : st.dest.label) + '</span>' + CHIP_ARROW;
      } else {
        ui.chip.innerHTML = '<span class="drvn-chip__name">' + (target.seq + 1) + '/' + st.stops.length + ' ' + esc(target.name) + '</span><small>' + (toNext !== null ? esc(fmtDistance(toNext)) : '') + '</small>' + CHIP_ARROW;
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
      ui.routeName.textContent = st.route ? st.route.route_name : 'Stops';
      closeStopCard();
      var nextSeq = (remaining()[0] || {}).seq;
      var waited = 0;
      var row = function (s) {
        var done = s.seq <= st.passed;
        var names = stopLine(s);
        var eta = '';
        if (!done && proj && pace) {
          var along = alongOf(s.seq);
          if (along !== null) eta = fmtClock(Date.now() + (Math.max(0, along - proj.along) * pace + waited * DWELL_S) * 1000);
          waited += 1;
        }
        return '<li class="' + (done ? 'is-done' : (s.seq === nextSeq ? 'is-next' : '')) + '"><span class="drvn-num">' + (done ? '✓' : s.seq + 1) + '</span><div class="drvn-stop-text"><strong>' + esc(s.name) + '</strong>' + (names ? '<small>' + esc(names) + '</small>' : '') + '</div>'
          + (eta ? '<em>' + esc(eta) + '</em>' : '')
          + (s.seq === nextSeq ? (cfg.boarding ? '<button type="button" class="drvn-skip" data-here="' + s.seq + '">Here</button>' : '') + '<button type="button" class="drvn-skip" data-skip="' + s.seq + '">Skip</button>' : '')
          + (done && st.stopsDone[s.id] ? '<button type="button" class="drvn-skip" data-change="' + s.seq + '">Change</button>' : '')
          + '</li>';
      };
      var searchFor = ($('drvn-stops-search').value || '').trim().toLowerCase();
      var matches = function (s) {
        if (!searchFor) return true;
        return s.name.toLowerCase().indexOf(searchFor) >= 0 || studentsAt(s.id).some(function (r) { return r.name.toLowerCase().indexOf(searchFor) >= 0; });
      };
      var todo = st.stops.filter(function (s) { return s.seq > st.passed && matches(s); });
      var done = st.stops.filter(function (s) { return s.seq <= st.passed && matches(s); });
      ui.stops.innerHTML = '<p class="drvn-h">To go (' + todo.length + ')</p>'
        + (todo.length ? '<ol class="drvn-stops">' + todo.map(row).join('') + '</ol>' : '<p class="drvn-none">Every stop is covered.</p>')
        + '<p class="drvn-h">Covered (' + done.length + ')</p>'
        + (done.length ? '<ol class="drvn-stops">' + done.map(row).join('') + '</ol>' : '<p class="drvn-none">None yet.</p>');
      syncSheet();
    }
    // A stop for this trip only: it goes next, and the route is planned again.
    function extraKey() { return 'managira-trip-stops-' + st.tripId; }
    function saveExtras() {
      try { localStorage.setItem(extraKey(), JSON.stringify(st.stops.filter(function (s) { return s.extra; }).map(function (s) { return { name: s.name, lat: s.lat, lng: s.lng, seq: s.seq }; }))); } catch (_) { /* this device only */ }
    }
    function insertStop(stop, at) {
      st.stops.splice(at, 0, { lat: stop.lat, lng: stop.lng, name: stop.name, id: null, extra: true });
      st.stops.forEach(function (s, i) { s.seq = i; });
    }
    function addStop(name, lat, lng) {
      insertStop({ name: name, lat: lat, lng: lng }, st.passed + 1);
      saveExtras();
      ui.addStop.hidden = true;
      ui.addStopInput.value = '';
      drawMarkers();
      requestLine(true);
      renderStops();
      updateStats();
      toast('Stop added');
    }
    function restoreExtras() {
      try {
        JSON.parse(localStorage.getItem(extraKey()) || '[]').forEach(function (stop) { insertStop(stop, Math.min(stop.seq, st.stops.length)); });
      } catch (_) { /* nothing saved */ }
    }
    /* ---------- boarding at each stop ---------- */
    // The bus reaching a stop opens its card. One tap says all boarded, and driving off
    // says the same, so a busy driver never has to stop for it.
    function stopLine(stop) {
      var here = studentsAt(stop.id);
      var away = notComingAt(stop.id).map(function (student) { return student.name; });
      var line;
      if (st.stopsDone[stop.id]) {
        var missed = here.filter(function (student) { return st.boarded[student.id] === false; }).map(function (student) { return student.name; });
        var boarded = here.length - missed.length;
        line = boarded + ' boarded' + (missed.length ? ' · Didn’t board: ' + missed.join(', ') : '');
      } else {
        line = here.map(function (student) { return student.name; }).join(', ');
      }
      return line + (away.length ? (line ? ' · ' : '') + 'Not coming: ' + away.join(', ') : '');
    }
    // Everyone starts on Yes, so the driver only touches the ones who didn't.
    function pickRow(student, out) {
      return '<div class="drvn-pick' + (out ? ' is-out' : '') + '" data-pick="' + student.id + '"><span>' + esc(student.name) + '</span><div class="drvn-yn" role="group" aria-label="' + esc(student.name) + '">'
        + '<button type="button" class="drvn-yn__yes' + (out ? '' : ' is-on') + '" data-answer="yes" aria-pressed="' + !out + '">Yes</button>'
        + '<button type="button" class="drvn-yn__no' + (out ? ' is-on' : '') + '" data-answer="no" aria-pressed="' + Boolean(out) + '">No</button></div></div>';
    }
    function markRow(row, out) {
      row.classList.toggle('is-out', out);
      row.querySelectorAll('[data-answer]').forEach(function (button) {
        var on = (button.getAttribute('data-answer') === 'no') === out;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', String(on));
      });
    }
    function rowIsOut(row) { return row.classList.contains('is-out'); }
    function renderBoard() {
      var card = st.board;
      if (!card) { ui.board.hidden = true; return; }
      var picked = Object.keys(card.except).length;
      var away = notComingAt(card.stop.id).length;
      ui.boardStop.textContent = card.listOpen ? 'Who didn’t board?' : card.stop.name;
      ui.boardCount.textContent = card.listOpen
        ? (picked ? picked + ' didn’t board' : '')
        : card.riders.length + (card.riders.length === 1 ? ' student' : ' students') + (away ? ' · ' + away + ' not coming' : '');
      ui.boardAll.textContent = card.listOpen ? 'Done' : 'All boarded';
      ui.boardExcept.textContent = card.listOpen ? 'Back' : 'Except';
      ui.boardExcept.classList.toggle('drvn-plain--no', !card.listOpen);
      ui.boardList.hidden = !card.listOpen;
      if (card.listOpen && !ui.boardList.children.length) ui.boardList.innerHTML = card.riders.map(function (student) { return pickRow(student, card.except[student.id]); }).join('');
      if (!card.listOpen) ui.boardList.innerHTML = '';
      ui.board.hidden = false;
    }
    function openBoard(stop, riders, except) {
      st.board = { stop: stop, riders: riders, except: except, from: st.pos, listOpen: Object.keys(except).length > 0 };
      ui.boardList.innerHTML = '';
      renderBoard();
    }
    function settleBoarding(auto) {
      var card = st.board;
      if (!card) return;
      st.board = null;
      ui.board.hidden = true;
      st.stopsDone[card.stop.id] = true;
      var missed = [];
      card.riders.forEach(function (student) {
        var boarded = !card.except[student.id];
        st.boarded[student.id] = boarded;
        if (!boarded) missed.push(student.id);
      });
      st.boardingOut.push({
        tripId: st.tripId, stopId: card.stop.id, auto: Boolean(auto),
        studentIds: card.riders.map(function (student) { return student.id; }),
        notBoarded: missed, tries: 0
      });
      flushBoarding();
      toast(missed.length ? (card.riders.length - missed.length) + ' boarded, ' + missed.length + ' didn’t' : 'All boarded');
      if (!ui.more.hidden) renderStops();
    }
    // A weak connection never holds up the road: answers wait here and go when they can.
    function flushBoarding() {
      if (st.boardingBusy) return st.boardingBusy;
      var item = st.boardingOut[0];
      if (!item) return Promise.resolve();
      st.boardingAt = Date.now();
      item.tries += 1;
      var drop = function () { if (st.boardingOut[0] === item) st.boardingOut.shift(); };
      st.boardingBusy = postJson('/transportation/driver/trips/boarding', item).then(drop).catch(function () {
        if (item.tries >= 5) drop();
        else throw new Error('retry');
      }).then(function () {
        st.boardingBusy = null;
        return flushBoarding();
      }, function () {
        st.boardingBusy = null;
      });
      return st.boardingBusy;
    }
    function stopReached(stop) {
      if (!cfg.boarding) { toast('Arrived at ' + stop.name); return; }
      settleBoarding(true);
      var riders = stop.id ? studentsAt(stop.id) : [];
      if (!riders.length || st.stopsDone[stop.id]) { toast('Arrived at ' + stop.name); return; }
      openBoard(stop, riders, {});
      refreshRiding();
    }
    function leftStop(fix) {
      var card = st.board;
      if (!card || !card.from || fix.accuracy > LEAVE_STOP_M) return;
      if (distM(fix, card.from) > LEAVE_STOP_M) settleBoarding(true);
    }
    function localDay() {
      var d = new Date();
      var two = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
    }
    // A parent or teacher may change their mind at any time before the bus comes.
    function refreshRiding() {
      st.ridingAt = Date.now();
      if (!cfg.boarding) return Promise.resolve();
      return fetch('/transportation/driver/not-riding?date=' + localDay(), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (result) {
          if (!result || !result.success) return;
          var away = {};
          result.studentIds.forEach(function (id) { away[id] = true; });
          var changed = false, newlyAway = [];
          (cfg.students || []).forEach(function (student) {
            var now = Boolean(away[student.id]);
            if (now === Boolean(student.notRiding)) return;
            changed = true;
            student.notRiding = now;
            if (now && st.ridingKnown && student.hasAccess && st.stopsDone[student.stopId] !== true) newlyAway.push(student.name);
          });
          st.ridingKnown = true;
          if (!changed) return;
          if (newlyAway.length) toast(newlyAway.length === 1 ? newlyAway[0] + ' isn’t coming today' : newlyAway.length + ' students aren’t coming today');
          if (st.board) {
            st.board.riders = st.board.riders.filter(function (student) { return !student.notRiding; });
            if (st.board.riders.length) renderBoard();
            else { st.board = null; ui.board.hidden = true; }
          }
          renderIdleCounts();
          updateStats();
          if (!ui.more.hidden) renderStops();
        })
        .catch(function () { /* the next round tries again */ });
    }
    function seedBoarding() {
      st.boarded = {}; st.stopsDone = {};
      (cfg.tripBoardings || []).forEach(function (row) {
        st.boarded[row.studentId] = row.boarded;
        if (row.stopId) st.stopsDone[row.stopId] = true;
      });
      st.stops.forEach(function (stop) { if (st.stopsDone[stop.id]) st.passed = Math.max(st.passed, stop.seq); });
    }
    /* ---------- ending the trip ---------- */
    // Everyone on board arrived, unless the driver says otherwise.
    function onBoard() {
      return ridersOnRoute().filter(function (student) { return !student.notRiding && st.boarded[student.id] !== false; });
    }
    function openEndCheck() {
      if (!ui.confirm.hidden) return; // already open: answers stay as they are
      settleBoarding(true);
      setSheetOpen(false);
      closeMenu();
      st.skipArrivals = false;
      st.endExcept = false;
      $('drvn-arrival-search').value = '';
      st.endList = onBoard();
      ui.arrivals.innerHTML = '';
      ui.confirm.hidden = false;
      syncEndCheck();
    }
    // Only drawn when the driver says someone didn't arrive: most trips never need it.
    function drawArrivalRows() {
      if (ui.arrivals.firstChild) return;
      ui.arrivals.innerHTML = st.endList.map(function (student) {
        return '<div class="drvn-arrival" data-student="' + student.id + '" data-name="' + esc(student.name.toLowerCase()) + '">' + pickRow(student, false)
          + '<div class="drvn-arrival__why" hidden><select aria-label="Reason"><option value="">Reason</option><option value="absent">Absent today</option><option value="parent">Picked up by parent</option><option value="elsewhere">Got off elsewhere</option><option value="missed">Missed the bus</option><option value="other">Other</option></select></div></div>';
      }).join('');
      enhanceSelects(ui.arrivals);
    }
    function syncEndCheck() {
      var rows = st.endList.length;
      if (st.endExcept) drawArrivalRows();
      var out = ui.arrivals.querySelectorAll('.drvn-pick.is-out').length;
      ui.confirmTitle.textContent = !rows ? 'End this trip?' : (st.endExcept ? 'Who didn’t arrive?' : 'Did everyone arrive?');
      $('drvn-arrival-count').textContent = st.endExcept ? (out ? out + ' didn’t arrive' : '') : (rows ? rows + (rows === 1 ? ' student' : ' students') : '');
      ui.arrivals.hidden = !st.endExcept;
      $('drvn-arrival-search').hidden = !st.endExcept || rows < 9;
      $('drvn-arrive-answer').hidden = !rows || st.endExcept;
      ui.endYes.hidden = rows > 0 && !st.endExcept;
      $('drvn-except-back').hidden = !st.endExcept;
      $('drvn-no-students').hidden = !rows || st.endExcept;
      syncSheet();
    }
    function arrivalAnswers() {
      if (!ui.arrivals.firstChild) return st.endList.map(function (student) { return { studentId: Number(student.id), arrived: true, reason: null, note: null }; });
      return Array.prototype.map.call(ui.arrivals.querySelectorAll('.drvn-arrival'), function (row) {
        var out = rowIsOut(row.querySelector('.drvn-pick'));
        return { studentId: Number(row.getAttribute('data-student')), arrived: !out, reason: out ? (row.querySelector('select').value || 'other') : null, note: null };
      });
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
      if (st.gps !== st.gpsSaid) {
        st.gpsSaid = st.gps;
        if (st.gps === 'denied') { ui.msg.hidden = true; toast('Location is blocked. Allow it in Settings.', 5000); }
        else if (st.gps === 'unsupported') toast('This browser can’t share location.', 5000);
      }
    }
    function gpsHandlers() {
      return { tripId: st.tripId, onFix: onFix, onStatus: function (s) { var was = st.gps; st.gps = s.gps; st.sync = s.sync; if (was !== s.gps || s.gps !== 'denied') renderStatus(); } };
    }

    /* ---------- open and close ---------- */
    function enterNav(withoutMap) {
      nav.hidden = false;
      document.documentElement.classList.add('drv-navigating');
      window.scrollTo(0, 0);
      fitUnderHeader();
      syncLook();
      syncSheet();
      setFollowing(true);
      syncPage();
      nav.classList.toggle('drvn--nomap', Boolean(withoutMap));
      if (!withoutMap) showMap();
    }
    function showMap() {
      nav.classList.remove('drvn--nomap');
      if (st.map) return;
      ensureMap().then(function () {
        if (!st.map) return;
        st.map.resize();
        drawMarkers();
        updateStats();
        if (st.pos) follow(true); else frameRoute();
      });
    }
    // The trip keeps running and families keep seeing the bus; only the map is put away.
    function minimizeNav() {
      nav.hidden = true;
      document.documentElement.classList.remove('drv-navigating');
      closeMenu();
      ui.confirm.hidden = true;
      setSheetOpen(false);
      releaseMap();
      syncPage();
      scheduleMini();
    }
    // The big map is built again when it's opened: no hidden map using the phone's battery.
    function releaseMap() {
      if (st.glide) { cancelAnimationFrame(st.glide); st.glide = 0; }
      if (st.map) { try { st.map.remove(); } catch (_) { /* already gone */ } }
      st.map = null; st.bus = null; st.markers = []; st.styleReady = false; st.stopCard = null;
    }
    // The plain page shows whether a trip is running.
    function syncPage() {
      if (!idle.start) return;
      idle.start.querySelector('span').textContent = driving() ? 'Open map' : 'Go';
      if (idle.select) { idle.select.disabled = driving(); syncSelect(idle.select); }
      if (idle.live) idle.live.hidden = !driving();
      if (idle.end) idle.end.hidden = !driving();
    }
    function closeMenu() {
      ui.menu.hidden = true;
      ui.open.setAttribute('aria-expanded', 'false');
    }
    function leaveNav() {
      nav.hidden = true;
      document.documentElement.classList.remove('drv-navigating');
      closeMenu();
      ui.confirm.hidden = true;
      setSheetOpen(false);
      releaseMap();
      syncPage();
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
    function postJson(url, data) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(data)
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
      if (driving()) { enterNav(); return; }
      var routeId = selectedRouteId();
      if (!routeId || !cfg.bus) { showIdleNote('Choose your route first.'); return; }
      if (idle.note) idle.note.hidden = true;
      if (!window.DriverLocation) { showIdleNote('Location sharing could not load. Refresh the page and try again.'); return; }
      window.DriverLocation.start(gpsHandlers()); // inside the tap, so the phone asks for permission
      var label = idle.start.querySelector('span');
      st.boarded = {}; st.stopsDone = {}; st.boardingOut = [];
      idle.start.disabled = true;
      label.textContent = 'Starting…';
      setRoute(findRoute(routeId));
      enterNav();
      // The last trip's answers go first: starting closes whatever is still open.
      (st.ending ? sendEnd() : Promise.resolve()).then(function () {
        if (st.ending) throw new Error('No connection. Try again.');
        return post('/transportation/driver/trips/start', { routeId: routeId, busId: String(cfg.bus.bus_id) });
      }).then(function (result) {
        if (!result.trip) throw new Error('The trip could not start. Try again.');
        st.tripId = Number(result.trip.trip_id);
        window.DriverLocation.setTrip(st.tripId);
        if (st.pos) onFix(st.pos);
        requestLine(true);
        syncPage();
      }).catch(function (error) {
        if (!st.tripId) { window.DriverLocation.stop(); leaveNav(); }
        showIdleNote(error.message);
      }).then(function () {
        idle.start.disabled = false;
        label.textContent = driving() ? 'Open map' : 'Go';
      });
    }
    function endTrip() {
      if (!st.tripId) { leaveNav(); return; }
      settleBoarding(true);
      st.ending = {
        tripId: st.tripId, at: Date.now(),
        arrivals: st.skipArrivals ? [] : arrivalAnswers(),
        boardings: st.boardingOut.splice(0).map(function (item) {
          return { stopId: item.stopId, auto: item.auto, studentIds: item.studentIds, notBoarded: item.notBoarded };
        })
      };
      try {
        localStorage.setItem(END_KEY, JSON.stringify(st.ending));
        localStorage.removeItem('managira-trip-stops-' + st.tripId);
      } catch (_) { /* it still goes now */ }
      st.tripId = null;
      if (window.DriverLocation) { window.DriverLocation.setTrip(null); window.DriverLocation.stop(); }
      st.pos = null; st.speed = null; st.heading = null;
      st.boarded = {}; st.stopsDone = {};
      cfg.tripBoardings = [];
      leaveNav();
      setRoute(findRoute(selectedRouteId()));
      showIdleNote('Trip ended.', true);
      sendEnd();
    }
    // Safe to repeat: answers are saved once, and a trip already ended answers 404.
    function sendEnd() {
      var job = st.ending;
      if (!job) return Promise.resolve();
      if (st.endSending) return st.endSending;
      clearTimeout(st.endRetry);
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var limit = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
      st.endSending = fetch('/transportation/driver/trips/end', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: !job.tries, // finishes even if the phone leaves the page
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ tripId: job.tripId, arrivals: job.arrivals, boardings: job.boardings }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        if (!res.ok && res.status !== 404 && res.status !== 400) throw new Error('HTTP ' + res.status);
        st.ending = null;
        try { localStorage.removeItem(END_KEY); localStorage.setItem(ENDED_KEY, String(job.tripId)); } catch (_) { /* nothing saved */ }
        if (idle.note && /^Trip ended/.test(idle.note.textContent)) idle.note.textContent = 'Trip ended.';
      }).catch(function () {
        job.tries = (job.tries || 0) + 1;
        if (job.tries >= 2) showIdleNote('Trip ended. Saving when there’s signal.', true);
        st.endRetry = setTimeout(sendEnd, Math.min(30000, 2000 * Math.pow(2, job.tries - 1)));
      }).then(function () {
        clearTimeout(limit);
        st.endSending = null;
      });
      return st.endSending;
    }
    function openNavApp(app) {
      var pts = remaining().map(function (s) { return [s.lat, s.lng]; });
      if (st.dest) pts.push([st.dest.lat, st.dest.lng]);
      if (!pts.length) { toast('No stops left.'); return; }
      var dest = pts[pts.length - 1], via = pts.slice(0, -1), url;
      if (app === 'waze') url = 'https://waze.com/ul?ll=' + dest[0] + ',' + dest[1] + '&navigate=yes';
      else if (app === 'apple') url = 'https://maps.apple.com/?saddr=Current%20Location&daddr=' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join('+to:') + '&dirflg=d';
      else {
        url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=' + dest[0] + ',' + dest[1];
        if (via.length) url += '&waypoints=' + encodeURIComponent(via.slice(0, 9).map(function (p) { return p[0] + ',' + p[1]; }).join('|'));
      }
      var link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    function setSheetOpen(open) {
      ui.more.hidden = !open;
      ui.grab.setAttribute('aria-expanded', String(open));
      ui.chip.setAttribute('aria-expanded', String(open));
      if (!open) ui.addStop.hidden = true;
      if (open) { ui.confirm.hidden = true; renderStops(); }
      syncSheet();
    }

    /* ---------- report to the lead ---------- */
    /* ---------- dropdowns ---------- */
    // Drawn inside the form, so the list always opens right under its field. The real
    // <select> stays underneath and still holds the value.
    function enhanceSelects(root) {
      root.querySelectorAll('select:not([data-drvs])').forEach(function (select) {
        select.setAttribute('data-drvs', '');
        var wrap = document.createElement('div');
        wrap.className = 'drvs';
        wrap.innerHTML = '<button type="button" class="drvs__btn" aria-haspopup="listbox" aria-expanded="false"><span></span>' + toolSvg('<path d="m6 9 6 6 6-6"/>') + '</button><div class="drvs__list" role="listbox" hidden></div>';
        var name = select.getAttribute('aria-label');
        if (name) wrap.firstChild.setAttribute('aria-label', name);
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        syncSelect(select);
      });
    }
    function syncSelect(select) {
      var wrap = select.closest('.drvs');
      if (!wrap) return;
      var button = wrap.querySelector('.drvs__btn');
      var chosen = select.options[select.selectedIndex];
      button.querySelector('span').textContent = chosen ? chosen.textContent : '';
      button.classList.toggle('is-empty', !select.value);
      button.disabled = select.disabled;
    }
    function closeSelects() {
      document.querySelectorAll('.drvs.is-open').forEach(function (wrap) {
        wrap.classList.remove('is-open');
        wrap.querySelector('.drvs__btn').setAttribute('aria-expanded', 'false');
        wrap.querySelector('.drvs__list').hidden = true;
      });
    }
    function openSelect(wrap) {
      var select = wrap.querySelector('select');
      var list = wrap.querySelector('.drvs__list');
      list.innerHTML = Array.prototype.filter.call(select.options, function (option) { return option.value; }).map(function (option) {
        return '<button type="button" class="drvs__opt' + (option.selected ? ' is-on' : '') + '" role="option" aria-selected="' + option.selected + '" data-value="' + esc(option.value) + '">' + esc(option.textContent) + '</button>';
      }).join('');
      wrap.classList.add('is-open');
      wrap.querySelector('.drvs__btn').setAttribute('aria-expanded', 'true');
      list.hidden = false;
      list.scrollIntoView({ block: 'nearest' });
      (list.querySelector('.is-on') || list.firstChild || wrap.firstChild).focus({ preventScroll: true });
    }

    function openReport() {
      if (document.querySelector('.drvf')) return;
      var types = cfg.reportTypes || {};
      var typeOptions = Object.keys(types).map(function (key) { return '<option value="' + esc(key) + '">' + esc(types[key].label) + '</option>'; }).join('');
      var rowHtml = '<div class="drvf__row"><select name="category" aria-label="Type"><option value="">Type</option>' + typeOptions + '</select><select name="issue" aria-label="Issue" disabled><option value="">Issue</option></select><button type="button" class="drvf__remove" data-remove aria-label="Remove" hidden>' + toolSvg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></div>';
      var riders = ridersOnRoute();
      var everyone = riders.concat(notPickingUp());
      var box = document.createElement('div');
      box.className = 'drvf';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Send a report');
      box.innerHTML = '<form class="drvf__sheet" novalidate>'
        + '<div class="drvf__head"><div><h2>Send a report</h2><p>It goes to your lead.</p></div><button type="button" class="drvf__x" data-close aria-label="Close">' + toolSvg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></div>'
        + '<div class="drvf__body">'
        + '<p class="drvf__label">What is it about?</p><div data-rows>' + rowHtml + '</div>'
        + '<button type="button" class="drvf__add" data-add>Add another issue</button>'
        + '<div class="drvf__field" data-students hidden><p class="drvf__label">Students <span data-picked></span></p>'
        + '<input type="search" placeholder="Search students" autocomplete="off" aria-label="Search students" data-student-search />'
        + '<div class="drvf__picklist">' + everyone.map(function (student) {
            return '<label class="drvf__pick" data-name="' + esc(student.name.toLowerCase()) + '"><input type="checkbox" value="' + student.id + '" /><span>' + esc(student.name) + '</span><small>' + esc(student.className || '') + '</small></label>';
          }).join('') + '</div></div>'
        + '<div class="drvf__field"><span class="drvf__label">Priority</span><select name="priority" aria-label="Priority"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>'
        + '<label class="drvf__field"><span class="drvf__label">Details</span><textarea name="details" rows="3" maxlength="2000" placeholder="Anything your lead should know"></textarea></label>'
        + '<p class="drvf__error" role="alert" hidden></p>'
        + '</div><div class="drvf__foot"><button type="button" class="drvf__btn" data-close>Cancel</button><button type="submit" class="drvf__btn drvf__btn--go">Send</button></div></form>';
      document.body.appendChild(box);
      enhanceSelects(box);
      var form = box.querySelector('form');
      var rows = box.querySelector('[data-rows]');
      var error = box.querySelector('.drvf__error');
      var fail = function (text) { error.textContent = text; error.hidden = false; };
      var syncForm = function () {
        var list = rows.querySelectorAll('.drvf__row');
        list.forEach(function (row) { row.querySelector('[data-remove]').hidden = list.length < 2; });
        var aboutStudents = Array.prototype.some.call(rows.querySelectorAll('[name="category"]'), function (select) { return select.value === 'student'; });
        box.querySelector('[data-students]').hidden = !aboutStudents;
        var picked = box.querySelectorAll('.drvf__pick input:checked').length;
        box.querySelector('[data-picked]').textContent = picked ? '(' + picked + ' chosen)' : '';
      };
      box.addEventListener('click', function (event) {
        var target = event.target.closest ? event.target : null;
        if (!target) return;
        if (event.target === box || target.closest('[data-close]')) { box.remove(); return; }
        if (target.closest('[data-add]')) { rows.insertAdjacentHTML('beforeend', rowHtml); enhanceSelects(rows); syncForm(); return; }
        var remove = target.closest('[data-remove]');
        if (remove) { remove.closest('.drvf__row').remove(); syncForm(); }
      });
      form.addEventListener('change', function (event) {
        if (event.target.name === 'category') {
          // The second dropdown follows the first.
          var issue = event.target.closest('.drvf__row').querySelector('[name="issue"]');
          var type = types[event.target.value];
          issue.disabled = !type;
          issue.innerHTML = '<option value="">Issue</option>' + (type ? type.issues.map(function (label) { return '<option>' + esc(label) + '</option>'; }).join('') : '');
          if (type && type.issues.length === 1) issue.selectedIndex = 1;
          syncSelect(issue);
        }
        syncForm();
      });
      box.querySelector('[data-student-search]').addEventListener('input', function (event) {
        var wanted = event.target.value.trim().toLowerCase();
        box.querySelectorAll('.drvf__pick').forEach(function (pick) {
          pick.hidden = Boolean(wanted) && pick.getAttribute('data-name').indexOf(wanted) < 0;
        });
      });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        error.hidden = true;
        var issues = Array.prototype.map.call(rows.querySelectorAll('.drvf__row'), function (row) {
          return { category: row.querySelector('[name="category"]').value, issue: row.querySelector('[name="issue"]').value };
        });
        if (issues.some(function (row) { return !row.category || !row.issue; })) { fail('Choose a type and an issue for each line.'); return; }
        var studentIds = Array.prototype.map.call(box.querySelectorAll('.drvf__pick input:checked'), function (input) { return Number(input.value); });
        if (issues.some(function (row) { return row.category === 'student'; }) && !studentIds.length) { fail('Choose at least one student.'); return; }
        var send = form.querySelector('[type="submit"]');
        send.disabled = true;
        postJson('/transportation/driver/reports', { issues: issues, studentIds: studentIds, priority: form.elements.priority.value, details: form.elements.details.value }).then(function () {
          box.querySelector('.drvf__body').innerHTML = '<p class="drvf__done">Sent to your lead.</p>';
          box.querySelector('.drvf__foot').innerHTML = '<button type="button" class="drvf__btn drvf__btn--go" data-close>Done</button>';
        }).catch(function (err) { send.disabled = false; fail(err.message); });
      });
    }

    /* ---------- controls ---------- */
    if (idle.select) enhanceSelects(idle.select.parentNode);
    if (idle.select) idle.select.addEventListener('change', function () { syncSelect(idle.select); if (idle.note) idle.note.hidden = true; setRoute(findRoute(idle.select.value)); });
    if (idle.start) idle.start.addEventListener('click', go);
    ui.recenter.addEventListener('click', function () {
      setFollowing(true);
      if (st.pos) follow(true);
      else { frameRoute(); toast('Waiting for GPS.'); }
    });
    ui.boardAll.addEventListener('click', function () { settleBoarding(false); });
    ui.boardExcept.addEventListener('click', function () {
      var card = st.board;
      if (!card) return;
      card.listOpen = !card.listOpen;
      if (!card.listOpen) card.except = {};
      renderBoard();
    });
    ui.boardList.addEventListener('click', function (event) {
      var answer = event.target.closest('[data-answer]');
      if (!answer || !st.board) return;
      var row = answer.closest('[data-pick]');
      var id = row.getAttribute('data-pick');
      var out = answer.getAttribute('data-answer') === 'no';
      if (out) st.board.except[id] = true; else delete st.board.except[id];
      markRow(row, out);
      renderBoard();
    });
    ui.overview.addEventListener('click', function () { setFollowing(false); frameRoute(); });
    ui.grab.addEventListener('click', function () { setSheetOpen(ui.more.hidden); });
    ui.end.addEventListener('click', openEndCheck);
    ui.chip.addEventListener('click', function () { setSheetOpen(ui.more.hidden); });
    $('drvn-more-close').addEventListener('click', function () { setSheetOpen(false); });
    $('drvn-stops-search').addEventListener('input', function () { renderStops(); });
    $('drvn-addstop-open').addEventListener('click', function () {
      ui.addStop.hidden = !ui.addStop.hidden;
      syncSheet();
      if (!ui.addStop.hidden) ui.addStopInput.focus();
    });
    $('drvn-addstop-here').addEventListener('click', function () {
      var at = st.pos;
      if (!at) { toast('Waiting for GPS.'); return; }
      addStop(ui.addStopInput.value.trim() || 'Added stop', at.lat, at.lng);
    });
    ui.addStop.addEventListener('submit', function (event) {
      event.preventDefault();
      var address = ui.addStopInput.value.trim();
      if (!address) { toast('Enter the stop address.'); return; }
      var save = $('drvn-addstop-save');
      save.disabled = true;
      postJson('/transportation/driver/locate', { address: address }).then(function (place) {
        addStop(address, place.lat, place.lng);
      }).catch(function (error) { toast(error.message); }).then(function () { save.disabled = false; });
    });
    ui.arrivals.addEventListener('click', function (event) {
      var answer = event.target.closest('[data-answer]');
      if (!answer) return;
      var row = answer.closest('.drvn-arrival');
      var out = answer.getAttribute('data-answer') === 'no';
      markRow(row.querySelector('.drvn-pick'), out);
      row.querySelector('.drvn-arrival__why').hidden = !out;
      syncEndCheck();
    });
    $('drvn-arrive-yes').addEventListener('click', endTrip);
    $('drvn-arrive-no').addEventListener('click', function () {
      st.endExcept = true;
      syncEndCheck();
    });
    $('drvn-except-back').addEventListener('click', function () {
      st.endExcept = false;
      ui.arrivals.querySelectorAll('.drvn-arrival').forEach(function (row) {
        markRow(row.querySelector('.drvn-pick'), false);
        row.querySelector('.drvn-arrival__why').hidden = true;
      });
      syncEndCheck();
    });
    $('drvn-no-students').addEventListener('click', function () {
      st.skipArrivals = true;
      endTrip();
    });
    $('drvn-arrival-search').addEventListener('input', function (event) {
      var wanted = event.target.value.trim().toLowerCase();
      ui.arrivals.querySelectorAll('.drvn-arrival').forEach(function (row) {
        row.hidden = Boolean(wanted) && row.getAttribute('data-name').indexOf(wanted) < 0;
      });
    });
    document.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('[data-drv-report]')) openReport();
    });
    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target : null;
      var option = target && target.closest('.drvs__opt');
      if (option) {
        var holder = option.closest('.drvs');
        var select = holder.querySelector('select');
        select.value = option.getAttribute('data-value');
        syncSelect(select);
        closeSelects();
        holder.querySelector('.drvs__btn').focus();
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      var button = target && target.closest('.drvs__btn');
      var wrap = button && button.closest('.drvs');
      var wasOpen = wrap && wrap.classList.contains('is-open');
      closeSelects();
      if (wrap && !wasOpen) openSelect(wrap);
    });
    document.addEventListener('keydown', function (event) {
      var wrap = event.target.closest && event.target.closest('.drvs.is-open');
      if (!wrap) return;
      if (event.key === 'Escape') { event.stopPropagation(); closeSelects(); wrap.querySelector('.drvs__btn').focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      var options = Array.prototype.slice.call(wrap.querySelectorAll('.drvs__opt'));
      var at = options.indexOf(document.activeElement);
      var next = options[(at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length];
      if (next) next.focus();
    });
    ui.keep.addEventListener('click', function () { ui.confirm.hidden = true; syncSheet(); showMap(); });
    ui.endYes.addEventListener('click', endTrip);
    ui.minimize.addEventListener('click', minimizeNav);
    // No map to build just to say the trip is over.
    if (idle.end) idle.end.addEventListener('click', function () { enterNav(true); openEndCheck(); });
    window.addEventListener('online', sendEnd);
    function syncCompassMode() { ui.compass.setAttribute('aria-pressed', String(prefs.orientation === 'heading')); }
    syncCompassMode();
    ui.compass.addEventListener('click', function () {
      prefs.orientation = prefs.orientation === 'heading' ? 'north' : 'heading';
      savePrefs();
      syncCompassMode();
      toast(prefs.orientation === 'heading' ? 'Direction of travel' : 'North up', 1200);
      if (st.following && st.pos) follow(true);
      else if (st.map) st.map.easeTo({ bearing: prefs.orientation === 'heading' && st.heading !== null ? st.heading : 0, duration: 500 });
    });
    ui.open.addEventListener('click', function (event) {
      event.stopPropagation();
      ui.menu.hidden = !ui.menu.hidden;
      ui.open.setAttribute('aria-expanded', String(!ui.menu.hidden));
    });
    ui.menu.addEventListener('click', function (event) {
      var app = event.target.closest('[data-nav-app]');
      if (!app) return;
      closeMenu();
      openNavApp(app.getAttribute('data-nav-app'));
    });
    nav.addEventListener('click', function (event) {
      if (!ui.menu.hidden && !event.target.closest('.drvn-open')) closeMenu();
    });
    // Following would undo the zoom at the next GPS fix, so zooming stops it, as a pinch does.
    $('drvn-zoom-in').addEventListener('click', function () { if (!st.map) return; setFollowing(false); st.map.zoomIn(); });
    $('drvn-zoom-out').addEventListener('click', function () { if (!st.map) return; setFollowing(false); st.map.zoomOut(); });
    ui.more.addEventListener('click', function (event) {
      var skip = event.target.closest('[data-skip]');
      if (skip) {
        settleBoarding(true);
        st.passed = Number(skip.getAttribute('data-skip'));
        drawMarkers();
        requestLine(true);
        renderStops();
        return;
      }
      // For when GPS can't tell: the driver says the bus is at the stop.
      var here = event.target.closest('[data-here]');
      if (here) {
        var reached = st.stops[Number(here.getAttribute('data-here'))];
        st.passed = reached.seq;
        setSheetOpen(false);
        stopReached(reached);
        drawMarkers();
        requestLine(true);
        return;
      }
      var change = event.target.closest('[data-change]');
      if (change) {
        var stop = st.stops[Number(change.getAttribute('data-change'))];
        var except = {};
        settleBoarding(true);
        studentsAt(stop.id).forEach(function (student) { if (st.boarded[student.id] === false) except[student.id] = true; });
        setSheetOpen(false);
        openBoard(stop, studentsAt(stop.id), except);
        st.board.listOpen = true;
        renderBoard();
      }
    });
    window.addEventListener('resize', function () { if (!nav.hidden) { fitUnderHeader(); syncSheet(); if (st.map) st.map.resize(); } });

    /* ---------- begin ---------- */
    syncLook();
    var firstRoute = cfg.activeTrip ? findRoute(cfg.activeTrip.route_id) : (idle.select ? findRoute(idle.select.value) : routes[0] || null);
    setRoute(firstRoute);
    refreshRiding();
    syncPage();
    sendEnd();
    if (driving()) {
      seedBoarding();
      restoreExtras();
      enterNav();
      if (window.DriverLocation) window.DriverLocation.start(gpsHandlers());
    }
  }

  window.DriverNav = { mount: mount, describeStep: describeStep };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('spa:pageLoaded', mount);
})();
