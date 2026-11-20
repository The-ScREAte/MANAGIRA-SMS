// Notifications › Alerts: what a person is told about and how (feature alert_rules,
// routes/alertRulesRoute.js). Mount with <div data-alert-rules></div> (add data-student-id on a child's
// page). Each alert is a row with a small switch, like Class settings. Nothing saves on its own:
// one Save button under the whole Notifications section (<div data-ns-savebar>) saves the alerts and
// the emails together, and stays off until something changes.
// Everything the server sends goes in with textContent.
// Also: any <form data-ns-form> (the emails list) is saved by that same button.
(function () {
  var CHANNEL_NAMES = { bell: "In Managira", email: "Email", sms: "Text message", digest: "Weekly briefing" };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function makeSwitch(checked, label) {
    var wrap = el("label", "ns-switch");
    var input = el("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = checked;
    if (label) input.setAttribute("aria-label", label);
    wrap.appendChild(input);
    wrap.appendChild(el("span", "ns-track"));
    return { wrap: wrap, input: input };
  }
  function savedNote(box) {
    var note = box.querySelector(".ns-status");
    if (!note) { note = el("span", "ns-status"); note.setAttribute("role", "status"); box.appendChild(note); }
    return note;
  }
  function flash(note, text, bad) {
    note.textContent = text;
    note.classList.toggle("is-bad", Boolean(bad));
    clearTimeout(note._t);
    if (!bad && text) note._t = setTimeout(function () { note.textContent = ""; }, 2000);
  }
  function query(root) { return root.dataset.studentId ? "?studentId=" + encodeURIComponent(root.dataset.studentId) : ""; }

  function draw(root, data) {
    var scrollKeep = root.contains(document.activeElement) ? document.activeElement : null;
    root.textContent = "";
    var form = el("div", "ns");
    var same = null;
    if (data.studentId) {
      var top = el("div", "ns-row ns-same");
      var copy = el("div", "ns-copy");
      copy.appendChild(el("strong", "", "Use my alerts for all my children"));
      copy.appendChild(el("span", "", "Turn off to choose alerts for this child alone."));
      var s = makeSwitch(!data.custom, "Use my alerts for all my children");
      same = s.input;
      var main = el("div", "ns-main");
      main.appendChild(copy);
      main.appendChild(s.wrap);
      top.appendChild(main);
      form.appendChild(top);
    }
    var list = el("div", "ns-list");
    var groups = [];
    data.alerts.forEach(function (alert) { if (groups.indexOf(alert.group) === -1) groups.push(alert.group); });
    groups.forEach(function (group) {
      var section = el("section", "ns-group");
      section.appendChild(el("h3", "ns-group__title", group));
      var rows = el("div", "ns-rows");
      data.alerts.filter(function (a) { return a.group === group; }).forEach(function (alert, index) {
        var row = el("div", "ns-row ns-" + alert.tone);
        row.dataset.kind = alert.kind;
        var main = el("div", "ns-main");
        var copy = el("div", "ns-copy");
        copy.appendChild(el("strong", "", alert.name));
        copy.appendChild(el("span", "", alert.hint));
        var sw = makeSwitch(alert.enabled, alert.name);
        sw.input.className = "ns-on";
        main.appendChild(copy);
        main.appendChild(sw.wrap);
        row.appendChild(main);

        var more = el("div", "ns-more");
        if (alert.unit) {
          var field = el("label", "ns-threshold");
          field.appendChild(el("span", "", alert.tone === "improve" ? "Below" : "At or above"));
          var number = el("input", "ns-number");
          number.type = "number"; number.min = alert.min; number.max = alert.max; number.step = "1"; number.inputMode = "numeric";
          number.value = alert.threshold;
          field.appendChild(number);
          field.appendChild(el("span", "", alert.unit));
          more.appendChild(field);
        }
        var chips = el("div", "ns-chips");
        chips.setAttribute("role", "group");
        chips.setAttribute("aria-label", "How to tell you");
        alert.offered.forEach(function (channel) {
          var chip = el("label", "ns-chip");
          var box = el("input");
          box.type = "checkbox"; box.value = channel; box.checked = alert.channels.indexOf(channel) !== -1;
          chip.appendChild(box);
          chip.appendChild(el("span", "", CHANNEL_NAMES[channel]));
          chips.appendChild(chip);
        });
        more.appendChild(chips);
        row.appendChild(more);
        var sync = function () { row.classList.toggle("is-off", !sw.input.checked); more.hidden = !sw.input.checked; };
        sw.input.addEventListener("change", sync);
        sync();
        rows.appendChild(row);
      });
      section.appendChild(rows);
      list.appendChild(section);
    });
    form.appendChild(list);

    var notes = [];
    if (!data.available.sms) notes.push("Text messages appear once your school sets them up.");
    if (notes.length) form.appendChild(el("p", "ns-note", notes.join(" ")));
    root.appendChild(form);

    var syncSame = function () {
      form.classList.toggle("is-same", Boolean(same && same.checked));
      list.querySelectorAll("input").forEach(function (box) { box.disabled = Boolean(same && same.checked); });
    };
    syncSame();

    // The one Save button asks each part of its section to save: this part sends the alerts.
    root._nsSave = function () {
      var payload = { alerts: {}, same: Boolean(same && same.checked) };
      list.querySelectorAll(".ns-row").forEach(function (row) {
        var entry = { enabled: row.querySelector(".ns-on").checked, channels: [] };
        var number = row.querySelector(".ns-number");
        if (number) entry.threshold = number.value;
        row.querySelectorAll(".ns-chip input:checked").forEach(function (box) { entry.channels.push(box.value); });
        payload.alerts[row.dataset.kind] = entry;
      });
      return fetch("/alerts/save" + query(root), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      }).then(function (r) { return r.json(); }).then(function (result) {
        if (!result.success) throw new Error(result.message || "Could not save your alerts.");
        // Switching a child between "all" and their own redraws so the right values show.
        if (same && result.custom !== !same.checked) draw(root, result);
      });
    };
    form.addEventListener("change", function (event) {
      if (event.target === same) syncSame();
      changed(root);
    });
    if (scrollKeep && scrollKeep.focus) { /* keep the page where it is */ }
  }

  function mount(root) {
    root.setAttribute("aria-busy", "true");
    fetch("/alerts/data" + query(root), { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        root.removeAttribute("aria-busy");
        if (data.off) {
          var card = root.closest("[data-alert-rules-wrap]") || root.closest("[data-alert-card]");
          (card || root).hidden = true;
          return;
        }
        if (!data.success) { root.textContent = data.message || "Alerts could not load. Refresh to try again."; return; }
        // Nothing offered (the school keeps every alert from this person): hide the section.
        if (!data.alerts.length) { var none = root.closest("[data-alert-rules-wrap]") || root.closest("[data-alert-card]") || root; none.hidden = true; return; }
        draw(root, data);
      })
      .catch(function () { root.removeAttribute("aria-busy"); root.textContent = "Alerts could not load. Refresh to try again."; });
  }

  // A change anywhere in a section wakes that section's Save button.
  function scopeOf(node) { return node.closest("[data-ns-scope]"); }
  function changed(node) {
    var scope = scopeOf(node);
    var bar = scope && scope.querySelector("[data-ns-savebar]");
    if (!bar) return;
    bar.querySelector(".ns-save").disabled = false;
    flash(bar.querySelector(".ns-status"), "");
  }
  // The emails list: its switches are saved by the section's Save button.
  function emailForm(form) {
    form._nsSave = function () {
      return fetch(form.action, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(new FormData(form)) })
        .then(function (r) { if (!r.ok) throw new Error("Could not save your email choices."); });
    };
    form.addEventListener("change", function () { changed(form); });
    form.addEventListener("submit", function (event) { event.preventDefault(); });
  }
  function saveBar(bar) {
    var scope = scopeOf(bar);
    var button = bar.querySelector(".ns-save");
    var note = bar.querySelector(".ns-status");
    button.disabled = true;
    button.addEventListener("click", function () {
      var parts = [].slice.call(scope.querySelectorAll("[data-alert-rules], form[data-ns-form]")).filter(function (node) { return node._nsSave; });
      if (!parts.length) return;
      button.disabled = true;
      flash(note, "Saving…");
      Promise.all(parts.map(function (node) { return node._nsSave(); }))
        .then(function () { flash(note, "Saved"); })
        .catch(function (error) { button.disabled = false; flash(note, error.message || "Could not save. Try again.", true); });
    });
  }

  function start() {
    document.querySelectorAll("[data-alert-rules]").forEach(function (root) { if (!root.dataset.ready) { root.dataset.ready = "1"; mount(root); } });
    document.querySelectorAll("form[data-ns-form]").forEach(function (form) { if (!form.dataset.ready) { form.dataset.ready = "1"; emailForm(form); } });
    document.querySelectorAll("[data-ns-savebar]").forEach(function (bar) { if (!bar.dataset.ready) { bar.dataset.ready = "1"; saveBar(bar); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  document.addEventListener("managira:page-ready", start);
})();
