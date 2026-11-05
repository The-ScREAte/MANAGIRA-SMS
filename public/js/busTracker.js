/*
 * Live bus tracker for families and students (public/js/busTracker.js)
 *
 * Open from any element:
 *   <button type="button" data-bus-tracker="123" data-bus-tracker-name="Ama"
 *           data-bus-tracker-unit="km" data-transport-snapshot="{...}">Track bus</button>
 * or from code: BusTracker.open(123, { name: 'Ama', snapshot: {...}, unit: 'mi' })
 *
 * Polls GET /transportation/live/student/:id every 5 s while open and visible.
 */
(function (window, document) {
  'use strict';

  if (window.BusTracker && window.BusTracker.version >= 2) return;

  var LIVE_URL = '/transportation/live/student/';
  var POLL_MS = 5000;
  var WEAK_MS = 45 * 1000;
  var OFFLINE_MS = 2 * 60 * 1000;
  var GLIDE_MS = 3500;
  var AT_STOP_M = 60;
  var ARRIVING_M = 250;
  var NEAR_M = 120;
  var PASSED_M = 250;
  var MIN_PLAN_MPS = 18 / 3.6;
  var MAX_PLAN_MPS = 60 / 3.6;
  var DWELL_S = 30;
  var ROUTE_BLUE = '#1a73e8';
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

  var ICON = {
    close: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    locate: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    bus: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 3h12a2 2 0 0 1 2 2v11a2 2 0 0 1-1 1.7V19a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1.3A2 2 0 0 1 4 16V5a2 2 0 0 1 2-2Zm0 3v5h12V6H6Zm1.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>',
    school: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3 2 8l10 5 8-4v6h2V8L12 3Zm-6 9.2V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.8l-6 3-6-3Z"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3 3 10.5V21h6v-6h6v6h6V10.5L12 3Z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 21V4h11l-1.5 3.5L16 11H7v10H5Z"/></svg>'
  };

  var CSS = [
    'html.trk-lock,html.trk-lock body{overflow:hidden}',
    '.trk-overlay{--trk-gap:60px;position:fixed;top:0;right:0;bottom:0;left:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:24px 24px calc(24px + var(--trk-gap));background:rgba(15,23,42,.48);color:#0f172a;font:inherit;line-height:1.4;text-align:left;-webkit-tap-highlight-color:transparent;animation:trk-fade .16s ease-out}',
    '.trk-overlay *,.trk-overlay *::before,.trk-overlay *::after{box-sizing:border-box}',
    '.trk-sheet{position:relative;display:flex;flex-direction:column;width:min(980px,100%);height:min(700px,100%);overflow:hidden;background:#fff;border-radius:16px;box-shadow:0 24px 64px rgba(15,23,42,.28)}',
    '.trk-head{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 20px;border-bottom:1px solid #e3e8ef}',
    '.trk-head-text{flex:1;min-width:0}',
    '.trk-overlay .trk-title{margin:0;font-size:1.05rem;font-weight:700;line-height:1.3;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.trk-overlay .trk-sub{margin:2px 0 0;font-size:.85rem;line-height:1.3;color:#5b6b7f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.trk-overlay button.trk-icon,.trk-overlay button.trk-tool{display:inline-flex;align-items:center;justify-content:center;flex:none;min-height:0;margin:0!important;padding:0!important;border:0;font:inherit;line-height:1;cursor:pointer;text-transform:none;letter-spacing:0}',
    '.trk-overlay button.trk-icon{width:40px!important;min-width:40px;height:40px;border-radius:999px;background:#f1f4f8;color:#0f172a;box-shadow:none}',
    '.trk-overlay button.trk-icon:hover{background:#e6ebf1}',
    '.trk-overlay button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}',
    '.trk-body{position:relative;flex:1;min-height:0;background:#e9eef3}',
    '.trk-map{position:absolute!important;top:0;right:0;bottom:0;left:0;z-index:0;background:#e9eef3}',
    '.trk-map-msg{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;margin:0;padding:24px;font-size:.92rem;color:#5b6b7f;text-align:center}',
    '.trk-status{position:absolute;z-index:600;top:12px;left:12px;display:flex;align-items:center;gap:10px;max-width:calc(100% - 84px);padding:10px 14px;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.08),0 6px 20px rgba(15,23,42,.14);pointer-events:none}',
    '.trk-status-text{min-width:0}',
    '.trk-status strong{display:block;font-size:.92rem;font-weight:700;line-height:1.25;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.trk-status small{display:block;margin-top:1px;font-size:.78rem;line-height:1.25;color:#5b6b7f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.trk-status small:empty{display:none}',
    '.trk-dot{position:relative;flex:none;width:10px;height:10px;border-radius:50%;background:#98a2b3}',
    '.trk-status[data-state="live"] .trk-dot{background:#12a150}',
    '.trk-status[data-state="live"] .trk-dot::after,.trk-status[data-state="arriving"] .trk-dot::after{content:"";position:absolute;top:0;right:0;bottom:0;left:0;border-radius:50%;background:inherit;animation:trk-ping 1.8s ease-out infinite}',
    '.trk-status[data-state="arriving"] .trk-dot,.trk-status[data-state="weak"] .trk-dot{background:#c27803}',
    '.trk-status[data-state="passed"] .trk-dot{background:#1a73e8}',
    '.trk-status[data-state="error"] .trk-dot{background:#d92d20}',
    '.trk-status[data-state="loading"] .trk-dot{background:#cbd5e1;animation:trk-blink 1s ease-in-out infinite}',
    '@keyframes trk-ping{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.8);opacity:0}}',
    '@keyframes trk-blink{50%{opacity:.35}}',
    '@keyframes trk-fade{from{opacity:0}to{opacity:1}}',
    '.trk-tools{position:absolute;z-index:600;top:12px;right:12px;display:flex;flex-direction:column;gap:10px}',
    '.trk-zoom{display:flex;flex-direction:column;overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.08),0 6px 20px rgba(15,23,42,.14)}',
    '.trk-overlay button.trk-tool{width:44px!important;min-width:44px;height:44px;border-radius:12px;background:#fff;color:#344054;box-shadow:0 1px 2px rgba(15,23,42,.08),0 6px 20px rgba(15,23,42,.14)}',
    '.trk-overlay .trk-zoom button.trk-tool{border-radius:0;box-shadow:none}',
    '.trk-overlay .trk-zoom button.trk-tool+button.trk-tool{border-top:1px solid #e3e8ef}',
    '.trk-overlay button.trk-tool:hover{background:#f6f8fb;color:#0f172a}',
    '.trk-overlay button.trk-tool[aria-pressed="true"]{color:#1a73e8}',
    '.trk-panel{position:relative;z-index:1;flex:none;padding:16px 20px 18px;background:#fff;border-top:1px solid #e3e8ef}',
    '.trk-eta{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;min-height:34px}',
    '.trk-eta-value{font-size:1.6rem;font-weight:800;line-height:1.1;letter-spacing:-.01em;color:#0f172a;font-variant-numeric:tabular-nums}',
    '.trk-eta-label{font-size:.92rem;color:#475467}',
    '.trk-overlay .trk-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 20px;margin:14px 0 0;padding:14px 0 0;border-top:1px solid #eef1f5}',
    '.trk-facts:empty{display:none}',
    '.trk-fact{min-width:0;margin:0}',
    '.trk-overlay .trk-fact dt{margin:0;font-size:.78rem;font-weight:600;color:#5b6b7f}',
    '.trk-overlay .trk-fact dd{margin:2px 0 0;font-size:.95rem;font-weight:600;color:#0f172a;overflow-wrap:anywhere}',
    '.trk-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.trk-body .leaflet-control-attribution{font-size:10px;background:rgba(255,255,255,.78)}',
    '.trk-bus{position:relative;width:38px;height:38px}',
    '.trk-bus-body{position:absolute;top:4px;right:4px;bottom:4px;left:4px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#1a73e8;color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.35)}',
    '.trk-bus-arrow{position:absolute;top:0;right:0;bottom:0;left:0;transform:rotate(var(--trk-h,0deg))}',
    '.trk-bus-arrow::before{content:"";position:absolute;left:50%;top:-4px;margin-left:-6px;border:6px solid transparent;border-top:0;border-bottom:9px solid #1a73e8}',
    '.trk-bus.is-stale .trk-bus-body{background:#98a2b3}',
    '.trk-bus.is-stale .trk-bus-arrow::before{border-bottom-color:#98a2b3}',
    '.trk-pin{position:relative;width:28px;height:36px}',
    '.trk-pin::before{content:"";position:absolute;left:2px;top:0;width:24px;height:24px;border-radius:50% 50% 50% 0;background:#d92d20;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(15,23,42,.35)}',
    '.trk-pin::after{content:"";position:absolute;left:10px;top:8px;width:8px;height:8px;border-radius:50%;background:#fff}',
    '.trk-badge{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#fff;color:#344054;border:2px solid #344054;box-shadow:0 2px 6px rgba(15,23,42,.25)}',
    '@media (max-width:640px){',
    '.trk-overlay{padding:0;align-items:stretch;justify-content:stretch}',
    '.trk-sheet{width:100%;height:100%;border-radius:0;box-shadow:none}',
    '.trk-head{padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px 16px}',
    '.trk-panel{margin-top:-16px;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px) + var(--trk-gap));border-top:0;border-radius:18px 18px 0 0;box-shadow:0 -6px 24px rgba(15,23,42,.1)}',
    '.trk-body .leaflet-bottom{bottom:16px}',
    '.trk-overlay .trk-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}',
    '.trk-eta-value{font-size:1.45rem}',
    '}',
    '@media (hover:none),(max-width:640px){.trk-zoom{display:none}}',
    '@media (prefers-reduced-motion:reduce){.trk-overlay,.trk-dot,.trk-dot::after{animation:none!important}}'
  ].join('\n');

  /* ---------------- Helpers ---------------- */

  var RAD = Math.PI / 180;

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  }

  function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toPoint(lat, lng) {
    var a = num(lat);
    var b = num(lng);
    if (a === null || b === null || a < -90 || a > 90 || b < -180 || b > 180 || (a === 0 && b === 0)) return null;
    return { lat: a, lng: b };
  }

  function parseTime(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isFinite(v.getTime()) ? v.getTime() : null;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }

  function distM(a, b) {
    var dLat = (b.lat - a.lat) * RAD;
    var dLng = (b.lng - a.lng) * RAD;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearing(a, b) {
    var y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
    var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
      Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function toLine(points) {
    var out = [];
    (points || []).forEach(function (p) {
      var q = Array.isArray(p) ? toPoint(p[0], p[1]) : (p ? toPoint(p.lat, p.lng !== undefined ? p.lng : p.lon) : null);
      if (q) out.push(q);
    });
    return out;
  }

  function measure(line) {
    var cum = [0];
    for (var i = 1; i < line.length; i++) cum.push(cum[i - 1] + distM(line[i - 1], line[i]));
    return cum;
  }

  function project(line, cum, p) {
    var best = null;
    var kx = Math.cos(p.lat * RAD) * 111320;
    var ky = 110540;
    for (var i = 1; i < line.length; i++) {
      var a = line[i - 1];
      var b = line[i];
      var ax = (a.lng - p.lng) * kx;
      var ay = (a.lat - p.lat) * ky;
      var dx = (b.lng - a.lng) * kx;
      var dy = (b.lat - a.lat) * ky;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var cx = ax + t * dx;
      var cy = ay + t * dy;
      var d = Math.sqrt(cx * cx + cy * cy);
      if (!best || d < best.offset) {
        best = {
          index: i,
          offset: d,
          along: cum[i - 1] + t * (cum[i] - cum[i - 1]),
          point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }
        };
      }
    }
    return best;
  }

  function round4(v) { return Math.round(v * 1e4) / 1e4; }

  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }

  function fmtDistance(m, unit) {
    if (!isFinite(m)) return '';
    if (unit === 'mi') {
      var mi = m / 1609.344;
      if (mi < 0.1) return Math.max(10, Math.round((m * 3.28084) / 10) * 10) + ' ft';
      return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
    }
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
    return (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + ' km';
  }

  function fmtMinutes(min) {
    if (!isFinite(min)) return '';
    var r = Math.max(1, Math.round(min));
    if (r < 60) return r + ' min';
    return Math.floor(r / 60) + ' h ' + (r % 60) + ' min';
  }

  function fmtAgo(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + ' s ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' h ago';
  }

  function fmtClock(t) {
    try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; }
  }

  function fmtLastSeen(t) {
    var d = new Date(t);
    if (!isFinite(d.getTime())) return '';
    if (d.toDateString() === new Date().toDateString()) return 'at ' + fmtClock(t);
    try { return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + fmtClock(t); } catch (_) { return ''; }
  }

  function fmtScheduleTime(v) {
    if (!v) return '';
    var m = /^(\d{1,2}):(\d{2})/.exec(String(v));
    if (!m) return String(v);
    var d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return fmtClock(d.getTime());
  }

  function possessive(name) { return name + (/s$/i.test(name) ? '\u2019' : '\u2019s'); }

  function mm(name) {
    var M = window.ManagiraMaps;
    return M && typeof M[name] === 'function' ? M[name].bind(M) : null;
  }

  function injectStyles() {
    if (document.getElementById('trk-styles')) return;
    var style = document.createElement('style');
    style.id = 'trk-styles';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  var leafletPromise = null;
  function loadLeaflet() {
    if (!document.querySelector('link[rel="stylesheet"][href*="leaflet"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      link.integrity = LEAFLET_CSS_SRI;
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    if (window.L && typeof window.L.map === 'function') return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.integrity = LEAFLET_JS_SRI;
      script.crossOrigin = '';
      script.async = true;
      script.onload = function () { if (window.L) resolve(window.L); else reject(new Error('Leaflet missing')); };
      script.onerror = function () { leafletPromise = null; reject(new Error('Leaflet failed to load')); };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  /* ---------------- Data (camelCase or snake_case) ---------------- */

  function normalizeLive(l) {
    if (!l || typeof l !== 'object') return null;
    var p = toPoint(pick(l, ['latitude', 'lat']), pick(l, ['longitude', 'lng', 'lon']));
    if (!p) return null;
    var status = String(pick(l, ['tripStatus', 'trip_status']) || '').toLowerCase();
    p.heading = num(pick(l, ['headingDeg', 'heading_deg', 'heading']));
    p.speedKmh = num(pick(l, ['speedKmh', 'speed_kmh']));
    p.recordedAt = parseTime(pick(l, ['recordedAt', 'recorded_at', 'updatedAt', 'updated_at']));
    p.busNumber = pick(l, ['busNumber', 'bus_number']) || '';
    p.active = !(l.active === false || l.isActive === false || l.tripActive === false || /ended|complete|cancel|finished/.test(status));
    return p;
  }

  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var bus = raw.bus || {};
    var route = raw.route || {};
    var stop = raw.stop || {};
    var school = raw.school || {};
    var live = normalizeLive(raw.live);

    var stops = [];
    var rawStops = Array.isArray(route.stops) ? route.stops : (Array.isArray(raw.routeStops) ? raw.routeStops : []);
    rawStops.forEach(function (s, i) {
      var p = s ? toPoint(pick(s, ['latitude', 'lat']), pick(s, ['longitude', 'lng', 'lon'])) : null;
      if (!p) return;
      p.name = pick(s, ['stopName', 'stop_name', 'name']) || 'Stop';
      var order = num(pick(s, ['stopOrder', 'stop_order', 'order']));
      p.order = order === null ? i : order;
      stops.push(p);
    });
    stops.sort(function (a, b) { return a.order - b.order; });

    var myStop = toPoint(pick(stop, ['latitude', 'lat']), pick(stop, ['longitude', 'lng', 'lon']));
    if (myStop) {
      myStop.name = pick(stop, ['stopName', 'stop_name', 'name']) || 'your stop';
      myStop.address = pick(stop, ['stopAddress', 'stop_address', 'address']) || '';
    }

    var schoolPt = toPoint(pick(school, ['latitude', 'lat']), pick(school, ['longitude', 'lng', 'lon']));
    if (schoolPt) schoolPt.address = pick(school, ['address', 'schoolAddress']) || '';

    var home = raw.home && typeof raw.home === 'object'
      ? toPoint(pick(raw.home, ['latitude', 'lat']), pick(raw.home, ['longitude', 'lng', 'lon']))
      : toPoint(pick(raw, ['homeLatitude', 'home_latitude']), pick(raw, ['homeLongitude', 'home_longitude']));

    var useSchool = route.useSchoolDestination !== undefined ? truthy(route.useSchoolDestination)
      : (route.use_school_destination !== undefined ? truthy(route.use_school_destination) : true);
    var custom = toPoint(pick(route, ['destinationLatitude', 'destination_latitude']), pick(route, ['destinationLongitude', 'destination_longitude']));
    var destination = null;
    if (custom && !useSchool) {
      destination = custom;
      destination.label = pick(route, ['destinationAddress', 'destination_address']) || 'Final stop';
      destination.custom = true;
    } else if (schoolPt) {
      destination = { lat: schoolPt.lat, lng: schoolPt.lng, label: 'School', custom: false };
    }

    var unit = String(pick(raw, ['distanceUnit', 'distance_unit']) || '').toLowerCase();

    return {
      busNumber: pick(bus, ['busNumber', 'bus_number']) || pick(raw, ['busNumber', 'bus_number']) || (live && live.busNumber) || '',
      routeName: pick(route, ['routeName', 'route_name']) || pick(raw, ['routeName', 'route_name']) || '',
      driverName: pick(raw, ['driverName', 'driver_name']) || '',
      pickupTime: pick(raw, ['pickupTime', 'pickup_time']) || pick(stop, ['pickupTime', 'pickup_time']) || '',
      dropoffTime: pick(raw, ['dropoffTime', 'dropoff_time']) || pick(stop, ['dropoffTime', 'dropoff_time']) || '',
      stop: myStop,
      home: home,
      school: schoolPt,
      destination: destination,
      stops: stops,
      live: live,
      unit: unit === 'mi' || unit === 'miles' ? 'mi' : (unit === 'km' ? 'km' : '')
    };
  }

  function merge(base, fresh) {
    var out = {};
    var k;
    base = base && typeof base === 'object' ? base : {};
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, k) && fresh[k] !== null && fresh[k] !== undefined) out[k] = fresh[k];
    }
    out.live = fresh.live || null;
    return out;
  }

  /* ---------------- Session ---------------- */

  var session = null;

  function open(studentId, options) {
    if (studentId === null || studentId === undefined || String(studentId).trim() === '') return;
    var opts = typeof options === 'string' ? { name: options } : (options || {});
    close();
    injectStyles();

    var s = session = {
      id: String(studentId).trim(),
      name: String(opts.name || '').trim(),
      unit: /^(mi|km)$/i.test(String(opts.unit || '')) ? String(opts.unit).toLowerCase() : '',
      raw: opts.snapshot && typeof opts.snapshot === 'object' ? opts.snapshot : null,
      returnFocus: document.activeElement,
      loaded: false, errors: 0, denied: false, clockOffset: 0,
      following: true, cameraAt: 0, frameMode: '',
      liveKey: '', liveChangedAt: 0, changesSeen: 0, lastFix: null, speedEma: null,
      minDist: Infinity, trend: [], awayTrend: false, passed: false,
      approach: null, approachPending: false, trip: null
    };
    s.data = normalize(s.raw);

    buildDom(s);
    document.body.appendChild(s.root);
    document.documentElement.classList.add('trk-lock');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVisibility);
    try { s.closeBtn.focus({ preventScroll: true }); } catch (_) { s.closeBtn.focus(); }

    refresh(s);
    loadLeaflet().then(function (L) {
      if (session === s) initMap(s, L);
    }).catch(function () {
      if (session !== s) return;
      var msg = document.createElement('p');
      msg.className = 'trk-map-msg';
      msg.textContent = 'The map could not load. Check your connection. Live status keeps updating below.';
      s.mapEl.appendChild(msg);
    });
    poll(s);
    s.ticker = window.setInterval(function () { tick(s); }, 1000);
  }

  function close() {
    var s = session;
    if (!s) return;
    session = null;
    clearTimeout(s.pollTimer);
    clearInterval(s.ticker);
    if (s.abort) { try { s.abort.abort(); } catch (_) { /* ignore */ } }
    if (s.glideFrame) cancelAnimationFrame(s.glideFrame);
    if (s.resizeObserver) s.resizeObserver.disconnect();
    if (s.map) { try { s.map.remove(); } catch (_) { /* ignore */ } }
    if (s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
    document.documentElement.classList.remove('trk-lock');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVisibility);
    if (s.returnFocus && typeof s.returnFocus.focus === 'function' && document.contains(s.returnFocus)) {
      try { s.returnFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
  }

  function onKey(e) {
    var s = session;
    if (!s) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.filter.call(
      s.root.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; }
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (!s.root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onVisibility() {
    var s = session;
    if (s && !document.hidden) poll(s);
  }

  function buildDom(s) {
    var root = document.createElement('div');
    root.className = 'trk-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'trk-title');
    root.innerHTML =
      '<div class="trk-sheet">' +
        '<header class="trk-head">' +
          '<div class="trk-head-text"><h2 class="trk-title" id="trk-title"></h2><p class="trk-sub"></p></div>' +
          '<button type="button" class="trk-icon" data-trk="close" aria-label="Close" data-ap-skip>' + ICON.close + '</button>' +
        '</header>' +
        '<div class="trk-body">' +
          '<div class="trk-map" role="region" aria-label="Map showing the bus and the stop"></div>' +
          '<div class="trk-status" data-state="loading"><span class="trk-dot" aria-hidden="true"></span><span class="trk-status-text"><strong></strong><small></small></span></div>' +
          '<div class="trk-tools">' +
            '<div class="trk-zoom">' +
              '<button type="button" class="trk-tool" data-trk="zoom-in" aria-label="Zoom in" data-ap-skip>' + ICON.plus + '</button>' +
              '<button type="button" class="trk-tool" data-trk="zoom-out" aria-label="Zoom out" data-ap-skip>' + ICON.minus + '</button>' +
            '</div>' +
            '<button type="button" class="trk-tool" data-trk="follow" aria-pressed="true" aria-label="Keep the bus in view" title="Keep the bus in view" data-ap-skip>' + ICON.locate + '</button>' +
          '</div>' +
          '<p class="trk-sr" aria-live="polite"></p>' +
        '</div>' +
        '<section class="trk-panel" aria-label="Trip details">' +
          '<div class="trk-eta"><strong class="trk-eta-value"></strong><span class="trk-eta-label"></span></div>' +
          '<dl class="trk-facts"></dl>' +
        '</section>' +
      '</div>';

    s.root = root;
    s.titleEl = root.querySelector('.trk-title');
    s.subEl = root.querySelector('.trk-sub');
    s.closeBtn = root.querySelector('[data-trk="close"]');
    s.mapEl = root.querySelector('.trk-map');
    s.statusEl = root.querySelector('.trk-status');
    s.statusTitle = s.statusEl.querySelector('strong');
    s.statusSmall = s.statusEl.querySelector('small');
    s.toolsEl = root.querySelector('.trk-tools');
    s.followBtn = root.querySelector('[data-trk="follow"]');
    s.srEl = root.querySelector('.trk-sr');
    s.etaValue = root.querySelector('.trk-eta-value');
    s.etaLabel = root.querySelector('.trk-eta-label');
    s.factsEl = root.querySelector('.trk-facts');

    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); return; }
      var btn = e.target.closest ? e.target.closest('[data-trk]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-trk');
      if (act === 'close') close();
      else if (act === 'zoom-in' && s.map) s.map.zoomIn();
      else if (act === 'zoom-out' && s.map) s.map.zoomOut();
      else if (act === 'follow') { setFollowing(s, true); frame(s, 'now'); }
    });
  }

  function renderText(s) {
    var d = s.data;
    setText(s.titleEl, s.name ? possessive(s.name) + ' bus' : 'Your bus');
    var sub = [d.busNumber ? 'Bus ' + d.busNumber : '', d.routeName].filter(Boolean).join(', ');
    setText(s.subEl, sub || 'Live bus tracking');

    var facts = [];
    if (d.stop) facts.push(['Stop', d.stop.name]);
    else if (d.home) facts.push(['Pick-up point', 'Home']);
    if (d.pickupTime) facts.push(['Pick-up', fmtScheduleTime(d.pickupTime)]);
    if (d.dropoffTime) facts.push(['Drop-off', fmtScheduleTime(d.dropoffTime)]);
    if (d.driverName) facts.push(['Driver', d.driverName]);
    var key = JSON.stringify(facts);
    if (key === s.factsKey) return;
    s.factsKey = key;
    s.factsEl.textContent = '';
    facts.forEach(function (f) {
      var wrap = document.createElement('div');
      wrap.className = 'trk-fact';
      var dt = document.createElement('dt');
      dt.textContent = f[0];
      var dd = document.createElement('dd');
      dd.textContent = f[1];
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      s.factsEl.appendChild(wrap);
    });
  }

  /* ---------------- Map ---------------- */

  function addTiles(map, L) {
    var custom = mm('addTiles');
    if (custom) { try { custom(map); return; } catch (_) { /* fall back */ } }
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
  }

  function busIcon(L, heading, stale, label) {
    var custom = mm('busIcon');
    if (custom) {
      try { var icon = custom({ heading: heading, label: label || 'Bus', stale: stale }); if (icon) return icon; } catch (_) { /* fall back */ }
    }
    var h = typeof heading === 'number' && isFinite(heading) ? Math.round(heading) : null;
    return L.divIcon({
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      html: '<div class="trk-bus' + (stale ? ' is-stale' : '') + '"' + (h === null ? '' : ' style="--trk-h:' + h + 'deg"') + '>' +
        (h === null ? '' : '<span class="trk-bus-arrow"></span>') + '<span class="trk-bus-body">' + ICON.bus + '</span></div>'
    });
  }

  function placeIcon(L, kind) {
    var custom = kind === 'stop' ? mm('stopIcon') : (kind === 'school' ? mm('schoolIcon') : null);
    if (custom) {
      try { var icon = kind === 'stop' ? custom('', { highlight: true }) : custom(); if (icon) return icon; } catch (_) { /* fall back */ }
    }
    if (kind === 'stop') return L.divIcon({ className: '', iconSize: [28, 36], iconAnchor: [14, 34], html: '<div class="trk-pin"></div>' });
    return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="trk-badge">' + (ICON[kind] || ICON.flag) + '</div>' });
  }

  function roadPoints(latlngs) {
    var fn = mm('roadPoints');
    if (!fn) return Promise.resolve(null);
    try {
      return Promise.resolve(fn(latlngs)).then(function (pts) {
        var line = toLine(pts);
        return line.length >= 2 ? line : null;
      }, function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function initMap(s, L) {
    var d = s.data;
    var start = d.live || d.stop || d.home || d.school || d.stops[0] || null;
    var map = L.map(s.mapEl, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120 });
    s.map = map;
    if (map.attributionControl) map.attributionControl.setPrefix(false);
    addTiles(map, L);
    map.createPane('trk-route').style.zIndex = 410;
    map.createPane('trk-approach').style.zIndex = 420;
    s.routeLayer = L.layerGroup().addTo(map);
    s.approachLayer = L.layerGroup().addTo(map);
    s.placesLayer = L.layerGroup().addTo(map);
    map.setView(start ? [start.lat, start.lng] : [20, 0], start ? 14 : 2);
    map.on('dragstart', function () { setFollowing(s, false); });
    map.on('zoomstart', function () { if (Date.now() - s.cameraAt > 700) setFollowing(s, false); });
    if (window.ResizeObserver) {
      s.resizeObserver = new ResizeObserver(function () { if (session === s && s.map) s.map.invalidateSize({ pan: false }); });
      s.resizeObserver.observe(s.mapEl);
    }
    requestAnimationFrame(function () {
      if (session !== s) return;
      map.invalidateSize();
      s.mapReady = true;
      refresh(s);
    });
  }

  function drawPlaces(s) {
    var L = window.L;
    var d = s.data;
    var key = JSON.stringify([
      d.stops.map(function (p) { return [p.lat, p.lng]; }),
      d.stop && [d.stop.lat, d.stop.lng], d.home && [d.home.lat, d.home.lng],
      d.school && [d.school.lat, d.school.lng], d.destination && [d.destination.lat, d.destination.lng]
    ]);
    if (key === s.placesKey) return;
    if (s.placesKey) s.approach = null;
    s.placesKey = key;
    s.placesLayer.clearLayers();

    d.stops.forEach(function (p) {
      if (d.stop && distM(p, d.stop) < 15) return;
      L.circleMarker([p.lat, p.lng], { radius: 5, weight: 2, color: '#667085', fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(esc(p.name), { direction: 'top', offset: [0, -4] })
        .addTo(s.placesLayer);
    });
    if (d.destination && d.destination.custom) {
      L.marker([d.destination.lat, d.destination.lng], { icon: placeIcon(L, 'flag'), keyboard: false })
        .bindTooltip(esc(d.destination.label), { direction: 'top', offset: [0, -14] }).addTo(s.placesLayer);
    }
    if (d.school) {
      L.marker([d.school.lat, d.school.lng], { icon: placeIcon(L, 'school'), keyboard: false })
        .bindTooltip('School', { direction: 'top', offset: [0, -14] }).addTo(s.placesLayer);
    }
    if (d.home) {
      L.marker([d.home.lat, d.home.lng], { icon: placeIcon(L, 'home'), keyboard: false })
        .bindTooltip('Home', { direction: 'top', offset: [0, -14] }).addTo(s.placesLayer);
    }
    if (d.stop) {
      L.marker([d.stop.lat, d.stop.lng], { icon: placeIcon(L, 'stop'), zIndexOffset: 500, keyboard: false })
        .bindTooltip(esc(d.stop.name), { direction: 'top', offset: [0, -30] }).addTo(s.placesLayer);
    }
  }

  function drawRoute(s) {
    var L = window.L;
    var d = s.data;
    var pts = d.stops.map(function (p) { return [p.lat, p.lng]; });
    if (d.destination && pts.length) pts.push([d.destination.lat, d.destination.lng]);
    var key = pts.map(function (p) { return p[0].toFixed(5) + ',' + p[1].toFixed(5); }).join('|');
    if (key === s.routeKey) return;
    s.routeKey = key;
    s.routeLayer.clearLayers();
    if (pts.length < 2) return;
    roadPoints(pts).then(function (line) {
      if (session !== s || s.routeKey !== key || !line) return;
      var ll = line.map(function (p) { return [p.lat, p.lng]; });
      L.polyline(ll, { pane: 'trk-route', color: '#fff', weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(s.routeLayer);
      L.polyline(ll, { pane: 'trk-route', color: '#8ab4f8', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(s.routeLayer);
    });
  }

  /* ---------------- Live position, progress and ETA ---------------- */

  function target(s) { return s.data.stop || s.data.home || null; }

  function nearestStopIndex(stops, p, within) {
    var best = -1;
    var bestD = within;
    for (var i = 0; i < stops.length; i++) {
      var dd = distM(stops[i], p);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  }

  function onNewFix(s, live) {
    var now = Date.now();
    var fix = { lat: live.lat, lng: live.lng, t: live.recordedAt || now, heading: live.heading };
    var prev = s.lastFix;
    if (prev) {
      var moved = distM(prev, fix);
      var dt = (fix.t - prev.t) / 1000;
      if (fix.heading === null) fix.heading = moved > 12 ? bearing(prev, fix) : prev.heading;
      var v = live.speedKmh !== null ? live.speedKmh / 3.6 : (dt >= 1 ? moved / dt : null);
      if (v !== null && isFinite(v) && v >= 0 && v < 45) s.speedEma = s.speedEma === null ? v : s.speedEma * 0.65 + v * 0.35;
    } else if (live.speedKmh !== null) {
      s.speedEma = live.speedKmh / 3.6;
    }
    s.lastFix = fix;
    s.changesSeen += 1;

    var t = target(s);
    if (t) {
      var dd = distM(fix, t);
      s.minDist = Math.min(s.minDist, dd);
      s.trend.push({ t: now, d: dd });
      s.trend = s.trend.filter(function (x) { return now - x.t <= 90000; });
      var low = Math.min.apply(null, s.trend.map(function (x) { return x.d; }));
      s.awayTrend = s.trend.length >= 3 && now - s.trend[0].t >= 20000 && dd - low > 150;
    }
  }

  function computeTrip(s) {
    var d = s.data;
    var now = Date.now();
    if (s.denied) return { state: 'denied' };
    if (!s.loaded && !d.live) return { state: s.errors ? 'error' : 'loading' };

    var live = d.live;
    var trip = { state: 'none', lastSeen: live && live.recordedAt ? live.recordedAt : null };
    if (live && live.active) {
      var key = (live.recordedAt || '') + '|' + live.lat.toFixed(6) + '|' + live.lng.toFixed(6);
      if (key !== s.liveKey) {
        s.liveKey = key;
        s.liveChangedAt = now;
        onNewFix(s, live);
      }
      var serverAge = live.recordedAt ? now + s.clockOffset - live.recordedAt : 0;
      var clientAge = now - s.liveChangedAt;
      var age = Math.max(0, serverAge);
      if (s.changesSeen >= 2 && clientAge < WEAK_MS) age = Math.min(age, clientAge);
      if (clientAge > WEAK_MS) age = Math.max(age, clientAge);
      trip.age = age;
      if (age <= OFFLINE_MS) {
        trip.state = age > WEAK_MS ? 'weak' : 'live';
        trip.bus = { lat: live.lat, lng: live.lng };
      }
    }
    if (!trip.bus) return trip;

    var t = target(s);
    if (!t) return trip;
    var straight = distM(trip.bus, t);
    trip.atStop = straight <= AT_STOP_M;
    trip.arriving = !trip.atStop && straight <= ARRIVING_M;

    if (straight <= NEAR_M) {
      s.passed = false;
    } else if (!s.passed) {
      var observed = s.minDist <= NEAR_M && straight >= s.minDist + PASSED_M;
      var myIdx = d.stop ? nearestStopIndex(d.stops, d.stop, 40) : -1;
      var busIdx = nearestStopIndex(d.stops, trip.bus, 150);
      var inferred = s.awayTrend && myIdx >= 0 && busIdx > myIdx;
      if (observed || inferred) s.passed = true;
    }
    trip.passed = s.passed;

    var remaining = null;
    var dwell = 0;
    var ap = s.approach;
    if (ap && ap.line) {
      var proj = project(ap.line, ap.cum, trip.bus);
      if (proj && proj.offset <= 120) {
        remaining = Math.max(0, ap.length - proj.along);
        dwell = ap.stopsAlong.filter(function (a) { return a > proj.along + 20; }).length;
      }
    }
    if (remaining === null) remaining = straight * 1.3;
    trip.remaining = remaining;
    var v = s.speedEma === null ? 25 / 3.6 : Math.max(MIN_PLAN_MPS, Math.min(MAX_PLAN_MPS, s.speedEma));
    trip.etaMin = (remaining / v + dwell * DWELL_S) / 60;
    return trip;
  }

  function moveBus(s, trip) {
    var L = window.L;
    if (!trip.bus) {
      if (s.busMarker) { s.busMarker.remove(); s.busMarker = null; s.busTarget = null; }
      return;
    }
    var heading = s.lastFix ? s.lastFix.heading : null;
    var stale = trip.state === 'weak';
    var label = s.data.busNumber || 'Bus';
    var iconKey = [heading === null || heading === undefined ? 'x' : Math.round(heading / 5) * 5, stale, label].join('|');
    if (!s.busMarker) {
      s.busMarker = L.marker([trip.bus.lat, trip.bus.lng], { icon: busIcon(L, heading, stale, label), zIndexOffset: 1000, keyboard: false })
        .bindTooltip('', { direction: 'top', offset: [0, -18] })
        .addTo(s.map);
      s.busIconKey = iconKey;
      s.busTarget = trip.bus;
      return;
    }
    if (iconKey !== s.busIconKey) {
      s.busMarker.setIcon(busIcon(L, heading, stale, label));
      s.busIconKey = iconKey;
    }
    if (s.busTarget && s.busTarget.lat === trip.bus.lat && s.busTarget.lng === trip.bus.lng) return;
    s.busTarget = trip.bus;
    glide(s, trip.bus);
  }

  function glide(s, to) {
    var marker = s.busMarker;
    var from = marker.getLatLng();
    if (s.glideFrame) cancelAnimationFrame(s.glideFrame);
    s.glideFrame = null;
    var dist = distM({ lat: from.lat, lng: from.lng }, to);
    if (dist < 1) return;
    if (dist > 1500 || document.hidden) { marker.setLatLng([to.lat, to.lng]); return; }
    var startAt = null;
    var step = function (now) {
      if (session !== s || s.busMarker !== marker) return;
      if (startAt === null) startAt = now;
      var k = Math.min(1, (now - startAt) / GLIDE_MS);
      marker.setLatLng([from.lat + (to.lat - from.lat) * k, from.lng + (to.lng - from.lng) * k]);
      s.glideFrame = k < 1 ? requestAnimationFrame(step) : null;
    };
    s.glideFrame = requestAnimationFrame(step);
  }

  function updateApproach(s, trip) {
    var L = window.L;
    var t = target(s);
    var show = trip.bus && t && !trip.passed && !trip.atStop;
    if (!show) {
      s.approachLayer.clearLayers();
      s.approachLines = null;
      return;
    }
    var ap = s.approach;
    var needFetch = !ap || (!ap.line && Date.now() - ap.at > 30000);
    if (ap && ap.line) {
      var proj = project(ap.line, ap.cum, trip.bus);
      if (proj && proj.offset <= 80) {
        var rest = [[proj.point.lat, proj.point.lng]].concat(ap.line.slice(proj.index).map(function (p) { return [p.lat, p.lng]; }));
        if (!s.approachLines) {
          s.approachLines = [
            L.polyline(rest, { pane: 'trk-approach', color: '#fff', weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(s.approachLayer),
            L.polyline(rest, { pane: 'trk-approach', color: ROUTE_BLUE, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(s.approachLayer)
          ];
        } else {
          s.approachLines[0].setLatLngs(rest);
          s.approachLines[1].setLatLngs(rest);
        }
      } else {
        needFetch = true;
      }
    }
    if (needFetch) fetchApproach(s, trip.bus, t);
  }

  function fetchApproach(s, from, to) {
    if (s.approachPending || (s.approach && Date.now() - s.approach.at < 8000)) return;
    s.approachPending = true;
    roadPoints([[round4(from.lat), round4(from.lng)], [to.lat, to.lng]]).then(function (line) {
      s.approachPending = false;
      if (session !== s) return;
      if (!line) { s.approach = { line: null, at: Date.now() }; return; }
      var cum = measure(line);
      var ap = { line: line, cum: cum, length: cum[cum.length - 1], at: Date.now(), stopsAlong: [] };
      s.data.stops.forEach(function (p) {
        if (distM(p, to) < 30) return;
        var pr = project(line, cum, p);
        if (pr && pr.offset < 50) ap.stopsAlong.push(pr.along);
      });
      s.approach = ap;
      refresh(s);
    });
  }

  function padding(s) {
    var top = (s.statusEl ? s.statusEl.offsetHeight : 48) + 28;
    var right = (s.toolsEl ? s.toolsEl.offsetWidth : 44) + 28;
    return { paddingTopLeft: [28, top], paddingBottomRight: [right, 36] };
  }

  function frame(s, mode) {
    if (!s.mapReady || !s.following) return;
    var L = window.L;
    var map = s.map;
    var d = s.data;
    var trip = s.trip || {};
    var t = target(s);
    var pts = [];
    var kind;
    if (trip.bus && !trip.passed) { kind = 'bus'; pts.push(trip.bus); if (t) pts.push(t); }
    else if (trip.bus) { kind = 'passed'; pts.push(trip.bus); if (d.destination) pts.push(d.destination); }
    else {
      kind = 'route';
      d.stops.forEach(function (p) { pts.push(p); });
      if (t) pts.push(t);
      if (d.school) pts.push(d.school);
    }
    if (!pts.length) return;
    if (kind !== s.frameMode) { mode = s.frameMode ? 'now' : 'init'; s.frameMode = kind; }

    var pad = padding(s);
    var size = map.getSize();
    var inside = pts.every(function (p) {
      var px = map.latLngToContainerPoint([p.lat, p.lng]);
      return px.x >= pad.paddingTopLeft[0] && px.x <= size.x - pad.paddingBottomRight[0] &&
        px.y >= pad.paddingTopLeft[1] && px.y <= size.y - pad.paddingBottomRight[1];
    });
    var bounds = L.latLngBounds(pts.map(function (p) { return [p.lat, p.lng]; }));
    var single = pts.length === 1 || bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 30;
    var wantZoom = single ? 16 : Math.min(16.5, map.getBoundsZoom(bounds, false, L.point(
      pad.paddingTopLeft[0] + pad.paddingBottomRight[0], pad.paddingTopLeft[1] + pad.paddingBottomRight[1])));
    if (mode === 'auto' && inside && Math.abs(wantZoom - map.getZoom()) < 0.75) return;

    s.cameraAt = Date.now();
    var animate = mode !== 'init';
    if (single) map.setView(bounds.getCenter(), wantZoom, { animate: animate });
    else map.fitBounds(bounds, { paddingTopLeft: pad.paddingTopLeft, paddingBottomRight: pad.paddingBottomRight, maxZoom: 16.5, animate: animate });
  }

  function setFollowing(s, on) {
    s.following = on;
    s.followBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ---------------- Text ---------------- */

  function describe(s, trip) {
    var where = s.data.stop ? 'your stop' : 'home';
    var updated = trip.age !== undefined ? 'Updated ' + fmtAgo(trip.age) : '';
    switch (trip.state) {
      case 'loading': return ['loading', 'Finding the bus\u2026', ''];
      case 'error': return ['error', 'Live tracking is unreachable', 'Retrying\u2026'];
      case 'denied': return ['error', 'Live tracking is unavailable', 'This account can\u2019t view this bus.'];
      case 'weak': return ['weak', 'Weak signal', 'Last update ' + fmtAgo(trip.age)];
      case 'live':
        if (trip.passed) return ['passed', 'Bus has passed ' + where, updated];
        if (trip.atStop) return ['arriving', 'Bus is at ' + where, updated];
        if (trip.arriving) return ['arriving', 'Arriving now', updated];
        return ['live', 'On the way', updated];
      default:
        return ['idle', 'Not on the road right now', trip.lastSeen && fmtLastSeen(trip.lastSeen)
          ? 'Last seen ' + fmtLastSeen(trip.lastSeen)
          : 'Tracking starts when the driver begins the trip.'];
    }
  }

  function panelEta(s, trip) {
    var d = s.data;
    var unit = s.unit || d.unit || 'km';
    var name = d.stop ? d.stop.name : (d.home ? 'home' : '');
    if (trip.bus) {
      if (!target(s)) return ['Live', 'The bus is on the map'];
      if (trip.passed) return ['Passed', 'The bus has left ' + name];
      if (trip.atStop) return ['Here', 'The bus is at ' + name];
      if (trip.arriving) return ['Arriving', 'at ' + name + ', ' + fmtDistance(trip.remaining, unit) + ' away'];
      var arrive = fmtClock(Date.now() + trip.etaMin * 60000);
      return [fmtMinutes(trip.etaMin), 'to ' + name + ', ' + fmtDistance(trip.remaining, unit) +
        (arrive ? ' (about ' + arrive + ')' : '') + (trip.state === 'weak' ? ', signal weak' : '')];
    }
    if (trip.state === 'loading') return ['', 'Loading the live position\u2026'];
    var planned = fmtScheduleTime(d.pickupTime);
    if (planned) return [planned, 'Scheduled pick-up' + (name ? ' at ' + name : '')];
    return ['No trip', 'The bus appears here when the driver starts the trip.'];
  }

  function updateText(s, trip) {
    var st = describe(s, trip);
    if (s.statusEl.getAttribute('data-state') !== st[0]) s.statusEl.setAttribute('data-state', st[0]);
    setText(s.statusTitle, st[1]);
    setText(s.statusSmall, s.errors >= 2 && trip.state !== 'error' ? 'Reconnecting\u2026' : st[2]);
    var eta = panelEta(s, trip);
    setText(s.etaValue, eta[0]);
    setText(s.etaLabel, eta[1]);
    if (st[1] !== s.announced) {
      s.announced = st[1];
      s.srEl.textContent = st[1] + (eta[0] ? '. ' + eta[0] + ' ' + eta[1] : '');
    }
    if (s.busMarker && s.busMarker.getTooltip()) {
      s.busMarker.setTooltipContent(esc((s.data.busNumber ? 'Bus ' + s.data.busNumber : 'Bus') + (trip.age !== undefined ? ', updated ' + fmtAgo(trip.age) : '')));
    }
  }

  function refresh(s) {
    if (session !== s) return;
    renderText(s);
    var trip = s.trip = computeTrip(s);
    updateText(s, trip);
    if (!s.mapReady) return;
    drawPlaces(s);
    drawRoute(s);
    moveBus(s, trip);
    updateApproach(s, trip);
    frame(s, 'auto');
  }

  function tick(s) {
    if (session !== s) return;
    var prev = s.trip || {};
    var trip = computeTrip(s);
    if (trip.state !== prev.state || Boolean(trip.passed) !== Boolean(prev.passed)) { refresh(s); return; }
    s.trip = trip;
    updateText(s, trip);
  }

  /* ---------------- Polling ---------------- */

  function applyPayload(s, payload) {
    if (payload && payload.success === false) {
      s.raw = merge(s.raw, { live: null });
    } else {
      var data = payload && payload.data !== undefined ? payload.data : payload;
      var fresh = data && typeof data === 'object' ? data : {};
      if (fresh.live === undefined && (fresh.latitude !== undefined || fresh.lat !== undefined)) fresh = { live: fresh };
      s.raw = merge(s.raw, fresh);
    }
    s.loaded = true;
    s.data = normalize(s.raw);
    refresh(s);
  }

  function poll(s) {
    if (session !== s) return;
    clearTimeout(s.pollTimer);
    if (s.inflight) return;
    if (document.hidden) { s.pollTimer = setTimeout(function () { poll(s); }, POLL_MS); return; }

    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    s.abort = ctrl;
    s.inflight = true;
    fetch(LIVE_URL + encodeURIComponent(s.id), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      var serverNow = Date.parse(res.headers.get('Date') || '');
      if (isFinite(serverNow)) s.clockOffset = serverNow + 500 - Date.now();
      if (res.status === 401 || res.status === 403) { var denied = new Error('denied'); denied.denied = true; throw denied; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (payload) {
      if (session !== s) return;
      s.errors = 0;
      s.denied = false;
      applyPayload(s, payload);
    }).catch(function (err) {
      if (session !== s) return;
      if (err && err.denied) s.denied = true;
      else s.errors += 1;
      refresh(s);
    }).then(function () {
      clearTimeout(timeout);
      if (session !== s) return;
      s.inflight = false;
      s.abort = null;
      var wait = s.denied ? 60000 : (s.errors ? Math.min(30000, POLL_MS * Math.pow(2, s.errors - 1)) : POLL_MS);
      s.pollTimer = setTimeout(function () { poll(s); }, wait);
    });
  }

  /* ---------------- Public API ---------------- */

  document.addEventListener('click', function (e) {
    var trigger = e.target && e.target.closest ? e.target.closest('[data-bus-tracker]') : null;
    if (!trigger || trigger.disabled) return;
    e.preventDefault();
    var snapshot = null;
    var raw = trigger.getAttribute('data-transport-snapshot');
    if (raw) { try { snapshot = JSON.parse(raw); } catch (_) { snapshot = null; } }
    open(trigger.getAttribute('data-bus-tracker'), {
      name: trigger.getAttribute('data-bus-tracker-name') || '',
      unit: trigger.getAttribute('data-bus-tracker-unit') || '',
      snapshot: snapshot
    });
  });

  window.BusTracker = {
    version: 2,
    open: open,
    close: close,
    isOpen: function () { return Boolean(session); }
  };
})(window, document);
