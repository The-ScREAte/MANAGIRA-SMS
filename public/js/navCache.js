/**
 * Navigation cache logic (memory only, per tab) for public/js/spa-router.js.
 *
 * Pure functions plus a small store, so they can be unit tested under Node
 * (tests/navCache.test.js). Nothing here touches the network or the disk:
 * a signed-in page is kept in the JavaScript heap only, never in the Cache API,
 * IndexedDB or localStorage, and it dies with the tab.
 *
 *  - Pages are kept per person and school ("identity"), for a short time (TTL),
 *    at most MAX_ENTRIES, least recently used out first.
 *  - A kept page is shown at once and checked again in the background; the new copy is only
 *    swapped in when nothing is being typed, no drawer or dialog is open, and no form is dirty.
 *  - Anything that writes (POST/PUT/PATCH/DELETE) empties the whole cache.
 *  - Only an allow-list of safe, repeatable GET pages is ever fetched ahead of a click, and a deny-list
 *    of anything that changes state, downloads, prints or pays is never cached or fetched ahead.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ManagiraNavCache = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ENTRIES = 30;
  var TTL_STATIC_MS = 10 * 60 * 1000; // settings, hubs, management panels, help
  var TTL_LIVE_MS = 30 * 1000;        // pages showing live data

  // Pages whose content moves while you look at them: a short life.
  var LIVE = /(attendance|testing-room|online-test|bus|trip|tracker|notification|mailroom|inbox|finance|paygira|payout|billing|balance|invoice|orgDashboard|\/guardian\/dashboard|\/student\/dashboard|messages|chat|live)/i;

  // Never cached, never fetched ahead: they change state on GET, hand over files, print, or take money.
  var DENY = /(logout|logoff|sign-?out|login|register|forget-password|reset-password|setup-password|set-password|accept-hub-invitation|\/sso|\/r\/|delete|remove|approve|reject|unlock|lock\b|send|post\b|reverse|export|download|print|\/pdf|\.pdf|\.csv|\.xlsx|checkout|payment|pay\b|charge|refund|session-extend|mark-?read|notifications\/|switch|impersonat|toggle|enable|disable|archive|unarchive|obsolete|exit-org|new=1|\/api\/|\/internal\/|\/admin\/org\/|transcript|meritSheet|emailreports|testing-room\/|\/driver\/|trip|navigation|upload|import|sync|backup|restore|reset|start-over|confirm-password)/i;

  // The only pages fetched ahead while idle: menu destinations and hub shells (read-only listings).
  var PREFETCH_ALLOW = [
    /^\/common\/(orgDashboard|management|admissions|reports|mailroom|birthdays|my-access|calendar)$/,
    /^\/account\/settings(\/finance)?$/,
    /^\/common\/classDashboard(\/\d+)?$/,
    /^\/common\/(manageEmployees|guardians|archivedStudents|manageClassSubjectAndGradYr|manageEventsAnnouncements)$/,
    /^\/guardian\/(dashboard|settings)$/,
    /^\/student\/dashboard$/,
    /^\/legal\/(user-documentation|help|faq)$/,
    /^\/hub\/(dashboard|settings|organizations)$/
  ];

  function pathOf(href) {
    var s = String(href || '');
    var q = s.indexOf('#');
    if (q !== -1) s = s.slice(0, q);
    s = s.replace(/^https?:\/\/[^/]+/i, '');
    var cut = s.indexOf('?');
    return cut === -1 ? s : s.slice(0, cut);
  }

  function ttlFor(href) {
    return LIVE.test(String(href || '')) ? TTL_LIVE_MS : TTL_STATIC_MS;
  }

  function isDenied(href) {
    return DENY.test(String(href || ''));
  }

  function isCacheable(href) {
    return !isDenied(href);
  }

  function isPrefetchAllowed(href) {
    var h = String(href || '');
    if (isDenied(h)) return false;
    var p = pathOf(h).replace(/\/$/, '') || '/';
    return PREFETCH_ALLOW.some(function (re) { return re.test(p); });
  }

  // Person + school + kind of sign-in, from <meta name="managira-identity">. Not a secret.
  function identityOf(value) {
    return String(value || '').trim();
  }

  function cacheKey(identity, href) {
    return identityOf(identity) + '|' + String(href || '');
  }

  // The page's security nonce changes on every response; take it out so two renders of the same page match.
  function normalizeForHash(html) {
    return String(html || '')
      .replace(/\bnonce="[^"]*"/g, 'nonce=""')
      .replace(/\bnonce='[^']*'/g, "nonce=''")
      .replace(/(name="csrf-token"\s+content=")[^"]*"/g, '$1"')
      .replace(/(?:[?&]|&amp;)(?:expires|signature)=[^&"'\s<]*/g, '')
      .replace(/\bdata-(?:idle-left|ends-in)="[^"]*"/g, '');
  }

  // FNV-1a, 32 bit, over the normalised text, with its length. Enough to tell two pages apart cheaply.
  function hashString(text) {
    var s = String(text || '');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16) + '-' + s.length.toString(16);
  }

  function pageHash(html) {
    return hashString(normalizeForHash(html));
  }

  // The page's own content (inside <main>): header counts and the like are not a change to the page.
  function mainOf(html) {
    var text = String(html || '');
    var a = text.indexOf('<main');
    var b = text.lastIndexOf('</main>');
    return a !== -1 && b > a ? text.slice(a, b + 7) : text;
  }

  function mainHash(html) {
    return hashString(normalizeForHash(mainOf(html)));
  }

  // A page that carries a message for the person is shown once, never kept.
  function hasFlash(html) {
    return /class="[^"]*\bflash-message\b/.test(String(html || ''));
  }

  function createStore(options) {
    var opts = options || {};
    var max = opts.max || MAX_ENTRIES;
    var now = opts.now || function () { return Date.now(); };
    var map = new Map();
    return {
      // { entry, fresh, age } or null. An entry older than its TTL is gone.
      get: function (identity, href) {
        var key = cacheKey(identity, href);
        var entry = map.get(key);
        if (!entry) return null;
        var age = now() - entry.at;
        if (age > entry.ttl) { map.delete(key); return null; }
        map.delete(key); map.set(key, entry); // most recently used last
        return { entry: entry, age: age };
      },
      set: function (identity, href, data) {
        if (!identity) return null;
        var key = cacheKey(identity, href);
        map.delete(key);
        var entry = { html: data.html, etag: data.etag || '', hash: data.hash || pageHash(data.html), mainHash: data.mainHash || mainHash(data.html), at: now(), ttl: data.ttl || ttlFor(href), href: href };
        map.set(key, entry);
        while (map.size > max) map.delete(map.keys().next().value);
        return entry;
      },
      touch: function (identity, href) {
        var entry = map.get(cacheKey(identity, href));
        if (entry) entry.at = now();
      },
      has: function (identity, href) { return !!this.get(identity, href); },
      delete: function (identity, href) { map.delete(cacheKey(identity, href)); },
      clear: function () { map.clear(); },
      size: function () { return map.size; },
      keys: function () { return Array.from(map.keys()); }
    };
  }

  // True when the person has typed in, ticked or changed a field on this page (the page's own scripts filling
  // fields in do not count: the router marks a field only on a real user "input"/"change" event).
  function isDirty(rootNode) {
    if (!rootNode || !rootNode.querySelector) return false;
    return !!rootNode.querySelector('[data-nav-touched="1"]');
  }

  // A real (trusted) input or change event on a form field marks it as touched.
  function markTouched(event) {
    var t = event && event.target;
    if (!event || event.isTrusted === false || !t || !t.setAttribute) return false;
    var tag = String(t.tagName || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !t.isContentEditable) return false;
    var type = String(t.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'search') return false;
    t.setAttribute('data-nav-touched', '1');
    return true;
  }

  // Something is open that a page swap would close or move.
  var BUSY_SELECTOR = 'dialog[open], [aria-modal="true"]:not([hidden]), .drawer.open, .drawer.is-open, .modal.show, .modal.open, .management-nav.open, .hub-nav.open, .settings-nav.open, .tm-nav.is-open, .nav-card.open, #header-nav-menu.show';
  function isBusy(doc) {
    if (!doc || !doc.querySelectorAll) return false;
    var found = doc.querySelectorAll(BUSY_SELECTOR);
    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      // Present but not shown (a closed dialog kept in the page) does not count.
      if (!el.getClientRects || el.getClientRects().length > 0) return true;
    }
    return false;
  }

  // May the fresh copy replace what is on screen right now?
  function canSwapInPlace(state) {
    var s = state || {};
    if (s.dirty || s.busy || s.typingRecently) return false;
    if (s.hasFrames) return false; // a hub shell: its panels keep their own state
    if (s.navigating) return false;
    return true;
  }

  // Calls to the server that only read (or that the page makes all the time) leave the cache alone.
  var READ_ONLY_WRITES = /(\/csp-report|\/session|\/notifications\/|\/api\/chatbot|\/mira\/|\/search|\/lookup|\/ping|\/heartbeat|\/track|\/analytics)/i;
  function writeClearsCache(method, href) {
    var m = String(method || 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
    return !READ_ONLY_WRITES.test(pathOf(href));
  }

  // A cheap check for a slow or metered connection / data saver.
  function connectionAllowsWarmup(conn) {
    if (!conn) return true;
    if (conn.saveData) return false;
    return !/(^|-)2g$/.test(String(conn.effectiveType || '')) && !/3g/.test(String(conn.effectiveType || ''));
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES,
    TTL_STATIC_MS: TTL_STATIC_MS,
    TTL_LIVE_MS: TTL_LIVE_MS,
    pathOf: pathOf,
    ttlFor: ttlFor,
    isDenied: isDenied,
    isCacheable: isCacheable,
    isPrefetchAllowed: isPrefetchAllowed,
    identityOf: identityOf,
    cacheKey: cacheKey,
    normalizeForHash: normalizeForHash,
    hashString: hashString,
    pageHash: pageHash,
    mainOf: mainOf,
    mainHash: mainHash,
    hasFlash: hasFlash,
    createStore: createStore,
    isDirty: isDirty,
    markTouched: markTouched,
    isBusy: isBusy,
    canSwapInPlace: canSwapInPlace,
    writeClearsCache: writeClearsCache,
    connectionAllowsWarmup: connectionAllowsWarmup
  };
});
