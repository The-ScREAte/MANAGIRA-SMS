// Interactive capture player (/legal/app-demo/play/:id), shown inside the
// product tour viewer. A capture is a set of page states plus the recorded
// clicks between them (see public/js/demoCapture.js). The page is drawn in an
// iframe sandboxed without scripts; this script swaps states when a visitor
// clicks a recorded element.
//
// Guided (the admin's choice, on by default): visitors are walked through the
// recorded clicks: a ring around the element to click and a tooltip beside it
// with the explanation, Back and Next. Explore: every recorded element is
// ringed, can be clicked in any order, and shows its explanation on hover.
(function () {
  "use strict";

  const root = document.getElementById("pl");
  const frame = root.querySelector(".pl__frame");
  const layer = root.querySelector(".pl__layer");
  const toastEl = root.querySelector(".pl__toast");
  const W = Number(root.dataset.w) || 1440;
  const config = JSON.parse(document.getElementById("pl-config").textContent || "{}");
  root.style.setProperty("--accent", config.accent || "#14b8a6");

  let data = null;
  let steps = []; // every recorded click, in order (their explanations)
  let guided = false; // the capture has a guided walkthrough
  let skipped = false; // the visitor closed it
  let rings = true; // highlights shown (visitors can hide them)
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
    return `<!DOCTYPE html><html${attrString(st.htmlAttrs)}><head>${data.heads[st.head]}</head><body${attrString(st.bodyAttrs)}>${st.body}</body></html>`;
  };

  function setAttrs(el, attrs) {
    Array.from(el.attributes).forEach((a) => { if (!(a.name in attrs)) el.removeAttribute(a.name); });
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  }

  // Fades the cover once the live page has its images, or as soon as anything changes.
  function settle() { root.classList.add("is-settled"); }

  // Draws state i. The first draw opens at the top of the page; later ones keep the scroll.
  function render(i, done) {
    const prev = current;
    if (prev >= 0) settle();
    current = i;
    hot = new Map(data.links.filter((l) => l.from === i).map((l) => [l.el, l.to]));
    const st = data.states[i];
    const doc = frame.contentDocument;
    if (prev >= 0 && doc && doc.body && data.states[prev].head === st.head) {
      const scrollEl = doc.scrollingElement || doc.documentElement;
      const y = scrollEl.scrollTop;
      const parsed = new DOMParser().parseFromString(stateHtml(i), "text/html");
      setAttrs(doc.documentElement, st.htmlAttrs);
      doc.documentElement.replaceChild(doc.importNode(parsed.body, true), doc.body);
      scrollEl.scrollTop = y;
      wire(doc, done);
      return;
    }
    // Written straight into the frame: the page shows as soon as it is parsed,
    // without waiting for its images, fonts and panes (a load event can take long).
    const d = frame.contentDocument;
    d.open();
    d.write(stateHtml(i));
    d.close();
    d.__mcapWired = false; // document.open() drops the listeners
    if (d.defaultView) d.defaultView.addEventListener("load", () => { settle(); schedulePlace(); }, { once: true }); // late images move things
    setTimeout(settle, 1200);
    wire(d, () => {
      (d.scrollingElement || d.documentElement).scrollTop = 0;
      root.classList.add("is-ready");
      if (done) done();
    });
  }

  // Readies a document of the current state and calls done right away; embedded
  // panes are readied as they load, and the overlay follows them.
  function wire(doc, done) {
    const visit = (d) => {
      if (!d || !d.documentElement) return;
      d.querySelectorAll("[data-mcap-scroll]").forEach((n) => {
        if (n === d.documentElement) return;
        const [top, left] = n.getAttribute("data-mcap-scroll").split(",").map(Number);
        n.scrollTop = top || 0;
        n.scrollLeft = left || 0;
      });
      if (!d.__mcapWired) {
        d.__mcapWired = true;
        d.addEventListener("click", onClick, true);
        d.addEventListener("submit", (e) => e.preventDefault(), true);
        d.addEventListener("scroll", schedulePlace, true);
        d.addEventListener("mouseover", onHover, true);
      }
      d.querySelectorAll("iframe").forEach((f) => {
        const ready = () => { try { visit(f.contentDocument); } catch (_) { /* ignore */ } schedulePlace(); };
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
    render(g.to, () => goStep(step + 1));
  }

  function back() {
    if (step > 0) goStep(step - 1);
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

  // ---------- Overlay: rings and the tooltip ----------

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
        const text = explanation(g.el) || "Click the highlighted area.";
        const tip = `<div class="pl-tip" role="dialog" aria-live="polite" aria-label="Step ${step + 1} of ${guide.length}">
          <button type="button" class="pl-tip__close" data-pl="skip" aria-label="Skip walkthrough" title="Skip walkthrough (Esc)">×</button>
          <p>${esc(text)}</p>
          <div class="pl-tip__foot"><span>${step + 1} of ${guide.length}</span>
            <div class="pl-btns"><button type="button" class="pl-btn" data-pl="back"${step === 0 ? " disabled" : ""}>Back</button>
            <button type="button" class="pl-btn pl-btn--primary" data-pl="next">${step === guide.length - 1 ? "Finish" : "Next"}</button></div></div>
          <i class="pl-tip__arrow"></i></div>`;
        if (box && box.w && box.h) html = `<div class="pl-ring" style="left:${box.x - 5}px;top:${box.y - 5}px;width:${box.w + 10}px;height:${box.h + 10}px"></div>` + tip;
        else html = tip.replace('class="pl-tip"', 'class="pl-tip pl-tip--free"');
        layer.innerHTML = html;
        if (box && box.w && box.h) positionTip(layer.querySelector(".pl-tip"), box);
        return;
      }
    } else if (rings) {
      new Set(data.links.map((l) => l.el)).forEach((id) => {
        if (linkFor(id) === current) return;
        const el = findEl(id);
        const box = el && boxOf(el);
        if (box && isVisible(box)) html += `<div class="pl-ring pl-ring--soft" style="left:${box.x - 4}px;top:${box.y - 4}px;width:${box.w + 8}px;height:${box.h + 8}px"></div>`;
      });
      // Explore mode: the explanation of the recorded element under the pointer.
      const text = hovered && explanation(hovered);
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
    const label = cleanLabel(steps[k].label);
    return (config.texts && config.texts[k]) || (label ? "Click “" + label + "”." : "");
  }

  let hovered = null;
  function onHover(e) {
    settle();
    if (guide.length || !rings) return;
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
  function positionTip(tip, box) {
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

  layer.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pl]");
    if (!btn) return;
    const act = btn.dataset.pl;
    if (act === "next") next();
    else if (act === "back") back();
    else if (act === "restart") restart();
    else if (act === "skip") skip();
  });

  // ---------- Skip: hide the walkthrough and every highlight ----------

  function skip() {
    settle();
    if (!guide.length) return;
    skipped = true;
    rings = false;
    guide = [];
    step = -1;
    hovered = null;
    place();
    renderControls();
  }

  function resume() {
    skipped = false;
    rings = true;
    guide = steps;
    renderControls();
    const k = guide.findIndex((g) => g.from === current);
    if (k >= 0) goStep(k); else restart();
  }

  function renderControls() {
    const box = root.querySelector(".pl__controls");
    const links = data && data.links.length;
    if (guided && !skipped) { box.hidden = true; return; }
    if (!links) { box.hidden = true; return; }
    box.innerHTML = guided
      ? '<button type="button" class="is-primary" data-c="guide">Show guide</button><button type="button" data-c="reset">Reset</button>'
      : '<button type="button" data-c="rings" aria-pressed="' + rings + '"><i></i>Highlights</button><button type="button" data-c="reset">Reset</button>';
    box.hidden = false;
  }

  root.querySelector(".pl__controls").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-c]");
    if (!btn) return;
    if (btn.dataset.c === "guide") resume();
    else if (btn.dataset.c === "reset") restart();
    else if (btn.dataset.c === "rings") { rings = !rings; hovered = null; place(); renderControls(); }
  });

  function restart() {
    render(guide.length ? guide[0].from : 0, () => {
      (frame.contentDocument.scrollingElement || frame.contentDocument.documentElement).scrollTop = 0;
      if (guide.length) goStep(0); else place();
    });
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
    return el.tagName + "." + cls + "|" + (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
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
    return recordedKeys.get(sameElementKey(el)) || null;
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
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const id = n.getAttribute("data-mcap-el") || (n.tagName !== "BODY" && n.tagName !== "HTML" ? recordedIdOf(n) : null);
      const to = linkFor(id);
      if (to === null || to === current) continue;
      e.preventDefault();
      e.stopPropagation();
      const g = guide[step];
      if (g && g.el === id && g.from === current) { next(); return; }
      // Another recorded click (or explore mode): follow it, and pick up the walkthrough where it fits.
      hovered = null;
      render(to, () => {
        const k = guide.findIndex((x) => x.from === to);
        if (guide.length && k >= 0) goStep(k); else { step = guide.length ? guide.length : -1; place(); }
      });
      return;
    }
    if (!start) return;
    if (start.closest("summary") || start.closest("input, select, textarea, label")) return; // work without scripts
    if (start.closest("a[href]")) {
      e.preventDefault();
      toast("This link opens another page in the full app.");
      return;
    }
    if (start.closest("button, [role='button'], [role='tab'], [role='menuitem'], [onclick]")) {
      e.preventDefault();
      toast(guide.length ? "Not part of this preview. Follow the highlighted steps, or press × to skip."
        : hot.size ? "Not part of this preview." : "This preview shows the page as it looks.");
    }
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
      steps = (data.guide || []).filter((g) => g.from >= 0 && g.from < data.states.length && g.to >= 0 && g.to < data.states.length);
      guided = config.guided !== false && steps.length > 0;
      guide = guided ? steps : [];
      render(guide.length ? guide[0].from : 0, () => {
        if (guide.length) goStep(0); else place();
        renderControls();
      });
    })
    .catch(() => {
      clearTimeout(timer);
      unavailable();
    });
})();
