// Search deeper: a pop-up that searches one school's records beyond the header search (notes on
// files and report cards, messages, events, announcements, activities, assessments and more fields
// of people). Opened from the header search's "Search deeper" link (public/js/headerMenu.js). The
// server decides what each person may search (utils/deepSearch.js, GET /common/search/deep); every
// word from the server goes in as text. Opens below the app header, like the other pop-ups.
(function () {
  if (window.ManagiraDeepSearch) return;
  var root = null;
  var timer = null;
  var aborter = null;
  var lastFocus = null;
  // The filters: seven categories on one row. A category covers the kinds of result listed with it (the
  // server then drops the kinds this person can't search: GET /common/search/deep?meta=1). Keep the
  // kinds in step with TYPES in utils/deepSearch.js.
  var CATEGORIES = [
    { key: "people", label: "People", kinds: ["students", "parents", "staff", "applicants"] },
    { key: "profiles", label: "Profiles & files", kinds: ["details", "files", "forms"] },
    { key: "notes", label: "Notes & communication", kinds: ["notes", "messages", "announcements"] },
    { key: "academics", label: "Academics", kinds: ["classes", "assessments", "remarks"] },
    { key: "transport", label: "Transport", kinds: ["buses"] },
    { key: "finance", label: "Finance", kinds: ["bills"] },
    { key: "calendar", label: "Calendar & tasks", kinds: ["activities", "events", "tasks"] },
    { key: "other", label: "Other details", kinds: ["other"] },
  ];
  var state = { active: CATEGORIES.map(function (c) { return c.key; }), includePast: false, cats: CATEGORIES.slice(), kinds: [], counts: {} };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function mark(text, q) {
    var safe = String(text == null ? "" : text);
    var at = q ? safe.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (at < 0) return esc(safe);
    return esc(safe.slice(0, at)) + "<mark>" + esc(safe.slice(at, at + q.length)) + "</mark>" + esc(safe.slice(at + q.length));
  }
  function headerBottom() {
    var header = document.getElementById("top-header");
    var rect = header ? header.getBoundingClientRect() : null;
    return Math.max(0, Math.round(rect ? rect.bottom : 64));
  }

  function build() {
    root = document.createElement("div");
    root.id = "mgDeepSearch";
    root.className = "mgds";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Search deeper");
    root.hidden = true;
    root.innerHTML =
      '<div class="mgds__box">' +
        '<form class="mgds__bar" role="search" autocomplete="off">' +
          '<div class="mgds__field"><input class="mgds__input" type="search" name="q" placeholder="Search anything in your school" aria-label="Search" maxlength="100" autocomplete="off"></div>' +
          '<button type="submit" class="mgds__go">Search</button>' +
          '<button type="button" class="mgds__x" data-close aria-label="Close search">Close</button>' +
        '</form>' +
        '<div class="mgds__panel" data-panel aria-label="Filters">' +
          '<label class="mgds__past"><input type="checkbox" data-past><span>Include past records</span></label>' +
          '<span class="mgds__sep" aria-hidden="true"></span>' +
          '<span class="mgds__ftitle">Filters:</span>' +
          '<div class="mgds__chips" data-chips></div>' +
          '<button type="button" class="mgds__reset" data-reset>Reset</button>' +
        '</div>' +
        '<div class="mgds__results" data-results aria-live="polite"></div>' +
      '</div>';
    document.body.appendChild(root);

    root.addEventListener("click", function (event) {
      if (event.target === root || event.target.closest("[data-close]")) { close(); return; }
      if (event.target.closest("[data-reset]")) { selectAll(); state.includePast = false; syncPanel(); run(); return; }
      var chip = event.target.closest("[data-cat]");
      if (chip) {
        // Everything is searched until you narrow it: tapping a category switches it off or back on, and
        // switching the last one off brings them all back.
        var key = chip.getAttribute("data-cat");
        var at = state.active.indexOf(key);
        if (at >= 0) state.active.splice(at, 1); else state.active.push(key);
        if (!state.active.length) selectAll();
        syncPanel();
        run();
      }
    });
    root.addEventListener("change", function (event) {
      if (event.target.matches("[data-past]")) { state.includePast = event.target.checked; run(); }
    });
    root.querySelector("form").addEventListener("submit", function (event) { event.preventDefault(); run(); });
    root.querySelector(".mgds__input").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { run(false); }, 350); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && root && !root.hidden) close(); });
    window.addEventListener("resize", place);
  }

  function place() { if (root) root.style.setProperty("--mgds-top", headerBottom() + "px"); }
  function isOn(key) { return state.active.indexOf(key) >= 0; }
  function allOn() { return state.cats.length > 0 && state.cats.every(function (c) { return isOn(c.key); }); }
  function selectAll() { state.active = state.cats.map(function (c) { return c.key; }); }
  function countOf(cat) { return cat.kinds.reduce(function (n, k) { return n + (state.counts[k] || 0); }, 0); }
  function syncPanel() {
    root.querySelector("[data-past]").checked = state.includePast;
    root.querySelector("[data-chips]").innerHTML = state.cats.map(function (c) {
      var n = countOf(c);
      return '<button type="button" class="mgds__chip' + (isOn(c.key) ? " is-on" : "") + '" data-cat="' + esc(c.key) + '" aria-pressed="' + isOn(c.key) + '">' + esc(c.label) + (n ? "<small>" + n + "</small>" : "") + "</button>";
    }).join("");
  }
  // The kinds of result a search covers: those of every highlighted category.
  function activeKinds() {
    var kinds = [];
    state.cats.forEach(function (c) { if (isOn(c.key)) kinds = kinds.concat(c.kinds); });
    return kinds;
  }
  function labelOf(kind) { var t = state.kinds.filter(function (x) { return x.key === kind; })[0]; return t ? t.label : kind; }

  function say(html) { root.querySelector("[data-results]").innerHTML = html; }

  function card(item, q) {
    var inner =
      '<span class="mgds__badge">' + esc(item.label) + "</span>" +
      '<span class="mgds__title">' + mark(item.title, q) + "</span>" +
      (item.text ? '<span class="mgds__text">' + mark(item.text, q) + "</span>" : "") +
      (item.meta ? '<span class="mgds__meta">' + esc(item.meta) + "</span>" : "");
    var cls = "mgds__card" + (item.past ? " is-past" : "");
    if (item.person) return '<a class="' + cls + '" href="#" data-person="' + esc(item.person) + '">' + inner + "</a>";
    return '<a class="' + cls + '" href="' + esc(item.href || "#") + '">' + inner + "</a>";
  }

  function run() {
    var q = root.querySelector(".mgds__input").value.trim();
    clearTimeout(timer);
    if (aborter) aborter.abort();
    if (q.length < 2) {
      state.counts = {};
      syncPanel();
      say('<div class="mgds__state"><strong>Search anything in your school</strong><span>Names and profile details, notes on files and report cards, messages, forms, events, announcements, buses and more. Type at least 2 characters.</span></div>');
      return;
    }
    say('<div class="mgds__state"><span class="mgds__spin" aria-hidden="true"></span>Searching…</div>');
    aborter = new AbortController();
    var narrowed = !allOn();
    var url = "/common/search/deep?q=" + encodeURIComponent(q) + (narrowed ? "&types=" + encodeURIComponent(activeKinds().join(",")) : "") + (state.includePast ? "&includePast=1" : "");
    fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: aborter.signal })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (!r.ok || !r.body.success) { say('<div class="mgds__state is-bad"><strong>' + esc((r.body && r.body.message) || "Search deeper couldn't finish.") + "</strong></div>"); return; }
        state.counts = r.body.counts || {};
        syncPanel();
        var items = r.body.results || [];
        if (!items.length) {
          say('<div class="mgds__state"><strong>No results for “' + esc(q) + '”</strong><span>' + (state.includePast ? "Try fewer or different words." : "Past records are left out. Tick “Include past records” to search them too.") + "</span></div>");
          return;
        }
        // The exact matches on top, then what is related, each kind under its own heading.
        var exact = items.filter(function (i) { return i.exact; });
        var related = items.filter(function (i) { return !i.exact; });
        var html = "";
        if (exact.length) html += '<h3 class="mgds__group is-best">Exact match<span>' + exact.length + '</span></h3><div class="mgds__grid">' + exact.map(function (i) { return card(i, q); }).join("") + "</div>";
        (state.kinds.length ? state.kinds : [...new Set(related.map(function (i) { return i.type; }))].map(function (k) { return { key: k, label: k }; })).forEach(function (t) {
          var list = related.filter(function (i) { return i.type === t.key; });
          if (!list.length) return;
          html += '<h3 class="mgds__group">' + (exact.length ? "Related · " : "") + esc(t.label) + "<span>" + list.length + '</span></h3><div class="mgds__grid">' + list.map(function (i) { return card(i, q); }).join("") + "</div>";
        });
        if (r.body.partial) html += '<p class="mgds__note">Some results were slow to load. Search again to include them.</p>';
        say(html);
      })
      .catch(function (error) { if (error.name !== "AbortError") say('<div class="mgds__state is-bad"><strong>Search deeper couldn\u2019t finish. Try again.</strong></div>'); });
  }

  var metaLoaded = null;
  function loadMeta() {
    if (metaLoaded) return metaLoaded;
    metaLoaded = fetch("/common/search/deep?meta=1", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || !body.success || !body.types || !body.types.length) return;
        state.kinds = body.types;
        var allowed = body.types.map(function (t) { return t.key; });
        // A category with nothing this person can search is taken away.
        state.cats = CATEGORIES.filter(function (c) { return c.kinds.some(function (k) { return allowed.indexOf(k) >= 0; }); });
      })
      .catch(function () { metaLoaded = null; });
    return metaLoaded;
  }

  function open(options) {
    options = options || {};
    if (!root) build();
    lastFocus = document.activeElement;
    state.includePast = Boolean(options.includePast);
    place();
    root.hidden = false;
    document.documentElement.classList.add("mgds-open");
    var input = root.querySelector(".mgds__input");
    input.value = options.query || "";
    // Every filter is there and highlighted from the start: everything is searched until you narrow it.
    selectAll();
    syncPanel();
    run();
    // Then the kinds this person can't search are taken away.
    loadMeta().then(function () {
      var keep = state.cats.map(function (c) { return c.key; });
      state.active = state.active.filter(function (k) { return keep.indexOf(k) >= 0; });
      if (!state.active.length) selectAll();
      syncPanel();
    });
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }
  function close() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove("mgds-open");
    if (aborter) aborter.abort();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) { /* gone */ } }
  }
  // A result opens its page or its card: close first so it isn't left behind.
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest(".mgds__card");
    if (link && root && !root.hidden) setTimeout(close, 0);
  }, true);

  window.ManagiraDeepSearch = { open: open, close: close };
})();
