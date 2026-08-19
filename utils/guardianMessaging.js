// Shared "send to guardians" logic used by every page that offers a
// Send by SMS / Send by WhatsApp button (report cards, announcements,
// transcripts, transportation updates). Keeping this in one place means
// every page checks readiness and sends the same way, instead of each
// page re-implementing its own provider plumbing.
const { getSmsIntegrationStatus, getTenantSmsCredentials, sendSms } = require("./smsIntegration");
const { getWhatsappIntegrationStatus, getWhatsappMessagingCredentials, sendWhatsappTextMessage, sendWhatsappDocumentMessage, normalizePhoneDigits } = require("./whatsappIntegration");
const { sendEmailSafely, renderCleanEmail } = require("./emailHelper");

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

// Fills {{placeholders}} in a message template. Unknown placeholders are
// dropped rather than left in the text, so a typo never leaks "{{foo}}"
// into a message a parent actually reads.
function renderMessageTemplate(template, vars = {}) {
  return safeString(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

// Cost trap #1: a single em-dash, curly quote, or emoji anywhere in an SMS
// body forces the whole message into UCS-2 encoding, dropping the segment
// size from 160 chars to 70 — roughly doubling the SMS cost for a message
// that otherwise would've fit in one segment. Providers bill per segment,
// not per message, so this matters. Applied to SMS bodies only — WhatsApp
// has no such penalty and can keep full Unicode.
function sanitizeForSms(text) {
  return safeString(text)
    .replace(/[—–]/g, "-")        // em dash, en dash
    .replace(/[‘’ʼ]/g, "'")  // curly single quotes
    .replace(/[“”]/g, '"')        // curly double quotes
    .replace(/…/g, "...")              // ellipsis
    .replace(/[→←↔]/g, "->") // arrows
    .replace(/[^\x00-\x7F]/g, "")           // anything else non-ASCII (emoji, etc.)
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeString(value));
}

// Accepts E.164 ("+2332412345678") or a bare digit string of plausible
// international length — most guardian numbers in this database were
// saved through a form that strips the "+" before submit, so requiring
// one here would reject numbers that are otherwise correct. This only
// catches the clearly-broken cases (too short, letters, etc.); it can't
// tell "missing country code" from "has one" without the "+". The Send
// Report modal's "edit contacts" panel is where a school actually fixes
// a specific wrong/incomplete number before sending.
function isValidPhoneNumber(value) {
  const trimmed = safeString(value).replace(/[()\s-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return true;
  return /^\d{9,15}$/.test(trimmed);
}

// GSM-7 (plain ASCII, the common case after sanitizeForSms) fits 160 chars
// in one segment, 153/part after that (7 chars reserved per part for the
// concatenation header). Any remaining non-GSM-7 character forces UCS-2:
// 70 chars single, 67/part. Mirrors the same math the live counter in
// guardianBroadcast.js uses, so server-side validation agrees with what
// the admin saw before hitting Send.
function countSmsSegments(text) {
  const value = safeString(text);
  const isGsm7 = /^[\x00-\x7F]*$/.test(value);
  const singleLimit = isGsm7 ? 160 : 70;
  const partLimit = isGsm7 ? 153 : 67;
  const length = value.length;
  if (length === 0) return { length: 0, segments: 0, encoding: isGsm7 ? "GSM-7" : "UCS-2", limit: singleLimit };
  const segments = length <= singleLimit ? 1 : Math.ceil(length / partLimit);
  return { length, segments, encoding: isGsm7 ? "GSM-7" : "UCS-2", limit: singleLimit };
}

// What a page should show/hide its Send buttons based on — call once per
// page load, not per recipient.
async function getMessagingChannelStatus(dbClient, organizationId) {
  if (!organizationId) {
    return { sms: { ready: false }, whatsapp: { ready: false } };
  }

  const [smsStatus, whatsappStatus] = await Promise.all([
    getSmsIntegrationStatus(dbClient, organizationId).catch(() => null),
    getWhatsappIntegrationStatus(dbClient, organizationId).catch(() => null),
  ]);

  const activeProvider = smsStatus?.activeProvider || "";
  const activeProviderInfo = activeProvider ? smsStatus.providers[activeProvider] : null;

  return {
    sms: {
      ready: Boolean(activeProvider && activeProviderInfo?.configured),
      provider: activeProvider || null,
      providerLabel: activeProvider
        ? { arkesel: "Arkesel", africastalking: "Africa's Talking", twilio: "Twilio" }[activeProvider] || activeProvider
        : null,
    },
    whatsapp: {
      ready: Boolean(whatsappStatus?.shouldShowFeatures),
    },
    // Email goes through Managira's own transactional mail sender (not a
    // per-tenant provider), so it's always available — no activation gate.
    email: {
      ready: true,
    },
  };
}

// recipients: [{ phone, guardianName, studentName, ...extra template vars }]
// Returns [{ phone, guardianName, success, error }] — one entry per recipient,
// so the caller can show "sent to 8 of 10 guardians" style summaries.
// onResult(result, index), if given, fires right after EACH recipient's own
// send attempt resolves (not after the whole batch) — lets a caller that
// isn't awaiting this whole call persist per-recipient status as it happens.
async function sendGuardianMessages(dbClient, organizationId, options) {
  const {
    channel,
    recipients,
    messageTemplate,
    schoolName,
    documentUrl,
    documentCaption,
    onResult,
  } = options;

  const normalizedChannel = safeString(channel).toLowerCase();
  const list = Array.isArray(recipients) ? recipients : [];
  if (!normalizedChannel || !["sms", "whatsapp", "email"].includes(normalizedChannel)) {
    throw new Error("Unsupported channel.");
  }
  if (!list.length) {
    throw new Error("No recipients were found for this channel.");
  }
  if (!safeString(messageTemplate)) {
    throw new Error("Message is required.");
  }

  const results = [];
  function push(result) {
    results.push(result);
    if (typeof onResult === "function") onResult(result, results.length - 1);
  }

  if (normalizedChannel === "sms") {
    const tenant = await getTenantSmsCredentials(dbClient, organizationId);
    for (const recipient of list) {
      const phone = safeString(recipient.phone);
      const message = sanitizeForSms(renderMessageTemplate(messageTemplate, { ...recipient, schoolName }));
      if (!phone) {
        push({ phone: "", guardianName: recipient.guardianName || "", success: false, error: "Missing phone number." });
        continue;
      }
      if (!isValidPhoneNumber(phone)) {
        push({ phone, guardianName: recipient.guardianName || "", success: false, error: "Invalid phone number — include the country code (e.g. +233...)." });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendSms(tenant, message, [phone]);
        push({ phone, guardianName: recipient.guardianName || "", success: true });
      } catch (error) {
        push({ phone, guardianName: recipient.guardianName || "", success: false, error: error?.message || "Send failed." });
      }
    }
    return results;
  }

  if (normalizedChannel === "email") {
    for (const recipient of list) {
      const email = safeString(recipient.email);
      const message = renderMessageTemplate(messageTemplate, { ...recipient, schoolName });
      if (!email) {
        push({ email: "", guardianName: recipient.guardianName || "", success: false, error: "Missing email address." });
        continue;
      }
      if (!isValidEmailAddress(email)) {
        push({ email, guardianName: recipient.guardianName || "", success: false, error: "Invalid email address." });
        continue;
      }
      try {
        const html = renderCleanEmail({
          title: safeString(schoolName),
          greeting: `Dear ${recipient.guardianName || "Parent/Guardian"},`,
          paragraphs: [message],
          noReply: true,
        });
        // eslint-disable-next-line no-await-in-loop
        const sent = await sendEmailSafely(
          { to: email, subject: `${safeString(schoolName)}: Notification`, html },
          "Guardian Notification Email"
        );
        push({ email, guardianName: recipient.guardianName || "", success: Boolean(sent), error: sent ? undefined : "Send failed." });
      } catch (error) {
        push({ email, guardianName: recipient.guardianName || "", success: false, error: error?.message || "Send failed." });
      }
    }
    return results;
  }

  // WhatsApp
  const credentials = await getWhatsappMessagingCredentials(dbClient, organizationId);
  if (!credentials.configured || !credentials.phoneNumberId || !credentials.accessToken) {
    throw new Error("WhatsApp is not connected for this school yet.");
  }

  for (const recipient of list) {
    const rawPhone = safeString(recipient.phone);
    const phone = normalizePhoneDigits(recipient.phone);
    const message = renderMessageTemplate(messageTemplate, { ...recipient, schoolName });
    if (!phone) {
      push({ phone: "", guardianName: recipient.guardianName || "", success: false, error: "Missing phone number." });
      continue;
    }
    if (rawPhone && !isValidPhoneNumber(rawPhone)) {
      push({ phone, guardianName: recipient.guardianName || "", success: false, error: "Invalid phone number — include the country code (e.g. +233...)." });
      continue;
    }
    try {
      if (documentUrl) {
        // eslint-disable-next-line no-await-in-loop
        await sendWhatsappDocumentMessage(credentials.accessToken, credentials.phoneNumberId, {
          to: phone,
          documentLink: documentUrl,
          caption: message,
          filename: documentCaption || "Document.pdf",
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await sendWhatsappTextMessage(credentials.accessToken, credentials.phoneNumberId, { to: phone, text: message });
      }
      push({ phone, guardianName: recipient.guardianName || "", success: true });
    } catch (error) {
      const reason = error?.response?.data?.error?.message || error?.message || "Send failed.";
      push({ phone, guardianName: recipient.guardianName || "", success: false, error: reason });
    }
  }
  return results;
}

module.exports = {
  renderMessageTemplate,
  sanitizeForSms,
  countSmsSegments,
  isValidEmailAddress,
  isValidPhoneNumber,
  getMessagingChannelStatus,
  sendGuardianMessages,
};
