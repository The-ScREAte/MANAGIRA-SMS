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
    PRELOAD_DELAY: 50,         // ms before hover-preload fires (was 200)
    TRANSITION_MS: 120,        // fade out/in duration (skipped on cache hits)
    PRELOAD_VISIBLE: false,    // disabled: caused preload stampede on dashboards
    SCROLL_BEHAVIOR: 'instant',
    SPINNER_DELAY_MS: 350,     // show center spinner only if nav takes longer than this
    TOPBAR_DELAY_MS: 120,      // show top progress bar only if nav takes longer than this
    MAX_CONCURRENT_PRELOADS: 3 // cap to avoid saturating the browser / server
  };

  // ─── Route Definitions by User Type ───────────────────────────────────
  const ROUTES_BY_TYPE = {
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
      '/account/cancel-subscription',
      '/common/studentDetails',
      '/common/studentInfo',
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
      '/print/transcript',
      '/print/modifyStatusSettings',
      '/print/meritSheetPage',
      '/print/migration',
      '/print/emailHistoryPage',
      '/promotion/apply',
      '/promotion/closeGraduationYearGroup',
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
      '/guardian/studentDetails',
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
    '/promotion/applyPromotion', // Cascading dropdowns
    '/common/createEmployee',    // File uploads
    '/common/modifyEmployee',    // File uploads
    '/common/createTest',        // Rich editor
    '/common/editTest',          // Rich editor
    '/account/managePublicContent', // Quill editor + image uploads
    '/account/personalization',  // Theme switching with full reload
    '/common/reports'            // Dynamic filters + tables; safer to full-load
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
      this.cache = new Map();
      this.isNavigating = false;
      this.currentPath = this._normalizePath(window.location.pathname + window.location.search);
      this.pendingHash = '';
      this.abortController = null;
      this.hoverTimer = null;
      this.visibilityObserver = null;

      // Track in-flight preloads so we can cap concurrency and dedupe.
      this._preloadsInFlight = new Set();
      // Track in-flight navigation fetches keyed by path (request dedupe).
      this._pendingNavigations = new Map();
      // Spinner-delay timer (set by _showProgress, cleared by _hideProgress).
      this._spinnerTimer = null;
      // Whether the current swap may skip the fade (cache hits skip it).
      this._skipFade = false;

      this._init();
    }

    // ── Initialization ────────────────────────────────────────────────
    _init() {
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
      this.hoverTimer = setTimeout(() => {
        this._preload(href);
      }, CONFIG.PRELOAD_DELAY);
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

      const normalizedPath = this._normalizePath(rawPath);
      this.pendingHash = hashFragment ? decodeURIComponent(hashFragment) : '';

      // Don't navigate to current page
      if (normalizedPath === this.currentPath) return;

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
      const isCached = this.cache.has(normalizedPath) && !this._isNoCache(normalizedPath);
      this._skipFade = isCached;
      if (!isCached) {
        this._showProgress();
      }

      const navPromise = (async () => {
        try {
          await this._loadPage(normalizedPath, true);
          window.history.pushState(
            { path: normalizedPath, scroll: 0 },
            '',
            `${normalizedPath}${this.pendingHash ? `#${encodeURIComponent(this.pendingHash)}` : ''}`
          );

          if (this.pendingHash) {
            this._scrollToHash(this.pendingHash, false);
            this.pendingHash = '';
          } else {
            window.scrollTo({ top: 0, behavior: CONFIG.SCROLL_BEHAVIOR });
          }
        } catch (err) {
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
        let html = noCache ? null : this.cache.get(normalizedPath);

        if (!html) {
          this.abortController = new AbortController();

          const response = await fetch(path, {
            signal: this.abortController.signal,
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': 'text/html'
            }
          });

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          html = await response.text();
          if (!noCache) this._cacheSet(normalizedPath, html);
        }

        // Parse response
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Pause any playing videos/audio before swap
        this._pauseMedia();

        // Perform the content swap with transition
        await this._swapContent(doc, normalizedPath);

        // Update current path tracking
        this.currentPath = normalizedPath;

      } catch (err) {
        if (err.name === 'AbortError') return; // Intentionally cancelled
        throw err;
      }
    }

    // ── Content Swap ──────────────────────────────────────────────────

    async _swapContent(doc, path) {
      const currentMain = document.querySelector('main');
      const newMain = doc.querySelector('main');
      const newBody = doc.querySelector('body');

      if (!currentMain || !newMain) {
        throw new Error('Missing <main> element');
      }

      // 0. Run any cleanup callbacks registered by the outgoing page.
      //    Page scripts can push disposers into window.__spaCleanup to dispose
      //    intervals, event listeners, charts, editors, etc.
      if (Array.isArray(window.__spaCleanup)) {
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

      const shouldFade = !this._skipFade;
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
      currentMain.innerHTML = newMain.innerHTML;

      // 5. Process new content
      this._processImages(currentMain);
      this._processVideos(currentMain);
      await this._executeScripts(currentMain);
      this._reinitializeHandlers(currentMain);

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

      // 11. Notify other scripts
      this._dispatchEvents(path);

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
      schedule(() => this._preloadPriorityPages());
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

      for (const oldScript of scripts) {
        const newScript = document.createElement('script');

        // Copy attributes
        Array.from(oldScript.attributes).forEach(attr => {
          newScript.setAttribute(attr.name, attr.value);
        });

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

    // ── Reinitialize Event Handlers ───────────────────────────────────

    _reinitializeHandlers(container) {
      // Re-attach inline onclick handlers as proper listeners
      container.querySelectorAll('[onclick]').forEach(el => {
        const handler = el.getAttribute('onclick');
        if (handler && !el.hasAttribute('data-spa-bound')) {
          el.setAttribute('data-spa-bound', '1');
          el.removeAttribute('onclick');
          el.addEventListener('click', function (event) {
            try {
              new Function('event', handler).call(this, event);
            } catch (e) { /* ignore */ }
          });
        }
      });

      // Re-attach inline onchange handlers
      container.querySelectorAll('[onchange]').forEach(el => {
        const handler = el.getAttribute('onchange');
        if (handler && !el.hasAttribute('data-spa-bound-change')) {
          el.setAttribute('data-spa-bound-change', '1');
          el.removeAttribute('onchange');
          el.addEventListener('change', function (event) {
            try {
              new Function('event', handler).call(this, event);
            } catch (e) { /* ignore */ }
          });
        }
      });

      // Re-attach inline onsubmit handlers
      container.querySelectorAll('form[onsubmit]').forEach(form => {
        const handler = form.getAttribute('onsubmit');
        if (handler && !form.hasAttribute('data-spa-bound-submit')) {
          form.setAttribute('data-spa-bound-submit', '1');
          form.removeAttribute('onsubmit');
          form.addEventListener('submit', function (event) {
            try {
              const result = new Function('event', handler).call(this, event);
              if (result === false) event.preventDefault();
            } catch (e) { /* ignore */ }
          });
        }
      });

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
            if (!confirm(this.dataset.confirm)) {
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
        stickyNav.style.display = path.includes('/publicDashboard') ? '' : 'none';
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

    _dispatchEvents(path) {
      window.dispatchEvent(new CustomEvent('spa:pageLoaded', {
        detail: { path, timestamp: Date.now() }
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

    _preload(path) {
      const normalized = this._normalizePath(path);
      if (this._isNoCache(normalized)) return;
      if (this.cache.has(normalized)) return;
      if (this._preloadsInFlight.has(normalized)) return;
      if (this._preloadsInFlight.size >= CONFIG.MAX_CONCURRENT_PRELOADS) return;

      this._preloadsInFlight.add(normalized);

      fetch(path, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/html'
        },
        priority: 'low'
      })
        .then(res => {
          if (res.ok) return res.text();
          throw new Error('Preload failed');
        })
        .then(html => this._cacheSet(normalized, html))
        .catch(() => { /* Silently fail preloads */ })
        .finally(() => { this._preloadsInFlight.delete(normalized); });
    }

    _preloadPriorityPages() {
      const pages = PRELOAD_PRIORITY[this.userType] || PRELOAD_PRIORITY.public;
      pages.forEach(page => {
        if (page !== this.currentPath) {
          this._preload(page);
        }
      });

      this._preloadClassDashboardsFromOrgDashboard();

      // Also warm any SPA-able link currently rendered on screen (nav menus,
      // sidebars, tabs). Scheduled on idle so it never competes with the user.
      const schedule = (cb) => ('requestIdleCallback' in window)
        ? requestIdleCallback(cb, { timeout: 4000 })
        : setTimeout(cb, 600);

      schedule(() => {
        const seen = new Set();
        document.querySelectorAll('header a[href], nav a[href], .sidebar a[href], aside a[href]').forEach(link => {
          const href = link.getAttribute('href');
          if (!href || seen.has(href)) return;
          seen.add(href);
          if (this._shouldHandle(href) && !this._isExcluded(href)) {
            this._preload(href);
          }
        });
      });

      // NOTE: We intentionally do NOT warm *every* route for this user type.
      // That background sweep fired a full server render for each route on
      // first load and after every navigation, flooding the server and the
      // browser's connection pool so the user's actual click had to queue
      // behind it. Hover/mousedown + the priority + visible-link preloads
      // already keep the common pages hot without the request storm.
    }

    _preloadClassDashboardsFromOrgDashboard() {
      if (this.userType !== 'organization') return;
      if (!this.currentPath.startsWith('/common/orgDashboard')) return;

      const classLinks = Array.from(
        document.querySelectorAll('[data-od-classes] a[href^="/common/classDashboard?classId="], .classes-container a[href^="/common/classDashboard?classId="]')
      );

      if (classLinks.length === 0) return;

      const queue = [];
      const seen = new Set();

      classLinks.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href || seen.has(href)) return;
        seen.add(href);
        if (!this._shouldHandle(href) || this._isExcluded(href)) return;
        const normalized = this._normalizePath(href);
        if (this.cache.has(normalized) || this._preloadsInFlight.has(normalized)) return;
        queue.push(href);
      });

      if (queue.length === 0) return;

      const schedule = (cb) => ('requestIdleCallback' in window)
        ? requestIdleCallback(cb, { timeout: 5000 })
        : setTimeout(cb, 500);

      const pump = () => {
        if (queue.length === 0) return;
        if (this.isNavigating) {
          schedule(pump);
          return;
        }
        if (this._preloadsInFlight.size >= CONFIG.MAX_CONCURRENT_PRELOADS) {
          schedule(pump);
          return;
        }

        const next = queue.shift();
        if (next) {
          this._preload(next);
        }
        schedule(pump);
      };

      schedule(pump);
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
        if (!this.cache.has(this._normalizePath(next))) {
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

    _cacheSet(path, html) {
      // Evict oldest if at capacity
      if (this.cache.size >= CONFIG.MAX_CACHE) {
        const oldest = this.cache.keys().next().value;
        this.cache.delete(oldest);
      }
      this.cache.set(path, html);
    }

    clearCache() {
      this.cache.clear();
    }

    // ── Progress Indicator ────────────────────────────────────────────

    _showProgress() {
      // Both the top bar AND the center spinner are delay-gated, so fast
      // responses (including preloaded ones that arrive between mousedown and
      // click) don't flash any UI at all.
      if (this._topbarTimer) clearTimeout(this._topbarTimer);
      if (this._spinnerTimer) clearTimeout(this._spinnerTimer);

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

      this._spinnerTimer = setTimeout(() => {
        let overlay = document.querySelector('.page-loading-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'page-loading-overlay';
          overlay.innerHTML = '<div class="spinner" aria-label="Loading"></div>';
          document.body.appendChild(overlay);
        }
        overlay.classList.add('active');
      }, CONFIG.SPINNER_DELAY_MS);
    }

    _hideProgress() {
      if (this._topbarTimer) { clearTimeout(this._topbarTimer); this._topbarTimer = null; }
      if (this._spinnerTimer) { clearTimeout(this._spinnerTimer); this._spinnerTimer = null; }

      const overlay = document.querySelector('.page-loading-overlay');
      if (overlay) overlay.classList.remove('active');

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
