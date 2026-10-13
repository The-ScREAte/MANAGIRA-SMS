(function () {
  "use strict";

  // Versioned URLs for the ad card's assets (set on this script tag in announcementFeed.ejs).
  const feedScript = document.currentScript;
  const AD_CSS_URL = (feedScript && feedScript.dataset.adCss) || "/css/loginAds.css";
  const AD_JS_URL = (feedScript && feedScript.dataset.adJs) || "/js/loginAds.js";

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

  // Dashboard notices render only on pages that have a notices container
  // (school dashboard, admin dashboard); elsewhere they wait, unseen.
  function renderNotices(items) {
    const container = document.getElementById("ann-dashboard-notices");
    if (!container || !items.length) return;
    const empty = document.getElementById("ann-dashboard-empty");
    if (empty) empty.hidden = true;

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "ann-notice ann-notice-" + (item.variant || "info");

      const head = document.createElement("div");
      head.className = "ann-notice-head";
      const title = document.createElement("h3");
      title.className = "ann-notice-title";
      title.textContent = item.title;
      head.appendChild(title);
      if (item.dismissible) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "ann-notice-close";
        close.setAttribute("aria-label", "Dismiss");
        close.innerHTML = "&times;";
        close.addEventListener("click", function () {
          card.remove();
          post("/announcements/" + item.id + "/dismiss");
          if (empty && !container.querySelector(".ann-notice")) empty.hidden = false;
        });
        head.appendChild(close);
      }
      card.appendChild(head);

      if (item.body) {
        const text = document.createElement("div");
        text.className = "ann-notice-text";
        text.textContent = item.body;
        card.appendChild(text);
      }

      const links = item.cta_links || [];
      if (links.length) {
        const row = document.createElement("div");
        row.className = "ann-notice-ctas";
        links.forEach((link) => row.appendChild(renderCta(link, item.id)));
        card.appendChild(row);
      }

      container.appendChild(card);
      post("/announcements/" + item.id + "/seen");
    });
  }

  // ---------- In-app ad card (lowest priority) ----------
  const AD_SETTLE_MS = 3500; // lets a feedback request (feedbackPrompt.js) open first
  const pageStart = Date.now();

  function cornerBusy() {
    const modal = document.getElementById("ann-modal-overlay");
    return Boolean(document.querySelector(".mfb-overlay") || (modal && !modal.hidden));
  }

  function loadAdAssets(cb) {
    if (!document.querySelector('link[href^="/css/loginAds.css"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = AD_CSS_URL;
      document.head.appendChild(css);
    }
    if (window.LoginAds) { cb(); return; }
    const script = document.createElement("script");
    script.src = AD_JS_URL;
    script.onload = cb;
    script.onerror = cb;
    document.head.appendChild(script);
  }

  function adBeacon(id, action) {
    const url = "/me/ads/" + encodeURIComponent(id) + "/" + action;
    if (action === "click" && navigator.sendBeacon) navigator.sendBeacon(url);
    else post(url);
  }

  function renderAd(ad) {
    const position = ["bottom-right", "bottom-left", "center"].includes(ad.app_position) ? ad.app_position : "bottom-right";
    const wrap = document.createElement("div");
    wrap.className = "app-ad app-ad--" + position;
    wrap.setAttribute("role", position === "center" ? "dialog" : "complementary");
    wrap.setAttribute("aria-label", ad.title || "Featured");

    function close() {
      adBeacon(ad.id, "dismiss");
      wrap.classList.add("is-leaving");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () { wrap.remove(); }, 200);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "app-ad__close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", close);

    const hasLink = Boolean(ad.link_url);
    const asButton = hasLink && ad.show_as_button;
    const stage = document.createElement(hasLink && !asButton ? "a" : "div");
    stage.className = "ad-stage";
    const ar = ad.media_width && ad.media_height ? ad.media_width / ad.media_height : 0.75;
    stage.style.setProperty("--ar", ar.toFixed(4));

    function linkUp(a) {
      a.href = ad.link_url;
      if (!isInternalUrl(ad.link_url)) { a.target = "_blank"; a.rel = "noopener sponsored"; }
      a.addEventListener("click", function () { adBeacon(ad.id, "click"); });
    }
    if (stage.tagName === "A") linkUp(stage);

    let media;
    if (ad.media_type === "video") {
      media = document.createElement("video");
      Object.assign(media, { src: ad.file_url, muted: true, loop: true, autoplay: true, playsInline: true });
    } else if (ad.media_type === "pdf") {
      media = document.createElement("canvas");
      media.dataset.pdfSrc = ad.file_url;
    } else {
      media = document.createElement("img");
      media.decoding = "async";
      media.src = ad.file_url;
      media.alt = ad.title || "";
    }
    stage.appendChild(media);

    if (asButton) {
      const btn = document.createElement("a");
      btn.className = "ad-btn ad-btn--" + (["sm", "md", "lg"].includes(ad.button_size) ? ad.button_size : "md");
      btn.textContent = ad.link_label || "Learn more";
      btn.style.left = ad.button_x + "%";
      btn.style.top = ad.button_y + "%";
      btn.style.background = ad.button_color;
      btn.style.color = ad.button_text_color;
      linkUp(btn);
      stage.appendChild(btn);
    }

    if (position === "center") {
      wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
      document.addEventListener("keydown", onKey);
      const panel = document.createElement("div");
      panel.className = "app-ad__panel";
      panel.appendChild(closeBtn);
      panel.appendChild(stage);
      wrap.appendChild(panel);
    } else {
      wrap.appendChild(closeBtn);
      wrap.appendChild(stage);
    }

    document.body.appendChild(wrap);
    if (ad.media_type === "pdf" && window.LoginAds) window.LoginAds.renderPdfsIn(wrap);
    adBeacon(ad.id, "seen");
  }

  function showAdWhenClear(ad, attempts) {
    attempts = attempts || 0;
    const wait = Math.max(0, AD_SETTLE_MS - (Date.now() - pageStart));
    if (wait > 0 || (cornerBusy() && attempts < 900)) {
      setTimeout(function () { showAdWhenClear(ad, attempts + 1); }, wait || 700);
      return;
    }
    loadAdAssets(function () { renderAd(ad); });
  }

  function renderModalQueue(items, onDone) {
    const overlay = document.getElementById("ann-modal-overlay");
    const container = document.getElementById("ann-modal");
    if (!items.length || !overlay || !container) { if (onDone) onDone(); return; }

    let index = 0;

    function showNext() {
      if (index >= items.length) {
        overlay.hidden = true;
        container.innerHTML = "";
        if (onDone) onDone();
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
      .then((r) => (r.ok ? r.json() : { banners: [], modals: [], notices: [], ads: [] }))
      .then((data) => {
        renderBanners(data.banners || []);
        renderNotices(data.notices || []);
        const ad = (data.ads || [])[0];
        renderModalQueue(data.modals || [], function () {
          if (ad) showAdWhenClear(ad);
        });
      })
      .catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
