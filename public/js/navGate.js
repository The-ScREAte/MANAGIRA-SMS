/**
 * Page "gate" for kept-alive menu pages (see public/js/spa-router.js, "parking").
 *
 * A menu page or class page that you leave is kept hidden in memory so coming back to it is instant.
 * While it is hidden it must be quiet: no timers firing, no window/document listeners reacting, no polling.
 * This script (loaded first, before any page script) wraps addEventListener on window and document and the
 * timer functions. Whatever the page's own scripts register is remembered against the page ("record") it
 * belongs to; while that record is parked the callbacks do nothing (listeners, interval ticks) or wait
 * (timeouts run when the page is shown again). Pages that never get parked behave exactly as before.
 *
 *  - The page the browser loaded first: its scripts sit inside <main>; they are recorded as `gate.boot`.
 *  - Pages the router swaps in: the router sets `gate.rec` while it runs their scripts.
 *  - Panels (iframes): the parent sets `window.__managiraParked` in the frame; timers wait the same way.
 *  - A timer started from inside a recorded callback belongs to the same record.
 */
(function () {
  'use strict';
  if (window.__managiraGate) return;
  var gate = window.__managiraGate = { rec: null, running: null, boot: null };
  var isTop = false;
  try { isTop = window.self === window.top; } catch (_e) { isTop = false; }
  if (isTop) gate.boot = { parked: false, dead: false, deferred: [], boot: true };

  function recFor() {
    if (gate.rec) return gate.rec;
    if (gate.running) return gate.running;
    if (gate.boot && document.readyState === 'loading') {
      var s = document.currentScript;
      if (s && s.closest && s.closest('main')) return gate.boot;
    }
    return null;
  }
  function quiet(rec) { return rec ? !!(rec.parked || rec.dead || rec.mute) : !!window.__managiraParked; }
  function dead(rec) { return !!(rec && rec.dead); }
  function later(rec, job) {
    if (rec) { rec.deferred = rec.deferred || []; if (rec.deferred.length < 500) rec.deferred.push(job); return; }
    var q = window.__managiraDeferred = window.__managiraDeferred || [];
    if (q.length < 500) q.push(job);
  }
  function run(rec, fn, self, args) {
    var prev = gate.running;
    gate.running = rec || prev;
    try { return fn.apply(self, args); } finally { gate.running = prev; }
  }
  gate.flush = function (rec) {
    var list;
    if (rec) { list = rec.deferred || []; rec.deferred = []; } else { list = window.__managiraDeferred || []; window.__managiraDeferred = []; }
    list.forEach(function (job) { try { job(); } catch (_e) { /* the page's own error */ } });
  };

  // Listeners on window and document: silent while their page is parked.
  [window, document].forEach(function (target) {
    var add = target.addEventListener;
    var remove = target.removeEventListener;
    var wrappers = new WeakMap(); // listener -> { "type|capture": wrapped }
    var capOf = function (o) { return (o === true || (o && typeof o === 'object' && o.capture)) ? '1' : '0'; };
    target.addEventListener = function (type, listener, options) {
      var rec = recFor();
      if (!rec || typeof listener !== 'function') return add.call(this, type, listener, options);
      var key = type + '|' + capOf(options);
      var map = wrappers.get(listener);
      if (!map) { map = {}; wrappers.set(listener, map); }
      if (map[key]) return add.call(this, type, map[key], options); // same listener added twice: the browser ignores the repeat
      var wrapped = function () { if (quiet(rec)) return undefined; return run(rec, listener, this, arguments); };
      map[key] = wrapped;
      return add.call(this, type, wrapped, options);
    };
    target.removeEventListener = function (type, listener, options) {
      var map = typeof listener === 'function' ? wrappers.get(listener) : null;
      var wrapped = map && map[type + '|' + capOf(options)];
      return remove.call(this, type, wrapped || listener, options);
    };
  });

  // Timers: an interval skips its ticks while parked; a timeout that comes due while parked waits for the page.
  var nativeTimeout = window.setTimeout;
  var nativeInterval = window.setInterval;
  window.setInterval = function (fn, ms) {
    if (typeof fn !== 'function') return nativeInterval.apply(window, arguments);
    var rec = recFor();
    var args = Array.prototype.slice.call(arguments, 2);
    return nativeInterval.call(window, function () {
      if (dead(rec) || quiet(rec)) return undefined;
      return run(rec, fn, this, args);
    }, ms);
  };
  window.setTimeout = function (fn, ms) {
    if (typeof fn !== 'function') return nativeTimeout.apply(window, arguments);
    var rec = recFor();
    var args = Array.prototype.slice.call(arguments, 2);
    var self = this;
    return nativeTimeout.call(window, function () {
      if (dead(rec)) return undefined;
      if (quiet(rec)) { later(rec, function () { run(rec, fn, self, args); }); return undefined; }
      return run(rec, fn, this, args);
    }, ms);
  };

  // A panel inside a parked page: the parent says so, and what was waiting runs when it comes back.
  window.addEventListener('managira:unparked', function () { if (!isTop) gate.flush(null); });
})();
