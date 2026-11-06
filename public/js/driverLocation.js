/*
 * Driver GPS engine (public/js/driverLocation.js)
 *   DriverLocation.start({ tripId, onFix, onStatus })
 *   DriverLocation.setTrip(tripId | null)
 *   DriverLocation.stop()
 * onStatus gets { gps: idle|starting|good|weak|denied|unsupported, sync: idle|ok|failing, keepAwake }
 */
(function (window, document, navigator) {
  'use strict';

  if (window.DriverLocation) return;

  var POST_URL = '/transportation/driver/live-location';
  var SEND_EVERY_MS = 5000;
  var PARKED_SEND_EVERY_MS = 15000;
  var PARKED_RADIUS_M = 12;
  var QUIET_MS = 10000;
  var MAX_SEND_AGE_MS = 45000;
  var GOOD_ACCURACY_M = 35;
  var POOR_ACCURACY_M = 100;
  var MAX_SPEED_MPS = 50;
  var WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
  var RAD = Math.PI / 180;

  var st = {
    running: false, watchId: null, timer: null, tripId: null, last: null,
    rejected: 0, refreshing: false, sending: false, sentAt: 0, failures: 0,
    wakeLock: null, wakePending: false, handlers: {}, gps: 'idle', sync: 'idle'
  };

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

  function finiteOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function call(name, arg) {
    var fn = st.handlers[name];
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (err) { if (window.console) window.console.error(err); }
  }

  function report() {
    call('onStatus', { gps: st.gps, sync: st.sync, keepAwake: Boolean(st.wakeLock), keepAwakeSupported: 'wakeLock' in navigator });
  }

  function setGps(v) { if (st.gps !== v) { st.gps = v; report(); } }
  function setSync(v) { if (st.sync !== v) { st.sync = v; report(); } }

  function onPosition(pos) {
    if (!st.running || !pos || !pos.coords) return;
    var c = pos.coords;
    var lat = Number(c.latitude);
    var lng = Number(c.longitude);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

    var now = Date.now();
    var fix = {
      lat: lat,
      lng: lng,
      accuracy: finiteOrNull(c.accuracy) !== null && c.accuracy > 0 ? c.accuracy : 999,
      speed: finiteOrNull(c.speed),
      heading: finiteOrNull(c.heading),
      time: finiteOrNull(pos.timestamp) !== null ? pos.timestamp : now,
      receivedAt: now
    };
    if (fix.speed !== null && fix.speed < 0) fix.speed = null;
    if (fix.heading !== null && fix.heading < 0) fix.heading = null;

    var prev = st.last;
    if (prev) {
      if (fix.time <= prev.time) {
        // GPS timestamps can stay fixed while parked; refresh receipt age to keep sharing.
        prev.receivedAt = now;
        return;
      }
      var dt = (fix.time - prev.time) / 1000;
      var moved = distM(prev, fix);
      var trusting = now - prev.receivedAt > 15000 || st.rejected >= 4;
      if (!trusting) {
        if (fix.accuracy > POOR_ACCURACY_M && prev.accuracy <= GOOD_ACCURACY_M) { st.rejected += 1; return; }
        if (dt > 0 && moved / dt > MAX_SPEED_MPS && moved > fix.accuracy + prev.accuracy) { st.rejected += 1; return; }
      }
      if (fix.speed === null && dt >= 1) fix.speed = moved / dt;
      var speed = fix.speed === null ? 0 : fix.speed;
      if (fix.heading === null || speed < 1.2) {
        fix.heading = moved >= Math.max(8, Math.min(fix.accuracy, 30)) ? bearing(prev, fix) : prev.heading;
      }
    }

    st.rejected = 0;
    st.last = fix;
    setGps(fix.accuracy > POOR_ACCURACY_M ? 'weak' : 'good');
    call('onFix', fix);
    if (st.tripId && dueToSend(fix, now)) send();
  }

  function onError(err) {
    st.refreshing = false;
    if (!st.running) return;
    if (err && err.code === 1) { setGps('denied'); return; }
    if (!st.last || Date.now() - st.last.receivedAt > QUIET_MS) setGps('weak');
  }

  function watch() {
    if (st.watchId !== null) { try { navigator.geolocation.clearWatch(st.watchId); } catch (_) { /* ignore */ } }
    st.watchId = navigator.geolocation.watchPosition(onPosition, onError, WATCH_OPTIONS);
  }

  function refreshFix() {
    if (!st.running || st.refreshing || st.gps === 'denied') return;
    st.refreshing = true;
    try {
      navigator.geolocation.getCurrentPosition(function (pos) {
        st.refreshing = false;
        onPosition(pos);
      }, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 9000 });
    } catch (_) {
      st.refreshing = false;
    }
  }

  function watchPermission() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return;
    navigator.permissions.query({ name: 'geolocation' }).then(function (perm) {
      var apply = function () {
        if (!st.running) return;
        if (perm.state === 'denied') setGps('denied');
        else if (perm.state === 'granted' && st.gps === 'denied') { setGps('starting'); watch(); }
      };
      perm.onchange = apply;
      apply();
    }).catch(function () { /* unsupported */ });
  }

  // Every 5 seconds on the move, every 15 while parked: families see no difference.
  function dueToSend(fix, now) {
    var moved = !st.sentFix || distM(st.sentFix, fix) > PARKED_RADIUS_M;
    return now - st.sentAt >= (moved ? SEND_EVERY_MS : PARKED_SEND_EVERY_MS) - 250;
  }

  function send() {
    if (!st.running || !st.tripId || st.sending) return;
    var fix = st.last;
    var now = Date.now();
    if (!fix || now - fix.receivedAt > MAX_SEND_AGE_MS) return;
    st.sending = true;
    st.sentAt = now;
    st.sentFix = fix;
    var body = new URLSearchParams();
    body.set('tripId', String(st.tripId));
    body.set('latitude', fix.lat.toFixed(7));
    body.set('longitude', fix.lng.toFixed(7));
    body.set('speedKmh', fix.speed !== null ? (fix.speed * 3.6).toFixed(1) : '');
    body.set('headingDeg', fix.heading !== null && fix.heading !== undefined ? String(Math.round(fix.heading) % 360) : '');
    fetch(POST_URL, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      st.failures = 0;
      setSync('ok');
    }).catch(function () {
      st.failures += 1;
      if (st.failures >= 2) setSync('failing');
    }).then(function () {
      st.sending = false;
    });
  }

  function onTick() {
    if (!st.running) return;
    var fix = st.last;
    var now = Date.now();
    if (!fix || now - fix.receivedAt > QUIET_MS) refreshFix();
    if (fix && now - fix.receivedAt > MAX_SEND_AGE_MS && st.gps === 'good') setGps('weak');
    if (fix && dueToSend(fix, now)) send();
  }

  function keepAwake() {
    if (!st.running || !st.tripId || st.wakeLock || st.wakePending) return;
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    st.wakePending = true;
    navigator.wakeLock.request('screen').then(function (lock) {
      st.wakePending = false;
      if (!st.running || !st.tripId) { lock.release().catch(function () {}); return; }
      st.wakeLock = lock;
      report();
      lock.addEventListener('release', function () { if (st.wakeLock === lock) { st.wakeLock = null; report(); } });
    }).catch(function () { st.wakePending = false; });
  }

  function releaseWake() {
    if (!st.wakeLock) return;
    var lock = st.wakeLock;
    st.wakeLock = null;
    lock.release().catch(function () {});
  }

  function onVisibility() {
    if (!st.running) return;
    if (document.visibilityState === 'visible') { keepAwake(); refreshFix(); }
    else send();
  }

  function start(options) {
    options = options || {};
    st.handlers = { onFix: options.onFix, onStatus: options.onStatus };
    if (options.tripId !== undefined) st.tripId = options.tripId || null;
    if (st.running) { report(); keepAwake(); return true; }
    if (!('geolocation' in navigator) || window.isSecureContext === false) {
      st.gps = 'unsupported';
      report();
      return false;
    }
    st.running = true;
    st.gps = 'starting';
    st.sync = 'idle';
    report();
    try { watch(); } catch (_) { st.running = false; setGps('unsupported'); return false; }
    watchPermission();
    st.timer = window.setInterval(onTick, SEND_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    keepAwake();
    return true;
  }

  function setTrip(tripId) {
    st.tripId = tripId || null;
    if (st.tripId) { keepAwake(); send(); }
    else { releaseWake(); setSync('idle'); }
  }

  function stop() {
    st.running = false;
    st.tripId = null;
    if (st.watchId !== null) { try { navigator.geolocation.clearWatch(st.watchId); } catch (_) { /* ignore */ } st.watchId = null; }
    if (st.timer) { window.clearInterval(st.timer); st.timer = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    releaseWake();
    st.last = null;
    st.rejected = 0;
    st.failures = 0;
    st.refreshing = false;
    st.gps = 'idle';
    st.sync = 'idle';
    report();
  }

  window.DriverLocation = {
    start: start,
    stop: stop,
    setTrip: setTrip,
    latest: function () { return st.last; },
    isRunning: function () { return st.running; }
  };
})(window, document, navigator);
