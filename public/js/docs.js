// Managira help center (views/docs): instant search, sidebar filter, the phone drawer,
// "On this page" highlighting, "Was this helpful?" and a picture viewer. No dependencies.
(function () {
  "use strict";

  var index = [];
  try {
    var data = document.getElementById("docs-index");
    if (data) index = JSON.parse(data.textContent || "[]");
  } catch (_e) { index = []; }

  var norm = function (value) { return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };

  // Best matches first among the titles the page already has: title words count most, then
  // tags, topic and summary.
  function search(query) {
    var words = norm(query).split(/\s+/).filter(function (w) { return w.length > 1; });
    if (!words.length) return [];
    return index.map(function (item) {
      var title = norm(item.t), rest = norm(item.k + " " + item.c), summary = norm(item.d);
      var score = 0;
      words.forEach(function (w) {
        if (title.indexOf(w) !== -1) score += title.indexOf(w) === 0 ? 6 : 4;
        if (rest.indexOf(w) !== -1) score += 2;
        if (summary.indexOf(w) !== -1) score += 1;
      });
      if (title.indexOf(norm(query)) !== -1) score += 6;
      return { item: item, score: score };
    }).filter(function (hit) { return hit.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 8)
      .map(function (hit) { return hit.item; });
  }

  // Every word of every guide, searched on the server (utils/docs/askDocs.js search): each result
  // goes straight to the section that matches, with its words as a snippet. Titles the page
  // already has answer at once while the server looks.
  var found = {};
  function findInGuides(q) {
    if (found[q]) return Promise.resolve(found[q]);
    return fetch("/legal/user-documentation/api/find?q=" + encodeURIComponent(q), { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.success) found[q] = data; return data; })
      .catch(function () { return null; });
  }
  // The words asked, marked in a snippet (built from escaped pieces, never as HTML).
  function marked(text, q) {
    var raw = String(text || "");
    var lower = norm(raw);
    var spans = [];
    norm(q).split(/\s+/).filter(function (w) { return w.length > 2; }).forEach(function (w) {
      for (var i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) spans.push([i, i + w.length]);
    });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", at = 0;
    spans.forEach(function (span) {
      if (span[0] < at) return;
      out += esc(raw.slice(at, span[0])) + "<mark>" + esc(raw.slice(span[0], span[1])) + "</mark>";
      at = span[1];
    });
    return out + esc(raw.slice(at));
  }
  function resultHtml(hit, q) {
    return '<a href="' + esc(hit.url || ("/legal/user-documentation/" + encodeURIComponent(hit.s))) + '">'
      + "<strong>" + esc(hit.title || hit.t) + "</strong>"
      + (hit.section ? '<span class="docs-results__sec">' + esc(hit.section) + "</span>" : "")
      + (hit.snippet ? '<span class="docs-results__snip">' + marked(hit.snippet, q) + "</span>" : "")
      + "<small>" + esc(hit.topic || hit.c) + "</small></a>";
  }
  function noneHtml(q) {
    return '<div class="docs-results__none">No guides match "' + esc(q) + '". Try other words, or ask in the chat.</div>';
  }
  // Shows results for what's typed in `input` inside `list`, quick ones first, then the full ones.
  function searcher(input, list, onShow) {
    var timer = null, asked = "";
    function show() {
      var q = input.value.trim();
      asked = q;
      clearTimeout(timer);
      if (!q) { onShow(false); return; }
      var quick = search(q);
      list.innerHTML = quick.length ? quick.map(function (hit) { return resultHtml(hit, q); }).join("") : '<div class="docs-results__none">Searching…</div>';
      onShow(true);
      if (q.length < 2) return;
      timer = setTimeout(function () {
        findInGuides(q).then(function (data) {
          if (asked !== q) return;
          if (!data) { if (!quick.length) list.innerHTML = noneHtml(q); return; }
          var hits = data.results || [];
          list.innerHTML = (data.corrected ? '<div class="docs-results__fix">Showing results for <strong>' + esc(data.corrected) + "</strong></div>" : "")
            + (hits.length ? hits.map(function (hit) { return resultHtml(hit, q); }).join("") : noneHtml(q));
          onShow(true);
        });
      }, 160);
    }
    input.addEventListener("input", show);
    input.addEventListener("focus", function () { if (input.value.trim()) show(); });
    var active = -1;
    input.addEventListener("keydown", function (event) {
      var links = list.querySelectorAll("a");
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!links.length) return;
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : links.length - 1)) % links.length;
        links.forEach(function (link, i) { link.classList.toggle("is-active", i === active); });
        if (links[active]) links[active].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        var go = links[active >= 0 ? active : 0];
        if (go) { event.preventDefault(); window.location.href = go.href; }
      } else if (event.key === "Escape") {
        onShow(false);
      }
    });
    input.addEventListener("input", function () { active = -1; });
  }

  document.querySelectorAll("[data-docs-search]").forEach(function (box) {
    var input = box.querySelector("input");
    var results = box.querySelector(".docs-results");
    searcher(input, results, function (on) { results.hidden = !on; });
    document.addEventListener("click", function (event) { if (!box.contains(event.target)) results.hidden = true; });
  });

  // Sidebar: typing searches every guide; the topics come back when the box is empty.
  var side = document.querySelector("[data-docs-side]");
  if (side) {
    var filter = side.querySelector(".docs-filter input");
    var nav = side.querySelector("nav");
    var empty = side.querySelector(".docs-side__empty");
    if (filter && nav) {
      var list = document.createElement("div");
      list.className = "docs-results docs-results--side";
      list.hidden = true;
      nav.parentNode.insertBefore(list, nav);
      searcher(filter, list, function (on) {
        list.hidden = !on;
        nav.hidden = on;
        if (empty) empty.style.display = "none";
      });
    }
    // Keep the current guide in view inside the sidebar, without moving the page.
    var current = side.querySelector('[aria-current="page"]');
    if (current && current.offsetTop > side.clientHeight - 60) side.scrollTop = current.offsetTop - side.clientHeight / 2;
  }

  // Phone drawer.
  var open = document.querySelector("[data-docs-open]");
  var scrim = document.querySelector(".docs-scrim");
  function drawer(on) {
    if (!side) return;
    side.classList.toggle("is-open", on);
    if (scrim) scrim.classList.toggle("is-open", on);
    if (open) open.setAttribute("aria-expanded", on ? "true" : "false");
    document.documentElement.style.overflow = on ? "hidden" : "";
  }
  if (open) open.addEventListener("click", function () { drawer(!side.classList.contains("is-open")); });
  if (scrim) scrim.addEventListener("click", function () { drawer(false); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") drawer(false); });

  // "On this page": light the section being read.
  var toc = document.querySelector("[data-docs-toc]");
  if (toc && "IntersectionObserver" in window) {
    var links = {};
    toc.querySelectorAll("ul a[href^='#']").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var visible = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible[entry.target.id] = entry.isIntersecting; });
      var first = Object.keys(links).find(function (id) { return visible[id]; });
      if (first) Object.keys(links).forEach(function (id) { links[id].classList.toggle("is-active", id === first); });
    }, { rootMargin: "-80px 0px -60% 0px" });
    Object.keys(links).forEach(function (id) { var el = document.getElementById(id); if (el) observer.observe(el); });
  }

  // Was this helpful?
  var helpful = document.querySelector("[data-docs-helpful]");
  if (helpful) {
    helpful.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-vote]");
      if (!button) return;
      helpful.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      fetch("/legal/user-documentation/api/helpful", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ articleId: Number(helpful.getAttribute("data-article")), vote: button.getAttribute("data-vote") }),
      }).catch(function () {}).then(function () {
        helpful.querySelector(".docs-helpful__btns").outerHTML = '<span class="docs-helpful__thanks" role="status">Thanks for telling us.</span>';
      });
    });
  }

  // Pictures open full size.
  document.addEventListener("click", function (event) {
    var img = event.target.closest(".docs-content figure img");
    if (!img) return;
    var viewer = document.createElement("div");
    viewer.className = "docs-zoom";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-label", img.alt || "Screenshot");
    viewer.innerHTML = '<img src="' + esc(img.currentSrc || img.src) + '" alt="' + esc(img.alt) + '">';
    var close = function () { viewer.remove(); document.removeEventListener("keydown", onKey); };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    viewer.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(viewer);
  });
})();
