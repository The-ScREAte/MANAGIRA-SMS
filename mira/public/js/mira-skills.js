/* Mira skills (feature mira_skills; services/skills.js, routes/skillsRoute.js).
 *  - The Skills window (user menu › Skills): your skills, the school's skills (changed only with
 *    Mira Settings) and the Library of starter skills for school work.
 *  - The star in the message box: pick a skill for the next message (any enabled skill; a
 *    "When picked" skill is only ever used this way).
 *  - window.MiraSkills.takePicked() gives mira-chat.js the picked ids for the message being sent,
 *    and .showUsed(el, list) draws "Following: ..." above an answer.
 * Everything people typed goes in as text.
 */
(function () {
  "use strict";
  var overlay = document.getElementById("miraSkillsOverlay");
  if (!overlay) return;
  var pane = overlay.querySelector("[data-sk-pane]");
  var tabs = overlay.querySelector(".mira-skills-tabs");
  var state = { data: null, tab: "mine", editing: null, loading: null };
  var picked = [];
  var MODES = { auto: "Automatic", always: "Every chat", manual: "When picked" };
  var MODE_SHORT = { auto: "Automatic", always: "Every chat", manual: "When picked" };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function api(url, options) {
    var opts = options || {};
    var init = { method: opts.method || "GET", headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return (window.miraFetch || fetch)(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || "That didn’t work. Try again.");
        return body;
      });
    });
  }
  function load(force) {
    if (state.data && !force) return Promise.resolve(state.data);
    if (state.loading && !force) return state.loading;
    state.loading = api("/api/skills").then(function (data) { state.data = data; state.loading = null; return data; }).catch(function (error) { state.loading = null; throw error; });
    return state.loading;
  }

  // ── The window ────────────────────────────────────────────────────────────────────────
  function open(tab) {
    var menu = document.getElementById("miraUserMenu");
    if (menu) menu.hidden = true;
    overlay.hidden = false;
    setTab(tab || state.tab);
    load(true).then(render).catch(function (error) { showError(error.message); });
  }
  function close() { overlay.hidden = true; state.editing = null; }
  function setTab(name) {
    state.tab = name;
    state.editing = null;
    tabs.querySelectorAll("[data-sk-tab]").forEach(function (b) {
      var on = b.getAttribute("data-sk-tab") === name;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    });
    if (state.data) render();
  }
  function showError(message) { pane.innerHTML = ""; pane.appendChild(el("p", "mira-skills-empty is-error", message)); }

  function render() {
    var data = state.data;
    pane.innerHTML = "";
    if (!data) return;
    if (!data.ready) { pane.appendChild(el("p", "mira-skills-empty", "Skills are being set up for your school. Try again in a little while.")); return; }
    if (state.editing) return renderEditor(state.editing);
    if (state.tab === "library") return renderLibrary();
    var school = state.tab === "school";
    var list = school ? data.school : data.personal;
    var head = el("div", "mira-skills-head");
    head.appendChild(el("p", "mira-skills-sub", school && !data.canManageSchool ? "Set by your school's leaders." : ""));
    if (!school || data.canManageSchool) {
      var add = el("button", "mira-btn mira-btn-primary mira-skills-new", "New skill");
      add.type = "button";
      add.addEventListener("click", function () { state.editing = { scope: school ? "school" : "personal", useMode: "auto" }; render(); });
      head.appendChild(add);
    }
    pane.appendChild(head);
    if (!list.length) {
      var empty = el("div", "mira-skills-blank");
      empty.appendChild(el("strong", null, school ? "No school skills yet" : "No skills yet"));
      empty.appendChild(el("span", null, school && !data.canManageSchool ? "Your school hasn't added any." : "Start from the Library or write your own."));
      var lib = el("button", "mira-btn mira-btn-secondary", "Open the Library");
      lib.type = "button";
      lib.addEventListener("click", function () { setTab("library"); });
      if (!school || data.canManageSchool) empty.appendChild(lib);
      pane.appendChild(empty);
      return;
    }
    var ul = el("ul", "mira-skills-list");
    list.forEach(function (skill) { ul.appendChild(card(skill, !school || data.canManageSchool)); });
    pane.appendChild(ul);
  }

  function card(skill, editable) {
    var li = el("li", "mira-skill" + (skill.enabled ? "" : " is-off"));
    var top = el("div", "mira-skill-top");
    var text = el("div", "mira-skill-text");
    text.appendChild(el("strong", null, skill.name));
    if (skill.description) text.appendChild(el("span", null, skill.description));
    top.appendChild(text);
    if (editable) {
      var toggle = el("label", "mira-skill-switch");
      toggle.title = skill.enabled ? "On: Mira follows it" : "Off: Mira ignores it";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = skill.enabled;
      box.setAttribute("aria-label", (skill.enabled ? "Turn off " : "Turn on ") + skill.name);
      box.addEventListener("change", function () {
        box.disabled = true;
        api("/api/skills/" + skill.id, { method: "PUT", body: { enabled: box.checked } })
          .then(function () { return load(true); }).then(render)
          .catch(function (error) { box.checked = !box.checked; box.disabled = false; window.alert(error.message); });
      });
      toggle.appendChild(box);
      toggle.appendChild(el("span", "mira-skill-slider"));
      top.appendChild(toggle);
    }
    li.appendChild(top);
    var foot = el("div", "mira-skill-foot");
    foot.appendChild(el("span", "mira-skill-mode mode-" + skill.useMode, MODE_SHORT[skill.useMode] || "Automatic"));

    if (editable) {
      var edit = el("button", "mira-skill-link", "Edit");
      edit.type = "button";
      edit.addEventListener("click", function () { state.editing = Object.assign({}, skill); render(); });
      foot.appendChild(edit);
    } else {
      var view = el("button", "mira-skill-link", "View");
      view.type = "button";
      view.addEventListener("click", function () {
        var pre = li.querySelector(".mira-skill-preview");
        if (pre) { pre.remove(); view.textContent = "View"; return; }
        li.appendChild(el("pre", "mira-skill-preview", skill.instructions));
        view.textContent = "Hide";
      });
      foot.appendChild(view);
    }
    li.appendChild(foot);
    return li;
  }

  function field(labelText, control, hint) {
    var wrap = el("label", "mira-skill-field");
    wrap.appendChild(el("span", "mira-skill-label", labelText));
    if (hint) wrap.appendChild(el("span", "mira-skill-hint", hint));
    wrap.appendChild(control);
    return wrap;
  }
  function renderEditor(skill) {
    var limits = state.data.limits || {};
    var form = el("form", "mira-skill-editor");
    form.noValidate = true;
    var title = el("div", "mira-skill-editor-head");
    title.appendChild(el("strong", null, skill.id ? "Edit skill" : "New skill"));
    title.appendChild(el("span", "mira-skill-mode", skill.scope === "school" ? "School" : "Yours"));
    form.appendChild(title);

    var name = el("input", "mira-settings-input");
    name.maxLength = limits.name || 80; name.value = skill.name || ""; name.placeholder = "e.g. Report card comments";
    form.appendChild(field("Name", name));
    var desc = el("input", "mira-settings-input");
    desc.maxLength = limits.description || 300; desc.value = skill.description || ""; desc.placeholder = "e.g. Report card comments and remarks";
    form.appendChild(field("When to use it", desc));

    var modes = el("div", "mira-skill-modes mira-skill-segment");
    Object.keys(MODES).forEach(function (key) {
      var opt = el("label", "mira-skill-mode-opt");
      var radio = document.createElement("input");
      radio.type = "radio"; radio.name = "skMode"; radio.value = key; radio.checked = (skill.useMode || "auto") === key;
      opt.appendChild(radio);
      opt.appendChild(el("span", null, MODES[key]));
      modes.appendChild(opt);
    });
    var modeWrap = el("div", "mira-skill-field");
    modeWrap.appendChild(el("span", "mira-skill-label", "Use it"));
    modeWrap.appendChild(modes);
    form.appendChild(modeWrap);


    var instr = el("textarea", "mira-settings-textarea mira-skill-instructions");
    instr.rows = 10; instr.maxLength = limits.instructions || 4000; instr.value = skill.instructions || "";
    instr.placeholder = "What Mira should do. e.g.\n- Start with a strength.\n- One next step.\n- Under 400 characters.";
    var count = el("span", "mira-skill-count", String(instr.value.length) + " / " + instr.maxLength);
    instr.addEventListener("input", function () { count.textContent = instr.value.length + " / " + instr.maxLength; });
    var instrField = field("Instructions", instr);
    instrField.appendChild(count);
    form.appendChild(instrField);

    var note = el("p", "mira-skills-empty is-error");
    note.hidden = true;
    form.appendChild(note);
    var actions = el("div", "mira-skill-actions");
    if (skill.id) {
      var del = el("button", "mira-btn mira-btn-danger-quiet", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        if (!window.confirm("Delete “" + skill.name + "”? Mira stops using it.")) return;
        del.disabled = true;
        api("/api/skills/" + skill.id, { method: "DELETE" }).then(function () { state.editing = null; return load(true); }).then(render)
          .catch(function (error) { del.disabled = false; note.hidden = false; note.textContent = error.message; });
      });
      actions.appendChild(del);
    }
    actions.appendChild(el("span", "mira-skill-spacer"));
    var cancel = el("button", "mira-btn mira-btn-secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { state.editing = null; render(); });
    var save = el("button", "mira-btn mira-btn-primary", "Save");
    save.type = "submit";
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var mode = form.querySelector('input[name="skMode"]:checked');
      var body = {
        scope: skill.scope, name: name.value, description: desc.value, instructions: instr.value,
        useMode: mode ? mode.value : "auto", keywords: skill.keywords || [], enabled: skill.id ? skill.enabled : true,
      };
      if (skill.templateKey) body.templateKey = skill.templateKey;
      save.disabled = true;
      note.hidden = true;
      var request = skill.id ? api("/api/skills/" + skill.id, { method: "PUT", body: body }) : api("/api/skills", { method: "POST", body: body });
      request.then(function () {
        state.tab = skill.scope === "school" ? "school" : "mine";
        state.editing = null;
        return load(true);
      }).then(function () { setTab(state.tab); }).catch(function (error) {
        save.disabled = false;
        note.hidden = false;
        note.textContent = error.message;
      });
    });
    pane.appendChild(form);
    name.focus();
  }

  function renderLibrary() {
    var data = state.data;
    var have = {};
    data.personal.concat(data.school).forEach(function (s) { if (s.templateKey) have[s.scope + ":" + s.templateKey] = true; });
    var groups = {};
    data.templates.forEach(function (t) { (groups[t.category] = groups[t.category] || []).push(t); });
    Object.keys(groups).forEach(function (category) {
      pane.appendChild(el("h3", "mira-skills-group", category));
      var ul = el("ul", "mira-skills-list");
      groups[category].forEach(function (t) {
        var li = el("li", "mira-skill");
        var text = el("div", "mira-skill-text");
        text.appendChild(el("strong", null, t.name));
        text.appendChild(el("span", null, t.description));
        li.appendChild(text);
        var foot = el("div", "mira-skill-foot");
        foot.appendChild(el("span", "mira-skill-mode mode-" + t.useMode, MODE_SHORT[t.useMode]));
        var peek = el("button", "mira-skill-link", "Preview");
        peek.type = "button";
        peek.addEventListener("click", function () {
          var pre = li.querySelector(".mira-skill-preview");
          if (pre) { pre.remove(); peek.textContent = "Preview"; return; }
          li.appendChild(el("pre", "mira-skill-preview", t.instructions));
          peek.textContent = "Hide";
        });
        foot.appendChild(peek);
        foot.appendChild(el("span", "mira-skill-spacer"));
        [["personal", "Add"], ["school", "Add for school"]].forEach(function (pair) {
          if (pair[0] === "school" && !data.canManageSchool) return;
          if (have[pair[0] + ":" + t.key]) { foot.appendChild(el("span", "mira-skill-added", pair[0] === "school" ? "In school" : "Added")); return; }
          var btn = el("button", "mira-btn " + (pair[0] === "school" ? "mira-btn-secondary" : "mira-btn-primary") + " mira-btn-small", pair[1]);
          btn.type = "button";
          btn.addEventListener("click", function () {
            // Opens in the editor first, so it can be made their own before it's saved.
            state.editing = { scope: pair[0], name: t.name, description: t.description, instructions: t.instructions, useMode: t.useMode, keywords: [], templateKey: t.key };
            render();
          });
          foot.appendChild(btn);
        });
        li.appendChild(foot);
        ul.appendChild(li);
      });
      pane.appendChild(ul);
    });
  }

  tabs.addEventListener("click", function (event) {
    var b = event.target.closest("[data-sk-tab]");
    if (b) setTab(b.getAttribute("data-sk-tab"));
  });
  document.getElementById("miraSkillsClose").addEventListener("click", close);
  overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !overlay.hidden) close();
  });
  var menuBtn = document.getElementById("miraSkillsBtn");
  if (menuBtn) menuBtn.addEventListener("click", function () { open("mine"); });

  // ── Picking a skill for the next message ──────────────────────────────────────────────
  var popover = null;
  function closePicker() { if (popover) { popover.remove(); popover = null; } }
  function chipsRowFor(inputId) {
    var form = document.getElementById(inputId) && document.getElementById(inputId).closest("form");
    if (!form) return null;
    var row = form.querySelector(".mira-skill-picked");
    if (!row) {
      row = el("div", "mira-skill-picked");
      form.insertBefore(row, form.querySelector(".mira-input-box"));
    }
    return row;
  }
  function drawPicked() {
    ["miraInput", "miraInputDocked"].forEach(function (inputId) {
      var row = chipsRowFor(inputId);
      if (!row) return;
      row.innerHTML = "";
      row.hidden = !picked.length;
      picked.forEach(function (skill) {
        var chip = el("span", "mira-skill-chip");
        chip.appendChild(el("span", null, skill.name));
        var x = el("button", "mira-skill-chip-x", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Don’t use " + skill.name);
        x.addEventListener("click", function () { picked = picked.filter(function (p) { return p.id !== skill.id; }); drawPicked(); });
        chip.appendChild(x);
        row.appendChild(chip);
      });
    });
  }
  function openPicker(button) {
    closePicker();
    popover = el("div", "mira-skill-popover");
    popover.setAttribute("role", "menu");
    popover.appendChild(el("p", "mira-skill-popover-title", "Use a skill"));
    var listBox = el("div", "mira-skill-popover-list");
    listBox.appendChild(el("p", "mira-skills-empty", "Loading…"));
    popover.appendChild(listBox);
    var manage = el("button", "mira-skill-link", "Manage");
    manage.type = "button";
    manage.addEventListener("click", function () { closePicker(); open("mine"); });
    popover.appendChild(manage);
    document.body.appendChild(popover);
    var at = button.getBoundingClientRect();
    popover.style.left = Math.max(8, Math.min(at.left, window.innerWidth - popover.offsetWidth - 8)) + "px";
    popover.style.top = Math.max(8, at.top - popover.offsetHeight - 8) + "px";
    // Always fresh: a skill made or switched off in another tab shows as it is now.
    load(true).then(function (data) {
      listBox.innerHTML = "";
      var all = data.school.concat(data.personal).filter(function (s) { return s.enabled; });
      if (!all.length) { listBox.appendChild(el("p", "mira-skills-empty", "No skills yet.")); }
      all.forEach(function (skill) {
        var item = el("button", "mira-skill-popover-item" + (picked.some(function (p) { return p.id === skill.id; }) ? " is-on" : ""));
        item.type = "button";
        item.setAttribute("role", "menuitemcheckbox");
        item.appendChild(el("strong", null, skill.name));
        item.appendChild(el("span", null, skill.scope === "school" ? "School" : "Yours"));
        item.addEventListener("click", function () {
          if (picked.some(function (p) { return p.id === skill.id; })) picked = picked.filter(function (p) { return p.id !== skill.id; });
          else if (picked.length < 5) picked.push({ id: skill.id, name: skill.name });
          drawPicked();
          closePicker();
          var input = document.getElementById(button.getAttribute("data-skills-pick"));
          if (input) input.focus();
        });
        listBox.appendChild(item);
      });
      popover.style.top = Math.max(8, at.top - popover.offsetHeight - 8) + "px";
    }).catch(function (error) { listBox.innerHTML = ""; listBox.appendChild(el("p", "mira-skills-empty is-error", error.message)); });
  }
  document.addEventListener("click", function (event) {
    var btn = event.target.closest && event.target.closest("[data-skills-pick]");
    if (btn) { event.preventDefault(); if (popover) closePicker(); else openPicker(btn); return; }
    if (popover && !popover.contains(event.target)) closePicker();
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") closePicker(); });

  window.MiraSkills = {
    open: open,
    // The ids picked for the message being sent; the chips clear once it's sent.
    takePicked: function () {
      var ids = picked.map(function (p) { return p.id; });
      picked = [];
      drawPicked();
      return ids;
    },
    // "Following: A · B" above an answer.
    showUsed: function (container, list) {
      if (!container || !list || !list.length) return;
      var line = el("div", "mira-skills-used");
      line.appendChild(el("span", "mira-skills-used-icon", "★"));
      line.appendChild(el("span", null, list.map(function (s) { return s.name; }).join(" \u00b7 ")));
      container.parentNode.insertBefore(line, container);
    },
  };
})();
