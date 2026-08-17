/* Shared slide-in-from-right drawer factory, generalized from the
   Add/Modify Employee iframe-drawer pattern (views/common/manageEmployees.ejs)
   so every admin composer can open a right-side AJAX panel with a few lines
   instead of duplicating the overlay/iframe/spinner/postMessage/Escape wiring.

   Usage:
     const drawer = ManagiraDrawer.create({
       id: 'annComposer',
       icon: '📢',
       title: 'New Announcement',
       subtitle: 'Compose a modal or banner broadcast',
       listPagePath: '/common/manageAnnouncements', // reload if the iframe navigates here
     });
     document.getElementById('newAnnouncementBtn').addEventListener('click', function () {
       drawer.open('/common/announcementComposer?embed=workspace');
     });
*/
(function (global) {
  "use strict";

  function create(options) {
    const id = options.id;
    const width = options.width || 1160;
    let iframeLoaded = false;
    let dirty = false;

    const overlay = document.createElement("div");
    overlay.className = "mgr-drawer-overlay";
    overlay.id = "mgrDrawerOverlay-" + id;
    overlay.style.setProperty("--mgr-drawer-width", width + "px");
    overlay.setAttribute("aria-hidden", "true");

    overlay.innerHTML =
      '<div class="mgr-drawer">' +
      '<div class="mgr-drawer-header">' +
      '<div class="mgr-drawer-header-left">' +
      '<div class="mgr-drawer-header-icon">' + (options.icon || "📝") + "</div>" +
      "<div>" +
      "<h2>" + (options.title || "") + "</h2>" +
      "<p>" + (options.subtitle || "") + "</p>" +
      "</div></div>" +
      '<button type="button" class="mgr-drawer-close" title="Close">' +
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none">' +
      '<path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      "</button></div>" +
      '<div class="mgr-drawer-body">' +
      '<div class="mgr-drawer-loading"><span class="mgr-drawer-spinner" aria-hidden="true"></span>Loading&hellip;</div>' +
      '<iframe class="mgr-drawer-iframe" title="' + (options.title || "Panel") + '" style="display:none;"></iframe>' +
      "</div></div>";

    document.body.appendChild(overlay);

    const iframe = overlay.querySelector(".mgr-drawer-iframe");
    const loading = overlay.querySelector(".mgr-drawer-loading");
    const closeBtn = overlay.querySelector(".mgr-drawer-close");

    function open(src, opts) {
      const forceReload = !!(opts && opts.forceReload);
      const separator = src.indexOf("?") === -1 ? "?" : "&";
      src = src + separator + "drawerId=" + encodeURIComponent(id);
      iframe.style.display = "none";
      loading.style.display = "flex";

      iframe.onload = function onLoad() {
        iframeLoaded = true;
        let path = null;
        try {
          path = iframe.contentWindow.location.pathname;
        } catch (err) {
          /* cross-origin, ignore */
        }
        if (options.listPagePath && path === options.listPagePath) {
          window.location.reload();
          return;
        }
        loading.style.display = "none";
        iframe.style.display = "block";
      };

      if (forceReload || !iframeLoaded || iframe.src !== new URL(src, window.location.href).href) {
        iframe.src = src;
      } else {
        loading.style.display = "none";
        iframe.style.display = "block";
      }

      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function close() {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (dirty) {
        dirty = false;
        window.location.reload();
      }
    }

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && overlay.classList.contains("is-open")) close();
    });
    window.addEventListener("message", function (event) {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.managiraDrawerSaved && event.data.drawerId === id) {
        dirty = true;
      }
    });

    return { open, close, overlay, iframe };
  }

  global.ManagiraDrawer = { create };
})(window);
