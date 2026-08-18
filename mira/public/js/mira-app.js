(function () {
  "use strict";

  var sidebar = document.getElementById("miraSidebar");
  var collapseToggle = document.getElementById("miraCollapseToggle");
  var mobileMenuBtn = document.getElementById("miraMobileMenuBtn");
  var backdrop = document.getElementById("miraSidebarBackdrop");
  var COLLAPSE_STORAGE_KEY = "mira:sidebarCollapsed";

  // ---- Sidebar collapse (desktop) ----
  function applyCollapsedState(collapsed) {
    sidebar.classList.toggle("is-collapsed", collapsed);
  }
  if (collapseToggle) {
    var storedCollapsed = window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
    applyCollapsedState(storedCollapsed);
    collapseToggle.addEventListener("click", function () {
      var next = !sidebar.classList.contains("is-collapsed");
      applyCollapsedState(next);
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
    });
  }

  // ---- Sidebar drawer (mobile) ----
  function openDrawer() {
    sidebar.classList.add("is-open");
    backdrop.classList.add("is-visible");
  }
  function closeDrawer() {
    sidebar.classList.remove("is-open");
    backdrop.classList.remove("is-visible");
  }
  if (mobileMenuBtn) mobileMenuBtn.addEventListener("click", openDrawer);
  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  // ---- New chat ----
  var newChatBtn = document.getElementById("miraNewChatBtn");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", function () {
      if (window.miraStartNewChat) window.miraStartNewChat();
      showEmptyState();
      var input = document.getElementById("miraInput");
      if (input) input.focus();
    });
  }

  // ---- Textarea auto-grow + send-button enable state ----
  function wireComposer(textareaId, sendBtnId, submitFormId) {
    var textarea = document.getElementById(textareaId);
    var sendBtn = document.getElementById(sendBtnId);
    if (!textarea || !sendBtn) return null;

    function sync() {
      // While the composer's container is display:none (e.g. the docked
      // composer before the first message is sent), scrollHeight reads as
      // 0 - baking in a permanent height:0px that leaves nothing to click
      // into once the container becomes visible. Skip the measurement
      // until it's actually laid out; showChatView() re-runs this once
      // the docked composer becomes visible.
      if (textarea.offsetParent === null) return;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
      sendBtn.disabled = textarea.value.trim().length === 0;
    }
    textarea.addEventListener("input", sync);
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        var form = document.getElementById(submitFormId);
        if (form && !sendBtn.disabled) form.requestSubmit();
      }
    });
    sync();
    return sync;
  }
  wireComposer("miraInput", "miraSendBtn", "miraComposerForm");
  var syncDockedComposer = wireComposer("miraInputDocked", "miraSendBtnDocked", "miraComposerFormDocked");

  // ---- Quick-action chips: pre-fill intent, aware of the selected class ----
  // { class: "...{class}...", all: "...", none: "..." } - `none` matches the
  // original static behavior when nothing is selected yet; `all` deliberately
  // drops "for" (reads oddly to say "a report for all classes" as a
  // half-typed prompt) while `class` completes the sentence with the name.
  var INTENT_TEMPLATES = {
    find: { class: "Find a student in {class}: ", all: "Find a student: ", none: "Find " },
    draft: { class: "Draft a message about {class}: ", all: "Draft a message: ", none: "Draft a message to " },
    plan: { class: "Help me plan for {class}: ", all: "Help me plan: ", none: "Help me plan " },
    report: { class: "Generate a report for {class}: ", all: "Generate a report: ", none: "Generate a report for " },
  };
  function buildChipPrefill(intent) {
    var templates = INTENT_TEMPLATES[intent];
    if (!templates) return "";
    var selected = window.MIRA_SELECTED_CLASS;
    if (selected === "all") return templates.all;
    if (selected && selected.class_name) return templates.class.replace("{class}", selected.class_name);
    return templates.none;
  }
  document.querySelectorAll(".mira-chip[data-intent]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var input = document.getElementById("miraInput");
      if (!input) return;
      input.value = buildChipPrefill(chip.dataset.intent);
      input.focus();
      input.dispatchEvent(new Event("input"));
      var caretPos = input.value.length;
      input.setSelectionRange(caretPos, caretPos);
    });
  });

  // ---- Empty state <-> chat view ----
  var emptyState = document.getElementById("miraEmptyState");
  var chatView = document.getElementById("miraChatView");

  function showEmptyState() {
    emptyState.style.display = "flex";
    chatView.classList.remove("is-active");
  }
  function showChatView() {
    emptyState.style.display = "none";
    chatView.classList.add("is-active");
    if (syncDockedComposer) syncDockedComposer();
  }
  window.miraShowChatView = showChatView;
  window.miraShowEmptyState = showEmptyState;

  // ---- Class selector (scopes the conversation to one class) ----
  var classSelector = document.getElementById("miraClassSelector");
  var classDropdown = document.getElementById("miraClassDropdown");
  var classDropdownList = document.getElementById("miraClassDropdownList");
  var classSelectorLabel = document.getElementById("miraClassSelectorLabel");
  var classSearch = document.getElementById("miraClassSearch");
  var allClasses = [];
  var classesLoaded = false;

  window.MIRA_SELECTED_CLASS = null;

  function selectClass(value, label) {
    window.MIRA_SELECTED_CLASS = value;
    classSelectorLabel.textContent = label;
    closeClassDropdown();
  }

  function renderClassOptions(filterText) {
    var query = (filterText || "").trim().toLowerCase();
    var filtered = query
      ? allClasses.filter(function (c) { return String(c.class_name || "").toLowerCase().indexOf(query) !== -1; })
      : allClasses;

    classDropdownList.innerHTML = "";

    // "All classes" is always offered (not filtered by the class-name
    // search - it's a scope choice, not a class to look up) alongside
    // picking one specific class.
    if (!query || "all classes".indexOf(query) !== -1) {
      var allOption = document.createElement("button");
      allOption.type = "button";
      allOption.className = "mira-class-option mira-class-option-all";
      if (window.MIRA_SELECTED_CLASS === "all") allOption.classList.add("is-selected");
      allOption.innerHTML = "<span>All classes</span>";
      allOption.addEventListener("click", function () {
        selectClass("all", "All classes");
      });
      classDropdownList.appendChild(allOption);
    }

    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "mira-class-dropdown-empty";
      empty.textContent = classesLoaded ? "No classes found." : "Loading classes…";
      classDropdownList.appendChild(empty);
      return;
    }
    filtered.forEach(function (c) {
      var option = document.createElement("button");
      option.type = "button";
      option.className = "mira-class-option";
      if (window.MIRA_SELECTED_CLASS && window.MIRA_SELECTED_CLASS !== "all" && window.MIRA_SELECTED_CLASS.class_id === c.class_id) option.classList.add("is-selected");
      var name = String(c.class_name || "Unnamed class").replace(/</g, "&lt;");
      var count = Number(c.student_count) || 0;
      option.innerHTML = "<span>" + name + "</span><span class=\"mira-class-option-count\">" + count + " student" + (count === 1 ? "" : "s") + "</span>";
      option.addEventListener("click", function () {
        selectClass(c, c.class_name || "Unnamed class");
      });
      classDropdownList.appendChild(option);
    });
  }

  function loadClasses() {
    if (classesLoaded) return;
    fetch("/api/classes")
      .then(function (r) {
        if (!r.ok) throw new Error("request failed: " + r.status);
        return r.json();
      })
      .then(function (data) {
        allClasses = Array.isArray(data.classes) ? data.classes : [];
        classesLoaded = true;
        renderClassOptions(classSearch.value);
      })
      .catch(function (err) {
        console.error("[mira] failed to load classes", err);
        classDropdownList.innerHTML = '<div class="mira-class-dropdown-empty">Unable to load classes. Try again shortly.</div>';
      });
  }

  function openClassDropdown() {
    classDropdown.hidden = false;
    classSelector.setAttribute("aria-expanded", "true");
    loadClasses();
    classSearch.focus();
  }
  function closeClassDropdown() {
    classDropdown.hidden = true;
    classSelector.setAttribute("aria-expanded", "false");
  }
  if (classSelector) {
    classSelector.addEventListener("click", function (e) {
      e.stopPropagation();
      if (classDropdown.hidden) openClassDropdown();
      else closeClassDropdown();
    });
    classSearch.addEventListener("input", function () {
      renderClassOptions(classSearch.value);
    });
    document.addEventListener("click", function (e) {
      if (!classDropdown.hidden && !classDropdown.contains(e.target) && e.target !== classSelector) closeClassDropdown();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !classDropdown.hidden) closeClassDropdown();
    });
  }

  // ---- User menu (floating, anchored above the sidebar footer) ----
  var userTrigger = document.getElementById("miraUserTrigger");
  var userMenu = document.getElementById("miraUserMenu");

  function openUserMenu() {
    userMenu.hidden = false;
    userTrigger.setAttribute("aria-expanded", "true");
  }
  function closeUserMenu() {
    userMenu.hidden = true;
    userTrigger.setAttribute("aria-expanded", "false");
  }
  if (userTrigger) {
    userTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      if (userMenu.hidden) openUserMenu();
      else closeUserMenu();
    });
    document.addEventListener("click", function (e) {
      if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== userTrigger) closeUserMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !userMenu.hidden) closeUserMenu();
    });
  }

  // ---- Theme switch (light / dark - two explicit choices only) ----
  var THEME_STORAGE_KEY = "mira:theme";
  var themeSwitch = document.getElementById("miraThemeSwitch");

  function applyTheme(choice) {
    document.documentElement.setAttribute("data-theme", choice);
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    if (themeSwitch) {
      themeSwitch.querySelectorAll(".mira-theme-option").forEach(function (btn) {
        var isActive = btn.dataset.themeChoice === choice;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-checked", String(isActive));
      });
    }
  }
  if (themeSwitch) {
    var savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    // Guards against a stale "system" value left over from before the
    // toggle was simplified to two explicit choices - anything other than
    // exactly "light"/"dark" is treated as unset.
    if (savedTheme !== "light" && savedTheme !== "dark") savedTheme = null;
    if (!savedTheme) {
      // No explicit choice yet - highlight whichever the OS preference
      // currently resolves to (the page itself already renders that way
      // via the prefers-color-scheme CSS block) without locking it in.
      savedTheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      themeSwitch.querySelectorAll(".mira-theme-option").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.dataset.themeChoice === savedTheme);
      });
    } else {
      applyTheme(savedTheme);
    }
    themeSwitch.querySelectorAll(".mira-theme-option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyTheme(btn.dataset.themeChoice);
      });
    });
  }

  // ---- Settings modal ----
  var settingsBtn = document.getElementById("miraSettingsBtn");
  var settingsOverlay = document.getElementById("miraSettingsOverlay");
  var settingsClose = document.getElementById("miraSettingsClose");
  if (settingsBtn && settingsOverlay) {
    settingsBtn.addEventListener("click", function () {
      closeUserMenu();
      settingsOverlay.hidden = false;
    });
    settingsClose.addEventListener("click", function () {
      settingsOverlay.hidden = true;
    });
    settingsOverlay.addEventListener("click", function (e) {
      if (e.target === settingsOverlay) settingsOverlay.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !settingsOverlay.hidden) settingsOverlay.hidden = true;
    });
  }

  // Submit handling (calls the orchestrator, streams the reply) and chat
  // history loading live in mira-chat.js, loaded after this file.
})();
