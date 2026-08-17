(function () {
  "use strict";

  var thread = document.getElementById("miraChatThread");
  var scrollEl = document.getElementById("miraChatScroll");
  var currentChatId = null;

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

  function appendAssistantMessage() {
    var el = document.createElement("div");
    el.className = "mira-message mira-message-assistant";
    var bubble = document.createElement("div");
    bubble.className = "mira-message-bubble";
    bubble.innerHTML = '<span class="mira-typing-dots"><span></span><span></span><span></span></span>';
    el.appendChild(bubble);
    thread.appendChild(el);
    scrollToBottom();
    return bubble;
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
    var response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, chatId: currentChatId }),
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

    appendUserMessage(text);
    var bubble = appendAssistantMessage();
    var receivedFirstToken = false;

    streamChat(text, {
      onChat: function (data) {
        currentChatId = data.chatId;
      },
      onToken: function (data) {
        if (!receivedFirstToken) {
          bubble.textContent = "";
          receivedFirstToken = true;
        }
        bubble.textContent += data.text;
        scrollToBottom();
      },
      onToolCall: function () {
        if (!receivedFirstToken) bubble.innerHTML = '<span class="mira-typing-dots"><span></span><span></span><span></span></span>';
      },
      onToolResult: function (data) {
        renderToolAction(bubble, data.name, data.status);
      },
      onError: function (message) {
        bubble.textContent = message || "Something went wrong.";
      },
      onDone: function () {
        scrollToBottom();
        refreshHistory();
      },
    });
  }

  function wireSubmit(formId, inputId) {
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
  wireSubmit("miraComposerForm", "miraInput");
  wireSubmit("miraComposerFormDocked", "miraInputDocked");

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

  function refreshHistory() {
    var list = document.getElementById("miraChatList");
    if (!list) return;
    fetch("/api/chat/history")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        list.innerHTML = "";
        (data.chats || []).forEach(function (chat) {
          var item = document.createElement("div");
          item.className = "mira-chat-item";
          if (chat.id === currentChatId) item.classList.add("is-active");
          item.innerHTML =
            '<span class="mira-chat-item-text">' + escapeHtml(chat.title) + "</span>" +
            '<span class="mira-chat-item-time">' + timeAgo(chat.updated_at) + "</span>";
          list.appendChild(item);
        });
      })
      .catch(function () {});
  }
  refreshHistory();
})();
