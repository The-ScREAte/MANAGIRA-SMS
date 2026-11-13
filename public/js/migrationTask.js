// Data migration: follows the school's background task (views/migration/partials/task.ejs) and
// sends uploads with a progress bar (views/migration/partials/upload.ejs). Everything here is an
// improvement on plain forms, which work without it.
(function () {
  "use strict";
  var root = document.querySelector(".mg");
  if (!root) return;

  var fmtSize = function (bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  };
  var fmtSecs = function (n) { return n < 60 ? n + " s" : Math.floor(n / 60) + " min " + String(n % 60).padStart(2, "0") + " s"; };
  var setText = function (el, text) { if (el) el.textContent = text; };

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
          if (!t.open) { window.location.href = body.next || window.location.href; return; }
          setTimeout(poll, Date.now() - started > 60000 ? 3000 : 1200);
        })
        .catch(function () { window.location.reload(); });
    };
    setTimeout(poll, 1000);
  }
  follow();

  // ── Uploads ──
  // Coming back to the page (the browser's back button), nothing is left looking busy.
  window.addEventListener("pageshow", function () {
    root.querySelectorAll("[data-sending]").forEach(function (el) { el.hidden = true; });
    root.querySelectorAll("form[data-upload] button[type=submit]").forEach(function (b) { b.disabled = false; });
  });
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
        if (xhr.status === 200 && body && body.ok) { window.location.href = body.next || window.location.href; return; }
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
})();
