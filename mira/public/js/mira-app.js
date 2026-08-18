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
    if (!textarea || !sendBtn) return;

    function sync() {
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
  }
  wireComposer("miraInput", "miraSendBtn", "miraComposerForm");
  wireComposer("miraInputDocked", "miraSendBtnDocked", "miraComposerFormDocked");

  // ---- Quick-action chips: pre-fill intent ----
  var INTENT_PREFILL = {
    find: "Find ",
    draft: "Draft a message to ",
    plan: "Help me plan ",
    report: "Generate a report for ",
  };
  document.querySelectorAll(".mira-chip[data-intent]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var input = document.getElementById("miraInput");
      if (!input) return;
      input.value = INTENT_PREFILL[chip.dataset.intent] || "";
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
  }
  window.miraShowChatView = showChatView;
  window.miraShowEmptyState = showEmptyState;

  // ---- Project selector (populated once list_projects tool lands) ----
  var projectSelector = document.getElementById("miraProjectSelector");
  if (projectSelector) {
    projectSelector.addEventListener("click", function () {
      // Placeholder until the project-scoping UI (list_projects tool) lands.
      console.info("[mira] project selector - coming soon");
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

  // ---- Theme switch (light / dark / system) ----
  var THEME_STORAGE_KEY = "mira:theme";
  var themeSwitch = document.getElementById("miraThemeSwitch");

  function applyTheme(choice) {
    if (choice === "light" || choice === "dark") {
      document.documentElement.setAttribute("data-theme", choice);
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } else {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
    if (themeSwitch) {
      themeSwitch.querySelectorAll(".mira-theme-option").forEach(function (btn) {
        var isActive = btn.dataset.themeChoice === choice;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-checked", String(isActive));
      });
    }
  }
  if (themeSwitch) {
    var savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) || "system";
    applyTheme(savedTheme);
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
