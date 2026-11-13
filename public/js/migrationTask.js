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
  // Files or a whole folder (chosen or dropped), kept in a list with a remove button beside each,
  // sent in batches one after another (any number of files) with one progress bar; Stop keeps
  // what's left. Each file keeps its folder path, so a student's documents still find them.
  root.querySelectorAll("form[data-upload]").forEach(function (form) {
    var pickFiles = form.querySelector("[data-pick-files]");
    var pickFolder = form.querySelector("[data-pick-folder]");
    var drop = form.querySelector("[data-drop]");
    var box = form.querySelector("[data-picked]");
    var listEl = form.querySelector("[data-picked-list]");
    var summary = form.querySelector("[data-picked-summary]");
    var toggle = form.querySelector("[data-picked-toggle]");
    var sending = form.querySelector("[data-sending]");
    var errorBox = form.querySelector("[data-upload-error]");
    var maxBytes = Number(form.getAttribute("data-max-mb") || 60) * 1048576;
    var perBatch = Number(form.getAttribute("data-max-files") || 50);
    var BATCH_BYTES = 80 * 1048576;
    var SHOWN = 12;
    var picked = [];
    var showAll = false;
    var current = null; // the request on its way, for Stop
    var stopped = false;
    var showError = function (text) { errorBox.textContent = text || ""; errorBox.hidden = !text; };
    if (pickFolder && "webkitdirectory" in pickFolder) form.querySelector("[data-folder-choice]").hidden = false;
    if (pickFiles) pickFiles.removeAttribute("name"); // the script sends them, in batches
    var isList = function (name) { return /\.(csv|tsv|txt|tab|xlsx|xls|zip)$/i.test(name); };
    var pathOf = function (f, given) { return String(given || f.webkitRelativePath || f.name).replace(/\\/g, "/").replace(/^\/+/, ""); };
    var hidden = function (path) { return path.split("/").some(function (part) { return part.charAt(0) === "." || part === "__MACOSX"; }); };

    // A file chosen again (same path, size and date) isn't listed twice; files chosen together all
    // count, even when two have the same name (each student's birth certificate).
    function add(entries) {
      var key = function (path, f) { return path + "|" + f.size + "|" + (f.lastModified || 0); };
      var before = {};
      picked.forEach(function (p) { before[key(p.path, p.file)] = true; });
      entries.forEach(function (e) {
        var path = pathOf(e.file, e.path);
        if (hidden(path) || before[key(path, e.file)]) return;
        picked.push({ file: e.file, path: path });
      });
      render();
    }
    function render() {
      box.hidden = !picked.length;
      listEl.innerHTML = "";
      if (!picked.length) { showError(""); return; }
      var bytes = 0, lists = 0, big = 0;
      picked.forEach(function (p) { bytes += p.file.size; if (isList(p.path)) lists += 1; if (p.file.size > maxBytes) big += 1; });
      // One folder chosen: its name once, at the top, and each file shown inside it.
      var tops = {};
      picked.forEach(function (p) { tops[p.path.indexOf("/") > 0 ? p.path.split("/")[0] : ""] = true; });
      var folder = Object.keys(tops).length === 1 && Object.keys(tops)[0] ? Object.keys(tops)[0] : "";
      var shown = function (p) { return folder ? p.path.slice(folder.length + 1) : p.path; };
      summary.textContent = (folder ? folder + " · " : "") + picked.length.toLocaleString("en-US") + (picked.length === 1 ? " file" : " files") + " · " + fmtSize(bytes) + " · " +
        lists.toLocaleString("en-US") + (lists === 1 ? " list" : " lists") + " · " + (picked.length - lists).toLocaleString("en-US") + (picked.length - lists === 1 ? " document" : " documents");
      var rows = showAll ? picked : picked.slice(0, SHOWN);
      rows.forEach(function (p) {
        var li = document.createElement("li");
        if (p.file.size > maxBytes) li.className = "is-bad";
        var name = document.createElement("span");
        name.textContent = shown(p);
        name.title = p.path;
        var size = document.createElement("small");
        size.textContent = fmtSize(p.file.size);
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "mg-picked__remove";
        remove.setAttribute("aria-label", "Remove " + p.path);
        remove.textContent = "×";
        remove.addEventListener("click", function () { picked.splice(picked.indexOf(p), 1); render(); });
        li.appendChild(name);
        li.appendChild(size);
        li.appendChild(remove);
        listEl.appendChild(li);
      });
      toggle.hidden = picked.length <= SHOWN;
      toggle.textContent = showAll ? "Show fewer" : "Show all " + picked.length.toLocaleString("en-US");
      showError(big ? (big === 1 ? "One file is" : big + " files are") + " larger than " + fmtSize(maxBytes) + ": remove " + (big === 1 ? "it" : "them") + " (marked in red) or export " + (big === 1 ? "it" : "them") + " in parts." : "");
    }
    toggle.addEventListener("click", function () { showAll = !showAll; render(); });
    form.querySelector("[data-picked-clear]").addEventListener("click", function () { picked = []; showAll = false; render(); });
    [pickFiles, pickFolder].forEach(function (input) {
      if (!input) return;
      input.addEventListener("change", function () {
        add(Array.prototype.map.call(input.files || [], function (f) { return { file: f }; }));
        input.value = "";
      });
    });

    // A dropped folder is read through, folder by folder.
    function readEntry(entry, out) {
      return new Promise(function (resolve) {
        if (entry.isFile) { entry.file(function (f) { out.push({ file: f, path: entry.fullPath }); resolve(); }, function () { resolve(); }); return; }
        if (!entry.isDirectory) { resolve(); return; }
        var reader = entry.createReader();
        var all = [];
        var more = function () {
          reader.readEntries(function (batch) {
            if (!batch.length) { Promise.all(all.map(function (e) { return readEntry(e, out); })).then(resolve); return; }
            all = all.concat(Array.prototype.slice.call(batch));
            more();
          }, function () { resolve(); });
        };
        more();
      });
    }
    ["dragenter", "dragover"].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      var items = Array.prototype.slice.call(dt.items || []).map(function (i) { return i.webkitGetAsEntry ? i.webkitGetAsEntry() : null; }).filter(Boolean);
      if (items.length) {
        var out = [];
        Promise.all(items.map(function (entry) { return readEntry(entry, out); })).then(function () { add(out); });
        return;
      }
      add(Array.prototype.map.call(dt.files || [], function (f) { return { file: f }; }));
    });

    // Batches of up to `perBatch` files and about 80 MB, one after another.
    function batches(list) {
      var out = [], now = [], size = 0;
      list.forEach(function (p) {
        if (now.length && (now.length >= perBatch || size + p.file.size > BATCH_BYTES)) { out.push(now); now = []; size = 0; }
        now.push(p);
        size += p.file.size;
      });
      if (now.length) out.push(now);
      return out;
    }
    form.querySelector("[data-sending-stop]").addEventListener("click", function () { stopped = true; if (current) current.abort(); });

    form.addEventListener("submit", function (e) {
      if (!window.FormData || !window.XMLHttpRequest) return;
      e.preventDefault();
      if (!picked.length) { showError("Choose the files or the folder to upload."); return; }
      if (picked.some(function (p) { return p.file.size > maxBytes; })) { render(); return; }
      var entity = form.querySelector("select[name=entity]");
      var parts = batches(picked.slice());
      var total = picked.reduce(function (sum, p) { return sum + p.file.size; }, 0);
      var totalFiles = picked.length;
      var bar = sending.querySelector("[data-sending-bar]");
      var text = sending.querySelector("[data-sending-text]");
      var button = form.querySelector("button[type=submit]");
      var doneBytes = 0, doneFiles = 0, next = null, refused = [];
      // One group for everything chosen together: its lists are read as one upload.
      var group = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      sending.hidden = false;
      button.disabled = true;
      stopped = false;
      showError("");
      var finish = function (problem) {
        current = null;
        sending.hidden = true;
        button.disabled = false;
        render();
        if (problem) showError(problem);
      };
      var send = function (index) {
        if (index >= parts.length) {
          bar.style.width = "100%";
          text.textContent = "Uploaded " + totalFiles.toLocaleString("en-US") + " files. Managira is reading them in the background: you don't need to wait.";
          forget();
          if (refused.length) showError(refused.join(" "));
          go(next || window.location.pathname + window.location.search, false);
          return;
        }
        if (stopped) { finish(doneFiles ? "Stopped after " + doneFiles.toLocaleString("en-US") + " files: they're being read. The rest are still listed: upload them when you're ready." : "Stopped. Nothing was sent."); return; }
        var part = parts[index];
        var data = new FormData();
        if (entity && entity.value) data.append("entity", entity.value);
        data.append("group", group);
        part.forEach(function (p) { data.append("files", p.file, p.path); });
        var xhr = new XMLHttpRequest();
        current = xhr;
        xhr.open("POST", form.getAttribute("action"));
        xhr.setRequestHeader("Accept", "application/json");
        xhr.timeout = 300000;
        xhr.upload.onprogress = function (ev) {
          var sent = doneBytes + (ev.lengthComputable ? ev.loaded : 0);
          var pct = total ? Math.min(99, Math.round((sent / total) * 100)) : 0;
          bar.style.width = Math.max(3, pct) + "%";
          text.textContent = "Uploading " + pct + "% · " + Math.min(totalFiles, doneFiles + part.length).toLocaleString("en-US") + " of " + totalFiles.toLocaleString("en-US") + " files (" + fmtSize(sent) + " of " + fmtSize(total) + ")";
        };
        xhr.onload = function () {
          var body = null;
          try { body = JSON.parse(xhr.responseText); } catch (_e) { body = null; }
          if (xhr.status !== 200 || !body || !body.ok) { finish((body && [body.error].concat(body.refused || []).filter(Boolean).join(" ")) || "The upload stopped. What's still listed wasn't sent: try again."); return; }
          // Sent: off the list, so a retry or Stop never sends it twice.
          part.forEach(function (p) { var i = picked.indexOf(p); if (i >= 0) picked.splice(i, 1); });
          doneBytes += part.reduce(function (sum, p) { return sum + p.file.size; }, 0);
          doneFiles += part.length;
          refused = refused.concat(body.refused || []);
          next = body.next || next;
          send(index + 1);
        };
        xhr.onabort = function () { finish(doneFiles ? "Stopped after " + doneFiles.toLocaleString("en-US") + " files: they're being read. The rest are still listed." : "Stopped. Nothing was sent."); };
        xhr.onerror = xhr.ontimeout = function () { finish("The upload didn't reach Managira. What's still listed wasn't sent: check your connection and try again."); };
        xhr.send(data);
      };
      send(0);
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
  // Saving (Save, Confirm, Approve, Use, Remove…): sent in the background. Only the button pressed
  // shows it's working; the page stays where it is and is brought up to date in place, with what
  // the server said as a small message. A step change (signing, going live) opens that step.
  function toast(text, bad) {
    if (!text) return;
    var el = document.getElementById("mgToast");
    if (!el) { el = document.createElement("div"); el.id = "mgToast"; el.className = "mg-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = text;
    el.classList.toggle("is-bad", Boolean(bad));
    el.classList.add("is-on");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("is-on"); }, bad ? 6000 : 3200);
  }
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (e.defaultPrevented || !form || !form.matches || form.matches("[data-upload]") || form.target === "_blank") return;
    var action = form.getAttribute("action") || "";
    if ((form.getAttribute("method") || "get").toLowerCase() !== "post" || !/^\/common\/migration(\/|\?|$)/.test(action)) return;
    e.preventDefault();
    if (window.ManagiraLoading) window.ManagiraLoading.stop(); // nothing leaves the page
    if (form.dataset.sending === "1") return;
    form.dataset.sending = "1";
    var data = new URLSearchParams(new FormData(form));
    if (e.submitter && e.submitter.name) data.append(e.submitter.name, e.submitter.value);
    var button = e.submitter || form.querySelector("button[type=submit], button:not([type])");
    var label = button ? button.innerHTML : "";
    if (button) { button.disabled = true; button.classList.add("is-busy"); button.textContent = "Saving…"; }
    var restore = function () { form.dataset.sending = ""; if (button && document.contains(button)) { button.disabled = false; button.classList.remove("is-busy"); button.innerHTML = label; } };
    forget();
    var from = here();
    fetchPage(action, { method: "POST", body: data, headers: { accept: "text/html", "content-type": "application/x-www-form-urlencoded" } })
      .then(function (r) {
        var url = migrationUrl(r.url);
        if (!r.ok || !url) { window.location.href = r.url || action; return; }
        return r.text().then(function (html) {
          var fresh = new DOMParser().parseFromString(html, "text/html");
          var said = fresh.querySelector(".mg .flash-message");
          var bad = said && /error/.test(said.className);
          var text = said ? (said.querySelector(".flash-content") || said).textContent.trim() : "";
          var y = window.scrollY;
          if (url === from) {
            if (!show(html, null, false, true)) { window.location.href = url; return; }
            window.scrollTo(0, y);
          } else if (!show(html, url, true)) { window.location.href = url; return; }
          toast(text || "Saved", bad);
        });
      })
      .catch(function () { restore(); toast("That didn't save. Check your connection and try again.", true); });
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
