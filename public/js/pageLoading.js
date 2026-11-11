// One "this is loading" signal for every page: a bar across the top straight away, and a small
// spinner in the middle when the next page takes longer than a moment.
//
// It starts when a link or form leaves the page, and when the page-switcher (spa-router.js)
// fetches the next one; it stops when the next page shows. A script that sends the person
// somewhere itself calls ManagiraLoading.start(). Links that open elsewhere, files to
// download and forms a script handles are left alone, and it always gives up after a while,
// so it can never be left spinning.
(function () {
  'use strict';
  if (window.ManagiraLoading) return;

  var SPINNER_AFTER_MS = 350;   // quick pages never flash a spinner
  var GIVE_UP_AFTER_MS = 15000;
  var FILE = /\/(download|export|exports|print|pdf)(\/|$)|\.(pdf|csv|xlsx?|docx?|pptx?|zip|ics|png|jpe?g|webp|gif|svg)$/i;

  var active = false;
  var spinnerTimer = null;
  var giveUpTimer = null;

  function bar() {
    var el = document.getElementById('spa-progress');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'spa-progress';
      document.body.appendChild(el);
    }
    return el;
  }
  function chip() {
    var el = document.getElementById('page-loading');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'page-loading';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      var ring = document.createElement('span');
      ring.className = 'page-loading__ring';
      var text = document.createElement('span');
      text.className = 'page-loading__text';
      text.textContent = 'Loading…';
      el.appendChild(ring);
      el.appendChild(text);
      document.body.appendChild(el);
    }
    return el;
  }

  function start(options) {
    if (active) return;
    active = true;
    var top = bar();
    if (top) {
      top.style.width = '0%';
      top.classList.add('active');
      window.requestAnimationFrame(function () { top.style.width = '72%'; });
    }
    var wait = options && typeof options.spinnerAfter === 'number' ? options.spinnerAfter : SPINNER_AFTER_MS;
    spinnerTimer = window.setTimeout(function () {
      var el = chip();
      if (el) el.classList.add('show');
    }, wait);
    giveUpTimer = window.setTimeout(stop, GIVE_UP_AFTER_MS);
  }

  function stop() {
    if (!active) return;
    active = false;
    window.clearTimeout(spinnerTimer);
    window.clearTimeout(giveUpTimer);
    var top = document.getElementById('spa-progress');
    if (top && top.classList.contains('active')) {
      top.style.width = '100%';
      window.setTimeout(function () {
        if (active) return;
        top.classList.remove('active');
        top.style.width = '0%';
      }, 180);
    }
    var el = document.getElementById('page-loading');
    if (el) el.classList.remove('show');
  }

  window.ManagiraLoading = { start: start, stop: stop, isActive: function () { return active; } };

  // A link that leaves this page for another of ours.
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.hasAttribute('data-no-loading')) return;
    var target = String(link.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self' && target !== '_top' && target !== '_parent') return;
    var href = link.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|sms:|javascript:|blob:|data:)/i.test(href)) return;
    var url;
    try { url = new URL(href, window.location.href); } catch (_error) { return; }
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return; // the same page (an anchor)
    if (FILE.test(url.pathname)) return;
    start();
  });

  // A form that leaves this page (one a script sends has already been stopped by that script).
  document.addEventListener('submit', function (event) {
    if (event.defaultPrevented) return;
    var form = event.target;
    if (!form || !form.getAttribute || form.hasAttribute('data-no-loading')) return;
    var target = String(form.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self' && target !== '_top' && target !== '_parent') return;
    var action = form.getAttribute('action') || window.location.pathname;
    var path;
    try { path = new URL(action, window.location.href).pathname; } catch (_error) { path = ''; }
    if (FILE.test(path)) return;
    start();
  });

  // The next page is showing (also when the browser brings a page back from its memory).
  window.addEventListener('pageshow', stop);
  window.addEventListener('spa:pageLoaded', stop);
  // Coming back to a tab that was left mid-load: nothing is loading any more.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && active && document.readyState === 'complete') {
      window.setTimeout(function () { if (document.readyState === 'complete') stop(); }, 4000);
    }
  });
})();
