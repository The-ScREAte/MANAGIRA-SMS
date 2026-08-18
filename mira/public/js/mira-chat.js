(function () {
  "use strict";

  var thread = document.getElementById("miraChatThread");
  var scrollEl = document.getElementById("miraChatScroll");
  var currentChatId = null;
  var allChats = []; // last fetched history list, filtered locally by the search box
  var pendingAttachment = null; // { filename, text } - cleared after each send

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function appendUserMessage(text) {
    var el = document.createElement("div");
    el.className = "mira-message mira-message-user";
    el.innerHTML = '<div class="mira-message-bubble">' + escapeHtml(text) + "</div>";
    thread.appendChild(el);
    scrollToBottom();
  }

  // ---- Assistant message actions: copy / download / like / dislike ----
  function buildMessageActions(getText, messageIdRef) {
    var actions = document.createElement("div");
    actions.className = "mira-message-actions";

    function actionButton(name, title, svg) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mira-msg-action";
      btn.dataset.action = name;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.innerHTML = svg;
      actions.appendChild(btn);
      return btn;
    }

    var copyBtn = actionButton(
      "copy",
      "Copy",
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V3.3A1.3 1.3 0 009.7 2H3.3A1.3 1.3 0 002 3.3v6.4A1.3 1.3 0 003.3 11H5" stroke="currentColor" stroke-width="1.3"/></svg>'
    );
    copyBtn.addEventListener("click", function () {
      var text = getText();
      var restoreIcon = copyBtn.innerHTML;
      (navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard API"))
      )
        .catch(function () {
          // Fallback for browsers/contexts without the async Clipboard API.
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch (e) {}
          document.body.removeChild(ta);
        })
        .then(function () {
          copyBtn.classList.add("is-copied");
          copyBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          setTimeout(function () {
            copyBtn.classList.remove("is-copied");
            copyBtn.innerHTML = restoreIcon;
          }, 1500);
        });
    });

    var downloadBtn = actionButton(
      "download",
      "Download",
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l-3-3m3 3l3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    );
    downloadBtn.addEventListener("click", function () {
      var blob = new Blob([getText()], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "mira-reply-" + Date.now() + ".txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    var likeBtn = actionButton("like", "Good response", '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M5 14V6.5l3.5-4a1.2 1.2 0 012 1l-.6 3h3.6a1.3 1.3 0 011.27 1.6l-1.2 5A1.3 1.3 0 0112.3 14H5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 6.5H3a1 1 0 00-1 1V13a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>');
    var dislikeBtn = actionButton("dislike", "Poor response", '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" style="transform:rotate(180deg)"><path d="M5 14V6.5l3.5-4a1.2 1.2 0 012 1l-.6 3h3.6a1.3 1.3 0 011.27 1.6l-1.2 5A1.3 1.3 0 0112.3 14H5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 6.5H3a1 1 0 00-1 1V13a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>');

    function setFeedback(value) {
      if (!messageIdRef.id) return; // not persisted yet (still streaming) - ignore clicks until we have an id
      var next = likeBtn.classList.contains("is-active") && value === "like" ? null
        : dislikeBtn.classList.contains("is-active") && value === "dislike" ? null
        : value;
      likeBtn.classList.toggle("is-active", next === "like");
      dislikeBtn.classList.toggle("is-active", next === "dislike");
      fetch("/api/chat/messages/" + messageIdRef.id + "/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: next }),
      }).catch(function () {});
    }
    likeBtn.addEventListener("click", function () { setFeedback("like"); });
    dislikeBtn.addEventListener("click", function () { setFeedback("dislike"); });
    if (messageIdRef.feedback === "like") likeBtn.classList.add("is-active");
    if (messageIdRef.feedback === "dislike") dislikeBtn.classList.add("is-active");

    return actions;
  }

  function appendAssistantMessage() {
    var el = document.createElement("div");
    el.className = "mira-message mira-message-assistant";

    var row = document.createElement("div");
    row.className = "mira-message-row";
    row.innerHTML = '<span class="mira-logo mira-logo-inline mira-message-avatar mira-logo-spinning"><img src="/images/managira.png" alt=""></span>';
    var avatar = row.querySelector(".mira-logo");

    var bubble = document.createElement("div");
    bubble.className = "mira-message-bubble";
    row.appendChild(bubble);
    el.appendChild(row);
    thread.appendChild(el);
    scrollToBottom();

    return { el: el, bubble: bubble, avatar: avatar };
  }

  // Swap the avatar from the fast "actively working" spin back to the
  // calm, always-on idle spin once a reply has settled.
  function settleAvatar(avatar) {
    if (!avatar) return;
    avatar.classList.remove("mira-logo-spinning");
    avatar.classList.add("mira-logo-idle");
  }

  function renderToolAction(container, name, status) {
    var label = name === "find_student" ? "Searched students" : name;
    var icon = status === "ok" ? "✓" : status === "denied" ? "✕" : "!";
    var action = document.createElement("div");
    action.className = "mira-tool-action";
    action.innerHTML = escapeHtml(label) + " " + icon;
    container.parentElement.appendChild(action);
  }

  // Minimal text/event-stream parser over a fetch() ReadableStream - used
  // instead of EventSource because EventSource can't send a POST body.
  async function streamChat(message, handlers) {
    var selectedClass = window.MIRA_SELECTED_CLASS;
    var response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        chatId: currentChatId,
        classId: selectedClass && selectedClass !== "all" ? selectedClass.class_id : null,
        className: selectedClass === "all" ? "All classes" : selectedClass ? selectedClass.class_name : null,
      }),
    });

    if (!response.ok || !response.body) {
      handlers.onError("Unable to reach Mira.");
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      var events = buffer.split("\n\n");
      buffer = events.pop();

      for (var i = 0; i < events.length; i++) {
        var lines = events[i].split("\n");
        var eventName = "message";
        var dataLine = "";
        for (var j = 0; j < lines.length; j++) {
          if (lines[j].indexOf("event: ") === 0) eventName = lines[j].slice(7);
          if (lines[j].indexOf("data: ") === 0) dataLine = lines[j].slice(6);
        }
        if (!dataLine) continue;
        var data;
        try {
          data = JSON.parse(dataLine);
        } catch (e) {
          continue;
        }
        if (eventName === "chat") handlers.onChat(data);
        else if (eventName === "token") handlers.onToken(data);
        else if (eventName === "tool_call") handlers.onToolCall(data);
        else if (eventName === "tool_result") handlers.onToolResult(data);
        else if (eventName === "error") handlers.onError(data.message);
        else if (eventName === "done") handlers.onDone(data);
      }
    }
  }

  function sendMessage(text) {
    if (!text.trim()) return;
    if (window.miraShowChatView) window.miraShowChatView();

    var attachment = pendingAttachment;
    clearAttachment();

    var displayText = attachment ? text + "\n\n📎 " + attachment.filename : text;
    var outgoingText = attachment ? "[Attached file: " + attachment.filename + "]\n\n" + attachment.text + "\n\n---\n\n" + text : text;

    appendUserMessage(displayText);
    var assistant = appendAssistantMessage();
    var bubble = assistant.bubble;
    var receivedFirstToken = false;
    var messageIdRef = { id: null, feedback: null };

    streamChat(outgoingText, {
      onChat: function (data) {
        currentChatId = data.chatId;
      },
      onToken: function (data) {
        if (!receivedFirstToken) {
          bubble.textContent = "";
          receivedFirstToken = true;
          settleAvatar(assistant.avatar);
        }
        bubble.textContent += data.text;
        scrollToBottom();
      },
      onToolResult: function (data) {
        renderToolAction(bubble, data.name, data.status);
      },
      onError: function (message) {
        bubble.textContent = message || "Something went wrong.";
        settleAvatar(assistant.avatar);
      },
      onDone: function (data) {
        settleAvatar(assistant.avatar);
        messageIdRef.id = data.messageId || null;
        var actions = buildMessageActions(function () { return bubble.textContent; }, messageIdRef);
        assistant.el.appendChild(actions);
        scrollToBottom();
        refreshHistory();
      },
    });
  }

  function wireComposerSubmit(formId, inputId) {
    var form = document.getElementById(formId);
    var input = document.getElementById(inputId);
    if (!form || !input) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value;
      input.value = "";
      input.style.height = "auto";
      input.dispatchEvent(new Event("input"));
      sendMessage(text);
    });
  }
  wireComposerSubmit("miraComposerForm", "miraInput");
  wireComposerSubmit("miraComposerFormDocked", "miraInputDocked");

  // ---- Attach: text-file upload, folded into the next outgoing message ----
  var fileInput = document.getElementById("miraFileInput");
  var activeAttachTarget = "main"; // which composer's chip to render into

  function renderAttachmentChip() {
    ["", "Docked"].forEach(function (suffix) {
      var chip = document.getElementById(suffix ? "miraAttachedFileChipDocked" : "miraAttachedFileChip");
      var nameEl = document.getElementById(suffix ? "miraAttachedFileNameDocked" : "miraAttachedFileName");
      if (!chip || !nameEl) return;
      if (pendingAttachment) {
        nameEl.textContent = pendingAttachment.filename;
        chip.hidden = false;
      } else {
        chip.hidden = true;
      }
    });
  }

  function clearAttachment() {
    pendingAttachment = null;
    if (fileInput) fileInput.value = "";
    renderAttachmentChip();
  }

  function uploadAttachment(file) {
    var formData = new FormData();
    formData.append("file", file);
    return fetch("/api/upload", { method: "POST", body: formData }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || "Upload failed.");
        return data;
      });
    });
  }

  function wireAttach(buttonId, target) {
    var btn = document.getElementById(buttonId);
    if (!btn || !fileInput) return;
    btn.addEventListener("click", function () {
      activeAttachTarget = target;
      fileInput.click();
    });
  }
  wireAttach("miraAttachBtn", "main");
  wireAttach("miraAttachBtnDocked", "docked");

  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      if (!file) return;
      uploadAttachment(file)
        .then(function (data) {
          pendingAttachment = { filename: data.filename, text: data.text };
          renderAttachmentChip();
        })
        .catch(function (err) {
          alert(err.message || "Unable to attach that file.");
          fileInput.value = "";
        });
    });
  }
  ["miraAttachedFileRemove", "miraAttachedFileRemoveDocked"].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", clearAttachment);
  });

  // ---- Mic: voice-to-text via the Web Speech API (client-side, no backend) ----
  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  function wireMic(buttonId, inputId) {
    var btn = document.getElementById(buttonId);
    var input = document.getElementById(inputId);
    if (!btn || !input) return;

    if (!SpeechRecognitionCtor) {
      btn.disabled = true;
      btn.title = "Voice input isn't supported in this browser";
      return;
    }

    var recognition = null;
    var listening = false;

    btn.addEventListener("click", function () {
      if (listening) {
        recognition.stop();
        return;
      }
      recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;

      var baseText = input.value ? input.value.replace(/\s+$/, "") + " " : "";

      recognition.onstart = function () {
        listening = true;
        btn.classList.add("is-recording");
      };
      recognition.onresult = function (event) {
        var finalTranscript = "";
        var interimTranscript = "";
        for (var i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
          else interimTranscript += event.results[i][0].transcript;
        }
        input.value = baseText + finalTranscript + interimTranscript;
        input.dispatchEvent(new Event("input"));
        if (finalTranscript) baseText = input.value.replace(/\s+$/, "") + " ";
      };
      recognition.onerror = function () {
        listening = false;
        btn.classList.remove("is-recording");
      };
      recognition.onend = function () {
        listening = false;
        btn.classList.remove("is-recording");
      };
      recognition.start();
    });
  }
  wireMic("miraMicBtn", "miraInput");
  wireMic("miraMicBtnDocked", "miraInputDocked");

  // ---- Sidebar chat history ----
  function timeAgo(isoString) {
    var diffMs = Date.now() - new Date(isoString).getTime();
    var mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    return days + "d ago";
  }

  function setActiveHistoryItem(chatId) {
    document.querySelectorAll("#miraChatList .mira-chat-item").forEach(function (el) {
      el.classList.toggle("is-active", Number(el.dataset.chatId) === chatId);
    });
  }

  function closeAllChatItemMenus() {
    document.querySelectorAll(".mira-chat-item-menu").forEach(function (m) { m.remove(); });
    document.querySelectorAll(".mira-chat-item-menu-btn.is-open").forEach(function (b) { b.classList.remove("is-open"); });
  }

  function deleteChat(chatId, itemEl) {
    if (!confirm("Delete this chat? This can't be undone.")) return;
    fetch("/api/chat/" + chatId, { method: "DELETE" })
      .then(function (r) {
        if (!r.ok) throw new Error("delete failed");
        itemEl.remove();
        allChats = allChats.filter(function (c) { return c.id !== chatId; });
        if (chatId === currentChatId) {
          currentChatId = null;
          thread.innerHTML = "";
          if (window.miraShowEmptyState) window.miraShowEmptyState();
        }
      })
      .catch(function () {
        alert("Unable to delete that chat right now.");
      });
  }

  function renderHistoryList(chats) {
    var list = document.getElementById("miraChatList");
    if (!list) return;
    list.innerHTML = "";
    if (!chats.length) {
      var empty = document.createElement("div");
      empty.className = "mira-class-dropdown-empty";
      empty.textContent = "No chats yet.";
      list.appendChild(empty);
      return;
    }
    chats.forEach(function (chat) {
      var item = document.createElement("div");
      item.className = "mira-chat-item";
      item.dataset.chatId = chat.id;
      if (chat.id === currentChatId) item.classList.add("is-active");

      var main = document.createElement("div");
      main.className = "mira-chat-item-main";
      main.innerHTML =
        '<span class="mira-chat-item-text">' + escapeHtml(chat.title) + "</span>" +
        '<span class="mira-chat-item-time">' + timeAgo(chat.updated_at) + "</span>";
      main.addEventListener("click", function () {
        loadChat(chat.id);
      });
      item.appendChild(main);

      var menuBtn = document.createElement("button");
      menuBtn.type = "button";
      menuBtn.className = "mira-chat-item-menu-btn";
      menuBtn.setAttribute("aria-label", "Chat options");
      menuBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3.5" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="12.5" r="1.2" fill="currentColor"/></svg>';
      menuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var alreadyOpen = menuBtn.classList.contains("is-open");
        closeAllChatItemMenus();
        if (alreadyOpen) return;

        menuBtn.classList.add("is-open");
        var menu = document.createElement("div");
        menu.className = "mira-chat-item-menu";
        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "mira-chat-item-menu-delete";
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M4.5 4.5V13a1 1 0 001 1h5a1 1 0 001-1V4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Delete</span>';
        deleteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeAllChatItemMenus();
          deleteChat(chat.id, item);
        });
        menu.appendChild(deleteBtn);
        item.appendChild(menu);
      });
      item.appendChild(menuBtn);

      list.appendChild(item);
    });
  }
  document.addEventListener("click", closeAllChatItemMenus);

  function refreshHistory() {
    fetch("/api/chat/history")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        allChats = data.chats || [];
        var searchInput = document.getElementById("miraHistorySearch");
        renderHistoryList(filterChats(searchInput ? searchInput.value : ""));
      })
      .catch(function () {});
  }

  function filterChats(query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return allChats;
    return allChats.filter(function (c) { return String(c.title || "").toLowerCase().indexOf(q) !== -1; });
  }

  var historySearchInput = document.getElementById("miraHistorySearch");
  if (historySearchInput) {
    historySearchInput.addEventListener("input", function () {
      renderHistoryList(filterChats(historySearchInput.value));
    });
  }

  // ---- Loading a past chat from history ----
  function renderStoredMessage(message) {
    if (message.role === "user") {
      appendUserMessage(message.content);
      return;
    }
    var el = document.createElement("div");
    el.className = "mira-message mira-message-assistant";

    var row = document.createElement("div");
    row.className = "mira-message-row";
    row.innerHTML = '<span class="mira-logo mira-logo-inline mira-message-avatar mira-logo-idle"><img src="/images/managira.png" alt=""></span>';

    var bubble = document.createElement("div");
    bubble.className = "mira-message-bubble";
    bubble.textContent = message.content;
    row.appendChild(bubble);
    el.appendChild(row);

    var toolCalls = message.tool_calls;
    if (typeof toolCalls === "string") {
      try { toolCalls = JSON.parse(toolCalls); } catch (e) { toolCalls = null; }
    }
    if (Array.isArray(toolCalls)) {
      toolCalls.forEach(function (call) {
        renderToolAction(bubble, call.name, call.status);
      });
    }

    var messageIdRef = { id: message.id, feedback: message.feedback || null };
    var actions = buildMessageActions(function () { return bubble.textContent; }, messageIdRef);
    el.appendChild(actions);

    thread.appendChild(el);
  }

  function loadChat(chatId) {
    fetch("/api/chat/" + chatId)
      .then(function (r) {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(function (data) {
        currentChatId = data.chat.id;
        thread.innerHTML = "";
        (data.messages || []).forEach(renderStoredMessage);
        if (window.miraShowChatView) window.miraShowChatView();
        setActiveHistoryItem(currentChatId);
        scrollToBottom();
      })
      .catch(function () {
        console.error("[mira] unable to load chat", chatId);
      });
  }

  // ---- New chat (called from mira-app.js's New chat button) ----
  window.miraStartNewChat = function () {
    currentChatId = null;
    thread.innerHTML = "";
    clearAttachment();
    setActiveHistoryItem(null);
  };

  refreshHistory();
})();
