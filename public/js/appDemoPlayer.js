// Interactive capture player (/legal/app-demo/play/:id), shown inside the
// product tour viewer. A capture is a set of page states plus the recorded
// clicks between them (see public/js/demoCapture.js). The page is drawn in an
// iframe sandboxed without scripts; this script swaps states when a visitor
// clicks a recorded element.
//
// Guided (the admin's choice, on by default): visitors are walked through the
// recorded clicks with an explanation, Back and Next. Explore mode keeps every
// recorded click available in any order, without drawing highlights over the page.
//
// Expanders and menus that were not recorded still work: <details> natively, and
// [aria-expanded] toggles with their panel here; menus close on a click outside.
// Pages can declare small effects for the preview: data-demo-hide="<selector>" on a
// checkbox hides the matches while unchecked, data-demo-reset="<selector>" checks
// every such box inside the match again.
//
// Light / dark: captures that carry their appearance hold the page's own colors.
// The page's own switch (Dark mode in the header menu, or the settings picker)
// changes the look, as in the app; the app's appearance script
// (public/js/appearance.js, loaded by this page) colors the captured page.
(function () {
  "use strict";

  const root = document.getElementById("pl");
  const frame = root.querySelector(".pl__frame");
  const layer = root.querySelector(".pl__layer");
  const toastEl = root.querySelector(".pl__toast");
  const W = Number(root.dataset.w) || 1440;
  const OUTSIDE = "0"; // a recorded click on empty space (see public/js/demoCapture.js)
  const config = JSON.parse(document.getElementById("pl-config").textContent || "{}");
  root.style.setProperty("--accent", config.accent || "#14b8a6");

  let data = null;
  let steps = []; // every recorded click, in order (their explanations)
  let guided = false; // the capture has a guided walkthrough
  let skipped = false; // the visitor closed it
  // Visitor display choices, remembered between visits: the ring (indicator) and
  // the explanation turn off independently; with both off the page is clicked freely.
  const pref = (k) => { try { return localStorage.getItem("mcap:" + k) !== "0"; } catch (_) { return true; } };
  const savePref = (k, v) => { try { localStorage.setItem("mcap:" + k, v ? "1" : "0"); } catch (_) { /* ignore */ } };
  let rings = pref("rings");
  let tips = pref("tips");
  let guide = []; // the same steps when the walkthrough is guided, otherwise empty
  let current = -1;
  let step = -1; // index into guide; guide.length = finished
  let hot = new Map(); // data-mcap-el -> target state, for the current state
  let scale = 1;
  let avoid = []; // floating panels on the current step (open menus, popovers) the tooltip must not cover

  // ---------- Size: the capture keeps its original width and is scaled to fit ----------

  function fit() {
    scale = root.clientWidth / W;
    frame.style.width = W + "px";
    frame.style.height = Math.ceil(root.clientHeight / scale) + "px";
    frame.style.transform = "scale(" + scale + ")";
    place();
  }
  window.addEventListener("resize", fit);

  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2200);
  }

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- States ----------

  const attrString = (attrs) => Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
  const stateHtml = (i) => {
    const st = data.states[i];
    return `<!DOCTYPE html><html${attrString(htmlAttrsOf(st))}><head>${data.heads[st.head]}</head><body${attrString(st.bodyAttrs)}>${st.body}</body></html>`;
  };

  // ---------- Light / dark ----------

  let look = (() => { try { return localStorage.getItem("mcap:look"); } catch (_) { return null; } })(); // the visitor's pick
  if (look) root.classList.add("is-settled"); // the cover shows the recorded look, which may not be the one picked
  const canLook = () => Boolean(data && data.appearance);
  // Three looks, as in the app: Light (white), Classic (brownish gray), Dark.
  const LOOKS = ["light", "classic", "dark"];
  const asLook = (v) => (LOOKS.includes(v) ? v : "light");
  const recordedLook = () => ({ dark: "dark", gray: "classic" })[data.appearance.mode] || "light";
  const currentLook = () => (LOOKS.includes(look) ? look : recordedLook());
  // The data-appearance the captured page is drawn with (null: as it was saved).
  const lookMode = () => (canLook() ? { light: "white", classic: "gray", dark: "dark" }[currentLook()] : null);
  const htmlAttrsOf = (st) => (lookMode() ? Object.assign({}, st.htmlAttrs, { "data-appearance": lookMode() }) : st.htmlAttrs);

  function applyLook(d) {
    const mode = lookMode();
    if (!mode || !d || !d.documentElement || d.__mcapLook === mode) return;
    d.__mcapLook = mode;
    d.documentElement.setAttribute("data-appearance", mode);
    if (typeof window.__apRun === "function") {
      try { window.__apRun(d.defaultView, d); } catch (_) { /* the page keeps its own colors */ }
    }
  }
  // Content shown without a class or style change (expanders) gets its colors too.
  function refreshLook(d) {
    try { if (d && d.defaultView && typeof d.defaultView.__apRefresh === "function") d.defaultView.__apRefresh(); } catch (_) { /* ignore */ }
  }
  function setLook(next, then) {
    const changes = asLook(next) !== currentLook();
    look = asLook(next);
    try { localStorage.setItem("mcap:look", next); } catch (_) { /* ignore */ }
    if (!changes) { if (then) then(); return; }
    root.classList.add("is-settled"); // the cover shows the recorded look only
    // Every look in place, as the app does: open menus and panels stay as they are.
    const d = frame.contentDocument;
    const mode = lookMode();
    const win = d && d.defaultView;
    if (d && d.__mcapLook && mode && win && typeof win.__apSetMode === "function") {
      try {
        win.__apSetMode(mode); // panes inside the page follow it
        d.__mcapLook = mode;
        d.querySelectorAll("iframe").forEach((f) => { try { if (f.contentDocument) f.contentDocument.__mcapLook = mode; } catch (_) { /* ignore */ } });
        syncLookControls(d);
        place();
        if (then) then();
        return;
      } catch (_) { /* draw again below */ }
    }
    render(current, () => { place(); if (then) then(); }, true);
  }
  // The page's own appearance controls (the header menu's three stops, the settings
  // picker) show the look in use. Older captures have a two-way Dark mode switch.
  function syncLookControls(d) {
    if (!canLook() || !d) return;
    const lk = currentLook();
    d.querySelectorAll("[data-ap-set]").forEach((b) => {
      if (b.getAttribute("role") === "switch") {
        b.setAttribute("aria-checked", String(lk === "dark"));
        b.setAttribute("data-ap-set", lk === "dark" ? "light" : "dark");
      } else {
        b.setAttribute("aria-checked", String(b.getAttribute("data-ap-set") === lk));
      }
    });
    d.querySelectorAll('[data-ap-picker] input[name="appearanceMode"]').forEach((i) => { i.checked = i.value === lk; });
  }
  // The look a click on one of those controls asks for.
  function lookWanted(control) {
    const input = control.querySelector('input[name="appearanceMode"]');
    if (input) return asLook(input.value);
    if (control.getAttribute("role") === "switch") return currentLook() === "dark" ? "light" : "dark";
    return asLook(control.getAttribute("data-ap-set"));
  }

  function setAttrs(el, attrs) {
    Array.from(el.attributes).forEach((a) => { if (!(a.name in attrs)) el.removeAttribute(a.name); });
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  }

  // Fades the cover once the live page has its images, or as soon as anything changes.
  function settle() { root.classList.add("is-settled"); }

  // Draws state i. The first draw opens at the top of the page; later ones keep the scroll.
  // fresh: draw again from scratch where the visitor is (after a light / dark switch).
  function render(i, done, fresh) {
    const prev = current;
    if (prev >= 0) settle();
    current = i;
    hot = new Map(data.links.filter((l) => l.from === i).map((l) => [l.el, l.to]));
    const st = data.states[i];
    const doc = frame.contentDocument;
    const scrollOf = (dd) => dd.scrollingElement || dd.documentElement;
    if (!fresh && prev >= 0 && doc && doc.body && data.states[prev].head === st.head) {
      const scrollEl = scrollOf(doc);
      const y = scrollEl.scrollTop;
      const parsed = new DOMParser().parseFromString(stateHtml(i), "text/html");
      const attrs = Object.assign({}, htmlAttrsOf(st));
      if (doc.__mcapLook && doc.__mcapLook !== "white") {
        // Keep what the appearance script set on the page root.
        attrs.class = ((attrs.class || "") + " ap-ready").trim();
        if (doc.documentElement.hasAttribute("style")) attrs.style = doc.documentElement.getAttribute("style");
      }
      setAttrs(doc.documentElement, attrs);
      doc.documentElement.replaceChild(doc.importNode(parsed.body, true), doc.body);
      scrollEl.scrollTop = y;
      wire(doc, done);
      return;
    }
    const keepY = fresh && doc && doc.documentElement ? scrollOf(doc).scrollTop : 0;
    // Written straight into the frame: the page shows as soon as it is parsed,
    // without waiting for its images, fonts and panes (a load event can take long).
    const d = frame.contentDocument;
    d.open();
    d.write(stateHtml(i));
    d.close();
    d.__mcapWired = false; // document.open() drops the listeners
    d.__mcapLook = null;
    applyLook(d);
    if (d.defaultView) d.defaultView.addEventListener("load", () => { settle(); schedulePlace(); }, { once: true }); // late images move things
    setTimeout(settle, 1200);
    wire(d, () => {
      scrollOf(d).scrollTop = keepY;
      root.classList.add("is-ready");
      if (done) done();
    });
  }

  // Readies a document of the current state and calls done right away; embedded
  // panes are readied as they load, and the overlay follows them.
  function wire(doc, done) {
    const visit = (d) => {
      if (!d || !d.documentElement) return;
      syncLookControls(d);
      d.querySelectorAll("[data-mcap-scroll]").forEach((n) => {
        if (n === d.documentElement) return;
        const [top, left] = n.getAttribute("data-mcap-scroll").split(",").map(Number);
        n.scrollTop = top || 0;
        n.scrollLeft = left || 0;
      });
      if (!d.__mcapWired) {
        d.__mcapWired = true;
        d.addEventListener("click", onClick, true);
        d.addEventListener("change", onChange, true);
        d.addEventListener("submit", (e) => e.preventDefault(), true);
        d.addEventListener("scroll", schedulePlace, true);
        d.addEventListener("mouseover", onHover, true);
        // Esc closes the walkthrough from inside the page too (other keys stay with its fields).
        d.addEventListener("keydown", (e) => { if (e.key === "Escape" && guide.length) { e.preventDefault(); skip(); } }, true);
      }
      d.querySelectorAll("iframe").forEach((f) => {
        const ready = () => { try { applyLook(f.contentDocument); visit(f.contentDocument); } catch (_) { /* ignore */ } schedulePlace(); };
        f.addEventListener("load", ready, { once: true });
        try { if (f.contentDocument && f.contentDocument.readyState === "complete" && f.contentDocument.body && f.contentDocument.body.childElementCount) ready(); } catch (_) { /* ignore */ }
      });
    };
    visit(doc);
    if (done) done();
    place();
  }

  function findEl(id, doc) {
    doc = doc || frame.contentDocument;
    if (!doc) return null;
    const el = doc.querySelector('[data-mcap-el="' + id + '"]');
    if (el) return el;
    for (const f of doc.querySelectorAll("iframe")) {
      try { const hit = findEl(id, f.contentDocument); if (hit) return hit; } catch (_) { /* ignore */ }
    }
    return null;
  }

  // Element box in player coordinates (through embedded panes and the scale).
  function boxOf(el) {
    const r = el.getBoundingClientRect();
    let x = r.left;
    let y = r.top;
    let win = el.ownerDocument.defaultView;
    while (win && win !== frame.contentWindow && win.frameElement) {
      const fe = win.frameElement;
      const fr = fe.getBoundingClientRect();
      x += fr.left + fe.clientLeft;
      y += fr.top + fe.clientTop;
      win = win.parent;
    }
    return { x: x * scale, y: y * scale, w: r.width * scale, h: r.height * scale };
  }

  function isVisible(box) {
    return box.w > 0 && box.h > 0 && box.y + box.h > 0 && box.y < root.clientHeight && box.x + box.w > 0 && box.x < root.clientWidth;
  }

  // ---------- Guided walkthrough ----------

  function goStep(k) {
    step = k;
    if (k >= guide.length) {
      const end = guide.length ? guide[guide.length - 1].to : current;
      if (current !== end) render(end, place); else place();
      return;
    }
    const g = guide[k];
    const show = () => {
      const el = findEl(g.el);
      avoid = floatingPanels(el);
      if (el) {
        const box = boxOf(el);
        if (!isVisible(box) || box.y < 40 || box.y + box.h > root.clientHeight - 140) {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        }
      }
      place();
    };
    if (current !== g.from) render(g.from, show); else show();
  }

  function next() {
    if (step < 0 || step >= guide.length) return;
    const g = guide[step];
    const go = () => render(g.to, () => goStep(step + 1));
    const t = lookTarget(g);
    if (t) setLook(t, go); else go(); // a "Dark mode" step switches the look too
  }

  function back() {
    if (step <= 0) return;
    const k = step - 1;
    if (hasLookSteps()) setLook(lookBefore(k), () => goStep(k)); else goStep(k);
  }

  // ---------- Walkthrough steps on the page's own light / dark switch ----------

  const lookTargets = new Map(); // guide step -> the look it switches to (light / classic / dark), or null
  function lookTarget(g) {
    if (!g || !canLook()) return null;
    if (lookTargets.has(g)) return lookTargets.get(g);
    let t = null;
    // Read straight from the markup (no parsing): the recorded tag is the switch itself
    // (data-ap-set names the look it turns on) or a picker choice holding its radio.
    const body = data.states[g.from].body;
    const at = body.indexOf('data-mcap-el="' + g.el + '"');
    if (at >= 0) {
      const tag = body.slice(body.lastIndexOf("<", at), body.indexOf(">", at) + 1);
      const set = tag.match(/data-ap-set="(\w+)"/);
      const choice = !set && /class="[^"]*\bap-choice\b/.test(tag) && body.slice(at, at + 800).match(/<input[^>]*name="appearanceMode"[^>]*>/);
      const value = choice && choice[0].match(/value="(\w+)"/);
      if (set) t = asLook(set[1]);
      else if (value) t = asLook(value[1]);
    }
    lookTargets.set(g, t);
    return t;
  }
  const hasLookSteps = () => guide.some((g) => lookTarget(g));
  // The look before step k: as recorded, then as each earlier switch step left it.
  function lookBefore(k) {
    let m = recordedLook();
    for (let i = 0; i < k && i < guide.length; i++) m = lookTarget(guide[i]) || m;
    return m;
  }

  // Open menus, dropdowns and popovers: positioned boxes floating over the page.
  function floatingPanels(target) {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return [];
    const win = doc.defaultView;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const out = [];
    for (const n of doc.body.querySelectorAll("*")) {
      if (target && (n.contains(target) || target.contains(n))) continue;
      const cs = win.getComputedStyle(n);
      if ((cs.position !== "absolute" && cs.position !== "fixed") || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 120 || r.height < 80 || r.width * r.height > vw * vh * 0.5) continue;
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      out.push({ x: r.left * scale, y: r.top * scale, w: r.width * scale, h: r.height * scale });
    }
    return out;
  }

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- Overlay: walkthrough tips ----------

  let placeQueued = false;
  function schedulePlace() {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; place(); });
  }

  function place() {
    if (!data || !root.classList.contains("is-ready")) { layer.innerHTML = ""; return; }
    let html = "";
    if (guide.length) {
      if (step >= guide.length) {
        html = `<div class="pl-end" role="status"><button type="button" class="pl-tip__close" data-pl="skip" aria-label="Close" title="Close (Esc)">×</button><strong>That’s the walkthrough</strong><span>Explore the page, or watch it again.</span>
          <div class="pl-btns"><button type="button" class="pl-btn" data-pl="back">Back</button><button type="button" class="pl-btn pl-btn--primary" data-pl="restart">Restart</button></div></div>`;
      } else if (step >= 0) {
        const g = guide[step];
        const el = findEl(g.el);
        const box = el ? boxOf(el) : null;
        const text = explanation(g.el) || "Select this control to continue.";
        const tip = `<div class="pl-tip" role="dialog" aria-live="polite" aria-label="Step ${step + 1} of ${guide.length}">
          <button type="button" class="pl-tip__close" data-pl="skip" aria-label="Skip walkthrough" title="Skip walkthrough (Esc)">×</button>
          <p>${esc(text)}</p>
          <div class="pl-tip__foot"><span>${step + 1} of ${guide.length}</span>
            <div class="pl-btns"><button type="button" class="pl-btn" data-pl="back"${step === 0 ? " disabled" : ""}>Back</button>
            <button type="button" class="pl-btn pl-btn--primary" data-pl="next">${step === guide.length - 1 ? "Finish" : "Next"}</button></div></div>
          <i class="pl-tip__arrow"></i></div>`;
        const hasBox = box && box.w && box.h;
        if (hasBox && rings) html = `<div class="pl-ring" style="left:${box.x - 5}px;top:${box.y - 5}px;width:${box.w + 10}px;height:${box.h + 10}px"></div>`;
        if (tips) html += tip;
        layer.innerHTML = html;
        const tipEl = layer.querySelector(".pl-tip");
        if (tipEl) { if (hasBox) positionTip(tipEl, box, menuBoxOf(el)); else tipEl.classList.add("pl-tip--free"); }
        return;
      }
    } else {
      if (rings) new Set(data.links.map((l) => l.el)).forEach((id) => {
        if (linkFor(id) === current) return;
        const el = findEl(id);
        const box = el && boxOf(el);
        if (box && isVisible(box)) html += `<div class="pl-ring pl-ring--soft" style="left:${box.x - 4}px;top:${box.y - 4}px;width:${box.w + 8}px;height:${box.h + 8}px"></div>`;
      });
      // Explore mode: the explanation of the recorded element under the pointer.
      const text = tips && hovered && explanation(hovered);
      const el = hovered && findEl(hovered);
      const box = el && boxOf(el);
      if (text && box && isVisible(box)) {
        layer.innerHTML = html + `<div class="pl-tip pl-tip--hover" role="tooltip"><p>${esc(text)}</p><i class="pl-tip__arrow"></i></div>`;
        positionTip(layer.querySelector(".pl-tip"), box);
        return;
      }
    }
    layer.innerHTML = html;
  }

  const cleanLabel = (v) => String(v || "").replace(/(\s*([›»→⌄▾▸▼•·|×]|\d+\+?))+$/u, "").trim();

  // The admin's explanation for a recorded element in the current state, or a short default.
  function explanation(id) {
    const i = steps.findIndex((g) => g.el === id && g.from === current);
    const k = i >= 0 ? i : steps.findIndex((g) => g.el === id);
    if (k < 0) return "";
    if (id === OUTSIDE) return (config.texts && config.texts[k]) || "Click anywhere outside to close it.";
    const label = cleanLabel(steps[k].label);
    return (config.texts && config.texts[k]) || (label ? "Click “" + label + "”." : "");
  }

  let hovered = null;
  function onHover(e) {
    settle();
    if (guide.length) return;
    let id = null;
    for (let n = e.target; n && n.nodeType === 1; n = n.parentElement) {
      const v = n.getAttribute("data-mcap-el");
      if (v && linkFor(v) !== null && linkFor(v) !== current) { id = v; break; }
    }
    if (id !== hovered) { hovered = id; schedulePlace(); }
  }

  // Header and corner controls (menus, profile, notifications) get the tooltip
  // beside them, so what opens below stays visible. Everything else: below the
  // element if it fits, otherwise above. Always kept inside the player.
  // The open menu or panel a control sits in (positioned over the page), if any.
  function menuBoxOf(el) {
    if (!el) return null;
    const win = el.ownerDocument.defaultView;
    for (let n = el.parentElement; n && n !== el.ownerDocument.body; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      if (cs.position !== "absolute" && cs.position !== "fixed") continue;
      const r = n.getBoundingClientRect();
      if (r.width >= 100 && r.height >= 28) return boxOf(n);
    }
    return null;
  }

  // A control inside an open menu gets its tooltip beside the menu, so the
  // menu's other options stay visible and clickable.
  function positionTip(tip, box, menu) {
    if (menu && placeBeside(tip, box, menu)) return;
    const pad = 10;
    const gap = 14;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const rw = root.clientWidth;
    const rh = root.clientHeight;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const arrow = tip.querySelector(".pl-tip__arrow");
    const clampY = (y) => Math.max(pad, Math.min(y, rh - th - pad));
    tip.classList.remove("is-above", "is-left", "is-right");
    arrow.style.left = arrow.style.top = "";

    const nearTop = box.y + box.h < rh * 0.2;
    if (nearTop && cx > rw * 0.55 && box.x - gap - tw >= pad) {
      const top = clampY(cy - 22);
      // Stay left of any panel that opened beside the element.
      let left = box.x - gap - tw;
      avoid.forEach((a) => { if (overlaps({ x: left, y: top, w: tw, h: th }, a) && a.x - gap - tw >= pad) left = Math.min(left, a.x - gap - tw); });
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.classList.add("is-left");
      arrow.style.top = Math.max(14, Math.min(cy - top, th - 14)) + "px";
      return;
    }
    if (nearTop && cx < rw * 0.45 && box.x + box.w + gap + tw <= rw - pad) {
      const top = clampY(cy - 22);
      tip.style.left = box.x + box.w + gap + "px";
      tip.style.top = top + "px";
      tip.classList.add("is-right");
      arrow.style.top = Math.max(14, Math.min(cy - top, th - 14)) + "px";
      return;
    }
    let top = box.y + box.h + gap;
    let below = true;
    const left = Math.max(pad, Math.min(cx - tw / 2, rw - tw - pad));
    const covers = (t) => avoid.some((a) => overlaps({ x: left, y: t, w: tw, h: th }, a));
    if ((top + th > rh - pad || covers(top)) && box.y - th - gap >= pad && !covers(box.y - th - gap)) { top = box.y - th - gap; below = false; }
    top = clampY(top);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tip.classList.toggle("is-above", !below);
    arrow.style.left = Math.max(16, Math.min(cx - left, tw - 16)) + "px";
  }

  function placeBeside(tip, box, menu) {
    const pad = 10;
    const gap = 14;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const cy = box.y + box.h / 2;
    let left;
    let side;
    if (menu.x - gap - tw >= pad) { left = menu.x - gap - tw; side = "is-left"; }
    else if (menu.x + menu.w + gap + tw <= root.clientWidth - pad) { left = menu.x + menu.w + gap; side = "is-right"; }
    else return false;
    const top = Math.max(pad, Math.min(cy - 22, root.clientHeight - th - pad));
    const arrow = tip.querySelector(".pl-tip__arrow");
    tip.classList.remove("is-above", "is-left", "is-right");
    tip.classList.add(side);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    arrow.style.left = "";
    arrow.style.top = Math.max(14, Math.min(cy - top, th - 14)) + "px";
    return true;
  }

  layer.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pl]");
    if (!btn) return;
    const act = btn.dataset.pl;
    if (act === "next") next();
    else if (act === "back") back();
    else if (act === "restart") restart();
    else if (act === "skip") skip();
  });

  // ---------- Skip: hide the walkthrough ----------

  function skip() {
    settle();
    if (!guide.length) return;
    skipped = true;
    guide = [];
    step = -1;
    hovered = null;
    place();
    renderControls();
  }

  function resume() {
    skipped = false;
    guide = steps;
    renderControls();
    const k = guide.findIndex((g) => g.from === current);
    if (k >= 0) goStep(k); else restart();
  }

  // ---------- Controls: a small floating bar, shown briefly, then folded to a button ----------

  const controls = root.querySelector(".pl__controls");
  const ICON_OPTS = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h7M15 6h1M4 14h1M9 14h7"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="14" r="2"/></svg>';
  let controlsShown = false;
  let foldTimer = null;

  function renderControls() {
    const links = data && data.links.length;
    if (!links) { controls.hidden = true; return; }
    const open = !controls.classList.contains("is-folded");
    controls.innerHTML = '<button type="button" class="pl__handle" data-c="open" aria-expanded="' + open + '" aria-label="Preview options" title="Preview options · drag to move">' + ICON_OPTS + '</button>'
      + '<div class="pl__opts" role="group" aria-label="Preview options"><span class="pl__grip" aria-hidden="true" title="Drag to move"></span>'
      + (guided && skipped ? '<button type="button" class="is-primary" data-c="guide">Show guide</button>' : "")
      + (links ? '<button type="button" data-c="rings" aria-pressed="' + rings + '" title="Show or hide the ring around what to click"><i></i>Indicator</button>'
        + '<button type="button" data-c="tips" aria-pressed="' + tips + '" title="Show or hide the explanations"><i></i>Explanation</button>'
        + '<button type="button" data-c="reset" title="Start the preview again">Restart</button>' : "")
      + "</div>";
    controls.hidden = false;
    if (!controlsShown) { controlsShown = true; unfold(2000); }
    keepInside();
  }

  function fold() {
    if (controls.matches(":hover") || controls.querySelector(":focus-visible") || drag) return;
    controls.classList.add("is-folded");
    const h = controls.querySelector(".pl__handle");
    if (h) h.setAttribute("aria-expanded", "false");
  }
  function unfold(ms) {
    controls.classList.remove("is-folded");
    const h = controls.querySelector(".pl__handle");
    if (h) h.setAttribute("aria-expanded", "true");
    keepInside();
    clearTimeout(foldTimer);
    foldTimer = setTimeout(fold, ms || 1800);
  }
  controls.addEventListener("mouseenter", () => clearTimeout(foldTimer));
  controls.addEventListener("mouseleave", () => { if (!controls.classList.contains("is-folded")) { clearTimeout(foldTimer); foldTimer = setTimeout(fold, 1400); } });
  controls.addEventListener("focusout", () => { clearTimeout(foldTimer); foldTimer = setTimeout(fold, 1800); });

  controls.addEventListener("click", (e) => {
    if (dragged) { dragged = false; e.preventDefault(); e.stopPropagation(); return; }
    const btn = e.target.closest("[data-c]");
    if (!btn) return;
    const c = btn.dataset.c;
    if (c === "open") { unfold(2600); const first = controls.querySelector(".pl__opts button"); if (first && e.detail === 0) first.focus(); return; }
    if (c === "guide") resume();
    else if (c === "reset") restart();
    else if (c === "rings") { rings = !rings; savePref("rings", rings); place(); renderControls(); }
    else if (c === "tips") { tips = !tips; savePref("tips", tips); hovered = null; place(); renderControls(); }
    clearTimeout(foldTimer);
  });

  // Drag anywhere on the bar (a short press still clicks); the spot is remembered.
  let drag = null;
  let dragged = false;
  let spot = (() => { try { return JSON.parse(localStorage.getItem("mcap:spot") || "null"); } catch (_) { return null; } })();

  function keepInside() {
    if (!spot || controls.hidden) return;
    const pad = 8;
    const x = Math.max(pad, Math.min(spot.x * root.clientWidth, root.clientWidth - controls.offsetWidth - pad));
    const y = Math.max(pad, Math.min(spot.y * root.clientHeight, root.clientHeight - controls.offsetHeight - pad));
    controls.classList.add("is-placed");
    controls.style.left = x + "px";
    controls.style.top = y + "px";
  }
  window.addEventListener("resize", keepInside);

  controls.addEventListener("pointerdown", (e) => {
    dragged = false;
    if (e.button !== 0) return;
    const r = controls.getBoundingClientRect();
    const pr = root.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, pr, moving: false };
    root.classList.add("is-pressing"); // the page frame would otherwise take the pointer
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 5) return;
      drag.moving = true;
      controls.classList.add("is-dragging");
      clearTimeout(foldTimer);
    }
    const pad = 8;
    const x = Math.max(pad, Math.min(e.clientX - drag.pr.left - drag.dx, root.clientWidth - controls.offsetWidth - pad));
    const y = Math.max(pad, Math.min(e.clientY - drag.pr.top - drag.dy, root.clientHeight - controls.offsetHeight - pad));
    spot = { x: x / root.clientWidth, y: y / root.clientHeight };
    controls.classList.add("is-placed");
    controls.style.left = x + "px";
    controls.style.top = y + "px";
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moving) {
      dragged = true; // swallow the click that ends the drag
      controls.classList.remove("is-dragging");
      try { localStorage.setItem("mcap:spot", JSON.stringify(spot)); } catch (_) { /* ignore */ }
    }
    drag = null;
    root.classList.remove("is-pressing");
    if (!controls.matches(":hover")) { clearTimeout(foldTimer); foldTimer = setTimeout(fold, 1400); }
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  function restart() {
    const go = () => render(guide.length ? guide[0].from : 0, () => {
      (frame.contentDocument.scrollingElement || frame.contentDocument.documentElement).scrollTop = 0;
      if (guide.length) goStep(0); else place();
    });
    if (hasLookSteps()) setLook(lookBefore(0), go); else go();
  }

  // ---------- Clicks inside the page ----------

  // Where clicking a recorded element leads, in any order: the click recorded
  // from this view if there is one, otherwise the same element's click from
  // another view (the one that changes the page).
  // Captures saved before views were cross-marked: recognise an unmarked element
  // by what it is (tag, id, classes without state words, label).
  function sameElementKey(el) {
    if (el.id) return el.tagName + "#" + el.id;
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter((c) => c && !/^(is-|has-)|^(open|opened|active|show|shown|expanded|collapsed|selected|current|hidden)$/.test(c)).sort().join(".");
    // Controls without text (checkboxes, icon buttons) are told apart by what they are for.
    const what = Array.from(el.attributes).filter((a) => /^(name|type|value|href|for|role|aria-label|title)$|^data-(?!mcap-)/.test(a.name)).map((a) => a.name + "=" + a.value).sort().join("&");
    return el.tagName + "." + cls + "|" + what + "|" + (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  let recordedKeys = null; // element key -> recorded element id
  function recordedIdOf(el) {
    if (!recordedKeys) {
      recordedKeys = new Map();
      const ids = new Set(data.links.map((l) => l.el));
      data.states.forEach((st) => {
        if (![...ids].some((id) => st.body.includes('data-mcap-el="' + id + '"'))) return;
        const doc = new DOMParser().parseFromString("<!DOCTYPE html><html><body>" + st.body + "</body></html>", "text/html");
        doc.querySelectorAll("[data-mcap-el]").forEach((n) => {
          const key = sameElementKey(n);
          if (!recordedKeys.has(key)) recordedKeys.set(key, n.getAttribute("data-mcap-el"));
        });
      });
    }
    return el ? recordedKeys.get(sameElementKey(el)) || null : null;
  }

  function linkFor(id) {
    if (!id || !data) return null;
    if (hot.has(id)) return hot.get(id);
    const all = data.links.filter((l) => l.el === id);
    if (!all.length) return null;
    return (all.find((l) => l.to !== current) || all[0]).to;
  }

  function onClick(e) {
    const start = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    // The page's own light / dark switch changes the look of the whole preview.
    const apControl = canLook() && start && start.closest("[data-ap-set], [data-ap-picker] .ap-choice");
    if (apControl) {
      e.preventDefault();
      e.stopPropagation();
      const want = lookWanted(apControl);
      const id = apControl.getAttribute("data-mcap-el") || recordedIdOf(apControl);
      const g = guide[step];
      hovered = null;
      if (g && g.from === current && id && g.el === id) { next(); return; } // the walkthrough's switch step
      setLook(want, () => { syncLookControls(frame.contentDocument); place(); });
      return;
    }
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const id = n.getAttribute("data-mcap-el") || (n.tagName !== "BODY" && n.tagName !== "HTML" ? recordedIdOf(n) : null);
      const to = linkFor(id);
      if (to === null || to === current) continue;
      e.preventDefault();
      e.stopPropagation();
      follow(id, to);
      return;
    }
    if (!start) return;
    const control = start.closest(CONTROLS);
    // A recorded click on empty space (closing a menu): any click outside the controls.
    if (!control && hot.has(OUTSIDE)) {
      e.preventDefault();
      follow(OUTSIDE, hot.get(OUTSIDE));
      return;
    }
    if (closeOutside(start)) { refreshLook(start.ownerDocument); schedulePlace(); }
    const reset = start.closest("[data-demo-reset]");
    if (reset) {
      e.preventDefault();
      resetBoxes(reset);
      return;
    }
    const toggle = start.closest("[aria-expanded]");
    if (toggle && setOpen(toggle, toggle.getAttribute("aria-expanded") !== "true")) {
      e.preventDefault();
      refreshLook(start.ownerDocument);
      schedulePlace();
      return;
    }
    if (start.closest("summary")) { setTimeout(() => { refreshLook(start.ownerDocument); schedulePlace(); }, 0); return; } // works without scripts
    if (start.closest("input, select, textarea, label")) return;
    if (start.closest("a[href]")) {
      e.preventDefault();
      toast("This link opens another page in the full app.");
      return;
    }
    if (start.closest("button, [role='button'], [role='tab'], [role='menuitem'], [onclick]")) {
      e.preventDefault();
      toast(guide.length ? "Not part of this preview. Follow the walkthrough, or press × to explore."
        : hot.size ? "Not part of this preview." : "This preview shows the page as it looks.");
    }
  }

  // Follows a recorded click, and picks up the walkthrough where it fits.
  function follow(id, to) {
    const g = guide[step];
    if (g && g.el === id && g.from === current) { next(); return; }
    hovered = null;
    render(to, () => {
      const k = guide.findIndex((x) => x.from === to);
      // The look stays as the visitor has it: only the page's own switch (and Back over
      // that step, or Restart) changes light / dark.
      if (guide.length && k >= 0) goStep(k); else { step = guide.length ? guide.length : -1; place(); }
    });
  }

  // ---------- Expanders, menus and demo effects (no scripts run in the page) ----------

  const CONTROLS = "a[href], button, summary, input, select, textarea, label, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='checkbox'], [role='switch'], [aria-expanded], [onclick]";
  const isShown = (el) => !el.hidden && el.ownerDocument.defaultView.getComputedStyle(el).display !== "none";
  const isPopup = (el) => /^(absolute|fixed)$/.test(el.ownerDocument.defaultView.getComputedStyle(el).position);

  // The panel an [aria-expanded] control opens: the one it names, or the element right after it.
  function panelOf(btn) {
    const doc = btn.ownerDocument;
    const ref = (btn.getAttribute("aria-controls") || "").split(/\s+/)[0]
      || btn.getAttribute("data-bs-target") || btn.getAttribute("data-target")
      || (/^#[\w-]+$/.test(btn.getAttribute("href") || "") ? btn.getAttribute("href") : "");
    let panel = null;
    try { panel = ref ? (ref.charAt(0) === "#" ? doc.querySelector(ref) : doc.getElementById(ref)) : null; } catch (_) { /* bad selector */ }
    return panel || btn.nextElementSibling;
  }

  // Opens or closes a panel the way pages usually do it (the hidden attribute, a
  // "show" class, an inline display); false when it can't be shown or hidden safely.
  function setOpen(btn, open) {
    const panel = panelOf(btn);
    if (!panel || panel.contains(btn)) return false;
    if (open === isShown(panel)) return false; // the control is not what shows this panel
    const before = { hidden: panel.hidden, cls: panel.getAttribute("class"), style: panel.getAttribute("style") };
    const tries = open
      ? [() => { panel.hidden = false; if (panel.style.display === "none") panel.style.removeProperty("display"); },
        () => panel.classList.add("show"),
        () => { panel.style.display = "block"; }]
      : [() => panel.classList.remove("show"),
        () => { if (panel.style.display) panel.style.display = "none"; },
        () => { panel.hidden = true; }];
    for (const step of tries) { step(); if (isShown(panel) === open) break; }
    if (isShown(panel) !== open) {
      panel.hidden = before.hidden;
      if (before.cls === null) panel.removeAttribute("class"); else panel.setAttribute("class", before.cls);
      if (before.style === null) panel.removeAttribute("style"); else panel.setAttribute("style", before.style);
      return false;
    }
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (/hamburger|burger/i.test(btn.getAttribute("class") || "")) btn.classList.toggle("active", open);
    if (btn.parentElement && btn.parentElement === panel.parentElement) btn.parentElement.classList.toggle("is-open", open);
    return true;
  }

  // Open menus and pop-up lists close on a click outside them, as in the app.
  function closeOutside(target) {
    const doc = target.ownerDocument;
    let closed = false;
    doc.querySelectorAll('[aria-expanded="true"]').forEach((btn) => {
      const panel = panelOf(btn);
      if (!panel || btn.contains(target) || panel.contains(target) || !isShown(panel) || !isPopup(panel)) return;
      if (setOpen(btn, false)) closed = true;
    });
    doc.querySelectorAll("details[open]").forEach((d) => {
      const list = d.lastElementChild;
      if (d.contains(target) || !list || list.tagName === "SUMMARY" || !isPopup(list)) return;
      d.open = false;
      closed = true;
    });
    return closed;
  }

  function applyHide(box) {
    try { box.ownerDocument.querySelectorAll(box.getAttribute("data-demo-hide")).forEach((n) => { n.hidden = !box.checked; }); } catch (_) { /* bad selector */ }
  }

  function onChange(e) {
    const box = e.target;
    if (!box || !box.matches || !box.matches("input[data-demo-hide]")) return;
    applyHide(box);
    refreshLook(box.ownerDocument);
    settle();
    schedulePlace();
  }

  function resetBoxes(btn) {
    let scope = null;
    try { scope = btn.ownerDocument.querySelector(btn.getAttribute("data-demo-reset")); } catch (_) { /* bad selector */ }
    (scope || btn.ownerDocument).querySelectorAll("input[data-demo-hide]").forEach((box) => { box.checked = true; applyHide(box); });
    schedulePlace();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && guide.length) { e.preventDefault(); skip(); return; }
    if (!guide.length) return;
    if (e.key === "ArrowRight" || e.key === "Enter") { if (step < guide.length) { e.preventDefault(); next(); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
  });

  // A slow or failed download ends cleanly: the cover stays, with a short note.
  function unavailable() {
    root.classList.add("is-ready", "is-failed");
    if (!root.querySelector(".pl__error")) {
      root.insertAdjacentHTML("beforeend", '<div class="pl__error" role="status">Interactive preview unavailable right now.</div>');
    }
  }

  fit();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, 20000);
  fetch(root.dataset.src, { credentials: "same-origin", signal: controller ? controller.signal : undefined })
    .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
    .then((json) => {
      clearTimeout(timer);
      data = json;
      data.links = data.links || [];
      // Packed captures store each piece of markup once; a view is put together when drawn.
      if (Array.isArray(data.pool)) {
        data.states.forEach((st) => {
          const parts = st.parts || [];
          Object.defineProperty(st, "body", { get: () => parts.map((k) => data.pool[k]).join("") });
        });
        // Heads share the pool too (a page's head is the same in nearly every view).
        if (Array.isArray(data.headParts)) data.heads = data.headParts.map((parts) => parts.map((k) => data.pool[k]).join(""));
      }
      // The cover shows the recorded look; hide it when the visitor picked the other one.
      if (canLook() && currentLook() !== recordedLook()) root.classList.add("is-settled");
      if (Array.isArray(config.guideIndexes)) {
        const allowedIndexes = new Set(config.guideIndexes);
        data.guide = (data.guide || []).filter((_, index) => allowedIndexes.has(index));
      }
      steps = (data.guide || []).filter((g) => g.from >= 0 && g.from < data.states.length && g.to >= 0 && g.to < data.states.length);
      guided = config.guided !== false && steps.length > 0;
      guide = guided ? steps : [];
      // A walkthrough that shows the switch to dark starts as it was recorded.
      if (hasLookSteps()) look = lookBefore(0);
      render(guide.length ? guide[0].from : 0, () => {
        if (guide.length) goStep(0); else place();
        renderControls();
        // Read every view's recorded controls while the visitor looks, not on their first click.
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
        idle(() => recordedIdOf(null));
      });
    })
    .catch(() => {
      clearTimeout(timer);
      unavailable();
    });
})();
