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
    MAX_CACHE: 25,
    PRELOAD_DELAY: 150,       // ms before hover-preload fires
    TRANSITION_MS: 120,       // fade out/in duration
    PRELOAD_VISIBLE: true,    // preload links visible in viewport
    SCROLL_BEHAVIOR: 'instant'
  };

  // ─── Route Definitions by User Type ───────────────────────────────────
  const ROUTES_BY_TYPE = {
    public: [
      '/',
      '/account/login',
      '/account/register',
      '/account/forget-password',
      '/common/pricing',
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
      '/common/manageSchoolYear',
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
      '/legal/faq'
    ],
    guardian: [
      '/',
      '/guardian/dashboard',
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
    public: ['/account/login', '/account/register', '/common/pricing'],
    organization: ['/common/orgDashboard', '/common/management', '/account/settings'],
    guardian: ['/guardian/dashboard'],
    hub: ['/hub/dashboard', '/hub/settings'],
    admin: ['/admin/superDashboard', '/admin/superSettings']
  };

  // Routes that should NEVER be SPA-handled (complex forms, file uploads, etc.)
  const EXCLUDED_PATTERNS = [
    '/account/service-plan',
    '/admin/org/',
    '/admin/exit-org',
    'new=1',
    '/common/addStudent',       // Complex form with file uploads
    '/common/registerSchoolYear', // Complex form submissions
    '/stats/organizationStats', // Chart.js initialization
    '/print/reportSettings',    // Dynamic remark sections
    '/print/printStudentReport', // Complex image loading
    '/promotion/applyPromotion' // Cascading dropdowns
  ];

  // ─── SPARouter Class ──────────────────────────────────────────────────
  class SPARouter {
    constructor() {
      this.userType = window.spaUserType || 'public';
      this.routes = ROUTES_BY_TYPE[this.userType] || ROUTES_BY_TYPE.public;
      this.cache = new Map();
      this.isNavigating = false;
      this.currentPath = this._normalizePath(window.location.pathname + window.location.search);
      this.abortController = null;
      this.hoverTimer = null;
      this.visibilityObserver = null;

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

      // 2. Intercept link clicks (single delegated listener)
      document.addEventListener('click', this._onLinkClick.bind(this), true);

      // 3. Hover preloading with debounce
      document.addEventListener('mouseover', this._onLinkHover.bind(this));
      document.addEventListener('mouseout', this._onLinkHoverEnd.bind(this));

      // 4. Touch preloading for mobile
      document.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: true });

      // 5. Handle back/forward buttons — THE critical fix
      window.addEventListener('popstate', this._onPopState.bind(this));

      // 6. Save scroll position before navigating away
      window.addEventListener('scroll', this._throttle(() => {
        if (history.state && history.state.path) {
          const state = { ...history.state, scroll: window.scrollY };
          history.replaceState(state, '', state.path);
        }
      }, 200), { passive: true });

      // 7. Preload priority pages after idle
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => this._preloadPriorityPages(), { timeout: 2000 });
      } else {
        setTimeout(() => this._preloadPriorityPages(), 500);
      }

      // 8. Viewport-based preloading for visible links
      if (CONFIG.PRELOAD_VISIBLE && 'IntersectionObserver' in window) {
        this._initVisibilityPreloading();
      }

      // 9. Prefetch on likely navigation (if browser supports it)
      this._addPrefetchHints();
    }

    // ── Event Handlers ────────────────────────────────────────────────

    _onLinkClick(e) {
      // Only handle left-clicks without modifier keys
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

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
     * Back/Forward button handler — KEY FIX
     * This fires AFTER the URL has already changed, so we just need to
     * load the content for the new URL immediately.
     */
    _onPopState(e) {
      const targetPath = e.state?.path || this._normalizePath(window.location.pathname + window.location.search);

      // Don't re-load if we're already on this path
      if (targetPath === this.currentPath) return;

      // Cancel any in-flight navigation
      this._abortFetch();

      // Load page immediately — no pushState (browser already updated the URL)
      this._loadPage(targetPath, false).then(() => {
        // Restore scroll position if saved
        const savedScroll = e.state?.scroll || 0;
        window.scrollTo({ top: savedScroll, behavior: CONFIG.SCROLL_BEHAVIOR });
      }).catch(() => {
        // Fallback: full page reload
        window.location.reload();
      });
    }

    // ── Navigation ────────────────────────────────────────────────────

    async navigate(path) {
      const normalizedPath = this._normalizePath(path);

      // Don't navigate to current page
      if (normalizedPath === this.currentPath) return;

      // Prevent overlapping navigations
      if (this.isNavigating) {
        this._abortFetch();
      }

      this.isNavigating = true;

      // Show loading only for uncached pages
      const isCached = this.cache.has(normalizedPath);
      if (!isCached) {
        this._showProgress();
      }

      try {
        await this._loadPage(normalizedPath, true);
        // Push new state
        window.history.pushState(
          { path: normalizedPath, scroll: 0 },
          '',
          normalizedPath
        );
        // Scroll to top
        window.scrollTo({ top: 0, behavior: CONFIG.SCROLL_BEHAVIOR });
      } catch (err) {
        // Fallback to full navigation
        window.location.href = path;
      } finally {
        this.isNavigating = false;
        this._hideProgress();
      }
    }

    async _loadPage(path, isForwardNav) {
      const normalizedPath = this._normalizePath(path);

      try {
        let html = this.cache.get(normalizedPath);

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
          this._cacheSet(normalizedPath, html);
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

      // Sync body data attributes/classes so page-scoped styles apply (e.g., public dashboard themes)
      this._syncBodyAttributes(newBody);

      // 1. Update page title
      const newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      // 2. Update page-specific styles
      this._updateStyles(doc);

      // 3. Fade out current content
      currentMain.style.transition = `opacity ${CONFIG.TRANSITION_MS}ms ease`;
      currentMain.style.opacity = '0';
      await this._wait(CONFIG.TRANSITION_MS);

      // 4. Swap content
      currentMain.innerHTML = newMain.innerHTML;

      // 5. Process new content
      this._processImages(currentMain);
      this._processVideos(currentMain);
      await this._executeScripts(currentMain);
      this._reinitializeHandlers(currentMain);

      // 6. Fade in
      // Use rAF to ensure the browser has painted the new content
      requestAnimationFrame(() => {
        currentMain.style.opacity = '1';
      });

      // 7. Update meta tags
      this._updateMetaTags(doc);

      // 8. Update header active states
      this._updateHeaderActiveState(path);

      // 9. Update footer visibility
      this._updateFooter(doc);

      // 10. Notify other scripts
      this._dispatchEvents(path);

      // 11. Re-observe new links for viewport preloading
      if (this.visibilityObserver) {
        this._observeLinks(currentMain);
      }
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
            e.preventDefault();
            const target = document.querySelector(this.dataset.toggle);
            if (target) target.classList.toggle('hidden');
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
      // Remove previous page-specific styles
      document.querySelectorAll('style[data-spa-style]').forEach(s => s.remove());

      // Get styles from the new page's body (page-specific inline styles)
      const newBody = doc.querySelector('body');
      if (newBody) {
        newBody.querySelectorAll('style').forEach(styleTag => {
          const newStyle = document.createElement('style');
          newStyle.textContent = styleTag.textContent;
          newStyle.setAttribute('data-spa-style', 'true');
          document.head.appendChild(newStyle);
        });
      }

      // Also check for styles in head that are page-specific
      doc.querySelectorAll('head style').forEach(styleTag => {
        // Skip only turbo-progress-bar styles (these are global)
        const content = styleTag.textContent;
        if (content.includes('turbo-progress-bar')) return;
        
        const newStyle = document.createElement('style');
        newStyle.textContent = content;
        newStyle.setAttribute('data-spa-style', 'true');
        document.head.appendChild(newStyle);
      });
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
    }

    // ── Event Dispatch ────────────────────────────────────────────────

    _dispatchEvents(path) {
      window.dispatchEvent(new CustomEvent('spa:pageLoaded', {
        detail: { path, timestamp: Date.now() }
      }));

      // Trigger Turbo-compatible event
      window.dispatchEvent(new CustomEvent('turbo:load'));
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
      if (this.cache.has(normalized)) return;

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
        .catch(() => { /* Silently fail preloads */ });
    }

    _preloadPriorityPages() {
      const pages = PRELOAD_PRIORITY[this.userType] || PRELOAD_PRIORITY.public;
      pages.forEach(page => {
        if (page !== this.currentPath) {
          this._preload(page);
        }
      });
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
      const pages = PRELOAD_PRIORITY[this.userType] || PRELOAD_PRIORITY.public;
      pages.forEach(page => {
        if (page !== this.currentPath && !document.querySelector(`link[rel="prefetch"][href="${page}"]`)) {
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = page;
          link.as = 'document';
          document.head.appendChild(link);
        }
      });
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
      let bar = document.getElementById('spa-progress');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'spa-progress';
        document.body.appendChild(bar);
      }
      bar.style.width = '0%';
      bar.classList.add('active');
      // Animate to 70% quickly
      requestAnimationFrame(() => {
        bar.style.width = '70%';
      });
    }

    _hideProgress() {
      const bar = document.getElementById('spa-progress');
      if (bar) {
        bar.style.width = '100%';
        setTimeout(() => {
          bar.classList.remove('active');
          bar.style.width = '0%';
        }, 200);
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
