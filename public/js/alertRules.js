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
  // The columns of a Notifications section: the fixed channel columns the alerts use, and the one the
  // emails list below them sits in (Email).
  function setColumns(scope, cols) {
    scope.style.setProperty("--ns-n", String(Math.max(1, cols.length)));
    var at = cols.indexOf("email");
    scope.querySelectorAll("form[data-ns-form] .ns-switch").forEach(function (sw) { sw.style.gridColumn = String((at === -1 ? 0 : at) + 2); });
  }
  function query(root) { return root.dataset.studentId ? "?studentId=" + encodeURIComponent(root.dataset.studentId) : ""; }

  function draw(root, data) {
    var scrollKeep = root.contains(document.activeElement) ? document.activeElement : null;
    root.textContent = "";
    var form = el("div", "ns");
    var same = null;
    if (data.studentId) {
      var top = el("div", "ns-row ns-same");
      var main = el("div", "ns-main");
      main.appendChild(el("strong", "ns-name", "Use my alerts for all my children"));
      var s = makeSwitch(!data.custom, "Use my alerts for all my children");
      same = s.input;
      main.appendChild(s.wrap);
      top.appendChild(main);
      form.appendChild(top);
    }
    var list = el("div", "ns-list");
    var locked = data.locked || [];
    // The columns: every way any of these alerts can reach someone, in one fixed order (the Emails
    // below line up under their Email column). Headings once, at the top.
    var scope = root.closest("[data-ns-scope]");
    var order = ["bell", "email", "sms", "digest"];
    var cols = order.filter(function (c) { return data.alerts.some(function (a) { return a.offered.indexOf(c) !== -1; }); });
    if (scope && scope.querySelector("form[data-ns-form]") && cols.indexOf("email") === -1) { cols.push("email"); cols.sort(function (x, y) { return order.indexOf(x) - order.indexOf(y); }); }
    setColumns(scope || form, cols);
    var head = el("div", "ns-row ns-colhead");
    var headMain = el("div", "ns-main");
    headMain.appendChild(el("span", "ns-name"));
    cols.forEach(function (c) { headMain.appendChild(el("span", "ns-cell", CHANNEL_NAMES[c])); });
    head.appendChild(headMain);
    list.appendChild(head);
    var groups = [];
    data.alerts.concat(locked).forEach(function (alert) { if (groups.indexOf(alert.group) === -1) groups.push(alert.group); });
    groups.forEach(function (group) {
      var section = el("section", "ns-group");
      section.appendChild(el("h3", "ns-group__title", group));
      var rows = el("div", "ns-rows");
      data.alerts.filter(function (a) { return a.group === group; }).forEach(function (alert) {
        // One line: the name (and its percentage), then a switch under each way to be told. Nothing on = off.
        var row = el("div", "ns-row ns-" + alert.tone);
        row.dataset.kind = alert.kind;
        var main = el("div", "ns-main");
        var name = el("div", "ns-name");
        name.appendChild(el("strong", "", alert.name));
        if (alert.unit) {
          var field = el("label", "ns-threshold");
          field.appendChild(el("span", "", alert.tone === "improve" ? "below" : "at or above"));
          var number = el("input", "ns-number");
          number.type = "number"; number.min = alert.min; number.max = alert.max; number.step = "1"; number.inputMode = "numeric";
          number.value = alert.threshold;
          number.setAttribute("aria-label", alert.name + " percentage");
          field.appendChild(number);
          field.appendChild(el("span", "", alert.unit));
          name.appendChild(field);
        }
        main.appendChild(name);
        cols.forEach(function (channel) {
          if (alert.offered.indexOf(channel) === -1) { main.appendChild(el("span", "ns-cell ns-na", "—")); return; }
          var cell = el("span", "ns-cell");
          cell.setAttribute("data-label", CHANNEL_NAMES[channel]);
          var sw = makeSwitch(alert.enabled && alert.channels.indexOf(channel) !== -1, alert.name + ": " + CHANNEL_NAMES[channel]);
          sw.input.value = channel;
          sw.input.className = "ns-ch";
          cell.appendChild(sw.wrap);
          main.appendChild(cell);
        });
        row.appendChild(main);
        rows.appendChild(row);
      });
      // What the school decides for this person: shown, not hidden, and not theirs to change.
      locked.filter(function (a) { return a.group === group; }).forEach(function (alert) {
        var row = el("div", "ns-row ns-locked");
        var main = el("div", "ns-main");
        main.appendChild(el("strong", "ns-name", alert.name));
        main.appendChild(el("span", "ns-lock", "Set by your school"));
        row.appendChild(main);
        rows.appendChild(row);
      });
      section.appendChild(rows);
      list.appendChild(section);
    });
    form.appendChild(list);
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
        if (!row.dataset.kind) return;
        var entry = { enabled: false, channels: [] };
        var number = row.querySelector(".ns-number");
        if (number) entry.threshold = number.value;
        row.querySelectorAll(".ns-ch:checked").forEach(function (box) { entry.channels.push(box.value); });
        entry.enabled = entry.channels.length > 0;
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
    document.querySelectorAll("[data-ns-scope]").forEach(function (scope) { if (!scope.querySelector("[data-alert-rules]")) setColumns(scope, ["email"]); });
    document.querySelectorAll("[data-ns-savebar]").forEach(function (bar) { if (!bar.dataset.ready) { bar.dataset.ready = "1"; saveBar(bar); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  document.addEventListener("managira:page-ready", start);
})();
