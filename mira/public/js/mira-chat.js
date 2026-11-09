(function () {
  "use strict";

  var thread = document.getElementById("miraChatThread");
  var scrollEl = document.getElementById("miraChatScroll");
  var currentChatId = null;
  var currentChatPinned = false;
  // Guards against a second send firing while one is still streaming - both
  // as a UX affordance (send button becomes a stop button) and as a real
  // bug fix: submitting again before the first request's "chat" SSE event
  // resolves currentChatId used to race and silently fork a second,
  // separate chat instead of continuing the same one.
  var isSending = false;
  var currentAbortController = null;
  var allChats = []; // last fetched history list, filtered locally by the search box
  var isSelectMode = false;
  var selectedChatIds = {}; // chatId -> true, cleared whenever select mode exits
  var pendingAttachments = []; // [{filename, kind:"text", text} | {filename, kind:"image", dataUrl, mimeType}] - cleared after each send

  // Remember which chat was open so a page refresh returns to it instead of
  // always landing on "New chat" - but only within a short dormancy window.
  // Beyond that (or once the session itself has actually expired, which
  // miraFetch's 401 handling already redirects to /login for separately),
  // starting fresh is the right call rather than resurrecting a stale
  // conversation. Session-expiry redirects and this dormancy window are two
  // independent mechanisms - deliberately not conflated - since the server
  // session and "did the user look at this recently" have different
  // lifetimes (24h hard cap vs a 30-minute UI-only freshness window).
  var LAST_CHAT_STORAGE_KEY = "mira:lastChat";
  var LAST_CHAT_DORMANCY_MS = 30 * 60 * 1000;

  function touchLastChat(chatId) {
    if (!chatId) {
      window.localStorage.removeItem(LAST_CHAT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_CHAT_STORAGE_KEY, JSON.stringify({ chatId: chatId, ts: Date.now() }));
  }

  function readLastChat() {
    try {
      var raw = window.localStorage.getItem(LAST_CHAT_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.chatId || !parsed.ts) return null;
      if (Date.now() - parsed.ts > LAST_CHAT_DORMANCY_MS) {
        window.localStorage.removeItem(LAST_CHAT_STORAGE_KEY);
        return null;
      }
      return parsed.chatId;
    } catch (e) {
      return null;
    }
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  // ---- Small, self-contained markdown renderer for assistant replies -
  // headers, bold/italic/inline code, fenced code blocks, lists, and
  // (the main reason it exists) tables, so a model reply with tabular
  // data renders as a real table instead of raw "| a | b |" text. Every
  // code path escapes HTML first and only ever inserts tags it
  // constructs itself, so nothing from the model or a tool result can
  // inject markup.
  // Image markdown is intentionally restricted to quickchart.io (the chart
  // images Mira's stats tools embed) rather than any https URL - allowing
  // arbitrary image hosts would let injected text (e.g. from report data a
  // tool returns) render a tracking-pixel-style <img> pointing at an
  // attacker's server, leaking that this message was viewed and any data
  // baked into the URL. Widen this allowlist deliberately, not by default.
  var ALLOWED_IMAGE_HOST_RE = /^https:\/\/quickchart\.io\//i;

  function renderInline(line) {
    var escaped = escapeHtml(line);
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Images first (![alt](url)) - must run before the link regex below,
    // since "[alt](url)" inside "![alt](url)" would otherwise still match
    // the link pattern and leave a stray "!" in front of an <a> tag.
    escaped = escaped.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, function (match, alt, url) {
      if (!ALLOWED_IMAGE_HOST_RE.test(url)) return match;
      // escapeHtml only guarantees &/</> are safe for text-node content -
      // it does not escape " (not needed there), but these values are
      // going into attribute values here, so quotes must be neutralized
      // separately or a crafted URL/alt could break out of the attribute.
      var safeUrl = url.replace(/"/g, "%22");
      var safeAlt = alt.replace(/"/g, "&quot;");
      return '<img src="' + safeUrl + '" alt="' + safeAlt + '" loading="lazy" class="mira-md-image">';
    });
    // Only http(s) URLs - rejects javascript:/data: hrefs that could
    // otherwise turn a rendered link into a click-to-execute XSS vector.
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    return escaped;
  }

  function splitTableRow(line) {
    var trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map(function (c) { return c.trim(); });
  }

  function buildTableHtml(headerCells, aligns, bodyRows) {
    function cellStyle(idx) {
      return aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : "";
    }
    var thead = "<thead><tr>" + headerCells.map(function (c, idx) {
      return "<th" + cellStyle(idx) + ">" + renderInline(c) + "</th>";
    }).join("") + "</tr></thead>";
    var tbody = "<tbody>" + bodyRows.map(function (row) {
      return "<tr>" + row.map(function (c, idx) {
        return "<td" + cellStyle(idx) + ">" + renderInline(c) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody>";
    return '<div class="mira-md-table-wrap"><table class="mira-md-table">' + thead + tbody + "</table></div>";
  }

  function isTableRow(line) {
    return /^\s*\|.*\|\s*$/.test(line);
  }
  function isTableSeparator(line) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.indexOf("-") !== -1;
  }

  function renderMarkdown(raw) {
    var text = String(raw == null ? "" : raw);

    var codeBlocks = [];
    text = text.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, function (m, code) {
      var idx = codeBlocks.length;
      codeBlocks.push(code.replace(/\n$/, ""));
      return "\u0000CODEBLOCK" + idx + "\u0000";
    });

    var lines = text.split("\n");
    var html = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var headerCells = splitTableRow(line);
        var aligns = splitTableRow(lines[i + 1]).map(function (c) {
          c = c.trim();
          if (/^:-+:$/.test(c)) return "center";
          if (/^-+:$/.test(c)) return "right";
          if (/^:-+$/.test(c)) return "left";
          return "";
        });
        var bodyRows = [];
        var j = i + 2;
        while (j < lines.length && isTableRow(lines[j])) {
          bodyRows.push(splitTableRow(lines[j]));
          j++;
        }
        html.push(buildTableHtml(headerCells, aligns, bodyRows));
        i = j;
        continue;
      }

      // Horizontal rule ("---", "***", "___") - shown as a divider rather
      // than literal dashes.
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html.push('<hr class="mira-md-hr">');
        i++;
        continue;
      }

      var headerMatch = line.match(/^(#{1,4})\s+(.*)$/);
      if (headerMatch) {
        var level = Math.min(headerMatch[1].length + 2, 6);
        html.push("<h" + level + ">" + renderInline(headerMatch[2]) + "</h" + level + ">");
        i++;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        var ulItems = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          ulItems.push("<li>" + renderInline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        html.push("<ul>" + ulItems.join("") + "</ul>");
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        var olItems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          olItems.push("<li>" + renderInline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
          i++;
        }
        html.push("<ol>" + olItems.join("") + "</ol>");
        continue;
      }

      var paraLines = [];
      while (
        i < lines.length && lines[i].trim() &&
        !/^#{1,4}\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
        !isTableRow(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (!paraLines.length) {
        // A line that looks like a table row (isTableRow) but isn't part
        // of a real table (no valid separator followed it, so the table
        // branch above skipped it too) would otherwise match neither
        // loop and never advance `i` - looping forever. Fall back to
        // treating it as plain text so every line always makes progress.
        paraLines.push(lines[i]);
        i++;
      }
      html.push("<p>" + paraLines.map(renderInline).join("<br>") + "</p>");
    }

    return html.join("").replace(/\u0000CODEBLOCK(\d+)\u0000/g, function (m, idx) {
      return "<pre><code>" + escapeHtml(codeBlocks[Number(idx)]) + "</code></pre>";
    });
  }

  // Plain-text version of a reply's markdown source, used by Copy/Download
  // so the user gets readable text instead of raw markdown syntax and the
  // full (very long, base64-query-string-sized) chart image URLs.
  function markdownToPlainText(raw) {
    var text = String(raw == null ? "" : raw);
    text = text.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, function (m, code) { return code.replace(/\n$/, ""); });
    text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, function (m, alt) { return alt ? "[Chart: " + alt + "]" : "[Image]"; });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
    text = text.replace(/`([^`]+)`/g, "$1");
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
    text = text.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1$2");
    text = text.replace(/^#{1,4}\s+/gm, "");
    text = text.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, "");
    text = text.split("\n").filter(function (line) { return !isTableSeparator(line); })
      .map(function (line) {
        return isTableRow(line) ? splitTableRow(line).join("  |  ") : line;
      }).join("\n");
    return text.trim();
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
      miraFetch("/api/chat/" + currentChatId, {
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
      miraFetch("/api/chat/" + currentChatId, {
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
      miraFetch("/api/chat/" + deletingId, { method: "DELETE" })
        .then(function (r) {
          if (!r.ok) throw new Error("delete failed");
          allChats = allChats.filter(function (c) { return c.id !== deletingId; });
          if (deletingId === currentChatId) {
            currentChatId = null;
            touchLastChat(null);
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

  // Shared by the desktop chat-topbar Share button and its mobile-topbar
  // counterpart (views/index.ejs) - the desktop topbar is hidden below the
  // 860px breakpoint (see mira.css), so mobile gets its own icon-only
  // button wired to the exact same behavior instead of duplicating it.
  function wireShareButton(btn) {
    if (!btn) return;
    btn.addEventListener("click", function () {
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
          var label = btn.querySelector("span");
          var restoreLabel = label ? label.textContent : "Share";
          btn.classList.add("is-copied");
          if (label) label.textContent = "Copied!";
          setTimeout(function () {
            btn.classList.remove("is-copied");
            if (label) label.textContent = restoreLabel;
          }, 1500);
        });
    });
  }
  wireShareButton(document.getElementById("miraChatTopbarShare"));
  wireShareButton(document.getElementById("miraChatTopbarShareMobile"));

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
      var text = markdownToPlainText(getText());
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
      var blob = new Blob([markdownToPlainText(getText())], { type: "text/plain;charset=utf-8" });
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
      miraFetch("/api/chat/messages/" + messageIdRef.id + "/feedback", {
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

  function appendFocusedClass(actions, classScope) {
    if (!actions || !classScope || !classScope.className) return;
    var scope = document.createElement("span");
    scope.className = "mira-message-class-scope";
    scope.textContent = "Focused class: " + classScope.className;
    actions.appendChild(scope);
  }

  // One persistent logo lives below the thread (see index.ejs) instead of
  // a separate avatar next to every message - always in motion, brisker
  // while a reply is generating.
  var threadLogoMark = document.getElementById("miraThreadLogoMark");
  var thinkingDots = document.getElementById("miraThinkingDots");
  function setThreadLogoWorking(working) {
    if (threadLogoMark) {
      threadLogoMark.classList.toggle("mira-logo-spinning", working);
      threadLogoMark.classList.toggle("mira-logo-idle", !working);
    }
    if (thinkingDots) thinkingDots.hidden = !working;
    if (!working) setThinkingLabel("");
  }

  // A few plain words on what Mira is doing while it looks things up.
  var thinkingLabel = document.getElementById("miraThinkingLabel");
  function setThinkingLabel(text) {
    if (!thinkingLabel) return;
    thinkingLabel.textContent = text || "";
    thinkingLabel.hidden = !text;
  }
  function describeTool(name) {
    var n = String(name || "");
    if (/attendance/.test(n)) return "Checking attendance\u2026";
    if (/^draft_/.test(n)) return "Writing drafts\u2026";
    if (/^(send_|post_or_send)/.test(n)) return "Preparing to send\u2026";
    if (/report|merit|statistics|compare/.test(n)) return "Running the numbers\u2026";
    if (/^(create|update|set|add|rename|assign|approve|schedule|upload)_/.test(n)) return "Getting it ready\u2026";
    if (/^(delete|remove|reject|reverse|cancel)_/.test(n)) return "Checking what this would change\u2026";
    return "Looking it up\u2026";
  }

  function appendAssistantMessage() {
    var el = document.createElement("div");
    el.className = "mira-message mira-message-assistant";

    var bubble = document.createElement("div");
    bubble.className = "mira-message-bubble";
    el.appendChild(bubble);
    thread.appendChild(el);
    scrollToBottom();

    // Timestamp is created but not attached yet - the reply isn't "sent"
    // until onDone, which appends it after the action buttons.
    var timeEl = document.createElement("div");
    timeEl.className = "mira-message-time";

    return { el: el, bubble: bubble, timeEl: timeEl };
  }

  // Minimal text/event-stream parser over a fetch() ReadableStream - used
  // instead of EventSource because EventSource can't send a POST body.
  async function streamChat(message, images, handlers, signal) {
    var selectedClass = window.MIRA_SELECTED_CLASS;
    var response;
    try {
      response = await miraFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: signal,
        body: JSON.stringify({
          message: message,
          chatId: currentChatId,
          images: images && images.length ? images : [],
          classId: selectedClass && selectedClass !== "all" ? selectedClass.class_id : null,
          className: selectedClass === "all" ? "All classes" : selectedClass ? selectedClass.class_name : null,
        }),
      });
    } catch (err) {
      if (err.name === "AbortError") return handlers.onAbort?.();
      handlers.onError("Unable to reach Mira.");
      return;
    }

    if (!response.ok || !response.body) {
      handlers.onError("Unable to reach Mira.");
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    while (true) {
      var chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (err.name === "AbortError") return handlers.onAbort?.();
        throw err;
      }
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
          else if (eventName === "revise") handlers.onRevise?.(data);
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

  var SEND_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M8 3l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var STOP_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/></svg>';

  // While sending, the send button becomes a stop button - always
  // clickable (not disabled), regardless of the textarea's contents.
  // While idle, disabled state goes back to tracking whether there's text
  // to send.
  function setSendingUI(sending) {
    window.miraIsSending = sending;
    [["miraSendBtn", "miraInput"], ["miraSendBtnDocked", "miraInputDocked"]].forEach(function (pair) {
      var btn = document.getElementById(pair[0]);
      var input = document.getElementById(pair[1]);
      if (!btn) return;
      btn.classList.toggle("is-sending", sending);
      btn.innerHTML = sending ? STOP_ICON : SEND_ICON;
      btn.setAttribute("aria-label", sending ? "Stop generating" : "Send");
      btn.title = sending ? "Stop generating" : "";
      btn.disabled = sending ? false : !input || input.value.trim().length === 0;
    });
  }

  function sendMessage(text) {
    if (!text.trim() || isSending) return;
    if (window.miraShowChatView) window.miraShowChatView();

    isSending = true;
    currentAbortController = new AbortController();
    setSendingUI(true);

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
    var rawText = ""; // markdown source, kept separate from the rendered HTML so copy/download get real markdown back
    var receivedFirstToken = false;
    var messageIdRef = { id: null, feedback: null };
    setThreadLogoWorking(true);

    function finishSending() {
      isSending = false;
      currentAbortController = null;
      setSendingUI(false);
    }

    streamChat(outgoingText, outgoingImages, {
      onChat: function (data) {
        currentChatId = data.chatId;
        touchLastChat(currentChatId);
        updateChatTopbar(data.title, data.pinned);
      },
      onToken: function (data) {
        if (!receivedFirstToken) {
          receivedFirstToken = true;
          setThreadLogoWorking(false);
        }
        rawText += data.text;
        setThinkingLabel("");
        bubble.innerHTML = renderMarkdown(rawText);
        scrollToBottom();
      },
      // Mira is correcting a reply before it stands (a figure it couldn't
      // back up): clear what was shown and wait for the corrected one.
      onRevise: function () {
        rawText = "";
        bubble.innerHTML = "";
        receivedFirstToken = false;
        setThreadLogoWorking(true);
      },
      onToolCall: function (data) { setThinkingLabel(describeTool(data && data.name)); },
      onToolResult: function () {},
      onError: function (message) {
        bubble.textContent = message || "Something went wrong.";
        setThreadLogoWorking(false);
        finishSending();
      },
      onAbort: function () {
        setThreadLogoWorking(false);
        if (rawText.trim()) {
          rawText += " [stopped]";
          bubble.innerHTML = renderMarkdown(rawText);
          scrollToBottom();
        } else {
          assistant.el.remove();
        }
        finishSending();
        // The user's message (and the chat itself, if this was the first
        // message) is already persisted server-side by the time the abort
        // reaches here - refresh so it doesn't stay invisible in the
        // sidebar until some other action happens to trigger a refetch.
        refreshHistory();
      },
      onDone: function (data) {
        setThreadLogoWorking(false);
        messageIdRef.id = data.messageId || null;
        var actions = buildMessageActions(function () { return rawText; }, messageIdRef);
        appendFocusedClass(actions, data.classScope);
        assistant.timeEl.textContent = formatMessageTime(data.createdAt);
        actions.appendChild(assistant.timeEl);
        assistant.el.appendChild(actions);
        showAiDisclaimer();
        scrollToBottom();
        refreshHistory();
        finishSending();
      },
    }, currentAbortController.signal);
  }

  function wireComposerSubmit(formId, inputId) {
    var form = document.getElementById(formId);
    var input = document.getElementById(inputId);
    if (!form || !input) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (isSending) {
        if (currentAbortController) currentAbortController.abort();
        return;
      }
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
    return miraFetch("/api/upload", { method: "POST", body: formData }).then(function (r) {
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
      miraFetch("/api/chat/" + chatId, {
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
    miraFetch("/api/chat/" + chatId, {
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
    miraFetch("/api/chat/" + chatId, { method: "DELETE" })
      .then(function (r) {
        if (!r.ok) throw new Error("delete failed");
        itemEl.remove();
        allChats = allChats.filter(function (c) { return c.id !== chatId; });
        if (chatId === currentChatId) {
          currentChatId = null;
          touchLastChat(null);
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
      if (isSelectMode) item.classList.add("is-select-mode");

      if (isSelectMode) {
        var checkboxLabel = document.createElement("label");
        checkboxLabel.className = "mira-chat-item-checkbox";
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(selectedChatIds[chat.id]);
        checkbox.addEventListener("click", function (e) { e.stopPropagation(); });
        checkbox.addEventListener("change", function () {
          setChatSelected(chat.id, checkbox.checked);
        });
        checkboxLabel.appendChild(checkbox);
        item.appendChild(checkboxLabel);
      }

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
        if (isSelectMode) {
          setChatSelected(chat.id, !selectedChatIds[chat.id]);
          return;
        }
        loadChat(chat.id);
      });
      item.appendChild(main);

      if (isSelectMode) {
        list.appendChild(item);
        return;
      }

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

  // ---- Multi-select / bulk delete for chat history ----
  var historySelectToggle = document.getElementById("miraHistorySelectToggle");
  var historySelectBar = document.getElementById("miraHistorySelectBar");
  var historySelectAll = document.getElementById("miraHistorySelectAll");
  var historySelectCount = document.getElementById("miraHistorySelectCount");
  var historySelectDelete = document.getElementById("miraHistorySelectDelete");
  var historySelectCancel = document.getElementById("miraHistorySelectCancel");

  function currentVisibleChats() {
    var searchInput = document.getElementById("miraHistorySearch");
    return filterChats(searchInput ? searchInput.value : "");
  }

  function updateSelectBar() {
    var selectedIds = Object.keys(selectedChatIds).filter(function (id) { return selectedChatIds[id]; });
    var count = selectedIds.length;
    if (historySelectCount) historySelectCount.textContent = count + " selected";
    if (historySelectDelete) historySelectDelete.disabled = count === 0;
    if (historySelectAll) {
      var visible = currentVisibleChats();
      historySelectAll.checked = visible.length > 0 && visible.every(function (c) { return selectedChatIds[c.id]; });
    }
  }

  function setChatSelected(chatId, selected) {
    if (selected) selectedChatIds[chatId] = true;
    else delete selectedChatIds[chatId];
    var item = document.querySelector('.mira-chat-item[data-chat-id="' + chatId + '"]');
    if (item) {
      item.classList.toggle("is-selected", Boolean(selected));
      var checkbox = item.querySelector(".mira-chat-item-checkbox input");
      if (checkbox) checkbox.checked = Boolean(selected);
    }
    updateSelectBar();
  }

  function setSelectMode(on) {
    isSelectMode = on;
    selectedChatIds = {};
    if (historySelectBar) historySelectBar.hidden = !on;
    if (historySelectToggle) historySelectToggle.textContent = on ? "Done" : "Select";
    closeAllChatItemMenus();
    renderHistoryList(currentVisibleChats());
    updateSelectBar();
  }

  if (historySelectToggle) {
    historySelectToggle.addEventListener("click", function () {
      setSelectMode(!isSelectMode);
    });
  }
  if (historySelectCancel) {
    historySelectCancel.addEventListener("click", function () { setSelectMode(false); });
  }
  if (historySelectAll) {
    historySelectAll.addEventListener("change", function () {
      // Read once: each setChatSelected re-checks the box against the list,
      // which mid-loop would turn it off and deselect the rest.
      var selectAll = historySelectAll.checked;
      var visible = currentVisibleChats();
      visible.forEach(function (c) { setChatSelected(c.id, selectAll); });
    });
  }
  if (historySelectDelete) {
    historySelectDelete.addEventListener("click", function () {
      var ids = Object.keys(selectedChatIds).filter(function (id) { return selectedChatIds[id]; }).map(function (id) { return parseInt(id, 10); });
      if (!ids.length) return;
      var msg = ids.length === 1 ? "Delete this chat? This can't be undone." : "Delete " + ids.length + " chats? This can't be undone.";
      if (!confirm(msg)) return;
      historySelectDelete.disabled = true;
      miraFetch("/api/chat/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ids }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("bulk delete failed");
          if (ids.indexOf(currentChatId) !== -1) {
            currentChatId = null;
            touchLastChat(null);
            thread.innerHTML = "";
            if (window.miraShowEmptyState) window.miraShowEmptyState();
          }
          setSelectMode(false);
          refreshHistory();
        })
        .catch(function () {
          alert("Unable to delete those chats right now.");
          updateSelectBar();
        });
    });
  }

  function refreshHistory() {
    miraFetch("/api/chat/history")
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
  // A stored user message carries any attached file's full text (that's
  // what the model read). Shown the same way as when it was sent: the
  // message itself plus a "📎 name" line per attachment.
  function storedUserDisplayText(content) {
    var names = [];
    var parts = [];
    String(content || "").split("\n\n---\n\n").forEach(function (block) {
      var match = /^\[Attached (?:file|image): ([^\]]+)\]/.exec(block);
      if (match) names.push(match[1]);
      else parts.push(block);
    });
    var text = parts.join("\n\n---\n\n");
    return names.length ? text + "\n\n" + names.map(function (name) { return "📎 " + name; }).join("\n") : text;
  }

  function renderStoredMessage(message) {
    if (message.role === "user") {
      appendUserMessage(storedUserDisplayText(message.content), message.created_at);
      return;
    }
    var el = document.createElement("div");
    el.className = "mira-message mira-message-assistant";

    var bubble = document.createElement("div");
    bubble.className = "mira-message-bubble";
    bubble.innerHTML = renderMarkdown(message.content);
    el.appendChild(bubble);

    var messageIdRef = { id: message.id, feedback: message.feedback || null };
    var actions = buildMessageActions(function () { return message.content; }, messageIdRef);
    appendFocusedClass(actions, message.class_scope);
    var timeEl = document.createElement("div");
    timeEl.className = "mira-message-time";
    timeEl.textContent = formatMessageTime(message.created_at);
    actions.appendChild(timeEl);
    el.appendChild(actions);

    thread.appendChild(el);
  }

  // Bumped on every loadChat call so a slow, stale response (e.g. the user
  // clicked chat A then immediately chat B) can detect it's no longer the
  // latest request and quietly no-op instead of overwriting B's view with
  // A's data once it finally arrives.
  var loadChatRequestToken = 0;

  function loadChat(chatId) {
    var requestToken = ++loadChatRequestToken;

    // Switch views and show a lightweight loading state immediately, before
    // the network round trip - the fetch itself (session-identity cache
    // miss + a remote DB hop) can take the better part of a second, and
    // sitting on the old view with no feedback during that is what read as
    // "slow" - jumping to a skeleton makes the same latency feel instant.
    setActiveHistoryItem(chatId);
    thread.innerHTML = '<div class="mira-chat-loading-skeleton"><div></div><div></div><div></div></div>';
    if (window.miraShowChatView) window.miraShowChatView();

    miraFetch("/api/chat/" + chatId)
      .then(function (r) {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(function (data) {
        if (requestToken !== loadChatRequestToken) return;
        currentChatId = data.chat.id;
        touchLastChat(currentChatId);
        updateChatTopbar(data.chat.title, data.chat.pinned);
        thread.innerHTML = "";
        (data.messages || []).forEach(renderStoredMessage);
        setActiveHistoryItem(currentChatId);
        var hasAssistantReply = (data.messages || []).some(function (m) { return m.role === "assistant"; });
        if (hasAssistantReply) showAiDisclaimer(); else hideAiDisclaimer();
        scrollToBottom();
      })
      .catch(function (err) {
        if (requestToken !== loadChatRequestToken) return;
        console.error("[mira] unable to load chat", chatId, err);
        thread.innerHTML = "";
      });
  }

  // ---- New chat (called from mira-app.js's New chat button) ----
  window.miraStartNewChat = function () {
    currentChatId = null;
    touchLastChat(null);
    thread.innerHTML = "";
    clearAttachments();
    setActiveHistoryItem(null);
    hideAiDisclaimer();
    updateChatTopbar("New chat", false);
    closeChatTopbarMenu();
  };

  refreshHistory();

  // Restore whatever chat was open before a refresh, as long as it wasn't
  // dormant for 30+ minutes (see touchLastChat/readLastChat above). A
  // genuinely expired session never reaches this - miraFetch's 401 handling
  // inside loadChat's request redirects to /login first.
  var lastChatId = readLastChat();
  if (lastChatId) loadChat(lastChatId);
})();
