(function () {
  "use strict";

  // Shared by every API call in mira-app.js and mira-chat.js: a session
  // that's expired or been signed out elsewhere means the *right* thing
  // to do is send the user to log back in, not surface a generic "unable
  // to reach Mira" network-style error for what's actually an auth
  // problem. Redirecting immediately and returning a promise that never
  // resolves means the caller's existing .then()/.catch() chain simply
  // never fires again - no extra error handling needed at each call site.
  function miraFetch(url, options) {
    return fetch(url, options).then(function (response) {
      if (response.status === 401) {
        window.location.href = "/login";
        return new Promise(function () {});
      }
      return response;
    });
  }
  window.miraFetch = miraFetch;

  // Chat font: applied from a cached localStorage value immediately (avoids
  // a flash of the default font before the server round-trip below
  // resolves), then kept in sync with the server copy so it follows the
  // user across devices. See the Settings block further down for the
  // fetch-on-open / save-on-change wiring.
  var CHAT_FONT_STORAGE_KEY = "mira:chatFont";
  var cachedChatFont = window.localStorage.getItem(CHAT_FONT_STORAGE_KEY);
  if (cachedChatFont) document.documentElement.setAttribute("data-chat-font", cachedChatFont);

  var sidebar = document.getElementById("miraSidebar");
  var collapseToggle = document.getElementById("miraCollapseToggle");
  var mobileMenuBtn = document.getElementById("miraMobileMenuBtn");
  var backdrop = document.getElementById("miraSidebarBackdrop");
  var COLLAPSE_STORAGE_KEY = "mira:sidebarCollapsed";
  var mobileMql = window.matchMedia("(max-width: 860px)");

  // ---- Sidebar collapse (desktop) ----
  function applyCollapsedState(collapsed) {
    sidebar.classList.toggle("is-collapsed", collapsed);
  }
  function expandSidebar() {
    if (!sidebar.classList.contains("is-collapsed")) return;
    applyCollapsedState(false);
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, "false");
  }
  function updateCollapseToggleLabel() {
    if (!collapseToggle) return;
    collapseToggle.setAttribute("aria-label", mobileMql.matches ? "Close menu" : "Collapse sidebar");
  }
  if (collapseToggle) {
    var storedCollapsed = window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
    applyCollapsedState(storedCollapsed);
    updateCollapseToggleLabel();
    mobileMql.addEventListener("change", updateCollapseToggleLabel);
    collapseToggle.addEventListener("click", function () {
      // On the mobile drawer, "collapse to icon rail" isn't a real state
      // (the drawer is either open or closed) - this button closes the
      // drawer there instead, and shows an X rather than the hamburger
      // lines, so it isn't just a second, do-nothing hamburger icon
      // sitting inside the already-open drawer.
      if (mobileMql.matches) {
        closeDrawer();
        return;
      }
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
  // Shared by the sidebar's "New chat" button and its mobile-topbar
  // icon-only counterpart (views/index.ejs) - the sidebar is off-screen by
  // default on mobile, so the topbar needs its own trigger for the same
  // action rather than requiring the drawer to be opened first.
  function startNewChat() {
    if (window.miraStartNewChat) window.miraStartNewChat();
    showEmptyState();
    var input = document.getElementById("miraInput");
    if (input) input.focus();
  }
  var newChatBtn = document.getElementById("miraNewChatBtn");
  if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
  var newChatBtnMobile = document.getElementById("miraNewChatBtnMobile");
  if (newChatBtnMobile) newChatBtnMobile.addEventListener("click", startNewChat);

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
      // While a reply is streaming, the button is a stop button and must
      // stay clickable regardless of what's in the textarea - mira-chat.js
      // sets this flag for the duration of a request.
      if (!window.miraIsSending) sendBtn.disabled = textarea.value.trim().length === 0;
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

  // ---- Quick-action chips: open a small suggestion popup, aware of the
  // selected class. Each item is { class: "...{class}...", all: "...",
  // none: "..." } - not every item is class-aware (some just use `none`
  // for every state); `all` deliberately drops "for" (reads oddly to say
  // "a report for all classes" as a half-typed prompt) while `class`
  // completes the sentence with the name.
  var CHIP_SUGGESTIONS = {
    find: {
      label: "Find",
      icon: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      items: [
        { class: "Find a student in {class}", all: "Find a student", none: "Find a student" },
        { none: "Look up a guardian's contact details" },
        { none: "Find a past announcement" },
        { none: "Search recent messages" },
      ],
    },
    draft: {
      label: "Draft",
      icon: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
      items: [
        { none: "Draft a message to a guardian" },
        { class: "Draft an announcement for {class}", all: "Draft an announcement", none: "Draft an announcement" },
        { none: "Draft a note on a student" },
        { none: "Draft a reply to a guardian message" },
      ],
    },
    plan: {
      label: "Plan",
      icon: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5.5 1.5v2.5M10.5 1.5v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
      items: [
        { none: "See what's due today" },
        { none: "Plan my week ahead" },
        { class: "Get up to speed on {class}", all: "Get up to speed on my classes", none: "Get up to speed on a class" },
        { none: "Set a reminder for an upcoming deadline" },
      ],
    },
    report: {
      label: "Report",
      icon: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h6l3 3V13a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 8h5M5.5 10.5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      items: [
        { class: "Summarize {class}", all: "Summarize my classes", none: "Summarize my classes" },
        { none: "Find students with no recent attendance" },
        { none: "Show upcoming fee deadlines" },
        { none: "Check for students with outstanding fees" },
      ],
    },
  };

  function resolveItemText(item) {
    var selected = window.MIRA_SELECTED_CLASS;
    if (selected === "all" && item.all) return item.all;
    if (selected && selected.class_name && item.class) return item.class.replace("{class}", selected.class_name);
    return item.none;
  }

  var openChipPopup = null;
  function closeChipPopup() {
    if (openChipPopup) {
      openChipPopup.remove();
      openChipPopup = null;
    }
  }
  function openChipPopupFor(chip, intent) {
    var config = CHIP_SUGGESTIONS[intent];
    if (!config) return;
    closeChipPopup();

    var popup = document.createElement("div");
    popup.className = "mira-chip-popup";
    popup.setAttribute("role", "menu");

    var header = document.createElement("div");
    header.className = "mira-chip-popup-header";
    header.innerHTML =
      '<span class="mira-chip-popup-icon">' + config.icon + "</span>" +
      '<span class="mira-chip-popup-title">' + config.label + "</span>";
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mira-chip-popup-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeChipPopup();
    });
    header.appendChild(closeBtn);
    popup.appendChild(header);

    var list = document.createElement("div");
    list.className = "mira-chip-popup-list";
    config.items.forEach(function (item) {
      var text = resolveItemText(item);
      if (!text) return;
      var row = document.createElement("button");
      row.type = "button";
      row.className = "mira-chip-popup-item";
      row.textContent = text;
      row.addEventListener("click", function () {
        var input = document.getElementById("miraInput");
        if (input) {
          input.value = text + " ";
          input.focus();
          input.dispatchEvent(new Event("input"));
          var caretPos = input.value.length;
          input.setSelectionRange(caretPos, caretPos);
        }
        closeChipPopup();
      });
      list.appendChild(row);
    });
    popup.appendChild(list);

    document.body.appendChild(popup);
    var chipRect = chip.getBoundingClientRect();
    var popupRect = popup.getBoundingClientRect();
    var left = Math.min(chipRect.left, window.innerWidth - popupRect.width - 12);
    left = Math.max(12, left);
    var top = chipRect.top - popupRect.height - 10;
    if (top < 8) top = chipRect.bottom + 10; // not enough room above - open downward instead
    popup.style.left = left + "px";
    popup.style.top = top + "px";

    openChipPopup = popup;
  }
  document.querySelectorAll(".mira-chip[data-intent]").forEach(function (chip) {
    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      if (openChipPopup && openChipPopup.dataset.intent === chip.dataset.intent) {
        closeChipPopup();
        return;
      }
      openChipPopupFor(chip, chip.dataset.intent);
      if (openChipPopup) openChipPopup.dataset.intent = chip.dataset.intent;
    });
  });
  document.addEventListener("click", function (e) {
    if (openChipPopup && !openChipPopup.contains(e.target)) closeChipPopup();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openChipPopup) closeChipPopup();
  });

  // ---- Empty state <-> chat view ----
  var emptyState = document.getElementById("miraEmptyState");
  var chatView = document.getElementById("miraChatView");
  var mobileShareBtn = document.getElementById("miraChatTopbarShareMobile");

  function showEmptyState() {
    emptyState.style.display = "flex";
    chatView.classList.remove("is-active");
    if (mobileShareBtn) mobileShareBtn.hidden = true;
  }
  function showChatView() {
    emptyState.style.display = "none";
    chatView.classList.add("is-active");
    if (mobileShareBtn) mobileShareBtn.hidden = false;
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

  // Shown in the active chat view's topbar so it stays visible for the
  // whole conversation, not just at the composer before the first
  // message - a class scope chosen once and then scrolled past otherwise
  // reads as "this whole chat is org-wide", which is exactly what a
  // class-scoped conversation should *not* look like.
  var chatClassBadge = document.getElementById("miraChatClassBadge");
  var chatClassBadgeLabel = document.getElementById("miraChatClassBadgeLabel");
  function updateChatClassBadge() {
    if (!chatClassBadge || !chatClassBadgeLabel) return;
    var selected = window.MIRA_SELECTED_CLASS;
    // Only a specific class counts as "focused" - "all classes" is
    // effectively org-wide scope, the exact thing this badge exists to
    // distinguish from.
    if (!selected || selected === "all") {
      chatClassBadge.hidden = true;
      return;
    }
    chatClassBadgeLabel.textContent = selected.class_name || "Unnamed class";
    chatClassBadge.hidden = false;
  }

  function selectClass(value, label) {
    window.MIRA_SELECTED_CLASS = value;
    classSelectorLabel.textContent = label;
    updateChatClassBadge();
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
    miraFetch("/api/classes")
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
      if (userMenu.hidden) {
        expandSidebar();
        openUserMenu();
      } else {
        closeUserMenu();
      }
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
  var instructionsInput = document.getElementById("miraCustomInstructions");
  var instructionsSaveBtn = document.getElementById("miraInstructionsSave");
  var instructionsStatus = document.getElementById("miraInstructionsStatus");
  var chatFontSelect = document.getElementById("miraChatFontSelect");
  var preferencesLoaded = false;

  function applyChatFont(font) {
    document.documentElement.setAttribute("data-chat-font", font || "default");
    window.localStorage.setItem(CHAT_FONT_STORAGE_KEY, font || "default");
  }

  function loadPreferencesIntoSettings() {
    if (!instructionsInput && !chatFontSelect) return;
    miraFetch("/api/preferences")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        preferencesLoaded = true;
        if (instructionsInput) instructionsInput.value = data.customInstructions || "";
        if (chatFontSelect) chatFontSelect.value = data.chatFont || "default";
        applyChatFont(data.chatFont || "default");
      })
      .catch(function () {});
  }

  if (instructionsSaveBtn && instructionsInput) {
    instructionsSaveBtn.addEventListener("click", function () {
      instructionsStatus.textContent = "Saving…";
      miraFetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customInstructions: instructionsInput.value }),
      })
        .then(function (r) { return r.json(); })
        .then(function () {
          instructionsStatus.textContent = "Saved";
          window.setTimeout(function () { instructionsStatus.textContent = ""; }, 2000);
        })
        .catch(function () {
          instructionsStatus.textContent = "Couldn't save - try again.";
        });
    });
  }

  if (chatFontSelect) {
    chatFontSelect.addEventListener("change", function () {
      applyChatFont(chatFontSelect.value);
      miraFetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatFont: chatFontSelect.value }),
      }).catch(function () {});
    });
  }

  if (settingsBtn && settingsOverlay) {
    settingsBtn.addEventListener("click", function () {
      closeUserMenu();
      settingsOverlay.hidden = false;
      if (!preferencesLoaded) loadPreferencesIntoSettings();
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
