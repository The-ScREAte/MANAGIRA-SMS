// Page finder: Ctrl+K (Cmd+K on a Mac) opens a search for the pages this person can open.
// The list comes from GET /common/page-finder.json (utils/pageFinder.js: the same rules as the
// menus, so nothing is offered that the person would be sent away from). It is kept in
// sessionStorage and fetched quietly ahead of the first open, so the finder opens with its list
// at once. Recently opened pages come first. Every word goes in as text. The last row hands the
// words to the header search, for people and records.
(function () {
  if (window.ManagiraPageFinder) return;
  var canSearch = true, overlay = null, input = null, list = null, pages = null, school = "", shown = [], active = 0, lastFocus = null, loading = false, fetchedAt = 0;
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  var CACHE = "managira-pf-pages", RECENT = "managira-pf-recent";

  var ICONS = {
    Home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    "Your classes": "M4 5h16v11H4zM8 20h8M12 16v4",
    People: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0",
    School: "M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5",
    Teaching: "M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM8 9h8M8 13h6",
    Reports: "M5 20V10M12 20V4M19 20v-7",
    Money: "M3 7h18v12H3zM3 11h18M7 15h3",
    Settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
    Recent: "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"
  };
  function icon(group) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "pf-ico");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONS[group] || ICONS.Home); svg.appendChild(path); return svg;
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function store(kind) { try { return kind === "s" ? window.sessionStorage : window.localStorage; } catch (e) { return null; } }
  function readJson(kind, key) { try { var s = store(kind); return s ? JSON.parse(s.getItem(key) || "null") : null; } catch (e) { return null; } }
  function writeJson(kind, key, value) { try { var s = store(kind); if (s) s.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function schoolKey() { var root = document.getElementById("app-scale-root"); return root ? String(root.getAttribute("data-school") || "") : ""; }
  function ensureCss() {
    if (document.getElementById("pfCss")) return;
    var assets = window.MG_ASSETS || {};
    var l = document.createElement("link"); l.id = "pfCss"; l.rel = "stylesheet"; l.href = assets.pageFinderCss || "/css/pageFinder.css"; document.head.appendChild(l);
  }

  // The list: kept for the tab and refreshed in the background when it is more than a minute old.
  function load(force) {
    var cached = readJson("s", CACHE);
    if (!pages && cached && cached.school === schoolKey() && Array.isArray(cached.pages)) { pages = cached.pages; fetchedAt = cached.at || 0; canSearch = cached.search !== false; }
    if (loading || (!force && pages && Date.now() - fetchedAt < 60000)) return;
    loading = true;
    fetch("/common/page-finder.json", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.pages)) {
          pages = d.pages; school = d.school || ""; fetchedAt = Date.now(); canSearch = d.search !== false;
          writeJson("s", CACHE, { school: schoolKey(), at: fetchedAt, pages: pages, search: canSearch });
        } else if (!pages) { pages = null; }
      })
      .catch(function () { if (!pages) pages = null; })
      .then(function () { loading = false; if (overlay && !overlay.hidden) render(); });
  }

  function recents() { var r = readJson("l", RECENT + ":" + schoolKey()); return Array.isArray(r) ? r : []; }
  function remember(p) {
    if (!p || p.search || !p.url) return;
    var r = recents().filter(function (x) { return x.url !== p.url; });
    r.unshift({ label: p.label, group: p.group, url: p.url });
    writeJson("l", RECENT + ":" + schoolKey(), r.slice(0, 5));
  }

  function build() {
    ensureCss();
    overlay = el("div", "pf-overlay"); overlay.hidden = true;
    var box = el("div", "pf-box"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Find a page");
    var bar = el("div", "pf-bar");
    var mag = document.createElementNS("http://www.w3.org/2000/svg", "svg"); mag.setAttribute("viewBox", "0 0 24 24"); mag.setAttribute("class", "pf-mag"); mag.setAttribute("aria-hidden", "true");
    var mp = document.createElementNS("http://www.w3.org/2000/svg", "path"); mp.setAttribute("d", "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3"); mag.appendChild(mp);
    input = el("input", "pf-input"); input.type = "text"; input.placeholder = "Go to a page…"; input.setAttribute("autocomplete", "off"); input.setAttribute("spellcheck", "false"); input.setAttribute("aria-label", "Find a page");
    var esc = el("kbd", "pf-esc", "Esc");
    bar.appendChild(mag); bar.appendChild(input); bar.appendChild(esc);
    list = el("ul", "pf-list"); list.setAttribute("role", "listbox");
    var foot = el("div", "pf-foot");
    [["↑↓", "Move"], ["Enter", "Open"], [MAC ? "⌘K" : "Ctrl K", "Toggle"]].forEach(function (k) { var s = el("span"); s.appendChild(el("kbd", "", k[0])); s.appendChild(document.createTextNode(" " + k[1])); foot.appendChild(s); });
    box.appendChild(bar); box.appendChild(list); box.appendChild(foot); overlay.appendChild(box); document.body.appendChild(overlay);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    esc.addEventListener("click", close);
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Home") { e.preventDefault(); setActive(0); }
      else if (e.key === "End") { e.preventDefault(); setActive(shown.length - 1); }
      else if (e.key === "Enter") { e.preventDefault(); go(shown[active], e); }
    });
  }

  // Every typed word must be found in the page's name or in the words people use for it.
  function score(p, tokens, whole) {
    var label = p.label.toLowerCase(), words = (p.words || "").toLowerCase(), total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var q = tokens[i], s = 0;
      if (label === q) s = 100;
      else if (label.indexOf(q) === 0) s = 80;
      else if (label.split(/[\s:&/,-]+/).some(function (w) { return w.indexOf(q) === 0; })) s = 60;
      else if (label.indexOf(q) > -1) s = 40;
      else if (words.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) s = 25;
      else if (words.indexOf(q) > -1) s = 15;
      if (!s) return 0;
      total += s;
    }
    if (label === whole) total += 100;
    return total;
  }
  function mark(text, tokens) {
    var frag = document.createDocumentFragment(), lower = text.toLowerCase(), spans = [];
    tokens.forEach(function (t) { var at = lower.indexOf(t); if (at > -1) spans.push([at, at + t.length]); });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    spans.forEach(function (s) { var last = merged[merged.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push(s.slice()); });
    var pos = 0;
    merged.forEach(function (s) { if (s[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, s[0]))); frag.appendChild(el("mark", "", text.slice(s[0], s[1]))); pos = s[1]; });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return frag;
  }
  function render() {
    var q = (input.value || "").trim().toLowerCase();
    var tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    var all = pages || [];
    var rows;
    if (q) rows = all.map(function (p) { return { p: p, s: score(p, tokens, q) }; }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (r) { return r.p; });
    else {
      var known = {}; all.forEach(function (p) { known[p.url] = p; });
      // Recent pages the person can still open, then every page by group.
      var rec = recents().filter(function (r) { return known[r.url]; }).map(function (r) { return { label: known[r.url].label, group: "Recent", url: r.url, home: known[r.url].group }; });
      rows = rec.concat(all);
    }
    shown = rows.slice(0, 40);
    if (q && canSearch && document.querySelector('#search-input')) shown.push({ search: input.value.trim() });
    active = 0; list.textContent = "";
    if (!pages) { list.appendChild(el("li", "pf-empty", loading ? "Loading pages…" : "Pages couldn't be loaded. Press Esc and try again.")); return; }
    var lastGroup = null;
    shown.forEach(function (p, i) {
      if (!q && p.group !== lastGroup && !p.search) { lastGroup = p.group; list.appendChild(el("li", "pf-group", p.group)); }
      var li = el("li", "pf-item" + (i === 0 ? " is-active" : "")); li.setAttribute("role", "option"); li.dataset.i = String(i);
      var ico = el("span", "pf-icon"); ico.appendChild(p.search ? icon("People") : icon(p.group === "Recent" ? "Recent" : p.group)); li.appendChild(ico);
      var name = el("span", "pf-name");
      if (p.search) { name.appendChild(document.createTextNode("Search people and records for ")); name.appendChild(el("b", "", "“" + p.search + "”")); }
      else name.appendChild(q ? mark(p.label, tokens) : document.createTextNode(p.label));
      li.appendChild(name);
      if (!p.search && (q || p.group === "Recent")) li.appendChild(el("small", "", q ? p.group : (p.home || "")));
      if (i === 0) li.appendChild(el("kbd", "pf-enter", "↵"));
      li.addEventListener("mousemove", function () { if (active !== i) setActive(i); });
      li.addEventListener("click", function (e) { go(p, e); });
      list.appendChild(li);
    });
    if (q && !shown.some(function (p) { return !p.search; })) list.insertBefore(el("li", "pf-empty", "No page matches “" + input.value.trim() + "”."), list.firstChild);
  }
  function setActive(i) {
    if (i < 0 || i >= shown.length) return;
    active = i;
    Array.prototype.forEach.call(list.querySelectorAll(".pf-item"), function (n) {
      var on = Number(n.dataset.i) === i; n.classList.toggle("is-active", on);
      var k = n.querySelector(".pf-enter"); if (k) k.remove();
      if (on) n.appendChild(el("kbd", "pf-enter", "↵"));
    });
    var n = list.querySelector('.pf-item[data-i="' + i + '"]'); if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" });
  }
  function move(d) { if (!shown.length) return; setActive((active + d + shown.length) % shown.length); }
  function go(p, e) {
    if (!p) return;
    if (p.search) {
      close();
      var s = document.querySelector('#search-input');
      if (s) { s.focus(); s.value = p.search; s.dispatchEvent(new Event("input", { bubbles: true })); }
      return;
    }
    remember(p);
    close();
    // Ctrl/Cmd with Enter or a click opens the page in a new tab.
    if (e && (e.metaKey || e.ctrlKey)) { window.open(p.url, "_blank", "noopener"); return; }
    window.location.assign(p.url);
  }
  function open() {
    if (!overlay) build();
    var h = document.getElementById("top-header");
    overlay.style.setProperty("--pf-top", (h ? Math.round(h.getBoundingClientRect().bottom) : 64) + "px");
    lastFocus = document.activeElement; overlay.hidden = false; input.value = "";
    load(false); render(); input.focus();
  }
  function close() { if (!overlay) return; overlay.hidden = true; if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} } }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "k") {
      e.preventDefault();
      if (overlay && !overlay.hidden) close(); else open();
    }
  });
  // Fetch the list and the style sheet while the browser is idle, so the first open is instant.
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
  idle(function () { ensureCss(); load(false); });
  window.ManagiraPageFinder = { open: open, close: close };
})();
