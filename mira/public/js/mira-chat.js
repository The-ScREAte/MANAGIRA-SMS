(function () {
  "use strict";

  var thread = document.getElementById("miraChatThread");
  var scrollEl = document.getElementById("miraChatScroll");
  var currentChatId = null;
  var currentChatPinned = false;
  var allChats = []; // last fetched history list, filtered locally by the search box
  var pendingAttachments = []; // [{filename, kind:"text", text} | {filename, kind:"image", dataUrl, mimeType}] - cleared after each send

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  var aiDisclaimer = document.getElementById("miraAiDisclaimer");
  function showAiDisclaimer() {
    if (aiDisclaimer) aiDisclaimer.hidden = false;
  }
  function hideAiDisclaimer() {
    if (aiDisclaimer) aiDisclaimer.hidden = true;
  }

  // ---- Chat topbar: current chat's title + a Pin/Rename/Delete menu ----
  var chatTopbarTitleText = document.getElementById("miraChatTopbarTitleText");
  var chatTopbarTitleBtn = document.getElementById("miraChatTopbarTitle");
  var chatTopbarMenu = document.getElementById("miraChatTopbarMenu");
  var chatTopbarPinLabel = document.getElementById("miraChatTopbarPinLabel");

  function updateChatTopbar(title, pinned) {
    currentChatPinned = !!pinned;
    if (chatTopbarTitleText) chatTopbarTitleText.textContent = title || "New chat";
    if (chatTopbarPinLabel) chatTopbarPinLabel.textContent = currentChatPinned ? "Unpin" : "Pin";
  }

  function closeChatTopbarMenu() {
    if (chatTopbarMenu) chatTopbarMenu.hidden = true;
    if (chatTopbarTitleBtn) chatTopbarTitleBtn.setAttribute("aria-expanded", "false");
  }
  if (chatTopbarTitleBtn) {
    chatTopbarTitleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!currentChatId) return;
      var willOpen = chatTopbarMenu.hidden;
      closeChatTopbarMenu();
      if (willOpen) {
        chatTopbarMenu.hidden = false;
        chatTopbarTitleBtn.setAttribute("aria-expanded", "true");
      }
    });
    document.addEventListener("click", function (e) {
      if (!chatTopbarMenu.hidden && !chatTopbarMenu.contains(e.target) && e.target !== chatTopbarTitleBtn) closeChatTopbarMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !chatTopbarMenu.hidden) closeChatTopbarMenu();
    });
  }

  var chatTopbarPinBtn = document.getElementById("miraChatTopbarPin");
  if (chatTopbarPinBtn) {
    chatTopbarPinBtn.addEventListener("click", function () {
      closeChatTopbarMenu();
      if (!currentChatId) return;
      var nextPinned = !currentChatPinned;
      fetch("/api/chat/" + currentChatId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("pin toggle failed");
          currentChatPinned = nextPinned;
          if (chatTopbarPinLabel) chatTopbarPinLabel.textContent = currentChatPinned ? "Unpin" : "Pin";
          refreshHistory();
        })
        .catch(function () {
          alert("Unable to update that chat right now.");
        });
    });
  }

  var chatTopbarRenameBtn = document.getElementById("miraChatTopbarRename");
  if (chatTopbarRenameBtn) {
    chatTopbarRenameBtn.addEventListener("click", function () {
      closeChatTopbarMenu();
      if (!currentChatId || !chatTopbarTitleText) return;
      var currentTitle = chatTopbarTitleText.textContent;
      var newTitle = prompt("Rename chat", currentTitle);
      if (newTitle == null) return;
      newTitle = newTitle.trim();
      if (!newTitle || newTitle === currentTitle) return;
      fetch("/api/chat/" + currentChatId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("rename failed");
          chatTopbarTitleText.textContent = newTitle;
          refreshHistory();
        })
        .catch(function () {
          alert("Unable to rename that chat right now.");
        });
    });
  }

  var chatTopbarDeleteBtn = document.getElementById("miraChatTopbarDelete");
  if (chatTopbarDeleteBtn) {
    chatTopbarDeleteBtn.addEventListener("click", function () {
      closeChatTopbarMenu();
      if (!currentChatId) return;
      if (!confirm("Delete this chat? This can't be undone.")) return;
      var deletingId = currentChatId;
      fetch("/api/chat/" + deletingId, { method: "DELETE" })
        .then(function (r) {
          if (!r.ok) throw new Error("delete failed");
          allChats = allChats.filter(function (c) { return c.id !== deletingId; });
          if (deletingId === currentChatId) {
            currentChatId = null;
            thread.innerHTML = "";
            if (window.miraShowEmptyState) window.miraShowEmptyState();
          }
          refreshHistory();
        })
        .catch(function () {
          alert("Unable to delete that chat right now.");
        });
    });
  }

  // ---- Share: hands the whole visible transcript to the OS share sheet
  // (mobile/modern desktop browsers), or copies it to the clipboard as a
  // fallback - no server-side "public link" exists, so this never exposes
  // chat content outside of an action the user explicitly took.
  function buildTranscriptText() {
    var title = chatTopbarTitleText ? chatTopbarTitleText.textContent : "Chat with Mira";
    var lines = [title, ""];
    thread.querySelectorAll(".mira-message").forEach(function (el) {
      var bubble = el.querySelector(".mira-message-bubble");
      if (!bubble) return;
      var speaker = el.classList.contains("mira-message-user") ? "You" : "Mira";
      lines.push(speaker + ": " + bubble.textContent);
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  var chatTopbarShareBtn = document.getElementById("miraChatTopbarShare");
  if (chatTopbarShareBtn) {
    chatTopbarShareBtn.addEventListener("click", function () {
      if (!currentChatId) return;
      var title = chatTopbarTitleText ? chatTopbarTitleText.textContent : "Chat with Mira";
      var text = buildTranscriptText();

      if (navigator.share) {
        navigator.share({ title: title, text: text }).catch(function () {
          /* user cancelled the share sheet - not an error */
        });
        return;
      }

      var copyPromise = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard API"));
      copyPromise
        .catch(function () {
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
          var label = chatTopbarShareBtn.querySelector("span");
          var restoreLabel = label ? label.textContent : "Share";
          chatTopbarShareBtn.classList.add("is-copied");
          if (label) label.textContent = "Copied!";
          setTimeout(function () {
            chatTopbarShareBtn.classList.remove("is-copied");
            if (label) label.textContent = restoreLabel;
          }, 1500);
        });
    });
  }

  function formatMessageTime(input) {
    var d = input ? new Date(input) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function appendUserMessage(text, createdAt) {
    var el = document.createElement("div");
    el.className = "mira-message mira-message-user";
    el.innerHTML =
      '<div class="mira-message-bubble">' + escapeHtml(text) + "</div>" +
      '<div class="mira-message-time">' + formatMessageTime(createdAt) + "</div>";
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

    // Timestamp is created but not attached yet - the reply isn't "sent"
    // until onDone, which appends it after the action buttons.
    var timeEl = document.createElement("div");
    timeEl.className = "mira-message-time";

    return { el: el, bubble: bubble, avatar: avatar, timeEl: timeEl };
  }

  // Stop the "actively working" wag once a reply has settled - only the
  // hero/new-chat logo stays in motion at idle, not every message avatar.
  function settleAvatar(avatar) {
    if (!avatar) return;
    avatar.classList.remove("mira-logo-spinning");
  }

  var TOOL_ACTION_LABELS = {
    find_student: "Searched students",
    find_contact: "Searched guardians",
    get_fees: "Checked fees",
    get_attendance: "Checked attendance",
    get_class: "Checked classes",
    get_term: "Checked terms",
    list_projects: "Checked school details",
    draft_message: "Drafted a message",
    create_announcement: "Created an announcement",
    generate_report_card_summary: "Generated a summary",
  };
  function renderToolAction(container, name, status) {
    var label = TOOL_ACTION_LABELS[name] || name;
    var icon = status === "ok" ? "✓" : status === "denied" ? "✕" : "!";
    var action = document.createElement("div");
    action.className = "mira-tool-action";
    action.innerHTML = escapeHtml(label) + " " + icon;
    container.parentElement.appendChild(action);
  }

  // Minimal text/event-stream parser over a fetch() ReadableStream - used
  // instead of EventSource because EventSource can't send a POST body.
  async function streamChat(message, images, handlers) {
    var selectedClass = window.MIRA_SELECTED_CLASS;
    var response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        chatId: currentChatId,
        images: images && images.length ? images : [],
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
        // A missing handler must never abort the stream mid-read - a
        // thrown error here previously skipped onDone entirely (no
        // history refresh, no AI disclaimer) for any turn that hit a
        // tool call, since onToolCall wasn't always provided by callers.
        try {
          if (eventName === "chat") handlers.onChat?.(data);
          else if (eventName === "token") handlers.onToken?.(data);
          else if (eventName === "tool_call") handlers.onToolCall?.(data);
          else if (eventName === "tool_result") handlers.onToolResult?.(data);
          else if (eventName === "error") handlers.onError?.(data.message);
          else if (eventName === "done") handlers.onDone?.(data);
        } catch (handlerError) {
          console.error("[mira] SSE handler failed for event", eventName, handlerError);
        }
      }
    }
  }

  function sendMessage(text) {
    if (!text.trim()) return;
    if (window.miraShowChatView) window.miraShowChatView();

    var attachments = pendingAttachments;
    clearAttachments();

    var textAttachments = attachments.filter(function (a) { return a.kind === "text"; });
    var imageAttachments = attachments.filter(function (a) { return a.kind === "image"; });

    var filenames = attachments.map(function (a) { return a.filename; });
    var displayText = filenames.length ? text + "\n\n" + filenames.map(function (f) { return "📎 " + f; }).join("\n") : text;

    var attachedBlocks = textAttachments
      .map(function (a) { return "[Attached file: " + a.filename + "]\n\n" + a.text; })
      .concat(imageAttachments.map(function (a) { return "[Attached image: " + a.filename + "]"; }));
    var outgoingText = attachedBlocks.length ? attachedBlocks.join("\n\n---\n\n") + "\n\n---\n\n" + text : text;
    var outgoingImages = imageAttachments.map(function (a) { return { dataUrl: a.dataUrl, mimeType: a.mimeType }; });

    appendUserMessage(displayText);
    var assistant = appendAssistantMessage();
    var bubble = assistant.bubble;
    var receivedFirstToken = false;
    var messageIdRef = { id: null, feedback: null };

    streamChat(outgoingText, outgoingImages, {
      onChat: function (data) {
        currentChatId = data.chatId;
        updateChatTopbar(data.title, data.pinned);
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
      onToolCall: function () {},
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
        assistant.timeEl.textContent = formatMessageTime(data.createdAt);
        actions.appendChild(assistant.timeEl);
        assistant.el.appendChild(actions);
        showAiDisclaimer();
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

  // ---- Attach: multi-file upload, folded into the next outgoing message ----
  var fileInput = document.getElementById("miraFileInput");
  var MAX_ATTACHMENTS = 5;

  function renderAttachmentChip() {
    ["", "Docked"].forEach(function (suffix) {
      var container = document.getElementById(suffix ? "miraAttachedFileChipDocked" : "miraAttachedFileChip");
      if (!container) return;
      container.innerHTML = "";
      if (!pendingAttachments.length) {
        container.hidden = true;
        return;
      }
      container.hidden = false;
      pendingAttachments.forEach(function (attachment, index) {
        var pill = document.createElement("div");
        pill.className = "mira-attached-file";
        var icon = attachment.kind === "image"
          ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="1.3" stroke="currentColor" stroke-width="1.3"/><circle cx="5.5" cy="6" r="1" fill="currentColor"/><path d="M2.5 11l3.2-3.2 2 2L11.5 6l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 5.5l-5 5a2 2 0 102.8 2.8l5-5a3.5 3.5 0 10-5-5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        var nameSpan = document.createElement("span");
        nameSpan.className = "mira-attached-file-name";
        nameSpan.textContent = attachment.filename;
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.setAttribute("aria-label", "Remove " + attachment.filename);
        removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
        removeBtn.addEventListener("click", function () {
          pendingAttachments.splice(index, 1);
          renderAttachmentChip();
        });
        pill.innerHTML = icon;
        pill.appendChild(nameSpan);
        pill.appendChild(removeBtn);
        container.appendChild(pill);
      });
    });
  }

  function clearAttachments() {
    pendingAttachments = [];
    if (fileInput) fileInput.value = "";
    renderAttachmentChip();
  }

  function uploadAttachments(files) {
    var formData = new FormData();
    for (var i = 0; i < files.length; i++) formData.append("files", files[i]);
    return fetch("/api/upload", { method: "POST", body: formData }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || "Upload failed.");
        return data.results || [];
      });
    });
  }

  function wireAttach(buttonId) {
    var btn = document.getElementById(buttonId);
    if (!btn || !fileInput) return;
    btn.addEventListener("click", function () {
      fileInput.click();
    });
  }
  wireAttach("miraAttachBtn");
  wireAttach("miraAttachBtnDocked");

  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var files = fileInput.files;
      if (!files || !files.length) return;
      var room = MAX_ATTACHMENTS - pendingAttachments.length;
      if (room <= 0) {
        alert("You can attach up to " + MAX_ATTACHMENTS + " files at once.");
        fileInput.value = "";
        return;
      }
      var selected = Array.prototype.slice.call(files, 0, room);
      uploadAttachments(selected)
        .then(function (results) {
          var failures = [];
          results.forEach(function (data) {
            if (data.error) {
              failures.push(data.filename + ": " + data.error);
              return;
            }
            pendingAttachments.push(
              data.kind === "image"
                ? { filename: data.filename, kind: "image", dataUrl: data.dataUrl, mimeType: data.mimeType }
                : { filename: data.filename, kind: "text", text: data.text }
            );
          });
          renderAttachmentChip();
          if (failures.length) alert(failures.join("\n"));
        })
        .catch(function (err) {
          alert(err.message || "Unable to attach those files.");
        })
        .finally(function () {
          fileInput.value = "";
        });
    });
  }

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

  function renameChat(chatId, itemEl, textEl) {
    var currentTitle = textEl.textContent;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "mira-chat-item-rename-input";
    input.value = currentTitle;
    textEl.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      input.replaceWith(textEl);
      if (!newTitle || newTitle === currentTitle) return;
      textEl.textContent = newTitle;
      fetch("/api/chat/" + chatId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("rename failed");
          if (chatId === currentChatId && chatTopbarTitleText) chatTopbarTitleText.textContent = newTitle;
          refreshHistory();
        })
        .catch(function () {
          textEl.textContent = currentTitle;
          alert("Unable to rename that chat right now.");
        });
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { done = true; input.replaceWith(textEl); }
    });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  function togglePinChat(chatId, pinned) {
    fetch("/api/chat/" + chatId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: pinned }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("pin toggle failed");
        if (chatId === currentChatId) {
          currentChatPinned = pinned;
          if (chatTopbarPinLabel) chatTopbarPinLabel.textContent = pinned ? "Unpin" : "Pin";
        }
        return refreshHistory();
      })
      .catch(function () {
        alert("Unable to update that chat right now.");
      });
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
      if (chat.pinned) item.classList.add("is-pinned");

      var main = document.createElement("div");
      main.className = "mira-chat-item-main";
      var textSpan = document.createElement("span");
      textSpan.className = "mira-chat-item-text";
      if (chat.pinned) {
        var pinIcon = document.createElement("span");
        pinIcon.className = "mira-chat-item-pin-icon";
        pinIcon.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.2 3.6L13 6.8 10 9.2l.7 3.8L8 11l-2.7 2 .7-3.8-3-2.4 3.8-1.2z" fill="currentColor"/></svg>';
        textSpan.appendChild(pinIcon);
      }
      textSpan.appendChild(document.createTextNode(chat.title));
      var timeSpan = document.createElement("span");
      timeSpan.className = "mira-chat-item-time";
      timeSpan.textContent = timeAgo(chat.updated_at);
      main.appendChild(textSpan);
      main.appendChild(timeSpan);
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
        var renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "mira-chat-item-menu-rename";
        renameBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span>Rename</span>';
        renameBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeAllChatItemMenus();
          renameChat(chat.id, item, textSpan);
        });
        menu.appendChild(renameBtn);
        var pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "mira-chat-item-menu-pin";
        pinBtn.innerHTML = chat.pinned
          ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.2 3.6L13 6.8 10 9.2l.7 3.8L8 11l-2.7 2 .7-3.8-3-2.4 3.8-1.2z" fill="currentColor"/></svg><span>Unpin</span>'
          : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.2 3.6L13 6.8 10 9.2l.7 3.8L8 11l-2.7 2 .7-3.8-3-2.4 3.8-1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span>Pin</span>';
        pinBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeAllChatItemMenus();
          togglePinChat(chat.id, !chat.pinned);
        });
        menu.appendChild(pinBtn);
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
      appendUserMessage(message.content, message.created_at);
      return;
    }
    var el = document.createElement("div");
    el.className = "mira-message mira-message-assistant";

    var row = document.createElement("div");
    row.className = "mira-message-row";
    row.innerHTML = '<span class="mira-logo mira-logo-inline mira-message-avatar"><img src="/images/managira.png" alt=""></span>';

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
    var timeEl = document.createElement("div");
    timeEl.className = "mira-message-time";
    timeEl.textContent = formatMessageTime(message.created_at);
    actions.appendChild(timeEl);
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
        updateChatTopbar(data.chat.title, data.chat.pinned);
        thread.innerHTML = "";
        (data.messages || []).forEach(renderStoredMessage);
        if (window.miraShowChatView) window.miraShowChatView();
        setActiveHistoryItem(currentChatId);
        var hasAssistantReply = (data.messages || []).some(function (m) { return m.role === "assistant"; });
        if (hasAssistantReply) showAiDisclaimer(); else hideAiDisclaimer();
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
    clearAttachments();
    setActiveHistoryItem(null);
    hideAiDisclaimer();
    updateChatTopbar("New chat", false);
    closeChatTopbarMenu();
  };

  refreshHistory();
})();
