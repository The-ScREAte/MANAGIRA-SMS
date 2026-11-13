// Data migration: follows the school's background task (views/migration/partials/task.ejs) and
// sends uploads with a progress bar (views/migration/partials/upload.ejs). Everything here is an
// improvement on plain forms, which work without it.
(function () {
  "use strict";
  if (!document.querySelector(".mg")) return;
  var generation = 0; // a swapped-in step stops the last one's polling

  var fmtSize = function (bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  };
  var fmtSecs = function (n) { return n < 60 ? n + " s" : Math.floor(n / 60) + " min " + String(n % 60).padStart(2, "0") + " s"; };
  var setText = function (el, text) { if (el) el.textContent = text; };

  function init(root) {
  var gen = ++generation;
  // ── The task card ──
  var card = root.querySelector("[data-task]");
  var lockForms = function (on) {
    root.querySelectorAll("form[data-starts-task] button, form[action$='/approve'] button, form[action$='/sign'] button").forEach(function (b) { b.disabled = on; });
  };
  function follow() {
    if (!card || card.getAttribute("data-open") !== "true") return;
    lockForms(true);
    var started = Date.now();
    var poll = function () {
      if (gen !== generation) return;
      fetch("/common/migration/task", { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
        .then(function (r) {
          if (!r.ok || (r.headers.get("content-type") || "").indexOf("json") === -1) throw new Error("reload");
          return r.json();
        })
        .then(function (body) {
          var t = body && body.task;
          if (!t) throw new Error("reload");
          var bar = card.querySelector("[data-task-bar]");
          if (bar) { bar.style.width = Math.max(3, t.percent) + "%"; bar.parentNode.setAttribute("aria-valuenow", t.percent); }
          setText(card.querySelector("[data-task-step]"), t.step ? t.step + (t.total ? ": " + Number(t.done).toLocaleString("en-US") + " of " + Number(t.total).toLocaleString("en-US") : "") : "Getting ready");
          setText(card.querySelector("[data-task-meta]"), t.status === "queued" ? (t.ahead ? "Waiting its turn (" + t.ahead + " ahead)" : "Starting…") : (t.phases > 1 ? "Step " + t.phase + " of " + t.phases + " · " : "") + fmtSecs(t.seconds));
          if (gen !== generation) return;
          if (!t.open) { forget(); go(body.next || window.location.pathname + window.location.search, false); return; }
          setTimeout(poll, Date.now() - started > 60000 ? 3000 : 1200);
        })
        .catch(function () { window.location.reload(); });
    };
    setTimeout(poll, 1000);
  }
  follow();

  // ── Uploads ──
  root.querySelectorAll("form[data-upload]").forEach(function (form) {
    var input = form.querySelector("input[type=file]");
    var drop = form.querySelector("[data-drop]");
    var picked = form.querySelector("[data-picked]");
    var sending = form.querySelector("[data-sending]");
    var errorBox = form.querySelector("[data-upload-error]");
    var maxBytes = Number(form.getAttribute("data-max-mb") || 60) * 1048576;
    var maxFiles = Number(form.getAttribute("data-max-files") || 20);
    var showError = function (text) { errorBox.textContent = text || ""; errorBox.hidden = !text; };

    var list = function () {
      var files = Array.prototype.slice.call(input.files || []);
      picked.innerHTML = "";
      picked.hidden = !files.length;
      var problem = "";
      files.forEach(function (f) {
        var li = document.createElement("li");
        var name = document.createElement("span");
        name.textContent = f.name;
        var size = document.createElement("small");
        size.textContent = fmtSize(f.size);
        li.appendChild(name);
        li.appendChild(size);
        if (f.size > maxBytes) { li.className = "is-bad"; problem = f.name + " is larger than " + fmtSize(maxBytes) + ": export it in parts."; }
        picked.appendChild(li);
      });
      if (files.length > maxFiles) problem = "Up to " + maxFiles + " files at a time.";
      showError(problem);
      return !problem;
    };
    input.addEventListener("change", list);
    ["dragenter", "dragover"].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      input.files = e.dataTransfer.files;
      list();
    });

    form.addEventListener("submit", function (e) {
      if (!window.FormData || !window.XMLHttpRequest) return;
      e.preventDefault();
      if (!input.files || !input.files.length) { showError("Choose the files to upload."); return; }
      if (!list()) return;
      var data = new FormData(form);
      var total = Array.prototype.reduce.call(input.files, function (sum, f) { return sum + f.size; }, 0);
      var bar = sending.querySelector("[data-sending-bar]");
      var text = sending.querySelector("[data-sending-text]");
      var button = form.querySelector("button[type=submit]");
      sending.hidden = false;
      button.disabled = true;
      showError("");
      var xhr = new XMLHttpRequest();
      var waiting = null;
      var reloadSoon = function () { clearTimeout(waiting); window.location.reload(); };
      xhr.open("POST", form.getAttribute("action"));
      xhr.setRequestHeader("Accept", "application/json");
      xhr.timeout = 180000;
      // Sent: if the answer is slow, the page itself shows where the upload got to.
      xhr.upload.onload = function () {
        bar.style.width = "100%";
        text.textContent = "Uploaded. Saving…";
        waiting = setTimeout(reloadSoon, 30000);
      };
      xhr.ontimeout = reloadSoon;
      xhr.upload.onprogress = function (ev) {
        var sent = ev.lengthComputable ? ev.loaded : 0;
        var pct = total ? Math.min(100, Math.round((sent / (ev.total || total)) * 100)) : 0;
        bar.style.width = Math.max(3, pct) + "%";
        text.textContent = pct >= 100 ? "Uploaded. Saving…" : "Uploading " + pct + "% (" + fmtSize(sent) + " of " + fmtSize(ev.total || total) + ")";
      };
      xhr.onload = function () {
        clearTimeout(waiting);
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (_e) { body = null; }
        if (xhr.status === 200 && body && body.ok) { forget(); go(body.next || window.location.pathname + window.location.search, false); return; }
        if (!body) { window.location.reload(); return; }
        sending.hidden = true;
        button.disabled = false;
        showError([body.error].concat(body.refused || []).filter(Boolean).join(" "));
      };
      xhr.onerror = function () {
        clearTimeout(waiting);
        sending.hidden = true;
        button.disabled = false;
        showError("The upload didn't reach Managira. Check your connection and try again.");
      };
      xhr.send(data);
    });
  });
  }

  // ── Moving between steps without reloading the page ──
  // A step is fetched once, when it's opened or pointed at, and kept: opening it again shows it at
  // once (refreshed quietly when older than two minutes, swapped in only if something changed and
  // nobody is typing). Nothing is fetched ahead on its own. Anything saved (a form, an upload, a
  // finished task) drops the kept copies. Links outside the migration open as usual; the back
  // button still works.
  var cache = {};
  var inflight = {};
  var shown = null; // the step on screen, as it came from the server (before anything ran on it)
  var era = 0; // anything saved starts a new era: copies fetched before it aren't kept
  var here = function () { return window.location.pathname + window.location.search; };
  var migrationUrl = function (href) {
    try {
      var u = new URL(href, window.location.href);
      return u.origin === window.location.origin && u.pathname === "/common/migration" ? u.pathname + u.search : null;
    } catch (_e) { return null; }
  };
  var fetchPage = function (url, options) {
    return fetch(url, Object.assign({ credentials: "same-origin", headers: { accept: "text/html" }, cache: "no-store" }, options || {}));
  };
  function load(url) {
    if (inflight[url]) return inflight[url];
    var asked = era;
    var p = fetchPage(url)
      .then(function (r) {
        var landed = r.ok && migrationUrl(r.url);
        if (!landed) return Promise.reject(r.url);
        return r.text().then(function (html) { if (landed === url && asked === era) cache[url] = { html: html, at: Date.now() }; return html; });
      });
    inflight[url] = p;
    var done = function () { if (inflight[url] === p) delete inflight[url]; };
    p.then(done, done);
    return p;
  }
  function forget() { era += 1; cache = {}; inflight = {}; }
  // The step's part of a page, as the server sent it (a kept copy without its one-time messages).
  function stepOf(html, quiet) {
    var fresh = new DOMParser().parseFromString(html, "text/html").querySelector(".mg");
    if (fresh && quiet) fresh.querySelectorAll(".flash-message, .flash-container").forEach(function (el) { el.remove(); });
    return fresh;
  }
  // Someone mid-way through something on the step: a field in use, an upload going, a box open.
  function busy(root) {
    var active = document.activeElement;
    if (active && root.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
    if (root.querySelector("[data-sending]:not([hidden])")) return true;
    if (root.querySelector("[data-picked]:not([hidden])")) return true;
    return false;
  }
  function show(html, url, push, quiet) {
    var fresh = stepOf(html, quiet);
    var current = document.querySelector(".mg");
    if (!fresh || !current) return false;
    if (quiet) {
      // A kept copy keeps the sections someone opened.
      var open = {};
      current.querySelectorAll("details").forEach(function (d) { var k = d.querySelector("summary"); if (k) open[k.textContent.trim()] = d.open; });
      fresh.querySelectorAll("details").forEach(function (d) { var k = d.querySelector("summary"); if (k && Object.prototype.hasOwnProperty.call(open, k.textContent.trim())) d.open = open[k.textContent.trim()]; });
    }
    shown = fresh.outerHTML;
    current.replaceWith(fresh);
    if (url) window.history[push ? "pushState" : "replaceState"]({ migration: true }, "", url);
    if (!quiet || push) window.scrollTo(0, 0);
    init(fresh);
    // The app's loading bar (public/js/pageLoading.js) is for leaving the page: a step shown here is done.
    if (window.ManagiraLoading) window.ManagiraLoading.stop();
    return true;
  }
  // A step on screen, brought up to date in the background.
  function refresh(url) {
    load(url).then(function (html) {
      var current = document.querySelector(".mg");
      var fresh = stepOf(html, true);
      if (here() !== url || !fresh || fresh.outerHTML === shown || !current || busy(current)) return;
      var y = window.scrollY;
      show(html, null, false, true);
      window.scrollTo(0, y);
    }).catch(function () {});
  }
  function go(url, push) {
    var hit = cache[url];
    if (hit) {
      show(hit.html, url, push, true);
      if (Date.now() - hit.at > 120000) refresh(url); // saving anything already drops the kept copies
      return;
    }
    var current = document.querySelector(".mg");
    if (current) current.classList.add("is-loading");
    load(url)
      .then(function (html) { if (!show(html, url, push)) window.location.href = url; })
      .catch(function (where) { window.location.href = typeof where === "string" && where ? where : url; });
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.target === "_top" || a.hasAttribute("download") || a.hasAttribute("data-no-spa")) return;
    var url = migrationUrl(a.getAttribute("href"));
    if (!url) return;
    e.preventDefault();
    if (url === here()) { refresh(url); return; }
    go(url, true);
  }, true); // before the app's own link handling, so its loading bar never starts for a step
  // A step tab the pointer rests on (not just passes over) is fetched, so it opens at once.
  var resting = null;
  document.addEventListener("mouseover", function (e) {
    var a = e.target.closest && e.target.closest("a.mg-step[href]");
    clearTimeout(resting);
    if (!a) return;
    var url = migrationUrl(a.getAttribute("href"));
    if (!url || url === here() || cache[url] || inflight[url]) return;
    resting = setTimeout(function () { load(url).catch(function () {}); }, 150);
  });
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (e.defaultPrevented || !form || !form.matches || form.matches("[data-upload]") || form.target === "_blank") return;
    var action = form.getAttribute("action") || "";
    if ((form.getAttribute("method") || "get").toLowerCase() !== "post" || !/^\/common\/migration(\/|\?|$)/.test(action)) return;
    e.preventDefault();
    var data = new URLSearchParams(new FormData(form));
    if (e.submitter && e.submitter.name) data.append(e.submitter.name, e.submitter.value);
    var current = document.querySelector(".mg");
    if (current) current.classList.add("is-loading");
    forget();
    fetchPage(action, { method: "POST", body: data, headers: { accept: "text/html", "content-type": "application/x-www-form-urlencoded" } })
      .then(function (r) {
        var url = migrationUrl(r.url);
        if (!r.ok || !url) { window.location.href = r.url || action; return; }
        return r.text().then(function (html) { if (!show(html, url, true)) window.location.href = url; });
      })
      .catch(function () { form.submit(); });
  });
  window.addEventListener("popstate", function () {
    var url = migrationUrl(window.location.href);
    if (url) go(url, false);
  });
  // Coming back to the page (the browser's back button), nothing is left looking busy.
  window.addEventListener("pageshow", function () {
    document.querySelectorAll(".mg [data-sending]").forEach(function (el) { el.hidden = true; });
    document.querySelectorAll(".mg form[data-upload] button[type=submit]").forEach(function (b) { b.disabled = false; });
  });

  // The step the page opened on is kept too (as the server sent it, before anything ran on it).
  var first = document.querySelector(".mg");
  if (first && migrationUrl(window.location.href)) cache[here()] = { html: first.outerHTML, at: Date.now() };
  init(first);
})();
