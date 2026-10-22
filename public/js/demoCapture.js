// Demo capture bar (see utils/appDemoCapture.js). Shown to staff of the school
// an Admin opened a capture window for. "Capture this page" records the page,
// then every click on a toggle, tab or expander adds the state it leads to;
// "Finish" saves the recording as an interactive step of the product tour.
//
// A capture is a self-contained copy of the page: styles are inlined, scripts
// and event handlers are removed, form values, charts (canvas) and embedded
// panes (same-origin iframes) are kept. Each clicked element is stamped with
// data-mcap-el so the player can replay the same click on the same element.
(function () {
  "use strict";
  if (window.top !== window || window.__managiraDemoCapture) return;
  window.__managiraDemoCapture = true;

  const script = document.currentScript || document.querySelector("script[data-ends-at]");
  // Updated from the server: an Admin can restart (extend) or turn off capture at any time.
  let endsAt = new Date(script && script.dataset.endsAt);
  let school = (script && script.dataset.school) || "";
  if (!(endsAt > new Date())) return;

  const MAX_STATES = 40;
  const SWATCHES = ["#14b8a6", "#3b82f6", "#8b5cf6", "#f59e0b", "#f43f5e", "#0b1b2b"];
  const STRIP = [
    "script", "noscript", "template", "[data-mcap-ui]", ".page-loading-overlay", "#spa-progress",
    ".chatbot-container", ".chatbot-toggle", "#ann-banner-stack", "#ann-modal-overlay", ".ss-root",
    ".back-to-admin-chip", "[class^='mfb']",
  ].join(",");
  const INTERACTIVE = [
    "a[href]", "button", "summary", "label", "select", "input", "textarea",
    "[role='button']", "[role='tab']", "[role='switch']", "[role='menuitem']", "[role='option']", "[role='checkbox']",
    "[aria-expanded]", "[aria-controls]", "[data-toggle]", "[data-bs-toggle]", "[onclick]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  // Files anyone can load; other same-origin images are copied into the capture.
  const PUBLIC_PATHS = /^\/(images|css|js|vendor|fonts|icons|Demo%20Images|Demo Images|favicon)/i;

  // ---------- UI (shadow DOM keeps the app's styles out) ----------

  const host = document.createElement("div");
  host.setAttribute("data-mcap-ui", "");
  host.style.cssText = "position:fixed;left:20px;bottom:20px;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      [hidden] { display: none !important; }
      * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .bar { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 14px; background: #0b1b2b; color: #e6edf3;
             box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 16px 40px -12px rgba(0,0,0,.45); font-size: 13px; line-height: 1.3; max-width: calc(100vw - 40px); }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #2dd4bf; flex: none; box-shadow: 0 0 0 3px rgba(45,212,191,.2); }
      .dot.rec { background: #f43f5e; box-shadow: 0 0 0 3px rgba(244,63,94,.25); animation: blink 1.2s ease-in-out infinite; }
      .txt { display: grid; gap: 1px; min-width: 0; }
      .txt strong { font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; }
      .txt span { font-size: 11.5px; color: #93a4b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
      .sep { width: 1px; align-self: stretch; background: rgba(255,255,255,.12); }
      button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px;
               border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s, opacity .15s; }
      button:focus-visible { outline: 2px solid #2dd4bf; outline-offset: 2px; }
      button:disabled { opacity: .5; cursor: default; }
      .primary { background: #14b8a6; color: #04201d; }
      .primary:hover { background: #2dd4bf; }
      .ghost { color: #cbd5e1; }
      .ghost:hover { background: rgba(255,255,255,.08); color: #fff; }
      .icon { width: 32px; padding: 0; color: #93a4b8; }
      .icon:hover { background: rgba(255,255,255,.08); color: #fff; }
      svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .mini { padding: 6px; }
      .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 12px); opacity: 0; transition: .2s; pointer-events: none;
               padding: 10px 14px; border-radius: 10px; background: #0b1b2b; color: #fff; font-size: 13px; box-shadow: 0 12px 32px -8px rgba(0,0,0,.4); max-width: 440px; text-align: center; }
      .toast.on { opacity: 1; transform: translate(-50%, 0); }
      .toast.err { background: #b42318; }
      .scrim { position: fixed; inset: 0; background: rgba(8,18,28,.55); backdrop-filter: blur(4px); display: grid; place-items: center; padding: 16px; }
      .modal { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto; border-radius: 16px; background: #fff; color: #3b4a5c; box-shadow: 0 40px 100px -20px rgba(0,0,0,.5); }
      .m-head { padding: 20px 22px 4px; }
      .m-head h2 { margin: 0; font-size: 17px; font-weight: 650; color: #0b1b2b; letter-spacing: -.01em; }
      .m-head p { margin: 6px 0 0; font-size: 13px; color: #6b7a8c; line-height: 1.5; }
      .stats { display: flex; gap: 8px; padding: 14px 22px 0; flex-wrap: wrap; }
      .stat { padding: 5px 10px; border-radius: 999px; background: #f1f5f8; font-size: 12px; font-weight: 600; color: #3b4a5c; }
      .m-body { display: grid; gap: 14px; padding: 18px 22px; }
      .field { display: grid; gap: 6px; }
      .field > span { font-size: 12.5px; font-weight: 600; color: #0b1b2b; }
      .field small { font-size: 11.5px; color: #6b7a8c; }
      input { all: unset; box-sizing: border-box; width: 100%; height: 38px; padding: 0 11px; border: 1px solid #d3dbe4; border-radius: 9px; font-size: 13.5px; color: #0b1b2b; background: #fff; }
      select { box-sizing: border-box; width: 100%; height: 38px; margin: 0; padding: 0 8px; border: 1px solid #d3dbe4; border-radius: 9px; font-size: 13.5px; color: #0b1b2b; background: #fff; outline: none; }
      input:focus, select:focus { border-color: #01535b; box-shadow: 0 0 0 3px rgba(1,83,91,.14); }
      .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 10px; background: #f1f5f8; }
      .seg button { height: 32px; color: #3b4a5c; font-weight: 600; }
      .seg button[aria-pressed="true"] { background: #fff; color: #0b1b2b; box-shadow: 0 1px 2px rgba(11,27,43,.08), 0 0 0 1px #e4e9ef; }
      .switch { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 12px; border: 1px solid #e4e9ef; border-radius: 10px; cursor: pointer; }
      .switch input { position: absolute; opacity: 0; pointer-events: none; }
      .switch .track { position: relative; width: 34px; height: 20px; margin-top: 1px; border-radius: 999px; background: #cfd6de; transition: background-color .15s; }
      .switch .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s; }
      .switch input:checked + .track { background: #01535b; }
      .switch input:checked + .track::after { transform: translateX(14px); }
      .switch input:focus-visible + .track { outline: 2px solid #01535b; outline-offset: 2px; }
      .switch-text { display: grid; gap: 2px; }
      .switch-text b { font-size: 13px; font-weight: 600; color: #0b1b2b; }
      .switch-text small { font-size: 11.5px; color: #6b7a8c; line-height: 1.45; }
      .guide { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 8px; max-height: 240px; overflow: auto; }
      .guide li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; align-items: start; }
      .guide .n { display: grid; place-items: center; width: 22px; height: 22px; margin-top: 2px; border-radius: 50%; background: #0b1b2b; color: #fff; font-size: 11px; font-weight: 700; }
      .guide em { display: block; margin-bottom: 4px; font-style: normal; font-size: 12px; font-weight: 600; color: #3b4a5c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .guide input { height: 34px; font-size: 13px; }
      .swatches { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sw { width: 28px; height: 28px; padding: 0; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
      .sw[aria-pressed="true"] { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--c); }
      .sw--custom { position: relative; width: auto; height: 28px; padding: 0 10px 0 30px; display: inline-flex; align-items: center; border-radius: 999px; background: #f1f5f8; box-shadow: none; font-size: 12px; font-weight: 600; color: #3b4a5c; cursor: pointer; }
      .sw--custom input { all: unset; position: absolute; left: 4px; top: 4px; width: 20px; height: 20px; border-radius: 50%; overflow: hidden; cursor: pointer; }
      .sw--custom input::-webkit-color-swatch-wrapper { padding: 0; }
      .sw--custom input::-webkit-color-swatch { border: 0; border-radius: 50%; }
      .note { display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px; background: #fff8eb; color: #8a4b0a; font-size: 12.5px; line-height: 1.5; }
      .m-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 22px 18px; border-top: 1px solid #eef2f5; }
      .m-foot .status { margin-right: auto; font-size: 12.5px; color: #6b7a8c; }
      .m-foot .ghost { color: #3b4a5c; border: 1px solid #d3dbe4; }
      .m-foot .ghost:hover { background: #f5f7f9; color: #0b1b2b; }
      .m-foot .primary { background: #01535b; color: #fff; }
      .m-foot .primary:hover { background: #013f45; }
      .done { padding: 28px 22px 8px; text-align: center; }
      .done .ok { width: 44px; height: 44px; margin: 0 auto 12px; display: grid; place-items: center; border-radius: 50%; background: #e6f6ee; color: #067647; }
      .done .ok svg { width: 22px; height: 22px; }
      .done h2 { margin: 0; font-size: 17px; color: #0b1b2b; }
      .done p { margin: 6px 0 0; font-size: 13px; color: #6b7a8c; }
      .links { display: flex; justify-content: center; gap: 8px; padding: 16px 22px 22px; }
      .links a { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 9px; font-size: 13px; font-weight: 600; text-decoration: none; }
      .links a.primary { background: #01535b; color: #fff; }
      .links a.ghost { border: 1px solid #d3dbe4; color: #0b1b2b; }
      @keyframes blink { 50% { opacity: .35; } }
    </style>
    <div class="bar" part="bar"></div>
    <div class="toast" role="status"></div>
    <div class="layer"></div>`;
  const bar = shadow.querySelector(".bar");
  const toastEl = shadow.querySelector(".toast");
  const layer = shadow.querySelector(".layer");
  const ICON = {
    camera: '<svg viewBox="0 0 20 20"><path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11" r="3"/></svg>',
    check: '<svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg>',
    min: '<svg viewBox="0 0 20 20"><path d="M5 10h10"/></svg>',
    max: '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10"/></svg>',
  };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Shown only once the server confirms capture is on (the page may be an old copy).
  let active = false;
  function mount() { if (active && !host.isConnected) document.documentElement.appendChild(host); }
  const mountTimer = setInterval(mount, 1000); // page navigation (spa-router) can replace the body

  let toastTimer = null;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle("err", Boolean(isError));
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("on"), isError ? 5000 : 2800);
  }

  const left = () => Math.max(0, endsAt - new Date());
  const clock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  let mode = "idle"; // idle | preparing | recording | saving
  let minimized = false;
  let rec = null;

  function renderBar() {
    if (mode === "recording") {
      bar.innerHTML = `<span class="dot rec"></span>
        <span class="txt"><strong>${(() => { const n = rec.guide.length + (rec.pending ? 1 : 0); return n ? "Recording · " + n + (n === 1 ? " step" : " steps") : "Recording"; })()}</strong>
        <span>Click the toggles, tabs and expanders visitors should try. Wait for each change to finish.</span></span>
        <span class="sep"></span>
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="finish">${ICON.check}Finish</button>`;
      return;
    }
    if (minimized) {
      bar.innerHTML = `<button class="icon mini" data-act="expand" title="Demo capture">${ICON.camera}</button>`;
      return;
    }
    bar.innerHTML = `<span class="dot"></span>
      <span class="txt"><strong>Demo capture</strong><span>${esc(school)} · <b data-clock>${clock(left())}</b> left</span></span>
      <span class="sep"></span>
      <button class="primary" data-act="start"${mode === "preparing" ? " disabled" : ""}>${ICON.camera}${mode === "preparing" ? "Preparing…" : "Capture this page"}</button>
      <button class="icon" data-act="minimize" title="Minimize" aria-label="Minimize">${ICON.min}</button>`;
  }

  bar.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "start") start();
    else if (a === "cancel") stop(false);
    else if (a === "finish") stop(true);
    else if (a === "minimize") { minimized = true; renderBar(); }
    else if (a === "expand") { minimized = false; renderBar(); }
  });

  const ticker = setInterval(() => {
    const ms = left();
    if (ms <= 0 && mode !== "saving") return shutDown("The capture time is up.");
    const c = shadow.querySelector("[data-clock]");
    if (c) c.textContent = clock(ms);
  }, 1000);

  // ---------- On / off (checked with the server) ----------

  let shutting = false;
  function shutDown(message) {
    if (shutting) return;
    shutting = true;
    active = false;
    clearInterval(ticker);
    clearInterval(mountTimer);
    clearInterval(statusTimer);
    if (mode === "recording" || mode === "preparing") cleanupStamps();
    rec = null;
    mode = "idle";
    if (!message || !host.isConnected) { host.remove(); return; }
    layer.innerHTML = "";
    bar.innerHTML = `<span class="dot" style="background:#94a3b8;box-shadow:none"></span>
      <span class="txt"><strong>Demo capture is off</strong><span>${esc(message)}</span></span>`;
    setTimeout(() => host.remove(), 3500);
  }

  async function checkStatus() {
    if (shutting || mode === "saving") return; // a save in progress gets its answer from the server
    try {
      const res = await fetch("/app-demo-capture/status", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const status = await res.json();
      if (!status.active) return shutDown(active ? "It was turned off or has ended." : "");
      endsAt = new Date(status.endsAt);
      if (status.school) school = status.school;
      if (!active) {
        active = true;
        renderBar();
        mount();
      }
    } catch (_) { /* offline for a moment: keep the current state */ }
  }
  const statusTimer = setInterval(checkStatus, 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkStatus(); });
  window.addEventListener("focus", checkStatus);
  window.addEventListener("pageshow", (e) => { if (e.persisted) checkStatus(); });

  renderBar();
  checkStatus();

  // ---------- Stylesheets (fetched once, inlined into every snapshot) ----------

  const cssCache = new Map();
  const absUrl = (u, base) => { try { return new URL(u, base).href; } catch (_) { return u; } };
  const sameOrigin = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch (_) { return false; } };

  function frameDocs(doc, out) {
    out = out || [];
    out.push(doc);
    doc.querySelectorAll("iframe").forEach((f) => {
      try { if (f.contentDocument && f.contentDocument.documentElement) frameDocs(f.contentDocument, out); } catch (_) { /* cross-origin */ }
    });
    return out;
  }

  async function loadStylesheets() {
    const hrefs = new Set();
    frameDocs(document).forEach((d) => d.querySelectorAll("link[rel~='stylesheet'][href]").forEach((l) => {
      const href = absUrl(l.getAttribute("href"), d.baseURI);
      if (sameOrigin(href) && !cssCache.has(href)) hrefs.add(href);
    }));
    await Promise.all([...hrefs].map(async (href) => {
      try {
        const res = await fetch(href, { credentials: "same-origin" });
        if (!res.ok) return;
        const css = await res.text();
        cssCache.set(href, css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) =>
          /^(data:|https?:|\/\/|#|about:)/i.test(u.trim()) ? m : `url("${absUrl(u.trim(), href)}")`));
      } catch (_) { /* keep the link */ }
    }));
  }

  // ---------- Snapshot ----------

  const attrsOf = (el) => {
    const out = {};
    for (const a of Array.from(el.attributes)) if (!/^on/i.test(a.name)) out[a.name] = a.value;
    return out;
  };

  function snapshotDoc(doc) {
    const root = doc.documentElement;
    const clone = root.cloneNode(true);
    const src = root.querySelectorAll("*");
    const dst = clone.querySelectorAll("*");
    const swaps = [];
    for (let i = 0; i < src.length; i++) {
      const o = src[i];
      const c = dst[i];
      if (!c) break;
      switch (o.tagName) {
        case "INPUT": {
          const type = (o.type || "").toLowerCase();
          if (type === "checkbox" || type === "radio") {
            if (o.checked) c.setAttribute("checked", ""); else c.removeAttribute("checked");
          } else if (type === "password" || type === "file") {
            c.removeAttribute("value");
          } else {
            c.setAttribute("value", o.value);
          }
          break;
        }
        case "TEXTAREA": c.textContent = o.value; break;
        case "SELECT":
          Array.from(o.options).forEach((opt, j) => {
            const co = c.options && c.options[j];
            if (co) { if (opt.selected) co.setAttribute("selected", ""); else co.removeAttribute("selected"); }
          });
          break;
        case "CANVAS":
          try {
            const img = doc.createElement("img");
            for (const a of Array.from(o.attributes)) if (a.name !== "width" && a.name !== "height") img.setAttribute(a.name, a.value);
            const r = o.getBoundingClientRect();
            img.src = o.toDataURL("image/png");
            img.style.width = (r.width || o.width) + "px";
            img.style.height = (r.height || o.height) + "px";
            swaps.push([c, img]);
          } catch (_) { /* tainted canvas */ }
          break;
        case "IFRAME":
          try {
            const d = o.contentDocument;
            if (d && d.documentElement && d.body) {
              c.setAttribute("srcdoc", toHtml(snapshotDoc(d)));
              c.removeAttribute("src");
              c.removeAttribute("loading");
            }
          } catch (_) { /* cross-origin frame stays as it is */ }
          break;
        case "STYLE":
          // Rules added through the CSSOM are not in the tag's text.
          if (o.sheet && !o.textContent.trim()) {
            try { c.textContent = Array.from(o.sheet.cssRules).map((r) => r.cssText).join("\n"); } catch (_) { /* ignore */ }
          }
          break;
        default:
      }
      if (o.scrollTop > 0 || o.scrollLeft > 0) c.setAttribute("data-mcap-scroll", Math.round(o.scrollTop) + "," + Math.round(o.scrollLeft));
    }
    swaps.forEach(([c, n]) => c.replaceWith(n));
    clone.querySelectorAll(STRIP).forEach((n) => n.remove());
    // Scroll locks left by removed pop-ups, and appearance.js's brief transition guard.
    [clone, clone.querySelector("body")].forEach((n) => { if (n) n.classList.remove("mfb-open", "modal-open", "ann-modal-open", "no-scroll", "ap-still"); });
    clone.querySelectorAll("link").forEach((l) => {
      const rel = (l.getAttribute("rel") || "").toLowerCase();
      if (!/stylesheet|icon/.test(rel)) { l.remove(); return; }
      const href = absUrl(l.getAttribute("href") || "", doc.baseURI);
      if (/stylesheet/.test(rel) && cssCache.has(href)) {
        const style = doc.createElement("style");
        if (l.media) style.setAttribute("media", l.media);
        style.textContent = cssCache.get(href);
        l.replaceWith(style);
      } else {
        l.setAttribute("href", href);
      }
    });
    clone.querySelectorAll("*").forEach((el) => {
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) el.setAttribute(a.name, "#");
      }
    });
    const scrollEl = doc.scrollingElement || root;
    if (doc !== document && (scrollEl.scrollTop || scrollEl.scrollLeft)) clone.setAttribute("data-mcap-scroll", Math.round(scrollEl.scrollTop) + "," + Math.round(scrollEl.scrollLeft));

    let head = clone.querySelector("head");
    if (!head) { head = doc.createElement("head"); clone.prepend(head); }
    head.querySelectorAll("base, meta[http-equiv]").forEach((n) => n.remove());
    const base = doc.createElement("base");
    base.setAttribute("href", doc.baseURI);
    head.prepend(base);
    const charset = doc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    head.prepend(charset);
    const body = clone.querySelector("body") || clone;
    return {
      htmlAttrs: attrsOf(clone),
      bodyAttrs: body === clone ? {} : attrsOf(body),
      head: head.innerHTML,
      body: body === clone ? "" : body.innerHTML,
      scrollY: Math.round(doc.defaultView ? doc.defaultView.scrollY : 0),
    };
  }

  function attrString(attrs) {
    return Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
  }
  function toHtml(s) {
    return `<!DOCTYPE html><html${attrString(s.htmlAttrs)}><head>${s.head}</head><body${attrString(s.bodyAttrs)}>${s.body}</body></html>`;
  }

  // FNV-1a; states are compared without the click stamps.
  function hashOf(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ":" + str.length;
  }
  const unstamped = (html) => html.replace(/ data-mcap-el="\d+"/g, "");

  function takeSnapshot() {
    const snap = snapshotDoc(document);
    let head = rec.heads.indexOf(snap.head);
    if (head < 0) { rec.heads.push(snap.head); head = rec.heads.length - 1; }
    const state = { head, body: snap.body, htmlAttrs: snap.htmlAttrs, bodyAttrs: snap.bodyAttrs, scrollY: snap.scrollY };
    const key = head + "|" + hashOf(unstamped(snap.body) + JSON.stringify(snap.bodyAttrs) + JSON.stringify(snap.htmlAttrs));
    if (rec.keys.has(key)) {
      // Same view as before: keep the newer copy, which carries every stamp so far.
      const i = rec.keys.get(key);
      rec.states[i] = state;
      return i;
    }
    if (rec.states.length >= MAX_STATES) return -1;
    rec.states.push(state);
    rec.keys.set(key, rec.states.length - 1);
    return rec.states.length - 1;
  }

  // Each click that changed the page becomes a link (for free clicking) and a
  // step of the guided walkthrough (in the order it was recorded).
  function linkPending(to) {
    const p = rec.pending;
    rec.pending = null;
    if (!p || to < 0 || p.from === to) return;
    if (!rec.links.some((l) => l.from === p.from && l.el === p.el)) rec.links.push({ from: p.from, el: p.el, to });
    rec.guide.push({ from: p.from, el: p.el, to, label: p.label });
  }

  // ---------- Recording ----------

  // The element a visitor should click: a button, link, tab… or, for clickable
  // areas built from plain elements (menus, cards), the whole pointer area.
  function clickTarget(el) {
    const hit = el.closest(INTERACTIVE);
    if (hit) return hit;
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    let best = el;
    for (let n = el; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
      if (win.getComputedStyle(n).cursor !== "pointer") break;
      best = n;
    }
    return best;
  }

  // A short name for the walkthrough editor, e.g. "Teachers" or "Menu".
  function labelOf(el) {
    let text = el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("alt") || "";
    text = String(text).replace(/\s+/g, " ").trim()
      .replace(/(\s*([›»→⌄▾▸▼•·|×]|\d+\+?))+$/u, "") // trailing counts, badges and arrows
      .trim();
    if (!text) {
      const hint = (el.id + " " + (typeof el.className === "string" ? el.className : "")).toLowerCase();
      if (/hamburger|menu|nav-toggle/.test(hint)) text = "Menu";
      else if (/search/.test(hint)) text = "Search";
      else if (/notif|bell/.test(hint)) text = "Notifications";
      else if (/close/.test(hint)) text = "Close";
      else if (/profile|avatar|user/.test(hint)) text = "Profile";
    }
    return text.length > 48 ? text.slice(0, 46).trim() + "…" : text;
  }

  const watched = new WeakSet();
  function watchFrames() {
    frameDocs(document).forEach((d) => {
      const win = d.defaultView;
      if (!win || watched.has(win)) return;
      watched.add(win);
      win.addEventListener("click", onClick, true);
    });
  }

  function onClick(e) {
    if (mode !== "recording") return;
    if (e.composedPath().includes(host)) return;
    const el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (!el) return;
    const target = clickTarget(el);
    const doc = target.ownerDocument;

    // Leaving the page would end the recording.
    const a = target.closest("a[href]");
    if (a && doc === document) {
      const href = a.getAttribute("href") || "";
      const url = absUrl(href, document.baseURI);
      const leaves = !href.startsWith("#") && !/^javascript:/i.test(href) && (a.target === "_blank" || url.split("#")[0] !== location.href.split("#")[0]);
      if (leaves) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toast("Links to other pages aren't recorded. Finish here, then capture that page separately.");
        return;
      }
    }

    let id = target.getAttribute("data-mcap-el");
    if (!id) {
      id = String(rec.nextEl++);
      target.setAttribute("data-mcap-el", id);
    }
    const state = takeSnapshot();
    linkPending(state);
    if (state < 0) {
      toast("This recording has reached " + MAX_STATES + " views. Finish to save it.", true);
      return;
    }
    rec.pending = { from: state, el: id, label: labelOf(target) };
    renderBar();
    loadStylesheets(); // new panes may bring new stylesheets
    watchFrames();
  }

  let frameTimer = null;
  async function start() {
    if (mode !== "idle") return;
    mode = "preparing";
    renderBar();
    try {
      await loadStylesheets();
      // The first view is taken at the first click (or at Finish), so it matches
      // exactly the page that was clicked.
      rec = { heads: [], states: [], keys: new Map(), links: [], guide: [], pending: null, nextEl: 1 };
      mode = "recording";
      watchFrames();
      frameTimer = setInterval(watchFrames, 800);
      renderBar();
    } catch (err) {
      mode = "idle";
      renderBar();
      toast("Could not start the capture: " + err.message, true);
    }
  }

  function cleanupStamps() {
    clearInterval(frameTimer);
    frameDocs(document).forEach((d) => d.querySelectorAll("[data-mcap-el]").forEach((n) => n.removeAttribute("data-mcap-el")));
  }

  async function stop(save) {
    if (mode !== "recording") return;
    if (!save) {
      cleanupStamps();
      rec = null;
      mode = "idle";
      renderBar();
      toast("Capture discarded");
      return;
    }
    await loadStylesheets();
    linkPending(takeSnapshot());
    cleanupStamps();
    mode = "saving";
    renderBar();
    const data = {
      v: 1,
      title: document.title,
      url: location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      heads: rec.heads,
      states: rec.states,
      links: rec.links,
      guide: rec.guide,
    };
    rec = null;
    try { markEverywhere(data); } catch (_) { /* clicks still work from the views they were recorded in */ }
    try {
      await inlinePrivateImages(data);
    } catch (_) { /* images stay as links */ }
    openSaveDialog(data);
  }

  // What an element is, across views: classes like "open" or "active" change, its tag, id and label don't.
  function sameElementKey(el) {
    if (el.id) return el.tagName + "#" + el.id;
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter((c) => c && !/^(is-|has-)|^(open|opened|active|show|shown|expanded|collapsed|selected|current|hidden)$/.test(c)).sort().join(".");
    return el.tagName + "." + cls + "|" + (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  // A view only carries the stamps of clicks made before it was saved; mark
  // every recorded element in every view it appears in, so visitors can click
  // them in any order.
  function markEverywhere(data) {
    const parsed = data.states.map((st) => new DOMParser().parseFromString("<!DOCTYPE html><html><body>" + st.body + "</body></html>", "text/html"));
    const keys = new Map();
    parsed.forEach((doc) => doc.querySelectorAll("[data-mcap-el]").forEach((el) => {
      const id = el.getAttribute("data-mcap-el");
      if (!keys.has(id)) keys.set(id, sameElementKey(el));
    }));
    parsed.forEach((doc, i) => {
      let changed = false;
      keys.forEach((key, id) => {
        if (doc.querySelector('[data-mcap-el="' + id + '"]')) return;
        const tag = key.split(/[#.]/)[0];
        const matches = [...doc.body.getElementsByTagName(tag)].filter((el) => !el.hasAttribute("data-mcap-el") && sameElementKey(el) === key);
        if (matches.length === 1) { matches[0].setAttribute("data-mcap-el", id); changed = true; }
      });
      if (changed) data.states[i].body = doc.body.innerHTML;
    });
  }

  // Images behind a login (or on signed, expiring links) are copied into the capture.
  async function inlinePrivateImages(data) {
    const all = data.heads.concat(data.states.map((s) => s.body));
    const found = new Set();
    all.forEach((html) => html.replace(/<img\b[^>]*?\ssrc="([^"]+)"/gi, (m, src) => { found.add(src); return m; }));
    const swaps = new Map();
    await Promise.all([...found].map(async (raw) => {
      const src = raw.replace(/&amp;/g, "&");
      if (/^data:/i.test(src)) return;
      const url = absUrl(src, location.href);
      const u = new URL(url);
      const isPrivate = (u.origin === location.origin && !PUBLIC_PATHS.test(decodeURIComponent(u.pathname))) || /X-Amz-Signature=/i.test(u.search);
      if (!isPrivate) return;
      try {
        const res = await fetch(url, { credentials: u.origin === location.origin ? "same-origin" : "omit" });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!/^image\//.test(blob.type) || blob.size > 1.5 * 1024 * 1024) return;
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        swaps.set(raw, dataUrl);
      } catch (_) { /* leave it */ }
    }));
    if (!swaps.size) return;
    const swap = (html) => html.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/gi, (m, a, src, b) => (swaps.has(src) ? a + swaps.get(src) + b : m));
    data.heads = data.heads.map(swap);
    data.states.forEach((s) => { s.body = swap(s.body); });
  }

  // ---------- Save ----------

  function cleanTitle(t) {
    return String(t || "").replace(/\s*[|·-]\s*Managira.*$/i, "").trim().slice(0, 80);
  }

  async function openSaveDialog(data) {
    layer.innerHTML = `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mcap-title">
      <div class="m-head"><h2 id="mcap-title">Save to the product tour</h2>
        <p>Visitors will be able to click through this page on the public tour.</p></div>
      <div class="stats"><span class="stat">${data.guide.length} ${data.guide.length === 1 ? "step" : "steps"}</span>
        <span class="stat">${data.states.length} ${data.states.length === 1 ? "view" : "views"}</span>
        <span class="stat">${data.viewport.w} × ${data.viewport.h}</span></div>
      <div class="m-body"><p style="margin:0;font-size:13px;color:#6b7a8c">Loading the tour…</p></div>
      <div class="m-foot"><span class="status"></span><button class="ghost" data-act="discard">Discard</button><button class="primary" data-act="save" disabled>Save</button></div>
    </div></div>`;
    const modal = layer.querySelector(".modal");
    const bodyEl = modal.querySelector(".m-body");
    const saveBtn = modal.querySelector('[data-act="save"]');
    const statusEl = modal.querySelector(".status");
    modal.querySelector('[data-act="discard"]').addEventListener("click", () => {
      if (!window.confirm("Discard this capture?")) return;
      closeDialog();
    });

    let sections = [];
    try {
      const res = await fetch("/app-demo-capture/targets", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not load the tour.");
      sections = json.sections;
    } catch (err) {
      bodyEl.innerHTML = `<p style="margin:0;color:#b42318;font-size:13px">${esc(err.message)}</p>`;
      return;
    }
    const features = sections.flatMap((s) => s.features.map((f) => Object.assign({ section: s.name }, f)));
    if (!features.length) {
      bodyEl.innerHTML = '<p style="margin:0;font-size:13px">Create a feature in Admin → App Demo first, then save the capture to it.</p>';
      return;
    }
    const last = (() => { try { return JSON.parse(localStorage.getItem("mcap:last") || "{}"); } catch (_) { return {}; } })();
    bodyEl.innerHTML = `
      <label class="field"><span>Feature</span>
        <select data-f="feature">${sections.map((s) => `<optgroup label="${esc(s.name)}">${s.features.map((f) => `<option value="${f.id}">${esc(f.title)}</option>`).join("")}</optgroup>`).join("")}</select></label>
      <div class="field"><span>Add as</span>
        <div class="seg"><button type="button" data-mode="new" aria-pressed="true">New step</button><button type="button" data-mode="version" aria-pressed="false">Version of a step</button></div></div>
      <label class="field" data-show="new"><span>Step title</span><input data-f="step" maxlength="80" value="${esc(cleanTitle(data.title))}" placeholder="e.g. Class dashboard"></label>
      <label class="field" data-show="version" hidden><span>Step</span><select data-f="screen"></select>
        <small>The interactive version is shown first; visitors can switch to the others.</small></label>
      <label class="field"><span>Version name</span><input data-f="version" maxlength="30" value="Interactive"><small>Shown on the switch in the viewer, e.g. Interactive, Light, Dark.</small></label>
      <div class="field"><span>Walkthrough</span>
        ${data.guide.length
          ? `<label class="switch"><input type="checkbox" data-f="guided" checked><span class="track"></span>
               <span class="switch-text"><b>Guide visitors step by step</b><small>Each explanation shows beside the highlight, with Back and Next. Turn off to let visitors explore freely and read explanations on hover.</small></span></label>
             <ol class="guide">${data.guide.map((g, i) => `<li><span class="n">${i + 1}</span><div><em>${g.label ? "Click “" + esc(g.label) + "”" : "Recorded click"}</em>
               <input data-guide="${i}" maxlength="240" placeholder="Explain this step, e.g. See every teacher in the class."></div></li>`).join("")}</ol>`
          : `<small>No clicks were recorded, so visitors see the page without a walkthrough.</small>`}</div>
      <div class="field"><span>Highlight colour</span>
        <div class="swatches">${SWATCHES.map((c, i) => `<button type="button" class="sw" data-color="${c}" style="--c:${c}" aria-label="${c}" aria-pressed="${i === 0}"></button>`).join("")}
          <label class="sw sw--custom" title="Custom colour"><input type="color" data-f="custom" value="${SWATCHES[0]}"><span>Custom</span></label></div></div>
      <div class="note">This page becomes public on the product tour. Make sure it shows demo data only.</div>`;
    let accent = SWATCHES[0];
    const pickColor = (c) => {
      accent = c;
      bodyEl.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.color === c ? "true" : "false"));
    };
    bodyEl.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => pickColor(b.dataset.color)));
    bodyEl.querySelector('[data-f="custom"]').addEventListener("input", (e) => pickColor(e.target.value));
    const featureSel = bodyEl.querySelector('[data-f="feature"]');
    const screenSel = bodyEl.querySelector('[data-f="screen"]');
    let addMode = "new";
    if (last.feature && features.some((f) => String(f.id) === String(last.feature))) featureSel.value = String(last.feature);
    const fillSteps = () => {
      const f = features.find((x) => String(x.id) === featureSel.value);
      const steps = f ? f.steps : [];
      screenSel.innerHTML = steps.length ? steps.map((s, i) => `<option value="${s.id}">${i + 1}. ${esc(s.label)}</option>`).join("") : '<option value="">No steps yet</option>';
      const versionBtn = bodyEl.querySelector('[data-mode="version"]');
      versionBtn.disabled = !steps.length;
      if (!steps.length && addMode === "version") setMode("new");
    };
    const setMode = (m) => {
      addMode = m;
      bodyEl.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m ? "true" : "false"));
      bodyEl.querySelectorAll("[data-show]").forEach((n) => { n.hidden = n.dataset.show !== m; });
    };
    bodyEl.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    featureSel.addEventListener("change", fillSteps);
    fillSteps();
    saveBtn.disabled = false;

    saveBtn.addEventListener("click", () => {
      const fd = new FormData();
      fd.append("feature_id", featureSel.value);
      if (addMode === "version" && screenSel.value) fd.append("screen_id", screenSel.value);
      fd.append("step_label", bodyEl.querySelector('[data-f="step"]').value);
      fd.append("version_label", bodyEl.querySelector('[data-f="version"]').value);
      fd.append("accent", accent);
      const guidedBox = bodyEl.querySelector('[data-f="guided"]');
      fd.append("guided", guidedBox && !guidedBox.checked ? "0" : "1");
      fd.append("guide", JSON.stringify([...bodyEl.querySelectorAll("[data-guide]")].map((i) => i.value)));
      fd.append("capture", new Blob([JSON.stringify(data)], { type: "application/json" }), "capture.json");
      try { localStorage.setItem("mcap:last", JSON.stringify({ feature: featureSel.value })); } catch (_) { /* ignore */ }

      saveBtn.disabled = true;
      modal.querySelector('[data-act="discard"]').disabled = true;
      statusEl.textContent = "Uploading…";
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/app-demo-capture/save");
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.round((e.loaded / e.total) * 100);
        statusEl.textContent = p < 100 ? "Uploading " + p + "%" : "Creating the cover image…";
      };
      xhr.onload = () => {
        let json = {};
        try { json = JSON.parse(xhr.responseText); } catch (_) { json = { message: "Unexpected response from the server." }; }
        if (xhr.status >= 400 || !json.success) {
          statusEl.textContent = "";
          saveBtn.disabled = false;
          modal.querySelector('[data-act="discard"]').disabled = false;
          toast(json.message || "Could not save the capture.", true);
          return;
        }
        modal.innerHTML = `<div class="done"><div class="ok">${ICON.check}</div><h2>Saved to the tour</h2>
          <p>It is live now. Captures can be renamed, reordered or removed in Admin → App Demo.</p></div>
          <div class="links"><a class="ghost" href="/legal/app-demo#feature-${json.featureId}" target="_blank" rel="noopener">View on the tour</a>
          <a class="primary" href="#" data-act="close">Done</a></div>`;
        // Recording leaves menus and panels open: start again from a clean page.
        modal.querySelector('[data-act="close"]').addEventListener("click", (e) => { e.preventDefault(); location.reload(); });
      };
      xhr.onerror = () => {
        statusEl.textContent = "";
        saveBtn.disabled = false;
        modal.querySelector('[data-act="discard"]').disabled = false;
        toast("Network error. Check your connection and try again.", true);
      };
      xhr.send(fd);
    });
  }

  function closeDialog() {
    layer.innerHTML = "";
    mode = "idle";
    renderBar();
  }
})();
