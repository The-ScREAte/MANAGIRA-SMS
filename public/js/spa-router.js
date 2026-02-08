/**
 * SPA Router - Client-side navigation without page reloads
 * Handles smooth transitions with role-based route loading for optimal performance
 */

class SPARouter {
  constructor() {
    // Detect user type from session (injected in head.ejs)
    this.userType = window.spaUserType || 'public';
    
    // Define routes by user type - only load what each user needs
    this.routesByType = {
      // Public/Unauthenticated users - auth and legal pages only
      public: [
        '/account/login',
        '/account/register',
        '/common/pricing',
        '/hub/login',
        '/account/guardian-login',
        '/account/reset-password',
        '/legal/help',
        '/legal/employment',
        '/legal/donations',
        '/legal/about-us',
        '/legal/privacy-policy',
        '/legal/terms-of-service',
        '/legal/faq'
      ],
      
      // Organization users - full org management suite
      organization: [
        '/common/orgDashboard',
        '/common/management',
        '/common/publicDashboard',  // School Website
        '/common/admissions',        // Admissions
        '/common/reports',           // Reports
        '/account/settings',         // Settings
        '/common/studentDetails',
        '/common/studentInfo',
        // '/common/addStudent', // Removed: Complex dynamic forms, guardian autocomplete, file uploads
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
        // '/common/registerSchoolYear', // Removed: Complex form submission handlers
        '/common/closeSchoolYear',
        '/common/termDetails',
        '/common/attendanceCollection',
        // '/stats/organizationStats', // Removed: Chart.js initialization, complex toggles
        // '/print/reportSettings', // Removed: Dynamic remark sections
        // '/print/printStudentReport', // Removed: Complex image loading, inline handlers
        '/print/transcript',
        '/print/modifyStatusSettings',
        '/print/meritSheetPage',
        '/print/migration',
        // '/enrollment/enrollment', // Removed: Complex form interactions
        // '/enrollment/manageEnrollment', // Removed: Complex form interactions
        // '/enrollment/modifyEnrollment', // Removed: Complex form interactions
        // '/promotion/applyPromotion', // Removed: Cascading dropdowns, onclick handlers
        '/promotion/closeGraduationYearGroup'
      ],
      
      // Guardian/Parent users - parent portal only
      guardian: [
        '/guardian/dashboard',
        '/guardian/academic-details',
        '/guardian/student',
        '/guardian/studentDetails',
        '/guardian/settings',        // Settings
        '/guardian/report',
        '/guardian/reports'
      ],
      
      // Hub users - hub management only
      hub: [
        '/hub/dashboard',             // Dashboard
        '/hub/settings',              // Settings
        '/hub/organizations/invite',  // Invite organizations
        '/hub/organizations/search',
        '/hub/organizations/edit',
        '/hub/setup-password'
      ],
      
      // Admin users - admin panel only
      admin: [
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
        '/admin/editAdminUser'
      ]
    };
    
    // Get routes for current user type
    this.routes = this.routesByType[this.userType] || this.routesByType.public;
    
    this.isNavigating = false;
    this.cache = new Map();
    this.init();
  }

  init() {
    // Intercept link clicks
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) {
        return;
      }

      // Skip SPA handling for special flows that rely on full reload (e.g., new=1 resets)
      if (href.includes('new=1') || href.startsWith('/account/service-plan') || href.includes('/admin/org/') || href.includes('/admin/exit-org')) {
        return; // allow normal navigation
      }

      // Check if this is a route we should handle
      if (this.shouldHandleRoute(href)) {
        e.preventDefault();
        this.navigate(href);
      }
    });

    // Preload on hover for instant navigation
    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (href && this.shouldHandleRoute(href)) {
        this.preloadPage(href);
      }
    });

    // Handle browser back/forward buttons
    window.addEventListener('popstate', async (e) => {
      if (e.state && e.state.path) {
        // Prevent duplicate navigation
        if (this.isNavigating) return;
        
        this.isNavigating = true;
        
        try {
          await this.loadPage(e.state.path, false);
        } catch (error) {
          // If SPA fails, do a full page reload
          window.location.href = e.state.path;
        } finally {
          this.isNavigating = false;
        }
      } else {
        // If no state, reload the current URL
        const currentPath = window.location.pathname + window.location.search;
        if (this.shouldHandleRoute(currentPath)) {
          this.isNavigating = true;
          try {
            await this.loadPage(currentPath, false);
          } catch (error) {
            window.location.reload();
          } finally {
            this.isNavigating = false;
          }
        } else {
          // Not an SPA route, do full reload
          window.location.reload();
        }
      }
    });

    // Save initial state
    const currentPath = window.location.pathname + window.location.search;
    if (this.shouldHandleRoute(currentPath)) {
      window.history.replaceState({ path: currentPath }, '', currentPath);
    }

    // Preload common pages immediately for instant navigation
    setTimeout(() => {
      this.preloadCommonPages();
    }, 300);  // Reduced from 500ms to 300ms for faster initial preloading
  }

  preloadCommonPages() {
    // Preload only pages relevant to current user type for optimal performance
    const preloadByType = {
      public: [
        '/account/login',
        '/account/register',
        '/common/pricing'
      ],
      organization: [
        '/common/orgDashboard',
        '/common/management',          // Preload Management Tools
        '/common/reports',             // Preload Reports
        '/account/settings',           // Preload Settings
        '/common/publicDashboard',     // Preload School Website
        '/common/admissions',          // Preload Admissions
        '/common/classDashboard',
        '/common/studentDetails',
        '/common/assessment'
      ],
      guardian: [
        '/guardian/dashboard',
        '/guardian/student',
        '/guardian/academic-details',
        '/guardian/reports',
        '/guardian/settings'           // Preload Settings
      ],
      hub: [
        '/hub/dashboard',              // Preload Dashboard
        '/hub/settings'                // Preload Settings
      ],
      admin: [
        '/admin/superDashboard',
        '/admin/superSettings',
        '/admin/helpMessages'
      ]
    };
    
    const commonPages = preloadByType[this.userType] || preloadByType.public;
    
    commonPages.forEach(page => {
      if (page !== window.location.pathname) {
        this.preloadPage(page);
      }
    });
  }

  shouldHandleRoute(path) {
    // Strip query parameters for route matching
    const pathWithoutQuery = path.split('?')[0];
    
    // Check if route is in user's allowed routes
    const isAllowed = this.routes.some(route => 
      pathWithoutQuery === route || pathWithoutQuery.startsWith(route)
    );
    
    return isAllowed;
  }

  async navigate(path) {
    if (this.isNavigating) return;
    
    this.isNavigating = true;
    
    // Only show spinner if page is not cached
    const isCached = this.cache.has(path);
    if (!isCached) {
      this.showLoadingOverlay();
    }

    try {
      await this.loadPage(path, true);
      window.history.pushState({ path }, '', path);
    } catch (error) {
      // Fallback to traditional navigation
      window.location.href = path;
    } finally {
      this.isNavigating = false;
      if (!isCached) {
        this.hideLoadingOverlay();
      }
    }
  }

  async loadPage(path, addToHistory = true) {
    try {
      // Check cache first
      let html = this.cache.get(path);
      
      if (!html) {
        const response = await fetch(path, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        html = await response.text();
        
        // Cache the page (max 20 pages for better performance)
        if (this.cache.size >= 20) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.cache.set(path, html);
      }

      // Parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Update page title
      const newTitle = doc.querySelector('title');
      if (newTitle) {
        document.title = newTitle.textContent;
      }

      // Update styles from the new page
      this.updateStyles(doc);

      // Update main content
      const newMain = doc.querySelector('main');
      const currentMain = document.querySelector('main');
      
      if (newMain && currentMain) {
        // Instant transition for cached pages, ultra-fast fade for new pages
        const isCached = this.cache.has(path);
        const fadeTime = isCached ? 0 : 50;  // Reduced from 80ms to 50ms
        
        if (fadeTime > 0) {
          currentMain.style.opacity = '0';
          await new Promise(resolve => setTimeout(resolve, fadeTime));
        }
        
        currentMain.innerHTML = newMain.innerHTML;
        
        // Fix images by forcing reload
        this.reloadImages(currentMain);
        
        // Re-execute scripts from the new content
        this.executeScripts(currentMain);
        
        // Show content instantly
        currentMain.style.opacity = '1';
        
        // Scroll to top instantly
        window.scrollTo({ top: 0, behavior: 'instant' });

        // Update meta tags
        this.updateMetaTags(doc);
        
        // Handle sticky nav visibility based on page
        const stickyNav = document.querySelector('.sticky-nav');
        const isPublicDashboard = path.includes('/publicDashboard');
        if (stickyNav) {
          stickyNav.style.display = isPublicDashboard ? '' : 'none';
        }

        // Trigger DOMContentLoaded for scripts that rely on it
        document.dispatchEvent(new Event('DOMContentLoaded'));
        
        // Reinitialize header menu (hamburger) after SPA navigation
        if (typeof window.initHeaderMenu === 'function') {
          window.initHeaderMenu();
        }
        
        // Reinitialize logo SPA navigation after SPA navigation
        if (typeof window.initLogoSPANavigation === 'function') {
          window.initLogoSPANavigation();
        }
        
        // Dispatch custom event for other scripts to hook into
        window.dispatchEvent(new CustomEvent('spa:pageLoaded', { 
          detail: { path } 
        }));
      }
    } catch (error) {
      throw error;
    }
  }

  reloadImages(container) {
    // Force reload all images to ensure they display properly
    const images = container.querySelectorAll('img');
    images.forEach(img => {
      const src = img.getAttribute('src');
      if (src) {
        // Create a new image to force browser to reload
        const newImg = new Image();
        newImg.onload = () => {
          // Add cache-busting parameter to force reload
          const cacheBuster = src.includes('?') ? '&' : '?';
          img.src = src + cacheBuster + '_t=' + Date.now();
          img.style.opacity = '1';
        };
        newImg.onerror = () => {
          // Even on error, show the image placeholder
          img.style.opacity = '1';
        };
        img.style.opacity = '0.3';
        newImg.src = src;
        
        // Handle images with srcset
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          img.setAttribute('srcset', srcset);
        }
      }
    });
    
    // Handle background images in style attributes with cache-busting
    const elementsWithBgImages = container.querySelectorAll('[style*="background-image"]');
    elementsWithBgImages.forEach(el => {
      const style = el.style.backgroundImage;
      if (style && style.includes('url(')) {
        const urlMatch = style.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const url = urlMatch[1];
          const cacheBuster = url.includes('?') ? '&' : '?';
          el.style.backgroundImage = `url(${url}${cacheBuster}_t=${Date.now()})`;
        }
      }
    });
    
    // Handle CSS background-image from stylesheets
    const elementsWithComputedBg = container.querySelectorAll('*');
    elementsWithComputedBg.forEach(el => {
      const computed = window.getComputedStyle(el);
      const bgImage = computed.backgroundImage;
      if (bgImage && bgImage !== 'none' && bgImage.includes('url(') && !el.style.backgroundImage) {
        // For elements with CSS background, force repaint
        el.style.backgroundImage = bgImage;
        const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          const url = urlMatch[1];
          const cacheBuster = url.includes('?') ? '&' : '?';
          el.style.backgroundImage = `url(${url}${cacheBuster}_t=${Date.now()})`;
        }
      }
    });
  }

  updateStyles(doc) {
    // Get all inline style tags from the new page
    const newStyles = doc.querySelectorAll('style');
    
    // Remove old page-specific styles (but keep global ones from head.ejs)
    const existingStyles = document.querySelectorAll('style[data-page-style]');
    existingStyles.forEach(style => style.remove());
    
    // Add new page styles
    newStyles.forEach(styleTag => {
      const newStyle = document.createElement('style');
      newStyle.textContent = styleTag.textContent;
      newStyle.setAttribute('data-page-style', 'true');
      document.head.appendChild(newStyle);
    });
  }

  executeScripts(container) {
    const scripts = container.querySelectorAll('script');
    const scriptsToExecute = [];
    
    // Remove old scripts and collect new ones
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      
      // Copy all attributes
      Array.from(oldScript.attributes).forEach(attr => {
        newScript.setAttribute(attr.name, attr.value);
      });
      
      // Copy content for inline scripts
      if (!oldScript.src) {
        newScript.textContent = oldScript.textContent;
      }
      
      scriptsToExecute.push(newScript);
      
      // Replace old script with new one in the DOM
      if (oldScript.parentNode) {
        oldScript.parentNode.replaceChild(newScript, oldScript);
      }
    });
    
    // Execute inline scripts in the global scope
    scriptsToExecute.forEach(script => {
      if (!script.src && script.textContent) {
        try {
          // Execute in global scope using Function constructor
          const scriptFunc = new Function(script.textContent);
          scriptFunc.call(window);
        } catch (e) {
          // Silently fail
        }
      }
    });

    // ⭐ KEY FIX: Dispatch DOMContentLoaded event for scripts expecting it
    setTimeout(() => {
      const domContentLoadedEvent = new Event('DOMContentLoaded', {
        bubbles: true,
        cancelable: false
      });
      document.dispatchEvent(domContentLoadedEvent);
      
      // Also dispatch on the container for scoped listeners
      if (container) {
        container.dispatchEvent(domContentLoadedEvent);
      }
    }, 10);

    // Re-initialize common functionality
    this.reinitializeCommonScripts();
  }

  reinitializeCommonScripts() {
    // Re-attach password toggle functionality
    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
      if (!btn.hasAttribute('data-initialized')) {
        btn.setAttribute('data-initialized', 'true');
        btn.addEventListener('click', function() {
          const wrapper = this.closest('.password-input-wrapper');
          const input = wrapper ? wrapper.querySelector('input') : null;
          const icon = this.querySelector('i');
          
          if (input && icon) {
            if (input.type === 'password') {
              input.type = 'text';
              icon.classList.remove('fa-eye');
              icon.classList.add('fa-eye-slash');
            } else {
              input.type = 'password';
              icon.classList.remove('fa-eye-slash');
              icon.classList.add('fa-eye');
            }
          }
        });
      }
    });

    // Re-initialize any forms that need AJAX submission
    document.querySelectorAll('form[data-ajax]').forEach(form => {
      if (!form.hasAttribute('data-initialized')) {
        form.setAttribute('data-initialized', 'true');
        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          const formData = new FormData(this);
          const method = this.method || 'POST';
          const action = this.action;
          
          try {
            const response = await fetch(action, {
              method: method,
              body: formData,
              headers: {
                'X-Requested-With': 'XMLHttpRequest'
              }
            });
            
            if (response.redirected) {
              window.location.href = response.url;
            }
          } catch (error) {
            // Silently fail
          }
        });
      }
    });
    
    // ⭐ KEY FIX: Convert inline onclick handlers to proper event listeners
    document.querySelectorAll('[onclick]').forEach(element => {
      const onclickAttr = element.getAttribute('onclick');
      if (onclickAttr && !element.hasAttribute('data-onclick-initialized')) {
        element.setAttribute('data-onclick-initialized', 'true');
        
        // Remove the onclick attribute to prevent double execution
        element.removeAttribute('onclick');
        
        // Add proper event listener that executes in global scope
        element.addEventListener('click', function(event) {
          try {
            // Execute the onclick code in global scope with proper context
            const func = new Function('event', onclickAttr);
            func.call(this, event);
          } catch (e) {
            // Silently fail
          }
        });
      }
    });
    
    // ⭐ KEY FIX: Convert inline onchange handlers to proper event listeners
    document.querySelectorAll('[onchange]').forEach(element => {
      const onchangeAttr = element.getAttribute('onchange');
      if (onchangeAttr && !element.hasAttribute('data-onchange-initialized')) {
        element.setAttribute('data-onchange-initialized', 'true');
        
        // Remove the onchange attribute to prevent double execution
        element.removeAttribute('onchange');
        
        // Add proper event listener that executes in global scope
        element.addEventListener('change', function(event) {
          try {
            // Execute the onchange code in global scope with proper context
            const func = new Function('event', onchangeAttr);
            func.call(this, event);
          } catch (e) {
            // Silently fail
          }
        });
      }
    });
    
    // ⭐ KEY FIX: Convert inline onsubmit handlers to proper event listeners
    document.querySelectorAll('form[onsubmit]').forEach(form => {
      const onsubmitAttr = form.getAttribute('onsubmit');
      if (onsubmitAttr && !form.hasAttribute('data-onsubmit-initialized')) {
        form.setAttribute('data-onsubmit-initialized', 'true');
        
        // Remove the onsubmit attribute
        form.removeAttribute('onsubmit');
        
        // Add proper event listener
        form.addEventListener('submit', function(event) {
          try {
            const func = new Function('event', onsubmitAttr);
            const result = func.call(this, event);
            // If the function returns false, prevent default
            if (result === false) {
              event.preventDefault();
            }
          } catch (e) {
            // Silently fail
          }
        });
      }
    });
    
    // Re-initialize select dropdowns that may have change listeners
    document.querySelectorAll('select[data-listener]').forEach(select => {
      if (!select.hasAttribute('data-initialized')) {
        select.setAttribute('data-initialized', 'true');
        // Dispatch change event to trigger any listeners
        const event = new Event('change', { bubbles: true });
        select.dispatchEvent(event);
      }
    });
  }

  updateMetaTags(doc) {
    // Update description
    const newDesc = doc.querySelector('meta[name="description"]');
    const currentDesc = document.querySelector('meta[name="description"]');
    if (newDesc && currentDesc) {
      currentDesc.setAttribute('content', newDesc.getAttribute('content'));
    }

    // Update keywords
    const newKeywords = doc.querySelector('meta[name="keywords"]');
    const currentKeywords = document.querySelector('meta[name="keywords"]');
    if (newKeywords && currentKeywords) {
      currentKeywords.setAttribute('content', newKeywords.getAttribute('content'));
    }

    // Update OG tags
    ['og:title', 'og:description', 'og:url'].forEach(property => {
      const newTag = doc.querySelector(`meta[property="${property}"]`);
      const currentTag = document.querySelector(`meta[property="${property}"]`);
      if (newTag && currentTag) {
        currentTag.setAttribute('content', newTag.getAttribute('content'));
      }
    });
  }

  showLoadingOverlay() {
    let overlay = document.querySelector('.spa-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'spa-loading-overlay';
      overlay.innerHTML = '<div class="spa-spinner"></div>';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    // Force reflow for transition
    overlay.offsetHeight;
    overlay.classList.add('visible');
    
    // Show fast mode indicator
    const indicator = document.querySelector('.spa-active-indicator');
    if (indicator) {
      indicator.classList.add('show');
    }
  }

  hideLoadingOverlay() {
    const overlay = document.querySelector('.spa-loading-overlay');
    if (overlay) {
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 100);
    }
    
    // Hide indicator after a short delay
    const indicator = document.querySelector('.spa-active-indicator');
    if (indicator) {
      setTimeout(() => {
        indicator.classList.remove('show');
      }, 500);
    }
  }

  clearCache() {
    this.cache.clear();
  }

  preloadPage(path) {
    if (!this.cache.has(path) && this.shouldHandleRoute(path)) {
      fetch(path, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/html'
        }
      })
      .then(response => response.text())
      .then(html => {
        if (this.cache.size < 10) {
          this.cache.set(path, html);
        }
      })
      .catch(err => {});
    }
  }
}

// Initialize router when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.spaRouter = new SPARouter();
  });
} else {
  window.spaRouter = new SPARouter();
}

// Add required CSS styles
const style = document.createElement('style');
style.textContent = `
  .spa-loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.7);
    display: none;
    justify-content: center;
    align-items: center;
    z-index: 99999;
    opacity: 0;
    transition: opacity 0.08s ease-out;
  }

  .spa-loading-overlay.visible {
    opacity: 1;
  }

  .spa-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #f3f3f3;
    border-top: 3px solid #01535b;
    border-radius: 50%;
    animation: spa-spin 0.5s linear infinite;
  }

  @keyframes spa-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  main {
    transition: opacity 0.05s ease-out;
  }

  main img {
    transition: opacity 0.15s ease-in;
  }

  /* Optional: Add a subtle indicator that SPA is active */
  .spa-active-indicator {
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: rgba(1, 83, 91, 0.9);
    color: white;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .spa-active-indicator.show {
    opacity: 1;
  }
`;
document.head.appendChild(style);

// Add optional indicator (hidden by default, shows during navigation)
const indicator = document.createElement('div');
indicator.className = 'spa-active-indicator';
indicator.textContent = '⚡ Fast Mode';
document.body.appendChild(indicator);
