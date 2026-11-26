/**
 * SPA Router v2 — Client-side navigation without page reloads
 * 
 * Best practices implemented:
 * - AbortController for cancelling in-flight requests
 * - Proper popstate (back/forward) handling with instant response
 * - No cache-busting on images (prevents broken URLs & unnecessary re-downloads)
 * - Efficient DOM diffing (no querySelectorAll('*') performance killer)
 * - Video element pause/play lifecycle management
 * - IntersectionObserver-based link preloading
 * - Proper cleanup to prevent memory leaks
 * - CSS-based transitions for GPU-accelerated smoothness
 * - Navigation deduplication & race condition prevention
 * - Header active-state updates after navigation
 * - Graceful fallback to full reload on errors
 */

(function () {
  'use strict';

  // ─── Configuration ────────────────────────────────────────────────────
  const CONFIG = {
    MAX_CACHE: 60,             // bumped so previously-visited pages stay hot
    PRELOAD_DELAY: 65,         // ms before hover-preload fires
    TRANSITION_MS: 120,        // fade out/in duration (skipped on cache hits)
    PRELOAD_VISIBLE: false,    // disabled: caused preload stampede on dashboards
    SCROLL_BEHAVIOR: 'instant',
    TOPBAR_DELAY_MS: 120,      // show top progress bar only if nav takes longer than this
    MAX_CONCURRENT_PRELOADS: 2, // cap to avoid saturating the browser / server
    PRELOAD_DELAY_HOVER: 65,
    WARM_PER_MINUTE: 12,        // idle warm-up budget (sliding minute)
    WARM_PER_SESSION: 25,       // until the person interacts again
    // ON unless the kill switch is set (env NAV_KEEP_PANELS=off renders <meta name="managira-keep-panels" content="0">):
    // menu pages and class pages you leave are kept alive, hidden and silent (public/js/navGate.js), at most 4.
    KEEP_PANELS: window.MANAGIRA_KEEP_PANELS !== false && !(document.querySelector('meta[name="managira-keep-panels"][content="0"]')),
    KEEP_MAX: 6,                // menu pages + classes alive at once (least recently used dropped first); 3 when the tab's memory is high
    KEEP_TTL_MS: 5 * 60 * 1000, // longest a parked page is shown from memory
    KEEP_RECHECK_MS: 30 * 1000, // a parked page older than this is checked against the server when it comes back
    TYPING_QUIET_MS: 3000       // a page is not swapped under someone who just typed
  };
  const NC = window.ManagiraNavCache || null; // public/js/navCache.js
  const G = window.__managiraGate || null;    // public/js/navGate.js: keeps parked pages quiet
  const CLASS_PAGE = /^\/common\/classDashboard\/(\d+)/;
  // Menu pages (their sidebar): one copy for every ?panel=... address, the page picks its panel from the address.
  const HUB_SHELLS = ['/common/management', '/common/admissions', '/common/reports', '/account/settings/finance'];
  const HUB_WITH_PANEL = HUB_SHELLS.concat(['/account/settings']);

  // ─── Route Definitions by User Type ───────────────────────────────────
  const ROUTES_BY_TYPE = {
    // Students and drivers only move between their own pages (never staff pages).
    student: ['/student/dashboard', '/student/testing-room', '/legal/help', '/legal/faq'],
    driver: ['/driver/dashboard', '/driver/settings', '/legal/help', '/legal/faq'],
    public: [
      '/',
      '/account/login',
      '/account/register',
      '/account/forget-password',
      '/account/service-plan',
      '/hub/login',
      '/account/guardian-login',
      '/account/reset-password',
      '/account/accept-hub-invitation',
      '/account/accept-hub-invitation-existing',
      '/legal/help',
      '/legal/employment',
      '/legal/donations',
      '/legal/about-us',
      '/legal/privacy-policy',
      '/legal/terms-of-service',
      '/legal/faq'
    ],
    organization: [
      '/',
      '/common/orgDashboard',
      '/common/management',
      '/common/publicDashboard',
      '/common/admissions',
      '/common/reports',
      '/account/settings',
      '/account/settings/finance',
      '/account/settings/my-paygira',
      '/account/update',
      '/account/personalization',
      '/account/managePublicContent',
      '/account/update-card',
      '/account/update-plan',
      '/common/studentDetails',
      '/common/editStudent',
      '/common/admissionPending',
      '/common/archivedStudents',
      '/common/manageClassSubjectAndGradYr',
      '/common/classDashboard',
      '/common/addClassSubject',
      '/common/manageEmployees',
      '/common/employeeDetails',
      '/common/createEmployee',
      '/common/modifyEmployee',
      '/common/guardians',
      '/common/guardianDetails',
      '/common/assessment',
      '/common/createTest',
      '/common/modifyAssessment',
      '/common/manageAssessment',
      '/common/manageRecords',
      '/common/closeSchoolYear',
      '/common/termDetails',
      '/common/closeGraduationYearGroup',
      '/common/registerSchoolYear',
      '/common/createEventAnnouncement',
      '/common/manageEventsAnnouncements',
      '/common/set-password',
      '/enrollment/enroll',
      '/enrollment/manageEnrollment',
      '/enrollment/modifyEnrollment',
      '/common/attendanceCollection',
      '/print/meritSheetPage',
      '/print/emailHistoryPage',
      '/promotion/apply',
      '/legal/help',
      '/legal/employment',
      '/legal/donations',
      '/legal/about-us',
      '/legal/privacy-policy',
      '/legal/terms-of-service',
      '/legal/faq',
      '/common/publicRegister',
      '/account/confirm-password',
      '/stats/organization',
    ],
    guardian: [
      '/',
      '/guardian/dashboard',
      '/guardian/paygira',
      '/guardian/academic-details',
      '/guardian/student',
      '/guardian/settings',
      '/guardian/report',
      '/guardian/reports',
      '/guardian/edit-pending-student',
      '/legal/help',
      '/legal/privacy-policy',
      '/legal/terms-of-service',
      '/legal/faq'
    ],
    hub: [
      '/',
      '/hub/dashboard',
      '/hub/settings',
      '/hub/organizations',
      '/hub/organizations/invite',
      '/hub/organizations/search',
      '/hub/organizations/edit',
      '/hub/setup-password',
      '/legal/help',
      '/legal/privacy-policy',
      '/legal/terms-of-service',
      '/legal/faq'
    ],
    admin: [
      '/',
      '/admin',
      '/admin/superDashboard',
      '/admin/superSettings',
      '/admin/create-promo',
      '/admin/employment',
      '/admin/donations',
      '/admin/announcements',
      '/admin/helpMessages',
      '/admin/helpHistory',
      '/admin/servicePricing',
      '/admin/scheduled-holds',
      '/admin/data-export',
      '/admin/hubs',
      '/admin/hubs/create',
      '/admin/editAdminUser',
      '/legal/help',
      '/legal/faq'
    ]
  };

  // Priority pages to preload per user type
  const PRELOAD_PRIORITY = {
    public: ['/account/login', '/account/register', '/account/service-plan'],
    organization: ['/common/orgDashboard', '/common/management', '/account/settings', '/account/settings/finance', '/account/settings/my-paygira'],
    guardian: ['/guardian/dashboard', '/guardian/paygira'],
    student: ['/student/dashboard', '/student/testing-room'],
    driver: ['/driver/dashboard'],
    hub: ['/hub/dashboard', '/hub/settings'],
    admin: ['/admin/superDashboard', '/admin/superSettings']
  };

  // Routes that should NEVER be SPA-handled (complex forms, file uploads, etc.)
  const EXCLUDED_PATTERNS = [
    '/account/logout',
    '/hub/logout',
    '/admin/org/',
    '/admin/exit-org',
    '/admin/profile',
    'new=1',
    '/common/addStudent',        // Complex form with file uploads
    '/common/registerSchoolYear',// Complex form submissions
    '/stats/',                   // Chart.js initialization (all stats pages)
    '/print/',                   // Server-rendered PDF/print templates
    '/common/createEmployee',    // File uploads
    '/common/modifyEmployee',    // File uploads
    '/common/createTest',        // Rich editor
    '/student/testing-room/',    // Taking a test: its own screen, timer and leave/lock handling
    '/account/managePublicContent', // Quill editor + image uploads
    '/account/personalization',  // Theme switching with full reload
    '/common/publicDashboard',   // School website: its own page, styles, light/dark and scripts
    '/common/publicRegister',    // Online registration: its own page and styles
    '/account/login',            // Sign-in pages: their own page, nothing else to load
    '/account/sso',
    '/account/student-login',
    '/account/guardian-login',
    '/hub/login'
  ];

  // Routes that should still SPA-navigate (fast, no full reload) but whose
  // HTML must never be served from the client-side cache — the server's
  // response for these depends on request-time state that can differ
  // between two visits to the exact same URL, so a cached response could
  // show stale/wrong UI on a later visit.
  const NO_CACHE_PATTERNS = [];

  // ─── SPARouter Class ──────────────────────────────────────────────────
  class SPARouter {
    constructor() {
      this.userType = window.spaUserType || 'public';
      this.routes = ROUTES_BY_TYPE[this.userType] || ROUTES_BY_TYPE.public;
      this.store = NC ? NC.createStore() : null; // memory only: pages kept per person and school (public/js/navCache.js)
      this._gen = 0;                 // changes whenever something is written: older answers are then dropped
      this._revalidating = new Set();
      this._warmTimes = [];          // when each idle warm-up fetch started (sliding minute)
      this._warmThisSession = 0;
      this._warmAbort = null;
      this._lastInputAt = 0;
      this._lastHubUrl = new Map();  // hub path -> the address (panel and page) you were on
      this._hubScroll = new Map();
      this._lowBattery = false;
      this._parkedMap = new Map();   // menu pages and class pages kept alive, hidden and quiet (at most CONFIG.KEEP_MAX)
      this._lastWriteAt = 0;
      this._unparkInfo = null;
      this._current = null;          // record of the menu page on screen (when it came through this router)
      this._gate = null;
      this.isNavigating = false;
      this.currentPath = this._normalizePath(window.location.pathname + window.location.search);
      this.pendingHash = '';
      this.abortController = null;
      this.hoverTimer = null;
      this.visibilityObserver = null;

      // Track in-flight preloads so we can cap concurrency and dedupe.
      this._preloadsInFlight = new Set();
      // path -> promise of the preloaded HTML (null if it failed), so a click
      // on a page that is still preloading waits for it instead of asking the
      // server for the same page a second time.
      this._preloadRequests = new Map();
      // Track in-flight navigation fetches keyed by path (request dedupe).
      this._pendingNavigations = new Map();
      // Spinner-delay timer (set by _showProgress, cleared by _hideProgress).
      // Whether the current swap may skip the fade (cache hits skip it).
      this._skipFade = false;

      this._init();
    }

    // Where the person is (address, state, scroll), kept up to date through every history change, so that a page
    // being parked knows what it was showing (a class: which tab) even when the browser's Back button moved first.
    _trackLocation() {
      const here = () => ({ url: window.location.pathname + window.location.search, state: window.history.state, scroll: window.scrollY || 0 });
      this._lastLoc = here();
      const router = this;
      ['pushState', 'replaceState'].forEach((m) => {
        const native = window.history[m];
        window.history[m] = function () { const r = native.apply(this, arguments); router._lastLoc = here(); return r; };
      });
      window.addEventListener('popstate', () => setTimeout(() => { this._lastLoc = here(); }, 0));
    }

    _noteLeaving(fromPop) {
      const loc = (fromPop && this._lastLoc) ? this._lastLoc : { url: window.location.pathname + window.location.search, state: window.history.state, scroll: window.scrollY || 0 };
      this._unparkScroll = 0;
      this._leavingUrl = loc.url;
      this._leavingState = loc.state;
      this._leavingScroll = loc.scroll;
    }

    // ── Initialization ────────────────────────────────────────────────
    _init() {
      this._installNavCacheHooks();
      this._trackLocation();
      this._adoptBootPage();
      // 1. Save initial history state
      window.history.replaceState(
        { path: this.currentPath, scroll: 0 },
        '',
        this.currentPath
      );

      // 2. Intercept link clicks (single delegated listener). Not inside an
      //    iframe pane: there a real navigation lets the server see
      //    Sec-Fetch-Dest: iframe and render the page without header/footer.
      if (window.self === window.top) {
        document.addEventListener('click', this._onLinkClick.bind(this), true);
      }

      // 3. Hover preloading with debounce
      document.addEventListener('mouseover', this._onLinkHover.bind(this));
      document.addEventListener('focusin', this._onLinkHover.bind(this));
      document.addEventListener('mouseout', this._onLinkHoverEnd.bind(this));

      // 3b. Mousedown/pointerdown preload — fires ~100ms before click event,
      //     which often gives the response enough head-start to feel instant.
      document.addEventListener('mousedown', this._onLinkIntent.bind(this), true);

      // 4. Touch preloading for mobile
      document.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: true });

      // 5. Handle back/forward buttons — THE critical fix
      window.addEventListener('popstate', this._onPopState.bind(this));

      // 5b. Handle in-page hash navigation consistently under SPA
      window.addEventListener('hashchange', this._onHashChange.bind(this));

      // 6. Save scroll position before navigating away
      window.addEventListener('scroll', this._throttle(() => {
        if (history.state && history.state.path) {
          const state = { ...history.state, scroll: window.scrollY };
          history.replaceState(state, '', state.path);
        }
      }, 200), { passive: true });

      // Guard against duplicated footers after mixed SPA/full navigations.
      this._dedupeFooters();

      // 7. Preload priority pages after idle
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => this._preloadPriorityPages(), { timeout: 2000 });
      } else {
        setTimeout(() => this._preloadPriorityPages(), 500);
      }

      // 8. Viewport-based preloading for visible links
      //    Intentionally disabled by default — it caused a preload stampede on
      //    dashboard pages where dozens of sidebar links were all visible. The
      //    main navigation click would then get queued behind the preloads.
      if (CONFIG.PRELOAD_VISIBLE && 'IntersectionObserver' in window) {
        this._initVisibilityPreloading();
      }

      // 9. <link rel="prefetch"> hints removed: the hover + priority preload
      //    already warms the cache, and document prefetches compete for the
      //    same HTTP connections as the user's actual click.

      // 10. Global cleanup registry so page scripts can dispose listeners/
      //     timers before the next SPA swap. Page code can push functions:
      //       window.__spaCleanup.push(() => clearInterval(myTimer));
      if (!Array.isArray(window.__spaCleanup)) {
        window.__spaCleanup = [];
      }

      // 11. Restore hash target on initial load if present
      if (window.location.hash) {
        requestAnimationFrame(() => {
          this._scrollToHash(window.location.hash.substring(1), false);
        });
      }
    }

    // ── Event Handlers ────────────────────────────────────────────────

    _onLinkClick(e) {
      // Only handle left-clicks without modifier keys
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // In-page hash links (e.g. sticky nav sections)
      if (href.startsWith('#')) {
        const hashTarget = href.substring(1);
        if (hashTarget) {
          e.preventDefault();
          e.stopPropagation();
          this._scrollToHash(hashTarget, true);
        }
        return;
      }

      // Same-origin URL with hash
      let parsedUrl = null;
      try {
        parsedUrl = new URL(href, window.location.origin);
      } catch (_) {
        parsedUrl = null;
      }

      if (parsedUrl && parsedUrl.origin === window.location.origin && parsedUrl.hash) {
        const targetPath = this._normalizePath(parsedUrl.pathname + parsedUrl.search);

        if (targetPath === this.currentPath) {
          e.preventDefault();
          e.stopPropagation();
          this._scrollToHash(parsedUrl.hash.substring(1), true);
          return;
        }
      }

      // Skip non-navigable links
      if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') ||
          href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('blob:')) {
        return;
      }

      // Skip links with target="_blank" or download attribute
      if (link.hasAttribute('target') || link.hasAttribute('download')) return;

      // Skip links explicitly opting out
      if (link.hasAttribute('data-no-spa') || link.closest('[data-no-spa]')) return;

      // Skip excluded patterns
      if (this._isExcluded(href)) return;

      // Check if this route should be SPA-handled
      if (this._shouldHandle(href)) {
        e.preventDefault();
        e.stopPropagation();
        this.navigate(href);
      }
    }

    _onLinkHover(e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || !this._shouldHandle(href) || this._isExcluded(href)) return;

      // Debounce: only preload if user hovers for a moment
      if (this.hoverTimer) clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        this._preload(href);
      }, CONFIG.PRELOAD_DELAY_HOVER);
    }

    _onLinkHoverEnd() {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
    }

    _onTouchStart(e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (href && this._shouldHandle(href) && !this._isExcluded(href)) {
        this._preload(href);
      }
    }

    /**
     * Fires on mousedown / pointerdown — ~100ms before the click event on
     * average. Kicking off the fetch here means the response is often already
     * bytes-in-flight (or fully cached) by the time navigate() runs.
     */
    _onLinkIntent(e) {
      if (e.button !== 0) return;
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || !this._shouldHandle(href) || this._isExcluded(href)) return;

      this._preload(href);
    }

    /**
     * Back/Forward button handler — KEY FIX
     * This fires AFTER the URL has already changed, so we just need to
     * load the content for the new URL immediately.
     */
    _onPopState(e) {
      const targetPath = e.state?.path || this._normalizePath(window.location.pathname + window.location.search);
      const hashTarget = window.location.hash ? window.location.hash.substring(1) : '';

      // Don't re-load if we're already on this path
      if (targetPath === this.currentPath) {
        if (hashTarget) {
          this._scrollToHash(hashTarget, false);
        }
        return;
      }

      // Cancel any in-flight navigation
      this._abortFetch();
      this._noteLeaving(true);

      // Load page immediately — no pushState (browser already updated the URL)
      this._loadPage(targetPath, false).then(() => {
        // Restore scroll position if saved
        if (hashTarget) {
          this._scrollToHash(hashTarget, false);
        } else {
          const savedScroll = e.state?.scroll || 0;
          window.scrollTo({ top: savedScroll, behavior: CONFIG.SCROLL_BEHAVIOR });
        }
      }).catch(() => {
        if (window.__managiraSignedOut) return;
        // Fallback: full page reload
        window.location.reload();
      });
    }

    _onHashChange() {
      if (window.location.hash) {
        this._scrollToHash(window.location.hash.substring(1), false);
      }
    }

    // ── Navigation ────────────────────────────────────────────────────

    async navigate(path) {
      let rawPath = path;
      let hashFragment = '';

      if (typeof path === 'string' && path.includes('#')) {
        const parts = path.split('#');
        rawPath = parts[0] || this.currentPath;
        hashFragment = parts.slice(1).join('#');
      }

      let normalizedPath = this._normalizePath(rawPath);
      this.pendingHash = hashFragment ? decodeURIComponent(hashFragment) : '';

      // Don't navigate to current page
      if (normalizedPath === this.currentPath) return;

      this._noteLeaving(false);
      // Back to a menu page you were on: the panel (and page in it) you left open comes back too.
      this._rememberHubView();
      if (HUB_WITH_PANEL.includes(normalizedPath) && this._lastHubUrl.has(normalizedPath)) {
        normalizedPath = this._lastHubUrl.get(normalizedPath);
      }
      this._abortWarm();

      // Dedupe: if the SAME navigation is already in flight, ignore the click
      // (prevents wasted work when users double-click). Previously we aborted
      // and retried, which threw away server work already in progress.
      if (this._pendingNavigations.has(normalizedPath)) {
        return this._pendingNavigations.get(normalizedPath);
      }

      // Overlapping nav to a DIFFERENT path — cancel the previous one.
      if (this.isNavigating) {
        this._abortFetch();
      }

      this.isNavigating = true;

      // Cached pages: skip the fade entirely so they feel instant.
      const isCached = this._hasFresh(normalizedPath);
      this._skipFade = isCached;
      if (!isCached) {
        this._showProgress();
      }

      const navPromise = (async () => {
        try {
          this._pushed = false;
          await this._loadPage(normalizedPath, true);
          if (!this._pushed) {
            window.history.pushState(
              { path: normalizedPath, scroll: 0 },
              '',
              `${normalizedPath}${this.pendingHash ? `#${encodeURIComponent(this.pendingHash)}` : ''}`
            );
          }

          if (this.pendingHash) {
            this._scrollToHash(this.pendingHash, false);
            this.pendingHash = '';
          } else {
            window.scrollTo({ top: this._unparkScroll || 0, behavior: CONFIG.SCROLL_BEHAVIOR });
          }
          this._unparkScroll = 0;
        } catch (err) {
          // Signed out: public/js/sessionWatch.js is already taking the page to the login page.
          if (window.__managiraSignedOut) return;
          // Fallback to full navigation
          window.location.href = path;
        } finally {
          this.isNavigating = false;
          this._hideProgress();
          this._pendingNavigations.delete(normalizedPath);
        }
      })();

      this._pendingNavigations.set(normalizedPath, navPromise);
      return navPromise;
    }

    async _loadPage(path, isForwardNav) {
      const normalizedPath = this._normalizePath(path);
      const noCache = this._isNoCache(normalizedPath);

      try {
        const hit = noCache ? null : this._cacheGet(normalizedPath);
        let html = hit ? hit.entry.html : null;
        // A parked page needs no new copy of itself: its own text is enough for the header and title.
        if (!html && !this._refreshing) { const kept = this._peekParked(normalizedPath); if (kept && kept.html) html = kept.html; }

        if (!html && !noCache && this._preloadRequests.has(normalizedPath)) {
          // Wait a few seconds at most; a preload that stalls is asked for again.
          html = await Promise.race([
            this._preloadRequests.get(normalizedPath),
            new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
          ]);
        }

        if (!html) {
          this.abortController = new AbortController();
          const gen = this._gen;

          const response = await fetch(path, {
            signal: this.abortController.signal,
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'X-Nav-Cache': '1',
              'Accept': 'text/html'
            }
          });

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          html = await response.text();
          if (!noCache && !response.redirected && gen === this._gen) this._cacheSet(normalizedPath, html, response.headers.get('ETag'));
        }

        // Parse response
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Pause any playing videos/audio before swap
        this._pauseMedia();

        // The new page's own scripts read the address (which panel to open): it is in place before they run.
        if (isForwardNav) {
          window.history.pushState({ path: normalizedPath, scroll: 0 }, '', `${normalizedPath}${this.pendingHash ? `#${encodeURIComponent(this.pendingHash)}` : ''}`);
          this._pushed = true;
        }

        // Perform the content swap with transition
        this._swapHtml = html;
        await this._swapContent(doc, normalizedPath);
        this._swapHtml = null;

        // Update current path tracking
        this.currentPath = normalizedPath;
        // A parked page comes back where you left it (the tab you had open in a class), not at its first address.
        if (this._unparkInfo) {
          const info = this._unparkInfo;
          this._unparkInfo = null;
          if (info.url && this._normalizePath(info.url) !== normalizedPath) {
            try { window.history.replaceState(info.state || { path: info.url, scroll: 0 }, '', info.url); this.currentPath = this._normalizePath(info.url); } catch (_) { /* keep the address */ }
          }
        }

        // Shown from a kept copy: look for a newer one now, quietly.
        if (hit) this._revalidate(normalizedPath, hit.entry);

      } catch (err) {
        if (err.name === 'AbortError') return; // Intentionally cancelled
        throw err;
      }
    }

    // ── Content Swap ──────────────────────────────────────────────────

    async _swapContent(doc, path) {
      const liveMain = this._visibleMain();
      let currentMain = liveMain;
      const newMain = doc.querySelector('main');
      const newBody = doc.querySelector('body');

      // A page with its own design (sign-in pages, prints) has no app frame around it: swapping
      // only its middle into this page mixed the two. It opens as a page of its own instead.
      if (!doc.getElementById('app-scale-root') || !currentMain || !newMain) {
        throw new Error('Not a page of the app frame');
      }
      // Drawn for another school than this page (a parent's child at another school): the whole
      // page loads, so the header, logo and menus are that school's.
      const nowSchool = (document.getElementById('app-scale-root') || {}).getAttribute ? document.getElementById('app-scale-root').getAttribute('data-school') : null;
      const newSchool = doc.getElementById('app-scale-root').getAttribute('data-school');
      if (nowSchool !== null && newSchool !== null && nowSchool !== newSchool) {
        this.clearCache();
        throw new Error('Another school');
      }
      // Drawn for another person (or school) than this tab's pages: nothing kept is theirs to see.
      const newIdentity = NC ? NC.identityOf(((doc.querySelector('meta[name="managira-identity"]') || {}).getAttribute || (() => ''))
        .call(doc.querySelector('meta[name="managira-identity"]') || {}, 'content')) : '';
      if (NC && newIdentity !== this._identity()) {
        this.clearCache();
        throw new Error('Another person');
      }

      // Menu pages (Reports, Management, ...) and class pages keep their panels alive: leaving one parks it
      // (hidden, quiet, its panels still loaded); coming back to it shows it again at once.
      const key = this._keepKey(path);
      const leavingRec = this._current;
      const target = (!this._refreshing && path !== this.currentPath) ? this._takeParked(key) : null;
      const parkLeaving = !this._refreshing && path !== this.currentPath && key !== this._keepKey(this.currentPath) && this._isParkable(currentMain, leavingRec);
      if (parkLeaving) {
        leavingRec.cleanups = Array.isArray(window.__spaCleanup) ? window.__spaCleanup.splice(0) : [];
        this._park(leavingRec, currentMain, this._keepKey(this.currentPath));
        if (!target) {
          currentMain = currentMain.cloneNode(false);
          currentMain.removeAttribute('inert');
          currentMain.removeAttribute('hidden');
          currentMain.removeAttribute('data-spa-parked');
          currentMain.removeAttribute('aria-hidden');
          // The page on screen keeps the main landmark's id (the skip link points at it); the parked copy gave its id up.
          const mainId = currentMain.getAttribute('data-parked-id');
          if (mainId) currentMain.id = mainId;
          currentMain.removeAttribute('data-parked-id');
          liveMain.parentNode.insertBefore(currentMain, liveMain);
        }
        this._current = null;
      } else if (target) {
        if (Array.isArray(window.__spaCleanup)) window.__spaCleanup.splice(0).forEach((fn) => { try { typeof fn === 'function' && fn(); } catch (_) { /* ignore */ } });
        liveMain.remove();
        this._current = null;
      }

      // 0. Run any cleanup callbacks registered by the outgoing page.
      //    Page scripts can push disposers into window.__spaCleanup to dispose
      //    intervals, event listeners, charts, editors, etc.
      if (!parkLeaving && !target && Array.isArray(window.__spaCleanup)) {
        const cleanups = window.__spaCleanup.splice(0);
        for (const fn of cleanups) {
          if (typeof fn === 'function') {
            try { fn(); } catch (_) { /* ignore cleanup errors */ }
          }
        }
      }

      // Sync body data attributes/classes so page-scoped styles apply (e.g., public dashboard themes)
      this._syncBodyAttributes(newBody);

      // 1. Update page title
      const newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      const shouldFade = !this._skipFade && !parkLeaving && !target;
      this._skipFade = false;

      // 2. Fade out current content (skipped for cache hits).
      //    Keep OLD page-specific styles in place during fade-out so the
      //    outgoing page does not visually break before it disappears.
      if (shouldFade) {
        currentMain.style.transition = `opacity ${CONFIG.TRANSITION_MS}ms ease`;
        currentMain.style.opacity = '0';
        await this._wait(CONFIG.TRANSITION_MS);
      }

      // 3. Attach NEW page-specific styles BEFORE injecting new markup,
      //    then remove the previous SPA-injected styles. This guarantees
      //    new content paints with its own CSS already mounted and avoids
      //    the brief unstyled flash some org pages were showing.
      this._updateStyles(doc);

      // 4. Swap content
      if (target) {
        const parkedFor = Date.now() - target.parkedAt;
        currentMain = this._unpark(target);
        this._current = target;
        if (Array.isArray(window.__spaCleanup)) window.__spaCleanup.push(...target.cleanups);
        target.cleanups = [];
        this._reinitializeHandlers(currentMain);
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        this._afterUnpark(target, currentMain, parkedFor);
      } else {
        currentMain.innerHTML = newMain.innerHTML;

        // 5. Process new content
        this._processImages(currentMain);
        this._processVideos(currentMain);
        // A menu page's own window/document listeners are muted while it is parked (see _park).
        const rec = (G && !this._refreshing && this._keepable(newMain)) ? { parked: false, dead: false, main: null, cleanups: [], deferred: [], at: Date.now(), gen: this._gen, key, stale: false, html: this._swapHtml || '' } : null;
        if (G) G.rec = rec;
        try {
          await this._executeScripts(currentMain);
        } finally {
          if (G) G.rec = null;
        }
        if (!this._refreshing) this._current = rec;
        this._reinitializeHandlers(currentMain);
      }

      // 6. Fade in
      if (shouldFade) {
        requestAnimationFrame(() => {
          currentMain.style.opacity = '1';
        });
      } else {
        currentMain.style.opacity = '1';
      }

      // 7. Update meta tags
      this._updateMetaTags(doc);

      // 8. Replace header markup so role/permission-gated menu items stay fresh.
      this._updateHeader(doc);

      // 9. Update header active states
      this._updateHeaderActiveState(path);

      // 10. Update footer visibility
      this._updateFooter(doc);

      // 11. Notify other scripts. A page that was kept alive has already started up: its own listeners sit this one out.
      if (target) target.mute = true;
      try { this._dispatchEvents(path, this._refreshing, !!target); } finally { if (target) target.mute = false; }

      // 12. Re-observe new links for viewport preloading
      if (this.visibilityObserver) {
        this._observeLinks(currentMain);
      }

      // 13. Warm the nav/sidebar links on the new page so follow-up clicks
      //     are served from cache. Scheduled on idle so it never competes
      //     with user interaction.
      const schedule = (cb) => ('requestIdleCallback' in window)
        ? requestIdleCallback(cb, { timeout: 3000 })
        : setTimeout(cb, 400);
      if (!this._refreshing) schedule(() => this._preloadPriorityPages());
    }

    // ── Image Handling ────────────────────────────────────────────────

    _processImages(container) {
      // Simply ensure all images are visible and trigger lazy loading
      const images = container.querySelectorAll('img');
      images.forEach(img => {
        // Handle lazy-loaded images
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc) {
          img.src = dataSrc;
          img.removeAttribute('data-src');
        }

        // Ensure visibility
        img.style.opacity = '1';

        // Handle broken images gracefully
        if (!img.hasAttribute('data-error-handled')) {
          img.setAttribute('data-error-handled', 'true');
          img.addEventListener('error', function () {
            this.style.opacity = '0.5';
          }, { once: true });
        }
      });
    }

    // ── Video Handling ────────────────────────────────────────────────

    _processVideos(container) {
      const videos = container.querySelectorAll('video');
      videos.forEach(video => {
        // Re-load video sources
        const sources = video.querySelectorAll('source');
        if (sources.length > 0) {
          video.load();
        }

        // Auto-play if the video has autoplay attribute
        if (video.hasAttribute('autoplay')) {
          video.play().catch(() => { /* Autoplay blocked by browser */ });
        }
      });
    }

    _pauseMedia() {
      // Pause all playing videos and audio before swapping content
      document.querySelectorAll('main video, main audio').forEach(media => {
        if (!media.paused) {
          media.pause();
        }
      });
    }

    // ── Script Execution ──────────────────────────────────────────────

    async _executeScripts(container) {
      const scripts = container.querySelectorAll('script');
      // The page's security policy (CSP) only trusts the nonce of the page the browser first
      // loaded; the fetched page carries a different one. Scripts we re-run take this page's.
      const pageNonce = this._pageNonce();

      for (const oldScript of scripts) {
        const newScript = document.createElement('script');

        // Copy attributes (not the fetched page's nonce)
        Array.from(oldScript.attributes).forEach(attr => {
          if (attr.name === 'nonce') return;
          newScript.setAttribute(attr.name, attr.value);
        });
        if (pageNonce) newScript.nonce = pageNonce;

        if (!oldScript.parentNode) continue;

        if (oldScript.src) {
          // External script — re-add to trigger load and await completion
          await new Promise(resolve => {
            newScript.onload = resolve;
            newScript.onerror = resolve;
            newScript.src = oldScript.src;

            if (oldScript.parentNode) {
              oldScript.parentNode.replaceChild(newScript, oldScript);
            } else {
              resolve();
            }
          });
        } else {
          // Inline script — execute in global scope
          newScript.textContent = oldScript.textContent;

          // Replace in DOM to trigger execution
          if (oldScript.parentNode) {
            oldScript.parentNode.replaceChild(newScript, oldScript);
          }
        }
      }
    }

    _pageNonce() {
      if (this.__nonce) return this.__nonce;
      // Browsers hide the nonce attribute after load but keep the .nonce property.
      const holder = Array.from(document.querySelectorAll('script')).find((el) => el.nonce);
      this.__nonce = holder ? holder.nonce : '';
      return this.__nonce;
    }

    // ── Reinitialize Event Handlers ───────────────────────────────────

    _reinitializeHandlers(container) {
      // Click, change and submit handlers are delegated (public/js/mgActions.js, data-on<event>), so
      // content swapped in here needs nothing re-attached.

      // Re-attach password toggle buttons
      container.querySelectorAll('.password-toggle-btn').forEach(btn => {
        if (!btn.hasAttribute('data-spa-bound')) {
          btn.setAttribute('data-spa-bound', '1');
          btn.addEventListener('click', function () {
            const wrapper = this.closest('.password-input-wrapper');
            const input = wrapper?.querySelector('input');
            const icon = this.querySelector('i');
            if (input && icon) {
              const isPassword = input.type === 'password';
              input.type = isPassword ? 'text' : 'password';
              icon.classList.toggle('fa-eye', !isPassword);
              icon.classList.toggle('fa-eye-slash', isPassword);
            }
          });
        }
      });

      // Re-attach data-confirm handlers
      container.querySelectorAll('[data-confirm]').forEach(el => {
        if (!el.hasAttribute('data-spa-bound-confirm')) {
          el.setAttribute('data-spa-bound-confirm', '1');
          el.addEventListener('click', function (e) {
            // appAlert.js asks first with the app's own dialog; this only runs where it isn't loaded.
            if (!window.appConfirm && !confirm(this.dataset.confirm)) {
              e.preventDefault();
              e.stopPropagation();
            }
          });
        }
      });

      // Re-attach data-toggle handlers
      container.querySelectorAll('[data-toggle]').forEach(el => {
        if (!el.hasAttribute('data-spa-bound-toggle')) {
          el.setAttribute('data-spa-bound-toggle', '1');
          el.addEventListener('click', function (e) {
            const rawTarget = String(this.dataset.toggle || '').trim();
            if (!rawTarget) return;

            // Let page-specific password toggles handle their own UI state.
            if (this.classList.contains('input-icon-btn')) return;

            // Prevent default only for links; buttons should remain native.
            if (this.tagName === 'A') {
              e.preventDefault();
            }

            let target = null;

            // Common pattern in this app: data-toggle stores an element id.
            if (/^[A-Za-z][A-Za-z0-9_:\-.]*$/.test(rawTarget)) {
              target = document.getElementById(rawTarget);
            }

            // Fallback: treat as selector when valid.
            if (!target) {
              try {
                target = document.querySelector(rawTarget);
              } catch (_) {
                target = null;
              }
            }

            if (!target) return;
            target.classList.toggle('hidden');
          });
        }
      });

      // Reinitialize header menu if available
      if (typeof window.initHeaderMenu === 'function') {
        window.initHeaderMenu();
      }
      if (typeof window.initLogoSPANavigation === 'function') {
        window.initLogoSPANavigation();
      }

      // Fire DOMContentLoaded for scripts that expect it
      // Use rAF to ensure DOM is settled
      requestAnimationFrame(() => {
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
      });
    }

    // ── Style Management ──────────────────────────────────────────────

    _updateStyles(doc) {
      // Collect ALL new page-specific styles first (body inline + head page-specific).
      const newStyleNodes = [];
      const newBody = doc.querySelector('body');
      if (newBody) {
        newBody.querySelectorAll('style').forEach(styleTag => {
          const s = document.createElement('style');
          s.textContent = styleTag.textContent;
          s.setAttribute('data-spa-style', 'true');
          newStyleNodes.push(s);
        });
      }
      doc.querySelectorAll('head style').forEach(styleTag => {
        const content = styleTag.textContent;
        if (content.includes('turbo-progress-bar')) return; // global, skip
        const s = document.createElement('style');
        s.textContent = content;
        s.setAttribute('data-spa-style', 'true');
        newStyleNodes.push(s);
      });

      // Snapshot of previously-injected SPA styles BEFORE we attach new ones.
      const previousStyles = Array.from(
        document.querySelectorAll('style[data-spa-style]')
      );

      // Attach new styles first so the new content paints with CSS in place.
      newStyleNodes.forEach(s => document.head.appendChild(s));

      // Then drop the old ones — no unstyled flash, no double-cascade for long.
      previousStyles.forEach(s => s.remove());
    }


    // ── Meta Tags ─────────────────────────────────────────────────────

    _updateMetaTags(doc) {
      const metaUpdates = {
        'meta[name="description"]': 'content',
        'meta[name="keywords"]': 'content',
        'meta[property="og:title"]': 'content',
        'meta[property="og:description"]': 'content',
        'meta[property="og:url"]': 'content',
        'meta[name="twitter:title"]': 'content',
        'meta[name="twitter:description"]': 'content',
        'link[rel="canonical"]': 'href'
      };

      Object.entries(metaUpdates).forEach(([selector, attr]) => {
        const newEl = doc.querySelector(selector);
        const currentEl = document.querySelector(selector);
        if (newEl && currentEl) {
          currentEl.setAttribute(attr, newEl.getAttribute(attr));
        }
      });
    }

    _updateHeader(doc) {
      const newHeader = doc.querySelector('header#top-header');
      const currentHeader = document.querySelector('header#top-header');

      if (!newHeader || !currentHeader) {
        return;
      }

      currentHeader.replaceWith(newHeader);

      // Re-bind interactive header behavior on the new markup.
      if (typeof window.initHeaderMenu === 'function') {
        window.initHeaderMenu();
      }
      if (typeof window.initLogoSPANavigation === 'function') {
        window.initLogoSPANavigation();
      }
      if (typeof window.initNotifBell === 'function') {
        window.initNotifBell();
      }
    }

    // ── Header Active State ───────────────────────────────────────────

    _updateHeaderActiveState(path) {
      // Remove existing active classes
      document.querySelectorAll('.nav-link.active, .nav-item.active, .sidebar-link.active').forEach(el => {
        el.classList.remove('active');
      });

      // Add active class to matching nav link
      document.querySelectorAll('nav a, .sidebar a, .header a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && (href === path || path.startsWith(href + '/'))) {
          link.classList.add('active');
          // Also activate parent nav-item if exists
          const parent = link.closest('.nav-item');
          if (parent) parent.classList.add('active');
        }
      });

      // Handle sticky nav visibility for public dashboard
      const stickyNav = document.querySelector('.sticky-nav');
      if (stickyNav) {
        // The school website is also served at a school's own address ("/"),
        // so check the page itself, not only the path.
        const onSchoolWebsite = path.includes('/publicDashboard') || (document.body && document.body.dataset.page === 'publicDashboard');
        stickyNav.style.display = onSchoolWebsite ? '' : 'none';
      }
    }

    // ── Footer ────────────────────────────────────────────────────────

    _updateFooter(doc) {
      const newFooter = doc.querySelector('footer');
      const currentFooter = document.querySelector('footer');
      if (newFooter && currentFooter) {
        currentFooter.innerHTML = newFooter.innerHTML;
      }
      this._dedupeFooters();
    }

    _dedupeFooters() {
      const footers = Array.from(document.querySelectorAll('footer'));
      if (footers.length <= 1) return;

      const keep = footers.find((el) => el.classList && el.classList.contains('managira-footer')) || footers[0];
      footers.forEach((footer) => {
        if (footer !== keep) footer.remove();
      });
    }

    // ── Event Dispatch ────────────────────────────────────────────────

    _dispatchEvents(path, refresh, kept) {
      window.dispatchEvent(new CustomEvent('spa:pageLoaded', {
        detail: { path, timestamp: Date.now(), refresh: !!refresh, kept: !!kept }
      }));

      // Trigger Turbo-compatible event
      window.dispatchEvent(new CustomEvent('turbo:load'));

      if (window.location.hash) {
        requestAnimationFrame(() => {
          this._scrollToHash(window.location.hash.substring(1), false);
        });
      }
    }

    _scrollToHash(hashValue, updateHistory = true) {
      const cleanHash = decodeURIComponent(String(hashValue || '').replace(/^#/, '').trim());
      if (!cleanHash) return false;

      const target = document.getElementById(cleanHash);
      if (!target) return false;

      const topHeader = document.getElementById('top-header');
      const stickyNav = document.querySelector('.sticky-nav');
      const topHeaderHeight = topHeader ? topHeader.getBoundingClientRect().height : 0;
      const stickyNavHeight = stickyNav && stickyNav.offsetParent !== null ? stickyNav.getBoundingClientRect().height : 0;
      const offset = Math.max(topHeaderHeight + stickyNavHeight + 12, 24);

      const targetTop = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' });

      if (updateHistory) {
        const state = history.state && typeof history.state === 'object' ? history.state : { path: this.currentPath, scroll: window.scrollY };
        history.replaceState(state, '', `${this.currentPath}#${encodeURIComponent(cleanHash)}`);
      }

      document.querySelectorAll('.sticky-nav a[href^="#"]').forEach(link => {
        link.classList.toggle('active', decodeURIComponent(link.getAttribute('href').substring(1)) === cleanHash);
      });

      return true;
    }

    // ── Body attribute sync (ensures data-page/data-theme classes persist across SPA nav) ──
    _syncBodyAttributes(newBody) {
      if (!newBody) return;

      const body = document.body;

      // Align class list
      body.className = newBody.className || '';

      // Remove stale data-* attrs
      Array.from(body.attributes).forEach(attr => {
        if (attr.name.startsWith('data-') && !newBody.hasAttribute(attr.name)) {
          body.removeAttribute(attr.name);
        }
      });

      // Apply new data-* attrs
      Array.from(newBody.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) {
          body.setAttribute(attr.name, attr.value);
        }
      });
    }

    // ── Preloading ────────────────────────────────────────────────────

    _preload(path, options) {
      // A workspace pane (iframe) never navigates through the router, so a
      // page it preloads is never used: with three panes open that was four
      // copies of every priority page fetched on each load.
      if (window.self !== window.top) return;
      const idle = !!(options && options.idle);
      const normalized = this._normalizePath(path);
      if (this._isNoCache(normalized) || (NC && !NC.isCacheable(normalized))) return;
      if (this._hasFresh(normalized)) return;
      if (this._preloadsInFlight.has(normalized)) return;
      if (this._preloadsInFlight.size >= CONFIG.MAX_CONCURRENT_PRELOADS) return;

      this._preloadsInFlight.add(normalized);
      const gen = this._gen;
      let controller = null;
      if (idle && typeof AbortController !== 'undefined') {
        controller = new AbortController();
        this._warmAbort = this._warmAbort || new Set();
        this._warmAbort.add(controller);
      }

      const request = fetch(path, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/html',
          'X-Nav-Cache': '1',
          'X-Prefetch': '1',
          'X-SPA-Preload': '1' // background warm-up: never leaves messages behind
        },
        credentials: 'same-origin',
        priority: 'low',
        signal: controller ? controller.signal : undefined
      })
        .then(res => {
          // Sent elsewhere (signed out, no access) or not a page: nothing kept.
          if (res.ok && !res.redirected && /text\/html/i.test(res.headers.get('content-type') || '')) {
            return res.text().then((html) => ({ html, etag: res.headers.get('ETag') }));
          }
          throw new Error('Preload failed');
        })
        .then(({ html, etag }) => {
          if (gen === this._gen) this._cacheSet(normalized, html, etag);
          return html;
        })
        .catch(() => null /* Silently fail preloads */)
        .finally(() => {
          if (controller && this._warmAbort) this._warmAbort.delete(controller);
          this._preloadsInFlight.delete(normalized);
          this._preloadRequests.delete(normalized);
        });
      this._preloadRequests.set(normalized, request);
    }

    // Data saver on, or a 2G/3G connection: background warm-up is skipped
    // (a tap or hover still loads the next page ahead).
    _slowConnection() {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      return NC ? !NC.connectionAllowsWarmup(c) : !!(c && (c.saveData || /2g|3g/.test(c.effectiveType || '')));
    }

    _preloadPriorityPages() {
      // A visitor on the login page needs that page and nothing else: warming others only slows it.
      if (!this.userType || this.userType === 'public') return;
      // Drivers (battery, data) and students (a test may be running) are not warmed ahead.
      if (this.userType === 'driver' || this.userType === 'student') return;
      if (window.self !== window.top) return;
      // Warm-up never competes with the page itself: wait until it has loaded.
      if (document.readyState !== 'complete') {
        if (!this._preloadAfterLoad) {
          this._preloadAfterLoad = true;
          window.addEventListener('load', () => { this._preloadAfterLoad = false; this._preloadPriorityPages(); }, { once: true });
        }
        return;
      }
      this._startWarm();
    }

    // Is it a good moment to fetch pages nobody asked for yet?
    _warmAllowed() {
      if (document.visibilityState !== 'visible') return false;
      if (this._slowConnection() || this._lowBattery) return false;
      if (this.isNavigating) return false;
      if (/testing-room|\/driver\//i.test(window.location.pathname)) return false;
      if (this._warmThisSession >= CONFIG.WARM_PER_SESSION) return false;
      const now = Date.now();
      this._warmTimes = this._warmTimes.filter((t) => now - t < 60000);
      return this._warmTimes.length < CONFIG.WARM_PER_MINUTE;
    }

    // The pages a person most likely opens next: this page's menu links, the other menu pages,
    // and the tabs of the class they are on. Only the allow-list in navCache.js, one at a time (two at most).
    _warmCandidates() {
      const seen = new Set();
      const out = [];
      const add = (href) => {
        if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return;
        const p = this._normalizePath(href);
        const base = NC ? NC.pathOf(p) : p.split('?')[0];
        const key = HUB_SHELLS.includes(base) ? base : p;
        if (seen.has(key) || p === this.currentPath) return;
        if (!this._shouldHandle(p) || this._isExcluded(p) || !NC || !NC.isPrefetchAllowed(p)) return;
        if (this._hasFresh(key)) return;
        seen.add(key);
        out.push(key);
      };
      document.querySelectorAll('#top-header a[href], header a[href], [data-prefetch][href]').forEach((a) => {
        if (a.hasAttribute('data-no-prefetch') || a.closest('[data-no-prefetch]') || a.hasAttribute('data-no-spa') || a.closest('[data-no-spa]') || a.hasAttribute('target') || a.hasAttribute('download')) return;
        add(a.getAttribute('href'));
      });
      (PRELOAD_PRIORITY[this.userType] || []).forEach(add);
      if (/\/common\/classDashboard/.test(this.currentPath)) {
        document.querySelectorAll('main a[href^="/common/classDashboard"]').forEach((a) => add(a.getAttribute('href')));
      }
      return out;
    }

    _startWarm() {
      if (this._warming) return;
      if (!NC) return;
      if (!this._batteryChecked && navigator.getBattery) {
        this._batteryChecked = true;
        navigator.getBattery().then((b) => {
          const sync = () => { this._lowBattery = !b.charging && b.level < 0.2; };
          sync();
          b.addEventListener('levelchange', sync);
          b.addEventListener('chargingchange', sync);
        }).catch(() => {});
      }
      const queue = this._warmCandidates();
      if (!queue.length) return;
      this._warming = true;
      const idle = (cb) => ('requestIdleCallback' in window) ? requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 300);
      const pump = () => {
        if (!queue.length || !this._warmAllowed() && this._warmThisSession >= CONFIG.WARM_PER_SESSION) { this._warming = false; return; }
        if (!this._warmAllowed()) { setTimeout(() => idle(pump), 1500); return; }
        if (this._preloadsInFlight.size >= CONFIG.MAX_CONCURRENT_PRELOADS) { setTimeout(() => idle(pump), 250); return; }
        const next = queue.shift();
        if (!this._hasFresh(next)) {
          this._warmTimes.push(Date.now());
          this._warmThisSession += 1;
          this._preload(next, { idle: true });
        }
        idle(pump);
      };
      idle(pump);
    }

    _abortWarm() {
      this._warming = false;
      if (this._warmAbort) { this._warmAbort.forEach((c) => { try { c.abort(); } catch (_) { /* ignore */ } }); this._warmAbort.clear(); }
    }

    /**
     * Background warm-up for every SPA route declared for this user type.
     * Pulls routes one at a time on requestIdleCallback so we never compete
     * with the user's click. Skips already-cached or excluded routes and
     * respects MAX_CONCURRENT_PRELOADS.
     */
    _warmAllRoutes() {
      if (this._warmupStarted) return;
      this._warmupStarted = true;

      const queue = (this.routes || [])
        .filter(r => r && !this._isExcluded(r) && r !== this.currentPath);

      const schedule = (cb) => ('requestIdleCallback' in window)
        ? requestIdleCallback(cb, { timeout: 6000 })
        : setTimeout(cb, 800);

      const pump = () => {
        if (queue.length === 0) {
          this._warmupStarted = false; // allow re-warm on next swap if needed
          return;
        }
        // Don't preload while the user is actively navigating.
        if (this.isNavigating) {
          schedule(pump);
          return;
        }
        const next = queue.shift();
        if (!this._hasFresh(this._normalizePath(next))) {
          this._preload(next);
        }
        schedule(pump);
      };

      schedule(pump);
    }

    _initVisibilityPreloading() {
      this.visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const href = entry.target.getAttribute('href');
            if (href && this._shouldHandle(href) && !this._isExcluded(href)) {
              this._preload(href);
            }
            this.visibilityObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '200px' });

      this._observeLinks(document);
    }

    _observeLinks(container) {
      if (!this.visibilityObserver) return;
      container.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && this._shouldHandle(href) && !this._isExcluded(href)) {
          this.visibilityObserver.observe(link);
        }
      });
    }

    _addPrefetchHints() {
      // Disabled — previously injected <link rel="prefetch" as="document"> for
      // each priority page, which competed with the user's actual click for
      // HTTP connections. The hover + idle preloads already warm the cache.
    }

    // ── Cache Management ──────────────────────────────────────────────

    _visibleMain() {
      return document.querySelector('main:not([data-spa-parked]):not([data-spa-parked] main)');
    }

    // Is this page one worth keeping alive: a menu page with panels (iframes) or a class page with its tabs?
    _keepable(root) {
      return !!(root && root.querySelector && root.querySelector('.embed-panel-body, #workspacePanels'));
    }

    // The page the browser loaded first is adopted too (its scripts were recorded while it loaded), so leaving it
    // for the first time parks it like any other.
    _adoptBootPage() {
      if (!G || !G.boot || !CONFIG.KEEP_PANELS || !NC) return;
      const run = () => {
        if (window.self !== window.top || this._current) return;
        const main = this._visibleMain();
        if (!this._keepable(main)) return;
        Object.assign(G.boot, { main: null, cleanups: [], at: Date.now(), gen: this._gen, key: this._keepKey(this.currentPath), stale: false, html: '' });
        this._current = G.boot;
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
    }

    // One key per menu page, one per class and term.
    _keepKey(path) {
      const base = NC ? NC.pathOf(path) : String(path).split('?')[0];
      const m = CLASS_PAGE.exec(base);
      if (m) {
        const t = /[?&]termId=(\d+)/.exec(String(path));
        return 'class:' + m[1] + (t ? ':' + t[1] : '');
      }
      return this._cacheKey(path);
    }

    // Only a page whose scripts the gate recorded (a boot page or one swapped in here) is kept: while parked its listeners and timers do nothing.
    _isParkable(main, rec) {
      return !!(CONFIG.KEEP_PANELS && G && NC && rec && !rec.parked && !rec.dead && !rec.stale && rec.gen === this._gen && main && this._keepable(main)
        && NC.isCacheable(rec.key) && !/testing-room|\/driver\/|trip/i.test(rec.key));
    }

    _park(rec, main, key) {
      // Where you were: the address (a class remembers its open tab), the scroll, the focused element.
      rec.url = this._leavingUrl || (window.location.pathname + window.location.search);
      rec.state = this._leavingState || null;
      rec.scrollY = this._leavingScroll || 0;
      const focused = document.activeElement;
      rec.focusId = (focused && focused !== document.body && main.contains(focused) && focused.id) ? focused.id : '';
      rec.snap = this._snapshot(main);
      // The pending hash/ids: elements keep their ids only while shown, so the page on screen never meets a second #hub-nav.
      main.querySelectorAll('[id]').forEach((el) => { el.setAttribute('data-parked-id', el.id); el.removeAttribute('id'); });
      // Anything pointing at a hidden id by name (aria-controls and friends) is left alone: the whole subtree is inert and aria-hidden.
      if (main.id) { main.setAttribute('data-parked-id', main.id); main.removeAttribute('id'); }
      main.setAttribute('data-spa-parked', '1');
      main.setAttribute('aria-hidden', 'true');
      main.hidden = true;
      main.inert = true;
      if (focused && main.contains(focused) && focused.blur) { try { focused.blur(); } catch (_) { /* ignore */ } }
      rec.main = main;
      rec.parked = true; // from here the gate keeps its listeners and timers quiet
      rec.key = key;
      rec.at = Date.now();
      rec.parkedAt = rec.at;
      rec.ttl = Math.min(NC ? NC.ttlFor(key) : CONFIG.KEEP_TTL_MS, CONFIG.KEEP_TTL_MS);
      this._setFramesParked(main, true);
      try { window.dispatchEvent(new CustomEvent('managira:parked', { detail: { key } })); } catch (_) { /* ignore */ }
      const old = this._parkedMap.get(key);
      if (old && old !== rec) this._destroyParked(old);
      this._parkedMap.delete(key);
      this._parkedMap.set(key, rec);
      while (this._parkedMap.size > this._keepLimit()) this._destroyParked(this._parkedMap.get(this._parkedMap.keys().next().value));
      this._captureFrameBaseline(rec);
    }

    _keepLimit() {
      try {
        const mem = performance && performance.memory;
        if (mem && mem.usedJSHeapSize > 250 * 1024 * 1024) return 3;
      } catch (_) { /* not measurable: the normal limit */ }
      return CONFIG.KEEP_MAX;
    }

    // How a page looked when it was parked (classes, inline style, hidden/aria state). While parked it is frozen: a menu page
    // shown meanwhile may run document-wide selectors (".hub-section", ".nav-link") that toggle this page's elements too.
    _snapshot(main) {
      const out = [];
      const attrs = ['class', 'style', 'hidden', 'aria-expanded', 'aria-selected', 'aria-pressed', 'aria-current', 'tabindex'];
      main.querySelectorAll('*').forEach((el) => {
        if (el === main) return;
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'STYLE') return;
        let rec = null;
        for (let i = 0; i < attrs.length; i++) { const v = el.getAttribute(attrs[i]); if (v !== null) { rec = rec || {}; rec[attrs[i]] = v; } }
        out.push([el, rec]);
      });
      return out;
    }

    _restoreSnapshot(snap) {
      if (!snap) return;
      const attrs = ['class', 'style', 'hidden', 'aria-expanded', 'aria-selected', 'aria-pressed', 'aria-current', 'tabindex'];
      snap.forEach((item) => {
        const el = item[0];
        const was = item[1] || {};
        for (let i = 0; i < attrs.length; i++) {
          const a = attrs[i];
          const now = el.getAttribute(a);
          const before = Object.prototype.hasOwnProperty.call(was, a) ? was[a] : null;
          if (now === before) continue;
          if (before === null) el.removeAttribute(a); else el.setAttribute(a, before);
        }
      });
    }

    // Panels inside a parked page: they report "hidden", their timers wait, and what waited runs when the page returns.
    _setFramesParked(main, parked) {
      main.querySelectorAll('iframe').forEach((f) => {
        try {
          const w = f.contentWindow;
          const d = f.contentDocument;
          if (!w || !d) return;
          w.__managiraParked = parked;
          try {
            if (parked) {
              Object.defineProperty(d, 'hidden', { configurable: true, get: () => true });
              Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => 'hidden' });
            } else { delete d.hidden; delete d.visibilityState; }
          } catch (_) { /* ignore */ }
          d.dispatchEvent(new Event('visibilitychange'));
          w.dispatchEvent(new CustomEvent(parked ? 'managira:parked' : 'managira:unparked'));
        } catch (_) { /* another origin or not loaded yet */ }
      });
    }

    // A kept page (menu page or class) that is asked for: its record, if still good.
    _peekParked(path) {
      const key = this._keepKey(path);
      let rec = this._parkedMap.get(key);
      if (!rec && /^class:\d+$/.test(key)) { // a class asked for without a term: the one kept for that class
        for (const [k, r] of this._parkedMap) { if (k.indexOf(key + ':') === 0) rec = r; }
      }
      return rec || null;
    }

    _takeParked(key) {
      const rec = this._peekParked(key.indexOf('class:') === 0 ? '/common/classDashboard/' + key.split(':')[1] + (key.split(':')[2] ? '?termId=' + key.split(':')[2] : '') : key);
      if (!rec) return null;
      const ok = rec.main && rec.main.isConnected && !rec.stale && !rec.dead && rec.gen === this._gen && Date.now() - rec.parkedAt < rec.ttl;
      if (!ok) { this._destroyParked(rec); return null; }
      return rec;
    }

    _unpark(rec) {
      const main = rec.main;
      this._parkedMap.delete(rec.key);
      main.querySelectorAll('[data-parked-id]').forEach((el) => { el.id = el.getAttribute('data-parked-id'); el.removeAttribute('data-parked-id'); });
      if (main.hasAttribute('data-parked-id')) { main.id = main.getAttribute('data-parked-id'); main.removeAttribute('data-parked-id'); }
      main.removeAttribute('data-spa-parked');
      main.removeAttribute('aria-hidden');
      main.hidden = false;
      main.inert = false;
      main.style.opacity = '1';
      rec.parked = false;
      rec.main = main;
      this._restoreSnapshot(rec.snap); // another menu page's scripts reach every element with the same class: this one is as it was left
      rec.snap = null;
      return main;
    }

    // After a parked page is shown again: panels and timers wake, focus returns, an older page is checked quietly.
    _afterUnpark(rec, main, parkedFor) {
      this._unparkInfo = { url: rec.url, state: rec.state };
      this._unparkScroll = rec.scrollY;
      G.flush(rec);
      this._setFramesParked(main, false);
      try { window.dispatchEvent(new CustomEvent('managira:unparked', { detail: { key: rec.key, parkedFor } })); } catch (_) { /* ignore */ }
      if (rec.focusId) { const el = document.getElementById(rec.focusId); if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ } } }
      if (parkedFor < CONFIG.KEEP_RECHECK_MS) return;
      if (rec.key.indexOf('class:') === 0) this._refreshClassPanels(main);
      else this._recheckFrames(rec, main);
    }

    // A class page that was away for a while: its tabs that show moving data load again the next time they are shown
    // (the one on screen quietly now), the others stay as they were.
    _refreshClassPanels(main) {
      const active = main.querySelector('.workspace-panel.is-active');
      main.querySelectorAll('.workspace-frame-panel').forEach((panel) => {
        if (panel === active) {
          const frame = panel.querySelector('iframe.workspace-frame');
          panel.__wsSilent = true; // the old copy stays visible, no spinner
          try { frame.contentWindow.location.reload(); } catch (_) { panel.__wsSilent = false; }
        } else {
          panel.__wsStale = true;
        }
      });
    }

    // The panel on screen in a menu page, asked of the server with the copy's tag: nothing changed means nothing happens.
    _frameRequest(src, etag) {
      const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-Nav-Cache': '1', 'X-Prefetch': '1', 'Accept': 'text/html' };
      if (etag) headers['If-None-Match'] = etag;
      return fetch(src, { headers, credentials: 'same-origin', cache: 'no-store', priority: 'low' });
    }

    _visibleFrame(main) {
      return Array.from(main.querySelectorAll('iframe.embed-iframe')).find((f) => f.offsetParent !== null) || null;
    }

    _captureFrameBaseline(rec) {
      if (!rec.main || (NC && NC.ttlFor(rec.key) < CONFIG.KEEP_RECHECK_MS)) return;
      const gen = this._gen;
      setTimeout(async () => {
        if (!rec.parked || rec.dead || gen !== this._gen || !this._warmAllowed()) return;
        const frame = this._visibleFrameParked(rec.main);
        if (!frame) return;
        try {
          const src = frame.contentWindow.location.href;
          const res = await this._frameRequest(src, '');
          if (!res.ok || res.redirected) return;
          const text = await res.text();
          rec.frameTags = rec.frameTags || {};
          rec.frameTags[src] = { etag: res.headers.get('ETag') || '', hash: NC.pageHash(text) };
        } catch (_) { /* offline: nothing to compare with */ }
      }, 2500);
    }

    // The panel that was open when the page was parked (hidden now, so "visible" means the one not hidden by its own page).
    _visibleFrameParked(main) {
      return Array.from(main.querySelectorAll('iframe.embed-iframe')).find((f) => f.style.display !== 'none' && !f.hidden && f.getAttribute('src')) || null;
    }

    async _recheckFrames(rec, main) {
      const frame = this._visibleFrame(main);
      if (!frame || !NC) return;
      let src;
      try { src = frame.contentWindow.location.href; } catch (_) { return; }
      const base = rec.frameTags && rec.frameTags[src];
      const gen = this._gen;
      try {
        const res = await this._frameRequest(src, base && base.etag);
        if (gen !== this._gen || rec.parked || rec.dead) return;
        if (res.status === 304) return;
        if (!res.ok || res.redirected) { this.clearCache(); return; }
        const text = await res.text();
        const hash = NC.pageHash(text);
        rec.frameTags = rec.frameTags || {};
        rec.frameTags[src] = { etag: res.headers.get('ETag') || '', hash };
        if (!base || base.hash === hash) return;
        let touched = frame.dataset.touched === '1';
        try { touched = touched || NC.isDirty(frame.contentDocument); } catch (_) { /* ignore */ }
        if (touched || this._lastTypedRecently()) return; // the next visit shows it
        try { frame.contentWindow.location.reload(); } catch (_) { /* ignore */ }
      } catch (_) { /* offline: what is shown stays */ }
    }

    _lastTypedRecently() { return Date.now() - this._lastInputAt < CONFIG.TYPING_QUIET_MS; }

    _destroyParked(rec) {
      if (!rec) return;
      this._parkedMap.delete(rec.key);
      rec.dead = true;
      if (rec.main && rec.main.parentNode) rec.main.remove();
      (rec.cleanups || []).forEach((fn) => { try { typeof fn === 'function' && fn(); } catch (_) { /* ignore */ } });
      rec.cleanups = [];
      rec.deferred = [];
      rec.main = null;
    }

    _identity() {
      if (this.__identity !== undefined && this.__identityDoc === document) return this.__identity;
      const m = document.querySelector('meta[name="managira-identity"]');
      this.__identity = NC ? NC.identityOf(m && m.getAttribute('content')) : '';
      this.__identityDoc = document;
      return this.__identity;
    }

    // Menu pages share one copy for every ?panel=... address.
    _cacheKey(path) {
      const base = NC ? NC.pathOf(path) : String(path).split('?')[0];
      return HUB_SHELLS.includes(base) ? base : path;
    }

    _cacheGet(path) {
      if (!this.store || !NC || !NC.isCacheable(path)) return null;
      return this.store.get(this._identity(), this._cacheKey(path));
    }

    _hasFresh(path) {
      return !!this._cacheGet(path);
    }

    _cacheSet(path, html, etag) {
      if (!this.store || !NC || !NC.isCacheable(path)) return;
      // A message waits for its first showing; a page with one is never kept.
      if (NC.hasFlash(html)) return;
      this.store.set(this._identity(), this._cacheKey(path), { html, etag: etag || '', hash: NC.pageHash(html), ttl: NC.ttlFor(path) });
    }

    clearCache() {
      this._gen += 1;
      this._lastWriteAt = Date.now();
      // Tabs of the class on screen (hidden or kept aside) show their data again the next time they are opened.
      try { document.querySelectorAll('.workspace-frame-panel').forEach((panel) => { panel.__wsStale = true; }); } catch (_) { /* ignore */ }
      if (this.store) this.store.clear();
      this._lastHubUrl.clear();
      Array.from(this._parkedMap.values()).forEach((rec) => this._destroyParked(rec));
      if (this._current) this._current.stale = true;
      this._hideRefreshChip();
    }

    // Keeps where you were in a menu page (the panel and page open in it) for coming back to it.
    _rememberHubView() {
      const base = NC ? NC.pathOf(this.currentPath) : this.currentPath.split('?')[0];
      if (!HUB_WITH_PANEL.includes(base)) return;
      const here = window.location.pathname + window.location.search;
      if (NC ? NC.pathOf(here) === base : true) {
        // Only when the menu page itself chose a panel: a bare address keeps the page's own default.
        if (window.location.search) this._lastHubUrl.set(base, here);
        else this._lastHubUrl.delete(base);
        this._hubScroll.set(base, window.scrollY || 0);
      }
    }

    // ── Revalidation (kept copy shown first, a newer one fetched quietly) ─────

    async _revalidate(path, entry) {
      if (!this.store || !NC || this._revalidating.has(path)) return;
      this._revalidating.add(path);
      const gen = this._gen;
      const identity = this._identity();
      try {
        // Not while the page is still settling; on idle so it never competes with the click.
        await new Promise((resolve) => ('requestIdleCallback' in window) ? requestIdleCallback(resolve, { timeout: 1200 }) : setTimeout(resolve, 150));
        const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-Nav-Cache': '1', 'Accept': 'text/html' };
        if (entry.etag) headers['If-None-Match'] = entry.etag;
        const res = await fetch(path, { headers, credentials: 'same-origin', cache: 'no-store' });
        if (gen !== this._gen || identity !== this._identity()) return;
        const key = this._cacheKey(path);
        if (res.status === 304) { this.store.touch(identity, key); return; }
        if (!res.ok || res.redirected || !/text\/html/i.test(res.headers.get('content-type') || '')) { this.store.delete(identity, key); return; }
        const html = await res.text();
        if (gen !== this._gen) return;
        if (NC.hasFlash(html)) { this.store.delete(identity, key); return; }
        const hash = NC.pageHash(html);
        if (hash === entry.hash) { this.store.touch(identity, key); return; }
        const contentSame = NC.mainHash(html) === entry.mainHash;
        this._cacheSet(path, html, res.headers.get('ETag'));
        if (contentSame) return; // only the header differs (counts, names): nothing on the page to change
        if (this._cacheKey(this.currentPath) !== key) return; // the person has moved on: next visit shows it
        this._offerFresh(path, html);
      } catch (_) { /* offline or cancelled: the kept copy stays */ } finally {
        this._revalidating.delete(path);
      }
    }

    _canSwapNow() {
      const main = this._visibleMain();
      return NC.canSwapInPlace({
        dirty: NC.isDirty(main),
        busy: NC.isBusy(document),
        typingRecently: Date.now() - this._lastInputAt < CONFIG.TYPING_QUIET_MS,
        hasFrames: !!(main && main.querySelector('iframe')),
        navigating: this.isNavigating
      });
    }

    async _offerFresh(path, html) {
      const main = this._visibleMain();
      if (this._current && this._cacheKey(this.currentPath) === this._cacheKey(path)) this._current.stale = true; // a menu page's shell changed: park nothing of it
      if (main && main.querySelector('.embed-panel-body')) return; // menu page: its panels check themselves
      if (main && main.querySelector('iframe')) { this._showRefreshChip(path, html); return; } // panels in it must not reload under the person
      if (this._canSwapNow()) {
        await this._swapFresh(path, html);
      } else {
        this._showRefreshChip(path, html);
      }
    }

    // New copy in place: scroll position, focus and open things stay as they were.
    async _swapFresh(path, html) {
      const y = window.scrollY || 0;
      const active = document.activeElement;
      const activeId = active && active.id ? active.id : '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      this._refreshing = true;
      this._skipFade = true;
      try {
        await this._swapContent(doc, path);
        window.scrollTo({ top: y, behavior: 'instant' });
        if (activeId) { const el = document.getElementById(activeId); if (el && el.focus) el.focus({ preventScroll: true }); }
      } catch (_) { /* leave the page as it is */ } finally {
        this._refreshing = false;
        this._skipFade = false;
        this._hideRefreshChip();
      }
    }

    _showRefreshChip(path, html) {
      let chip = document.getElementById('nav-refresh-chip');
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.id = 'nav-refresh-chip';
        chip.setAttribute('role', 'status');
        document.body.appendChild(chip);
        chip.addEventListener('click', () => {
          const pending = this._chipPending;
          this._hideRefreshChip();
          if (pending) this._swapFresh(pending.path, pending.html);
        });
      }
      this._chipPending = { path, html };
      chip.textContent = 'Updated \u2014 refresh';
      chip.hidden = false;
    }

    _hideRefreshChip() {
      this._chipPending = null;
      const chip = document.getElementById('nav-refresh-chip');
      if (chip) chip.hidden = true;
    }

    // Anything that writes empties the cache (a saved setting never shows its old value on the way back),
    // in this window and in the panels (iframes) of a menu page; typing is noted so a page is not swapped under it.
    _installNavCacheHooks() {
      if (!NC || window.__navCacheHooks) return;
      window.__navCacheHooks = true;
      const isTop = window.self === window.top;
      const clearAll = () => {
        try {
          const top = window.top;
          if (top && top.spaRouter && top.spaRouter.clearCache) top.spaRouter.clearCache();
          else if (window.spaRouter) window.spaRouter.clearCache();
        } catch (_) { if (window.spaRouter) window.spaRouter.clearCache(); }
      };
      if (isTop) window.__navCacheClear = clearAll;
      const sameOrigin = (u) => { try { return new URL(u, window.location.href).origin === window.location.origin; } catch (_) { return false; } };

      const nativeFetch = window.fetch;
      if (typeof nativeFetch === 'function') {
        window.fetch = function (input, init) {
          let write = false;
          try {
            const method = (init && init.method) || (input && input.method) || 'GET';
            const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
            write = sameOrigin(url) && NC.writeClearsCache(method, url);
          } catch (_) { write = false; }
          if (!write) return nativeFetch.apply(this, arguments);
          clearAll();
          return nativeFetch.apply(this, arguments).finally(clearAll);
        };
      }
      const nativeOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          if (sameOrigin(url) && NC.writeClearsCache(method, url)) {
            this.addEventListener('loadstart', clearAll);
            this.addEventListener('loadend', clearAll);
          }
        } catch (_) { /* ignore */ }
        return nativeOpen.apply(this, arguments);
      };
      document.addEventListener('submit', (e) => {
        const f = e.target;
        if (f && String(f.method || 'get').toLowerCase() !== 'get') clearAll();
      }, true);
      const touched = () => {
        this._lastInputAt = Date.now();
        try { if (!isTop && window.top.spaRouter) window.top.spaRouter._lastInputAt = Date.now(); } catch (_) { /* ignore */ }
      };
      ['input', 'keydown'].forEach((t) => document.addEventListener(t, touched, { capture: true, passive: true }));
      ['input', 'change'].forEach((t) => document.addEventListener(t, (e) => NC.markTouched(e), { capture: true, passive: true }));
      // Using the page again gives the idle warm-up a fresh budget.
      ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => { this._warmThisSession = 0; }, { capture: true, passive: true }));
      window.addEventListener('pageshow', (e) => { if (e.persisted) clearAll(); });
    }

    // ── Progress Indicator ────────────────────────────────────────────

    _showProgress() {
      // One loading signal for the whole app (public/js/pageLoading.js).
      if (window.ManagiraLoading) { window.ManagiraLoading.start(); return; }
      // Both the top bar AND the center spinner are delay-gated, so fast
      // responses (including preloaded ones that arrive between mousedown and
      // click) don't flash any UI at all.
      if (this._topbarTimer) clearTimeout(this._topbarTimer);

      this._topbarTimer = setTimeout(() => {
        let bar = document.getElementById('spa-progress');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'spa-progress';
          document.body.appendChild(bar);
        }
        bar.style.width = '0%';
        bar.classList.add('active');
        requestAnimationFrame(() => { bar.style.width = '70%'; });
      }, CONFIG.TOPBAR_DELAY_MS);

    }

    _hideProgress() {
      if (window.ManagiraLoading) window.ManagiraLoading.stop();
      if (this._topbarTimer) { clearTimeout(this._topbarTimer); this._topbarTimer = null; }

      const bar = document.getElementById('spa-progress');
      if (bar && bar.classList.contains('active')) {
        bar.style.width = '100%';
        setTimeout(() => {
          bar.classList.remove('active');
          bar.style.width = '0%';
        }, 180);
      }
    }

    // ── Route Matching ────────────────────────────────────────────────

    _shouldHandle(path) {
      const clean = this._normalizePath(path).split('?')[0];
      return this.routes.some(route => clean === route || clean.startsWith(route + '/'));
    }

    _isExcluded(path) {
      return EXCLUDED_PATTERNS.some(pattern => path.includes(pattern));
    }

    _isNoCache(path) {
      return NO_CACHE_PATTERNS.some(pattern => path.includes(pattern));
    }

    // ── Utilities ─────────────────────────────────────────────────────

    _normalizePath(path) {
      // Remove trailing slash (except for root)
      let normalized = path.split('#')[0]; // Remove hash
      if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    }

    _abortFetch() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    _wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    _throttle(fn, delay) {
      let lastCall = 0;
      return function (...args) {
        const now = Date.now();
        if (now - lastCall >= delay) {
          lastCall = now;
          fn.apply(this, args);
        }
      };
    }

    // ── Public API ────────────────────────────────────────────────────

    preloadPage(path) {
      this._preload(path);
    }

    // Used by the header menu links: the same rule as a normal link click.
    shouldHandleRoute(path) {
      return !!path && this._shouldHandle(path) && !this._isExcluded(path);
    }
  }

  // ─── Inject Required Styles ───────────────────────────────────────────
  const style = document.createElement('style');
  style.id = 'spa-router-styles';
  style.textContent = `
    /* Progress bar — thin top bar like YouTube/GitHub */
    #spa-progress {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(90deg, #01535b, #0a8f7f, #6fd3c4);
      z-index: 100000;
      width: 0%;
      opacity: 0;
      transition: width 0.3s ease, opacity 0.15s ease;
      pointer-events: none;
      border-radius: 0 2px 2px 0;
    }

    #spa-progress.active {
      opacity: 1;
    }

    #nav-refresh-chip {
      position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 99990;
      padding: 8px 14px; border: 0; border-radius: 999px; background: #01535b; color: #fff;
      font: 600 13px/1.2 system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.25); cursor: pointer;
    }
    #nav-refresh-chip[hidden] { display: none; }
    /* Smooth main content transitions */
    main {
      transition: opacity ${CONFIG.TRANSITION_MS}ms ease;
    }
  `;
  document.head.appendChild(style);

  // ─── Initialize ───────────────────────────────────────────────────────
  function initRouter() {
    window.spaRouter = new SPARouter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRouter);
  } else {
    initRouter();
  }

})();
