const nodemailer = require("nodemailer");
const dns = require("dns");
const path = require("path");
require("dotenv").config();

// Lazy db reference so this module can still be required even if config/db
// hasn't initialized (e.g. CLI scripts).
let _db = null;
function _getDb() {
  if (_db) return _db;
  try { _db = require("../config/db"); } catch (_) { _db = null; }
  return _db;
}
const {
  isEmailSuppressed,
  suppressEmail,
  isHardAddressFailure,
} = require("./emailSuppression");

const MANAGIRA_LOGO_PATH = path.join(__dirname, "../public/images/managira.png");

// Public HTTPS URL for the logo — used as the PRIMARY <img src> so mail clients
// that strip inline cid: attachments (Outlook web, some Yahoo flows, forwards,
// gmail's “download images” path) still render the brand. The cid: copy is kept
// as a redundant inline attachment for clients that prefer it.
const MANAGIRA_PUBLIC_BASE =
  (process.env.BASE_URL_PRODUCTION
    || process.env.BASE_URL
    || "https://managira.com").replace(/\/$/, "");
const MANAGIRA_LOGO_URL = `${MANAGIRA_PUBLIC_BASE}/images/managira.png`;

// Display name used on every outgoing email. Mail clients prefer a human-
// readable “From”; emails with just an address score higher for Promotions.
const MANAGIRA_FROM_NAME = process.env.EMAIL_FROM_NAME || "Managira";

// Strip HTML to a clean plain-text body. Gmail/Outlook flag HTML-only mail as
// promotional more often than multipart/alternative mail.
function htmlToPlainText(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Cache verified domains to avoid repeated DNS lookups
const _domainCache = new Map();

/**
 * Check if an email domain has valid MX records (can actually receive mail).
 * Results are cached for the lifetime of the process.
 */
async function hasMxRecords(email) {
  const domain = String(email).split("@")[1];
  if (!domain) return false;

  if (_domainCache.has(domain)) return _domainCache.get(domain);

  try {
    const records = await dns.promises.resolveMx(domain);
    // Filter out parked/catch-all domains with dummy MX records like "~" or "."
    const realRecords = (records || []).filter(r =>
      r.exchange && r.exchange.length > 2 && r.exchange !== "~" && r.exchange !== "."
    );
    const valid = realRecords.length > 0;
    _domainCache.set(domain, valid);
    return valid;
  } catch (error) {
    const hardFailureCodes = new Set(["ENOTFOUND", "ENODATA", "EINVAL", "EBADNAME", "NOTFOUND"]);

    if (hardFailureCodes.has(error?.code)) {
      _domainCache.set(domain, false);
      return false;
    }

    // Do not block outbound email on transient DNS issues in the app host.
    console.warn(`[Email][MX] Lookup failed for domain "${domain}" with ${error?.code || 'unknown error'}; allowing SMTP send attempt.`);
    _domainCache.set(domain, true);
    return true;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function resolveSmtpConfig() {
  const user = firstNonEmpty(
    process.env.ADMIN_NOTIFY_EMAIL_USER,
    process.env.NOTIFY_EMAIL_USER,
    process.env.EMAIL_USER,
    process.env.SMTP_USER,
    process.env.MAIL_USER
  );

  const pass = firstNonEmpty(
    process.env.ADMIN_NOTIFY_EMAIL_PASSWORD,
    process.env.NOTIFY_EMAIL_PASSWORD,
    process.env.EMAIL_PASSWORD,
    process.env.EMAIL_PASS,
    process.env.SMTP_PASSWORD,
    process.env.SMTP_PASS,
    process.env.MAIL_PASSWORD,
    process.env.MAIL_PASS
  );

  const host = firstNonEmpty(
    process.env.SMTP_HOST,
    process.env.EMAIL_HOST,
    process.env.MAIL_HOST,
    "smtp.zoho.com"
  );

  const port = firstNonEmpty(process.env.SMTP_PORT, process.env.EMAIL_PORT, process.env.MAIL_PORT, "587");
  const secure = firstNonEmpty(process.env.SMTP_SECURE, process.env.EMAIL_SECURE, process.env.MAIL_SECURE, "false");

  return { user, pass, host, port, secure };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCleanEmail({
  title,
  greeting,
  paragraphs = [],
  details = [],
  cta = null,
  note = "",
  schoolWebsiteUrl = "",
  schoolWebsiteHost = "",
  intro = "",
  message = "",
  closing = "",
  actionUrl = "",
  actionText = "",
  noReply = true,
  year = new Date().getFullYear(),
}) {
  const normalizedParagraphs = [
    ...paragraphs,
    ...(intro ? [intro] : []),
    ...(message ? [message] : []),
    ...(closing ? [closing] : []),
  ];

  const normalizedCta = cta?.url && cta?.text
    ? cta
    : actionUrl && actionText
      ? { url: actionUrl, text: actionText }
      : null;

  const detailsHtml = details.length
    ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:18px 0;">
        ${details
          .map((item) => {
            if (typeof item === "string") {
              return `<p style="margin:6px 0;font-size:14px;color:#334155;">${escapeHtml(item)}</p>`;
            }

            const label = item?.label || "";
            const value = item?.value || "";

            if (!label) {
              return `<p style="margin:6px 0;font-size:14px;color:#334155;">${value}</p>`;
            }

            return `<p style="margin:6px 0;font-size:14px;color:#334155;"><strong>${escapeHtml(label)}:</strong> ${value}</p>`;
          })
          .join("")}
      </div>`
    : "";

  const ctaHtml = normalizedCta?.url && normalizedCta?.text
    ? `<div style="margin:22px 0;">
         <a href="${normalizedCta.url}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(
           normalizedCta.text
         )}</a>
       </div>`
    : "";

  const normalizedWebsiteUrl = String(schoolWebsiteUrl || "").trim();
  const normalizedWebsiteHost = String(schoolWebsiteHost || "").trim();
  const websiteLabel = normalizedWebsiteHost || normalizedWebsiteUrl.replace(/^https?:\/\//i, "");
  const schoolWebsiteHtml = normalizedWebsiteUrl
    ? `<p style="margin:12px 0 0;font-size:13px;color:#334155;">
         School website: <a href="${normalizedWebsiteUrl}" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">${escapeHtml(websiteLabel)}</a>
       </p>`
    : "";

  return `
    <div style="background:#f8fafc;padding:24px 0;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
        <div style="background:#0f766e;padding:16px 22px;display:flex;align-items:center;gap:12px;">
          <img src="${MANAGIRA_LOGO_URL}" alt="Managira" width="40" height="40" style="height:40px;width:40px;display:block;border:0;outline:none;text-decoration:none;border-radius:6px;background:#ffffff;padding:4px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;font-family:'Segoe UI',Arial,sans-serif;">Managira</span>
        </div>
        <div style="padding:24px 22px;color:#0f172a;line-height:1.65;">
          <h2 style="margin:0 0 14px;font-size:21px;color:#0f766e;font-weight:700;">${escapeHtml(title || "Notification")}</h2>
          ${greeting ? `<p style="margin:0 0 12px;font-size:15px;">${greeting}</p>` : ""}
          ${normalizedParagraphs
            .map((text) => `<p style="margin:0 0 12px;font-size:15px;color:#1f2937;">${text}</p>`)
            .join("")}
          ${detailsHtml}
          ${ctaHtml}
          ${note ? `<p style="margin:14px 0 0;font-size:13px;color:#475569;">${note}</p>` : ""}
          ${schoolWebsiteHtml}
          ${noReply ? `<p style="margin:18px 0 0;font-size:12px;color:#b91c1c;font-weight:700;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</p>` : ""}
        </div>
        <div style="border-top:1px solid #e5e7eb;background:#f8fafc;padding:12px 18px;text-align:center;font-size:12px;color:#64748b;">&copy; ${year} Managira. All rights reserved.</div>
      </div>
    </div>
  `;
}

// Persistent transporter — created once and reused across all sends to avoid
// repeated TCP/TLS handshake overhead on every call. If credentials are not
// yet available at module load, it is created lazily on first use.
let _transporter = null;
let _transporterConfig = null;

function getTransporter() {
  const { user, pass, host, port, secure } = resolveSmtpConfig();

  // Rebuild if config has changed (e.g. env hot-reload) or not yet created.
  const configKey = `${user}:${host}:${port}:${secure}`;
  if (_transporter && _transporterConfig === configKey) {
    return _transporter;
  }

  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: secure === "true",
    auth: { user, pass },
    pool: true,           // keep-alive connection pool
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,  // 10s to establish connection
    greetingTimeout: 10000,    // 10s for SMTP greeting
    socketTimeout: 15000,      // 15s for socket inactivity
    dsn: {
      id: 'managira-notify',
      return: 'HDRS',
      notify: ['NEVER'],       // suppress all bounce-back / DSN replies
      recipient: user,
    },
  });

  _transporterConfig = configKey;
  return _transporter;
}

/**
 * Safely send email with proper error handling.
 * Always uses ADMIN_NOTIFY_EMAIL_USER as the from address (ignores caller's from).
 */
async function sendEmailSafely(mailOptions, context = "Email") {
  const sendStart = Date.now();
  try {
    const { user, pass } = resolveSmtpConfig();

    if (!user || !pass) {
      console.warn(`[Email][${context}] SMTP credentials not configured — skipping.`);
      return false;
    }

    // Validate recipient email before attempting send
    const recipient = String(mailOptions.to || "").trim().toLowerCase();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(recipient)) {
      console.warn(`[Email][${context}] Invalid recipient address "${mailOptions.to}" — skipping.`);
      // Permanently suppress malformed addresses so callers stop retrying.
      const db = _getDb();
      if (db) suppressEmail(db, recipient || mailOptions.to, "invalid_format", "Malformed address").catch(() => {});
      return false;
    }

    // Skip recipients that have previously failed permanently.
    const db = _getDb();
    if (db) {
      try {
        const blocked = await isEmailSuppressed(db, recipient);
        if (blocked) {
          console.warn(`[Email][${context}] Recipient "${recipient}" is on the suppression list — skipping.`);
          return false;
        }
      } catch (_) { /* fall through and try to send */ }
    }

    const skipMxCheck = Boolean(mailOptions.skipMxCheck);

    // Verify the domain can receive email (has MX records) unless explicitly bypassed.
    if (!skipMxCheck) {
      const domainOk = await hasMxRecords(recipient);
      if (!domainOk) {
        console.warn(`[Email][${context}] Domain has no MX records for "${recipient}" — skipping.`);
        if (db) suppressEmail(db, recipient, "no_mx_records", "Domain has no MX records").catch(() => {});
        return false;
      }
    }

    const transporter = getTransporter();

    // Build a friendly From header (“Managira <notify@…>”). Mail clients penalize
    // bare-address senders in their Promotions classifier.
    const fromAddress = user;
    const from = `"${MANAGIRA_FROM_NAME}" <${fromAddress}>`;

    // Strip smtpConfig if caller passed it (we ignore custom transporter configs)
    const { smtpConfig, from: _ignoredFrom, skipMxCheck: _skipMxCheck, ...restOptions } = mailOptions;

    // Strip any caller-provided "managira_logo" inline attachment. The logo is
    // now rendered via a public HTTPS <img src> in renderCleanEmail, so adding
    // it as an inline attachment caused mail clients (Gmail/Outlook) to show
    // the logo as a downloadable file alongside the message — which we do not
    // want. Real file attachments (PDF reports, resumes, etc.) are kept.
    const mergedAttachments = (Array.isArray(restOptions.attachments) ? restOptions.attachments : [])
      .filter((item) => !(item && item.cid === 'managira_logo'));

    // Provide a plain-text fallback whenever one wasn’t supplied. multipart/
    // alternative mail is a strong Primary-tab signal.
    const textBody = restOptions.text
      || (restOptions.html ? htmlToPlainText(restOptions.html) : "");

    console.info(`[Email][${context}] sending via SMTP to ${restOptions.to}`);

    const messageIdDomain = (fromAddress.split('@')[1] || 'managira.com').trim();
    const messageId = `<managira-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${messageIdDomain}>`;

    const info = await transporter.sendMail({
      from,
      replyTo: restOptions.replyTo || fromAddress,
      ...restOptions,
      text: textBody,
      attachments: mergedAttachments,
      messageId,
      headers: {
        // Standard transactional-mail headers. We deliberately do NOT set
        // X-Priority / Importance / Priority — those are spam/Promotions
        // signals on Gmail and Outlook even when the mail is legitimate.
        'X-Entity-Ref-ID': `managira-${Date.now()}`,
        'List-Unsubscribe': `<mailto:${fromAddress}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated',
        ...restOptions.headers,
      },
    });

    console.info(`[Email][${context}] SMTP sent OK in ${Date.now() - sendStart}ms`, info.messageId);
    return true;
  } catch (error) {
    _transporter = null;
    _transporterConfig = null;
    console.error(`[Email][${context}] SMTP FAILED after ${Date.now() - sendStart}ms:`, error.message);
    if (error.code === 'EAUTH') {
      console.error(`[Email][${context}] Authentication failed — check ADMIN_NOTIFY_EMAIL_*, NOTIFY_EMAIL_*, EMAIL_* or SMTP_* credentials.`);
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
      const smtp = resolveSmtpConfig();
      console.error(`[Email][${context}] SMTP connection failed — SMTP_HOST=${smtp.host} SMTP_PORT=${smtp.port}`);
    }
    // If this looks like a permanent recipient problem, add to the suppression
    // list so we never burn another SMTP attempt on it.
    if (isHardAddressFailure(error)) {
      const db = _getDb();
      if (db) {
        suppressEmail(
          db,
          String(mailOptions.to || "").trim().toLowerCase(),
          "smtp_hard_bounce",
          error.response || error.message
        ).catch(() => {});
      }
    }
    return false;
  }
}

/**
 * Fire-and-forget email sender. Queues the email in the background and returns
 * immediately so the HTTP response is never blocked by SMTP latency/timeouts.
 * Use this for all non-critical emails (notifications, confirmations, etc.).
 */
function sendEmailInBackground(mailOptions, context = "Email") {
  // Intentionally NOT awaited — runs in background
  sendEmailSafely(mailOptions, context).catch((err) => {
    console.error(`[Email][${context}] Background send error:`, err.message);
  });
}

module.exports = {
  sendEmailSafely,
  sendEmailInBackground,
  renderCleanEmail,
  escapeHtml,
  isEmailSuppressed: (email) => {
    const db = _getDb();
    return db ? isEmailSuppressed(db, email) : Promise.resolve(false);
  },
  suppressEmail: (email, reason, lastError) => {
    const db = _getDb();
    return db ? suppressEmail(db, email, reason, lastError) : Promise.resolve();
  },
};
