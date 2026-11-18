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

  function schedule(status) {
    clearTimeout(timer);
    if (!status) return;
    var left = [num(status.idleLeftMs), num(status.endsInMs)].filter(function (n) { return n !== null; });
    if (!left.length) return;
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
