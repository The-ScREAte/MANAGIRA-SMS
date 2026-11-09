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

  // Best matches first: title words count most, then tags, topic and summary.
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

  document.querySelectorAll("[data-docs-search]").forEach(function (box) {
    var input = box.querySelector("input");
    var results = box.querySelector(".docs-results");
    var active = -1;
    function show() {
      var q = input.value.trim();
      if (!q) { results.hidden = true; return; }
      var hits = search(q);
      active = -1;
      results.innerHTML = hits.length
        ? hits.map(function (hit) { return '<a href="/legal/user-documentation/' + encodeURIComponent(hit.s) + '"><strong>' + esc(hit.t) + "</strong><small>" + esc(hit.c) + "</small></a>"; }).join("")
        : '<div class="docs-results__none">No guides match "' + esc(q) + '". Try other words, or ask Mira in the chat.</div>';
      results.hidden = false;
    }
    input.addEventListener("input", show);
    input.addEventListener("focus", show);
    input.addEventListener("keydown", function (event) {
      var links = results.querySelectorAll("a");
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!links.length) return;
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : links.length - 1)) % links.length;
        links.forEach(function (link, i) { link.classList.toggle("is-active", i === active); });
      } else if (event.key === "Enter") {
        var go = links[active >= 0 ? active : 0];
        if (go) { event.preventDefault(); window.location.href = go.href; }
      } else if (event.key === "Escape") {
        results.hidden = true;
      }
    });
    document.addEventListener("click", function (event) { if (!box.contains(event.target)) results.hidden = true; });
  });

  // Sidebar: filter the guides as you type.
  var side = document.querySelector("[data-docs-side]");
  if (side) {
    var filter = side.querySelector(".docs-filter input");
    var empty = side.querySelector(".docs-side__empty");
    if (filter) filter.addEventListener("input", function () {
      var q = norm(filter.value.trim());
      var any = false;
      side.querySelectorAll(".docs-group").forEach(function (group) {
        var shown = 0;
        group.querySelectorAll("li").forEach(function (li) {
          var hit = !q || norm(li.textContent).indexOf(q) !== -1;
          li.hidden = !hit;
          if (hit) shown += 1;
        });
        group.hidden = !shown;
        if (q && shown) group.open = true;
        if (shown) any = true;
      });
      if (empty) empty.style.display = any ? "none" : "block";
    });
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
