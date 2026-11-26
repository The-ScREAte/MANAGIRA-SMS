/**
 * Which links the in-app router (public/js/spa-router.js) takes over, and how a Back link resolves.
 * Pure functions, so tests/spaCoverage.test.js can check them under Node.
 *
 *  - Staff (organization), parents, students and drivers: every same-origin GET page is handled in-app
 *    unless it matches DENY (files, downloads, prints, payments, live trips, test taking, sign-in, charts).
 *    A page that turns out not to be a page of the app frame still falls back to a full load in the router.
 *  - Other kinds (hub, admin, public) keep their short list of pages.
 *  - A Back link (data-back) goes back in history when the page before this one is the page it points to,
 *    otherwise it opens its own address in-app.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ManagiraSpaRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BROAD_TYPES = ['organization', 'guardian', 'student', 'driver'];

  // Full loads on purpose: files, downloads, prints, money, live GPS trips, test taking, sign-in, charts, editors.
  var DENY = [
    /^\/account\/(logout|login|sso|student-login|guardian-login|personalization|managePublicContent)/,
    /^\/hub\/(login|logout)/, /^\/r\//, /^\/api\//, /^\/api-access\/token/, /^\/internal\//, /^\/uploads\//, /^\/static\//,
    /^\/admin\/(org\/|exit-org|profile)/,
    /^\/legal\/(?!help\/?$|faq\/?$)/, // documentation and policy pages have their own page, without the app frame
    /^\/stats\//, /^\/print\//, /^\/transcript\//, /^\/gov-report\//,
    /^\/student\/testing-room\/./,
    /^\/driver\/trip/, /^\/transportation\/(live|trip|navigation)/,
    /^\/common\/(addStudent|registerSchoolYear|createEmployee|modifyEmployee|createTest|publicDashboard|publicRegister)/,
    /(^|\/)(pdf|export|download|file|feed|sync|sync-status|resource|state-file|receipt|invoice|stripe-return|stripe-connect)(\/|$|\?)/,
    /\/(file|student-file|receipt|invoice)\/[^/?]+/, /\/stripe-/,
    /\.(pdf|csv|xlsx?|zip|ics|png|jpe?g|gif|svg|webp|mp4|docx?|txt)(\?|$)/i, /export\.csv/,
    /new=1/
  ];

  // Short lists for the kinds that are not made broad (set by the router from its own table).
  function isDenied(path) {
    var p = String(path || '').split('#')[0];
    for (var i = 0; i < DENY.length; i++) if (DENY[i].test(p)) return true;
    return false;
  }

  // Kill switch: env NAV_SPA_BROAD=off (Render) makes the page render <meta name="managira-spa-broad" content="0">,
  // and every kind of login goes back to its short list of in-app pages.
  function broadIsOff() {
    try { return typeof document !== 'undefined' && !!document.querySelector('meta[name="managira-spa-broad"][content="0"]'); } catch (e) { return false; }
  }
  function isBroadType(type) { return BROAD_TYPES.indexOf(type) !== -1 && !broadIsOff(); }

  // path: "/x?y" (no origin). list: the router's short list for this kind.
  function shouldHandle(type, path, list) {
    var p = String(path || '');
    if (p.charAt(0) !== '/' || p.charAt(1) === '/') return false;
    if (isDenied(p)) return false;
    if (isBroadType(type)) return true;
    var clean = p.split('?')[0].split('#')[0];
    if (clean.length > 1 && clean.slice(-1) === '/') clean = clean.slice(0, -1);
    return (list || []).some(function (r) { return clean === r || clean.indexOf(r + '/') === 0; });
  }

  function pathOf(u) {
    var s = String(u || '').split('#')[0];
    if (s.length > 1 && s.slice(-1) === '/') s = s.slice(0, -1);
    return s;
  }

  // What a click on a Back link does. state: history.state ({ path, prev, idx }); href: the link's own address.
  //  -> 'history' (history.back(): restores the page before this one) or 'navigate' (open href in-app).
  function resolveBack(state, href) {
    var prev = state && state.prev;
    var idx = state && typeof state.idx === 'number' ? state.idx : 0;
    if (prev && idx > 0 && pathOf(prev).split('?')[0] === pathOf(href).split('?')[0]) return 'history';
    return 'navigate';
  }

  return { DENY: DENY, isDenied: isDenied, isBroadType: isBroadType, shouldHandle: shouldHandle, resolveBack: resolveBack, pathOf: pathOf };
});
