// The header's menu. Moved out of the page so browsers keep it between pages.
function initHeaderMenu() {
    const parseRgbChannels = (value) => {
      if (!value) return null;
      const match = String(value).match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const channels = match[1].split(',').map((part) => Number(part.trim()));
      if (channels.length < 3 || channels.some((part) => Number.isNaN(part))) return null;
      return {
        r: channels[0],
        g: channels[1],
        b: channels[2],
        a: Number.isFinite(channels[3]) ? channels[3] : 1
      };
    };

    const relativeLuminance = (r, g, b) => {
      const normalize = (channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      };
      return (0.2126 * normalize(r)) + (0.7152 * normalize(g)) + (0.0722 * normalize(b));
    };

    const applyPublicHeaderContrast = (headerElement) => {
      if (!headerElement || !headerElement.classList.contains('public-header-mode')) return;
      if (headerElement.classList.contains('homepage-overlay-enabled')) {
        headerElement.removeAttribute('data-contrast');
        return;
      }

      const headerStyle = window.getComputedStyle(headerElement);
      let sampledColor = parseRgbChannels(headerStyle.backgroundColor);

      if (!sampledColor || sampledColor.a < 0.55) {
        const bodyColor = parseRgbChannels(window.getComputedStyle(document.body).backgroundColor);
        if (bodyColor) {
          sampledColor = bodyColor;
        }
      }

      if (!sampledColor) {
        headerElement.setAttribute('data-contrast', 'light');
        return;
      }

      const luminance = relativeLuminance(sampledColor.r, sampledColor.g, sampledColor.b);
      headerElement.setAttribute('data-contrast', luminance < 0.42 ? 'dark' : 'light');
    };

    const publicHeader = document.querySelector('header#top-header');
    if (publicHeader && !publicHeader.dataset.publicHeaderBooted) {
      publicHeader.dataset.publicHeaderBooted = '1';
      if (publicHeader.querySelector('.public-header-main')) {
        publicHeader.classList.add('public-header-mode');
      }
    }

    // Keep homepage overlay behavior in sync for both full loads and SPA route changes.
    if (window.__headerOverlayCleanup && typeof window.__headerOverlayCleanup === 'function') {
      window.__headerOverlayCleanup();
      window.__headerOverlayCleanup = null;
    }

    if (publicHeader) {
      const isPublicMarketingShell = !!publicHeader.querySelector('.public-header-main');
      const isPublicDashboardPath = window.location.pathname.includes('/publicDashboard');
      const isHomePath = window.location.pathname === '/';
      const isMarketingHeroPath = publicHeader.dataset.overlayEligible === '1' && !isPublicDashboardPath;
      const isOverlayEligible = publicHeader.dataset.overlayEligible === '1';
      const shouldUseOverlay = isPublicMarketingShell && (isHomePath || isMarketingHeroPath) && isOverlayEligible;

      publicHeader.classList.toggle('homepage-overlay-enabled', shouldUseOverlay);
      document.body.classList.toggle('homepage-overlay-header', shouldUseOverlay);

      if (!shouldUseOverlay) {
        publicHeader.classList.remove('is-solid');
        applyPublicHeaderContrast(publicHeader);
      } else {
        const setHeaderSolid = (isSolid) => {
          publicHeader.classList.toggle('is-solid', isSolid);
        };

        const syncHomepageHeader = () => {
          const heroSection = document.querySelector('.hero');
          if (!heroSection) {
            setHeaderSolid(window.scrollY > 24);
            return;
          }

          const heroThreshold = Math.max(heroSection.offsetHeight - publicHeader.offsetHeight, 24);
          setHeaderSolid(window.scrollY > heroThreshold);
        };

        syncHomepageHeader();
        window.addEventListener('scroll', syncHomepageHeader, { passive: true });
        window.addEventListener('resize', syncHomepageHeader);

        window.__headerOverlayCleanup = () => {
          window.removeEventListener('scroll', syncHomepageHeader);
          window.removeEventListener('resize', syncHomepageHeader);
        };
      }

      applyPublicHeaderContrast(publicHeader);
    }

    const hamburger = document.getElementById("header-hamburger");
    const navMenu = document.getElementById("header-nav-menu");
    const submenuToggles = document.querySelectorAll(".submenu-toggle");
    const searchInput = document.getElementById("search-input");
    const searchResults = document.getElementById("search-results");
    const searchForm = document.getElementById("search-form");
    const searchContainer = document.querySelector(".search-bar-container");
    const searchToggleButton = document.getElementById("search-toggle-button");
    const searchCloseButton = document.getElementById("search-close-button");
    const mobileSearchBreakpoint = window.matchMedia("(max-width: 768px)");
    const publicDesktopNavItems = document.querySelectorAll('[data-public-nav-item]');

    function closePublicDesktopMenus() {
      publicDesktopNavItems.forEach((item) => {
        item.dataset.clickPinned = '0';
        item.classList.remove('is-open');
        const trigger = item.querySelector('.public-nav-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
    }

    publicDesktopNavItems.forEach((item) => {
      if (item.dataset.publicNavBound === '1') return;
      item.dataset.publicNavBound = '1';

      const trigger = item.querySelector('.public-nav-trigger');
      const panel = item.querySelector('.public-nav-panel');
      if (!trigger) return;

      let hoverCloseTimer = null;

      const clearHoverCloseTimer = () => {
        if (hoverCloseTimer) {
          window.clearTimeout(hoverCloseTimer);
          hoverCloseTimer = null;
        }
      };

      const openMenu = () => {
        clearHoverCloseTimer();
        closePublicDesktopMenus();
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      };

      const closeMenu = () => {
        clearHoverCloseTimer();
        item.dataset.clickPinned = '0';
        item.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      };

      const scheduleHoverClose = () => {
        if (item.dataset.clickPinned === '1') return;
        clearHoverCloseTimer();
        hoverCloseTimer = window.setTimeout(() => {
          const panelHovered = !!(panel && panel.matches(':hover'));
          const itemHovered = item.matches(':hover');
          if (!panelHovered && !itemHovered) {
            closeMenu();
          }
        }, 140);
      };

      trigger.addEventListener('mouseenter', () => {
        clearHoverCloseTimer();
        if (item.dataset.clickPinned === '1') return;
        openMenu();
      });

      item.addEventListener('mouseenter', () => {
        clearHoverCloseTimer();
        if (item.dataset.clickPinned === '1') return;
        openMenu();
      });

      item.addEventListener('mouseleave', scheduleHoverClose);

      if (panel) {
        panel.addEventListener('mouseenter', clearHoverCloseTimer);
        panel.addEventListener('mouseleave', scheduleHoverClose);
      }

      trigger.addEventListener('click', (event) => {
        const navHref = trigger.dataset.navHref;
        if (navHref) {
          event.preventDefault();
          event.stopPropagation();
          if (window.spaRouter && window.spaRouter.shouldHandleRoute(navHref)) {
            window.spaRouter.navigate(navHref);
          } else {
            window.location.href = navHref;
          }
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const shouldOpen = !item.classList.contains('is-open');
        closePublicDesktopMenus();
        if (shouldOpen) {
          openMenu();
          item.dataset.clickPinned = '1';
        }
      });
    });

    function isMobileCollapsibleSearch() {
      return mobileSearchBreakpoint.matches && searchContainer && searchForm;
    }

    function clearHeaderSearch() {
      if (searchResults) {
        searchResults.innerHTML = "";
        searchResults.style.display = "none";
      }

      if (searchInput) {
        searchInput.value = "";
      }
    }

    function closeMobileSearch(options = {}) {
      const shouldBlur = options.shouldBlur !== false;

      if (!searchContainer || !searchForm) {
        return;
      }

      searchContainer.classList.remove("is-expanded");
      searchForm.classList.remove("is-expanded");

      if (searchToggleButton) {
        searchToggleButton.setAttribute("aria-expanded", "false");
      }

      clearHeaderSearch();

      if (shouldBlur && searchInput) {
        searchInput.blur();
      }
    }

    function openMobileSearch() {
      if (!isMobileCollapsibleSearch()) {
        if (searchInput) {
          searchInput.focus({ preventScroll: true });
        }
        return;
      }

      searchContainer.classList.add("is-expanded");
      searchForm.classList.add("is-expanded");

      if (searchToggleButton) {
        searchToggleButton.setAttribute("aria-expanded", "true");
      }

      window.setTimeout(() => {
        if (searchInput) {
          searchInput.focus({ preventScroll: true });
        }
      }, 60);
    }

    function syncMobileSearchMode() {
      if (!searchContainer || !searchForm) {
        return;
      }

      const isMobile = mobileSearchBreakpoint.matches;

      searchContainer.classList.toggle("is-mobile-collapsible", isMobile);
      searchForm.classList.toggle("is-mobile-collapsible", isMobile);

      if (!isMobile) {
        searchContainer.classList.remove("is-expanded");
        searchForm.classList.remove("is-expanded");
        if (searchToggleButton) {
          searchToggleButton.setAttribute("aria-expanded", "false");
        }
      }
    }

    // 🔧 Dynamic Organization Nickname Sizing for Mobile
    function adjustOrgNameSize() {
      const orgNickname = document.querySelector('.org-names .org-nickname');
      if (!orgNickname) return;
      
      const isMobile = window.innerWidth <= 768;
      if (!isMobile) return; // Only adjust on mobile
      
      const text = orgNickname.textContent || orgNickname.innerText;
      const textLength = text.length;
      
      // Reset to default
      orgNickname.style.fontSize = '';
      
      // Adjust font size based on text length
      if (textLength > 15) {
        orgNickname.style.fontSize = '0.75em';
      } else if (textLength > 12) {
        orgNickname.style.fontSize = '0.8em';
      } else if (textLength > 8) {
        orgNickname.style.fontSize = '0.85em';
      } else {
        orgNickname.style.fontSize = '0.9em';
      }
    }

    // Apply sizing on load and resize
    adjustOrgNameSize();
    window.addEventListener('resize', adjustOrgNameSize);

    // Hamburger menu toggle with stopPropagation to prevent conflicts
    // Only add listeners if elements exist (prevents errors on hub pages)
    if (hamburger && navMenu) {
      // aria-expanded also lets a demo capture of the page open the menu without scripts.
      const toggleNavMenu = (open) => {
        navMenu.classList.toggle("show", open);
        navMenu.style.display = open ? "block" : "none";
        const toggle = document.getElementById("header-hamburger");
        if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
      };

      // Initialize closed state explicitly - ensure hamburger is in normal state
      toggleNavMenu(false);
      hamburger.classList.remove("active");

      // Remove existing listeners to prevent duplicates
      const oldHamburger = hamburger.cloneNode(true);
      hamburger.parentNode.replaceChild(oldHamburger, hamburger);
      const newHamburger = document.getElementById("header-hamburger");

      newHamburger.addEventListener("click", (e) => {
        e.stopPropagation();
        const shouldOpen = !navMenu.classList.contains("show");
        newHamburger.classList.toggle("active", shouldOpen);
        toggleNavMenu(shouldOpen);
      });

      // The school's sandbox switch (views/partials/header.ejs): asks once, in the menu, before it
      // changes. Bound on the elements, since clicks inside the menu don't reach the document.
      navMenu.querySelectorAll("[data-sbx]").forEach((form) => {
        if (form.dataset.sbxBound) return;
        form.dataset.sbxBound = "1";
        const ask = form.querySelector("[data-sbx-ask]");
        const row = form.querySelector("[data-sbx-row]");
        const toggle = form.querySelector("[data-sbx-toggle]");
        const show = (open) => { ask.hidden = !open; toggle.setAttribute("aria-expanded", open ? "true" : "false"); };
        row.addEventListener("click", (e) => { e.preventDefault(); show(ask.hidden); });
        form.querySelector("[data-sbx-cancel]").addEventListener("click", (e) => { e.preventDefault(); show(false); });
        form.addEventListener("submit", () => {
          const yes = form.querySelector(".sbx__yes");
          setTimeout(() => { if (yes) { yes.disabled = true; yes.textContent = "One moment…"; } }, 0);
        });
      });

      // Prevent clicks inside nav menu from bubbling to document (but not on links)
      navMenu.addEventListener("click", (e) => {
        // Don't stop propagation on links - let them navigate
        if (!e.target.closest('a')) {
          e.stopPropagation();
        }
      });

      // Add SPA navigation to all nav links (include all links except logout and anchors)
      const navLinks = navMenu.querySelectorAll('a[href]:not(.logout):not([href^="#"])');
      navLinks.forEach(link => {
        // Clone and replace to remove old listeners
        const newLink = link.cloneNode(true);
        link.parentNode.replaceChild(newLink, link);
        
        newLink.addEventListener('click', (e) => {
          const href = newLink.getAttribute('href');
          if (href && href !== '#' && window.spaRouter && window.spaRouter.shouldHandleRoute(href)) {
            e.preventDefault();
            e.stopPropagation();
            
            // Close hamburger menu immediately
            newHamburger.classList.remove("active");
            toggleNavMenu(false);
            
            // Navigate via SPA
            window.spaRouter.navigate(href);
          }
        });
      });

      submenuToggles.forEach((toggle) => {
        toggle.addEventListener("click", (e) => {
          e.preventDefault();
          const target = document.getElementById(toggle.dataset.target);
          const arrow = toggle.querySelector(".arrow");

          submenuToggles.forEach((otherToggle) => {
            const otherArrow = otherToggle.querySelector(".arrow");
            const otherTarget = document.getElementById(
              otherToggle.dataset.target
            );
            if (otherTarget !== target) {
              otherTarget.classList.remove("show");
              otherArrow.classList.remove("open");
            }
          });

          arrow.classList.toggle("open");
          target.classList.toggle("show");
        });
      });

      document.addEventListener("click", (e) => {
        if (!e.target.closest("#header-hamburger") && !e.target.closest("#header-nav-menu")) {
          newHamburger.classList.remove("active");
          toggleNavMenu(false);
        }

        if (!e.target.closest('[data-public-nav-item]')) {
          closePublicDesktopMenus();
        }
      });
    }

    if (publicHeader && publicHeader.dataset.publicEscapeBound !== '1') {
      publicHeader.dataset.publicEscapeBound = '1';
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closePublicDesktopMenus();
        }
      });
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    const headerDisplayPrefs = window.__mgDisplayPrefs || {};
    const headerNameDisplayFormat = headerDisplayPrefs && headerDisplayPrefs.nameDisplayFormat === "last_first"
      ? "last_first"
      : "first_last";

    function formatHeaderSearchName(item) {
      const first = String((item && item.first_name) || "").trim();
      const last = String((item && item.last_name) || "").trim();
      if (headerNameDisplayFormat === "last_first") {
        if (last && first) return `${escapeHtml(last)}, ${escapeHtml(first)}`;
        return escapeHtml(last || first || "");
      }
      return [first, last].filter(Boolean).map(escapeHtml).join(" ").trim();
    }
    // 🔍 Global Search
    if (searchForm) {
      searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
      });
    }

    syncMobileSearchMode();
    if (typeof mobileSearchBreakpoint.addEventListener === "function") {
      mobileSearchBreakpoint.addEventListener("change", syncMobileSearchMode);
    } else if (typeof mobileSearchBreakpoint.addListener === "function") {
      mobileSearchBreakpoint.addListener(syncMobileSearchMode);
    }

    if (searchToggleButton) {
      searchToggleButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMobileSearch();
      });
    }

    if (searchCloseButton) {
      searchCloseButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMobileSearch();
      });
    }

    if (searchInput && searchResults) {
      searchInput.setAttribute("readonly", "readonly");
      const unlockSearchInput = () => {
        searchInput.removeAttribute("readonly");
      };
      searchInput.addEventListener("focus", () => {
        setTimeout(unlockSearchInput, 0);
        if (isMobileCollapsibleSearch()) {
          openMobileSearch();
        }
      });
      searchInput.addEventListener("mousedown", unlockSearchInput);
      searchInput.addEventListener("touchstart", unlockSearchInput, { passive: true });
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeMobileSearch();
        }
      });

      let _searchDebounceTimer = null;
      let _searchAbortController = null;

      // Results grouped by kind, best matches first, with the typed text highlighted.
      const SEARCH_GROUPS = [
        { key: "student", label: "Students", icon: "fa-user-graduate" },
        { key: "guardian", label: "Parents & guardians", icon: "fa-people-roof" },
        { key: "employee", label: "Staff", icon: "fa-id-badge" },
        { key: "teacher", label: "Teachers", icon: "fa-chalkboard-user" },
        { key: "class", label: "Classes", icon: "fa-chalkboard" },
        { key: "subject", label: "Subjects", icon: "fa-book" },
        { key: "organization_profile", label: "School", icon: "fa-school" },
      ];
      const markMatch = (text, query) => {
        const safe = escapeHtml(text || "");
        const q = String(query || "").trim();
        if (!q) return safe;
        const at = String(text || "").toLowerCase().indexOf(q.toLowerCase());
        if (at === -1) return safe;
        return escapeHtml(text.slice(0, at)) + "<mark>" + escapeHtml(text.slice(at, at + q.length)) + "</mark>" + escapeHtml(text.slice(at + q.length));
      };
      const searchLink = (item) => {
        switch (item.type) {
          case "student": return `/common/studentDetails?studentId=${item.id}&classId=${item.class_id || ""}&termId=${CURRENT_TERM_ID}`;
          case "organization_profile": return "/account/settings";
          case "employee": return `/common/employeeDetails?userId=${item.id}`;
          case "guardian": return `/common/guardianDetails?guardianId=${item.id}`;
          case "class": return `/common/classDashboard?classId=${item.id}`;
          case "subject": return item.student_scope ? "/student/dashboard" : (item.class_id ? `/common/classDashboard?classId=${item.class_id}` : "/common/manageClassSubjectAndGradYr");
          case "teacher": return "/student/dashboard";
          default: return "#";
        }
      };
      // People open as a card in the drawer (see ManagiraPersonCard below); everything else opens its page.
      const personOf = (item) => {
        const id = Number(item.id);
        if (!(id > 0)) return "";
        if (item.type === "student") return `student:${id}`;
        if (item.type === "employee") return `staff:${id}`;
        if (item.type === "guardian") return `guardian:${id}:legacy`;
        if (item.type === "teacher") return `teacher:${id}`;
        return "";
      };
      const searchSubtitle = (item) => {
        if (item.type === "student") return [item.class_name, item.graduated ? "Graduated / left" : ""].filter(Boolean).join(" · ") || "Student";
        if (item.type === "employee") return item.account_type || "Staff";
        if (item.type === "subject") return item.class_name || "Subject";
        if (item.type === "organization_profile") return "School profile";
        if (item.type === "guardian") return "Parent / guardian";
        if (item.type === "class") return "Class";
        return "";
      };
      // "Include past records" (graduated and archived students) is remembered for the tab.
      const readPast = () => { try { return sessionStorage.getItem("mg_search_past") === "1"; } catch (_) { return false; } };
      let includePast = readPast();
      const toolsRow = () => `<div class="sr-tools"><label class="sr-past"><input type="checkbox" data-search-past${includePast ? " checked" : ""}><span>Include past records</span></label><button type="button" class="sr-deeper" data-search-deeper>Search deeper</button></div>`;
      const itemHtml = (item, group) => {
        const title = item.display_name || formatHeaderSearchName(item) || item.subject_name || item.class_name || "";
        const hasPhoto = item.image_url && item.image_url !== "profilePlaceholder.png" && ["student", "guardian", "employee", "organization_profile"].includes(item.type);
        const initials = String(title).split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();
        const avatar = hasPhoto
          ? `<img class="sr-avatar" src="${escapeHtml(item.image_url)}" alt="" loading="lazy" data-onerror="hdr.avatar" data-mga0="${escapeHtml(initials)}">`
          : (["class", "subject"].includes(item.type) ? `<span class="sr-avatar sr-avatar--icon"><i class="fa-solid ${group.icon}" aria-hidden="true"></i></span>` : `<span class="sr-avatar">${escapeHtml(initials)}</span>`);
        return `<a class="sr-item search-result-item${item.graduated ? " is-muted" : ""}" role="option" href="${searchLink(item)}"${personOf(item) ? ` data-person="${personOf(item)}"` : ""}>${avatar}<span class="sr-text"><span class="sr-title">${markMatch(title, query_)}</span><span class="sr-sub">${escapeHtml(searchSubtitle(item))}</span></span></a>`;
      };
      let query_ = "";
      function renderSearchResults(items, query) {
        query_ = query;
        if (!items.length) {
          searchResults.innerHTML = toolsRow() + `<div class="sr-state">No results for “${escapeHtml(query)}”${includePast ? "" : "<br><small>Past students are left out. Tick “Include past records” to add them.</small>"}</div>`;
          searchResults.style.display = "block";
          return;
        }
        // An exact match first, the related ones below, each kind under its own heading.
        const groupOf = (key) => SEARCH_GROUPS.find((g) => g.key === key) || SEARCH_GROUPS[0];
        const exact = items.filter((item) => item.exact);
        const rest = items.filter((item) => !item.exact);
        const best = exact.length
          ? `<div class="sr-group" role="group" aria-label="Best match"><div class="sr-head">Best match<span>${exact.length}</span></div>${exact.map((item) => itemHtml(item, groupOf(item.type))).join("")}</div>`
          : "";
        const html = best + SEARCH_GROUPS.map((group) => {
          const list = rest.filter((item) => item.type === group.key)
            .sort((a, b) => (a.graduated ? 1 : 0) - (b.graduated ? 1 : 0));
          if (!list.length) return "";
          return `<div class="sr-group" role="group" aria-label="${group.label}"><div class="sr-head">${exact.length ? "Related · " : ""}${group.label}<span>${list.length}</span></div>` +
            list.map((item) => itemHtml(item, group)).join("") + "</div>";
        }).join("");
        searchResults.innerHTML = toolsRow() + html;
        searchResults.style.display = "block";
        searchInput.setAttribute("aria-expanded", "true");
      }
      const runSearch = (query) => {
        if (_searchAbortController) _searchAbortController.abort();
        searchResults.innerHTML = toolsRow() + '<div class="sr-state"><span class="sr-spinner" aria-hidden="true"></span>Searching…</div>';
        searchResults.style.display = "block";
        _searchAbortController = new AbortController();
        return fetch(`/enrollment/searchUsers?query=${encodeURIComponent(query)}${includePast ? "&includePast=1" : ""}`, { signal: _searchAbortController.signal })
          .then((response) => response.json())
          .then((payload) => renderSearchResults(Array.isArray(payload.results) ? payload.results : [], query))
          .catch((error) => { if (error.name !== "AbortError") console.error("Error fetching search results:", error); });
      };
      // As soon as the field is used, before anything is typed: just the two tools.
      const showSearchTools = () => {
        searchResults.innerHTML = toolsRow();
        searchResults.style.display = "block";
        searchInput.setAttribute("aria-expanded", "true");
      };
      searchInput.addEventListener("focus", () => { if (searchInput.value.trim().length < 2) showSearchTools(); });
      searchInput.addEventListener("click", () => { if (searchResults.style.display !== "block" && searchInput.value.trim().length < 2) showSearchTools(); });
      // The two tools at the top of the list: the checkbox searches again, the link opens the pop-up.
      searchResults.addEventListener("change", (event) => {
        if (!event.target.matches("[data-search-past]")) return;
        includePast = event.target.checked;
        try { sessionStorage.setItem("mg_search_past", includePast ? "1" : "0"); } catch (_) { /* not remembered */ }
        const query = searchInput.value.trim();
        if (query.length >= 2) runSearch(query);
      });
      searchResults.addEventListener("click", (event) => {
        const link = event.target.closest("[data-search-deeper]");
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        const query = searchInput.value.trim();
        clearHeaderSearch();
        if (window.ManagiraDeepSearch) { window.ManagiraDeepSearch.open({ query, includePast }); return; }
        // Versioned addresses (assetUrl in the header), so a browser never runs an older copy.
        const assets = window.MG_ASSETS || {};
        if (!document.querySelector('link[href*="/css/deepSearch.css"]')) {
          const css = document.createElement("link"); css.rel = "stylesheet"; css.href = assets.deepSearchCss || "/css/deepSearch.css"; document.head.appendChild(css);
        }
        const script = document.createElement("script");
        script.src = assets.deepSearchJs || "/js/deepSearch.js";
        script.onload = () => window.ManagiraDeepSearch && window.ManagiraDeepSearch.open({ query, includePast });
        document.head.appendChild(script);
      });
      // Arrow keys move through results, Enter opens one.
      searchInput.addEventListener("keydown", (event) => {
        const options = Array.from(searchResults.querySelectorAll(".sr-item"));
        if (!options.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
        let index = options.findIndex((o) => o.classList.contains("is-active"));
        if (event.key === "Enter") {
          const target = options[index >= 0 ? index : 0];
          // A click, so a staff result opens in its drawer like a pointer click does.
          if (target) { event.preventDefault(); target.click(); }
          return;
        }
        event.preventDefault();
        index = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
        options.forEach((o, i) => o.classList.toggle("is-active", i === index));
        options[index].scrollIntoView({ block: "nearest" });
      });


      searchInput.addEventListener("input", (event) => {
        const query = event.target.value.trim();

        clearTimeout(_searchDebounceTimer);
        if (_searchAbortController) {
          _searchAbortController.abort();
          _searchAbortController = null;
        }

        if (query.length < 2) {
          showSearchTools();
          return;
        }

        searchResults.innerHTML = toolsRow() + '<div class="sr-state"><span class="sr-spinner" aria-hidden="true"></span>Searching…</div>';
        searchResults.style.display = "block";
        searchInput.setAttribute("aria-expanded", "true");
        _searchDebounceTimer = setTimeout(() => runSearch(query), 260);
      });

      document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-bar-container")) {
          if (isMobileCollapsibleSearch()) {
            closeMobileSearch();
          } else {
            clearHeaderSearch();
          }
        }
      });

      document.addEventListener("touchstart", (e) => {
        if (!e.target.closest(".search-bar-container")) {
          if (isMobileCollapsibleSearch()) {
            closeMobileSearch();
          } else {
            clearHeaderSearch();
            searchInput.blur();
          }
        }
      }, { passive: true });
    }
  }

  // Make functions globally available for SPA router
  window.initHeaderMenu = initHeaderMenu;
  window.initLogoSPANavigation = initLogoSPANavigation;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHeaderMenu);
  } else {
    initHeaderMenu();
  }

  if (!window.__headerSpaOverlaySyncBound) {
    window.__headerSpaOverlaySyncBound = true;
    window.addEventListener('spa:pageLoaded', initHeaderMenu);
  }

  // ⭐ Add SPA navigation to logo clicks for instant dashboard access
  function initLogoSPANavigation() {
    const logoLinks = document.querySelectorAll('.siteName a, .org-names a');
    
    logoLinks.forEach(link => {
      const href = link.getAttribute('href');
      
      // Only add SPA handling for internal dashboard links
      if (href && !href.startsWith('http') && !href.startsWith('#') && href !== '/') {
        link.addEventListener('click', (e) => {
          if (window.spaRouter && window.spaRouter.shouldHandleRoute(href)) {
            e.preventDefault();
            e.stopPropagation();
            
            // Navigate instantly via SPA
            window.spaRouter.navigate(href);
          }
        });
      }
    });
  }

  // A person's card opens in the right-side drawer (public/js/adminDrawer.js, loaded the first time
  // it's needed) over the page the link was on: header search results, the dashboard's teachers,
  // a class's teacher chips (anything with data-person="student:ID", "staff:ID", "guardian:ID:source"
  // or, for a student, "teacher:ID"; and any link to a staff page). What the card shows follows who
  // is looking (controllers/personCardController.js). Runs before the page-switcher (window, capture).
  // A typed address or a new tab still opens the full page.
  (function () {
    if (window.ManagiraPersonCard) return;
    var TITLES = { student: "Student", staff: "Staff member", guardian: "Parent / guardian", teacher: "Teacher" };
    var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
    var drawer = null;
    var assets = null;
    function loadDrawer() {
      if (window.ManagiraDrawer) return Promise.resolve();
      if (assets) return assets;
      assets = new Promise(function (resolve, reject) {
        if (!document.querySelector('link[href*="/css/adminDrawer.css"]')) {
          var css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = "/css/adminDrawer.css";
          document.head.appendChild(css);
        }
        var script = document.createElement("script");
        script.src = "/js/adminDrawer.js";
        script.onload = resolve;
        script.onerror = function () { assets = null; reject(new Error("drawer")); };
        document.head.appendChild(script);
      });
      return assets;
    }
    function urlFor(spec) {
      var parts = String(spec || "").split(":");
      var type = parts[0];
      var id = Number(parts[1]);
      if (!TITLES[type] || !(id > 0)) return null;
      if (type === "teacher") return "/student/person-card/teacher/" + id;
      return "/common/person-card/" + type + "/" + id + (parts[2] === "legacy" ? "?source=legacy" : "");
    }
    function open(spec, name) {
      var url = urlFor(spec);
      if (!url) return Promise.resolve(false);
      var type = String(spec).split(":")[0];
      return loadDrawer().then(function () {
        if (!drawer) {
          drawer = window.ManagiraDrawer.create({
            id: "personCard", icon: ICON, title: "", subtitle: "", width: 720, belowHeader: true,
            // Modify sends a saved change back to the staff list: then this page refreshes.
            listPagePath: "/common/manageEmployees",
          });
          // Edit student, saved inside the drawer, asks the page to refresh.
          window.addEventListener("message", function (event) {
            if (event.origin !== window.location.origin || !event.data || event.data.drawerId !== "personCard") return;
            if (event.data.managiraDrawerClose) window.location.reload();
          });
        }
        var title = drawer.overlay.querySelector(".mgr-drawer-header h2");
        var sub = drawer.overlay.querySelector(".mgr-drawer-header p");
        if (title) title.textContent = TITLES[type];
        if (sub) sub.textContent = name || "";
        drawer.open(url + (url.indexOf("?") === -1 ? "?" : "&") + "embed=workspace", { forceReload: true });
        return true;
      });
    }
    window.ManagiraPersonCard = { open: open };
    window.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var el = event.target && event.target.closest ? event.target.closest("[data-person], a[href*='/common/employeeDetails']") : null;
      if (!el || el.target === "_blank" || el.hasAttribute("download")) return;
      var spec = el.getAttribute("data-person");
      if (!spec) {
        var url;
        try { url = new URL(el.getAttribute("href"), window.location.href); } catch (err) { return; }
        if (url.origin !== window.location.origin || url.pathname !== "/common/employeeDetails" || !url.searchParams.get("userId")) return;
        spec = "staff:" + url.searchParams.get("userId");
      }
      if (!urlFor(spec)) return;
      event.preventDefault();
      event.stopPropagation();
      var results = el.closest("#search-results");
      if (results) results.style.display = "none";
      var titleEl = el.querySelector(".sr-title, .teacher-name");
      var name = String((titleEl || el).textContent || "").replace(/\s+/g, " ").trim();
      var fallback = el.getAttribute("href");
      open(spec, name).catch(function () { if (fallback && fallback !== "#") window.location.href = fallback; });
    }, true);
  })();

  // Initialize logo SPA navigation
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLogoSPANavigation);
  } else {
    initLogoSPANavigation();
  }

  // Re-initialize logo SPA navigation after SPA page loads
  window.addEventListener('spa:pageLoaded', initLogoSPANavigation);
