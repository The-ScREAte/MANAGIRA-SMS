// Shared "Notify Guardians" modal. Every page calls the same function:
//   openGuardianBroadcast({ context, contextId, studentIds?, classId?, termId? })
// The modal itself resolves who receives it and the default message text
// from the server (/account/messaging/resolve) — pages don't build their
// own recipient text or message strings anymore, so every page agrees.
(function () {
  let modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;

    const overlay = document.createElement("div");
    overlay.id = "guardianBroadcastModal";
    overlay.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:5000;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,0.25);font-family:inherit;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <h3 style="margin:0;font-size:16px;color:#0f172a;">Notify Guardians</h3>
          <button type="button" id="gbClose" style="border:none;background:#f1f5f9;color:#475569;width:28px;height:28px;border-radius:50%;font-size:15px;cursor:pointer;">x</button>
        </div>
        <p id="gbScope" style="margin:0 0 14px;font-size:12.5px;color:#64748b;">Checking recipients...</p>
        <div id="gbChannelRow" style="display:flex;gap:14px;margin-bottom:12px;font-size:13px;"></div>
        <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:4px;">Message</label>
        <textarea id="gbMessage" rows="4" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #e2e8f0;border-radius:8px;font:inherit;font-size:13.5px;resize:vertical;"></textarea>
        <small id="gbCounter" style="display:block;margin:4px 0 12px;color:#94a3b8;font-size:11.5px;"></small>
        <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:4px;">Confirm Password</label>
        <input type="password" id="gbPassword" placeholder="Enter your password" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #e2e8f0;border-radius:8px;font:inherit;font-size:13.5px;margin-bottom:14px;" />
        <div style="display:flex;gap:10px;align-items:center;">
          <button type="button" id="gbSend" style="background:var(--primary,#01535b);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-weight:600;font-size:13.5px;cursor:pointer;">Send</button>
          <small id="gbStatus" style="color:#64748b;font-size:12.5px;"></small>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    modalEl = overlay;

    overlay.querySelector("#gbClose").addEventListener("click", closeGuardianBroadcast);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeGuardianBroadcast(); });
    overlay.querySelector("#gbSend").addEventListener("click", submitGuardianBroadcast);
    overlay.querySelector("#gbMessage").addEventListener("input", updateCounter);
    overlay.addEventListener("change", (e) => { if (e.target.name === "gbChannel") updateCounter(); });

    return overlay;
  }

  function closeGuardianBroadcast() {
    if (modalEl) modalEl.style.display = "none";
  }

  // Mirrors utils/guardianMessaging.js's countSmsSegments — GSM-7 (plain
  // ASCII) fits 160 chars/segment, 153/part; any other character forces
  // UCS-2 (70/segment, 67/part). Only shown when SMS is the selected
  // channel — WhatsApp has no such limit.
  function countSmsSegments(text) {
    const isGsm7 = /^[\x00-\x7F]*$/.test(text);
    const singleLimit = isGsm7 ? 160 : 70;
    const partLimit = isGsm7 ? 153 : 67;
    const length = text.length;
    if (length === 0) return { length: 0, segments: 0, encoding: isGsm7 ? "GSM-7" : "UCS-2", limit: singleLimit };
    const segments = length <= singleLimit ? 1 : Math.ceil(length / partLimit);
    return { length, segments, encoding: isGsm7 ? "GSM-7" : "UCS-2", limit: singleLimit };
  }

  function updateCounter() {
    const modal = modalEl;
    const counterEl = modal.querySelector("#gbCounter");
    const channelInput = modal.querySelector('input[name="gbChannel"]:checked');
    const channel = channelInput ? channelInput.value : "";
    const text = modal.querySelector("#gbMessage").value;

    if (channel !== "sms") {
      counterEl.textContent = `${text.length} characters`;
      counterEl.style.color = "#94a3b8";
      return;
    }

    const info = countSmsSegments(text);
    const segmentLabel = info.segments <= 1 ? "1 SMS segment" : `${info.segments} SMS segments`;
    counterEl.textContent = `${info.length} characters - ${segmentLabel} (${info.encoding})`;
    counterEl.style.color = info.segments > 1 ? "#b91c1c" : "#94a3b8";
  }

  let pendingContext = null;

  window.openGuardianBroadcast = async function (options) {
    const modal = ensureModal();
    pendingContext = options || {};

    modal.querySelector("#gbScope").textContent = "Checking recipients...";
    modal.querySelector("#gbMessage").value = "";
    modal.querySelector("#gbCounter").textContent = "";
    modal.querySelector("#gbPassword").value = "";
    modal.querySelector("#gbStatus").textContent = "";
    modal.querySelector("#gbChannelRow").innerHTML = "";
    modal.querySelector("#gbSend").disabled = true;
    modal.style.display = "flex";

    let data;
    try {
      const res = await fetch("/account/messaging/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(pendingContext),
      });
      data = await res.json();
    } catch (_) {
      data = null;
    }

    if (!data || !data.success) {
      modal.querySelector("#gbScope").textContent = (data && data.message) || "Unable to load recipients.";
      modal.querySelector("#gbScope").style.color = "#b91c1c";
      return;
    }

    modal.querySelector("#gbScope").style.color = "#64748b";
    modal.querySelector("#gbScope").textContent = data.recipientDescription || "";
    modal.querySelector("#gbMessage").value = data.defaultMessage || "";

    const channelRow = modal.querySelector("#gbChannelRow");
    const channels = [];
    if (data.channels?.sms?.ready) channels.push({ value: "sms", label: `SMS (${data.channels.sms.providerLabel || "active provider"})` });
    if (data.channels?.whatsapp?.ready) channels.push({ value: "whatsapp", label: "WhatsApp" });

    if (!channels.length) {
      channelRow.innerHTML = '<span style="color:#b91c1c;">No SMS or WhatsApp integration is active yet. Activate one in Settings &rarr; Integrations.</span>';
      modal.querySelector("#gbSend").disabled = true;
      return;
    }

    if (!data.recipientCount) {
      modal.querySelector("#gbSend").disabled = true;
    } else {
      modal.querySelector("#gbSend").disabled = false;
    }

    channelRow.innerHTML = channels
      .map(
        (c, i) => `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="gbChannel" value="${c.value}" ${i === 0 ? "checked" : ""} /> ${c.label}
        </label>`
      )
      .join("");

    updateCounter();
  };

  async function submitGuardianBroadcast() {
    const modal = modalEl;
    const statusEl = modal.querySelector("#gbStatus");
    const sendBtn = modal.querySelector("#gbSend");
    const message = modal.querySelector("#gbMessage").value.trim();
    const password = modal.querySelector("#gbPassword").value;
    const channelInput = modal.querySelector('input[name="gbChannel"]:checked');
    const channel = channelInput ? channelInput.value : "";

    if (!message) { statusEl.textContent = "Type a message first."; statusEl.style.color = "#b91c1c"; return; }
    if (!password) { statusEl.textContent = "Enter your password."; statusEl.style.color = "#b91c1c"; return; }
    if (!channel) { statusEl.textContent = "Choose a channel."; statusEl.style.color = "#b91c1c"; return; }

    sendBtn.disabled = true;
    const previousLabel = sendBtn.textContent;
    sendBtn.textContent = "Sending...";
    statusEl.style.color = "#64748b";
    statusEl.textContent = "Sending...";

    try {
      const res = await fetch("/account/messaging/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...pendingContext, channel, password, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        statusEl.textContent = data.message || `Sent to ${data.sentCount || 0}, ${data.failedCount || "some"} failed.`;
        statusEl.style.color = "#b91c1c";
        return;
      }
      statusEl.textContent = data.message || "Sent.";
      statusEl.style.color = "#166534";
      setTimeout(closeGuardianBroadcast, 2200);
    } catch (error) {
      statusEl.textContent = "Network error — please try again.";
      statusEl.style.color = "#b91c1c";
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = previousLabel || "Send";
    }
  }

  window.closeGuardianBroadcast = closeGuardianBroadcast;
})();
