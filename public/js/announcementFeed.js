(function () {
  "use strict";

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value == null ? "" : value);
    return div.innerHTML;
  }

  function isInternalUrl(url) {
    return typeof url === "string" && url.startsWith("/");
  }

  function post(path) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    }).catch(() => {});
  }

  // Waits for a feedback-request popup (public/js/feedbackPrompt.js), if one
  // is already open, to close before an announcement modal takes the same
  // screen space - the two systems load independently, so without this they
  // can both open at once.
  function waitForFeedbackPrompt(cb, attempts) {
    attempts = attempts || 0;
    if (!document.querySelector(".mfb-overlay") || attempts > 40) { cb(); return; }
    setTimeout(function () { waitForFeedbackPrompt(cb, attempts + 1); }, 250);
  }

  function renderCta(link, announcementId) {
    const a = document.createElement("a");
    a.className = "ann-modal-cta " + (["primary", "secondary", "link"].includes(link.style) ? link.style : "primary");
    a.textContent = link.label;
    a.href = link.url;
    if (!isInternalUrl(link.url)) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    a.addEventListener("click", function () {
      if (link.ack_required) post("/announcements/" + announcementId + "/acknowledge");
    });
    return a;
  }

  function renderBanner(item) {
    const wrap = document.createElement("div");
    wrap.className = "ann-banner ann-banner-" + (item.variant || "info");
    wrap.dataset.id = item.id;

    const text = document.createElement("span");
    text.innerHTML = "<strong>" + escapeHtml(item.title) + "</strong>" + (item.body ? " &mdash; " + escapeHtml(item.body) : "");
    wrap.appendChild(text);

    (item.cta_links || []).slice(0, 1).forEach((link) => {
      const cta = document.createElement("a");
      cta.className = "ann-banner-cta";
      cta.textContent = link.label;
      cta.href = link.url;
      if (!isInternalUrl(link.url)) {
        cta.target = "_blank";
        cta.rel = "noopener";
      }
      cta.addEventListener("click", function () {
        if (link.ack_required) post("/announcements/" + item.id + "/acknowledge");
      });
      wrap.appendChild(cta);
    });

    if (item.dismissible) {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "ann-banner-dismiss";
      dismiss.setAttribute("aria-label", "Dismiss");
      dismiss.innerHTML = "&times;";
      dismiss.addEventListener("click", function () {
        wrap.remove();
        post("/announcements/" + item.id + "/dismiss");
      });
      wrap.appendChild(dismiss);
    }

    return wrap;
  }

  function renderBanners(items) {
    const stack = document.getElementById("ann-banner-stack");
    if (!stack) return;
    items.forEach((item) => {
      stack.appendChild(renderBanner(item));
      post("/announcements/" + item.id + "/seen");
    });
  }

  function renderModalQueue(items) {
    if (!items.length) return;
    const overlay = document.getElementById("ann-modal-overlay");
    const container = document.getElementById("ann-modal");
    if (!overlay || !container) return;

    let index = 0;

    function showNext() {
      if (index >= items.length) {
        overlay.hidden = true;
        container.innerHTML = "";
        return;
      }
      const item = items[index];
      overlay.hidden = false;
      container.innerHTML = "";
      // Corner placement only where there's room for it (matches the
      // feedback-prompt widget's own breakpoint); phones always get the
      // classic centered dialog.
      overlay.classList.remove("ann-pos-bottom-right", "ann-pos-bottom-left");
      const pos = item.position || "center";
      if (window.innerWidth >= 768 && (pos === "bottom-right" || pos === "bottom-left")) {
        overlay.classList.add("ann-pos-" + pos);
      }

      const bar = document.createElement("div");
      bar.className = "ann-modal-banner-bar ann-" + (item.variant || "info");
      container.appendChild(bar);

      const body = document.createElement("div");
      body.className = "ann-modal-body";

      if (item.image_url) {
        const img = document.createElement("img");
        img.className = "ann-modal-image";
        img.src = item.image_url;
        img.alt = "";
        body.appendChild(img);
      }

      const title = document.createElement("h2");
      title.className = "ann-modal-title";
      title.textContent = item.title;
      body.appendChild(title);

      const text = document.createElement("div");
      text.className = "ann-modal-text";
      text.textContent = item.body;
      body.appendChild(text);

      const links = item.cta_links || [];
      if (links.length) {
        const ctaRow = document.createElement("div");
        ctaRow.className = "ann-modal-ctas";
        links.forEach((link) => ctaRow.appendChild(renderCta(link, item.id)));
        body.appendChild(ctaRow);
      }

      if (items.length > 1) {
        const footer = document.createElement("div");
        footer.className = "ann-modal-footer";
        const hint = document.createElement("span");
        hint.className = "ann-modal-queue-hint";
        hint.textContent = index + 1 + " of " + items.length;
        footer.appendChild(hint);
        body.appendChild(footer);
      }

      container.appendChild(body);

      if (item.dismissible) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "ann-modal-close";
        close.setAttribute("aria-label", "Close");
        close.innerHTML = "&times;";
        close.addEventListener("click", function () {
          post("/announcements/" + item.id + "/dismiss");
          index += 1;
          showNext();
        });
        container.appendChild(close);
      }

      post("/announcements/" + item.id + "/seen");
    }

    waitForFeedbackPrompt(showNext);
  }

  function init() {
    fetch("/me/announcements", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { banners: [], modals: [] }))
      .then((data) => {
        renderBanners(data.banners || []);
        renderModalQueue(data.modals || []);
      })
      .catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
