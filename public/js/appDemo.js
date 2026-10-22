// Product tour viewer (/legal/app-demo). Each feature opens at #feature-<id>,
// so a link can open the tour on any feature. Next/Previous walk every step of
// the features in the visible sections, in order; arrow keys, swipe and +/-
// work too. A step can have several versions (e.g. Light / Dark): the one the
// visitor picks is kept for the following steps.
(function () {
  "use strict";

  const dataNode = document.getElementById("tour-data");
  const viewer = document.querySelector("[data-tour-viewer]");
  if (!dataNode || !viewer) return;

  const sections = JSON.parse(dataNode.textContent || "[]");
  const features = [];
  sections.forEach((s) => s.features.forEach((f) => features.push(Object.assign({}, f, { section: s }))));
  if (!features.length) return;

  const panel = viewer.querySelector(".tv__panel");
  const el = (name) => viewer.querySelector('[data-tv="' + name + '"]');
  const ui = {
    section: el("section"), title: el("title"), position: el("position"), summary: el("summary"),
    steps: el("steps"), stage: el("stage"), canvas: el("canvas"), image: el("image"), pdf: el("pdf"),
    crumb: el("crumb"), versions: el("versions"), live: el("live"), zoom: el("zoom"), captionLabel: el("caption-label"),
    captionText: el("caption-text"), progress: el("progress"), count: el("count"), nextLabel: el("next-label"),
  };
  const frame = viewer.querySelector(".tv__frame");
  const prevBtn = viewer.querySelector("[data-tv-prev]");
  const nextBtn = viewer.querySelector("[data-tv-next]");

  const ZOOM_STEPS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];
  let zoom = 100;
  let order = features.map((f) => f.id); // features in the visible sections
  let featureIndex = 0;
  let stepIndex = 0;
  let versionIndex = 0;
  let preferredVersion = ""; // label of the version the visitor picked
  let isOpen = false;
  let pushedHash = false;
  let lastFocus = null;
  let pdfDoc = null;
  let pdfToken = 0;

  const byId = (id) => features.find((f) => String(f.id) === String(id));
  const current = () => byId(order[featureIndex]);
  const versionLabel = (m, i) => m.label || "Version " + (i + 1);

  // ---------- Page: sticky bar, section tabs ----------

  const nav = document.querySelector(".tour-nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  const sectionEls = Array.from(document.querySelectorAll("[data-tour-section]"));
  document.querySelectorAll("[data-tour-filter]").forEach((tab, _, tabs) => {
    tab.addEventListener("click", () => {
      const id = tab.getAttribute("data-tour-filter");
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      sectionEls.forEach((s) => { s.hidden = Boolean(id) && s.getAttribute("data-tour-section") !== id; });
      order = features.filter((f) => !id || String(f.section.id) === id).map((f) => f.id);
    });
  });

  document.querySelectorAll("[data-tour-start]").forEach((btn) => {
    btn.addEventListener("click", () => openFeature(order[0], 0, true));
  });

  // Cards are #feature-<id> links that open the viewer. Listening on window
  // (capture) runs before spa-router.js, which swallows same-page hash links.
  window.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const card = e.target.closest && e.target.closest("[data-tour-card]");
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    openFeature(card.getAttribute("data-tour-card"), 0, true);
  }, true);

  // ---------- Viewer ----------

  function openFeature(id, step, push) {
    const f = byId(id);
    if (!f) return;
    if (!order.includes(f.id)) order = features.map((x) => x.id); // opened outside the chosen section
    featureIndex = order.indexOf(f.id);
    stepIndex = Math.max(0, Math.min(step || 0, f.screens.length - 1));

    const hash = "#feature-" + f.id;
    if (!isOpen) {
      lastFocus = document.activeElement;
      isOpen = true;
      viewer.hidden = false;
      document.body.classList.add("tv-open");
      if (push && location.hash !== hash) {
        history.pushState({ tour: true }, "", hash);
        pushedHash = true;
      } else if (location.hash !== hash) {
        history.replaceState(history.state, "", hash);
      }
      panel.focus({ preventScroll: true });
    } else if (location.hash !== hash) {
      history.replaceState(history.state, "", hash);
    }
    renderFeature();
  }

  function close(fromHistory) {
    if (!isOpen) return;
    isOpen = false;
    viewer.hidden = true;
    document.body.classList.remove("tv-open");
    pdfDoc = null;
    pdfToken++;
    ui.image.removeAttribute("src");
    ui.live.removeAttribute("src");
    if (!fromHistory) {
      if (pushedHash) history.back();
      else history.replaceState(history.state, "", location.pathname + location.search);
    }
    pushedHash = false;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  function renderFeature() {
    const f = current();
    ui.section.textContent = f.section.name;
    ui.title.textContent = f.title;
    ui.position.textContent = "Feature " + (featureIndex + 1) + " of " + order.length;
    ui.summary.textContent = f.summary;
    ui.crumb.textContent = "managira.com  /  " + f.title;

    ui.steps.innerHTML = "";
    f.screens.forEach((s, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tv__step";
      btn.innerHTML = '<span class="tv__step-num"></span><span class="tv__step-text"><strong></strong><span></span></span>';
      btn.querySelector(".tv__step-num").textContent = String(i + 1);
      btn.querySelector("strong").textContent = s.label || "Step " + (i + 1);
      btn.querySelector(".tv__step-text span").textContent = s.caption;
      btn.addEventListener("click", () => goToStep(i));
      li.appendChild(btn);
      ui.steps.appendChild(li);
    });

    ui.progress.innerHTML = "";
    f.screens.forEach(() => ui.progress.appendChild(document.createElement("i")));
    renderStep();
  }

  function renderStep() {
    const f = current();
    const s = f.screens[stepIndex];

    Array.from(ui.steps.children).forEach((li, i) => {
      const btn = li.firstChild;
      btn.classList.toggle("is-active", i === stepIndex);
      btn.classList.toggle("is-done", i < stepIndex);
      btn.setAttribute("aria-current", i === stepIndex ? "step" : "false");
      if (i === stepIndex) btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    Array.from(ui.progress.children).forEach((bar, i) => bar.classList.toggle("is-on", i <= stepIndex));

    ui.captionLabel.textContent = s.label || "Step " + (stepIndex + 1);
    ui.captionText.textContent = s.caption;
    ui.count.textContent = f.screens.length > 1 ? "Step " + (stepIndex + 1) + " of " + f.screens.length : "";

    const atStart = featureIndex === 0 && stepIndex === 0;
    const lastStep = stepIndex === f.screens.length - 1;
    const atEnd = featureIndex === order.length - 1 && lastStep;
    prevBtn.disabled = atStart;
    ui.nextLabel.textContent = atEnd ? "Finish tour" : lastStep ? "Next: " + byId(order[featureIndex + 1]).title : "Next step";

    // Show the version the visitor picked earlier when this step has one.
    const match = s.media.findIndex((m, i) => versionLabel(m, i).toLowerCase() === preferredVersion.toLowerCase());
    versionIndex = match >= 0 ? match : 0;
    renderVersions();

    ui.stage.scrollTop = 0;
    ui.stage.scrollLeft = 0;
    showMedia(s.media[versionIndex], s);
    preloadNext();
  }

  function renderVersions() {
    const media = current().screens[stepIndex].media;
    ui.versions.hidden = media.length < 2;
    ui.versions.innerHTML = "";
    if (media.length < 2) return;
    media.forEach((m, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = versionLabel(m, i);
      btn.setAttribute("aria-pressed", i === versionIndex ? "true" : "false");
      btn.addEventListener("click", () => {
        if (i === versionIndex) return;
        versionIndex = i;
        preferredVersion = versionLabel(m, i);
        renderVersions();
        showMedia(m, current().screens[stepIndex]);
      });
      ui.versions.appendChild(btn);
    });
  }

  function showMedia(m, s) {
    if (m.type === "html") {
      // Interactive capture: its player keeps the page's own proportions.
      pdfDoc = null;
      pdfToken++;
      ui.pdf.hidden = true;
      ui.pdf.innerHTML = "";
      ui.image.hidden = true;
      ui.image.removeAttribute("src");
      ui.canvas.classList.remove("is-loading");
      ui.live.style.aspectRatio = (m.w || 16) + " / " + (m.h || 10);
      if (ui.live.getAttribute("src") !== m.url) ui.live.setAttribute("src", m.url);
      ui.live.hidden = false;
      return;
    }
    ui.live.hidden = true;
    ui.live.removeAttribute("src");
    if (m.type === "pdf") {
      ui.image.hidden = true;
      ui.image.removeAttribute("src");
      ui.canvas.classList.remove("is-loading");
      ui.pdf.hidden = false;
      loadPdf(m.url);
      return;
    }
    pdfDoc = null;
    pdfToken++;
    ui.pdf.hidden = true;
    ui.pdf.innerHTML = "";
    ui.image.hidden = false;
    ui.image.alt = s.label || current().title;
    if (ui.image.getAttribute("src") !== m.url) {
      ui.canvas.classList.add("is-loading");
      ui.image.src = m.url;
    }
  }

  ui.image.addEventListener("load", () => ui.canvas.classList.remove("is-loading"));
  ui.image.addEventListener("error", () => ui.canvas.classList.remove("is-loading"));

  function preloadNext() {
    const f = current();
    const s = f.screens[stepIndex];
    s.media.forEach((m) => { if (m.type === "image") new Image().src = m.url; });
    const next = f.screens[stepIndex + 1] || (byId(order[featureIndex + 1]) || { screens: [] }).screens[0];
    if (next && next.media[0] && next.media[0].type === "image") new Image().src = next.media[0].url;
  }

  function goToStep(i) {
    stepIndex = i;
    renderStep();
  }

  function step(dir) {
    const f = current();
    if (dir > 0) {
      if (stepIndex < f.screens.length - 1) return goToStep(stepIndex + 1);
      if (featureIndex < order.length - 1) return openFeature(order[featureIndex + 1], 0);
      return close();
    }
    if (stepIndex > 0) return goToStep(stepIndex - 1);
    if (featureIndex > 0) {
      const prev = byId(order[featureIndex - 1]);
      return openFeature(prev.id, prev.screens.length - 1);
    }
  }

  // ---------- Zoom ----------

  function setZoom(value) {
    zoom = value;
    frame.style.setProperty("--tv-zoom", String(zoom / 100));
    ui.zoom.textContent = zoom + "%";
    viewer.querySelector('[data-tv-zoom="-1"]').disabled = zoom <= ZOOM_STEPS[0];
    viewer.querySelector('[data-tv-zoom="1"]').disabled = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
    if (pdfDoc) renderPdf();
  }

  function zoomBy(dir) {
    if (dir === 0) return setZoom(100);
    const i = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))];
    if (next !== zoom) setZoom(next);
  }

  viewer.querySelectorAll("[data-tv-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => zoomBy(Number(btn.getAttribute("data-tv-zoom"))));
  });

  // ---------- PDF (loaded only when a PDF step opens) ----------

  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let pdfjsPromise = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = PDFJS + "pdf.min.js";
        script.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
          resolve(window.pdfjsLib);
        };
        script.onerror = () => { pdfjsPromise = null; reject(new Error("PDF.js failed to load")); };
        document.head.appendChild(script);
      });
    }
    return pdfjsPromise;
  }

  function pdfMessage(text, url) {
    ui.pdf.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = text + " ";
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Open the document";
      p.appendChild(a);
    }
    ui.pdf.appendChild(p);
  }

  async function loadPdf(url) {
    const token = ++pdfToken;
    pdfDoc = null;
    pdfMessage("Loading document…");
    try {
      const lib = await pdfjs();
      const doc = await lib.getDocument(url).promise;
      if (token !== pdfToken) return;
      pdfDoc = doc;
      renderPdf();
    } catch (err) {
      if (token === pdfToken) pdfMessage("This document could not be shown here.", url);
    }
  }

  async function renderPdf() {
    const token = ++pdfToken;
    const doc = pdfDoc;
    const width = Math.max(280, ui.pdf.clientWidth - 24);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (token !== pdfToken) return;
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (token !== pdfToken) return;
      pages.push(canvas);
    }
    ui.pdf.replaceChildren(...pages);
  }

  // ---------- Controls ----------

  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  viewer.querySelector("[data-tv-close]").addEventListener("click", () => close());
  viewer.addEventListener("click", (e) => { if (e.target === viewer) close(); });
  viewer.querySelector("[data-tv-focus]").addEventListener("click", (e) => {
    const on = panel.classList.toggle("is-focus");
    e.currentTarget.setAttribute("aria-label", on ? "Show steps" : "Hide steps");
    if (pdfDoc) renderPdf();
  });

  document.addEventListener("keydown", (e) => {
    if (!isOpen || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1); }
    else if (e.key === "-") { e.preventDefault(); zoomBy(-1); }
    else if (e.key === "0") { e.preventDefault(); zoomBy(0); }
    else if (e.key === "Tab") {
      // Keep keyboard focus inside the dialog.
      const items = Array.from(panel.querySelectorAll("button:not([disabled]), a[href]")).filter((n) => n.offsetParent);
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Swipe between steps when the screen is not zoomed in.
  let touchX = null;
  let touchY = null;
  ui.stage.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  ui.stage.addEventListener("touchend", (e) => {
    if (touchX === null || zoom > 100) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (isOpen && pdfDoc) renderPdf(); }, 200);
  });

  function syncWithHash(hash) {
    const match = /^#feature-(\d+)$/.exec(typeof hash === "string" ? hash : location.hash);
    if (match && byId(match[1])) {
      if (!isOpen || String(current().id) !== match[1]) openFeature(match[1], 0, false);
    } else if (isOpen) {
      close(true);
    }
  }
  window.addEventListener("popstate", () => syncWithHash());
  syncWithHash(window.__tourHash || location.hash);
})();
