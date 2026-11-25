/* When a sign-in times out, the open page goes to the login page at once (as long as it's
 * online), and the login page says "Your session timed out. Sign in again to continue."
 * (utils/sessionTimeout.js). Nobody has to refresh to find out.
 *
 * - Any request of the page (fetch or XHR, the page-switcher's too) that comes back signed out
 *   (the X-Managira-Signed-Out header, or sent on to a login page) takes the whole window there.
 * - The top window knows when its sign-in will end (data-idle-left / data-ends-in on this script)
 *   and asks /account/session-status then, which isn't activity: a page that was in use since is
 *   simply given its new time. Coming back to a hidden tab, after a sleep or back online, it asks
 *   straight away.
 */
(function () {
  'use strict';
  if (window.__managiraSessionWatch) return;
  window.__managiraSessionWatch = true;

  var script = document.currentScript;
  var STATUS = '/account/session-status';
  var LONGEST_WAIT_MS = 6 * 60 * 60 * 1000; // longer timers are checked again
  var LOGIN_PATH = /^\/(account\/(login|[a-z-]*-login)|hub\/login)\/?$/;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var isTop = (function () { try { return window.top === window.self; } catch (_) { return false; } })();

  function topWindow() {
    try { if (window.top.location.origin === window.location.origin) return window.top; } catch (_) {}
    return window;
  }

  var leaving = false;
  function go(reason, redirect) {
    if (leaving) return;
    leaving = true;
    window.__managiraSignedOut = true;
    var win = topWindow();
    try { win.__managiraSignedOut = true; } catch (_) {}
    var target = redirect && /^\/(account\/[a-z-]*login|hub\/login)(\?|$)/.test(redirect) ? redirect : '/account/login';
    try {
      var url = new URL(target, window.location.origin);
      if ((reason === 'idle' || reason === 'expired') && !url.searchParams.get('reason')) url.searchParams.set('reason', reason);
      // Back to this page once signed in again.
      if (url.searchParams.get('reason') && !LOGIN_PATH.test(win.location.pathname)) {
        url.searchParams.set('from', win.location.pathname + win.location.search);
      }
      target = url.pathname + url.search;
    } catch (_) {}
    try { win.location.replace(target); } catch (_) { window.location.replace(target); }
  }

  function samePlace(url) {
    try { return new URL(url, window.location.href).origin === window.location.origin; } catch (_) { return false; }
  }
  function pathOf(url) {
    try { return new URL(url, window.location.href).pathname; } catch (_) { return ''; }
  }

  function ask() {
    if (!nativeFetch) return Promise.resolve(null);
    return nativeFetch(STATUS, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  // A sign-out a request ran into. idle/expired come straight from the server's timeout;
  // anything else is confirmed first (a page may send someone to a login page for other reasons).
  function noticed(reason) {
    if (leaving) return;
    if (reason === 'idle' || reason === 'expired') { go(reason); return; }
    ask().then(function (status) {
      if (status && status.signedIn === false) go(status.reason, status.redirect);
    });
  }

  function inspect(requestUrl, responseUrl, header, redirected) {
    if (leaving || !samePlace(requestUrl)) return;
    var path = pathOf(requestUrl);
    if (path === STATUS || LOGIN_PATH.test(path)) return;
    if (header) { noticed(header); return; }
    if (redirected && responseUrl && samePlace(responseUrl) && LOGIN_PATH.test(pathOf(responseUrl))) {
      var reason = '';
      try { reason = new URL(responseUrl).searchParams.get('reason') || ''; } catch (_) {}
      noticed(reason);
    }
  }

  if (nativeFetch) {
    window.fetch = function (input, init) {
      var requestUrl = typeof input === 'string' ? input : (input && input.url) || String(input);
      return nativeFetch(input, init).then(function (res) {
        try { inspect(requestUrl, res.url, res.headers.get('X-Managira-Signed-Out'), res.redirected); } catch (_) {}
        return res;
      });
    };
  }

  if (window.XMLHttpRequest) {
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__mgUrl = url;
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      xhr.addEventListener('loadend', function () {
        try {
          var finalUrl = xhr.responseURL || '';
          var redirected = Boolean(finalUrl) && pathOf(finalUrl) !== pathOf(xhr.__mgUrl || '');
          inspect(xhr.__mgUrl || finalUrl, finalUrl, xhr.getResponseHeader('X-Managira-Signed-Out'), redirected);
        } catch (_) {}
      });
      return send.apply(this, arguments);
    };
  }

  // Only the top window keeps time; panels inside it share its sign-in.
  if (!isTop) return;

  function num(value) {
    var n = Number(value);
    return value === '' || value == null || !isFinite(n) ? null : n;
  }
  var timer = null;
  var lastCheck = 0;

  // ---- The warning two minutes before a sign-in ends (WCAG 2.2.1): stay signed in, or sign out. ----
  var WARN_MS = 2 * 60 * 1000;
  var warnTimer = null, countTimer = null, warnEl = null, warnReturn = null;
  function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function warnStyles() {
    if (document.getElementById('mg-sessionwarn-css')) return;
    var st = document.createElement('style');
    st.id = 'mg-sessionwarn-css';
    st.textContent = '.mg-sw{position:fixed;left:0;right:0;bottom:0;top:var(--mg-sw-top,0);z-index:13100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.38);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}'
      + '.mg-sw[hidden]{display:none}'
      + '.mg-sw__card{width:min(100%,380px);padding:22px 22px 18px;border-radius:18px;background:#fff;color:#0f172a;box-shadow:0 24px 60px rgba(15,23,42,.28)}'
      + '.mg-sw__card h2{margin:0 0 6px;font-size:1.1rem;font-weight:700;line-height:1.3}'
      + '.mg-sw__card p{margin:0 0 16px;color:#475569;font-size:.92rem;line-height:1.5}'
      + '.mg-sw__time{font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}'
      + '.mg-sw__row{display:flex;gap:10px}'
      + '.mg-sw__btn{flex:1;width:auto;height:42px;margin:0;padding:0 14px;border-radius:11px;font:inherit;font-size:.92rem;font-weight:700;cursor:pointer}'
      + '.mg-sw__btn--stay{border:0;background:var(--org-primary-color,#01535b);color:#fff}'
      + '.mg-sw__btn--out{border:1px solid #8a8a8a;background:#fff;color:#1f2937}'
      + 'html[data-appearance="dark"] .mg-sw__card{background:#111827;color:#f9fafb}'
      + 'html[data-appearance="dark"] .mg-sw__card p{color:#cbd5e1}html[data-appearance="dark"] .mg-sw__time{color:#f9fafb}'
      + 'html[data-appearance="dark"] .mg-sw__btn--out{background:#111827;color:#f9fafb}';
    document.head.appendChild(st);
  }
  function hideWarn() {
    clearInterval(countTimer);
    if (!warnEl) return;
    var back = warnReturn;
    warnEl.hidden = true;
    warnReturn = null;
    if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch (_) {} }
  }
  function showWarn(leftMs, canExtend) {
    if (leaving || !document.body) return;
    warnStyles();
    var deadline = Date.now() + leftMs;
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.className = 'mg-sw';
      warnEl.setAttribute('data-a11y-skip', '');
      warnEl.hidden = true;
      warnEl.innerHTML = '<div class="mg-sw__card" role="alertdialog" aria-modal="true" aria-labelledby="mg-sw-title" aria-describedby="mg-sw-text">'
        + '<h2 id="mg-sw-title">Still there?</h2>'
        + '<p id="mg-sw-text"></p>'
        + '<div class="mg-sw__row"><button type="button" class="mg-sw__btn mg-sw__btn--stay" data-sw-stay></button>'
        + '<button type="button" class="mg-sw__btn mg-sw__btn--out" data-sw-out>Sign out</button></div></div>';
      document.body.appendChild(warnEl);
      warnEl.addEventListener('click', function (e) {
        if (e.target.closest('[data-sw-out]')) { leaving = true; window.location.href = '/account/logout'; }
        else if (e.target.closest('[data-sw-stay]')) stay();
      });
      warnEl.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); stay(); return; }
        if (e.key !== 'Tab') return;
        var btns = warnEl.querySelectorAll('button');
        var first = btns[0], last = btns[btns.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
    warnEl.__canExtend = canExtend;
    var header = document.getElementById('top-header');
    warnEl.style.setProperty('--mg-sw-top', (header ? header.offsetHeight : 0) + 'px');
    var text = warnEl.querySelector('#mg-sw-text');
    var stayBtn = warnEl.querySelector('[data-sw-stay]');
    stayBtn.textContent = canExtend ? 'Stay signed in' : 'OK';
    function paint() {
      var rest = deadline - Date.now();
      if (rest <= 0) { clearInterval(countTimer); hideWarn(); check(); return; }
      var t = '<span class="mg-sw__time">' + fmt(rest) + '</span>';
      text.innerHTML = canExtend
        ? 'For your security you will be signed out in ' + t + ' because there has been no activity.'
        : 'Your sign-in ends in ' + t + ' at the time your school set. Save your work; you can sign in again afterwards.';
    }
    paint();
    if (warnEl.hidden) warnReturn = document.activeElement;
    warnEl.hidden = false;
    clearInterval(countTimer);
    countTimer = setInterval(paint, 1000);
    stayBtn.focus();
    if (window.a11yAnnounce) window.a11yAnnounce(canExtend ? 'You will be signed out in 2 minutes. Choose Stay signed in to continue.' : 'Your sign-in ends in 2 minutes.');
  }
  function stay() {
    if (!warnEl || !nativeFetch) { hideWarn(); return; }
    if (!warnEl.__canExtend) { hideWarn(); return; }
    nativeFetch('/account/session-extend', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function () { hideWarn(); check(); })
      .catch(function () { hideWarn(); check(); });
  }
  // Two minutes before the end: ask the server first (other tabs may have used the sign-in since).
  function warnCheck() {
    ask().then(function (status) {
      if (!status) return;
      if (status.signedIn === false) { go(status.reason, status.redirect); return; }
      var idle = num(status.idleLeftMs), ends = num(status.endsInMs);
      var least = Math.min(idle === null ? Infinity : idle, ends === null ? Infinity : ends);
      if (least === Infinity) return;
      if (least > WARN_MS + 3000) { schedule(status); return; }
      showWarn(least, idle !== null && (ends === null || idle <= ends));
    });
  }

  function schedule(status) {
    clearTimeout(timer);
    clearTimeout(warnTimer);
    if (!status) return;
    var left = [num(status.idleLeftMs), num(status.endsInMs)].filter(function (n) { return n !== null; });
    if (!left.length) return;
    var soonest = Math.max(Math.min.apply(null, left), 0);
    warnTimer = setTimeout(warnCheck, Math.max(soonest - WARN_MS, 0));
    // A second after the end: the server has then really signed them out.
    timer = setTimeout(check, Math.min(Math.max(Math.min.apply(null, left), 0) + 1000, LONGEST_WAIT_MS));
  }

  function check() {
    lastCheck = Date.now();
    ask().then(function (status) {
      if (!status) { clearTimeout(timer); timer = setTimeout(check, 60 * 1000); return; } // offline: again in a minute
      if (status.signedIn === false) { go(status.reason, status.redirect); return; }
      schedule(status);
    });
  }

  function soon() {
    if (leaving || Date.now() - lastCheck < 15 * 1000) return;
    check();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') soon(); });
  window.addEventListener('focus', soon);
  window.addEventListener('online', soon);
  window.addEventListener('pageshow', function (event) { if (event.persisted) check(); });

  // Others on the page (Mira's panel) can ask for a check now.
  window.ManagiraSession = { check: check };

  schedule({
    idleLeftMs: script ? script.getAttribute('data-idle-left') : null,
    endsInMs: script ? script.getAttribute('data-ends-in') : null
  });
})();
